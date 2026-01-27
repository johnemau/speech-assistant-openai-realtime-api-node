import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./weather-at-place.js')>} Weather-at-place module import.
 */
async function loadWeatherAtPlaceModule() {
    importCounter += 1;
    return import(`./weather-at-place.js?test=${importCounter}`);
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
        url: 'https://example.com/mock',
        headers: new Map(),
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

test('get_current_conditions resolves address before fetching weather', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_current_conditions } = await loadWeatherAtPlaceModule();

    let weatherUrl;
    let placeCalled = false;

    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url, options) => {
            const target = String(url);
            if (target.includes('places.googleapis.com/v1/places:searchText')) {
                placeCalled = true;
                const body = JSON.parse(String(options?.body ?? '{}'));
                assert.equal(body.textQuery, 'Seattle, WA');
                return makeJsonResponse({
                    places: [
                        {
                            location: { latitude: 47.61, longitude: -122.33 },
                        },
                    ],
                });
            }

            if (
                target.includes(
                    'weather.googleapis.com/v1/currentConditions:lookup'
                )
            ) {
                weatherUrl = target;
                return makeJsonResponse({
                    currentTime: '2024-01-01T00:00:00Z',
                });
            }

            throw new Error(`Unexpected fetch: ${target}`);
        }
    );

    const result = await get_current_conditions({ address: 'Seattle, WA' });

    assert.ok(placeCalled);
    assert.ok(weatherUrl);
    const parsed = new URL(String(weatherUrl));
    assert.equal(parsed.searchParams.get('location.latitude'), '47.61');
    assert.equal(parsed.searchParams.get('location.longitude'), '-122.33');

    assert.equal(result?.currentTime, '2024-01-01T00:00:00Z');
    assert.equal(result?.timeZoneId, null);
});

test('get_daily_forecast uses provided lat/lng without address lookup', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_daily_forecast } = await loadWeatherAtPlaceModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url) => {
            const target = String(url);
            if (target.includes('places.googleapis.com')) {
                throw new Error('Unexpected places lookup');
            }

            calls += 1;
            return makeJsonResponse({
                timeZone: { id: 'America/Los_Angeles' },
                nextPageToken: null,
                forecastDays: [],
            });
        }
    );

    const result = await get_daily_forecast({ lat: 34.0522, lng: -118.2437 });

    assert.equal(calls, 1);
    assert.equal(result?.timeZoneId, 'America/Los_Angeles');
});

test('get_hourly_forecast returns null without a location', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_hourly_forecast, get_hourly_forcast } =
        await loadWeatherAtPlaceModule();

    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            throw new Error('Fetch should not be called');
        }
    );

    const result = await get_hourly_forecast({});
    assert.equal(result, null);
    assert.equal(get_hourly_forcast, get_hourly_forecast);
});
