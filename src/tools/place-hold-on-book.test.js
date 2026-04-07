import test from 'node:test';
import assert from 'node:assert/strict';

const originalWorkflowId = process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID;
const originalServerBaseUrl = process.env.SERVER_BASE_URL;

const { execute, setRunWorkflowForTests, resetRunWorkflowForTests } =
    await import('./place-hold-on-book.js');

test.afterEach(() => {
    resetRunWorkflowForTests();
    if (originalWorkflowId == null) {
        delete process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID;
    } else {
        process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID = originalWorkflowId;
    }
    if (originalServerBaseUrl == null) {
        delete process.env.SERVER_BASE_URL;
    } else {
        process.env.SERVER_BASE_URL = originalServerBaseUrl;
    }
});

test('place_hold_on_book: returns started status with message on success', async () => {
    process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID = 'wpid_holdtest123';
    process.env.SERVER_BASE_URL = 'https://example.com';

    /** @type {{ workflowId?: string, parameters?: Record<string, string>, webhook_url?: string }} */
    const seen = {};
    setRunWorkflowForTests(async ({ workflowId, parameters, webhook_url }) => {
        seen.workflowId = workflowId;
        seen.parameters = parameters;
        seen.webhook_url = webhook_url;
        return { run_id: 'run_abc', status: 'queued' };
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                book_title: 'The Pragmatic Programmer',
            },
        })
    );

    assert.equal(result.status, 'started');
    assert.ok(
        result.message.includes('hold'),
        `expected message to mention hold, got: ${result.message}`
    );
    assert.ok(
        result.message.includes('text'),
        `expected message to mention text message, got: ${result.message}`
    );
    assert.equal(seen.workflowId, 'wpid_holdtest123');
    assert.deepEqual(seen.parameters, {
        book_title: 'The Pragmatic Programmer',
    });
    assert.equal(seen.webhook_url, 'https://example.com/place-hold-on-book');
});

test('place_hold_on_book: returns error when SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID is not set', async () => {
    delete process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID;

    const result = /** @type {any} */ (
        await execute({
            args: {
                book_title: 'The Pragmatic Programmer',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /not configured/i);
});

test('place_hold_on_book: returns error when runWorkflow throws', async () => {
    process.env.SKYVERN_PLACE_HOLD_ON_BOOK_WORKFLOW_ID = 'wpid_holdtest123';

    setRunWorkflowForTests(async () => {
        throw new Error('Skyvern API error: 503');
    });

    const result = /** @type {any} */ (
        await execute({
            args: {
                book_title: 'The Pragmatic Programmer',
            },
        })
    );

    assert.ok(result.error, 'expected an error property');
    assert.match(result.error, /failed to start/i);
});
