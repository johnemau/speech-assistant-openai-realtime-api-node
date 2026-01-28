import test from 'node:test';
import assert from 'node:assert/strict';

const originalPrimaryNumbers = process.env.PRIMARY_USER_PHONE_NUMBERS;
const requiredPrimaryNumber = '+12065551234';
if (originalPrimaryNumbers) {
    if (!originalPrimaryNumbers.split(',').includes(requiredPrimaryNumber)) {
        process.env.PRIMARY_USER_PHONE_NUMBERS = `${originalPrimaryNumbers},${requiredPrimaryNumber}`;
    }
} else {
    process.env.PRIMARY_USER_PHONE_NUMBERS = requiredPrimaryNumber;
}

const {
    execute,
    resetWeatherForTests,
    setWeatherForTests,
    resetGetLatestTrackLocationForTests,
    setGetLatestTrackLocationForTests,
    resetGptWebSearchForTests,
    setGptWebSearchForTests,
} = await import('./weather.js');

test.afterEach(() => {
    resetWeatherForTests();
    resetGetLatestTrackLocationForTests();
    resetGptWebSearchForTests();
});

test.after(() => {
    if (originalPrimaryNumbers == null) {
        delete process.env.PRIMARY_USER_PHONE_NUMBERS;
    } else {
        process.env.PRIMARY_USER_PHONE_NUMBERS = originalPrimaryNumbers;
    }
});

test('weather.execute uses address for current conditions', async () => {
    /** @type {{ args?: any }} */
    const seen = {};
    setWeatherForTests({
        getCurrentConditions: async (args) => {
            seen.args = args;
            return {
                currentTime: '2024-01-01T00:00:00Z',
                timeZoneId: null,
                isDaytime: null,
                relativeHumidity: null,
                uvIndex: null,
                weather: null,
                temperature: null,
                feelsLikeTemperature: null,
                raw: null,
            };
        },
    });

    const result = /** @type {any} */ (
        await execute({
            args: { forecast_type: 'current', address: 'Seattle, WA' },
            context: {},
        })
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.forecast_type, 'current');
    assert.equal(seen.args.address, 'Seattle, WA');
    assert.equal(result.result.currentTime, '2024-01-01T00:00:00Z');
});

test('weather.execute uses tracked location for primary caller', async () => {
    /** @type {{ args?: any }} */
    const seen = {};
    setGetLatestTrackLocationForTests(async () => ({
        track: {
            latitude: 47.6,
            longitude: -122.3,
            unixTime: 1700000000,
            messageId: 'abc',
            messageType: 'TRACK',
        },
        location: {
            lat: 47.6,
            lng: -122.3,
            userLocation: {
                type: 'approximate',
                city: 'Seattle',
                region: 'Washington',
                country: 'US',
            },
            address: { formattedAddress: 'Seattle, WA' },
            geocode: {},
        },
    }));
    setWeatherForTests({
        getDailyForecast: async (args) => {
            seen.args = args;
            return {
                timeZoneId: null,
                nextPageToken: null,
                items: [],
                raw: null,
            };
        },
    });

    const result = /** @type {any} */ (
        await execute({
            args: { forecast_type: 'daily', days: 3 },
            context: { currentCallerE164: '+12065551234' },
        })
    );

    assert.equal(result.status, 'ok');
    assert.equal(result.forecast_type, 'daily');
    assert.equal(seen.args.lat, 47.6);
    assert.equal(seen.args.lng, -122.3);
});

test('weather.execute falls back to gpt_web_search when weather fails', async () => {
    setWeatherForTests({
        getCurrentConditions: async () => null,
    });
    setGptWebSearchForTests(async ({ args }) => ({
        status: 'ok',
        query: args?.query,
    }));

    const result = /** @type {any} */ (
        await execute({
            args: { address: 'Portland, OR' },
            context: {},
        })
    );

    assert.equal(result.status, 'fallback');
    assert.match(result.query, /Portland, OR/);
    assert.equal(result.web_search.status, 'ok');
});
