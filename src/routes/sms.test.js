import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

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
        },
    };
}

/**
 * @param {object} [options]
 * @param {Set<string>} [options.allowlist]
 * @param {Set<string>} [options.secondaryAllowlist]
 * @param {any} [options.twilioClient]
 * @param {any} [options.openaiClient]
 * @param {boolean} [options.isDev]
 */
async function loadSmsHandler({
    allowlist = new Set(['+12065550100']),
    secondaryAllowlist = new Set(['+14255550101']),
    twilioClient = undefined,
    openaiClient = undefined,
    isDev = false,
} = {}) {
    const env = await import('../env.js');
    const prev = {
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
        isDev: process.env.NODE_ENV,
    };

    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    allowlist.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
    secondaryAllowlist.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
    process.env.NODE_ENV = isDev ? 'development' : 'test';

    const init = await import('../init.js');
    const prevClients = {
        openaiClient: init.openaiClient,
        twilioClient: init.twilioClient,
    };
    init.setInitClients({ openaiClient, twilioClient });

    const moduleUrl =
        new URL('./sms.js', import.meta.url).href +
        `?test=sms-${Math.random()}`;
    const { smsHandler } = await import(moduleUrl);

    const cleanup = () => {
        env.PRIMARY_CALLERS_SET.clear();
        env.SECONDARY_CALLERS_SET.clear();
        prev.primary.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
        prev.secondary.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
        if (prev.isDev == null) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev.isDev;
        init.setInitClients(prevClients);
    };

    return { smsHandler, cleanup };
}

test('sms replies with restricted message for non-allowlisted sender', async () => {
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(['+14255550101']),
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    const request = {
        body: { Body: 'Hello', From: '+19995550000', To: '+12065550100' },
    };
    const reply = createReply();

    try {
        await smsHandler(request, reply);

        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(String(reply.payload).includes('restricted'));
    } finally {
        cleanup();
    }
});

test('sms replies with unconfigured message when Twilio client missing', async () => {
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' },
    };
    const reply = createReply();

    try {
        await smsHandler(request, reply);

        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(String(reply.payload).includes('not configured'));
    } finally {
        cleanup();
    }
});

test('sms sends AI reply via Twilio', async () => {
    /** @type {{ list: any[], create: any[], ai?: any }} */
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
            },
        },
    };
    const openaiClient = {
        responses: {
            create: async (payload) => {
                calls.ai = payload;
                return { output_text: 'Sure, here you go.' };
            },
        },
    };
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient,
    });

    const request = {
        body: {
            Body: 'Latest request',
            From: '+12065550100',
            To: '+12065550101',
        },
    };
    const reply = createReply();

    try {
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
    } finally {
        cleanup();
    }
});

test('sms uses AI error fallback text when OpenAI fails', async () => {
    /** @type {{ create: any[] }} */
    const calls = { create: [] };
    const twilioClient = {
        messages: {
            list: async () => [],
            create: async (params) => {
                calls.create.push(params);
                return { sid: 'SM456' };
            },
        },
    };
    const openaiClient = {
        responses: {
            create: async () => {
                throw new Error('OpenAI down');
            },
        },
    };
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient,
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' },
    };
    const reply = createReply();

    try {
        await smsHandler(request, reply);

        assert.equal(calls.create.length, 1);
        assert.ok(String(calls.create[0].body).includes('SMS reply error'));
        assert.equal(reply.headers.type, 'text/xml');
    } finally {
        cleanup();
    }
});

test('sms replies with TwiML when Twilio send fails', async () => {
    const twilioClient = {
        messages: {
            list: async () => [],
            create: async () => {
                throw new Error('Twilio send failed');
            },
        },
    };
    const openaiClient = {
        responses: {
            create: async () => ({ output_text: 'Sure.' }),
        },
    };
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient,
    });

    const request = {
        body: { Body: 'Hello', From: '+12065550100', To: '+12065550101' },
    };
    const reply = createReply();

    try {
        await smsHandler(request, reply);

        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(String(reply.payload).includes('SMS send error'));
    } finally {
        cleanup();
    }
});
