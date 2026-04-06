import test from 'node:test';
import assert from 'node:assert/strict';

const originalWorkflowId = process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID;

const { execute, setRunWorkflowForTests, resetRunWorkflowForTests } =
    await import('./get-study-room-times.js');

test.afterEach(() => {
    resetRunWorkflowForTests();
    if (originalWorkflowId == null) {
        delete process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID;
    } else {
        process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID = originalWorkflowId;
    }
});

test('get_study_room_times: returns started status with message on success', async () => {
    process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID = 'wpid_test123';

    /** @type {{ workflowId?: string, parameters?: Record<string, string> }} */
    const seen = {};
    setRunWorkflowForTests(async ({ workflowId, parameters }) => {
        seen.workflowId = workflowId;
        seen.parameters = parameters;
        return { run_id: 'run_abc', status: 'queued' };
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                target_date: 'April 10, 2026',
            },
        })
    );

    assert.equal(result.status, 'started');
    assert.ok(
        result.message.includes('looking up library study room times'),
        `expected message to mention study room times, got: ${result.message}`
    );
    assert.ok(
        result.message.includes('call and text'),
        `expected message to mention call and text, got: ${result.message}`
    );
    assert.equal(seen.workflowId, 'wpid_test123');
    assert.deepEqual(seen.parameters, {
        library_location: 'Bellevue Library',
        target_date: 'April 10, 2026',
    });
});

test('get_study_room_times: returns error when SKYVERN_STUDY_ROOM_WORKFLOW_ID is not set', async () => {
    delete process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID;

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                target_date: 'April 10, 2026',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /not configured/i);
});

test('get_study_room_times: returns error when runWorkflow throws', async () => {
    process.env.SKYVERN_STUDY_ROOM_WORKFLOW_ID = 'wpid_test123';

    setRunWorkflowForTests(async () => {
        throw new Error('Skyvern API error: 503');
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                target_date: 'April 10, 2026',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /Failed to start/i);
});
