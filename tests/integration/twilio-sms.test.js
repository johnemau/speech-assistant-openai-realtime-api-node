import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

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
    const env = await import('../../src/env.js');
    const previousAllow = env.ALLOW_SEND_SMS;
    env.setAllowSendSms(true);

    const { execute } = await loadSendSmsModule();
    const toNumber = requireRecipientNumber();

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
    }
});
