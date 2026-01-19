import test from 'node:test';
import assert from 'node:assert/strict';

import { execute } from './send-email.js';

test('send-email.execute blocks when side effects disabled', async () => {
    await assert.rejects(() => execute({
        args: { subject: 'Hi', body_html: '<p>Test</p>' },
        context: { allowLiveSideEffects: false }
    }), /Live side effects disabled/);
});

test('send-email.execute validates subject and body', async () => {
    await assert.rejects(() => execute({
        args: { subject: '', body_html: '<p>Test</p>' },
        context: { allowLiveSideEffects: true }
    }), /Missing subject or body_html/);
});

test('send-email.execute errors when email not configured', async () => {
    await assert.rejects(() => execute({
        args: { subject: 'Hi', body_html: '<p>Test</p>' },
        context: {
            allowLiveSideEffects: true,
            senderTransport: null,
            env: { SENDER_FROM_EMAIL: 'from@example.com', PRIMARY_TO_EMAIL: 'to@example.com' },
            primaryCallersSet: new Set(['+12065550100']),
            currentCallerE164: '+12065550100'
        }
    }), /Email is not configured/);
});

test('send-email.execute sends email for primary caller', async () => {
    let lastOptions = null;
    const senderTransport = {
        sendMail: async (options) => {
            lastOptions = options;
            return { messageId: 'mid', accepted: ['to@example.com'], rejected: [] };
        }
    };
    const res = await execute({
        args: { subject: 'Hello', body_html: '<p>Body</p>' },
        context: {
            allowLiveSideEffects: true,
            senderTransport,
            env: { SENDER_FROM_EMAIL: 'from@example.com', PRIMARY_TO_EMAIL: 'to@example.com' },
            primaryCallersSet: new Set(['+12065550100']),
            secondaryCallersSet: new Set(),
            currentCallerE164: '+12065550100'
        }
    });

    assert.equal(res.messageId, 'mid');
    if (!lastOptions) throw new Error('Missing sendMail options');
    const opts = /** @type {any} */ (lastOptions);
    assert.equal(opts.from, 'from@example.com');
    assert.equal(opts.to, 'to@example.com');
    assert.equal(opts.subject, 'Hello');
    assert.equal(opts.html, '<p>Body</p>');
    assert.equal(opts.headers['X-From-Ai-Assistant'], 'true');
});
