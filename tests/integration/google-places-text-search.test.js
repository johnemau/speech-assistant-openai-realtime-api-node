import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
const apiKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/utils/google-places-text-search.js')>} Module import.
 */
async function loadTextSearchModule() {
    importCounter += 1;
    return import(
        `../../src/utils/google-places-text-search.js?test=${importCounter}`
    );
}

if (!apiKey) {
    test(
        'googlePlacesTextSearch integration',
        { skip: 'Missing GOOGLE_MAPS_API_KEY in .env' },
        () => {}
    );
} else {
    test('googlePlacesTextSearch integration', async () => {
        const { googlePlacesTextSearch } = await loadTextSearchModule();

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
            assert.ok('accessibilityOptions' in place);
            assert.ok('businessStatus' in place);
            assert.ok('editorialSummary' in place);
            assert.ok('hasDelivery' in place);
            assert.ok('hasDineIn' in place);
            assert.ok('hasLiveMusic' in place);
            assert.ok('hasOutdoorSeating' in place);
            assert.ok('hasRestroom' in place);
            assert.ok('hasTakeout' in place);
            assert.ok('internationalPhoneNumber' in place);
            assert.ok('isGoodForGroups' in place);
            assert.ok('isGoodForWatchingSports' in place);
            assert.ok('isReservable' in place);
            assert.ok('types' in place);
            assert.ok('nationalPhoneNumber' in place);
            assert.ok('neighborhoodSummary' in place);
            assert.ok('parkingOptions' in place);
            assert.ok('priceLevel' in place);
            assert.ok('rating' in place);
            assert.ok('regularOpeningHours' in place);
            assert.ok('servesBreakfast' in place);
            assert.ok('servesBrunch' in place);
            assert.ok('servesCoffee' in place);
            assert.ok('servesDessert' in place);
            assert.ok('servesDinner' in place);
            assert.ok('servesLunch' in place);
            assert.ok('mapsUrl' in place);
            assert.ok('websiteURI' in place);

            if (place.types !== null) {
                assert.ok(Array.isArray(place.types));
            }

            assertNullableBoolean(place.hasDelivery);
            assertNullableBoolean(place.hasDineIn);
            assertNullableBoolean(place.hasLiveMusic);
            assertNullableBoolean(place.hasOutdoorSeating);
            assertNullableBoolean(place.hasRestroom);
            assertNullableBoolean(place.hasTakeout);
            assertNullableBoolean(place.isGoodForGroups);
            assertNullableBoolean(place.isGoodForWatchingSports);
            assertNullableBoolean(place.isReservable);
            assertNullableBoolean(place.servesBreakfast);
            assertNullableBoolean(place.servesBrunch);
            assertNullableBoolean(place.servesCoffee);
            assertNullableBoolean(place.servesDessert);
            assertNullableBoolean(place.servesDinner);
            assertNullableBoolean(place.servesLunch);

            if (place.rating !== null) {
                assert.equal(typeof place.rating, 'number');
            }
        }
    });

    test('googlePlacesTextSearch integration returns null with invalid key', async () => {
        process.env.GOOGLE_MAPS_API_KEY = 'invalid-key-for-integration-test';
        const { googlePlacesTextSearch } = await loadTextSearchModule();

        const result = await googlePlacesTextSearch({
            textQuery: 'Space Needle Seattle',
            maxResultCount: 1,
        });

        assert.equal(result, null);
        if (originalGoogleMapsKey == null) {
            delete process.env.GOOGLE_MAPS_API_KEY;
        } else {
            process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
        }
    });

    test('googlePlacesTextSearch integration returns null with invalid args', async () => {
        const { googlePlacesTextSearch } = await loadTextSearchModule();

        const result = await googlePlacesTextSearch({
            textQuery: ' ',
        });

        assert.equal(result, null);
    });
}

/**
 * @param {boolean|null} value - Value to validate.
 */
function assertNullableBoolean(value) {
    assert.ok(value === null || typeof value === 'boolean');
}
