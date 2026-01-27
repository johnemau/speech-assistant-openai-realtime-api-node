import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/location.js')>} Module import.
 */
async function loadLocationModule() {
    importCounter += 1;
    return import(`../../src/utils/location.js?test=${importCounter}`);
}

if (!apiKey) {
    test('reverseGeocode integration', { skip: 'Missing GOOGLE_MAPS_API_KEY in .env' }, () => {});
} else {
    test('reverseGeocode integration', async () => {
        const { reverseGeocode } = await loadLocationModule();

        const result = await reverseGeocode({
            lat: 47.6205,
            lng: -122.3493,
            apiKey,
        });

        assert.ok(result, 'Expected a response object');
        assert.ok(Array.isArray(result.results));
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
}
