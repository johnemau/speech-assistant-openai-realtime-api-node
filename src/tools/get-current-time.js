import { IS_DEV } from '../env.js';
import { formatDateTimeWithTimeZone } from '../utils/calls.js';
import { resolveTimeZoneId } from '../utils/time.js';

/** @type {typeof resolveTimeZoneId} */
let resolveTimeZoneIdImpl = resolveTimeZoneId;

/** @type {typeof formatDateTimeWithTimeZone} */
let formatDateTimeWithTimeZoneImpl = formatDateTimeWithTimeZone;

export const definition = {
    type: 'function',
    name: 'get_current_time',
    parameters: {
        type: 'object',
        properties: {
            time_zone: {
                type: 'string',
                description: 'Optional IANA time zone override.',
            },
            location: {
                type: 'string',
                description: 'Optional place or address to resolve timezone.',
            },
            location_latlng: {
                type: 'object',
                description: 'Optional lat/lng pair for timezone lookup.',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            lat: {
                type: 'number',
                description: 'Optional latitude (-90..90).',
            },
            lng: {
                type: 'number',
                description: 'Optional longitude (-180..180).',
            },
        },
        additionalProperties: false,
    },
    description:
        'Get the current local time for time-sensitive requests. Accepts an optional IANA time zone, place name/business address, or coordinates. Defaults to America/Los_Angeles (PDT/PST) when no timezone can be resolved.',
};

/**
 * Execute get_current_time tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ time_zone?: string, location?: string, location_latlng?: { lat?: number, lng?: number }, lat?: number, lng?: number }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<string>} Current time string.
 */
export async function execute({ args, context }) {
    const rawArgs = args ?? {};
    const timeZone =
        typeof rawArgs.time_zone === 'string' ? rawArgs.time_zone.trim() : '';
    const location =
        typeof rawArgs.location === 'string' ? rawArgs.location.trim() : '';

    const locationLatLng = rawArgs.location_latlng;
    const lat = Number.isFinite(rawArgs?.lat) ? Number(rawArgs.lat) : undefined;
    const lng = Number.isFinite(rawArgs?.lng) ? Number(rawArgs.lng) : undefined;

    const callerE164 = context?.currentCallerE164 || null;

    const { timeZoneId, source } = await resolveTimeZoneIdImpl({
        timeZone,
        location,
        lat,
        lng,
        locationLatLng,
        callerE164,
    });

    let formatted;
    try {
        formatted = formatDateTimeWithTimeZoneImpl({ timeZone: timeZoneId });
    } catch (error) {
        if (IS_DEV) {
            console.warn('get_current_time: invalid timezone, using default', {
                timeZoneId,
                message: error instanceof Error ? error.message : String(error),
            });
        }
        formatted = formatDateTimeWithTimeZoneImpl({
            timeZone: 'America/Los_Angeles',
        });
    }

    if (IS_DEV) {
        console.log('get_current_time: resolved', {
            timeZoneId,
            source,
            formatted,
        });
    }

    return formatted;
}

/**
 * Test-only dependency overrides.
 *
 * @param {object} overrides - Override implementations.
 * @param {typeof resolveTimeZoneId} [overrides.resolveTimeZoneId] - Resolver override.
 * @param {typeof formatDateTimeWithTimeZone} [overrides.formatDateTimeWithTimeZone] - Formatter override.
 */
export function setGetCurrentTimeDepsForTests({
    resolveTimeZoneId: resolveOverride,
    formatDateTimeWithTimeZone: formatOverride,
} = {}) {
    if (resolveOverride) resolveTimeZoneIdImpl = resolveOverride;
    if (formatOverride) formatDateTimeWithTimeZoneImpl = formatOverride;
}

/**
 * Reset test overrides.
 */
export function resetGetCurrentTimeDepsForTests() {
    resolveTimeZoneIdImpl = resolveTimeZoneId;
    formatDateTimeWithTimeZoneImpl = formatDateTimeWithTimeZone;
}
