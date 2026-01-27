import { getGoogleMapsApiKey, IS_DEV } from '../env.js';

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
 * Location input for a waypoint.
 * - Use {address} to let Routes API geocode it internally.
 * - Use {latLng} for explicit coordinates.
 *
 * @typedef {{address:string} | {latLng:LatLng}} WaypointInput
 */

/**
 * ccTLD 2-character region bias for geocoding ambiguous/incomplete addresses.
 * Example: "es" to bias "Toledo" toward Spain.
 *
 * @typedef {string} RegionCode
 */

/**
 * @typedef {object} ComputeRouteArgs
 * @property {WaypointInput} origin Origin address or lat/lng.
 * @property {WaypointInput} destination Destination address or lat/lng.
 * @property {RegionCode=} regionCode Region bias for address geocoding (ccTLD 2-char).
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
 * @property {string=} staticDuration
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
    'routes.legs.steps.staticDuration',
    'routes.legs.steps.navigationInstruction.instructions',
    'routes.legs.steps.navigationInstruction.maneuver',

    // Needed for TRANSIT parsing (keep it broad; tighten later if you want)
    'routes.legs.steps.transitDetails',
];

const DEFAULT_TTL_MS = 150000;

/** @type {Map<string, {expiresAt:number, value:ComputeRouteResult}>} */
const cache = new Map();

/**
 * @param {WaypointInput} w - Waypoint to inspect.
 * @returns {w is {address:string}} True when the waypoint is address-based.
 */
function isAddressWaypoint(w) {
    const result =
        !!w &&
        typeof w === 'object' &&
        'address' in w &&
        typeof w.address === 'string';
    if (IS_DEV) {
        console.log('routes: isAddressWaypoint', {
            input: w,
            result,
        });
    }
    return result;
}

/**
 * @param {WaypointInput} w - Waypoint to inspect.
 * @returns {w is {latLng:LatLng}} True when the waypoint is lat/lng-based.
 */
function isLatLngWaypoint(w) {
    const result =
        !!w &&
        typeof w === 'object' &&
        'latLng' in w &&
        !!w.latLng &&
        typeof w.latLng === 'object' &&
        typeof w.latLng.lat === 'number' &&
        typeof w.latLng.lng === 'number';
    if (IS_DEV) {
        console.log('routes: isLatLngWaypoint', {
            input: w,
            result,
        });
    }
    return result;
}

/**
 * @param {WaypointInput} w - Waypoint to normalize.
 * @returns {object|null} Waypoint object for Routes API or null if invalid.
 */
function toRoutesWaypoint(w) {
    if (isAddressWaypoint(w)) {
        const address = w.address.trim();
        if (!address) return null;
        const waypoint = { address };
        if (IS_DEV) {
            console.log('routes: toRoutesWaypoint address', {
                address,
            });
        }
        return waypoint;
    }

    if (isLatLngWaypoint(w)) {
        const { lat, lng } = w.latLng;
        const waypoint = {
            location: {
                latLng: {
                    latitude: lat,
                    longitude: lng,
                },
            },
        };
        if (IS_DEV) {
            console.log('routes: toRoutesWaypoint latLng', {
                lat,
                lng,
            });
        }
        return waypoint;
    }

    if (IS_DEV) {
        console.log('routes: toRoutesWaypoint invalid', {
            input: w,
        });
    }
    return null;
}

/**
 * @param {ComputeRouteArgs} args - Route input args.
 * @returns {string} Cache key.
 */
function cacheKey(args) {
    /** @type {any} */
    const originKey = isAddressWaypoint(args.origin)
        ? { address: args.origin.address.trim() }
        : isLatLngWaypoint(args.origin)
          ? {
                latLng: {
                    lat: Math.round(args.origin.latLng.lat * 1e6) / 1e6,
                    lng: Math.round(args.origin.latLng.lng * 1e6) / 1e6,
                },
            }
          : null;

    /** @type {any} */
    const destKey = isAddressWaypoint(args.destination)
        ? { address: args.destination.address.trim() }
        : isLatLngWaypoint(args.destination)
          ? {
                latLng: {
                    lat: Math.round(args.destination.latLng.lat * 1e6) / 1e6,
                    lng: Math.round(args.destination.latLng.lng * 1e6) / 1e6,
                },
            }
          : null;

    const key = JSON.stringify({
        origin: originKey,
        destination: destKey,
        regionCode: args.regionCode || null,
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
    if (IS_DEV) {
        console.log('routes: cacheKey', {
            key,
        });
    }
    return key;
}

/**
 * @param {ComputeRouteArgs} args - Route input args.
 * @param {string} apiKey - Google Maps API key.
 * @returns {string|null} error string or null
 */
function validate(args, apiKey) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';

    if (!args.origin || typeof args.origin !== 'object')
        return 'Missing origin';
    if (!args.destination || typeof args.destination !== 'object')
        return 'Missing destination';

    // Validate origin/destination
    const oIsAddr = isAddressWaypoint(args.origin);
    const oIsLL = isLatLngWaypoint(args.origin);
    if (!oIsAddr && !oIsLL)
        return 'Invalid origin (expected {address} or {latLng:{lat,lng}})';
    if (oIsAddr) {
        const originAddress = /** @type {{address:string}} */ (args.origin);
        if (!originAddress.address.trim()) return 'Invalid origin.address';
    }
    if (oIsLL) {
        const originLatLng = /** @type {{latLng:LatLng}} */ (args.origin);
        const { lat, lng } = originLatLng.latLng;
        if (lat < -90 || lat > 90) return 'Invalid origin.latLng.lat';
        if (lng < -180 || lng > 180) return 'Invalid origin.latLng.lng';
    }

    const dIsAddr = isAddressWaypoint(args.destination);
    const dIsLL = isLatLngWaypoint(args.destination);
    if (!dIsAddr && !dIsLL)
        return 'Invalid destination (expected {address} or {latLng:{lat,lng}})';
    if (dIsAddr) {
        const destinationAddress = /** @type {{address:string}} */ (
            args.destination
        );
        if (!destinationAddress.address.trim())
            return 'Invalid destination.address';
    }
    if (dIsLL) {
        const destinationLatLng = /** @type {{latLng:LatLng}} */ (
            args.destination
        );
        const { lat, lng } = destinationLatLng.latLng;
        if (lat < -90 || lat > 90) return 'Invalid destination.latLng.lat';
        if (lng < -180 || lng > 180) return 'Invalid destination.latLng.lng';
    }

    // regionCode: optional, but if provided keep it tight (2 chars)
    if (args.regionCode != null) {
        const rc = String(args.regionCode).trim();
        if (rc.length !== 2)
            return 'Invalid regionCode (expected 2 characters)';
    }

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

    if (IS_DEV) {
        console.log('routes: validate ok');
    }
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
        if (err) {
            if (IS_DEV) {
                console.log('routes: computeRoute invalid', { error: err });
            }
            return null;
        }

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
        if (hit && hit.expiresAt > now) {
            if (IS_DEV) {
                console.log('routes: cache hit', {
                    expiresAt: hit.expiresAt,
                    now,
                });
            }
            return hit.value;
        }

        const origin = toRoutesWaypoint(args.origin);
        const destination = toRoutesWaypoint(args.destination);
        if (!origin || !destination) {
            if (IS_DEV) {
                console.log('routes: missing waypoint', {
                    hasOrigin: Boolean(origin),
                    hasDestination: Boolean(destination),
                });
            }
            return null;
        }

        /** @type {any} */
        const body = {
            origin,
            destination,
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

        // Only include when provided (lets you bias ambiguous/incomplete addresses)
        if (args.regionCode) body.regionCode = String(args.regionCode).trim();

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

        if (!resp.ok) {
            if (IS_DEV) {
                let errorBody = null;
                let contentType = null;
                try {
                    contentType = resp.headers?.get('content-type') ?? null;
                    errorBody = await resp.text();
                } catch {
                    errorBody = null;
                }

                console.log('routes: http error', {
                    status: resp.status,
                    statusText: resp.statusText,
                    url: resp.url,
                    contentType,
                    errorBody,
                    request: {
                        hasOrigin: Boolean(origin),
                        hasDestination: Boolean(destination),
                        travelMode: body.travelMode,
                        routingPreference: body.routingPreference,
                        computeAlternativeRoutes: body.computeAlternativeRoutes,
                        routeModifiers: body.routeModifiers,
                        languageCode: body.languageCode ?? null,
                        units: body.units,
                        regionCode: body.regionCode ?? null,
                    },
                });
            }
            return null;
        }

        /** @type {RoutesApiResponse} */
        const data = /** @type {any} */ (await resp.json());

        /** @type {ComputedRoute[]} */
        const routes = (data?.routes || []).map((r) => {
            const steps = r?.legs?.[0]?.steps ?? [];
            const normalizedSteps = Array.isArray(steps)
                ? steps.map((step) => {
                      const duration =
                          typeof step?.duration === 'string'
                              ? step.duration
                              : typeof step?.staticDuration === 'string'
                                ? step.staticDuration
                                : undefined;
                      if (!duration) {
                          return step;
                      }
                      const { staticDuration, ...rest } = step ?? {};
                      return {
                          ...rest,
                          duration,
                      };
                  })
                : [];
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
                steps: normalizedSteps,
            };
        });

        /** @type {ComputeRouteResult} */
        const value = { route: routes[0] ?? null, routes, raw: data };
        cache.set(key, { expiresAt: now + Number(ttlMs), value });
        if (IS_DEV) {
            console.log('routes: computeRoute success', {
                routeCount: routes.length,
                hasPrimaryRoute: Boolean(routes[0]),
            });
        }
        return value;
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('routes: computeRoute exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
            });
        }
        return null;
    }
}
