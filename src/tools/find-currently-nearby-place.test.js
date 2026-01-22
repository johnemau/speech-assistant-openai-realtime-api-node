import test from 'node:test';
import assert from 'node:assert/strict';

const {
    execute,
    resetFindCurrentlyNearbyPlacesForTests,
    setFindCurrentlyNearbyPlacesForTests,
} = await import('./find-currently-nearby-place.js');

test.afterEach(() => {
    resetFindCurrentlyNearbyPlacesForTests();
});

test('find-currently-nearby-place.execute defaults to 5 miles', async () => {
    /** @type {{ radius?: number, options?: any }} */
    const seen = {};
    setFindCurrentlyNearbyPlacesForTests(async (radius_m, options) => {
        seen.radius = radius_m;
        seen.options = options;
        return {
            places: [
                {
                    id: '1',
                    name: 'Place',
                    address: '123 Main',
                    location: { lat: 1, lng: 2 },
                    primaryType: 'restaurant',
                    mapsUrl: 'https://maps.example.com',
                },
            ],
        };
    });

    const res = await execute({
        args: { included_primary_types: ['restaurant'] },
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.radius_m, 8047);
    assert.equal(seen.radius, 8047);
    assert.deepEqual(seen.options.included_primary_types, ['restaurant']);
    assert.equal(res.places.length, 1);
});

test('find-currently-nearby-place.execute honors radius_miles', async () => {
    /** @type {{ radius?: number }} */
    const seen = {};
    setFindCurrentlyNearbyPlacesForTests(async (radius_m) => {
        seen.radius = radius_m;
        return { places: [] };
    });

    const res = await execute({
        args: { radius_miles: 2 },
    });

    assert.equal(res.status, 'ok');
    assert.equal(res.radius_m, 3219);
    assert.equal(seen.radius, 3219);
});

test('find-currently-nearby-place.execute returns unavailable when no location', async () => {
    setFindCurrentlyNearbyPlacesForTests(async () => null);

    const res = await execute({
        args: {},
    });

    assert.deepEqual(res, {
        status: 'unavailable',
        message: 'Current location not available.',
    });
});
