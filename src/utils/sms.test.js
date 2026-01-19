import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSmsRequest, mergeAndSortMessages, buildSmsThreadText, buildSmsPrompt } from './sms.js';

test('sms.extractSmsRequest extracts fields and normalizes', () => {
    const normalizeUSNumberToE164 = (input) => (input ? '+1' + input.replace(/\D/g, '') : null);
    const body = {
        Body: 'Hello',
        From: '(206) 555-0100',
        To: '425-555-0101'
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
        { dateSent: '2020-01-01T00:00:00Z', from: '+12065550199', body: 'Hello' },
    ];
    const text = buildSmsThreadText({ messages, fromE164: '+12065550100', limit: 1 });
    assert.ok(text.includes('User'));
    assert.ok(text.includes('Hi'));
    assert.ok(!text.includes('Hello'));
});

test('sms.buildSmsPrompt includes thread and latest message', () => {
    const out = buildSmsPrompt({ threadText: 'Thread', latestMessage: 'Latest' });
    assert.ok(out.includes('Thread'));
    assert.ok(out.includes('Latest'));
});
