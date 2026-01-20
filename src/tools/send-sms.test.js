import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const { execute } = await import('./send-sms.js');

test('send-sms.execute blocks when side effects disabled', async () => {
    await assert.rejects(() => execute({
        args: { body_text: 'Hi' },
        context: { allowLiveSideEffects: false }
    }), /Live side effects disabled/);
});

test('send-sms.execute validates body', async () => {
    await assert.rejects(() => execute({
        args: { body_text: '   ' },
        context: { allowLiveSideEffects: true }
    }), /Missing body_text/);
});

test('send-sms.execute errors without Twilio client', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({ twilioClient: null });
    try {
        await assert.rejects(() => execute({
            args: { body_text: 'Hi' },
            context: {
                allowLiveSideEffects: true,
                currentCallerE164: '+12065550100'
            }
        }), /Twilio client unavailable/);
    } finally {
        init.setInitClients(prevClients);
    }
});

test('send-sms.execute errors without to/from numbers', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    const prevEnv = { TWILIO_SMS_FROM_NUMBER: process.env.TWILIO_SMS_FROM_NUMBER };
    if (process.env.TWILIO_SMS_FROM_NUMBER != null) delete process.env.TWILIO_SMS_FROM_NUMBER;
    init.setInitClients({ twilioClient: { messages: { create: async () => ({}) } } });
    try {
        await assert.rejects(() => execute({
            args: { body_text: 'Hi' },
            context: {
                allowLiveSideEffects: true,
                currentCallerE164: null,
                currentTwilioNumberE164: null
            }
        }), /SMS is not configured/);
    } finally {
        if (prevEnv.TWILIO_SMS_FROM_NUMBER == null) delete process.env.TWILIO_SMS_FROM_NUMBER;
        else process.env.TWILIO_SMS_FROM_NUMBER = prevEnv.TWILIO_SMS_FROM_NUMBER;
        init.setInitClients(prevClients);
    }
});

test('send-sms.execute sends trimmed text and returns metadata', async () => {
    let lastOptions = null;
    const twilioClient = {
        messages: {
            create: async (options) => {
                lastOptions = options;
                return { sid: 'sid', status: 'sent' };
            }
        }
    };
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({ twilioClient });
    try {
        const res = await execute({
            args: { body_text: ' Hello   world  ' },
            context: {
                allowLiveSideEffects: true,
                currentCallerE164: '+12065550100',
                currentTwilioNumberE164: '+12065550111'
            }
        });

        if (!lastOptions) throw new Error('Missing message options');
        const opts = /** @type {any} */ (lastOptions);
        assert.equal(opts.from, '+12065550111');
        assert.equal(opts.to, '+12065550100');
        assert.equal(opts.body, 'Hello world');
        assert.equal(res.length, 'Hello world'.length);
    } finally {
        init.setInitClients(prevClients);
    }
});
