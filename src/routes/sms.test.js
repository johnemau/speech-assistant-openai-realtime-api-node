import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

function createReply() {
    return {
        headers: {},
        statusCode: null,
        payload: null,
        type(contentType) {
            this.headers.type = contentType;
            return this;
        },
        code(status) {
            this.statusCode = status;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return this;
        }
    };
}

async function loadSmsHandler({
    allowlist = new Set(['+12065550100']),
    secondaryAllowlist = new Set(['+14255550101']),
    twilioClient = null,
    openaiClient = null,
    isDev = false
} = {}) {
    mock.module('../env.js', /** @type {any} */ ({
        DEFAULT_SMS_USER_LOCATION: { type: 'approximate', country: 'US', region: 'Washington' },
        IS_DEV: isDev,
        PRIMARY_CALLERS_SET: allowlist,
        SECONDARY_CALLERS_SET: secondaryAllowlist,
    }));

    mock.module('../init.js', /** @type {any} */ ({
        openaiClient,
        twilioClient,
    }));

    const moduleUrl = new URL('./sms.js', import.meta.url).href + `?test=sms-${Math.random()}`;
    const { smsHandler } = await import(moduleUrl);
    return smsHandler;
}

test('sms replies with restricted message for non-allowlisted sender', async () => {
    const smsHandler = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(['+14255550101']),
        twilioClient: null,
        openaiClient: { responses: { create: async () => ({ output_text: 'ok' }) } }
    });

    const request = {
        body: { Body: 'Hello', From: '+19995550000', To: '+12065550100' }
    };
    const reply = createReply();

    await smsHandler(request, reply);

    assert.equal(reply.headers.type, 'text/xml');
    assert.ok(String(reply.payload).includes('restricted'));
    mock.reset();
});

test('sms replies with unconfigured message when Twilio client missing', async () => {
    const smsHandler = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient: null,
        openaiClient: { responses: { create: async () => ({ output_text: 'ok' }) } }
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' }
    };
    const reply = createReply();

    await smsHandler(request, reply);

    assert.equal(reply.headers.type, 'text/xml');
    assert.ok(String(reply.payload).includes('not configured'));
    mock.reset();
});

test('sms sends AI reply via Twilio', async () => {
    const calls = { list: [], create: [] };
    const twilioClient = {
        messages: {
            list: async (params) => {
                calls.list.push(params);
                return [];
            },
            create: async (params) => {
                calls.create.push(params);
                return { sid: 'SM123' };
            }
        }
    };
    const openaiClient = {
        responses: {
            create: async (payload) => {
                calls.ai = payload;
                return { output_text: 'Sure, here you go.' };
            }
        }
    };
    const smsHandler = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient
    });

    const request = {
        body: { Body: 'Latest request', From: '+12065550100', To: '+12065550101' }
    };
    const reply = createReply();

    await smsHandler(request, reply);

    assert.equal(calls.list.length, 2);
    assert.equal(calls.create.length, 1);
    assert.ok(calls.ai);
    assert.equal(calls.ai.model, 'gpt-5.2');
    assert.ok(String(calls.ai.input || '').includes('Latest request'));
    assert.equal(calls.create[0].from, '+12065550101');
    assert.equal(calls.create[0].to, '+12065550100');
    assert.equal(calls.create[0].body, 'Sure, here you go.');
    assert.equal(reply.headers.type, 'text/xml');
    mock.reset();
});

test('sms uses AI error fallback text when OpenAI fails', async () => {
    const calls = { create: [] };
    const twilioClient = {
        messages: {
            list: async () => [],
            create: async (params) => {
                calls.create.push(params);
                return { sid: 'SM456' };
            }
        }
    };
    const openaiClient = {
        responses: {
            create: async () => {
                throw new Error('OpenAI down');
            }
        }
    };
    const smsHandler = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' }
    };
    const reply = createReply();

    await smsHandler(request, reply);

    assert.equal(calls.create.length, 1);
    assert.ok(String(calls.create[0].body).includes('SMS reply error'));
    assert.equal(reply.headers.type, 'text/xml');
    mock.reset();
});

test('sms replies with TwiML when Twilio send fails', async () => {
    const twilioClient = {
        messages: {
            list: async () => [],
            create: async () => {
                throw new Error('Twilio send failed');
            }
        }
    };
    const openaiClient = {
        responses: {
            create: async () => ({ output_text: 'Sure.' })
        }
    };
    const smsHandler = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' }
    };
    const reply = createReply();

    await smsHandler(request, reply);

    assert.equal(reply.headers.type, 'text/xml');
    assert.ok(String(reply.payload).includes('SMS send error'));
    mock.reset();
});