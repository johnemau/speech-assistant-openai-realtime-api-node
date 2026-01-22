import { getGoogleMapsApiKey } from '../env.js';

/**
 * @typedef {object} NearbyPlace
 * @property {string|null} id
 * @property {string|null} name
 * @property {string|null} address
 * @property {{lat:number,lng:number}|null} location
 * @property {string|null} primaryType
 * @property {string|null} mapsUrl
 */

/**
 * @typedef {object} GooglePlacesNearbyArgs
 * @property {number} lat Center latitude.
 * @property {number} lng Center longitude.
 * @property {number} radius_m Search radius in meters (1..50000). Results outside are not returned.
 * @property {string[]=} included_primary_types Places (New) primary types, e.g. ["restaurant","cafe"].
 * @property {number=} max_result_count Max results (1..20). Default: 10.
 * @property {"POPULARITY"|"DISTANCE"=} rank_preference Default: "POPULARITY".
 * @property {string=} language_code BCP-47 language code, e.g. "en".
 * @property {string=} region_code CLDR region code, e.g. "US".
 */

const DEFAULT_FIELD_MASK = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.primaryType',
    'places.googleMapsUri',
];

const DEFAULT_TTL_MS = 150000;

/** @type {Map<string, {expiresAt:number, value:{places: NearbyPlace[]}}>} */
const cache = new Map();

/**
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @returns {string} Cache key for the input args.
 */
function cacheKey(args) {
    // Round lat/lng slightly so tiny float jitter doesn't defeat caching.
    const lat = Math.round(args.lat * 1e6) / 1e6;
    const lng = Math.round(args.lng * 1e6) / 1e6;

    return JSON.stringify({
        lat,
        lng,
        radius_m: args.radius_m,
        included_primary_types: args.included_primary_types || null,
        max_result_count: args.max_result_count ?? 10,
        rank_preference: args.rank_preference ?? 'POPULARITY',
        language_code: args.language_code || null,
        region_code: args.region_code || null,
    });
}

/**
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @param {string} apiKey - Google Maps API key.
 * @returns {string|null} Returns an error string if invalid, otherwise null.
 */
function validate(args, apiKey) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';

    if (typeof args.lat !== 'number' || args.lat < -90 || args.lat > 90)
        return 'Invalid lat';
    if (typeof args.lng !== 'number' || args.lng < -180 || args.lng > 180)
        return 'Invalid lng';

    const r = args.radius_m;
    if (!Number.isFinite(r) || r < 1 || r > 50000)
        return 'Invalid radius_m (1..50000)';

    const m = args.max_result_count ?? 10;
    if (!Number.isFinite(m) || m < 1 || m > 20)
        return 'Invalid max_result_count (1..20)';

    if (
        args.rank_preference &&
        args.rank_preference !== 'POPULARITY' &&
        args.rank_preference !== 'DISTANCE'
    ) {
        return 'Invalid rank_preference';
    }

    if (
        args.included_primary_types &&
        !Array.isArray(args.included_primary_types)
    ) {
        return 'included_primary_types must be an array';
    }

    return null;
}

/**
 * Nearby Search (New) via Places API (New) HTTP endpoint with in-memory caching.
 *
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @param {object} [options] - Optional request settings.
 * @param {number} [options.ttlMs=150000] - Cache TTL in ms.
 * @param {string[]} [options.fieldMask] - Places field mask.
 * @returns {Promise<{places: NearbyPlace[]}|null>} Returns null on any failure.
 */
export async function searchPlacesNearby(args, options = {}) {
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
            locationRestriction: {
                circle: {
                    center: {
                        latitude: args.lat,
                        longitude: args.lng,
                    },
                    radius: args.radius_m,
                },
            },
            includedPrimaryTypes: args.included_primary_types,
            maxResultCount: args.max_result_count ?? 10,
            rankPreference: args.rank_preference ?? 'POPULARITY',
            languageCode: args.language_code,
            regionCode: args.region_code,
        };

        const resp = await fetch(
            'https://places.googleapis.com/v1/places:searchNearby',
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

        /** @type {{ places?: Array<Record<string, any>> }} */
        const data = /** @type {any} */ (await resp.json());

        /** @type {NearbyPlace[]} */
        const places = (data?.places || []).map((p) => ({
            id: p?.id ?? null,
            name: p?.displayName?.text ?? null,
            address: p?.formattedAddress ?? null,
            location: p?.location
                ? {
                      lat: p.location.latitude,
                      lng: p.location.longitude,
                  }
                : null,
            primaryType: p?.primaryType ?? null,
            mapsUrl: p?.googleMapsUri ?? null,
        }));

        const value = { places };
        cache.set(key, { expiresAt: now + Number(ttlMs), value });
        return value;
    } catch {
        return null;
    }
}
