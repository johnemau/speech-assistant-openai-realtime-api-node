import test from 'node:test';
import assert from 'node:assert/strict';

import { locationFromLatLng } from './location.js';

const originalFetch = globalThis.fetch;

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
});

test('locationFromLatLng returns userLocation and address', async () => {
    const geocodeJson = {
        results: [
            {
                formatted_address: '123 Main St, Minneapolis, MN 55401, USA',
                address_components: [
                    { long_name: '123', types: ['street_number'] },
                    { long_name: 'Main St', types: ['route'] },
                    { long_name: 'Minneapolis', types: ['locality'] },
                    {
                        long_name: 'Hennepin County',
                        types: ['administrative_area_level_2'],
                    },
                    {
                        long_name: 'Minnesota',
                        short_name: 'MN',
                        types: ['administrative_area_level_1'],
                    },
                    {
                        long_name: 'United States',
                        short_name: 'US',
                        types: ['country'],
                    },
                    { long_name: '55401', types: ['postal_code'] },
                ],
            },
        ],
    };

    const timezoneJson = {
        status: 'OK',
        timeZoneId: 'America/Chicago',
        timeZoneName: 'Central Standard Time',
    };

    globalThis.fetch = /** @type {typeof fetch} */ (
        async (url) => {
            if (String(url).includes('/geocode/')) {
                return makeJsonResponse(geocodeJson);
            }
            if (String(url).includes('/timezone/')) {
                return makeJsonResponse(timezoneJson);
            }
            return makeJsonResponse(null, {
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });
        }
    );

    const result = await locationFromLatLng({
        lat: 44.9778,
        lng: -93.265,
        apiKey: 'test-key',
    });

    assert.deepEqual(result.userLocation, {
        type: 'approximate',
        country: 'US',
        region: 'Minnesota',
        city: 'Minneapolis',
    });

    assert.deepEqual(result.address, {
        formattedAddress: '123 Main St, Minneapolis, MN 55401, USA',
        street: '123 Main St',
        city: 'Minneapolis',
        region: 'Minnesota',
        postalCode: '55401',
        country: 'United States',
        countryCode: 'US',
    });

    assert.equal(result.timezoneId, 'America/Chicago');
    assert.deepEqual(result.timezone, timezoneJson);
    assert.deepEqual(result.geocode, geocodeJson);
});

test('locationFromLatLng supports skipping timezone lookup', async () => {
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
                results: [
                    {
                        formatted_address: 'London, UK',
                        address_components: [
                            { long_name: 'London', types: ['postal_town'] },
                            {
                                long_name: 'England',
                                types: ['administrative_area_level_1'],
                            },
                            {
                                long_name: 'United Kingdom',
                                short_name: 'GB',
                                types: ['country'],
                            },
                        ],
                    },
                ],
            });
        }
    );

    const result = await locationFromLatLng({
        lat: 51.5074,
        lng: -0.1278,
        apiKey: 'test-key',
        includeTimezone: false,
    });

    assert.equal(calls, 1);
    assert.equal(result.timezone, undefined);
    assert.equal(result.timezoneId, undefined);
    assert.equal(result.userLocation.city, 'London');
    assert.equal(result.userLocation.country, 'GB');
});

test('locationFromLatLng throws on invalid lat/lng', async () => {
    await assert.rejects(
        () => locationFromLatLng({ lat: 200, lng: 0, apiKey: 'key' }),
        { message: 'lat and lng must be valid numbers.' }
    );
});

test('locationFromLatLng throws on non-ok response', async () => {
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse(null, {
                ok: false,
                status: 500,
                statusText: 'Server Error',
                text: async () => 'fail',
            })
    );

    await assert.rejects(
        () => locationFromLatLng({ lat: 44, lng: -93, apiKey: 'key' }),
        { message: 'HTTP 500 Server Error - fail' }
    );
});
