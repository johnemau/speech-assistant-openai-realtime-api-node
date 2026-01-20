import test from 'node:test';
import assert from 'node:assert/strict';

import { execute } from './update-mic-distance.js';

test('update-mic-distance.execute rejects invalid mode', async () => {
    await assert.rejects(
        () =>
            execute({
                args: { mode: 'invalid' },
                context: { micState: {} },
            }),
        /Invalid mode/
    );
});

test('update-mic-distance.execute returns debounced noop', async () => {
    const micState = {
        currentNoiseReductionType: 'near_field',
        lastMicDistanceToggleTs: Date.now(),
        farToggles: 0,
        nearToggles: 0,
        skippedNoOp: 0,
    };
    const res = await execute({
        args: { mode: 'far_field' },
        context: { micState },
    });
    assert.equal(res.status, 'noop');
    assert.equal(res.reason, 'debounced');
    assert.equal(res.applied, false);
});

test('update-mic-distance.execute skips when already set', async () => {
    const micState = {
        currentNoiseReductionType: 'near_field',
        lastMicDistanceToggleTs: 0,
        farToggles: 0,
        nearToggles: 0,
        skippedNoOp: 0,
    };
    const res = await execute({
        args: { mode: 'near_field' },
        context: { micState },
    });
    assert.equal(res.status, 'noop');
    assert.equal(res.reason, 'already-set');
    assert.equal(micState.skippedNoOp, 1);
});

test('update-mic-distance.execute applies update and updates counters', async () => {
    const micState = {
        currentNoiseReductionType: 'near_field',
        lastMicDistanceToggleTs: 0,
        farToggles: 0,
        nearToggles: 0,
        skippedNoOp: 0,
    };
    let applied;
    const res = await execute({
        args: { mode: 'far_field', reason: 'speaker' },
        context: {
            micState,
            applyNoiseReduction: (mode) => {
                applied = mode;
            },
        },
    });
    assert.equal(res.status, 'ok');
    assert.equal(res.applied, true);
    assert.equal(applied, 'far_field');
    assert.equal(micState.farToggles, 1);
    assert.equal(res.reason, 'speaker');
});
