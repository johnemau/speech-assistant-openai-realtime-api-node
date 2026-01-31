import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const envModule = await import('../env.js');
const { execute } = await import('./send-email.js');

/**
 * Escape unsafe HTML characters in ASCII art.
 *
 * @param {string} value - ASCII art to escape.
 * @returns {string} Escaped ASCII art.
 */
const escapeAsciiArt = (value) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;');

test('send-email.execute blocks when side effects disabled', async () => {
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    envModule.setAllowSendEmail(false);
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { subject: 'Hi', body_html: '<p>Test</p>' },
                    context: {},
                }),
            /Email sending disabled/
        );
    } finally {
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute validates subject and body', async () => {
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    envModule.setAllowSendEmail(true);
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { subject: '', body_html: '<p>Test</p>' },
                    context: {},
                }),
            /Missing subject or body_html/
        );
    } finally {
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute errors when email not configured', async () => {
    const prevClients = { senderTransport: init.senderTransport };
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    const prevSecondary = new Set(envModule.SECONDARY_CALLERS_SET);
    const prevEnv = {
        SENDER_FROM_EMAIL: process.env.SENDER_FROM_EMAIL,
        PRIMARY_TO_EMAIL: process.env.PRIMARY_TO_EMAIL,
    };
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    process.env.SENDER_FROM_EMAIL = 'from@example.com';
    process.env.PRIMARY_TO_EMAIL = 'to@example.com';
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.SECONDARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    init.setInitClients({ senderTransport: null });
    envModule.setAllowSendEmail(true);
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { subject: 'Hi', body_html: '<p>Test</p>' },
                    context: {
                        currentCallerE164: '+12065550100',
                    },
                }),
            /Email is not configured/
        );
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        envModule.SECONDARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
        prevSecondary.forEach((value) =>
            envModule.SECONDARY_CALLERS_SET.add(value)
        );
        if (prevEnv.SENDER_FROM_EMAIL == null)
            delete process.env.SENDER_FROM_EMAIL;
        else process.env.SENDER_FROM_EMAIL = prevEnv.SENDER_FROM_EMAIL;
        if (prevEnv.PRIMARY_TO_EMAIL == null)
            delete process.env.PRIMARY_TO_EMAIL;
        else process.env.PRIMARY_TO_EMAIL = prevEnv.PRIMARY_TO_EMAIL;
        init.setInitClients(prevClients);
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute sends email for primary caller', async () => {
    let lastOptions = null;
    const senderTransport = {
        /**
         * @param {any} options - Nodemailer send options.
         * @returns {Promise<any>} Send result.
         */
        sendMail: async (options) => {
            lastOptions = options;
            return {
                messageId: 'mid',
                accepted: ['to@example.com'],
                rejected: [],
            };
        },
    };
    const prevClients = { senderTransport: init.senderTransport };
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    const prevSecondary = new Set(envModule.SECONDARY_CALLERS_SET);
    const prevEnv = {
        SENDER_FROM_EMAIL: process.env.SENDER_FROM_EMAIL,
        PRIMARY_TO_EMAIL: process.env.PRIMARY_TO_EMAIL,
    };
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    process.env.SENDER_FROM_EMAIL = 'from@example.com';
    process.env.PRIMARY_TO_EMAIL = 'to@example.com';
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.SECONDARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    init.setInitClients({ senderTransport });
    envModule.setAllowSendEmail(true);
    try {
        const res = await execute({
            args: { subject: 'Hello', body_html: '<p>Body</p>' },
            context: {
                currentCallerE164: '+12065550100',
            },
        });

        assert.equal(res.messageId, 'mid');
        if (!lastOptions) throw new Error('Missing sendMail options');
        const opts = /** @type {any} */ (lastOptions);
        assert.equal(opts.from, 'from@example.com');
        assert.equal(opts.to, 'to@example.com');
        assert.equal(opts.subject, 'Hello');
        assert.ok(
            opts.html.startsWith('<p>Body</p>'),
            'email body should include original HTML'
        );
        assert.ok(
            opts.html.includes('<pre>'),
            'email body should include ASCII art'
        );
        assert.equal(opts.headers['X-From-Ai-Assistant'], 'true');
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        envModule.SECONDARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
        prevSecondary.forEach((value) =>
            envModule.SECONDARY_CALLERS_SET.add(value)
        );
        if (prevEnv.SENDER_FROM_EMAIL == null)
            delete process.env.SENDER_FROM_EMAIL;
        else process.env.SENDER_FROM_EMAIL = prevEnv.SENDER_FROM_EMAIL;
        if (prevEnv.PRIMARY_TO_EMAIL == null)
            delete process.env.PRIMARY_TO_EMAIL;
        else process.env.PRIMARY_TO_EMAIL = prevEnv.PRIMARY_TO_EMAIL;
        init.setInitClients(prevClients);
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute uses provided ascii_art when valid', async () => {
    const prevRandom = Math.random;
    let lastOptions = null;
    const senderTransport = {
        /**
         * @param {any} options - Nodemailer send options.
         * @returns {Promise<any>} Send result.
         */
        sendMail: async (options) => {
            lastOptions = options;
            return {
                messageId: 'mid',
                accepted: ['to@example.com'],
                rejected: [],
            };
        },
    };
    const prevClients = { senderTransport: init.senderTransport };
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    const prevSecondary = new Set(envModule.SECONDARY_CALLERS_SET);
    const prevEnv = {
        SENDER_FROM_EMAIL: process.env.SENDER_FROM_EMAIL,
        PRIMARY_TO_EMAIL: process.env.PRIMARY_TO_EMAIL,
    };
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    process.env.SENDER_FROM_EMAIL = 'from@example.com';
    process.env.PRIMARY_TO_EMAIL = 'to@example.com';
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.SECONDARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    init.setInitClients({ senderTransport });
    envModule.setAllowSendEmail(true);
    Math.random = () => 0.9;
    try {
        const asciiArt = String.raw` /\_/\\
<&>`;
        const res = await execute({
            args: {
                subject: 'Hello',
                body_html: '<p>Body</p>',
                ascii_art: asciiArt,
            },
            context: {
                currentCallerE164: '+12065550100',
            },
        });

        assert.equal(res.messageId, 'mid');
        if (!lastOptions) throw new Error('Missing sendMail options');
        const opts = /** @type {any} */ (lastOptions);
        const expectedArt = escapeAsciiArt(asciiArt);
        assert.ok(
            opts.html.includes(`<pre>${expectedArt}</pre>`),
            'email body should include provided ASCII art'
        );
        assert.ok(
            !opts.html.includes('<&>'),
            'email body should escape unsafe ASCII art'
        );
    } finally {
        Math.random = prevRandom;
        envModule.PRIMARY_CALLERS_SET.clear();
        envModule.SECONDARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
        prevSecondary.forEach((value) =>
            envModule.SECONDARY_CALLERS_SET.add(value)
        );
        if (prevEnv.SENDER_FROM_EMAIL == null)
            delete process.env.SENDER_FROM_EMAIL;
        else process.env.SENDER_FROM_EMAIL = prevEnv.SENDER_FROM_EMAIL;
        if (prevEnv.PRIMARY_TO_EMAIL == null)
            delete process.env.PRIMARY_TO_EMAIL;
        else process.env.PRIMARY_TO_EMAIL = prevEnv.PRIMARY_TO_EMAIL;
        init.setInitClients(prevClients);
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute falls back to random art when omitted', async () => {
    const prevRandom = Math.random;
    let lastOptions = null;
    const senderTransport = {
        /**
         * @param {any} options - Nodemailer send options.
         * @returns {Promise<any>} Send result.
         */
        sendMail: async (options) => {
            lastOptions = options;
            return {
                messageId: 'mid',
                accepted: ['to@example.com'],
                rejected: [],
            };
        },
    };
    const prevClients = { senderTransport: init.senderTransport };
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    const prevSecondary = new Set(envModule.SECONDARY_CALLERS_SET);
    const prevEnv = {
        SENDER_FROM_EMAIL: process.env.SENDER_FROM_EMAIL,
        PRIMARY_TO_EMAIL: process.env.PRIMARY_TO_EMAIL,
    };
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    process.env.SENDER_FROM_EMAIL = 'from@example.com';
    process.env.PRIMARY_TO_EMAIL = 'to@example.com';
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.SECONDARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    init.setInitClients({ senderTransport });
    envModule.setAllowSendEmail(true);
    Math.random = () => 0;
    try {
        const res = await execute({
            args: { subject: 'Hello', body_html: '<p>Body</p>' },
            context: {
                currentCallerE164: '+12065550100',
            },
        });

        assert.equal(res.messageId, 'mid');
        if (!lastOptions) throw new Error('Missing sendMail options');
        const opts = /** @type {any} */ (lastOptions);
        const expectedArt = escapeAsciiArt(' /\\_/\\\\\n( o.o )\n > ^ <');
        assert.ok(
            opts.html.includes(`<pre>${expectedArt}</pre>`),
            'email body should include fallback ASCII art'
        );
    } finally {
        Math.random = prevRandom;
        envModule.PRIMARY_CALLERS_SET.clear();
        envModule.SECONDARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
        prevSecondary.forEach((value) =>
            envModule.SECONDARY_CALLERS_SET.add(value)
        );
        if (prevEnv.SENDER_FROM_EMAIL == null)
            delete process.env.SENDER_FROM_EMAIL;
        else process.env.SENDER_FROM_EMAIL = prevEnv.SENDER_FROM_EMAIL;
        if (prevEnv.PRIMARY_TO_EMAIL == null)
            delete process.env.PRIMARY_TO_EMAIL;
        else process.env.PRIMARY_TO_EMAIL = prevEnv.PRIMARY_TO_EMAIL;
        init.setInitClients(prevClients);
        envModule.setAllowSendEmail(prevAllow);
    }
});

test('send-email.execute falls back when ascii_art exceeds limits', async () => {
    const prevRandom = Math.random;
    let lastOptions = null;
    const senderTransport = {
        /**
         * @param {any} options - Nodemailer send options.
         * @returns {Promise<any>} Send result.
         */
        sendMail: async (options) => {
            lastOptions = options;
            return {
                messageId: 'mid',
                accepted: ['to@example.com'],
                rejected: [],
            };
        },
    };
    const prevClients = { senderTransport: init.senderTransport };
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    const prevSecondary = new Set(envModule.SECONDARY_CALLERS_SET);
    const prevEnv = {
        SENDER_FROM_EMAIL: process.env.SENDER_FROM_EMAIL,
        PRIMARY_TO_EMAIL: process.env.PRIMARY_TO_EMAIL,
    };
    const prevAllow = envModule.ALLOW_SEND_EMAIL;
    process.env.SENDER_FROM_EMAIL = 'from@example.com';
    process.env.PRIMARY_TO_EMAIL = 'to@example.com';
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.SECONDARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    init.setInitClients({ senderTransport });
    envModule.setAllowSendEmail(true);
    Math.random = () => 0;
    try {
        const oversizedArt = Array.from({ length: 7 }, () => 'x').join('\n');
        const res = await execute({
            args: {
                subject: 'Hello',
                body_html: '<p>Body</p>',
                ascii_art: oversizedArt,
            },
            context: {
                currentCallerE164: '+12065550100',
            },
        });

        assert.equal(res.messageId, 'mid');
        if (!lastOptions) throw new Error('Missing sendMail options');
        const opts = /** @type {any} */ (lastOptions);
        const expectedArt = escapeAsciiArt(' /\\_/\\\\\n( o.o )\n > ^ <');
        assert.ok(
            opts.html.includes(`<pre>${expectedArt}</pre>`),
            'email body should fall back to random ASCII art'
        );
        assert.ok(
            !opts.html.includes(oversizedArt),
            'email body should not include oversized ASCII art'
        );
    } finally {
        Math.random = prevRandom;
        envModule.PRIMARY_CALLERS_SET.clear();
        envModule.SECONDARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
        prevSecondary.forEach((value) =>
            envModule.SECONDARY_CALLERS_SET.add(value)
        );
        if (prevEnv.SENDER_FROM_EMAIL == null)
            delete process.env.SENDER_FROM_EMAIL;
        else process.env.SENDER_FROM_EMAIL = prevEnv.SENDER_FROM_EMAIL;
        if (prevEnv.PRIMARY_TO_EMAIL == null)
            delete process.env.PRIMARY_TO_EMAIL;
        else process.env.PRIMARY_TO_EMAIL = prevEnv.PRIMARY_TO_EMAIL;
        init.setInitClients(prevClients);
        envModule.setAllowSendEmail(prevAllow);
    }
});
