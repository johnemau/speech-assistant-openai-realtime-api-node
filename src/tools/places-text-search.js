import { googlePlacesTextSearch as realGooglePlacesTextSearch } from '../utils/google-places-text-search.js';

const DEFAULT_MAX_RESULT_COUNT = 10;
const PLACES_UNAVAILABLE_MESSAGE = 'Places search unavailable.';

/** @type {typeof realGooglePlacesTextSearch} */
let googlePlacesTextSearchImpl = realGooglePlacesTextSearch;

export const definition = {
    type: 'function',
    name: 'places_text_search',
    parameters: {
        type: 'object',
        properties: {
            text_query: {
                type: 'string',
                description:
                    'Search query for places, e.g., "shaved ice in Tucson" or a phone number.',
            },
            included_type: {
                type: 'string',
                description:
                    'Restrict results to a single includedType (Places API), e.g., "cafe".',
            },
            use_strict_type_filtering: {
                type: 'boolean',
                description:
                    'Whether to strictly enforce includedType. Default false.',
            },
            is_open_now: {
                type: 'boolean',
                description: 'Only return places that are open now.',
            },
            min_rating: {
                type: 'number',
                description: 'Minimum rating (typically 1..5).',
            },
            max_result_count: {
                type: 'number',
                description: 'Max results (1..20). Default 10.',
            },
            language: {
                type: 'string',
                description: 'BCP-47 language tag (e.g., "en-US").',
            },
            region: {
                type: 'string',
                description: 'Region code (e.g., "us").',
            },
            location_bias: {
                type: 'object',
                description:
                    'Bias results toward a point (lat/lng). Use with current location for "near me" queries.',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            location_restriction: {
                type: 'object',
                description:
                    'Restrict results to a circle defined by center and radius_m (meters).',
                properties: {
                    center: {
                        type: 'object',
                        properties: {
                            lat: { type: 'number' },
                            lng: { type: 'number' },
                        },
                    },
                    radius_m: { type: 'number' },
                },
            },
        },
        required: ['text_query'],
    },
    description:
        'Text search for places using Google Places API (New). Use for queries like "coffee shops in Seattle" or "shaved ice in Tucson".',
};

/**
 * Execute places_text_search tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ text_query?: string, included_type?: string, use_strict_type_filtering?: boolean, is_open_now?: boolean, min_rating?: number, max_result_count?: number, language?: string, region?: string, location_bias?: { lat?: number, lng?: number }, location_restriction?: { center?: { lat?: number, lng?: number }, radius_m?: number } }} root0.args - Tool arguments.
 * @returns {Promise<{ status: 'ok', places: import('../utils/google-places-text-search.js').TextSearchPlace[] } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args }) {
    const textQuery = String(args?.text_query || '').trim();
    if (!textQuery) throw new Error('Missing text_query.');

    const result = await googlePlacesTextSearchImpl({
        textQuery,
        includedType:
            typeof args?.included_type === 'string'
                ? args.included_type
                : undefined,
        useStrictTypeFiltering: Boolean(args?.use_strict_type_filtering),
        isOpenNow:
            typeof args?.is_open_now === 'boolean'
                ? args.is_open_now
                : undefined,
        minRating:
            Number.isFinite(args?.min_rating) && args?.min_rating != null
                ? Number(args.min_rating)
                : undefined,
        maxResultCount:
            Number.isFinite(args?.max_result_count) &&
            args?.max_result_count != null
                ? Number(args.max_result_count)
                : DEFAULT_MAX_RESULT_COUNT,
        language: args?.language || undefined,
        region: args?.region || undefined,
        locationBias:
            Number.isFinite(args?.location_bias?.lat) &&
            Number.isFinite(args?.location_bias?.lng)
                ? {
                      lat: Number(args.location_bias.lat),
                      lng: Number(args.location_bias.lng),
                  }
                : undefined,
        locationRestriction:
            Number.isFinite(args?.location_restriction?.center?.lat) &&
            Number.isFinite(args?.location_restriction?.center?.lng) &&
            Number.isFinite(args?.location_restriction?.radius_m)
                ? {
                      center: {
                          lat: Number(args.location_restriction.center.lat),
                          lng: Number(args.location_restriction.center.lng),
                      },
                      radius_m: Number(args.location_restriction.radius_m),
                  }
                : undefined,
    });

    if (!result) {
        return {
            status: 'unavailable',
            message: PLACES_UNAVAILABLE_MESSAGE,
        };
    }

    return {
        status: 'ok',
        places: result.places,
    };
}

/**
 * Test-only override for googlePlacesTextSearch.
 * @param {typeof realGooglePlacesTextSearch} override - Replacement implementation.
 */
export function setGooglePlacesTextSearchForTests(override) {
    googlePlacesTextSearchImpl = override || realGooglePlacesTextSearch;
}

/** Restore the default googlePlacesTextSearch implementation. */
export function resetGooglePlacesTextSearchForTests() {
    googlePlacesTextSearchImpl = realGooglePlacesTextSearch;
}
