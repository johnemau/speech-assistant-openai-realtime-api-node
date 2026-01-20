import test from 'node:test';
import assert from 'node:assert/strict';

import { safeParseToolArguments, createAssistantSession } from './session.js';

test('assistant.safeParseToolArguments handles null and objects', () => {
    assert.deepEqual(safeParseToolArguments(null), {});
    const obj = { a: 1 };
    assert.deepEqual(safeParseToolArguments(obj), obj);
});

test('assistant.safeParseToolArguments parses JSON and JSON5', () => {
    const json = '{"a": 1}';
    const json5 = "{a: 2, b: 'text'}";
    assert.deepEqual(safeParseToolArguments(json), { a: 1 });
    assert.deepEqual(safeParseToolArguments(json5), { a: 2, b: 'text' });
});

test('assistant.safeParseToolArguments repairs smart quotes and trailing commas', () => {
    const input = "{“a”: '1', b: 2,}";
    assert.deepEqual(safeParseToolArguments(input), { a: '1', b: 2 });
});

test('assistant.safeParseToolArguments handles newlines', () => {
    const input = `{a: 'line1\nline2'}`;
    assert.deepEqual(safeParseToolArguments(input), { a: 'line1\nline2' });
});

test('assistant.safeParseToolArguments throws on unparseable input', () => {
    assert.throws(() => safeParseToolArguments('not a json'));
});

test('assistant.createAssistantSession throws without api key', () => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = '';
    try {
        assert.throws(() => createAssistantSession({}), /Missing OpenAI API key/);
    } finally {
        if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = prevKey;
    }
});
