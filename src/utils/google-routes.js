import { getGoogleMapsApiKey } from '../env.js';

/**
 * @typedef {{lat:number,lng:number}} LatLng
 */

/**
 * @typedef {"DRIVE"|"BICYCLE"|"WALK"|"TWO_WHEELER"|"TRANSIT"} TravelMode
 */

/**
 * @typedef {"TRAFFIC_UNAWARE"|"TRAFFIC_AWARE"|"TRAFFIC_AWARE_OPTIMAL"} RoutingPreference
 */

/**
 * @typedef {"METRIC"|"IMPERIAL"} Units
 */

/**
 * @typedef {object} RouteModifiers
 * @property {boolean=} avoidTolls
 * @property {boolean=} avoidHighways
 * @property {boolean=} avoidFerries
 */

/**
 * @typedef {object} ComputeRouteArgs
 * @property {LatLng} origin Origin lat/lng.
 * @property {LatLng} destination Destination lat/lng.
 * @property {TravelMode=} travelMode Default: "DRIVE".
 * @property {RoutingPreference=} routingPreference Default: "TRAFFIC_AWARE".
 * @property {boolean=} computeAlternativeRoutes Default: false.
 * @property {RouteModifiers=} routeModifiers Avoid options.
 * @property {string=} languageCode BCP-47 language code, e.g. "en-US".
 * @property {Units=} units Default: "METRIC".
 */

/**
 * Step shape needed by normalizeDirections().
 * @typedef {object} RouteStep
 * @property {TravelMode=} travelMode
 * @property {number=} distanceMeters
 * @property {string=} duration
 * @property {{instructions?:string, maneuver?:string}=} navigationInstruction
 * @property {object=} transitDetails
 */

/**
 * Minimal route response shape consumed by normalizeDirections().
 * @typedef {object} RoutesApiResponse
 * @property {Array<{distanceMeters?: number, duration?: string, polyline?: {encodedPolyline?: string}, legs?: Array<{steps?: RouteStep[]}>}>} routes
 */

/**
 * @typedef {object} ComputedRoute
 * @property {number|null} distanceMeters
 * @property {string|null} duration Duration string like "165s".
 * @property {string|null} encodedPolyline
 * @property {RouteStep[]} steps First leg steps (empty if unavailable).
 */

/**
 * @typedef {object} ComputeRouteResult
 * @property {ComputedRoute|null} route Primary route (first result) or null.
 * @property {ComputedRoute[]} routes All returned routes (may be empty).
 * @property {RoutesApiResponse|null} raw Raw API response (so normalizeDirections(raw) works).
 */

const DEFAULT_FIELD_MASK = [
    'routes.duration',
    'routes.distanceMeters',
    'routes.polyline.encodedPolyline',

    // Needed for: routeResponse.routes[0].legs[0].steps[*]...
    'routes.legs.steps.travelMode',
    'routes.legs.steps.distanceMeters',
    'routes.legs.steps.duration',
    'routes.legs.steps.navigationInstruction.instructions',
    'routes.legs.steps.navigationInstruction.maneuver',

    // Needed for TRANSIT parsing (keep it broad; tighten later if you want)
    'routes.legs.steps.transitDetails',
];

const DEFAULT_TTL_MS = 150000;

/** @type {Map<string, {expiresAt:number, value:ComputeRouteResult}>} */
const cache = new Map();

/**
 * @param {ComputeRouteArgs} args - Route input args.
 * @returns {string} Cache key.
 */
function cacheKey(args) {
    const oLat = Math.round(args.origin.lat * 1e6) / 1e6;
    const oLng = Math.round(args.origin.lng * 1e6) / 1e6;
    const dLat = Math.round(args.destination.lat * 1e6) / 1e6;
    const dLng = Math.round(args.destination.lng * 1e6) / 1e6;

    return JSON.stringify({
        origin: { lat: oLat, lng: oLng },
        destination: { lat: dLat, lng: dLng },
        travelMode: args.travelMode ?? 'DRIVE',
        routingPreference: args.routingPreference ?? 'TRAFFIC_AWARE',
        computeAlternativeRoutes: !!args.computeAlternativeRoutes,
        routeModifiers: {
            avoidTolls: !!args.routeModifiers?.avoidTolls,
            avoidHighways: !!args.routeModifiers?.avoidHighways,
            avoidFerries: !!args.routeModifiers?.avoidFerries,
        },
        languageCode: args.languageCode || null,
        units: args.units ?? 'METRIC',
    });
}

/**
 * @param {ComputeRouteArgs} args - Route input args.
 * @param {string} apiKey - Google Maps API key.
 * @returns {string|null} error string or null
 */
function validate(args, apiKey) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';

    const o = args.origin;
    const d = args.destination;
    if (!o || typeof o !== 'object') return 'Missing origin';
    if (!d || typeof d !== 'object') return 'Missing destination';

    if (typeof o.lat !== 'number' || o.lat < -90 || o.lat > 90)
        return 'Invalid origin.lat';
    if (typeof o.lng !== 'number' || o.lng < -180 || o.lng > 180)
        return 'Invalid origin.lng';
    if (typeof d.lat !== 'number' || d.lat < -90 || d.lat > 90)
        return 'Invalid destination.lat';
    if (typeof d.lng !== 'number' || d.lng < -180 || d.lng > 180)
        return 'Invalid destination.lng';

    if (args.travelMode) {
        const ok =
            args.travelMode === 'DRIVE' ||
            args.travelMode === 'BICYCLE' ||
            args.travelMode === 'WALK' ||
            args.travelMode === 'TWO_WHEELER' ||
            args.travelMode === 'TRANSIT';
        if (!ok) return 'Invalid travelMode';
    }

    if (args.routingPreference) {
        const ok =
            args.routingPreference === 'TRAFFIC_UNAWARE' ||
            args.routingPreference === 'TRAFFIC_AWARE' ||
            args.routingPreference === 'TRAFFIC_AWARE_OPTIMAL';
        if (!ok) return 'Invalid routingPreference';
    }

    if (args.units) {
        const ok = args.units === 'METRIC' || args.units === 'IMPERIAL';
        if (!ok) return 'Invalid units';
    }

    if (args.routeModifiers && typeof args.routeModifiers !== 'object')
        return 'routeModifiers must be an object';

    return null;
}

/**
 * Compute a route using Google Maps Routes API (computeRoutes) with in-memory caching.
 *
 * Notes:
 * - Uses REST: POST https://routes.googleapis.com/directions/v2:computeRoutes
 * - Field mask is required (header: X-Goog-FieldMask) to control cost/size.
 *
 * @param {ComputeRouteArgs} args - Tool input args.
 * @param {object} [options] - Optional request settings.
 * @param {number} [options.ttlMs=150000] - Cache TTL in ms.
 * @param {string[]} [options.fieldMask] - Response field mask.
 * @returns {Promise<ComputeRouteResult|null>} Returns null on any failure.
 */
export async function computeRoute(args, options = {}) {
    try {
        const apiKey = String(getGoogleMapsApiKey() || '');
        const err = validate(args, apiKey);
        if (err) return null;

        const ttlMs = Number.isFinite(options.ttlMs)
            ? options.ttlMs
            : DEFAULT_TTL_MS;
        const fieldMask =
            Array.isArray(options.fieldMask) && options.fieldMask.length
                ? options.fieldMask
                : DEFAULT_FIELD_MASK;

        const key = cacheKey(args);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && hit.expiresAt > now) return hit.value;

        const body = {
            origin: {
                location: {
                    latLng: {
                        latitude: args.origin.lat,
                        longitude: args.origin.lng,
                    },
                },
            },
            destination: {
                location: {
                    latLng: {
                        latitude: args.destination.lat,
                        longitude: args.destination.lng,
                    },
                },
            },
            travelMode: args.travelMode ?? 'DRIVE',
            routingPreference: args.routingPreference ?? 'TRAFFIC_AWARE',
            computeAlternativeRoutes: !!args.computeAlternativeRoutes,
            routeModifiers: {
                avoidTolls: !!args.routeModifiers?.avoidTolls,
                avoidHighways: !!args.routeModifiers?.avoidHighways,
                avoidFerries: !!args.routeModifiers?.avoidFerries,
            },
            languageCode: args.languageCode,
            units: args.units ?? 'METRIC',
        };

        const resp = await fetch(
            'https://routes.googleapis.com/directions/v2:computeRoutes',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': fieldMask.join(','),
                },
                body: JSON.stringify(body),
            }
        );

        if (!resp.ok) return null;

        /** @type {RoutesApiResponse} */
        const data = /** @type {any} */ (await resp.json());

        /** @type {ComputedRoute[]} */
        const routes = (data?.routes || []).map((r) => {
            const steps = r?.legs?.[0]?.steps ?? [];
            return {
                distanceMeters:
                    typeof r?.distanceMeters === 'number'
                        ? r.distanceMeters
                        : null,
                duration: typeof r?.duration === 'string' ? r.duration : null,
                encodedPolyline:
                    typeof r?.polyline?.encodedPolyline === 'string'
                        ? r.polyline.encodedPolyline
                        : null,
                steps: Array.isArray(steps) ? steps : [],
            };
        });

        /** @type {ComputeRouteResult} */
        const value = { route: routes[0] ?? null, routes, raw: data };
        cache.set(key, { expiresAt: now + Number(ttlMs), value });
        return value;
    } catch {
        return null;
    }
}
