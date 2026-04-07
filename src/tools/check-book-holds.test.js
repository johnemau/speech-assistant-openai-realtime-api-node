import test from 'node:test';
import assert from 'node:assert/strict';

const originalWorkflowId = process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID;
const originalServerBaseUrl = process.env.SERVER_BASE_URL;

const { execute, setRunWorkflowForTests, resetRunWorkflowForTests } =
    await import('./check-book-holds.js');

test.afterEach(() => {
    resetRunWorkflowForTests();
    if (originalWorkflowId == null) {
        delete process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID;
    } else {
        process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID = originalWorkflowId;
    }
    if (originalServerBaseUrl == null) {
        delete process.env.SERVER_BASE_URL;
    } else {
        process.env.SERVER_BASE_URL = originalServerBaseUrl;
    }
});

test('check_book_holds: returns started status with message on success', async () => {
    process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID = 'wpid_holdstest123';
    process.env.SERVER_BASE_URL = 'https://example.com';

    /** @type {{ workflowId?: string, parameters?: Record<string, unknown>, webhook_url?: string }} */
    const seen = {};
    setRunWorkflowForTests(async ({ workflowId, parameters, webhook_url }) => {
        seen.workflowId = workflowId;
        seen.parameters = parameters;
        seen.webhook_url = webhook_url;
        return { run_id: 'run_abc', status: 'queued' };
    });

    const result = /** @type {any} */ (await execute({ args: {} }));

    assert.equal(result.status, 'started');
    assert.ok(
        result.message.includes('hold'),
        `expected message to mention hold, got: ${result.message}`
    );
    assert.ok(
        result.message.includes('text'),
        `expected message to mention text message, got: ${result.message}`
    );
    assert.equal(seen.workflowId, 'wpid_holdstest123');
    assert.deepEqual(seen.parameters, {});
    assert.equal(seen.webhook_url, 'https://example.com/check-book-holds');
});

test('check_book_holds: returns error when SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID is not set', async () => {
    delete process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID;

    const result = /** @type {any} */ (await execute({ args: {} }));

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /not configured/i);
});

test('check_book_holds: returns error when runWorkflow throws', async () => {
    process.env.SKYVERN_CHECK_BOOK_HOLDS_WORKFLOW_ID = 'wpid_holdstest123';

    setRunWorkflowForTests(async () => {
        throw new Error('Skyvern API error: 503');
    });

    const result = /** @type {any} */ (await execute({ args: {} }));

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /failed to start/i);
});
