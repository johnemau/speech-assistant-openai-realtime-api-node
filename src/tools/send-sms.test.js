import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const envModule = await import('../env.js');
const { execute } = await import('./send-sms.js');

test('send-sms.execute blocks when side effects disabled', async () => {
    const prevAllow = envModule.ALLOW_SEND_SMS;
    envModule.setAllowSendSms(false);
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { body_text: 'Hi' },
                    context: {},
                }),
            /SMS sending disabled/
        );
    } finally {
        envModule.setAllowSendSms(prevAllow);
    }
});

test('send-sms.execute validates body', async () => {
    const prevAllow = envModule.ALLOW_SEND_SMS;
    envModule.setAllowSendSms(true);
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { body_text: '   ' },
                    context: {},
                }),
            /Missing body_text/
        );
    } finally {
        envModule.setAllowSendSms(prevAllow);
    }
});

test('send-sms.execute errors without Twilio client', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    const prevAllow = envModule.ALLOW_SEND_SMS;
    envModule.setAllowSendSms(true);
    init.setInitClients({ twilioClient: null });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { body_text: 'Hi' },
                    context: {
                        currentCallerE164: '+12065550100',
                    },
                }),
            /Twilio client unavailable/
        );
    } finally {
        init.setInitClients(prevClients);
        envModule.setAllowSendSms(prevAllow);
    }
});

test('send-sms.execute errors without to/from numbers', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    const prevEnv = {
        TWILIO_SMS_FROM_NUMBER: process.env.TWILIO_SMS_FROM_NUMBER,
    };
    const prevAllow = envModule.ALLOW_SEND_SMS;
    envModule.setAllowSendSms(true);
    if (process.env.TWILIO_SMS_FROM_NUMBER != null)
        delete process.env.TWILIO_SMS_FROM_NUMBER;
    init.setInitClients({
        twilioClient: { messages: { create: async () => ({}) } },
    });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { body_text: 'Hi' },
                    context: {
                        currentCallerE164: null,
                        currentTwilioNumberE164: null,
                    },
                }),
            /SMS is not configured/
        );
    } finally {
        if (prevEnv.TWILIO_SMS_FROM_NUMBER == null)
            delete process.env.TWILIO_SMS_FROM_NUMBER;
        else
            process.env.TWILIO_SMS_FROM_NUMBER = prevEnv.TWILIO_SMS_FROM_NUMBER;
        init.setInitClients(prevClients);
        envModule.setAllowSendSms(prevAllow);
    }
});

test('send-sms.execute sends trimmed text and returns metadata', async () => {
    let lastOptions = null;
    const twilioClient = {
        messages: {
            /** @param {any} options */
            create: async (options) => {
                lastOptions = options;
                return { sid: 'sid', status: 'sent' };
            },
        },
    };
    const prevClients = { twilioClient: init.twilioClient };
    const prevAllow = envModule.ALLOW_SEND_SMS;
    envModule.setAllowSendSms(true);
    init.setInitClients({ twilioClient });
    try {
        const res = await execute({
            args: { body_text: ' Hello   world  ' },
            context: {
                currentCallerE164: '+12065550100',
                currentTwilioNumberE164: '+12065550111',
            },
        });

        if (!lastOptions) throw new Error('Missing message options');
        const opts = /** @type {any} */ (lastOptions);
        assert.equal(opts.from, '+12065550111');
        assert.equal(opts.to, '+12065550100');
        assert.equal(opts.body, 'Hello world');
        assert.equal(res.length, 'Hello world'.length);
    } finally {
        init.setInitClients(prevClients);
        envModule.setAllowSendSms(prevAllow);
    }
});
