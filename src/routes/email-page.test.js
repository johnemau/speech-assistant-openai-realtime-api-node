import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

/**
 * @returns {{
 *  headers: Record<string, string>,
 *  statusCode: number | null,
 *  payload: unknown,
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
 * @param {any} [options.twilioClient] - Twilio client override.
 * @param {any} [options.openaiClient] - OpenAI client override.
 * @param {string} [options.secret] - Email page secret.
 * @param {string} [options.criteriaFilePath] - Path to criteria file.
 * @param {string} [options.fromNumber] - Twilio from number.
 * @param {string[]} [options.primaryNumbers] - Primary user phone numbers.
 * @returns {Promise<{ emailPageHandler: Function, cleanup: Function }>} Loaded handler and cleanup.
 */
async function loadEmailPageHandler({
    twilioClient = undefined,
    openaiClient = undefined,
    secret = 'test-secret-key',
    criteriaFilePath = undefined,
    fromNumber = '+15550001234',
    primaryNumbers = ['+12065550100'],
} = {}) {
    const prevEnv = {
        EMAIL_PAGE_SECRET: process.env.EMAIL_PAGE_SECRET,
        EMAIL_PAGE_CRITERIA_FILE_PATH:
            process.env.EMAIL_PAGE_CRITERIA_FILE_PATH,
        TWILIO_SMS_FROM_NUMBER: process.env.TWILIO_SMS_FROM_NUMBER,
        PRIMARY_USER_PHONE_NUMBERS: process.env.PRIMARY_USER_PHONE_NUMBERS,
        NODE_ENV: process.env.NODE_ENV,
    };

    process.env.EMAIL_PAGE_SECRET = secret;
    if (criteriaFilePath)
        process.env.EMAIL_PAGE_CRITERIA_FILE_PATH = criteriaFilePath;
    process.env.TWILIO_SMS_FROM_NUMBER = fromNumber;
    process.env.PRIMARY_USER_PHONE_NUMBERS = primaryNumbers.join(',');
    process.env.NODE_ENV = 'test';

    const init = await import('../init.js');
    const prevClients = {
        openaiClient: init.openaiClient,
        twilioClient: init.twilioClient,
    };
    init.setInitClients({ openaiClient, twilioClient });

    const moduleUrl =
        new URL('./email-page.js', import.meta.url).href +
        `?test=email-page-${Math.random()}`;
    const { emailPageHandler } = await import(moduleUrl);

    const cleanup = () => {
        for (const [key, val] of Object.entries(prevEnv)) {
            if (val == null) delete process.env[key];
            else process.env[key] = val;
        }
        init.setInitClients(prevClients);
    };

    return { emailPageHandler, cleanup };
}

test('email-page: returns 401 when secret header is missing', async () => {
    const { emailPageHandler, cleanup } = await loadEmailPageHandler();
    try {
        const reply = createReply();
        await emailPageHandler(
            { headers: {}, body: { body: 'test email' } },
            reply
        );
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('email-page: returns 401 when secret header is wrong', async () => {
    const { emailPageHandler, cleanup } = await loadEmailPageHandler();
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'wrong-key' },
                body: { body: 'test email' },
            },
            reply
        );
        assert.equal(reply.statusCode, 401);
        assert.deepStrictEqual(reply.payload, { error: 'Unauthorized.' });
    } finally {
        cleanup();
    }
});

test('email-page: returns 400 when body content is missing', async () => {
    const { emailPageHandler, cleanup } = await loadEmailPageHandler();
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: '' },
            },
            reply
        );
        assert.equal(reply.statusCode, 400);
        assert.deepStrictEqual(reply.payload, {
            error: 'Missing email content in body.',
        });
    } finally {
        cleanup();
    }
});

test('email-page: returns 500 when criteria file is missing', async () => {
    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        criteriaFilePath: '/nonexistent/criteria.md',
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Some important email' },
            },
            reply
        );
        assert.equal(reply.statusCode, 500);
        assert.deepStrictEqual(reply.payload, {
            error: 'Page criteria file not found.',
        });
    } finally {
        cleanup();
    }
});

test('email-page: returns not page-worthy when AI says no', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'email-page-test-'));
    const criteriaPath = path.join(tmpDir, 'criteria.md');
    await writeFile(criteriaPath, '1. Server is on fire\n2. Data breach\n');

    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text: '{"page_worthy": false}',
            }),
        },
    };

    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        openaiClient: mockOpenai,
        criteriaFilePath: criteriaPath,
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Weekly newsletter about cats' },
            },
            reply
        );
        assert.equal(reply.statusCode, null); // default 200
        assert.deepStrictEqual(reply.payload, { page_worthy: false });
    } finally {
        cleanup();
        await rm(tmpDir, { recursive: true });
    }
});

test('email-page: pages primary caller when AI says page-worthy', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'email-page-test-'));
    const criteriaPath = path.join(tmpDir, 'criteria.md');
    await writeFile(criteriaPath, '1. Server is on fire\n2. Data breach\n');

    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    '{"page_worthy": true, "page_message": "ALERT: Server is down in us-east-1."}',
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

    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
        criteriaFilePath: criteriaPath,
        primaryNumbers: ['+12065550100', '+12065550101'],
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Server us-east-1 is completely down!' },
            },
            reply
        );
        assert.equal(reply.statusCode, null); // default 200
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.page_worthy, true);
        assert.equal(
            payload.page_message,
            'ALERT: Server is down in us-east-1.'
        );

        // Should have sent SMS to both primary numbers
        assert.equal(smsSent.length, 2);
        assert.equal(smsSent[0].to, '+12065550100');
        assert.equal(smsSent[1].to, '+12065550101');
        assert.match(smsSent[0].body, /ALERT: Server is down/);

        // Should have called the first primary number
        assert.equal(callsMade.length, 1);
        assert.equal(callsMade[0].to, '+12065550100');
        assert.match(callsMade[0].twiml, /Urgent page/);
        assert.match(callsMade[0].twiml, /ALERT: Server is down/);
    } finally {
        cleanup();
        await rm(tmpDir, { recursive: true });
    }
});

test('email-page: returns 500 when EMAIL_PAGE_SECRET is not set', async () => {
    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        secret: '',
    });
    try {
        // Unset the secret after loading (to simulate it not being configured)
        delete process.env.EMAIL_PAGE_SECRET;
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'anything' },
                body: { body: 'test' },
            },
            reply
        );
        assert.equal(reply.statusCode, 500);
        assert.deepStrictEqual(reply.payload, {
            error: 'Page endpoint not configured.',
        });
    } finally {
        cleanup();
    }
});

test('email-page: returns 500 when Twilio from number is not configured', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'email-page-test-'));
    const criteriaPath = path.join(tmpDir, 'criteria.md');
    await writeFile(criteriaPath, '1. Critical alert\n');

    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    '{"page_worthy": true, "page_message": "Test page."}',
            }),
        },
    };

    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        openaiClient: mockOpenai,
        criteriaFilePath: criteriaPath,
        fromNumber: '',
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Critical alert!' },
            },
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio from number not configured.');
    } finally {
        cleanup();
        await rm(tmpDir, { recursive: true });
    }
});

test('email-page: returns 500 when Twilio client is unavailable', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'email-page-test-'));
    const criteriaPath = path.join(tmpDir, 'criteria.md');
    await writeFile(criteriaPath, '1. Critical alert\n');

    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    '{"page_worthy": true, "page_message": "Test page."}',
            }),
        },
    };

    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        openaiClient: mockOpenai,
        twilioClient: null,
        criteriaFilePath: criteriaPath,
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Critical alert!' },
            },
            reply
        );
        assert.equal(reply.statusCode, 500);
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.error, 'Twilio client not configured.');
    } finally {
        cleanup();
        await rm(tmpDir, { recursive: true });
    }
});

test('email-page: handles AI response with markdown code fences', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'email-page-test-'));
    const criteriaPath = path.join(tmpDir, 'criteria.md');
    await writeFile(criteriaPath, '1. High severity\n');

    const mockOpenai = {
        responses: {
            create: async () => ({
                output_text:
                    '```json\n{"page_worthy": true, "page_message": "Wrapped response."}\n```',
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

    const { emailPageHandler, cleanup } = await loadEmailPageHandler({
        openaiClient: mockOpenai,
        twilioClient: mockTwilio,
        criteriaFilePath: criteriaPath,
    });
    try {
        const reply = createReply();
        await emailPageHandler(
            {
                headers: { 'x-email-page-secret': 'test-secret-key' },
                body: { body: 'Some critical issue.' },
            },
            reply
        );
        const payload = /** @type {Record<string, unknown>} */ (reply.payload);
        assert.equal(payload.page_worthy, true);
        assert.equal(payload.page_message, 'Wrapped response.');
        assert.equal(smsSent.length, 1);
        assert.equal(callsMade.length, 1);
    } finally {
        cleanup();
        await rm(tmpDir, { recursive: true });
    }
});
