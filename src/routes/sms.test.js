import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { appendSmsConsentRecord } from '../utils/sms-consent.js';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

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

/**
 * @param {object} [options] - Handler options.
 * @param {Set<string>} [options.allowlist] - Primary allowlist.
 * @param {Set<string>} [options.secondaryAllowlist] - Secondary allowlist.
 * @param {any} [options.twilioClient] - Twilio client override.
 * @param {any} [options.openaiClient] - OpenAI client override.
 * @param {boolean} [options.isDev] - Use dev mode toggle.
 * @returns {Promise<{ smsHandler: Function, cleanup: Function }>} Loaded handler and cleanup.
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
        assert.ok(String(reply.payload).includes('Reply START'));
    } finally {
        cleanup();
    }
});

test('sms START immediately subscribes with confirmed status', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = path.join(
        tmpDir,
        'consent.jsonl'
    );

    const { smsHandler, cleanup } = await loadSmsHandler({
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    const request = {
        body: { Body: 'START', From: '+12065550100', To: '+12065550101' },
    };
    const reply = createReply();

    try {
        await smsHandler(request, reply);
        assert.equal(reply.headers.type, 'text/xml');
        assert.ok(
            String(reply.payload).includes('successfully been re-subscribed')
        );
        assert.ok(String(reply.payload).includes('Reply HELP'));
    } finally {
        cleanup();
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms YES, UNSTOP, and other opt-in keywords immediately subscribe', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = path.join(
        tmpDir,
        'consent.jsonl'
    );

    const { smsHandler, cleanup } = await loadSmsHandler({
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    try {
        // Test YES
        const yesRequest = {
            body: { Body: 'YES', From: '+12065550100', To: '+12065550101' },
        };
        const yesReply = createReply();
        await smsHandler(yesRequest, yesReply);
        assert.equal(yesReply.headers.type, 'text/xml');
        assert.ok(
            String(yesReply.payload).includes('successfully been re-subscribed')
        );

        // Test UNSTOP
        const unstopRequest = {
            body: { Body: 'UNSTOP', From: '+14255550101', To: '+12065550101' },
        };
        const unstopReply = createReply();
        await smsHandler(unstopRequest, unstopReply);
        assert.equal(unstopReply.headers.type, 'text/xml');
        assert.ok(
            String(unstopReply.payload).includes(
                'successfully been re-subscribed'
            )
        );
    } finally {
        cleanup();
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms STOP and other opt-out keywords unsubscribe immediately', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = path.join(
        tmpDir,
        'consent.jsonl'
    );

    const { smsHandler, cleanup } = await loadSmsHandler({
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    try {
        // Test STOP
        const stopRequest = {
            body: { Body: 'STOP', From: '+12065550100', To: '+12065550101' },
        };
        const stopReply = createReply();
        await smsHandler(stopRequest, stopReply);
        assert.equal(stopReply.headers.type, 'text/xml');
        assert.ok(
            String(stopReply.payload).includes('successfully been unsubscribed')
        );

        // Test UNSUBSCRIBE
        const unsubRequest = {
            body: {
                Body: 'UNSUBSCRIBE',
                From: '+14255550101',
                To: '+12065550101',
            },
        };
        const unsubReply = createReply();
        await smsHandler(unsubRequest, unsubReply);
        assert.equal(unsubReply.headers.type, 'text/xml');
        assert.ok(
            String(unsubReply.payload).includes(
                'successfully been unsubscribed'
            )
        );

        // Test QUIT
        const quitRequest = {
            body: { Body: 'quit', From: '+12065550100', To: '+12065550101' },
        };
        const quitReply = createReply();
        await smsHandler(quitRequest, quitReply);
        assert.equal(quitReply.headers.type, 'text/xml');
        assert.ok(
            String(quitReply.payload).includes('successfully been unsubscribed')
        );
    } finally {
        cleanup();
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms HELP and INFO send help message', async () => {
    const { smsHandler, cleanup } = await loadSmsHandler({
        twilioClient: null,
        openaiClient: {
            responses: { create: async () => ({ output_text: 'ok' }) },
        },
    });

    // Test HELP keyword
    const helpRequest = {
        body: { Body: 'HELP', From: '+12065550100', To: '+12065550101' },
    };
    const helpReply = createReply();

    try {
        await smsHandler(helpRequest, helpReply);
        assert.equal(helpReply.headers.type, 'text/xml');
        assert.ok(String(helpReply.payload).includes('Reply STOP'));
        assert.ok(String(helpReply.payload).includes('May Apply'));

        // Test INFO keyword
        const infoRequest = {
            body: { Body: 'INFO', From: '+12065550100', To: '+12065550101' },
        };
        const infoReply = createReply();

        await smsHandler(infoRequest, infoReply);
        assert.equal(infoReply.headers.type, 'text/xml');
        assert.ok(String(infoReply.payload).includes('Reply STOP'));
        assert.ok(String(infoReply.payload).includes('May Apply'));
    } finally {
        cleanup();
    }
});

test('sms replies with unconfigured message when Twilio client missing', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;
    await appendSmsConsentRecord(
        {
            phoneNumber: '+12065550100',
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

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
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms sends AI reply via Twilio', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;
    await appendSmsConsentRecord(
        {
            phoneNumber: '+12065550100',
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

    /** @type {{ list: any[], create: any[], ai?: any }} */
    const calls = { list: [], create: [] };
    const twilioClient = {
        messages: {
            /**
             * @param {any} params - Message list params.
             * @returns {Promise<any[]>} Listed messages.
             */
            list: async (params) => {
                calls.list.push(params);
                return [];
            },
            /**
             * @param {any} params - Message create params.
             * @returns {Promise<{ sid: string }>} Create result.
             */
            create: async (params) => {
                calls.create.push(params);
                return { sid: 'SM123' };
            },
        },
    };
    const openaiClient = {
        responses: {
            /**
             * @param {any} payload - OpenAI request payload.
             * @returns {Promise<{ output_text: string }>} OpenAI response.
             */
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
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms uses AI error fallback text when OpenAI fails', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;
    await appendSmsConsentRecord(
        {
            phoneNumber: '+12065550100',
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

    /** @type {{ create: any[] }} */
    const calls = { create: [] };
    const twilioClient = {
        messages: {
            list: async () => [],
            /**
             * @param {any} params - Message create params.
             * @returns {Promise<{ sid: string }>} Create result.
             */
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
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms replies with TwiML when Twilio send fails', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-route-'));
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;
    await appendSmsConsentRecord(
        {
            phoneNumber: '+12065550100',
            keyword: 'YES',
            status: 'confirmed',
            timestamp: new Date().toISOString(),
        },
        recordsPath
    );

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
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('sms remembers unanswered question when user has no consent, then answers after START and YES', async () => {
    const tmpDir = await mkdtemp(
        path.join(os.tmpdir(), 'sms-pending-question-')
    );
    const recordsPath = path.join(tmpDir, 'consent.jsonl');
    process.env.SMS_CONSENT_RECORDS_FILE_PATH = recordsPath;

    /** @type {{ list: any[], create: any[], ai: any[] }} */
    const calls = { list: [], create: [], ai: [] };
    const twilioClient = {
        messages: {
            /**
             * @param {any} params - Message list params.
             * @returns {Promise<any[]>} Listed messages.
             */
            list: async (params) => {
                calls.list.push(params);
                return [];
            },
            /**
             * @param {any} params - Message create params.
             * @returns {Promise<{ sid: string }>} Create result.
             */
            create: async (params) => {
                calls.create.push(params);
                return { sid: `SM${calls.create.length}` };
            },
        },
    };
    const openaiClient = {
        responses: {
            /**
             * @param {any} payload - OpenAI request payload.
             * @returns {Promise<{ output_text: string }>} OpenAI response.
             */
            create: async (payload) => {
                calls.ai.push(payload);
                // Simulate AI response - return a relevant answer if input contains original question
                const inputStr = JSON.stringify(payload?.input || '');
                if (
                    inputStr.includes('What is the weather') ||
                    inputStr.includes('weather')
                ) {
                    return { output_text: 'The weather is sunny and 72°F.' };
                }
                return { output_text: 'Got it!' };
            },
        },
    };
    const { smsHandler, cleanup } = await loadSmsHandler({
        allowlist: new Set(['+12065550100']),
        secondaryAllowlist: new Set(),
        twilioClient,
        openaiClient,
    });

    try {
        // Step 1: Allowlisted user without consent asks a question
        const questRequest = {
            body: {
                Body: 'What is the weather?',
                From: '+12065550100',
                To: '+12065550101',
            },
        };
        const questReply = createReply();
        await smsHandler(questRequest, questReply);

        // System should ask them to START (no consent)
        assert.equal(questReply.headers.type, 'text/xml');
        assert.ok(String(questReply.payload).includes('Reply START'));
        // AI should not have been called yet
        assert.equal(calls.ai.length, 0);
        // No SMS reply sent yet
        assert.equal(calls.create.length, 0);

        // Step 2: User sends START to enroll
        const startRequest = {
            body: { Body: 'START', From: '+12065550100', To: '+12065550101' },
        };
        const startReply = createReply();
        await smsHandler(startRequest, startReply);

        // System should acknowledge enrollment
        assert.equal(startReply.headers.type, 'text/xml');
        assert.ok(String(startReply.payload).includes('successfully been'));
        // Still no AI call or SMS yet
        assert.equal(calls.ai.length, 0);
        assert.equal(calls.create.length, 0);

        // Step 3: User sends YES to confirm
        const confirmRequest = {
            body: { Body: 'YES', From: '+12065550100', To: '+12065550101' },
        };
        const confirmReply = createReply();
        try {
            await smsHandler(confirmRequest, confirmReply);
        } catch (e) {
            console.error('Handler error on YES/confirm message:', e);
            throw e;
        }

        // System should now treat this like a confirmation and should have
        // called AI with the remembered question and sent an AI-generated reply
        assert.equal(confirmReply.headers.type, 'text/xml');
        // Should send a reply via Twilio after YES/confirmation
        assert.equal(calls.create.length, 1);
        assert.ok(String(calls.create[0].body).includes('weather'));
    } finally {
        cleanup();
        delete process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        await rm(tmpDir, { recursive: true, force: true });
    }
});
