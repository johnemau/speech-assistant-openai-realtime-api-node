import test from 'node:test';
import assert from 'node:assert/strict';

import { execute } from './end-call.js';

test('end-call.execute delegates to onEndCall', async () => {
    const res = await execute({
        args: { reason: 'bye ' },
        context: {
            /**
             * @param {{ reason?: string }} root0 - End-call arguments.
             * @returns {{ status: string, reason?: string }} Result payload.
             */
            onEndCall: ({ reason }) => ({ status: 'ended', reason }),
        },
    });
    assert.deepEqual(res, { status: 'ended', reason: 'bye' });
});

test('end-call.execute returns ok when no handler', async () => {
    const res = await execute({ args: { reason: ' done ' }, context: {} });
    assert.deepEqual(res, { status: 'ok', reason: 'done' });
});
