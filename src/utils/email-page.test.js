import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const {
    readPageCriteriaFile,
    buildPageEvaluationPrompt,
    getPrimaryCallerNumbers,
    parsePageEvaluation,
} = await import('./email-page.js');

// --- readPageCriteriaFile ---

test('readPageCriteriaFile: reads file at given path', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ep-util-'));
    const filePath = path.join(tmpDir, 'criteria.md');
    await writeFile(filePath, '1. Server down\n2. Data breach\n');
    try {
        const content = await readPageCriteriaFile(filePath);
        assert.equal(content, '1. Server down\n2. Data breach\n');
    } finally {
        await rm(tmpDir, { recursive: true });
    }
});

test('readPageCriteriaFile: throws when file does not exist', async () => {
    await assert.rejects(() => readPageCriteriaFile('/nonexistent/file.md'), {
        code: 'ENOENT',
    });
});

test('readPageCriteriaFile: falls back to env when no path given', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ep-util-'));
    const filePath = path.join(tmpDir, 'env-criteria.md');
    await writeFile(filePath, 'env criteria content');
    const prev = process.env.EMAIL_PAGE_CRITERIA_FILE_PATH;
    process.env.EMAIL_PAGE_CRITERIA_FILE_PATH = filePath;
    try {
        const content = await readPageCriteriaFile();
        assert.equal(content, 'env criteria content');
    } finally {
        if (prev == null) delete process.env.EMAIL_PAGE_CRITERIA_FILE_PATH;
        else process.env.EMAIL_PAGE_CRITERIA_FILE_PATH = prev;
        await rm(tmpDir, { recursive: true });
    }
});

// --- buildPageEvaluationPrompt ---

test('buildPageEvaluationPrompt: includes criteria and email content', () => {
    const prompt = buildPageEvaluationPrompt({
        emailContent: 'Server is on fire!',
        criteria: '1. Outage\n2. Security breach',
    });
    assert.match(prompt, /Page Criteria/);
    assert.match(prompt, /1\. Outage/);
    assert.match(prompt, /Server is on fire!/);
    assert.match(prompt, /page_worthy/);
    assert.match(prompt, /page_message/);
});

test('buildPageEvaluationPrompt: returns a string', () => {
    const prompt = buildPageEvaluationPrompt({
        emailContent: 'test',
        criteria: 'test',
    });
    assert.equal(typeof prompt, 'string');
    assert.ok(prompt.length > 0);
});

// --- parsePageEvaluation ---

test('parsePageEvaluation: parses plain JSON', () => {
    const result = parsePageEvaluation(
        '{"page_worthy": true, "page_message": "Alert!"}'
    );
    assert.equal(result.page_worthy, true);
    assert.equal(result.page_message, 'Alert!');
});

test('parsePageEvaluation: parses not page-worthy', () => {
    const result = parsePageEvaluation('{"page_worthy": false}');
    assert.equal(result.page_worthy, false);
});

test('parsePageEvaluation: strips markdown code fences', () => {
    const result = parsePageEvaluation(
        '```json\n{"page_worthy": true, "page_message": "Wrapped"}\n```'
    );
    assert.equal(result.page_worthy, true);
    assert.equal(result.page_message, 'Wrapped');
});

test('parsePageEvaluation: throws on invalid JSON', () => {
    assert.throws(() => parsePageEvaluation('not json'), {
        name: 'SyntaxError',
    });
});

// --- getPrimaryCallerNumbers ---

test('getPrimaryCallerNumbers: returns numbers from env', () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '+12065550100,+12065550101';
    try {
        const numbers = getPrimaryCallerNumbers();
        assert.deepStrictEqual(numbers, ['+12065550100', '+12065550101']);
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});

test('getPrimaryCallerNumbers: returns empty array when env is empty and set is empty', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '';
    const env = await import('../env.js');
    const savedEntries = [...env.PRIMARY_CALLERS_SET];
    env.PRIMARY_CALLERS_SET.clear();
    try {
        const numbers = getPrimaryCallerNumbers();
        assert.deepStrictEqual(numbers, []);
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
        savedEntries.forEach((v) => env.PRIMARY_CALLERS_SET.add(v));
    }
});
