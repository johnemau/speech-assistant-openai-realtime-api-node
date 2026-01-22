import test from 'node:test';
import assert from 'node:assert/strict';

import { getLatestTrackLatLng, resetSpotCacheForTests } from './spot.js';

const originalFetch = globalThis.fetch;

test.afterEach(() => {
    globalThis.fetch = originalFetch;
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng returns latest TRACK message', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return {
            ok: true,
            json: async () => ({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'TRACK',
                                latitude: 47.61,
                                longitude: -122.33,
                                unixTime: 1700000000,
                                id: 'abc',
                                messengerId: 'm1',
                                messengerName: 'Tracker',
                            },
                        },
                    },
                },
            }),
        };
    };

    const result = await getLatestTrackLatLng('feed-id', 'feed-pass');

    assert.deepEqual(result, {
        latitude: 47.61,
        longitude: -122.33,
        unixTime: 1700000000,
        messageId: 'abc',
        messengerId: 'm1',
        messengerName: 'Tracker',
        messageType: 'TRACK',
    });
    assert.equal(calls, 1);
});

test('spot.getLatestTrackLatLng returns null for non-TRACK', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            response: {
                feedMessageResponse: {
                    messages: {
                        message: {
                            messageType: 'OK',
                            latitude: 47.61,
                            longitude: -122.33,
                            unixTime: 1700000000,
                            id: 'abc',
                        },
                    },
                },
            },
        }),
    });

    const result = await getLatestTrackLatLng('feed-id', 'feed-pass');

    assert.equal(result, null);
});

test('spot.getLatestTrackLatLng returns null for invalid lat/lng', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            response: {
                feedMessageResponse: {
                    messages: {
                        message: {
                            messageType: 'TRACK',
                            latitude: 200,
                            longitude: -122.33,
                            unixTime: 1700000000,
                            id: 'abc',
                        },
                    },
                },
            },
        }),
    });

    const result = await getLatestTrackLatLng('feed-id', 'feed-pass');

    assert.equal(result, null);
});

test('spot.getLatestTrackLatLng returns cached value on fetch failure', async () => {
    globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
            response: {
                feedMessageResponse: {
                    messages: {
                        message: {
                            messageType: 'TRACK',
                            latitude: 40,
                            longitude: -70,
                            unixTime: 1700000000,
                            id: 'abc',
                        },
                    },
                },
            },
        }),
    });

    const first = await getLatestTrackLatLng('feed-id', 'feed-pass');

    globalThis.fetch = async () => {
        throw new Error('network');
    };

    const second = await getLatestTrackLatLng('feed-id', 'feed-pass', {
        force: true,
    });

    assert.deepEqual(second, first);
});

test('spot.getLatestTrackLatLng throttles repeated calls', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        return {
            ok: true,
            json: async () => ({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'TRACK',
                                latitude: 10,
                                longitude: 20,
                                unixTime: 1700000000,
                                id: 'abc',
                            },
                        },
                    },
                },
            }),
        };
    };

    const first = await getLatestTrackLatLng('feed-id', 'feed-pass');
    const second = await getLatestTrackLatLng('feed-id', 'feed-pass');

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
});
