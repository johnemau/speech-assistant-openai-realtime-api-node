import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/weather.js')>} Module import.
 */
async function loadWeatherModule() {
    importCounter += 1;
    return import(`../../src/utils/weather.js?test=${importCounter}`);
}

test.afterEach(() => {
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
});

if (!apiKey) {
    test(
        'weather integration',
        { skip: 'Missing GOOGLE_MAPS_API_KEY in .env' },
        () => {}
    );
} else {
    test('get_current_conditions integration', async () => {
        process.env.GOOGLE_MAPS_API_KEY = apiKey;
        const { get_current_conditions } = await loadWeatherModule();

        const result = await get_current_conditions({
            lat: 47.6205,
            lng: -122.3493,
            units_system: 'IMPERIAL',
        });

        assert.ok(result, 'Expected current conditions result');
        assert.equal(typeof result.timeZoneId, 'string');
        assert.ok(result.raw, 'Expected raw payload');
    });

    test('get_daily_forecast integration', async () => {
        process.env.GOOGLE_MAPS_API_KEY = apiKey;
        const { get_daily_forecast } = await loadWeatherModule();

        const result = await get_daily_forecast({
            lat: 47.6205,
            lng: -122.3493,
            days: 3,
            page_size: 3,
        });

        assert.ok(result, 'Expected daily forecast result');
        assert.equal(typeof result.timeZoneId, 'string');
        assert.ok(Array.isArray(result.items));
        assert.ok(result.items.length > 0);
    });

    test('get_hourly_forecast integration', async (t) => {
        process.env.GOOGLE_MAPS_API_KEY = apiKey;
        const { get_hourly_forecast } = await loadWeatherModule();

        const result = await get_hourly_forecast({
            lat: 47.6205,
            lng: -122.3493,
            hours: 6,
            page_size: 6,
        });

        if (!result) {
            t.skip('Hourly forecast unavailable for this API key.');
        }
        assert.ok(result, 'Expected hourly forecast result');
        assert.equal(typeof result.timeZoneId, 'string');
        assert.ok(Array.isArray(result.items));
        assert.ok(result.items.length > 0);
    });

    test('get_current_conditions integration handles invalid key', async () => {
        process.env.GOOGLE_MAPS_API_KEY = 'invalid-key-for-integration-test';
        const { get_current_conditions } = await loadWeatherModule();

        const result = await get_current_conditions({
            lat: 35.6895,
            lng: 139.6917,
        });

        assert.equal(result, null);
    });
}
