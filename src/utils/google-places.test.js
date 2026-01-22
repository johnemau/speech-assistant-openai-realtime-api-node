import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./google-places.js')>} Module import.
 */
async function loadGooglePlacesModule() {
    importCounter += 1;
    return import(`./google-places.js?test=${importCounter}`);
}

/**
 * @returns {Promise<typeof import('./google-places-current.js')>} Module import.
 */
async function loadGooglePlacesCurrentModule() {
    importCounter += 1;
    return import(`./google-places-current.js?test=${importCounter}`);
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

test.afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
    if (originalSpotFeedId == null) {
        delete process.env.SPOT_FEED_ID;
    } else {
        process.env.SPOT_FEED_ID = originalSpotFeedId;
    }
    if (originalSpotFeedPassword == null) {
        delete process.env.SPOT_FEED_PASSWORD;
    } else {
        process.env.SPOT_FEED_PASSWORD = originalSpotFeedPassword;
    }
    const { resetSpotCacheForTests } = await import('./spot.js');
    resetSpotCacheForTests();
});

test('searchPlacesNearby returns mapped places', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { searchPlacesNearby } = await loadGooglePlacesModule();

    let seenHeaders;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url, init) => {
            assert.equal(
                String(url),
                'https://places.googleapis.com/v1/places:searchNearby'
            );
            seenHeaders = init?.headers;
            return makeJsonResponse({
                places: [
                    {
                        id: 'abc',
                        displayName: { text: 'Cafe Luna' },
                        formattedAddress: '123 Main St, Seattle, WA',
                        location: { latitude: 47.61, longitude: -122.33 },
                        primaryType: 'cafe',
                        googleMapsUri: 'https://maps.google.com/?q=Cafe+Luna',
                    },
                ],
            });
        }
    );

    const result = await searchPlacesNearby({
        lat: 47.61,
        lng: -122.33,
        radius_m: 1000,
        included_primary_types: ['cafe'],
    });

    assert.deepEqual(result, {
        places: [
            {
                id: 'abc',
                name: 'Cafe Luna',
                address: '123 Main St, Seattle, WA',
                location: { lat: 47.61, lng: -122.33 },
                primaryType: 'cafe',
                mapsUrl: 'https://maps.google.com/?q=Cafe+Luna',
            },
        ],
    });
    assert.ok(seenHeaders);
    assert.equal(seenHeaders['X-Goog-Api-Key'], 'test-key');
    assert.equal(
        seenHeaders['X-Goog-FieldMask'],
        [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.primaryType',
            'places.googleMapsUri',
        ].join(',')
    );
});

test('searchPlacesNearby returns null when apiKey missing', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { searchPlacesNearby } = await loadGooglePlacesModule();
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({ places: [] });
        }
    );

    const result = await searchPlacesNearby({
        lat: 47.61,
        lng: -122.33,
        radius_m: 500,
    });

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('searchPlacesNearby caches responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { searchPlacesNearby } = await loadGooglePlacesModule();
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
                places: [
                    {
                        id: 'cached',
                        displayName: { text: 'Cached Place' },
                        formattedAddress: '1 Cache Way',
                        location: { latitude: 10, longitude: 20 },
                        primaryType: 'restaurant',
                        googleMapsUri: 'https://maps.google.com/?q=Cached',
                    },
                ],
            });
        }
    );

    const args = { lat: 10, lng: 20, radius_m: 2000 };

    const first = await searchPlacesNearby(args);
    const second = await searchPlacesNearby(args);

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
});

test('searchPlacesNearby returns null on non-ok response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { searchPlacesNearby } = await loadGooglePlacesModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse(null, {
                ok: false,
                status: 403,
                statusText: 'Forbidden',
            })
    );

    const result = await searchPlacesNearby({
        lat: 10,
        lng: 20,
        radius_m: 500,
    });

    assert.equal(result, null);
});

test('findCurrentlyNearbyPlaces returns null when no track', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { findCurrentlyNearbyPlaces } =
        await loadGooglePlacesCurrentModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (async (url) => {
        calls += 1;
        const urlString = String(url);
        if (urlString.includes('findmespot.com')) {
            return makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'OK',
                                latitude: 47.61,
                                longitude: -122.33,
                                unixTime: 1700000000,
                                id: 'abc',
                            },
                        },
                    },
                },
            });
        }
        throw new Error('unexpected fetch');
    });

    const result = await findCurrentlyNearbyPlaces(1000);

    assert.equal(result, null);
    assert.equal(calls, 1);
});

test('findCurrentlyNearbyPlaces uses tracked location', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { findCurrentlyNearbyPlaces } =
        await loadGooglePlacesCurrentModule();

    let placesBody;
    globalThis.fetch = /** @type {typeof fetch} */ (async (url, init) => {
        const urlString = String(url);
        if (urlString.includes('findmespot.com')) {
            return makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'TRACK',
                                latitude: 44.9778,
                                longitude: -93.265,
                                unixTime: 1700000000,
                                id: 'abc',
                            },
                        },
                    },
                },
            });
        }
        if (urlString.includes('places.googleapis.com')) {
            placesBody = init?.body ? JSON.parse(String(init.body)) : null;
            return makeJsonResponse({
                places: [
                    {
                        id: 'nearby',
                        displayName: { text: 'Nearby Place' },
                        formattedAddress: '1 Local St',
                        location: { latitude: 44.9778, longitude: -93.265 },
                        primaryType: 'cafe',
                        googleMapsUri: 'https://maps.google.com/?q=Nearby',
                    },
                ],
            });
        }
        return makeJsonResponse(null, {
            ok: false,
            status: 404,
            statusText: 'Not Found',
        });
    });

    const result = await findCurrentlyNearbyPlaces(1500, {
        included_primary_types: ['cafe'],
    });

    assert.deepEqual(result, {
        places: [
            {
                id: 'nearby',
                name: 'Nearby Place',
                address: '1 Local St',
                location: { lat: 44.9778, lng: -93.265 },
                primaryType: 'cafe',
                mapsUrl: 'https://maps.google.com/?q=Nearby',
            },
        ],
    });
    assert.equal(placesBody.locationRestriction.circle.radius, 1500);
    assert.deepEqual(placesBody.locationRestriction.circle.center, {
        latitude: 44.9778,
        longitude: -93.265,
    });
});
