import test from 'node:test';
import assert from 'node:assert/strict';

import { execute } from './send-sms.js';

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
    await assert.rejects(() => execute({
        args: { body_text: 'Hi' },
        context: {
            allowLiveSideEffects: true,
            twilioClient: null,
            currentCallerE164: '+12065550100'
        }
    }), /Twilio client unavailable/);
});

test('send-sms.execute errors without to/from numbers', async () => {
    await assert.rejects(() => execute({
        args: { body_text: 'Hi' },
        context: {
            allowLiveSideEffects: true,
            twilioClient: { messages: { create: async () => ({}) } },
            currentCallerE164: null,
            currentTwilioNumberE164: null,
            env: {}
        }
    }), /SMS is not configured/);
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
    const res = await execute({
        args: { body_text: ' Hello   world  ' },
        context: {
            allowLiveSideEffects: true,
            twilioClient,
            currentCallerE164: '+12065550100',
            currentTwilioNumberE164: '+12065550111',
            env: {}
        }
    });

    if (!lastOptions) throw new Error('Missing message options');
    const opts = /** @type {any} */ (lastOptions);
    assert.equal(opts.from, '+12065550111');
    assert.equal(opts.to, '+12065550100');
    assert.equal(opts.body, 'Hello world');
    assert.equal(res.length, 'Hello world'.length);
});
