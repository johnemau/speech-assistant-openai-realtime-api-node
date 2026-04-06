import test from 'node:test';
import assert from 'node:assert/strict';
import {
    savePendingMessage,
    readPendingMessage,
    clearPendingMessage,
    resetPendingMessagesForTests,
} from './pending-messages.js';

test('savePendingMessage + readPendingMessage: stores and retrieves message by callSid', () => {
    resetPendingMessagesForTests();
    savePendingMessage('CA_abc123', 'Server is down');
    assert.equal(readPendingMessage('CA_abc123'), 'Server is down');
});

test('readPendingMessage: returns undefined for unknown callSid', () => {
    resetPendingMessagesForTests();
    assert.equal(readPendingMessage('CA_unknown'), undefined);
});

test('savePendingMessage: overwrites existing message for same callSid', () => {
    resetPendingMessagesForTests();
    savePendingMessage('CA_1', 'first');
    savePendingMessage('CA_1', 'second');
    assert.equal(readPendingMessage('CA_1'), 'second');
});

test('savePendingMessage: no-ops when callSid is empty', () => {
    resetPendingMessagesForTests();
    savePendingMessage('', 'msg');
    assert.equal(readPendingMessage(''), undefined);
});

test('savePendingMessage: no-ops when message is empty', () => {
    resetPendingMessagesForTests();
    savePendingMessage('CA_2', '');
    assert.equal(readPendingMessage('CA_2'), undefined);
});

test('clearPendingMessage: removes stored message and returns true', () => {
    resetPendingMessagesForTests();
    savePendingMessage('CA_3', 'alert');
    assert.equal(clearPendingMessage('CA_3'), true);
    assert.equal(readPendingMessage('CA_3'), undefined);
});

test('clearPendingMessage: returns false when callSid not found', () => {
    resetPendingMessagesForTests();
    assert.equal(clearPendingMessage('CA_missing'), false);
});
