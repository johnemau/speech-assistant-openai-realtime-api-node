import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import {
    normalizeSmsKeyword,
    isStartKeyword,
    isYesKeyword,
    isStopKeyword,
    isHelpKeyword,
    appendSmsConsentRecord,
    getSmsConsentStatus,
} from './sms-consent.js';

test('normalizeSmsKeyword normalizes case and spacing', () => {
    assert.equal(normalizeSmsKeyword('  start '), 'START');
    assert.equal(normalizeSmsKeyword('Yes'), 'YES');
});

test('keyword helpers match supported commands', () => {
    assert.equal(isStartKeyword('START'), true);
    assert.equal(isYesKeyword('YES'), true);
    assert.equal(isStopKeyword('STOP'), true);
    assert.equal(isHelpKeyword('HELP'), true);
    assert.equal(isHelpKeyword('INFO'), true);
    assert.equal(isStartKeyword('HELLO'), false);
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
