import test from 'node:test';
import assert from 'node:assert/strict';

const originalWorkflowId = process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID;
const originalServerBaseUrl = process.env.SERVER_BASE_URL;

const { execute, setRunWorkflowForTests, resetRunWorkflowForTests } =
    await import('./reserve-study-room.js');

test.afterEach(() => {
    resetRunWorkflowForTests();
    if (originalWorkflowId == null) {
        delete process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID;
    } else {
        process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID = originalWorkflowId;
    }
    if (originalServerBaseUrl == null) {
        delete process.env.SERVER_BASE_URL;
    } else {
        process.env.SERVER_BASE_URL = originalServerBaseUrl;
    }
});

test('reserve_study_room: returns started status with message on success', async () => {
    process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID = 'wpid_test456';
    process.env.SERVER_BASE_URL = 'https://example.com';

    /** @type {{ workflowId?: string, parameters?: Record<string, string>, webhook_url?: string }} */
    const seen = {};
    setRunWorkflowForTests(async ({ workflowId, parameters, webhook_url }) => {
        seen.workflowId = workflowId;
        seen.parameters = parameters;
        seen.webhook_url = webhook_url;
        return { run_id: 'run_xyz', status: 'queued' };
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                room_name: 'Room A',
                target_date: 'April 10, 2026',
                start_time: '2:00 PM',
                end_time: '4:00 PM',
            },
        })
    );

    assert.equal(result.status, 'started');
    assert.ok(
        result.message.includes('reserving the study room'),
        `expected message to mention reserving study room, got: ${result.message}`
    );
    assert.ok(
        result.message.includes('call and text'),
        `expected message to mention call and text, got: ${result.message}`
    );
    assert.equal(seen.workflowId, 'wpid_test456');
    assert.deepEqual(seen.parameters, {
        library_location: 'Bellevue Library',
        room_name: 'Room A',
        target_date: 'April 10, 2026',
        Study_Room_Reservation_Start_Time: '2:00 PM',
        Study_Room_Reservation_End_Time: '4:00 PM',
    });
    assert.equal(seen.webhook_url, 'https://example.com/reserve-study-room');
});

test('reserve_study_room: returns error when SKYVERN_RESERVE_ROOM_WORKFLOW_ID is not set', async () => {
    delete process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID;

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                room_name: 'Room A',
                target_date: 'April 10, 2026',
                start_time: '2:00 PM',
                end_time: '4:00 PM',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /not configured/i);
});

test('reserve_study_room: returns error when runWorkflow throws', async () => {
    process.env.SKYVERN_RESERVE_ROOM_WORKFLOW_ID = 'wpid_test456';

    setRunWorkflowForTests(async () => {
        throw new Error('Skyvern API error: 503');
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                library_location: 'Bellevue Library',
                room_name: 'Room A',
                target_date: 'April 10, 2026',
                start_time: '2:00 PM',
                end_time: '4:00 PM',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /Failed to start/i);
});
