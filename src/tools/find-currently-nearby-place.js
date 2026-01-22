import { findCurrentlyNearbyPlaces as realFindCurrentlyNearbyPlaces } from '../utils/google-places-current.js';

const METERS_PER_MILE = 1609.344;
const DEFAULT_RADIUS_MILES = 5;
const DEFAULT_RADIUS_M = Math.round(METERS_PER_MILE * DEFAULT_RADIUS_MILES);
const LOCATION_UNAVAILABLE_MESSAGE = 'Current location not available.';

/** @type {typeof realFindCurrentlyNearbyPlaces} */
let findCurrentlyNearbyPlacesImpl = realFindCurrentlyNearbyPlaces;

export const definition = {
    type: 'function',
    name: 'find_currently_nearby_place',
    parameters: {
        type: 'object',
        properties: {
            radius_miles: {
                type: 'number',
                description:
                    'Search radius in miles. Defaults to 5 miles when omitted.',
            },
            radius_m: {
                type: 'number',
                description:
                    'Search radius in meters (1..50000). Overrides radius_miles when provided.',
            },
            included_primary_types: {
                type: 'array',
                description:
                    'Places (New) primary types the user is looking for (e.g., ["restaurant"]).',
                items: { type: 'string' },
            },
            max_result_count: {
                type: 'number',
                description: 'Max results (1..20).',
            },
            rank_preference: {
                type: 'string',
                description:
                    'Result ranking preference: POPULARITY or DISTANCE.',
            },
            language_code: {
                type: 'string',
                description: 'BCP-47 language code, e.g., "en".',
            },
            region_code: {
                type: 'string',
                description: 'CLDR region code, e.g., "US".',
            },
        },
    },
    description:
        'Find places near the caller’s current tracked location. Defaults to a 5 mile radius when radius is not provided.',
};

/**
 * Execute find_currently_nearby_place tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ radius_miles?: number, radius_m?: number, included_primary_types?: string[], max_result_count?: number, rank_preference?: "POPULARITY"|"DISTANCE", language_code?: string, region_code?: string }} root0.args - Tool arguments.
 * @returns {Promise<{ status: 'ok', radius_m: number, places: import('../utils/google-places.js').NearbyPlace[] } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args }) {
    const radiusMetersRaw = Number.isFinite(args?.radius_m)
        ? Number(args?.radius_m)
        : null;
    const radiusMilesRaw = Number.isFinite(args?.radius_miles)
        ? Number(args?.radius_miles)
        : null;

    let radius_m = DEFAULT_RADIUS_M;
    if (Number.isFinite(radiusMetersRaw)) {
        radius_m = Number(radiusMetersRaw);
    } else if (Number.isFinite(radiusMilesRaw)) {
        radius_m = Math.round(Number(radiusMilesRaw) * METERS_PER_MILE);
    }

    if (!Number.isFinite(radius_m) || radius_m <= 0 || radius_m > 50000) {
        throw new Error('Invalid radius; must be between 1 and 50000 meters.');
    }

    const result = await findCurrentlyNearbyPlacesImpl(radius_m, {
        included_primary_types: Array.isArray(args?.included_primary_types)
            ? args?.included_primary_types
            : undefined,
        max_result_count: Number.isFinite(args?.max_result_count)
            ? Number(args?.max_result_count)
            : undefined,
        rank_preference:
            args?.rank_preference === 'POPULARITY' ||
            args?.rank_preference === 'DISTANCE'
                ? args.rank_preference
                : undefined,
        language_code: args?.language_code || undefined,
        region_code: args?.region_code || undefined,
    });

    if (!result) {
        return {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        };
    }

    return {
        status: 'ok',
        radius_m,
        places: result.places,
    };
}

/**
 * Test-only override for findCurrentlyNearbyPlaces.
 * @param {typeof realFindCurrentlyNearbyPlaces} override - Replacement implementation.
 */
export function setFindCurrentlyNearbyPlacesForTests(override) {
    findCurrentlyNearbyPlacesImpl = override || realFindCurrentlyNearbyPlaces;
}

/** Restore the default findCurrentlyNearbyPlaces implementation. */
export function resetFindCurrentlyNearbyPlacesForTests() {
    findCurrentlyNearbyPlacesImpl = realFindCurrentlyNearbyPlaces;
}
