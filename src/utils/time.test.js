import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTimeZoneId } from './time.js';

test('resolveTimeZoneId returns explicit timezone', async () => {
    const result = await resolveTimeZoneId({
        timeZone: 'Europe/Paris',
        fallbackTimeZone: 'America/Los_Angeles',
        getLatLngFromAddressFn: async () => {
            throw new Error('should not be called');
        },
        locationFromLatLngFn: async () => {
            throw new Error('should not be called');
        },
    });

    assert.deepEqual(result, {
        timeZoneId: 'Europe/Paris',
        source: 'explicit_time_zone',
    });
});

test('resolveTimeZoneId resolves from location string', async () => {
    const result = await resolveTimeZoneId({
        location: 'France',
        fallbackTimeZone: 'America/Los_Angeles',
        getLatLngFromAddressFn: async () => ({ lat: 48.8566, lng: 2.3522 }),
        locationFromLatLngFn: async () => ({ timezoneId: 'Europe/Paris' }),
        getLatestTrackTimezoneFn: async () => ({
            timezoneId: 'America/New_York',
        }),
    });

    assert.deepEqual(result, {
        timeZoneId: 'Europe/Paris',
        source: 'location',
    });
});

test('resolveTimeZoneId resolves from coordinates', async () => {
    const result = await resolveTimeZoneId({
        lat: 40.7128,
        lng: -74.006,
        fallbackTimeZone: 'America/Los_Angeles',
        locationFromLatLngFn: async () => ({ timezoneId: 'America/New_York' }),
    });

    assert.deepEqual(result, {
        timeZoneId: 'America/New_York',
        source: 'coordinates',
    });
});

test('resolveTimeZoneId uses SPOT for primary caller', async () => {
    const result = await resolveTimeZoneId({
        callerE164: '+12065550100',
        fallbackTimeZone: 'America/Los_Angeles',
        isPrimaryCallerFn: () => true,
        getSpotFeedIdFn: () => 'spot-id',
        getSpotFeedPasswordFn: () => 'spot-pass',
        getLatestTrackTimezoneFn: async () => ({
            timezoneId: 'America/Chicago',
        }),
    });

    assert.deepEqual(result, {
        timeZoneId: 'America/Chicago',
        source: 'spot',
    });
});

test('resolveTimeZoneId falls back to default on lookup failure', async () => {
    const result = await resolveTimeZoneId({
        location: 'Nowhere',
        fallbackTimeZone: 'America/Los_Angeles',
        getLatLngFromAddressFn: async () => ({ lat: 1, lng: 2 }),
        locationFromLatLngFn: async () => {
            throw new Error('lookup failed');
        },
    });

    assert.deepEqual(result, {
        timeZoneId: 'America/Los_Angeles',
        source: 'default',
    });
});
