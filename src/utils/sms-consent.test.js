import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import {
    normalizeSmsKeyword,
    isStartKeyword,
    isStopKeyword,
    isHelpKeyword,
    appendSmsConsentRecord,
    getSmsConsentStatus,
    getPendingQuestion,
    setPendingQuestion,
    clearPendingQuestion,
} from './sms-consent.js';

test('normalizeSmsKeyword normalizes case and spacing', () => {
    assert.equal(normalizeSmsKeyword('  start '), 'START');
    assert.equal(normalizeSmsKeyword('Yes'), 'YES');
});

test('keyword helpers match supported commands', () => {
    // Opt-in keywords
    assert.equal(isStartKeyword('START'), true);
    assert.equal(isStartKeyword('UNSTOP'), true);
    assert.equal(isStartKeyword('YES'), true);

    // Opt-out keywords
    assert.equal(isStopKeyword('STOP'), true);
    assert.equal(isStopKeyword('CANCEL'), true);
    assert.equal(isStopKeyword('END'), true);
    assert.equal(isStopKeyword('OPTOUT'), true);
    assert.equal(isStopKeyword('QUIT'), true);
    assert.equal(isStopKeyword('REVOKE'), true);
    assert.equal(isStopKeyword('STOPALL'), true);
    assert.equal(isStopKeyword('UNSUBSCRIBE'), true);

    // Help keywords
    assert.equal(isHelpKeyword('HELP'), true);
    assert.equal(isHelpKeyword('INFO'), true);

    // Non-keywords
    assert.equal(isStartKeyword('HELLO'), false);
    assert.equal(isStopKeyword('HELLO'), false);
    assert.equal(isHelpKeyword('HELLO'), false);
});

test('getSmsConsentStatus returns latest status for a phone number', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'sms-consent-'));
    const recordsPath = path.join(tmpDir, 'records.jsonl');

    try {
        await appendSmsConsentRecord(
            {
                phoneNumber: '+12065550100',
                keyword: 'START',
                status: 'pending',
                timestamp: '2026-03-03T00:00:00.000Z',
            },
            recordsPath
        );
        await appendSmsConsentRecord(
            {
                phoneNumber: '+12065550100',
                keyword: 'YES',
                status: 'confirmed',
                timestamp: '2026-03-03T00:00:01.000Z',
            },
            recordsPath
        );
        await appendSmsConsentRecord(
            {
                phoneNumber: '+14255550101',
                keyword: 'STOP',
                status: 'opted_out',
                timestamp: '2026-03-03T00:00:02.000Z',
            },
            recordsPath
        );

        const firstStatus = await getSmsConsentStatus(
            '+12065550100',
            recordsPath
        );
        const secondStatus = await getSmsConsentStatus(
            '+14255550101',
            recordsPath
        );
        const missingStatus = await getSmsConsentStatus(
            '+19995550199',
            recordsPath
        );

        assert.equal(firstStatus, 'confirmed');
        assert.equal(secondStatus, 'opted_out');
        assert.equal(missingStatus, null);
    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('pending questions are stored and retrieved in-memory', () => {
    const phone = '+12065550100';
    const question = 'What is the weather today?';

    // Initially no question
    assert.equal(getPendingQuestion(phone), undefined);

    // Set a question
    setPendingQuestion(phone, question);
    assert.equal(getPendingQuestion(phone), question);

    // Clear the question
    const wasCleared = clearPendingQuestion(phone);
    assert.equal(wasCleared, true);
    assert.equal(getPendingQuestion(phone), undefined);

    // Clearing again returns false
    const wasNotCleared = clearPendingQuestion(phone);
    assert.equal(wasNotCleared, false);
});

test('pending questions are separate for different phone numbers', () => {
    const phone1 = '+12065550100';
    const phone2 = '+14255550101';
    const question1 = 'Question 1';
    const question2 = 'Question 2';

    setPendingQuestion(phone1, question1);
    setPendingQuestion(phone2, question2);

    assert.equal(getPendingQuestion(phone1), question1);
    assert.equal(getPendingQuestion(phone2), question2);

    clearPendingQuestion(phone1);
    assert.equal(getPendingQuestion(phone1), undefined);
    assert.equal(getPendingQuestion(phone2), question2);
});
