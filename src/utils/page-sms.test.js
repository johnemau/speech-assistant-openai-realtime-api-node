import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const { sendPageSms } = await import('./page-sms.js');

test('sendPageSms: sends SMS to all primary numbers', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '+12065550100,+12065550101';
    /** @type {any[]} */
    const sent = [];
    const mockClient = {
        messages: {
            create: async (/** @type {any} */ params) => {
                sent.push(params);
                return { sid: 'SM1', status: 'queued' };
            },
        },
    };
    try {
        const results = await sendPageSms({
            pageMessage: 'Test page',
            fromNumber: '+15550001234',
            client: mockClient,
        });
        assert.equal(results.length, 2);
        assert.equal(results[0].to, '+12065550100');
        assert.equal(results[0].sid, 'SM1');
        assert.equal(results[1].to, '+12065550101');
        assert.equal(sent.length, 2);
        assert.equal(sent[0].body, 'Test page');
        assert.equal(sent[0].from, '+15550001234');
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});

test('sendPageSms: captures errors per number', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '+12065550100';
    const mockClient = {
        messages: {
            create: async () => {
                throw new Error('send failed');
            },
        },
    };
    try {
        const results = await sendPageSms({
            pageMessage: 'Fail test',
            fromNumber: '+15550001234',
            client: mockClient,
        });
        assert.equal(results.length, 1);
        assert.equal(results[0].error, 'send failed');
        assert.equal(results[0].to, '+12065550100');
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});
