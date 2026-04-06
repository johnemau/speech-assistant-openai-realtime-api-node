import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.SKYVERN_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./skyvern.js')>} Module import.
 */
async function loadModule() {
    importCounter += 1;
    return import(`./skyvern.js?test=${importCounter}`);
}

/**
 * @param {object | null} body - JSON body to return.
 * @param {Partial<Response>} [overrides] - Response field overrides.
 * @returns {Response} Mocked response object.
 */
function makeJsonResponse(body, overrides = {}) {
    return /** @type {Response} */ ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => '',
        ...overrides,
    });
}

test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey == null) {
        delete process.env.SKYVERN_API_KEY;
    } else {
        process.env.SKYVERN_API_KEY = originalApiKey;
    }
});

test('skyvern.runWorkflow posts to Skyvern API and returns response', async () => {
    process.env.SKYVERN_API_KEY = 'test-skyvern-key';
    const { runWorkflow } = await loadModule();

    let seenUrl = '';
    /** @type {RequestInit | undefined} */
    let seenInit;
    const fakeResult = { run_id: 'run_abc123', status: 'queued' };

    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url, init) => {
            seenUrl = String(url);
            seenInit = init;
            return makeJsonResponse(fakeResult);
        }
    );

    const result = await runWorkflow({
        workflowId: 'wpid_test123',
        parameters: {
            library_location: 'Bellevue Library',
            target_date: 'April 10, 2026',
        },
    });

    assert.equal(seenUrl, 'https://api.skyvern.com/v1/run/workflows');
    assert.equal(seenInit?.method, 'POST');

    const headers = /** @type {Record<string, string>} */ (
        seenInit?.headers ?? {}
    );
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['x-api-key'], 'test-skyvern-key');

    const sentBody = JSON.parse(/** @type {string} */ (seenInit?.body ?? '{}'));
    assert.equal(sentBody.workflow_id, 'wpid_test123');
    assert.deepEqual(sentBody.parameters, {
        library_location: 'Bellevue Library',
        target_date: 'April 10, 2026',
    });
    assert.equal(sentBody.proxy_location, 'RESIDENTIAL');
    assert.equal(sentBody.max_screenshot_scrolls, 10);

    assert.deepEqual(result, fakeResult);
});

test('skyvern.runWorkflow throws when SKYVERN_API_KEY is not set', async () => {
    delete process.env.SKYVERN_API_KEY;
    const { runWorkflow } = await loadModule();

    await assert.rejects(
        () =>
            runWorkflow({
                workflowId: 'wpid_test123',
                parameters: {
                    library_location: 'Bellevue Library',
                    target_date: 'April 10, 2026',
                },
            }),
        /SKYVERN_API_KEY not set/
    );
});

test('skyvern.runWorkflow throws on non-2xx HTTP response', async () => {
    process.env.SKYVERN_API_KEY = 'test-skyvern-key';
    const { runWorkflow } = await loadModule();

    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse(
                { error: 'bad request' },
                { ok: false, status: 400, statusText: 'Bad Request' }
            )
    );

    await assert.rejects(
        () =>
            runWorkflow({
                workflowId: 'wpid_test123',
                parameters: {
                    library_location: 'Bellevue Library',
                    target_date: 'April 10, 2026',
                },
            }),
        /Skyvern API error: 400/
    );
});
