import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./weather.js')>} Weather module import.
 */
async function loadWeatherModule() {
    importCounter += 1;
    return import(`./weather.js?test=${importCounter}`);
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
        url: 'https://weather.googleapis.com/mock',
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

test('get_current_conditions returns normalized data', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_current_conditions } = await loadWeatherModule();

    let seenUrl;
    globalThis.fetch = /** @type {typeof fetch} */ (async (url) => {
        seenUrl = String(url);
        return makeJsonResponse({
            currentTime: '2024-01-01T12:00:00Z',
            timeZone: { id: 'America/Los_Angeles' },
            isDaytime: true,
            relativeHumidity: 55,
            uvIndex: 4,
            weatherCondition: {
                description: { text: 'Clear' },
                type: 'CLEAR',
                iconBaseUri: 'https://example.com/icon',
            },
            temperature: { degrees: 21, unit: 'C' },
            feelsLikeTemperature: { degrees: 20, unit: 'C' },
        });
    });

    const result = await get_current_conditions({
        lat: 34.0522,
        lng: -118.2437,
        units_system: 'IMPERIAL',
        language_code: 'en',
    });

    assert.ok(seenUrl);
    const parsed = new URL(String(seenUrl));
    assert.equal(parsed.pathname, '/v1/currentConditions:lookup');
    assert.equal(parsed.searchParams.get('key'), 'test-key');
    assert.equal(parsed.searchParams.get('location.latitude'), '34.0522');
    assert.equal(parsed.searchParams.get('location.longitude'), '-118.2437');
    assert.equal(parsed.searchParams.get('unitsSystem'), 'IMPERIAL');
    assert.equal(parsed.searchParams.get('languageCode'), 'en');

    assert.deepEqual(result, {
        currentTime: '2024-01-01T12:00:00Z',
        timeZoneId: 'America/Los_Angeles',
        isDaytime: true,
        relativeHumidity: 55,
        uvIndex: 4,
        weather: {
            text: 'Clear',
            type: 'CLEAR',
            iconBaseUri: 'https://example.com/icon',
        },
        temperature: { degrees: 21, unit: 'C' },
        feelsLikeTemperature: { degrees: 20, unit: 'C' },
        raw: {
            currentTime: '2024-01-01T12:00:00Z',
            timeZone: { id: 'America/Los_Angeles' },
            isDaytime: true,
            relativeHumidity: 55,
            uvIndex: 4,
            weatherCondition: {
                description: { text: 'Clear' },
                type: 'CLEAR',
                iconBaseUri: 'https://example.com/icon',
            },
            temperature: { degrees: 21, unit: 'C' },
            feelsLikeTemperature: { degrees: 20, unit: 'C' },
        },
    });
});

test('get_current_conditions returns null for invalid args', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_current_conditions } = await loadWeatherModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (async () => {
        calls += 1;
        return makeJsonResponse({});
    });

    const result = await get_current_conditions({ lat: 200, lng: 0 });
    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('get_current_conditions caches responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_current_conditions } = await loadWeatherModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (async () => {
        calls += 1;
        return makeJsonResponse({ currentTime: '2024-01-01T00:00:00Z' });
    });

    const args = { lat: 10.1234567, lng: 20.7654321 };
    const first = await get_current_conditions(args);
    const second = await get_current_conditions(args);

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
});

test('get_current_conditions returns null on non-ok response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_current_conditions } = await loadWeatherModule();

    globalThis.fetch = /** @type {typeof fetch} */ (async () =>
        makeJsonResponse(null, {
            ok: false,
            status: 500,
            statusText: 'Server Error',
        })
    );

    const result = await get_current_conditions({ lat: 10, lng: 20 });
    assert.equal(result, null);
});

test('get_daily_forecast returns normalized page', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_daily_forecast } = await loadWeatherModule();

    globalThis.fetch = /** @type {typeof fetch} */ (async (url) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.pathname, '/v1/forecast/days:lookup');
        assert.equal(parsed.searchParams.get('pageSize'), '3');
        return makeJsonResponse({
            timeZone: { id: 'America/Chicago' },
            nextPageToken: 'next',
            forecastDays: [{ day: 1 }, { day: 2 }],
        });
    });

    const result = await get_daily_forecast({
        lat: 41.8781,
        lng: -87.6298,
        page_size: 3,
        days: 5,
    });

    assert.deepEqual(result, {
        timeZoneId: 'America/Chicago',
        nextPageToken: 'next',
        items: [{ day: 1 }, { day: 2 }],
        raw: {
            timeZone: { id: 'America/Chicago' },
            nextPageToken: 'next',
            forecastDays: [{ day: 1 }, { day: 2 }],
        },
    });
});

test('get_daily_forecast returns null for invalid page size', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_daily_forecast } = await loadWeatherModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (async () => {
        calls += 1;
        return makeJsonResponse({});
    });

    const result = await get_daily_forecast({
        lat: 41.8781,
        lng: -87.6298,
        page_size: 11,
    });

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('get_hourly_forecast returns normalized page', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { get_hourly_forecast, get_hourly_forcast } = await loadWeatherModule();

    globalThis.fetch = /** @type {typeof fetch} */ (async (url) => {
        const parsed = new URL(String(url));
        assert.equal(parsed.pathname, '/v1/forecast/hours:lookup');
        assert.equal(parsed.searchParams.get('pageSize'), '4');
        return makeJsonResponse({
            timeZone: { id: 'America/New_York' },
            nextPageToken: null,
            forecastHours: [{ hour: 1 }],
        });
    });

    const result = await get_hourly_forecast({
        lat: 40.7128,
        lng: -74.006,
        page_size: 4,
        hours: 8,
    });

    assert.deepEqual(result, {
        timeZoneId: 'America/New_York',
        nextPageToken: null,
        items: [{ hour: 1 }],
        raw: {
            timeZone: { id: 'America/New_York' },
            nextPageToken: null,
            forecastHours: [{ hour: 1 }],
        },
    });
    assert.equal(get_hourly_forcast, get_hourly_forecast);
});
