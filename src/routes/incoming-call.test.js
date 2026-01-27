import test from 'node:test';
import assert from 'node:assert/strict';

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

async function setCallerAllowlists({
    primaryCaller = '+12065550100',
    secondaryCaller = '+14255550101',
} = {}) {
    const env = await import('../env.js');
    const prev = {
        all: new Set(env.ALL_ALLOWED_CALLERS_SET),
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
    };

    env.ALL_ALLOWED_CALLERS_SET.clear();
    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();

    if (primaryCaller) {
        env.PRIMARY_CALLERS_SET.add(primaryCaller);
        env.ALL_ALLOWED_CALLERS_SET.add(primaryCaller);
    }
    if (secondaryCaller) {
        env.SECONDARY_CALLERS_SET.add(secondaryCaller);
        env.ALL_ALLOWED_CALLERS_SET.add(secondaryCaller);
    }

    return () => {
        env.ALL_ALLOWED_CALLERS_SET.clear();
        env.PRIMARY_CALLERS_SET.clear();
        env.SECONDARY_CALLERS_SET.clear();
        prev.all.forEach((value) => env.ALL_ALLOWED_CALLERS_SET.add(value));
        prev.primary.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
        prev.secondary.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
    };
}

async function loadIncomingCallHandler() {
    const moduleUrl =
        new URL('./incoming-call.js', import.meta.url).href +
        `?test=incoming-${Math.random()}`;
    const { incomingCallHandler } = await import(moduleUrl);
    return incomingCallHandler;
}

test('incoming-call denies callers not in allowlist', async () => {
    const restoreAllowlists = await setCallerAllowlists();
    const incomingCallHandler = await loadIncomingCallHandler();
    const request = {
        body: { From: '+19995550000', To: '+12065550100' },
        headers: { host: 'example.com' },
    };
    const reply = createReply();

    try {
        await incomingCallHandler(request, reply);

        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(String(reply.payload).includes('restricted'));
        assert.ok(String(reply.payload).includes('Hangup'));
    } finally {
        restoreAllowlists();
    }
});

test('incoming-call responds with connect stream and parameters', async () => {
    const restoreAllowlists = await setCallerAllowlists();
    const incomingCallHandler = await loadIncomingCallHandler();
    const request = {
        body: { From: '+1 (206) 555-0100', To: '+1 (425) 555-0101' },
        headers: { host: 'example.com' },
    };
    const reply = createReply();

    try {
        await incomingCallHandler(request, reply);

        const twiml = String(reply.payload);
        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(twiml.includes('wss://example.com/media-stream'));
        assert.ok(twiml.includes('caller_number'));
        assert.ok(twiml.includes('twilio_number'));
    } finally {
        restoreAllowlists();
    }
});
