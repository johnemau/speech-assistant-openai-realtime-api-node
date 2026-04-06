import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const TEST_API_KEY = 'test-skyvern-api-key';
const TEST_FROM_NUMBER = '+15550001234';
const TEST_PRIMARY_NUMBERS = ['+12065550100'];

/**
 * Build a valid x-skyvern-signature header for the given body and key.
 *
 * @param {string | Buffer} body - Raw request body.
 * @param {string} [key] - HMAC key (defaults to TEST_API_KEY).
 * @returns {string} Hex-encoded HMAC-SHA256 digest.
 */
function makeSignature(body, key = TEST_API_KEY) {
    return crypto
        .createHmac('sha256', key)
        .update(typeof body === 'string' ? Buffer.from(body) : body)
        .digest('hex');
}

/**
 * @returns {{
 *   headers: Record<string, string>,
 *   statusCode: number | null,
 *   payload: unknown,
 *   code: (status: number) => any,
 *   send: (payload: unknown) => any,
 * }} Reply mock for tests.
 */
function createReply() {
    return {
        headers: {},
        statusCode: null,
        payload: null,
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

/**
 * Build a fake request with a signed body.
 *
 * @param {object} body - Parsed body object.
 * @param {object} [options] - Options.
 * @param {string} [options.signatureKey] - Key to sign with (defaults to TEST_API_KEY).
 * @param {string | null} [options.signatureHeader] - Override the header value (null = omit).
 * @returns {{ headers: Record<string, string>, body: object, rawBody: Buffer }} Mock request.
 */
function makeRequest(
    body,
    { signatureKey = TEST_API_KEY, signatureHeader = undefined } = {}
) {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const sig =
        signatureHeader !== undefined
            ? signatureHeader
            : makeSignature(raw, signatureKey);
    const headers = /** @type {Record<string, string>} */ ({});
    if (sig !== null) {
        headers['x-skyvern-signature'] = sig;
    }
    return { headers, body, rawBody: raw };
}

/**
 * Load the handler with overridden env/clients, returning a cleanup function.
 *
 * @param {object} [options] - Options.
 * @param {any} [options.openaiClient] - OpenAI client mock.
 * @param {any} [options.twilioClient] - Twilio client mock.
 * @param {string} [options.apiKey] - SKYVERN_API_KEY value.
 * @param {string} [options.fromNumber] - TWILIO_SMS_FROM_NUMBER value.
 * @param {string[]} [options.primaryNumbers] - PRIMARY_USER_PHONE_NUMBERS.
 * @param {Function} [options.isWithinCallingHoursFn] - Override calling-hours check.
 * @returns {Promise<{ studyRoomTimesHandler: Function, cleanup: Function }>} Handler and cleanup.
 */
async function loadHandler({
    openaiClient = undefined,
    twilioClient = undefined,
    apiKey = TEST_API_KEY,
    fromNumber = TEST_FROM_NUMBER,
    primaryNumbers = TEST_PRIMARY_NUMBERS,
    isWithinCallingHoursFn = async () => ({
        allowed: true,
        hour: 12,
        timeZoneId: 'America/Los_Angeles',
    }),
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
        new URL('./get-study-room-times.js', import.meta.url).href +
        `?test=study-room-${Math.random()}`;
    const { studyRoomTimesHandler, setStudyRoomTimesDeps } = await import(
        moduleUrl
    );
    setStudyRoomTimesDeps({ isWithinCallingHoursFn });

    const cleanup = () => {
        for (const [key, val] of Object.entries(prevEnv)) {
            if (val == null) delete process.env[key];
            else process.env[key] = val;
        }
        init.setInitClients(prevClients);
    };

    return { studyRoomTimesHandler, cleanup };
}

// ------- Tests -------

test('get-study-room-times: returns 500 when SKYVERN_API_KEY is not set', async () => {
    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        apiKey: '',
    });
    try {
        delete process.env.SKYVERN_API_KEY;
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({ output: { rooms: [] }, status: 'completed' }),
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

test('get-study-room-times: returns 401 when signature header is missing', async () => {
    const { studyRoomTimesHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        const req = makeRequest(
            { output: { rooms: [] }, status: 'completed' },
            { signatureHeader: null }
        );
        await studyRoomTimesHandler(req, reply);
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('get-study-room-times: returns 401 when signature is invalid', async () => {
    const { studyRoomTimesHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        const req = makeRequest(
            { output: { rooms: [] }, status: 'completed' },
            { signatureHeader: 'deadbeef' }
        );
        await studyRoomTimesHandler(req, reply);
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('get-study-room-times: returns 400 when output, failure_reason and summary are all null/absent', async () => {
    const { studyRoomTimesHandler, cleanup } = await loadHandler();
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
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
            error: 'No study room data in payload.',
        });
    } finally {
        cleanup();
    }
});

test('get-study-room-times: returns 500 when Twilio from number is not configured', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text: 'Room A at 2pm, Room B at 3pm.',
            }),
        },
    };

    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        fromNumber: '',
    });
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({ output: { rooms: ['Room A'] }, status: 'completed' }),
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio from number not configured.');
    } finally {
        cleanup();
    }
});

test('get-study-room-times: returns 500 when Twilio client is unavailable', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text: 'Room A at 2pm.',
            }),
        },
    };

    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: null,
    });
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({ output: { rooms: ['Room A'] }, status: 'completed' }),
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio client not configured.');
    } finally {
        cleanup();
    }
});

test('get-study-room-times: sends SMS and places call when output is present', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    'Room 101 is available at 2pm, capacity 4. Room 202 is available at 3pm, capacity 2.',
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

    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
        primaryNumbers: ['+12065550100', '+12065550101'],
    });
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({
                status: 'completed',
                output: {
                    rooms: [{ name: 'Room 101', time: '2pm', capacity: 4 }],
                },
            }),
            reply
        );
        assert.equal(reply.statusCode, null); // 200 default
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(
            payload.message,
            'Room 101 is available at 2pm, capacity 4. Room 202 is available at 3pm, capacity 2.'
        );

        // SMS sent to both primary numbers
        assert.equal(smsSent.length, 2);
        assert.equal(smsSent[0].to, '+12065550100');
        assert.equal(smsSent[1].to, '+12065550101');

        // Call placed to first primary number
        assert.equal(callsMade.length, 1);
        assert.equal(callsMade[0].to, '+12065550100');
        assert.match(callsMade[0].url, /\/incoming-call\?source=page/);

        const smsResults = /** @type {any[]} */ (payload.sms_results);
        assert.equal(smsResults.length, 2);
        assert.equal(smsResults[0].sid, 'SM123');

        const callResult = /** @type {Record<string, unknown>} */ (
            payload.call_result
        );
        assert.equal(callResult.sid, 'CA123');
    } finally {
        cleanup();
    }
});

test('get-study-room-times: uses failure_reason fallback when output is null', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text: 'No rooms available due to a system error.',
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
                return { sid: 'SM456', status: 'queued' };
            },
        },
        calls: {
            create: async (/** @type {any} */ params) => {
                callsMade.push(params);
                return { sid: 'CA456', status: 'queued' };
            },
        },
    };

    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
    });
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({
                status: 'failed',
                output: null,
                failure_reason: 'Booking system unreachable',
                summary: null,
            }),
            reply
        );
        assert.equal(reply.statusCode, null); // 200 default
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(
            payload.message,
            'No rooms available due to a system error.'
        );
        assert.equal(smsSent.length, 1);
        assert.equal(callsMade.length, 1);
    } finally {
        cleanup();
    }
});

test('get-study-room-times: skips call but still sends SMS outside calling hours', async () => {
    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text: 'Room A is available tomorrow at 9am.',
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
                return { sid: 'SM789', status: 'queued' };
            },
        },
        calls: {
            create: async (/** @type {any} */ params) => {
                callsMade.push(params);
                return { sid: 'CA789', status: 'queued' };
            },
        },
    };

    const { studyRoomTimesHandler, cleanup } = await loadHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
        isWithinCallingHoursFn: async () => ({
            allowed: false,
            hour: 23,
            timeZoneId: 'America/Los_Angeles',
        }),
    });
    try {
        const reply = createReply();
        await studyRoomTimesHandler(
            makeRequest({
                status: 'completed',
                output: { rooms: [{ name: 'Room A', time: '9am' }] },
            }),
            reply
        );
        assert.equal(reply.statusCode, null); // 200 default
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.message, 'Room A is available tomorrow at 9am.');

        // SMS still sent
        assert.equal(smsSent.length, 1);

        // Call NOT placed (outside calling hours)
        assert.equal(callsMade.length, 0);
        assert.equal(payload.call_result, null);
    } finally {
        cleanup();
    }
});
