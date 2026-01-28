import test from 'node:test';
import assert from 'node:assert/strict';

const originalFetch = globalThis.fetch;
const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('./spot.js')>} Spot module import.
 */
async function loadSpotModule() {
    importCounter += 1;
    return import(`./spot.js?test=${importCounter}`);
}

/**
 * @param {object} body - JSON body to return.
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
    if (originalSpotFeedId == null) {
        delete process.env.SPOT_FEED_ID;
    } else {
        process.env.SPOT_FEED_ID = originalSpotFeedId;
    }
    if (originalSpotFeedPassword == null) {
        delete process.env.SPOT_FEED_PASSWORD;
    } else {
        process.env.SPOT_FEED_PASSWORD = originalSpotFeedPassword;
    }
});

test('spot.getLatestTrackLatLng returns latest message', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
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
            });
        }
    );

    const result = await getLatestTrackLatLng();

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
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng returns message for non-TRACK', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
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
            })
    );

    const result = await getLatestTrackLatLng();

    assert.deepEqual(result, {
        latitude: 47.61,
        longitude: -122.33,
        unixTime: 1700000000,
        messageId: 'abc',
        messengerId: undefined,
        messengerName: undefined,
        messageType: 'OK',
    });
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng returns null for invalid lat/lng', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
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
            })
    );

    const result = await getLatestTrackLatLng();

    assert.equal(result, null);
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng handles array messages', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: [
                                {
                                    messageType: 'NEWMOVEMENT',
                                    latitude: 47.6619,
                                    longitude: -122.09937,
                                    unixTime: 1769584287,
                                    id: 2400736677,
                                    messengerId: '0-5074124',
                                    messengerName: 'NimbusNode',
                                },
                            ],
                        },
                    },
                },
            })
    );

    const result = await getLatestTrackLatLng();

    assert.deepEqual(result, {
        latitude: 47.6619,
        longitude: -122.09937,
        unixTime: 1769584287,
        messageId: '2400736677',
        messengerId: '0-5074124',
        messengerName: 'NimbusNode',
        messageType: 'NEWMOVEMENT',
    });
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng returns cached value on fetch failure', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
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
            })
    );

    const first = await getLatestTrackLatLng();

    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            throw new Error('network');
        }
    );

    const second = await getLatestTrackLatLng({ force: true });

    assert.deepEqual(second, first);
    resetSpotCacheForTests();
});

test('spot.getLatestTrackLatLng throttles repeated calls', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackLatLng, resetSpotCacheForTests } =
        await loadSpotModule();
    let calls = 0;
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () => {
            calls += 1;
            return makeJsonResponse({
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
            });
        }
    );

    const first = await getLatestTrackLatLng();
    const second = await getLatestTrackLatLng();

    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    resetSpotCacheForTests();
});

test('spot.getLatestTrackTimezone returns IANA timezone', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    const { getLatestTrackTimezone, resetSpotCacheForTests } =
        await loadSpotModule();
    globalThis.fetch = /** @type {typeof fetch} */ (
        async () =>
            makeJsonResponse({
                response: {
                    feedMessageResponse: {
                        messages: {
                            message: {
                                messageType: 'TRACK',
                                latitude: 47.61,
                                longitude: -122.33,
                                unixTime: 1700000000,
                                id: 'abc',
                            },
                        },
                    },
                },
            })
    );

    const result = await getLatestTrackTimezone();

    assert.equal(result?.timezoneId, 'America/Los_Angeles');
    assert.equal(result?.track?.messageId, 'abc');
    resetSpotCacheForTests();
});
