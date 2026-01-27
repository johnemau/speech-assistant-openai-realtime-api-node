import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/google-routes.js')>} Module import.
 */
async function loadRoutesModule() {
    importCounter += 1;
    return import(`../../src/utils/google-routes.js?test=${importCounter}`);
}

if (!apiKey) {
    test('computeRoute integration', { skip: 'Missing GOOGLE_MAPS_API_KEY in .env' }, () => {});
} else {
    test('computeRoute integration', async () => {
        const { computeRoute } = await loadRoutesModule();

        const result = await computeRoute({
            origin: { address: 'Space Needle, Seattle, WA' },
            destination: { address: 'Pike Place Market, Seattle, WA' },
            travelMode: 'DRIVE',
        });

        assert.ok(result, 'Expected a response object');
        assert.ok(Array.isArray(result.routes), 'Expected routes array');
        assert.ok('route' in result);
        assert.ok('raw' in result);

        if (result.route) {
            assert.ok('distanceMeters' in result.route);
            assert.ok('duration' in result.route);
            assert.ok('encodedPolyline' in result.route);
            assert.ok(Array.isArray(result.route.steps));

            if (result.route.distanceMeters !== null) {
                assert.equal(typeof result.route.distanceMeters, 'number');
            }
            if (result.route.duration !== null) {
                assert.equal(typeof result.route.duration, 'string');
            }
            if (result.route.encodedPolyline !== null) {
                assert.equal(typeof result.route.encodedPolyline, 'string');
            }
        }
    });

    test('computeRoute integration returns null with invalid key', async () => {
        process.env.GOOGLE_MAPS_API_KEY = 'invalid-key-for-integration-test';
        const { computeRoute } = await loadRoutesModule();

        try {
            const result = await computeRoute({
                origin: { address: 'Space Needle, Seattle, WA' },
                destination: { address: 'Pike Place Market, Seattle, WA' },
            });

            assert.equal(result, null);
        } finally {
            if (originalGoogleMapsKey == null) {
                delete process.env.GOOGLE_MAPS_API_KEY;
            } else {
                process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
            }
        }
    });

    test('computeRoute integration returns null with invalid args', async () => {
        const { computeRoute } = await loadRoutesModule();

        const result = await computeRoute({
            origin: { address: '' },
            destination: { address: 'Pike Place Market, Seattle, WA' },
        });

        assert.equal(result, null);
    });
}
