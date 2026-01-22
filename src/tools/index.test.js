import test from 'node:test';
import assert from 'node:assert/strict';

import { getToolDefinitions, executeToolCall } from './index.js';

test('tools.getToolDefinitions returns known tools', () => {
    const defs = getToolDefinitions();
    const names = defs.map((d) => /** @type {any} */ (d).name);
    assert.ok(names.includes('gpt_web_search'));
    assert.ok(names.includes('send_email'));
    assert.ok(names.includes('send_sms'));
    assert.ok(names.includes('update_mic_distance'));
    assert.ok(names.includes('end_call'));
    assert.ok(names.includes('get_current_location'));
    assert.ok(names.includes('find_currently_nearby_place'));
});

test('tools.executeToolCall executes end_call', async () => {
    const res = await executeToolCall({
        name: 'end_call',
        args: { reason: 'bye' },
        context: {
            /**
             * @param {{ reason?: string }} root0 - End-call arguments.
             * @returns {{ status: string, reason?: string }} Result payload.
             */
            onEndCall: ({ reason }) => ({ status: 'done', reason }),
        },
    });
    assert.deepEqual(res, { status: 'done', reason: 'bye' });
});

test('tools.executeToolCall throws on unknown tool', async () => {
    await assert.rejects(
        () => executeToolCall({ name: 'nope', args: {}, context: {} }),
        /Unknown tool/
    );
});
