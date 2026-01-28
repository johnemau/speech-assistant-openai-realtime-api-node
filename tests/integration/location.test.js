import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {string} Google Maps API key.
 */
function requireApiKey() {
    assert.ok(
        apiKey,
        'GOOGLE_MAPS_API_KEY must be set in the environment or .env file.'
    );
    return /** @type {string} */ (apiKey);
}

/**
 * @returns {Promise<typeof import('../../src/utils/location.js')>} Module import.
 */
async function loadLocationModule() {
    importCounter += 1;
    return import(`../../src/utils/location.js?test=${importCounter}`);
}

test('requires GOOGLE_MAPS_API_KEY', () => {
    assert.ok(
        apiKey,
        'GOOGLE_MAPS_API_KEY must be set in the environment or .env file.'
    );
});

test('reverseGeocode integration', async () => {
    const { reverseGeocode } = await loadLocationModule();

    const result = await reverseGeocode({
        lat: 47.6205,
        lng: -122.3493,
        apiKey: requireApiKey(),
    });

    assert.ok(result, 'Expected a response object');
    assert.ok(Array.isArray(result.results));
});

test('reverseGeocode integration supports language and timestamp', async () => {
    const { reverseGeocode } = await loadLocationModule();

    const result = await reverseGeocode({
        lat: 48.8584,
        lng: 2.2945,
        apiKey: requireApiKey(),
        language: 'fr',
        timestampSeconds: 1700000000,
    });

    assert.ok(result, 'Expected a response object');
    assert.ok(Array.isArray(result.results));
    assert.ok(result.results.length >= 0);
});

test('reverseGeocode integration handles invalid key response', async () => {
    const { reverseGeocode } = await loadLocationModule();

    const result = await reverseGeocode({
        lat: 47.6205,
        lng: -122.3493,
        apiKey: 'invalid-key-for-integration-test',
    });

    assert.ok(result, 'Expected a response object');
    assert.ok(!Array.isArray(result.results) || result.results.length === 0);
});

test('reverseGeocode integration returns formatted address', async () => {
    const { reverseGeocode } = await loadLocationModule();

    const result = await reverseGeocode({
        lat: 47.6205,
        lng: -122.3493,
        apiKey: requireApiKey(),
    });

    assert.ok(Array.isArray(result.results));
    assert.ok(
        result.results.length === 0 ||
            typeof result.results[0]?.formatted_address === 'string'
    );
});

test('locationFromLatLng integration', async () => {
    const { locationFromLatLng } = await loadLocationModule();

    const result = await locationFromLatLng({
        lat: 47.6205,
        lng: -122.3493,
        includeTimezone: true,
    });

    assert.equal(typeof result.lat, 'number');
    assert.equal(typeof result.lng, 'number');
    assert.ok(result.userLocation);
    assert.ok(result.address);
    assert.ok(result.geocode);
    assert.ok('timezoneId' in result);
});

test('locationFromLatLng integration handles invalid key response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'invalid-key-for-integration-test';
    const { locationFromLatLng } = await loadLocationModule();

    try {
        const result = await locationFromLatLng({
            lat: 47.6205,
            lng: -122.3493,
        });

        assert.equal(typeof result.lat, 'number');
        assert.equal(typeof result.lng, 'number');
        assert.ok(result.userLocation);
        assert.ok(result.address);
        assert.ok(result.geocode);
    } finally {
        if (originalGoogleMapsKey == null) {
            delete process.env.GOOGLE_MAPS_API_KEY;
        } else {
            process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
        }
    }
});

test('locationFromLatLng integration throws with invalid args', async () => {
    const { locationFromLatLng } = await loadLocationModule();

    await assert.rejects(
        () => locationFromLatLng({ lat: 999, lng: -122.3493 }),
        { message: /lat and lng must be valid numbers/i }
    );
});
