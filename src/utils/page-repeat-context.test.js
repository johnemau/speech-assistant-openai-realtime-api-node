import test from 'node:test';
import assert from 'node:assert/strict';
import {
    savePageMessage,
    readPageMessage,
    clearPageMessage,
    resetPageMessagesForTests,
} from './page-repeat-context.js';

test('savePageMessage + readPageMessage: stores and retrieves message by callSid', () => {
    resetPageMessagesForTests();
    savePageMessage('CA_abc123', 'Server is down');
    assert.equal(readPageMessage('CA_abc123'), 'Server is down');
});

test('readPageMessage: returns undefined for unknown callSid', () => {
    resetPageMessagesForTests();
    assert.equal(readPageMessage('CA_unknown'), undefined);
});

test('savePageMessage: overwrites existing message for same callSid', () => {
    resetPageMessagesForTests();
    savePageMessage('CA_1', 'first');
    savePageMessage('CA_1', 'second');
    assert.equal(readPageMessage('CA_1'), 'second');
});

test('savePageMessage: no-ops when callSid is empty', () => {
    resetPageMessagesForTests();
    savePageMessage('', 'msg');
    assert.equal(readPageMessage(''), undefined);
});

test('savePageMessage: no-ops when message is empty', () => {
    resetPageMessagesForTests();
    savePageMessage('CA_2', '');
    assert.equal(readPageMessage('CA_2'), undefined);
});

test('clearPageMessage: removes stored message and returns true', () => {
    resetPageMessagesForTests();
    savePageMessage('CA_3', 'alert');
    assert.equal(clearPageMessage('CA_3'), true);
    assert.equal(readPageMessage('CA_3'), undefined);
});

test('clearPageMessage: returns false when callSid not found', () => {
    resetPageMessagesForTests();
    assert.equal(clearPageMessage('CA_missing'), false);
});
