import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./spot-location.js')>} Spot-location module import.
 */
async function loadSpotLocationModule() {
    importCounter += 1;
    return import(`./spot-location.js?test=${importCounter}`);
}

/**
 * @returns {Promise<typeof import('./spot.js')>} Spot module import.
 */
async function loadSpotModule() {
    return import('./spot.js');
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
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
});

test('getLatestTrackLocation returns combined track + location', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { getLatestTrackLocation } = await loadSpotLocationModule();
    const { resetSpotCacheForTests } = await loadSpotModule();
    const geocodeJson = {
        results: [
            {
                formatted_address: '123 Main St, Minneapolis, MN 55401, USA',
                address_components: [
                    { long_name: '123', types: ['street_number'] },
                    { long_name: 'Main St', types: ['route'] },
                    { long_name: 'Minneapolis', types: ['locality'] },
                    {
                        long_name: 'Minnesota',
                        short_name: 'MN',
                        types: ['administrative_area_level_1'],
                    },
                    {
                        long_name: 'United States',
                        short_name: 'US',
                        types: ['country'],
                    },
                    { long_name: '55401', types: ['postal_code'] },
                ],
            },
        ],
    };

    const timezoneJson = {
        status: 'OK',
        timeZoneId: 'America/Chicago',
        timeZoneName: 'Central Standard Time',
    };

    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url) => {
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
                                    messengerId: 'm1',
                                    messengerName: 'Tracker',
                                },
                            },
                        },
                    },
                });
            }
            if (urlString.includes('/geocode/')) {
                return makeJsonResponse(geocodeJson);
            }
            if (urlString.includes('/timezone/')) {
                return makeJsonResponse(timezoneJson);
            }
            return makeJsonResponse(null, {
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });
        }
    );

    const result = await getLatestTrackLocation();

    assert.ok(result);
    assert.deepEqual(result.track, {
        latitude: 44.9778,
        longitude: -93.265,
        unixTime: 1700000000,
        messageId: 'abc',
        messengerId: 'm1',
        messengerName: 'Tracker',
        messageType: 'TRACK',
    });
    assert.deepEqual(result.location.userLocation, {
        type: 'approximate',
        country: 'US',
        region: 'Minnesota',
        city: 'Minneapolis',
    });
    assert.equal(result.location.timezoneId, 'America/Chicago');
    resetSpotCacheForTests();
});

test('getLatestTrackLocation returns null when no track', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { getLatestTrackLocation } = await loadSpotLocationModule();
    const { resetSpotCacheForTests } = await loadSpotModule();
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: null,
                        },
                    },
                },
            });
        }
    );

    const result = await getLatestTrackLocation();

    assert.equal(result, null);
    assert.equal(calls, 1);
    resetSpotCacheForTests();
});

test('getLatestTrackLocation returns null when apiKey missing', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { getLatestTrackLocation } = await loadSpotLocationModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'TRACK',
                                latitude: 47.61,
                                longitude: -122.33,
                                unixTime: 1700000000,
                                id: 'abc',
                            },
                        },
                    },
                },
            })
    );

    const result = await getLatestTrackLocation();

    assert.equal(result, null);
});
