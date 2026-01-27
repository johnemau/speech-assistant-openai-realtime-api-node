import { getGoogleMapsApiKey, IS_DEV } from '../env.js';

/**
 * @typedef {object} TextSearchPlace
 * @property {string|null} id
 * @property {string|null} name
 * @property {string|null} businessStatus
 * @property {{lat:number,lng:number}|null} location
 * @property {string|null} address
 * @property {string|null} mapsUrl
 */

/**
 * @typedef {object} GooglePlaceResult
 * @property {string=} id
 * @property {{text?: string}=} displayName
 * @property {string=} businessStatus
 * @property {{latitude?: number, longitude?: number}=} location
 * @property {string=} formattedAddress
 * @property {string=} googleMapsUri
 */

/**
 * @typedef {object} PlacesTextSearchResponse
 * @property {GooglePlaceResult[]=} places
 */

/**
 * @typedef {object} GooglePlacesTextSearchArgs
 * @property {string} textQuery Text query or phone number (e.g., "pizza in New York", "+1 650-253-0000").
 * @property {import('./google-places.js').IncludedPrimaryType=} includedType Restrict results to a specific type (leave blank/undefined for any).
 * @property {boolean=} useStrictTypeFiltering Whether to strictly enforce includedType. Default: false.
 *
 * @property {boolean=} isOpenNow Only return places that are open now.
 * @property {number=} minRating Minimum rating (typically 1..5).
 * @property {number=} maxResultCount Max results (1..20). Default: 10.
 * @property {string=} language BCP-47 language tag (JS SDK uses e.g. "en-US").
 * @property {string=} region Region code (e.g. "us", "jp"). Recommended when textQuery is a phone number.
 *
 * @property {{lat:number,lng:number}=} locationBias Bias results toward this point (does not restrict).
 * @property {{center:{lat:number,lng:number}, radius_m:number}=} locationRestriction Restrict results to a circle.
 */

/**
 * Text Search tool (Places API (New)) with in-memory caching.
 *
 * Uses Places API (New) HTTP endpoint `places:searchText` and a FieldMask to keep responses lean.
 *
 * @param {GooglePlacesTextSearchArgs} args - Tool input args.
 * @returns {Promise<{places: TextSearchPlace[]}|null>} Returns null on any failure.
 */
export async function googlePlacesTextSearch(args) {
    try {
        const err = validate(args);
        if (err) return null;

        const key = cacheKey(args);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && hit.expiresAt > now) return hit.value;

        /** @type {any} */
        const body = {
            fields: [
                'accessibilityOptions',
                'businessStatus',
                'displayName',
                'editorialSummary',
                'hasDelivery',
                'hasDineIn',
                'hasLiveMusic',
                'hasOutdoorSeating',
                'hasRestroom',
                'hasTakeout',
                'internationalPhoneNumber',
                'isGoodForGroups',
                'isGoodForWatchingSports',
                'isReservable',
                'isReservable',
                'location',
                'location',
                'nationalPhoneNumber',
                'neighborhoodSummary',
                'parkingOptions',
                'priceLevel',
                'rating',
                'regularOpeningHours',
                'servesBreakfast',
                'servesBrunch',
                'servesCoffee',
                'servesDessert',
                'servesDinner',
                'servesLunch',
                'types',
                'websiteURI',
            ],
            textQuery: args.textQuery,
            includedType: args.includedType || undefined,
            useStrictTypeFiltering: !!args.useStrictTypeFiltering,
            isOpenNow: args.isOpenNow ?? undefined,
            minRating: args.minRating ?? undefined,
            maxResultCount: args.maxResultCount ?? 10,
            languageCode: args.language || undefined,
            regionCode: args.region || undefined,
        };

        // Choose bias vs restriction if provided.
        // Bias: "prefer near here"
        // Restriction: "only within this area"
        if (args.locationRestriction) {
            body.locationRestriction = {
                circle: {
                    center: {
                        latitude: args.locationRestriction.center.lat,
                        longitude: args.locationRestriction.center.lng,
                    },
                    radius: args.locationRestriction.radius_m,
                },
            };
        } else if (args.locationBias) {
            body.locationBias = {
                point: {
                    latitude: args.locationBias.lat,
                    longitude: args.locationBias.lng,
                },
            };
        }

        const resp = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
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

                console.log('places: text-search http error', {
                    status: resp.status,
                    statusText: resp.statusText,
                    url: resp.url,
                    contentType,
                    errorBody,
                    request: {
                        textQuery: args.textQuery,
                        includedType: args.includedType ?? null,
                        useStrictTypeFiltering: !!args.useStrictTypeFiltering,
                        isOpenNow: args.isOpenNow ?? null,
                        minRating: args.minRating ?? null,
                        maxResultCount: args.maxResultCount ?? 10,
                        language: args.language ?? null,
                        region: args.region ?? null,
                        locationBias: args.locationBias ?? null,
                        locationRestriction: args.locationRestriction ?? null,
                    },
                });
            }
            return null;
        }

        /** @type {PlacesTextSearchResponse} */
        const data = /** @type {PlacesTextSearchResponse} */ (
            await resp.json()
        );

        /** @type {TextSearchPlace[]} */
        const places = (data?.places || []).map(
            /** @type {(p: GooglePlaceResult) => TextSearchPlace} */
            (p) => ({
                id: p?.id ?? null,
                name: p?.displayName?.text ?? null,
                businessStatus: p?.businessStatus ?? null,
                location:
                    p?.location &&
                    Number.isFinite(p.location.latitude) &&
                    Number.isFinite(p.location.longitude)
                        ? {
                              lat: Number(p.location.latitude),
                              lng: Number(p.location.longitude),
                          }
                        : null,
                address: p?.formattedAddress ?? null,
                mapsUrl: p?.googleMapsUri ?? null,
            })
        );

        const value = { places };
        cache.set(key, { expiresAt: now + ttlMs, value });
        return value;
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('places: text-search exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
                request: {
                    textQuery: args.textQuery,
                    includedType: args.includedType ?? null,
                    useStrictTypeFiltering: !!args.useStrictTypeFiltering,
                    isOpenNow: args.isOpenNow ?? null,
                    minRating: args.minRating ?? null,
                    maxResultCount: args.maxResultCount ?? 10,
                    language: args.language ?? null,
                    region: args.region ?? null,
                    locationBias: args.locationBias ?? null,
                    locationRestriction: args.locationRestriction ?? null,
                },
            });
        }
        return null;
    }
}

const apiKey = String(getGoogleMapsApiKey() || '');
const ttlMs = 150000;
const fieldMask = [
    'places.id',
    'places.displayName',
    'places.businessStatus',
    'places.location',
    'places.formattedAddress',
    'places.googleMapsUri',
];

/** @type {Map<string, {expiresAt:number, value:{places: TextSearchPlace[]}}>} */
const cache = new Map();

/**
 * @param {GooglePlacesTextSearchArgs} args - Tool input args.
 * @returns {string} Cache key.
 */
function cacheKey(args) {
    const bias = args.locationBias
        ? {
              lat: Math.round(args.locationBias.lat * 1e6) / 1e6,
              lng: Math.round(args.locationBias.lng * 1e6) / 1e6,
          }
        : null;

    const restrict = args.locationRestriction
        ? {
              center: {
                  lat:
                      Math.round(args.locationRestriction.center.lat * 1e6) /
                      1e6,
                  lng:
                      Math.round(args.locationRestriction.center.lng * 1e6) /
                      1e6,
              },
              radius_m: args.locationRestriction.radius_m,
          }
        : null;

    return JSON.stringify({
        textQuery: args.textQuery,
        includedType: args.includedType || null,
        useStrictTypeFiltering: !!args.useStrictTypeFiltering,
        isOpenNow: !!args.isOpenNow,
        minRating: args.minRating ?? null,
        maxResultCount: args.maxResultCount ?? 10,
        language: args.language || null,
        region: args.region || null,
        locationBias: bias,
        locationRestriction: restrict,
    });
}

/**
 * @param {GooglePlacesTextSearchArgs} args - Tool input args.
 * @returns {string|null} Returns an error string if invalid, otherwise null.
 */
function validate(args) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';
    if (typeof args.textQuery !== 'string' || !args.textQuery.trim())
        return 'Missing textQuery';

    const m = args.maxResultCount ?? 10;
    if (!Number.isFinite(m) || m < 1 || m > 20)
        return 'Invalid maxResultCount (1..20)';

    if (args.locationRestriction) {
        const r = args.locationRestriction.radius_m;
        if (!Number.isFinite(r) || r < 1 || r > 50000)
            return 'Invalid locationRestriction.radius_m (1..50000)';

        const c = args.locationRestriction.center;
        if (!c || typeof c.lat !== 'number' || c.lat < -90 || c.lat > 90)
            return 'Invalid locationRestriction.center.lat';
        if (!c || typeof c.lng !== 'number' || c.lng < -180 || c.lng > 180)
            return 'Invalid locationRestriction.center.lng';
    }

    if (args.locationBias) {
        const b = args.locationBias;
        if (typeof b.lat !== 'number' || b.lat < -90 || b.lat > 90)
            return 'Invalid locationBias.lat';
        if (typeof b.lng !== 'number' || b.lng < -180 || b.lng > 180)
            return 'Invalid locationBias.lng';
    }

    return null;
}
