import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/address-lat-lng.js')>} Module import.
 */
async function loadAddressLatLngModule() {
    importCounter += 1;
    return import(`../../src/utils/address-lat-lng.js?test=${importCounter}`);
}

test('requires GOOGLE_MAPS_API_KEY', () => {
    assert.ok(
        apiKey,
        'GOOGLE_MAPS_API_KEY must be set in the environment or .env file.'
    );
});

test('getLatLngFromAddress integration', async () => {
    const { getLatLngFromAddress } = await loadAddressLatLngModule();

    const result = await getLatLngFromAddress('Space Needle Seattle');

    assert.ok(result, 'Expected coordinates');
    assert.equal(typeof result.lat, 'number');
    assert.equal(typeof result.lng, 'number');
    assert.ok(result.lat > 47 && result.lat < 48);
    assert.ok(result.lng < -121 && result.lng > -123);
});

test('getLatLngFromAddress integration returns null with invalid key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'invalid-key-for-integration-test';
    const { getLatLngFromAddress } = await loadAddressLatLngModule();

    const result = await getLatLngFromAddress('Space Needle Seattle');

    assert.equal(result, null);
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
});
