import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./google-places-text-search.js')>} Module import.
 */
async function loadTextSearchModule() {
    importCounter += 1;
    return import(`./google-places-text-search.js?test=${importCounter}`);
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

test('googlePlacesTextSearch returns mapped places', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { googlePlacesTextSearch } = await loadTextSearchModule();

    let seenHeaders;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url, init) => {
            assert.equal(
                String(url),
                'https://places.googleapis.com/v1/places:searchText'
            );
            seenHeaders = init?.headers;
            return makeJsonResponse({
                places: [
                    {
                        id: 'abc',
                        displayName: { text: 'Cafe Luna' },
                        accessibilityOptions: { wheelchairAccessibleEntrance: true },
                        businessStatus: 'OPERATIONAL',
                        editorialSummary: { text: 'Cozy cafe.' },
                        delivery: true,
                        dineIn: true,
                        liveMusic: false,
                        outdoorSeating: true,
                        restroom: true,
                        takeout: true,
                        internationalPhoneNumber: '+1 206-555-0100',
                        goodForGroups: true,
                        goodForWatchingSports: false,
                        reservable: false,
                        types: ['cafe', 'restaurant'],
                        formattedAddress: '123 Main St, Seattle, WA',
                        location: { latitude: 47.61, longitude: -122.33 },
                        nationalPhoneNumber: '(206) 555-0100',
                        neighborhoodSummary: { text: 'Downtown' },
                        parkingOptions: { parkingLot: true },
                        priceLevel: 'PRICE_LEVEL_MODERATE',
                        rating: 4.6,
                        regularOpeningHours: { openNow: true },
                        servesBreakfast: true,
                        servesBrunch: true,
                        servesCoffee: true,
                        servesDessert: false,
                        servesDinner: true,
                        servesLunch: true,
                        googleMapsUri: 'https://maps.google.com/?q=Cafe+Luna',
                        websiteUri: 'https://cafeluna.example.com',
                    },
                ],
            });
        }
    );

    const result = await googlePlacesTextSearch({
        textQuery: 'cafe in Seattle',
        maxResultCount: 5,
    });

    assert.deepEqual(result, {
        places: [
            {
                id: 'abc',
                name: 'Cafe Luna',
                accessibilityOptions: { wheelchairAccessibleEntrance: true },
                businessStatus: 'OPERATIONAL',
                editorialSummary: { text: 'Cozy cafe.' },
                hasDelivery: true,
                hasDineIn: true,
                hasLiveMusic: false,
                hasOutdoorSeating: true,
                hasRestroom: true,
                hasTakeout: true,
                internationalPhoneNumber: '+1 206-555-0100',
                isGoodForGroups: true,
                isGoodForWatchingSports: false,
                isReservable: false,
                types: ['cafe', 'restaurant'],
                address: '123 Main St, Seattle, WA',
                location: { lat: 47.61, lng: -122.33 },
                nationalPhoneNumber: '(206) 555-0100',
                neighborhoodSummary: { text: 'Downtown' },
                parkingOptions: { parkingLot: true },
                priceLevel: 'PRICE_LEVEL_MODERATE',
                rating: 4.6,
                regularOpeningHours: { openNow: true },
                servesBreakfast: true,
                servesBrunch: true,
                servesCoffee: true,
                servesDessert: false,
                servesDinner: true,
                servesLunch: true,
                mapsUrl: 'https://maps.google.com/?q=Cafe+Luna',
                websiteURI: 'https://cafeluna.example.com',
            },
        ],
    });
    assert.ok(seenHeaders);
    assert.equal(seenHeaders['X-Goog-Api-Key'], 'test-key');
    assert.equal(
        seenHeaders['X-Goog-FieldMask'],
        [
            'places.id',
            'places.displayName',
            'places.accessibilityOptions',
            'places.businessStatus',
            'places.editorialSummary',
            'places.delivery',
            'places.dineIn',
            'places.liveMusic',
            'places.outdoorSeating',
            'places.restroom',
            'places.takeout',
            'places.internationalPhoneNumber',
            'places.goodForGroups',
            'places.goodForWatchingSports',
            'places.reservable',
            'places.types',
            'places.location',
            'places.nationalPhoneNumber',
            'places.neighborhoodSummary',
            'places.parkingOptions',
            'places.priceLevel',
            'places.rating',
            'places.regularOpeningHours',
            'places.servesBreakfast',
            'places.servesBrunch',
            'places.servesCoffee',
            'places.servesDessert',
            'places.servesDinner',
            'places.servesLunch',
            'places.formattedAddress',
            'places.googleMapsUri',
            'places.websiteUri',
        ].join(',')
    );
});

test('googlePlacesTextSearch returns null when apiKey missing', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { googlePlacesTextSearch } = await loadTextSearchModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({ places: [] });
        }
    );

    const result = await googlePlacesTextSearch({ textQuery: 'pizza' });

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('googlePlacesTextSearch caches responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { googlePlacesTextSearch } = await loadTextSearchModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
                places: [
                    {
                        id: 'cached',
                        displayName: { text: 'Cached Place' },
                        businessStatus: 'OPERATIONAL',
                        types: ['cafe'],
                        formattedAddress: '1 Cache Way',
                        location: { latitude: 10, longitude: 20 },
                        googleMapsUri: 'https://maps.google.com/?q=Cached',
                    },
                ],
            });
        }
    );

    const args = { textQuery: 'coffee', maxResultCount: 3 };

    const first = await googlePlacesTextSearch(args);
    const second = await googlePlacesTextSearch(args);

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
});

test('googlePlacesTextSearch prefers restriction over bias', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { googlePlacesTextSearch } = await loadTextSearchModule();

    /** @type {any} */
    let seenBody;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (_url, init) => {
            seenBody = init?.body ? JSON.parse(String(init.body)) : null;
            return makeJsonResponse({ places: [] });
        }
    );

    await googlePlacesTextSearch({
        textQuery: 'pizza',
        locationBias: { lat: 10.1, lng: 20.2 },
        locationRestriction: {
            center: { lat: 11.1, lng: 21.2 },
            radius_m: 1200,
        },
    });

    assert.ok(seenBody);
    assert.ok(seenBody.locationRestriction);
    assert.equal(seenBody.locationBias, undefined);
    assert.deepEqual(seenBody.locationRestriction.circle.center, {
        latitude: 11.1,
        longitude: 21.2,
    });
});
