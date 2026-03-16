import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const { sendSms } = await import('./send-sms.js');

test('sendSms: sends a single SMS with correct params', async () => {
    /** @type {any} */
    let captured;
    const mockClient = {
        messages: {
            create: async (/** @type {any} */ params) => {
                captured = params;
                return { sid: 'SM123', status: 'queued' };
            },
        },
    };
    const result = await sendSms({
        to: '+12065550100',
        from: '+15550001234',
        body: 'Hello test',
        client: mockClient,
    });
    assert.equal(result.sid, 'SM123');
    assert.equal(result.status, 'queued');
    assert.equal(captured.to, '+12065550100');
    assert.equal(captured.from, '+15550001234');
    assert.equal(captured.body, 'Hello test');
});

test('sendSms: propagates errors', async () => {
    const mockClient = {
        messages: {
            create: async () => {
                throw new Error('network failure');
            },
        },
    };
    await assert.rejects(
        () =>
            sendSms({
                to: '+12065550100',
                from: '+15550001234',
                body: 'fail',
                client: mockClient,
            }),
        { message: 'network failure' }
    );
});
