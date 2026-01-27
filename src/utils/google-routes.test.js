import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./google-routes.js')>} Module import.
 */
async function loadGoogleRoutesModule() {
    importCounter += 1;
    return import(`./google-routes.js?test=${importCounter}`);
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

test('computeRoute returns mapped routes', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { computeRoute } = await loadGoogleRoutesModule();

    let seenHeaders;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url, init) => {
            assert.equal(
                String(url),
                'https://routes.googleapis.com/directions/v2:computeRoutes'
            );
            seenHeaders = init?.headers;
            return makeJsonResponse({
                routes: [
                    {
                        distanceMeters: 1234,
                        duration: '165s',
                        polyline: { encodedPolyline: 'abcd' },
                        legs: [
                            {
                                steps: [
                                    {
                                        travelMode: 'WALK',
                                        distanceMeters: 100,
                                        staticDuration: '10s',
                                        navigationInstruction: {
                                            instructions: 'Head north',
                                            maneuver: 'TURN_LEFT',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        }
    );

    const result = await computeRoute({
        origin: { latLng: { lat: 47.61, lng: -122.33 } },
        destination: { latLng: { lat: 47.62, lng: -122.34 } },
    });

    assert.deepEqual(result, {
        route: {
            distanceMeters: 1234,
            duration: '165s',
            encodedPolyline: 'abcd',
            steps: [
                {
                    travelMode: 'WALK',
                    distanceMeters: 100,
                    duration: '10s',
                    navigationInstruction: {
                        instructions: 'Head north',
                        maneuver: 'TURN_LEFT',
                    },
                },
            ],
        },
        routes: [
            {
                distanceMeters: 1234,
                duration: '165s',
                encodedPolyline: 'abcd',
                steps: [
                    {
                        travelMode: 'WALK',
                        distanceMeters: 100,
                        duration: '10s',
                        navigationInstruction: {
                            instructions: 'Head north',
                            maneuver: 'TURN_LEFT',
                        },
                    },
                ],
            },
        ],
        raw: {
            routes: [
                {
                    distanceMeters: 1234,
                    duration: '165s',
                    polyline: { encodedPolyline: 'abcd' },
                    legs: [
                        {
                            steps: [
                                {
                                    travelMode: 'WALK',
                                    distanceMeters: 100,
                                    staticDuration: '10s',
                                    navigationInstruction: {
                                        instructions: 'Head north',
                                        maneuver: 'TURN_LEFT',
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    });
    assert.ok(seenHeaders);
    assert.equal(seenHeaders['X-Goog-Api-Key'], 'test-key');
    assert.equal(
        seenHeaders['X-Goog-FieldMask'],
        [
            'routes.duration',
            'routes.distanceMeters',
            'routes.polyline.encodedPolyline',
            'routes.legs.steps.travelMode',
            'routes.legs.steps.distanceMeters',
            'routes.legs.steps.staticDuration',
            'routes.legs.steps.navigationInstruction.instructions',
            'routes.legs.steps.navigationInstruction.maneuver',
            'routes.legs.steps.transitDetails',
        ].join(',')
    );
});

test('computeRoute sends option overrides in body', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { computeRoute } = await loadGoogleRoutesModule();

    /** @type {any} */
    let seenBody;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async (_url, init) => {
            seenBody = init?.body ? JSON.parse(String(init.body)) : null;
            return makeJsonResponse({ routes: [] });
        }
    );

    await computeRoute({
        origin: { latLng: { lat: 47.61, lng: -122.33 } },
        destination: { latLng: { lat: 47.62, lng: -122.34 } },
        travelMode: 'BICYCLE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: true,
        routeModifiers: {
            avoidTolls: true,
            avoidHighways: true,
            avoidFerries: true,
        },
        languageCode: 'en-US',
        units: 'IMPERIAL',
    });

    assert.deepEqual(seenBody, {
        origin: {
            location: {
                latLng: { latitude: 47.61, longitude: -122.33 },
            },
        },
        destination: {
            location: {
                latLng: { latitude: 47.62, longitude: -122.34 },
            },
        },
        travelMode: 'BICYCLE',
        routingPreference: 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: true,
        routeModifiers: {
            avoidTolls: true,
            avoidHighways: true,
            avoidFerries: true,
        },
        languageCode: 'en-US',
        units: 'IMPERIAL',
    });
});

test('computeRoute returns null when apiKey missing', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const { computeRoute } = await loadGoogleRoutesModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({ routes: [] });
        }
    );

    const result = await computeRoute({
        origin: { latLng: { lat: 47.61, lng: -122.33 } },
        destination: { latLng: { lat: 47.62, lng: -122.34 } },
    });

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('computeRoute returns null for invalid args', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { computeRoute } = await loadGoogleRoutesModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({ routes: [] });
        }
    );

    const result = await computeRoute({
        origin: { latLng: { lat: 47.61, lng: -122.33 } },
        destination: { latLng: { lat: 47.62, lng: -122.34 } },
        travelMode: /** @type {any} */ ('BOAT'),
    });

    assert.equal(result, null);
    assert.equal(calls, 0);
});

test('computeRoute caches responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { computeRoute } = await loadGoogleRoutesModule();

    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
                routes: [
                    {
                        distanceMeters: 555,
                        duration: '99s',
                        polyline: { encodedPolyline: 'cached' },
                        legs: [{ steps: [] }],
                    },
                ],
            });
        }
    );

    /** @type {import('./google-routes.js').ComputeRouteArgs} */
    const args = {
        origin: { latLng: { lat: 10, lng: 20 } },
        destination: { latLng: { lat: 11, lng: 21 } },
        routingPreference: 'TRAFFIC_AWARE',
    };

    const first = await computeRoute(args);
    const second = await computeRoute(args);

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
});

test('computeRoute returns null on non-ok response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const { computeRoute } = await loadGoogleRoutesModule();

    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse(null, {
                ok: false,
                status: 403,
                statusText: 'Forbidden',
            })
    );

    const result = await computeRoute({
        origin: { latLng: { lat: 10, lng: 20 } },
        destination: { latLng: { lat: 11, lng: 21 } },
    });

    assert.equal(result, null);
});
