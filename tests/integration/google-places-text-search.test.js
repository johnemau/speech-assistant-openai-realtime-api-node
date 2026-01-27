import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey) {
    test('googlePlacesTextSearch integration', { skip: 'Missing GOOGLE_MAPS_API_KEY in .env' }, () => {});
} else {
    test('googlePlacesTextSearch integration', async () => {
        const { googlePlacesTextSearch } = await import(
            '../../src/utils/google-places-text-search.js'
        );

        const result = await googlePlacesTextSearch({
            textQuery: 'Space Needle Seattle',
            maxResultCount: 3,
        });

        assert.ok(result, 'Expected a response object');
        assert.ok(Array.isArray(result.places), 'Expected places array');
        for (const place of result.places) {
            assert.ok(place.id);
            assert.ok(place.name);
            assert.ok(place.address);
            assert.ok(place.location);
            assert.equal(typeof place.location.lat, 'number');
            assert.equal(typeof place.location.lng, 'number');
        }
    });
}
