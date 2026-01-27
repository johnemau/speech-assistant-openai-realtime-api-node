import test from 'node:test';
import assert from 'node:assert/strict';

const {
    execute,
    setComputeRouteForTests,
    resetComputeRouteForTests,
    setGetLatestTrackLatLngForTests,
    resetGetLatestTrackLatLngForTests,
} = await import('./directions.js');

test.afterEach(() => {
    resetComputeRouteForTests();
    resetGetLatestTrackLatLngForTests();
});

test('directions.execute uses address inputs and formats steps', async () => {
    setGetLatestTrackLatLngForTests(async () => {
        throw new Error('getLatestTrackLatLng should not be called');
    });

    /** @type {any} */
    let seenArgs = null;
    setComputeRouteForTests(async (args) => {
        seenArgs = args;
        return {
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
        };
    });

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
    assert.ok(seenArgs);
    if (!seenArgs) throw new Error('Expected route args');
    assert.deepEqual(seenArgs.origin, { address: 'Origin Place' });
    assert.deepEqual(seenArgs.destination, { address: 'Destination Place' });
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
    assert.deepEqual(seenArgs.destination, { address: 'Destination Place' });
});

test('directions.execute returns unavailable when no origin available', async () => {
    setGetLatestTrackLatLngForTests(async () => null);
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

    setComputeRouteForTests(async () => null);

    const res = await execute({
        args: { destination_place: 'Destination Place' },
    });

    assert.deepEqual(res, {
        status: 'unavailable',
        message: 'Directions unavailable.',
    });
});
