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

/**
 * @returns {boolean} Whether Twilio credentials are available.
 */
function hasTwilioCreds() {
    if (!requiredTwilioAccountSid) return false;
    if (requiredTwilioAuthToken) return true;
    return Boolean(requiredTwilioApiKey && requiredTwilioApiSecret);
}

/**
 * @returns {string} First primary user phone number.
 */
function requireRecipientNumber() {
    const rawList = `${primaryNumbers || ''}`
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    assert.ok(
        rawList.length > 0,
        'PRIMARY_USER_PHONE_NUMBERS must include at least one number.'
    );
    return rawList[0];
}

test('requires Twilio credentials for page call integration', () => {
    assert.ok(
        hasTwilioCreds(),
        'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (or TWILIO_API_KEY + TWILIO_API_SECRET) must be set.'
    );
    assert.ok(
        smsFromNumber,
        'TWILIO_SMS_FROM_NUMBER must be set in the environment or .env file.'
    );
    assert.ok(
        primaryNumbers,
        'PRIMARY_USER_PHONE_NUMBERS must be set for page call tests.'
    );
});

test('placePageCall places a voice call via live Twilio', async () => {
    const init = await import('../../src/init.js');
    assert.ok(init.twilioClient, 'Twilio client must be initialized.');

    const { placePageCall } = await import('../../src/utils/page-call.js');

    const toNumber = requireRecipientNumber();
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = toNumber;

    try {
        const result = await placePageCall({
            pageMessage: 'Integration test page call.',
            fromNumber: /** @type {string} */ (smsFromNumber),
            client: init.twilioClient,
        });

        assert.equal(result.to, toNumber);
        assert.ok(result.sid, 'Expected call SID');
        assert.ok(result.status, 'Expected call status');
        assert.equal(result.error, undefined, 'Expected no error');
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});

test('buildPageCallTwiml produces valid TwiML with page message', async () => {
    const { buildPageCallTwiml } = await import('../../src/utils/page-call.js');

    const twiml = buildPageCallTwiml('Server is on fire');
    assert.match(twiml, /<Response>/);
    assert.match(twiml, /Urgent page\. Server is on fire/);
    assert.match(twiml, /Repeating\. Server is on fire/);
    assert.match(twiml, /<Pause/);
    assert.match(twiml, /<\/Response>/);
});
