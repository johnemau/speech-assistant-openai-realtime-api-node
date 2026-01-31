import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
const feedId = process.env.SPOT_FEED_ID;
const feedPassword = process.env.SPOT_FEED_PASSWORD;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/google-places-current.js')>} Module import.
 */
async function loadCurrentPlacesModule() {
    importCounter += 1;
    return import(
        `../../src/utils/google-places-current.js?test=${importCounter}`
    );
}

test('requires GOOGLE_MAPS_API_KEY', () => {
    assert.ok(
        apiKey,
        'GOOGLE_MAPS_API_KEY must be set in the environment or .env file.'
    );
});

test('requires SPOT_FEED_ID', () => {
    assert.ok(
        feedId,
        'SPOT_FEED_ID must be set in the environment or .env file.'
    );
});

test('requires SPOT_FEED_PASSWORD', () => {
    assert.ok(
        feedPassword,
        'SPOT_FEED_PASSWORD must be set in the environment or .env file.'
    );
});

test('findCurrentlyNearbyPlaces integration', async () => {
    const { findCurrentlyNearbyPlaces } = await loadCurrentPlacesModule();

    const result = await findCurrentlyNearbyPlaces(1000, {
        max_result_count: 3,
    });

    assert.ok(result, 'Expected a response object');
    assert.ok(Array.isArray(result.places), 'Expected places array');
});
