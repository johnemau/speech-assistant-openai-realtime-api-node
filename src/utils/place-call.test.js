import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const { placeCall } = await import('./place-call.js');

test('placeCall: places call and returns sid/status', async () => {
    /** @type {any[]} */
    const calls = [];
    const mockClient = {
        calls: {
            create: async (/** @type {any} */ params) => {
                calls.push(params);
                return { sid: 'CA123', status: 'queued' };
            },
        },
    };
    const result = await placeCall({
        twiml: '<Response><Say>Hello</Say></Response>',
        toNumber: '+12065550100',
        fromNumber: '+15550001234',
        client: mockClient,
    });
    assert.equal(result.to, '+12065550100');
    assert.equal(result.sid, 'CA123');
    assert.equal(result.status, 'queued');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].from, '+15550001234');
    assert.equal(calls[0].to, '+12065550100');
    assert.equal(calls[0].twiml, '<Response><Say>Hello</Say></Response>');
});

test('placeCall: captures errors gracefully', async () => {
    const mockClient = {
        calls: {
            create: async () => {
                throw new Error('network error');
            },
        },
    };
    const result = await placeCall({
        twiml: '<Response><Say>Hello</Say></Response>',
        toNumber: '+12065550100',
        fromNumber: '+15550001234',
        client: mockClient,
    });
    assert.equal(result.to, '+12065550100');
    assert.equal(result.error, 'network error');
    assert.equal(result.sid, undefined);
});
