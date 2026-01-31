import test from 'node:test';
import assert from 'node:assert/strict';

import {
    extractSmsRequest,
    mergeAndSortMessages,
    buildSmsThreadText,
    buildSmsContextSection,
    buildSmsPrompt,
} from './sms.js';

test('sms.extractSmsRequest extracts fields and normalizes', () => {
    /**
     * @param {string} input - Raw phone number input.
     * @returns {string | null} Normalized E.164 number.
     */
    const normalizeUSNumberToE164 = (input) =>
        input ? '+1' + input.replace(/\D/g, '') : null;
    const body = {
        Body: 'Hello',
        From: '(206) 555-0100',
        To: '425-555-0101',
    };

    const out = extractSmsRequest({ body, normalizeUSNumberToE164 });
    assert.equal(out.bodyRaw, 'Hello');
    assert.equal(out.fromRaw, '(206) 555-0100');
    assert.equal(out.toRaw, '425-555-0101');
    assert.equal(out.fromE164, '+12065550100');
    assert.equal(out.toE164, '+14255550101');
});

test('sms.mergeAndSortMessages sorts by newest date', () => {
    const inbound = [{ dateCreated: '2020-01-01T00:00:00Z', body: 'old' }];
    const outbound = [{ dateSent: '2020-01-02T00:00:00Z', body: 'new' }];
    const out = mergeAndSortMessages(inbound, outbound);
    assert.equal(out[0].body, 'new');
    assert.equal(out[1].body, 'old');
});

test('sms.buildSmsThreadText formats labels and limits', () => {
    const messages = [
        { dateSent: '2020-01-02T00:00:00Z', from: '+12065550100', body: 'Hi' },
        {
            dateSent: '2020-01-01T00:00:00Z',
            from: '+12065550199',
            body: 'Hello',
        },
    ];
    const text = buildSmsThreadText({
        messages,
        fromE164: '+12065550100',
        limit: 1,
    });
    assert.ok(text.includes('User'));
    assert.ok(text.includes('Hi'));
    assert.ok(!text.includes('Hello'));
});

test('sms.buildSmsPrompt includes context, thread, and latest message', () => {
    const out = buildSmsPrompt({
        threadText: 'Thread',
        latestMessage: 'Latest',
        contextSection: 'Current time: Test\nEstimated location: Test',
    });
    assert.ok(out.includes('Current time:'));
    assert.ok(out.includes('Estimated location:'));
    assert.ok(out.includes('Thread'));
    assert.ok(out.includes('Latest'));
});

test('sms.buildSmsContextSection returns labeled context', async () => {
    const out = await buildSmsContextSection({ callerE164: null });
    assert.ok(out.includes('Current time:'));
    assert.ok(out.includes('Estimated location:'));
});
