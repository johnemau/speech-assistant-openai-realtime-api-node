import assert from 'node:assert/strict';
import test from 'node:test';
import { runVoiceTests } from '../src/testing/voice-test-runner.js';

export const callerTurns = [
    'Find coffee shops near Pike Place Market.',
    'Text me the top two.'
];

export const expectedAssistant = [
    'Provides 1–3 nearby coffee shops with addresses and at most one source label.',
    'Confirms SMS sent and summarizes the message content.'
];

test('voice assistant turns', async () => {
    assert.equal(callerTurns.length, expectedAssistant.length, 'callerTurns and expectedAssistant must align.');
    const results = await runVoiceTests({ callerTurns, expectedAssistant });
    assert.ok(results.length > 0, 'Expected at least one voice test turn.');
});
