import { computeRoute as realComputeRoute } from '../utils/google-routes.js';
import { googlePlacesTextSearch as realGooglePlacesTextSearch } from '../utils/google-places-text-search.js';
import { getLatestTrackLatLng as realGetLatestTrackLatLng } from '../utils/spot.js';

const DIRECTIONS_UNAVAILABLE_MESSAGE = 'Directions unavailable.';

/** @type {typeof realComputeRoute} */
let computeRouteImpl = realComputeRoute;

/** @type {typeof realGetLatestTrackLatLng} */
let getLatestTrackLatLngImpl = realGetLatestTrackLatLng;

/** @type {typeof realGooglePlacesTextSearch} */
let googlePlacesTextSearchImpl = realGooglePlacesTextSearch;

/**
 * @param {string} value - Raw instruction text.
 * @returns {string} Cleaned instruction text.
 */
function cleanInstruction(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {Array<import('../utils/google-routes.js').RouteStep>} steps - Route steps.
 * @returns {string[]} Formatted directions strings.
 */
function formatDirections(steps) {
    if (!Array.isArray(steps)) return [];

    return steps
        .map((step, index) => {
            const instruction = cleanInstruction(
                step?.navigationInstruction?.instructions || ''
            );
            const distance = Number.isFinite(step?.distanceMeters)
                ? `${Math.round(Number(step.distanceMeters))} m`
                : null;
            const duration =
                typeof step?.duration === 'string' ? step.duration : null;
            const suffix = [distance, duration].filter(Boolean).join(', ');
            const label = instruction || `Step ${index + 1}`;
            return suffix ? `${label} (${suffix})` : label;
        })
        .filter(Boolean);
}

/**
 * @param {string} query - Place name or address.
 * @param {{ language?: string }=} options - Optional search options.
 * @returns {Promise<{ lat: number, lng: number } | null>} Location or null.
 */
async function resolvePlaceLocation(query, options = {}) {
    const result = await googlePlacesTextSearchImpl({
        textQuery: query,
        language: options.language,
        maxResultCount: 1,
    });

    const loc = result?.places?.[0]?.location;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng))
        return null;
    return { lat: Number(loc.lat), lng: Number(loc.lng) };
}

export const definition = {
    type: 'function',
    name: 'directions',
    parameters: {
        type: 'object',
        properties: {
            origin: {
                type: 'object',
                description:
                    "Optional origin coordinates. If omitted, the tool uses the caller's latest tracked location.",
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            destination: {
                type: 'object',
                description: 'Destination coordinates.',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            origin_place: {
                type: 'string',
                description:
                    "Optional origin address or place name. If omitted, uses the caller's latest tracked location.",
            },
            destination_place: {
                type: 'string',
                description: 'Destination address or place name.',
            },
            travel_mode: {
                type: 'string',
                description: 'Travel mode. Default DRIVE.',
                enum: ['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER', 'TRANSIT'],
            },
            routing_preference: {
                type: 'string',
                description: 'Routing preference. Default TRAFFIC_AWARE.',
                enum: [
                    'TRAFFIC_UNAWARE',
                    'TRAFFIC_AWARE',
                    'TRAFFIC_AWARE_OPTIMAL',
                ],
            },
            compute_alternative_routes: {
                type: 'boolean',
                description: 'Whether to compute alternate routes.',
            },
            route_modifiers: {
                type: 'object',
                description: 'Avoid options for the route.',
                properties: {
                    avoid_tolls: { type: 'boolean' },
                    avoid_highways: { type: 'boolean' },
                    avoid_ferries: { type: 'boolean' },
                },
            },
            language_code: {
                type: 'string',
                description: 'BCP-47 language tag (e.g., "en-US").',
            },
            units: {
                type: 'string',
                description: 'Units for distances. Default METRIC.',
                enum: ['METRIC', 'IMPERIAL'],
            },
        },
        required: ['destination_place'],
    },
    description:
        'Get directions between two locations using Google Routes API. If origin is omitted, uses the latest tracked caller location.',
};

/**
 * Execute directions tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ origin?: { lat?: number, lng?: number }, destination?: { lat?: number, lng?: number }, origin_place?: string, destination_place?: string, travel_mode?: string, routing_preference?: string, compute_alternative_routes?: boolean, route_modifiers?: { avoid_tolls?: boolean, avoid_highways?: boolean, avoid_ferries?: boolean }, language_code?: string, units?: string }} root0.args - Tool arguments.
 * @returns {Promise<{ status: 'ok', route: import('../utils/google-routes.js').ComputedRoute | null, routes: import('../utils/google-routes.js').ComputedRoute[], directions: string[], raw: import('../utils/google-routes.js').RoutesApiResponse | null } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args }) {
    const destinationPlace =
        typeof args?.destination_place === 'string'
            ? args.destination_place.trim()
            : '';

    let destination = args?.destination;
    if (
        !destination ||
        !Number.isFinite(destination.lat) ||
        !Number.isFinite(destination.lng)
    ) {
        if (!destinationPlace) {
            throw new Error('Missing destination.');
        }
        const resolved = await resolvePlaceLocation(destinationPlace, {
            language:
                typeof args?.language_code === 'string'
                    ? args.language_code
                    : undefined,
        });
        if (!resolved) {
            return {
                status: 'unavailable',
                message: DIRECTIONS_UNAVAILABLE_MESSAGE,
            };
        }
        destination = resolved;
    }

    const originPlace =
        typeof args?.origin_place === 'string' ? args.origin_place.trim() : '';

    let origin = args?.origin;
    if (
        !origin ||
        !Number.isFinite(origin.lat) ||
        !Number.isFinite(origin.lng)
    ) {
        if (originPlace) {
            const resolved = await resolvePlaceLocation(originPlace, {
                language:
                    typeof args?.language_code === 'string'
                        ? args.language_code
                        : undefined,
            });
            if (!resolved) {
                return {
                    status: 'unavailable',
                    message: DIRECTIONS_UNAVAILABLE_MESSAGE,
                };
            }
            origin = resolved;
        } else {
            const latest = await getLatestTrackLatLngImpl();
            if (!latest) {
                return {
                    status: 'unavailable',
                    message: DIRECTIONS_UNAVAILABLE_MESSAGE,
                };
            }
            origin = {
                lat: Number(latest.latitude),
                lng: Number(latest.longitude),
            };
        }
    }

    /** @type {import('../utils/google-routes.js').TravelMode | undefined} */
    const travelMode = [
        'DRIVE',
        'BICYCLE',
        'WALK',
        'TWO_WHEELER',
        'TRANSIT',
    ].includes(String(args?.travel_mode))
        ? /** @type {import('../utils/google-routes.js').TravelMode} */ (
              args?.travel_mode
          )
        : undefined;

    /** @type {import('../utils/google-routes.js').RoutingPreference | undefined} */
    const routingPreference = [
        'TRAFFIC_UNAWARE',
        'TRAFFIC_AWARE',
        'TRAFFIC_AWARE_OPTIMAL',
    ].includes(String(args?.routing_preference))
        ? /** @type {import('../utils/google-routes.js').RoutingPreference} */ (
              args?.routing_preference
          )
        : undefined;

    /** @type {import('../utils/google-routes.js').Units | undefined} */
    const units = ['METRIC', 'IMPERIAL'].includes(String(args?.units))
        ? /** @type {import('../utils/google-routes.js').Units} */ (args?.units)
        : undefined;

    const result = await computeRouteImpl({
        origin: {
            latLng: {
                lat: Number(origin.lat),
                lng: Number(origin.lng),
            },
        },
        destination: {
            latLng: {
                lat: Number(destination.lat),
                lng: Number(destination.lng),
            },
        },
        travelMode,
        routingPreference,
        computeAlternativeRoutes: Boolean(args?.compute_alternative_routes),
        routeModifiers: {
            avoidTolls: Boolean(args?.route_modifiers?.avoid_tolls),
            avoidHighways: Boolean(args?.route_modifiers?.avoid_highways),
            avoidFerries: Boolean(args?.route_modifiers?.avoid_ferries),
        },
        languageCode:
            typeof args?.language_code === 'string'
                ? args.language_code
                : undefined,
        units,
    });

    if (!result || !result.route) {
        return {
            status: 'unavailable',
            message: DIRECTIONS_UNAVAILABLE_MESSAGE,
        };
    }

    const directions = formatDirections(result.route.steps);

    return {
        status: 'ok',
        route: result.route,
        routes: result.routes,
        directions,
        raw: result.raw ?? null,
    };
}

/**
 * Test-only override for computeRoute.
 * @param {typeof realComputeRoute} override - Replacement implementation.
 */
export function setComputeRouteForTests(override) {
    computeRouteImpl = override || realComputeRoute;
}

/** Restore the default computeRoute implementation. */
export function resetComputeRouteForTests() {
    computeRouteImpl = realComputeRoute;
}

/**
 * Test-only override for getLatestTrackLatLng.
 * @param {typeof realGetLatestTrackLatLng} override - Replacement implementation.
 */
export function setGetLatestTrackLatLngForTests(override) {
    getLatestTrackLatLngImpl = override || realGetLatestTrackLatLng;
}

/** Restore the default getLatestTrackLatLng implementation. */
export function resetGetLatestTrackLatLngForTests() {
    getLatestTrackLatLngImpl = realGetLatestTrackLatLng;
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
