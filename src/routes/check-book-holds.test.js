import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TEST_API_KEY,
    createReply,
    makeRequest,
} from '../utils/skyvern-webhook-test-helpers.js';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const TEST_FROM_NUMBER = '+15550001234';
const TEST_PRIMARY_NUMBERS = ['+12065550100'];

/**
 * Load the handler with overridden env/clients, returning a cleanup function.
 *
 * @param {object} [options] - Options.
 * @param {any} [options.openaiClient] - OpenAI client mock.
 * @param {any} [options.twilioClient] - Twilio client mock.
 * @param {string} [options.apiKey] - SKYVERN_API_KEY value.
 * @param {string} [options.fromNumber] - TWILIO_SMS_FROM_NUMBER value.
 * @param {string[]} [options.primaryNumbers] - PRIMARY_USER_PHONE_NUMBERS.
 * @returns {Promise<{ checkBookHoldsHandler: Function, cleanup: Function }>} Handler and cleanup.
 */
async function loadHandler({
    openaiClient = undefined,
    twilioClient = undefined,
    apiKey = TEST_API_KEY,
    fromNumber = TEST_FROM_NUMBER,
    primaryNumbers = TEST_PRIMARY_NUMBERS,
} = {}) {
    const prevEnv = {
        SKYVERN_API_KEY: process.env.SKYVERN_API_KEY,
        TWILIO_SMS_FROM_NUMBER: process.env.TWILIO_SMS_FROM_NUMBER,
        PRIMARY_USER_PHONE_NUMBERS: process.env.PRIMARY_USER_PHONE_NUMBERS,
        SERVER_BASE_URL: process.env.SERVER_BASE_URL,
        NODE_ENV: process.env.NODE_ENV,
    };

    if (apiKey) process.env.SKYVERN_API_KEY = apiKey;
    else delete process.env.SKYVERN_API_KEY;
    process.env.TWILIO_SMS_FROM_NUMBER = fromNumber;
    process.env.PRIMARY_USER_PHONE_NUMBERS = primaryNumbers.join(',');
    process.env.SERVER_BASE_URL = 'https://test.example.com';
    process.env.NODE_ENV = 'test';

    const init = await import('../init.js');
    const prevClients = {
        openaiClient: init.openaiClient,
        twilioClient: init.twilioClient,
    };
    init.setInitClients({ openaiClient, twilioClient });

    const moduleUrl =
        new URL('./check-book-holds.js', import.meta.url).href +
        `?test=check-book-holds-${Math.random()}`;
    const { checkBookHoldsHandler } = await import(moduleUrl);

    const cleanup = () => {
        for (const [key, val] of Object.entries(prevEnv)) {
            if (val == null) delete process.env[key];
            else process.env[key] = val;
        }
        init.setInitClients(prevClients);
    };

    return { checkBookHoldsHandler, cleanup };
}

// ------- Tests -------

test('check-book-holds: returns 500 when SKYVERN_API_KEY is not set', async () => {
    const { checkBookHoldsHandler, cleanup } = await loadHandler({
        apiKey: '',
    });
    try {
        delete process.env.SKYVERN_API_KEY;
        const reply = createReply();
        await checkBookHoldsHandler(
            makeRequest({ output: { holds: [] }, status: 'completed' }),
            reply
        );
        assert.equal(reply.statusCode, 500);
        assert.deepStrictEqual(reply.payload, {
            error: 'Webhook endpoint not configured.',
        });
    } finally {
        cleanup();
    }
});

test('check-book-holds: returns 401 when signature header is missing', async () => {
    const { checkBookHoldsHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        const req = makeRequest(
            { output: { holds: [] }, status: 'completed' },
            { signatureHeader: null }
        );
        await checkBookHoldsHandler(req, reply);
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('check-book-holds: returns 401 when signature is invalid', async () => {
    const { checkBookHoldsHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        const req = makeRequest(
            { output: { holds: [] }, status: 'completed' },
            { signatureHeader: 'deadbeef' }
        );
        await checkBookHoldsHandler(req, reply);
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('check-book-holds: returns 400 when output, failure_reason and summary are all null/absent', async () => {
    const { checkBookHoldsHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        await checkBookHoldsHandler(
            makeRequest({
                status: 'failed',
                output: null,
                failure_reason: null,
                summary: null,
            }),
            reply
        );
        assert.equal(reply.statusCode, 400);
        assert.deepStrictEqual(reply.payload, {
            error: 'No holds data in payload.',
        });
    } finally {
        cleanup();
    }
});

test('check-book-holds: returns 500 when Twilio from number is not configured', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    'You have 1 hold: "The Pragmatic Programmer" — Ready for pickup.',
            }),
        },
    };

    const { checkBookHoldsHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        fromNumber: '',
    });
    try {
        const reply = createReply();
        await checkBookHoldsHandler(
            makeRequest({
                output: {
                    holds: [
                        { title: 'The Pragmatic Programmer', status: 'ready' },
                    ],
                },
                status: 'completed',
            }),
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio from number not configured.');
    } finally {
        cleanup();
    }
});

test('check-book-holds: returns 500 when Twilio client is unavailable', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    'You have 1 hold: "The Pragmatic Programmer" — Ready for pickup.',
            }),
        },
    };

    const { checkBookHoldsHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: null,
    });
    try {
        const reply = createReply();
        await checkBookHoldsHandler(
            makeRequest({
                output: {
                    holds: [
                        { title: 'The Pragmatic Programmer', status: 'ready' },
                    ],
                },
                status: 'completed',
            }),
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio client not configured.');
    } finally {
        cleanup();
    }
});

test('check-book-holds: sends SMS (no phone call) when output is present', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    'Your holds: "The Pragmatic Programmer" — Ready for pickup.',
            }),
        },
    };

    /** @type {any[]} */
    const smsSent = [];
    /** @type {any[]} */
    const callsMade = [];
    const mockTwilio = {
        messages: {
            create: async (/** @type {any} */ params) => {
                smsSent.push(params);
                return { sid: 'SM123', status: 'queued' };
            },
        },
        calls: {
            create: async (/** @type {any} */ params) => {
                callsMade.push(params);
                return { sid: 'CA123', status: 'queued' };
            },
        },
    };

    const { checkBookHoldsHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
        primaryNumbers: ['+12065550100', '+12065550101'],
    });
    try {
        const reply = createReply();
        await checkBookHoldsHandler(
            makeRequest({
                status: 'completed',
                output: {
                    holds: [
                        {
                            title: 'The Pragmatic Programmer',
                            availability: 'available',
                            status: 'ready',
                        },
                    ],
                },
            }),
            reply
        );
        assert.equal(reply.statusCode, null); // 200 default
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(
            payload.message,
            'Your holds: "The Pragmatic Programmer" — Ready for pickup.'
        );

        // SMS sent to both primary numbers
        assert.equal(smsSent.length, 2);
        assert.equal(smsSent[0].to, '+12065550100');
        assert.equal(smsSent[1].to, '+12065550101');

        // No phone call placed
        assert.equal(callsMade.length, 0);

        const smsResults = /** @type {any[]} */ (payload.sms_results);
        assert.equal(smsResults.length, 2);
    } finally {
        cleanup();
    }
});
