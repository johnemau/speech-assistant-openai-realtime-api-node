import { computeRoute as realComputeRoute } from '../utils/google-routes.js';
import { getLatestTrackLatLng as realGetLatestTrackLatLng } from '../utils/spot.js';
import { IS_DEV } from '../env.js';

const DIRECTIONS_UNAVAILABLE_MESSAGE = 'Directions unavailable.';

/** @type {typeof realComputeRoute} */
let computeRouteImpl = realComputeRoute;

/** @type {typeof realGetLatestTrackLatLng} */
let getLatestTrackLatLngImpl = realGetLatestTrackLatLng;

/**
 * @param {string} value - Raw instruction text.
 * @returns {string} Cleaned instruction text.
 */
function cleanInstruction(value) {
    const cleaned = String(value || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (IS_DEV) {
        console.log('directions: cleanInstruction', {
            raw: String(value || ''),
            cleaned,
        });
    }
    return cleaned;
}

/**
 * @param {number} meters - Distance in meters.
 * @param {import('../utils/google-routes.js').Units} units - Units to format in.
 * @returns {string} Formatted distance string.
 */
function formatDistance(meters, units) {
    if (!Number.isFinite(meters)) return '';

    if (units === 'IMPERIAL') {
        const feet = meters * 3.28084;
        const miles = feet / 5280;
        if (miles >= 0.1) {
            return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
        }
        return `${Math.round(feet)} ft`;
    }

    if (meters >= 1000) {
        return `${(meters / 1000).toFixed(meters >= 10000 ? 1 : 2)} km`;
    }
    return `${Math.round(meters)} m`;
}

/**
 * @param {Array<import('../utils/google-routes.js').RouteStep>} steps - Route steps.
 * @param {import('../utils/google-routes.js').Units} units - Units to format in.
 * @returns {string[]} Formatted directions strings.
 */
function formatDirections(steps, units) {
    if (!Array.isArray(steps)) return [];

    const formatted = steps
        .map((step, index) => {
            const instruction = cleanInstruction(
                step?.navigationInstruction?.instructions || ''
            );
            const distance = Number.isFinite(step?.distanceMeters)
                ? formatDistance(Number(step.distanceMeters), units)
                : null;
            const duration =
                typeof step?.duration === 'string' ? step.duration : null;
            const suffix = [distance, duration].filter(Boolean).join(', ');
            const label = instruction || `Step ${index + 1}`;
            return suffix ? `${label} (${suffix})` : label;
        })
        .filter(Boolean);
    if (IS_DEV) {
        console.log('directions: formatDirections', {
            stepCount: steps.length,
            outputCount: formatted.length,
            units,
        });
    }
    return formatted;
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
                    "Optional origin coordinates. Use either origin or origin_place (address). If omitted, the tool uses the caller's latest tracked location.",
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            destination: {
                type: 'object',
                description:
                    'Optional destination coordinates. Use either destination or destination_place (address).',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            origin_place: {
                type: 'string',
                description:
                    "Optional origin address or place name. Use either origin_place or origin coordinates. If omitted, uses the caller's latest tracked location.",
            },
            destination_place: {
                type: 'string',
                description:
                    'Optional destination address or place name. Use either destination_place or destination coordinates.',
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
                description: 'Units for distances. Default IMPERIAL.',
                enum: ['METRIC', 'IMPERIAL'],
            },
        },
    },
    description:
        'Get directions between two locations using Google Routes API. Provide either address or coordinates for each origin/destination. If origin is omitted, uses the latest tracked caller location.',
};

/**
 * Execute directions tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ origin?: { lat?: number, lng?: number }, destination?: { lat?: number, lng?: number }, origin_place?: string, destination_place?: string, travel_mode?: string, routing_preference?: string, compute_alternative_routes?: boolean, route_modifiers?: { avoid_tolls?: boolean, avoid_highways?: boolean, avoid_ferries?: boolean }, language_code?: string, units?: string }} root0.args - Tool arguments (use address or coordinates for each origin/destination).
 * @returns {Promise<{ status: 'ok', route: import('../utils/google-routes.js').ComputedRoute | null, routes: import('../utils/google-routes.js').ComputedRoute[], directions: string[], raw: import('../utils/google-routes.js').RoutesApiResponse | null } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args }) {
    const rawArgs = args ?? {};
    const destinationPlace =
        typeof rawArgs?.destination_place === 'string'
            ? rawArgs.destination_place.trim()
            : '';

    const destination = rawArgs?.destination;
    const hasDestinationLatLng =
        !!destination &&
        Number.isFinite(destination.lat) &&
        Number.isFinite(destination.lng);

    const originPlace =
        typeof rawArgs?.origin_place === 'string'
            ? rawArgs.origin_place.trim()
            : '';

    const origin = rawArgs?.origin;
    const hasOriginLatLng =
        !!origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng);

    if (IS_DEV) {
        console.log('directions: execute start', {
            args,
        });
    } else {
        console.info('directions: execute start', {
            hasOriginPlace: Boolean(originPlace),
            hasOriginLatLng,
            hasDestinationPlace: Boolean(destinationPlace),
            hasDestinationLatLng,
        });
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
              rawArgs?.travel_mode
          )
        : undefined;

    /** @type {import('../utils/google-routes.js').RoutingPreference | undefined} */
    const routingPreference = [
        'TRAFFIC_UNAWARE',
        'TRAFFIC_AWARE',
        'TRAFFIC_AWARE_OPTIMAL',
    ].includes(String(args?.routing_preference))
        ? /** @type {import('../utils/google-routes.js').RoutingPreference} */ (
              rawArgs?.routing_preference
          )
        : undefined;

    /** @type {import('../utils/google-routes.js').Units} */
    const units = ['METRIC', 'IMPERIAL'].includes(String(args?.units))
        ? /** @type {import('../utils/google-routes.js').Units} */ (
              rawArgs?.units
          )
        : 'IMPERIAL';

    let originInput;
    if (originPlace) {
        originInput = { address: originPlace };
    } else if (hasOriginLatLng) {
        originInput = {
            latLng: {
                lat: Number(origin.lat),
                lng: Number(origin.lng),
            },
        };
    } else {
        const latest = await getLatestTrackLatLngImpl();
        if (!latest) {
            if (IS_DEV) {
                console.log('directions: origin unavailable (no latest track)');
            } else {
                console.warn('directions: origin unavailable');
            }
            return {
                status: 'unavailable',
                message: DIRECTIONS_UNAVAILABLE_MESSAGE,
            };
        }
        originInput = {
            latLng: {
                lat: Number(latest.latitude),
                lng: Number(latest.longitude),
            },
        };
    }

    let destinationInput;
    if (destinationPlace) {
        destinationInput = { address: destinationPlace };
    } else if (hasDestinationLatLng) {
        destinationInput = {
            latLng: {
                lat: Number(destination.lat),
                lng: Number(destination.lng),
            },
        };
    } else {
        throw new Error('Missing destination.');
    }

    if (IS_DEV) {
        console.log('directions: args normalized', {
            rawArgs,
            finalArgs: {
                origin_place: originPlace || undefined,
                origin: hasOriginLatLng
                    ? {
                          lat: Number(origin.lat),
                          lng: Number(origin.lng),
                      }
                    : undefined,
                destination_place: destinationPlace || undefined,
                destination: hasDestinationLatLng
                    ? {
                          lat: Number(destination.lat),
                          lng: Number(destination.lng),
                      }
                    : undefined,
                travel_mode: travelMode,
                routing_preference: routingPreference,
                compute_alternative_routes: Boolean(
                    rawArgs?.compute_alternative_routes
                ),
                route_modifiers: {
                    avoid_tolls: Boolean(rawArgs?.route_modifiers?.avoid_tolls),
                    avoid_highways: Boolean(
                        rawArgs?.route_modifiers?.avoid_highways
                    ),
                    avoid_ferries: Boolean(
                        rawArgs?.route_modifiers?.avoid_ferries
                    ),
                },
                language_code:
                    typeof rawArgs?.language_code === 'string'
                        ? rawArgs.language_code
                        : undefined,
                units,
            },
            computeRouteInput: {
                originInput,
                destinationInput,
                travelMode,
                routingPreference,
                computeAlternativeRoutes: Boolean(
                    rawArgs?.compute_alternative_routes
                ),
                routeModifiers: {
                    avoidTolls: Boolean(rawArgs?.route_modifiers?.avoid_tolls),
                    avoidHighways: Boolean(
                        rawArgs?.route_modifiers?.avoid_highways
                    ),
                    avoidFerries: Boolean(
                        rawArgs?.route_modifiers?.avoid_ferries
                    ),
                },
                languageCode:
                    typeof rawArgs?.language_code === 'string'
                        ? rawArgs.language_code
                        : undefined,
                units,
            },
        });
    }

    const result = await computeRouteImpl({
        origin: originInput,
        destination: destinationInput,
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
        if (IS_DEV) {
            console.log('directions: route unavailable', {
                hasResult: Boolean(result),
                hasRoute: Boolean(result?.route),
            });
        } else {
            console.warn('directions: route unavailable', {
                hasResult: Boolean(result),
                hasRoute: Boolean(result?.route),
            });
        }
        return {
            status: 'unavailable',
            message: DIRECTIONS_UNAVAILABLE_MESSAGE,
        };
    }

    const directions = formatDirections(result.route.steps, units);

    const payload = {
        status: /** @type {'ok'} */ ('ok'),
        route: result.route,
        routes: result.routes,
        directions,
        raw: result.raw ?? null,
    };
    if (IS_DEV) {
        console.log('directions: execute success', {
            directionsCount: directions.length,
            routeDistance: result.route?.distanceMeters ?? null,
            routeDuration: result.route?.duration ?? null,
        });
    } else {
        console.info('directions: execute success', {
            directionsCount: directions.length,
            routeDistance: result.route?.distanceMeters ?? null,
            routeDuration: result.route?.duration ?? null,
        });
    }
    return payload;
}

/**
 * Test-only override for computeRoute.
 * @param {typeof realComputeRoute} override - Replacement implementation.
 */
export function setComputeRouteForTests(override) {
    if (IS_DEV) {
        console.log('directions: setComputeRouteForTests', {
            hasOverride: Boolean(override),
        });
    }
    computeRouteImpl = override || realComputeRoute;
}

/** Restore the default computeRoute implementation. */
export function resetComputeRouteForTests() {
    if (IS_DEV) {
        console.log('directions: resetComputeRouteForTests');
    }
    computeRouteImpl = realComputeRoute;
}

/**
 * Test-only override for getLatestTrackLatLng.
 * @param {typeof realGetLatestTrackLatLng} override - Replacement implementation.
 */
export function setGetLatestTrackLatLngForTests(override) {
    if (IS_DEV) {
        console.log('directions: setGetLatestTrackLatLngForTests', {
            hasOverride: Boolean(override),
        });
    }
    getLatestTrackLatLngImpl = override || realGetLatestTrackLatLng;
}

/** Restore the default getLatestTrackLatLng implementation. */
export function resetGetLatestTrackLatLngForTests() {
    if (IS_DEV) {
        console.log('directions: resetGetLatestTrackLatLngForTests');
    }
    getLatestTrackLatLngImpl = realGetLatestTrackLatLng;
}
