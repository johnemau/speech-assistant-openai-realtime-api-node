import test from 'node:test';
import assert from 'node:assert/strict';

import {
    execute,
    resetGetCurrentTimeDepsForTests,
    setGetCurrentTimeDepsForTests,
} from './get-current-time.js';

test.afterEach(() => {
    resetGetCurrentTimeDepsForTests();
});

test('get-current-time.execute formats resolved timezone', async () => {
    setGetCurrentTimeDepsForTests({
        resolveTimeZoneId: async () => ({
            timeZoneId: 'Europe/Paris',
            source: 'location',
        }),
        formatDateTimeWithTimeZone: ({ timeZone } = {}) => `time:${timeZone}`,
    });

    const result = await execute({
        args: { location: 'France' },
        context: { currentCallerE164: '+12065550100' },
    });

    assert.equal(result, 'time:Europe/Paris');
});

test('get-current-time.execute falls back on formatter error', async () => {
    let callCount = 0;
    setGetCurrentTimeDepsForTests({
        resolveTimeZoneId: async () => ({
            timeZoneId: 'Invalid/Zone',
            source: 'explicit_time_zone',
        }),
        formatDateTimeWithTimeZone: ({ timeZone } = {}) => {
            callCount += 1;
            if (callCount === 1) throw new Error('bad tz');
            return `time:${timeZone}`;
        },
    });

    const result = await execute({
        args: { time_zone: 'Invalid/Zone' },
        context: { currentCallerE164: null },
    });

    assert.equal(result, 'time:America/Los_Angeles');
});
