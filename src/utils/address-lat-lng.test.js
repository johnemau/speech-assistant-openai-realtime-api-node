import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./address-lat-lng.js')>} Module import.
 */
async function loadAddressLatLngModule() {
    importCounter += 1;
    return import(`./address-lat-lng.js?test=${importCounter}`);
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
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
});

test('getLatLngFromAddress returns coordinates from first match', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { getLatLngFromAddress } = await loadAddressLatLngModule();

    /** @type {any} */
    let seenBody;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (_url, init) => {
            seenBody = init?.body ? JSON.parse(String(init.body)) : null;
            return makeJsonResponse({
                places: [
                    {
                        id: 'abc',
                        displayName: { text: 'Cafe Luna' },
                        formattedAddress: '123 Main St, Seattle, WA',
                        location: { latitude: 47.61, longitude: -122.33 },
                    },
                ],
            });
        }
    );

    const result = await getLatLngFromAddress('123 Main St, Seattle, WA');

    assert.deepEqual(result, { lat: 47.61, lng: -122.33 });
    assert.ok(seenBody);
    assert.equal(seenBody.textQuery, '123 Main St, Seattle, WA');
});

test('getLatLngFromAddress returns null for empty address', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { getLatLngFromAddress } = await loadAddressLatLngModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({ places: [] });
        }
    );

    const result = await getLatLngFromAddress('   ');

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('getLatLngFromAddress returns null when no locations', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { getLatLngFromAddress } = await loadAddressLatLngModule();

    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
                places: [
                    {
                        id: 'abc',
                        displayName: { text: 'Cafe Luna' },
                        formattedAddress: '123 Main St, Seattle, WA',
                    },
                ],
            })
    );

    const result = await getLatLngFromAddress('Cafe Luna Seattle');

    assert.equal(result, null);
});