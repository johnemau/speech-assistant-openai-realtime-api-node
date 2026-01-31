import { getGoogleMapsApiKey, IS_DEV } from '../env.js';

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_TIMEZONE_ID = 'America/Los_Angeles';

/**
 * @param {string} url - URL to redact.
 * @returns {string} Redacted URL.
 */
function redactUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('key')) {
            parsed.searchParams.set('key', 'REDACTED');
        }
        if (parsed.searchParams.has('apiKey')) {
            parsed.searchParams.set('apiKey', 'REDACTED');
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * @typedef {object} GeocodeComponent
 * @property {string[]} [types]
 * @property {string} [long_name]
 * @property {string} [short_name]
 */

/**
 * @typedef {object} GeocodeResultItem
 * @property {GeocodeComponent[]} [address_components]
 * @property {string} [formatted_address]
 */

/**
 * @typedef {object} GeocodeResponse
 * @property {GeocodeResultItem[]} [results]
 */

/**
 * @typedef {object} TimezoneResponse
 * @property {string} [status]
 * @property {string} [timeZoneId]
 */

/**
 * @param {number} lat - Latitude in degrees.
 * @param {number} lng - Longitude in degrees.
 * @returns {boolean} True when the coordinates are valid.
 */
function isValidLatLng(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat === -99999 || lng === -99999) return false;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
    return true;
}

/**
 * @param {string} url - Request URL.
 * @param {RequestInit & { timeoutMs?: number }} [init] - Fetch init options.
 * @returns {Promise<unknown>} Parsed JSON response.
 */
async function fetchJson(url, init = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init;
    if (typeof fetch !== 'function') {
        throw new Error('fetch is not available in this runtime.');
    }

    const controller = new AbortController();
    const safeUrl = redactUrl(url);
    const method = requestInit.method ?? 'GET';
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            ...requestInit,
            signal: controller.signal,
        });
        if (!res.ok) {
            let text = '';
            let contentType = null;
            try {
                contentType = res.headers?.get('content-type') ?? null;
                text = await res.text();
            } catch {
                text = '';
            }
            if (IS_DEV) {
                console.log('location: http error', {
                    status: res.status,
                    statusText: res.statusText,
                    url: safeUrl,
                    contentType,
                    errorBody: text || null,
                    request: {
                        method,
                        timeoutMs,
                    },
                });
            }
            const httpError = new Error(
                `HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`
            );
            httpError.name = 'HttpError';
            throw httpError;
        }
        return await res.json();
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            if (err?.name !== 'HttpError') {
                console.log('location: fetch exception', {
                    name: err?.name ?? null,
                    message: err?.message ?? null,
                    stack: err?.stack ?? null,
                    url: safeUrl,
                    request: {
                        method,
                        timeoutMs,
                    },
                });
            }
        }
        throw error;
    } finally {
        clearTimeout(t);
    }
}

/**
 * @param {Array<{ types?: string[], long_name?: string, short_name?: string }>} components - Address components list.
 * @param {string} type - Component type to match.
 * @returns {{ types?: string[], long_name?: string, short_name?: string } | null} Matched component or null.
 */
function pickComponent(components, type) {
    return (
        components.find(
            (c) => Array.isArray(c.types) && c.types.includes(type)
        ) || null
    );
}

/**
 * @param {Array<{ types?: string[], long_name?: string, short_name?: string }>} components - Address components list.
 * @returns {string | null} Best-effort city name.
 */
function extractCity(components) {
    return (
        pickComponent(components, 'locality')?.long_name ||
        pickComponent(components, 'postal_town')?.long_name ||
        pickComponent(components, 'sublocality_level_1')?.long_name ||
        pickComponent(components, 'sublocality')?.long_name ||
        pickComponent(components, 'administrative_area_level_3')?.long_name ||
        null
    );
}

/**
 * @param {Array<{ types?: string[], long_name?: string, short_name?: string }>} components - Address components list.
 * @returns {string | undefined} Street address if available.
 */
function extractStreet(components) {
    const streetNumber = pickComponent(components, 'street_number')?.long_name;
    const route = pickComponent(components, 'route')?.long_name;
    if (streetNumber && route) return `${streetNumber} ${route}`;
    return route || streetNumber || undefined;
}

/**
 * @param {any} geocode - Geocode payload.
 * @returns {boolean} True when geocode has results.
 */
function hasGeocodeResults(geocode) {
    return Array.isArray(geocode?.results) && geocode.results.length > 0;
}

/**
 * @param {GeocodeResponse} geocodeJson - Geocode API response payload.
 * @returns {{ type: 'approximate', country?: string, region?: string, city?: string }} Approximate user location.
 */
function mapGeocodeToUserLocation(geocodeJson) {
    const first = geocodeJson?.results?.[0];
    const components = first?.address_components || [];

    const country =
        pickComponent(components, 'country')?.short_name || undefined;
    const region =
        pickComponent(components, 'administrative_area_level_1')?.long_name ||
        undefined;
    const city = extractCity(components) || undefined;

    return { type: 'approximate', country, region, city };
}

/**
 * @param {GeocodeResponse} geocodeJson - Geocode API response payload.
 * @returns {{ formattedAddress?: string, street?: string, city?: string, region?: string, postalCode?: string, country?: string, countryCode?: string }} Address details.
 */
function mapGeocodeToAddress(geocodeJson) {
    const first = geocodeJson?.results?.[0];
    const components = first?.address_components || [];
    const formattedAddress = first?.formatted_address || undefined;
    const street = extractStreet(components);
    const city = extractCity(components) || undefined;
    const region =
        pickComponent(components, 'administrative_area_level_1')?.long_name ||
        undefined;
    const postalCode =
        pickComponent(components, 'postal_code')?.long_name || undefined;
    const country =
        pickComponent(components, 'country')?.long_name || undefined;
    const countryCode =
        pickComponent(components, 'country')?.short_name || undefined;

    return {
        formattedAddress,
        street,
        city,
        region,
        postalCode,
        country,
        countryCode,
    };
}

/**
 * @param {object} root0 - Reverse geocode options.
 * @param {number} root0.lat - Latitude in degrees.
 * @param {number} root0.lng - Longitude in degrees.
 * @param {string} root0.apiKey - Google Maps API key.
 * @param {string} [root0.language] - Optional locale string.
 * @param {string} [root0.resultType] - Optional result type filter.
 * @param {string} [root0.locationType] - Optional location type filter.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs] - Optional timeout override in ms.
 * @returns {Promise<GeocodeResponse>} Raw geocode JSON payload.
 */
export async function reverseGeocode({
    lat,
    lng,
    apiKey,
    language,
    timestampSeconds,
    resultType,
    locationType,
    timeoutMs,
}) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', apiKey);
    if (language) url.searchParams.set('language', language);
    if (resultType) url.searchParams.set('result_type', resultType);
    if (locationType) url.searchParams.set('location_type', locationType);
    if (timestampSeconds != null) {
        url.searchParams.set('timestamp', String(timestampSeconds));
    }
    return /** @type {Promise<GeocodeResponse>} */ (
        fetchJson(url.toString(), { timeoutMs })
    );
}

/**
 * @param {object} root0 - Timezone lookup options.
 * @param {number} root0.lat - Latitude in degrees.
 * @param {number} root0.lng - Longitude in degrees.
 * @param {string} root0.apiKey - Google Maps API key.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs] - Optional timeout override in ms.
 * @returns {Promise<TimezoneResponse>} Raw timezone JSON payload.
 */
async function lookupTimezone({
    lat,
    lng,
    apiKey,
    timestampSeconds,
    timeoutMs,
}) {
    const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
    url.searchParams.set('location', `${lat},${lng}`);
    url.searchParams.set(
        'timestamp',
        String(timestampSeconds ?? Math.floor(Date.now() / 1000))
    );
    url.searchParams.set('key', apiKey);
    return /** @type {Promise<TimezoneResponse>} */ (
        fetchJson(url.toString(), { timeoutMs })
    );
}

/**
 * Resolve an approximate user location and address from latitude/longitude.
 *
 * @param {object} [root0] - Location lookup options.
 * @param {number} [root0.lat] - Latitude in degrees.
 * @param {number} [root0.lng] - Longitude in degrees.
 * @param {string} [root0.language] - Optional locale string.
 * @param {boolean} [root0.includeTimezone=true] - Whether to include timezone lookup.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs=15000] - Optional timeout override in ms.
 * @returns {Promise<{
 *  lat: number,
 *  lng: number,
 *  userLocation: { type: 'approximate', country?: string, region?: string, city?: string },
 *  address: { formattedAddress?: string, street?: string, city?: string, region?: string, postalCode?: string, country?: string, countryCode?: string },
 *  geocode: object,
 *  timezone?: object,
 *  timezoneId?: string
 * }>} Location result with optional timezone data.
 */
export async function locationFromLatLng({
    lat,
    lng,
    language,
    includeTimezone = true,
    timestampSeconds,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    const resolvedLat = Number(lat);
    const resolvedLng = Number(lng);
    const apiKey = getGoogleMapsApiKey();

    if (IS_DEV) {
        console.log('locationFromLatLng:start', {
            lat: resolvedLat,
            lng: resolvedLng,
            includeTimezone,
            language,
            hasApiKey: Boolean(apiKey),
        });
    }

    if (!isValidLatLng(resolvedLat, resolvedLng)) {
        if (IS_DEV) {
            console.log('locationFromLatLng:invalid-latlng', {
                lat: resolvedLat,
                lng: resolvedLng,
            });
        }
        throw new Error('lat and lng must be valid numbers.');
    }
    if (!apiKey) {
        if (IS_DEV) {
            console.log('locationFromLatLng:missing-api-key');
        }
        throw new Error('apiKey is required.');
    }

    let geocode = await reverseGeocode({
        lat: resolvedLat,
        lng: resolvedLng,
        apiKey,
        language,
        timeoutMs,
    });
    if (!hasGeocodeResults(geocode)) {
        if (IS_DEV) {
            console.log('locationFromLatLng:geocode-fallback', {
                lat: resolvedLat,
                lng: resolvedLng,
            });
        }
        geocode = await reverseGeocode({
            lat: resolvedLat,
            lng: resolvedLng,
            apiKey,
            language,
            resultType: 'locality|administrative_area_level_1|country',
            locationType: 'APPROXIMATE',
            timeoutMs,
        });
    }
    if (!hasGeocodeResults(geocode)) {
        if (IS_DEV) {
            console.log('locationFromLatLng:geocode-fallback', {
                lat: resolvedLat,
                lng: resolvedLng,
            });
        }
    }
    if (IS_DEV) {
        console.log('locationFromLatLng:geocode-received', {
            hasResults: Array.isArray(geocode?.results),
            resultsCount: geocode?.results?.length ?? 0,
        });
    }

    const userLocation = mapGeocodeToUserLocation(geocode);
    const address = mapGeocodeToAddress(geocode);
    if (IS_DEV) {
        console.log('locationFromLatLng:derived-location', {
            userLocation,
            address,
        });
    }

    let timezone;
    let timezoneId;
    if (includeTimezone) {
        timezone = await lookupTimezone({
            lat: resolvedLat,
            lng: resolvedLng,
            apiKey,
            timestampSeconds,
            timeoutMs,
        });
        if (timezone?.status === 'OK' && timezone?.timeZoneId) {
            timezoneId = timezone.timeZoneId;
        }
        if (!timezoneId) {
            timezoneId = DEFAULT_TIMEZONE_ID;
        }
        if (IS_DEV) {
            console.log('locationFromLatLng:timezone-resolved', {
                status: timezone?.status,
                timezoneId,
                usedFallback: timezoneId === DEFAULT_TIMEZONE_ID,
            });
        }
    } else if (IS_DEV) {
        console.log('locationFromLatLng:timezone-skipped');
    }

    const result = {
        lat: resolvedLat,
        lng: resolvedLng,
        userLocation,
        address,
        geocode,
        timezone,
        timezoneId,
    };

    if (IS_DEV) {
        console.log('locationFromLatLng:return', {
            lat: result.lat,
            lng: result.lng,
            timezoneId: result.timezoneId,
        });
    }

    return result;
}
