import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const { buildPageCallTwiml, placePageCall, isWithinCallingHours } =
    await import('./page-call.js');

// --- buildPageCallTwiml ---

test('buildPageCallTwiml: includes page message three times', () => {
    const twiml = buildPageCallTwiml('Server down');
    assert.match(twiml, /<Response>/);
    assert.match(twiml, /Urgent page\. Server down/);
    // Two "Repeating" occurrences
    const repeats = twiml.match(/Repeating\. Server down/g);
    assert.equal(repeats?.length, 2, 'Expected two "Repeating" occurrences');
    assert.match(twiml, /Press any key to hear the message again/);
    assert.match(twiml, /<\/Response>/);
});

test('buildPageCallTwiml: adds Gather with action when repeatUrl provided', () => {
    const twiml = buildPageCallTwiml('Alert!', {
        repeatUrl: 'https://example.com/page-repeat?message=Alert!',
    });
    assert.match(twiml, /<Gather/);
    assert.match(twiml, /action="https:\/\/example\.com\/page-repeat/);
    assert.match(twiml, /Press any key to hear the message again/);
});

test('buildPageCallTwiml: omits Gather when no repeatUrl', () => {
    const twiml = buildPageCallTwiml('No URL');
    assert.ok(!twiml.includes('<Gather'), 'Should not contain <Gather>');
    assert.match(twiml, /Press any key to hear the message again/);
});

// --- placePageCall ---

test('placePageCall: calls first primary number', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '+12065550100,+12065550101';
    /** @type {any[]} */
    const calls = [];
    const mockClient = {
        calls: {
            create: async (/** @type {any} */ params) => {
                calls.push(params);
                return { sid: 'CA1', status: 'queued' };
            },
        },
    };
    try {
        const result = await placePageCall({
            pageMessage: 'Alert!',
            fromNumber: '+15550001234',
            client: mockClient,
        });
        assert.equal(result.to, '+12065550100');
        assert.equal(result.sid, 'CA1');
        assert.equal(calls.length, 1);
        assert.match(calls[0].twiml, /Urgent page\. Alert!/);
        assert.equal(calls[0].from, '+15550001234');
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});

test('placePageCall: returns error when no primary numbers configured', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '';
    const env = await import('../env.js');
    const savedEntries = [...env.PRIMARY_CALLERS_SET];
    env.PRIMARY_CALLERS_SET.clear();
    const mockClient = {
        calls: { create: async () => ({}) },
    };
    try {
        const result = await placePageCall({
            pageMessage: 'test',
            fromNumber: '+15550001234',
            client: mockClient,
        });
        assert.equal(result.to, '');
        assert.match(result.error || '', /No primary caller/);
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
        savedEntries.forEach((v) => env.PRIMARY_CALLERS_SET.add(v));
    }
});

test('placePageCall: captures call errors gracefully', async () => {
    const prev = process.env.PRIMARY_USER_PHONE_NUMBERS;
    process.env.PRIMARY_USER_PHONE_NUMBERS = '+12065550100';
    const mockClient = {
        calls: {
            create: async () => {
                throw new Error('call failed');
            },
        },
    };
    try {
        const result = await placePageCall({
            pageMessage: 'fail test',
            fromNumber: '+15550001234',
            client: mockClient,
        });
        assert.equal(result.to, '+12065550100');
        assert.equal(result.error, 'call failed');
    } finally {
        if (prev == null) delete process.env.PRIMARY_USER_PHONE_NUMBERS;
        else process.env.PRIMARY_USER_PHONE_NUMBERS = prev;
    }
});

// --- isWithinCallingHours ---

/**
 * Create a Date that corresponds to a specific hour in the given timezone.
 * @param {number} targetHour - The desired local hour (0-23).
 * @param {string} timeZone - IANA timezone.
 * @returns {Date} A Date whose local representation in the given timezone equals the target hour.
 */
function dateAtLocalHour(targetHour, timeZone) {
    const base = new Date('2026-03-21T12:00:00Z');
    const currentHour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            hour12: false,
        }).format(base)
    );
    const diff = targetHour - currentHour;
    return new Date(base.getTime() + diff * 60 * 60 * 1000);
}

test('isWithinCallingHours: returns allowed=true at 7 AM', async () => {
    const tz = 'America/Los_Angeles';
    const now = dateAtLocalHour(7, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'default',
        }),
    });
    assert.equal(result.allowed, true);
    assert.equal(result.hour, 7);
    assert.equal(result.timeZoneId, tz);
});

test('isWithinCallingHours: returns allowed=true at 7:59 PM (hour 19)', async () => {
    const tz = 'America/New_York';
    const now = dateAtLocalHour(19, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'spot',
        }),
    });
    assert.equal(result.allowed, true);
    assert.equal(result.hour, 19);
});

test('isWithinCallingHours: returns allowed=false at 8 PM (hour 20)', async () => {
    const tz = 'America/Los_Angeles';
    const now = dateAtLocalHour(20, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'default',
        }),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.hour, 20);
});

test('isWithinCallingHours: returns allowed=false at 6 AM', async () => {
    const tz = 'America/Los_Angeles';
    const now = dateAtLocalHour(6, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'default',
        }),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.hour, 6);
});

test('isWithinCallingHours: returns allowed=false at midnight', async () => {
    const tz = 'America/Chicago';
    const now = dateAtLocalHour(0, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'spot',
        }),
    });
    assert.equal(result.allowed, false);
    assert.equal(result.hour, 0);
});

test('isWithinCallingHours: returns allowed=true at noon', async () => {
    const tz = 'America/Denver';
    const now = dateAtLocalHour(12, tz);
    const result = await isWithinCallingHours({
        now,
        resolveTimeZoneIdFn: async () => ({
            timeZoneId: tz,
            source: 'spot',
        }),
    });
    assert.equal(result.allowed, true);
    assert.equal(result.hour, 12);
});
