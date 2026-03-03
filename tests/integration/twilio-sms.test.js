import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import { appendSmsConsentRecord } from '../../src/utils/sms-consent.js';
import { getSmsConsentStatus } from '../../src/utils/sms-consent.js';

loadEnv({ path: '.env' });

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const requiredTwilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const requiredTwilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const requiredTwilioApiKey = process.env.TWILIO_API_KEY;
const requiredTwilioApiSecret = process.env.TWILIO_API_SECRET;
const smsFromNumber = process.env.TWILIO_SMS_FROM_NUMBER;
const primaryNumbers = process.env.PRIMARY_USER_PHONE_NUMBERS;
const secondaryNumbers = process.env.SECONDARY_USER_PHONE_NUMBERS;

let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/tools/send-sms.js')>} Module import.
 */
async function loadSendSmsModule() {
    importCounter += 1;
    return import(`../../src/tools/send-sms.js?test=${importCounter}`);
}

/**
 * @returns {string} First available allowlisted recipient.
 */
function requireRecipientNumber() {
    const rawList = `${primaryNumbers || ''},${secondaryNumbers || ''}`
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    assert.ok(
        rawList.length > 0,
        'PRIMARY_USER_PHONE_NUMBERS or SECONDARY_USER_PHONE_NUMBERS must include at least one number.'
    );
    return rawList[0];
}

/**
 * @returns {boolean} Whether Twilio credentials are available.
 */
function hasTwilioCreds() {
    if (!requiredTwilioAccountSid) return false;
    if (requiredTwilioAuthToken) return true;
    return Boolean(requiredTwilioApiKey && requiredTwilioApiSecret);
}

test('requires Twilio credentials for SMS integration', () => {
    assert.ok(
        hasTwilioCreds(),
        'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET) must be set.'
    );
    assert.ok(
        smsFromNumber,
        'TWILIO_SMS_FROM_NUMBER must be set in the environment or .env file.'
    );
});

test('twilio messages list integration', async () => {
    const init = await import('../../src/init.js');
    assert.ok(init.twilioClient, 'Twilio client must be initialized.');

    const result = await init.twilioClient.messages.list({ limit: 1 });

    assert.ok(Array.isArray(result));
});

test('send_sms integration', async () => {
    const tmpDir = await mkdtemp(
        path.join(os.tmpdir(), 'sms-consent-integration-')
    );
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;

    const env = await import('../../src/env.js');
    const previousAllow = env.ALLOW_SEND_SMS;
    env.setAllowSendSms(true);

    const { execute } = await loadSendSmsModule();
    const toNumber = requireRecipientNumber();

    // Set up SMS consent for the test number
    await appendSmsConsentRecord(
        {
            phoneNumber: toNumber,
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

    try {
        const result = await execute({
            args: { body_text: 'Integration test SMS from assistant.' },
            context: {
                currentCallerE164: toNumber,
                currentTwilioNumberE164: smsFromNumber,
            },
        });

        assert.ok(result, 'Expected send result');
        assert.ok(result.sid, 'Expected message SID');
        assert.equal(typeof result.length, 'number');
    } finally {
        env.setAllowSendSms(previousAllow);
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('user who does not agree to SMS consent', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-test-'));
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;

    const env = await import('../../src/env.js');
    const prev = {
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
    };

    const toNumber = requireRecipientNumber();
    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    env.PRIMARY_CALLERS_SET.add(toNumber);

    const init = await import('../../src/init.js');
    const prevClients = {
        openaiClient: init.openaiClient,
        twilioClient: init.twilioClient,
    };
    init.setInitClients({
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
        twilioClient: null,
    });

    const moduleUrl =
        new URL('../../src/routes/sms.js', import.meta.url).href +
        `?test=no-consent-${Math.random()}`;
    const { smsHandler } = await import(moduleUrl);

    // Step 1: User sends random message without enrolling
    let request = {
        body: { Body: 'Random question', From: toNumber, To: smsFromNumber },
    };
    let reply = createReply();
    await smsHandler(request, reply);
    assert.ok(
        String(reply.payload).includes('not enrolled'),
        'Expected handler to indicate user is not enrolled'
    );

    // Step 2: Verify no consent status (user never enrolled)
    let status = await getSmsConsentStatus(toNumber, recordsPath);
    assert.equal(
        status,
        null,
        'Expected null consent status when user never enrolled'
    );

    // Cleanup
    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    prev.primary.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
    prev.secondary.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
    init.setInitClients(prevClients);
    delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
    await rm(tmpDir, { recursive: true, force: true });
});

test('user with consent but not on allowlist is rejected', async () => {
    const tmpDir = await mkdtemp(
        path.join(os.tmpdir(), 'sms-consent-allowlist-test-')
    );
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;

    const env = await import('../../src/env.js');
    const prev = {
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
    };

    // Create a number that is NOT in the allowlist
    const notAllowlistedNumber = '+19999999999';
    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();

    // Add SMS consent for the non-allowlisted number
    await appendSmsConsentRecord(
        {
            phoneNumber: notAllowlistedNumber,
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

    const init = await import('../../src/init.js');
    const prevClients = {
        openaiClient: init.openaiClient,
        twilioClient: init.twilioClient,
    };
    init.setInitClients({
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
        twilioClient: null,
    });

    const moduleUrl =
        new URL('../../src/routes/sms.js', import.meta.url).href +
        `?test=allowlist-${Math.random()}`;
    const { smsHandler } = await import(moduleUrl);

    // Step 1: User with consent but not on allowlist sends a message
    let request = {
        body: {
            Body: 'Hello, is anyone there?',
            From: notAllowlistedNumber,
            To: smsFromNumber,
        },
    };
    let reply = createReply();
    await smsHandler(request, reply);

    // Step 2: Verify the message is rejected (user not on allowlist)
    assert.ok(
        String(reply.payload).includes('not on our list'),
        'Expected handler to indicate user is not on the allowlist'
    );

    // Step 3: Verify consent status exists but user is still rejected
    let status = await getSmsConsentStatus(
        notAllowlistedNumber,
        recordsPath
    );
    assert.equal(
        status,
        'confirmed',
        'Expected confirmed consent status for non-allowlisted user'
    );

    // Cleanup
    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    prev.primary.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
    prev.secondary.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
    init.setInitClients(prevClients);
    delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
    await rm(tmpDir, { recursive: true, force: true });
});

/**
 * @returns {{
 *  headers: Record<string, string>,
 *  statusCode: number | null,
 *  payload: unknown,
 *  type: (contentType: string) => any,
 *  code: (status: number) => any,
 *  send: (payload: unknown) => any,
 * }} Reply mock for tests.
 */
function createReply() {
    return {
        headers: {},
        statusCode: null,
        payload: null,
        /**
         * @param {string} contentType - Response content type.
         * @returns {any} Reply for chaining.
         */
        type(contentType) {
            this.headers.type = contentType;
            return this;
        },
        /**
         * @param {number} status - HTTP status code.
         * @returns {any} Reply for chaining.
         */
        code(status) {
            this.statusCode = status;
            return this;
        },
        /**
         * @param {unknown} payload - Reply payload.
         * @returns {any} Reply for chaining.
         */
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
}
