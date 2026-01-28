import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;

const envModule = await import('../env.js');
const { execute } = await import('./get-current-location.js');
const { resetSpotCacheForTests } = await import('../utils/spot.js');

const LOCATION_UNAVAILABLE_MESSAGE = 'Location infomration not available.';

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
    if (originalSpotFeedId == null) delete process.env.SPOT_FEED_ID;
    else process.env.SPOT_FEED_ID = originalSpotFeedId;
    if (originalSpotFeedPassword == null) delete process.env.SPOT_FEED_PASSWORD;
    else process.env.SPOT_FEED_PASSWORD = originalSpotFeedPassword;
    if (originalGoogleMapsKey == null) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    resetSpotCacheForTests();
});

test('get-current-location.execute blocks non-primary callers', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            throw new Error('fetch should not be called');
        }
    );

    try {
        const res = await execute({
            args: {},
            context: { currentCallerE164: '+12065550101' },
        });
        assert.deepEqual(res, {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        });
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
    }
});

test('get-current-location.execute returns latest location for primary caller', async () => {
    const prevPrimary = new Set(envModule.PRIMARY_CALLERS_SET);
    envModule.PRIMARY_CALLERS_SET.clear();
    envModule.PRIMARY_CALLERS_SET.add('+12065550100');

    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';

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

    try {
        const res = await execute({
            args: {},
            context: { currentCallerE164: '+12065550100' },
        });
        assert.equal(res.status, 'ok');
        assert.equal('track' in res, false);
        assert.deepEqual(res.location.userLocation, {
            type: 'approximate',
            country: 'US',
            region: 'Minnesota',
            city: 'Minneapolis',
        });
        assert.equal(res.location.timezoneId, 'America/Chicago');
    } finally {
        envModule.PRIMARY_CALLERS_SET.clear();
        prevPrimary.forEach((value) =>
            envModule.PRIMARY_CALLERS_SET.add(value)
        );
    }
});
