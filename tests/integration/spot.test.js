import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
const feedId = process.env.SPOT_FEED_ID;
const feedPassword = process.env.SPOT_FEED_PASSWORD;
let importCounter = 0;

/**
 * @returns {string} SPOT feed ID.
 */
function requireFeedId() {
    assert.ok(
        feedId,
        'SPOT_FEED_ID must be set in the environment or .env file.'
    );
    return /** @type {string} */ (feedId);
}

/**
 * @returns {string} SPOT feed password.
 */
function requireFeedPassword() {
    assert.ok(
        feedPassword,
        'SPOT_FEED_PASSWORD must be set in the environment or .env file.'
    );
    return /** @type {string} */ (feedPassword);
}

/**
 * @returns {Promise<typeof import('../../src/utils/spot.js')>} Module import.
 */
async function loadSpotModule() {
    importCounter += 1;
    return import(`../../src/utils/spot.js?test=${importCounter}`);
}

test.afterEach(async () => {
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

    const { resetSpotCacheForTests } = await loadSpotModule();
    resetSpotCacheForTests();
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

test('getLatestTrackLatLng integration', async () => {
    process.env.SPOT_FEED_ID = requireFeedId();
    process.env.SPOT_FEED_PASSWORD = requireFeedPassword();
    const { getLatestTrackLatLng } = await loadSpotModule();

    const result = await getLatestTrackLatLng({ force: true });

    assert.ok(result, 'Expected latest track result');
    assert.equal(typeof result.latitude, 'number');
    assert.equal(typeof result.longitude, 'number');
    assert.equal(typeof result.unixTime, 'number');
    assert.equal(typeof result.messageId, 'string');
    if (result.messageType != null) {
        assert.equal(typeof result.messageType, 'string');
    }
});

test('getLatestTrackTimezone integration', async () => {
    process.env.SPOT_FEED_ID = requireFeedId();
    process.env.SPOT_FEED_PASSWORD = requireFeedPassword();
    const { getLatestTrackTimezone } = await loadSpotModule();

    const result = await getLatestTrackTimezone({ force: true });

    assert.ok(result, 'Expected timezone result');
    assert.equal(typeof result.timezoneId, 'string');
    assert.equal(typeof result.track.latitude, 'number');
    assert.equal(typeof result.track.longitude, 'number');
});

test('getLatestTrackLatLng integration handles invalid password', async () => {
    process.env.SPOT_FEED_ID = requireFeedId();
    process.env.SPOT_FEED_PASSWORD = 'invalid-password-for-test';
    const { getLatestTrackLatLng } = await loadSpotModule();

    const result = await getLatestTrackLatLng({ force: true });

    assert.equal(result, null);
});
