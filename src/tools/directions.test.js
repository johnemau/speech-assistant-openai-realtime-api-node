import test from 'node:test';
import assert from 'node:assert/strict';

const {
    execute,
    setComputeRouteForTests,
    resetComputeRouteForTests,
    setGooglePlacesTextSearchForTests,
    resetGooglePlacesTextSearchForTests,
    setGetLatestTrackLatLngForTests,
    resetGetLatestTrackLatLngForTests,
} = await import('./directions.js');

test.afterEach(() => {
    resetComputeRouteForTests();
    resetGooglePlacesTextSearchForTests();
    resetGetLatestTrackLatLngForTests();
});

test('directions.execute resolves places and formats steps', async () => {
    setGetLatestTrackLatLngForTests(async () => {
        throw new Error('getLatestTrackLatLng should not be called');
    });

    setGooglePlacesTextSearchForTests(async ({ textQuery }) => {
        if (textQuery === 'Origin Place') {
            return {
                places: [
                    {
                        id: null,
                        name: null,
                        businessStatus: null,
                        address: null,
                        mapsUrl: null,
                        location: { lat: 47.61, lng: -122.33 },
                    },
                ],
            };
        }
        if (textQuery === 'Destination Place') {
            return {
                places: [
                    {
                        id: null,
                        name: null,
                        businessStatus: null,
                        address: null,
                        mapsUrl: null,
                        location: { lat: 47.62, lng: -122.34 },
                    },
                ],
            };
        }
        return { places: [] };
    });

    setComputeRouteForTests(async () => ({
        route: {
            distanceMeters: 1200,
            duration: '300s',
            encodedPolyline: 'abcd',
            steps: [
                {
                    navigationInstruction: {
                        instructions: 'Head <b>north</b>',
                        maneuver: 'TURN_LEFT',
                    },
                    distanceMeters: 200,
                    duration: '30s',
                },
                {
                    navigationInstruction: {
                        instructions: 'Turn right',
                    },
                },
            ],
        },
        routes: [
            {
                distanceMeters: 1200,
                duration: '300s',
                encodedPolyline: 'abcd',
                steps: [],
            },
        ],
        raw: { routes: [] },
    }));

    const res = await execute({
        args: {
            origin_place: 'Origin Place',
            destination_place: 'Destination Place',
        },
    });

    assert.equal(res.status, 'ok');
    if (res.status !== 'ok') throw new Error('Expected ok response');
    assert.deepEqual(res.directions, ['Head north (200 m, 30s)', 'Turn right']);
    assert.ok(res.route);
    if (!res.route) throw new Error('Expected route');
    assert.equal(res.route.distanceMeters, 1200);
});

test('directions.execute uses latest track when origin missing', async () => {
    setGetLatestTrackLatLngForTests(async () => ({
        latitude: 40,
        longitude: -70,
        unixTime: 1700000000,
        messageId: 'abc',
        messageType: 'TRACK',
    }));

    /** @type {any} */
    let seenArgs = null;
    setGooglePlacesTextSearchForTests(async ({ textQuery }) => {
        if (textQuery === 'Destination Place') {
            return {
                places: [
                    {
                        id: null,
                        name: null,
                        businessStatus: null,
                        address: null,
                        mapsUrl: null,
                        location: { lat: 41, lng: -71 },
                    },
                ],
            };
        }
        return { places: [] };
    });

    setComputeRouteForTests(async (args) => {
        seenArgs = args;
        return {
            route: {
                distanceMeters: 100,
                duration: '10s',
                encodedPolyline: null,
                steps: [],
            },
            routes: [],
            raw: { routes: [] },
        };
    });

    const res = await execute({
        args: { destination_place: 'Destination Place' },
    });

    assert.equal(res.status, 'ok');
    assert.ok(seenArgs);
    if (!seenArgs) throw new Error('Expected route args');
    assert.deepEqual(seenArgs.origin, { latLng: { lat: 40, lng: -70 } });
});

test('directions.execute returns unavailable when no origin available', async () => {
    setGetLatestTrackLatLngForTests(async () => null);
    setGooglePlacesTextSearchForTests(async ({ textQuery }) => {
        if (textQuery === 'Destination Place') {
            return {
                places: [
                    {
                        id: null,
                        name: null,
                        businessStatus: null,
                        address: null,
                        mapsUrl: null,
                        location: { lat: 41, lng: -71 },
                    },
                ],
            };
        }
        return { places: [] };
    });
    setComputeRouteForTests(async () => {
        throw new Error('computeRoute should not be called');
    });

    const res = await execute({
        args: { destination_place: 'Destination Place' },
    });

    assert.deepEqual(res, {
        status: 'unavailable',
        message: 'Directions unavailable.',
    });
});

test('directions.execute returns unavailable when computeRoute fails', async () => {
    setGetLatestTrackLatLngForTests(async () => ({
        latitude: 40,
        longitude: -70,
        unixTime: 1700000000,
        messageId: 'abc',
        messageType: 'TRACK',
    }));

    setGooglePlacesTextSearchForTests(async ({ textQuery }) => {
        if (textQuery === 'Destination Place') {
            return {
                places: [
                    {
                        id: null,
                        name: null,
                        businessStatus: null,
                        address: null,
                        mapsUrl: null,
                        location: { lat: 41, lng: -71 },
                    },
                ],
            };
        }
        return { places: [] };
    });

    setComputeRouteForTests(async () => null);

    const res = await execute({
        args: { destination_place: 'Destination Place' },
    });

    assert.deepEqual(res, {
        status: 'unavailable',
        message: 'Directions unavailable.',
    });
});
