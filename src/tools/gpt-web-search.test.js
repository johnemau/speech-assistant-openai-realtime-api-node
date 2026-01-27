import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const originalPrimaryNumbers = process.env.PRIMARY_USER_PHONE_NUMBERS;
const requiredPrimaryNumber = '+12065551234';
if (originalPrimaryNumbers) {
    if (!originalPrimaryNumbers.split(',').includes(requiredPrimaryNumber)) {
        process.env.PRIMARY_USER_PHONE_NUMBERS = `${originalPrimaryNumbers},${requiredPrimaryNumber}`;
    }
} else {
    process.env.PRIMARY_USER_PHONE_NUMBERS = requiredPrimaryNumber;
}

const originalFetch = globalThis.fetch;
const originalSpotFeedId = process.env.SPOT_FEED_ID;
const originalSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;

const init = await import('../init.js');
const { execute } = await import('./gpt-web-search.js');
const { REALTIME_WEB_SEARCH_INSTRUCTIONS } =
    await import('../assistant/prompts.js');
const { DEFAULT_SMS_USER_LOCATION } =
    await import('../config/openai-models.js');
const { resetSpotCacheForTests } = await import('../utils/spot.js');

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
    if (originalGoogleMapsKey == null) {
        delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
        process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
    resetSpotCacheForTests();
});

test.after(() => {
    if (originalPrimaryNumbers == null) {
        delete process.env.PRIMARY_USER_PHONE_NUMBERS;
    } else {
        process.env.PRIMARY_USER_PHONE_NUMBERS = originalPrimaryNumbers;
    }
});

test('gpt-web-search.execute throws on missing query', async () => {
    const prevClient = init.openaiClient;
    init.setInitClients({
        openaiClient: { responses: { create: async () => ({}) } },
    });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { query: '' },
                    context: {},
                }),
            /Missing query/
        );
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});

test('gpt-web-search.execute calls OpenAI with default location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            /**
             * @param {any} req - OpenAI request payload.
             * @returns {Promise<{ output_text: string }>} OpenAI response.
             */
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            },
        },
    };
    const prevClient = init.openaiClient;
    init.setInitClients({ openaiClient });
    try {
        const out = await execute({
            args: { query: 'test' },
            context: {},
        });
        assert.deepEqual(out, { output_text: 'ok' });
        if (!payload) throw new Error('Missing payload');
        const req = /** @type {any} */ (payload);
        assert.equal(req.input, 'test');
        assert.equal(req.instructions, REALTIME_WEB_SEARCH_INSTRUCTIONS);
        assert.deepEqual(req.tools[0].user_location, DEFAULT_SMS_USER_LOCATION);
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});

test('gpt-web-search.execute uses tracked location when user_location missing', async () => {
    process.env.SPOT_FEED_ID = 'feed-id';
    process.env.SPOT_FEED_PASSWORD = 'feed-pass';
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';

    const geocodeJson = {
        results: [
            {
                formatted_address: '123 Main St, Minneapolis, MN 55401, USA',
                address_components: [
                    { long_name: '123', types: ['street_number'] },
                    { long_name: 'Main St', types: ['route'] },
                    { long_name: 'Minneapolis', types: ['locality'] },
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
            const urlString = String(url);
            if (urlString.includes('findmespot.com')) {
                return makeJsonResponse({
                    response: {
                        feedMessageResponse: {
                            messages: {
                                message: {
                                    messageType: 'TRACK',
                                    latitude: 44.9778,
                                    longitude: -93.265,
                                    unixTime: 1700000000,
                                    id: 'abc',
                                },
                            },
                        },
                    },
                });
            }
            if (urlString.includes('/geocode/')) {
                return makeJsonResponse(geocodeJson);
            }
            if (urlString.includes('/timezone/')) {
                return makeJsonResponse(timezoneJson);
            }
            return makeJsonResponse(null, {
                ok: false,
                status: 404,
                statusText: 'Not Found',
            });
        }
    );

    let payload = null;
    const openaiClient = {
        responses: {
            /**
             * @param {any} req - OpenAI request payload.
             * @returns {Promise<{ output_text: string }>} OpenAI response.
             */
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            },
        },
    };
    const prevClient = init.openaiClient;
    init.setInitClients({ openaiClient });
    try {
        const out = await execute({
            args: { query: 'test' },
            context: { currentCallerE164: '+12065551234' },
        });
        assert.deepEqual(out, { output_text: 'ok' });
        if (!payload) throw new Error('Missing payload');
        const req = /** @type {any} */ (payload);
        assert.deepEqual(req.tools[0].user_location, {
            type: 'approximate',
            country: 'US',
            region: 'Minnesota',
            city: 'Minneapolis',
        });
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});

test('gpt-web-search.execute uses explicit user_location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            /**
             * @param {any} req - OpenAI request payload.
             * @returns {Promise<{ output_text: string }>} OpenAI response.
             */
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            },
        },
    };
    const prevClient = init.openaiClient;
    init.setInitClients({ openaiClient });
    try {
        const out = await execute({
            args: {
                query: 'test',
                user_location: { type: 'approximate', country: 'FR' },
            },
            context: {},
        });
        assert.deepEqual(out, { output_text: 'ok' });
        if (!payload) throw new Error('Missing payload');
        const req = /** @type {any} */ (payload);
        assert.deepEqual(req.tools[0].user_location, {
            type: 'approximate',
            country: 'FR',
        });
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});
