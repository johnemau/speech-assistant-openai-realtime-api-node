const DEFAULT_TIMEOUT_MS = 15000;

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
 * @param {object} [init] - Fetch init options.
 * @param {number} [init.timeoutMs=15000] - Request timeout in ms.
 * @returns {Promise<unknown>} Parsed JSON response.
 */
async function fetchJson(
    url,
    { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = {}
) {
    if (typeof fetch !== 'function') {
        throw new Error('fetch is not available in this runtime.');
    }

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) {
            let text = '';
            try {
                text = await res.text();
            } catch {
                text = '';
            }
            throw new Error(
                `HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`
            );
        }
        return await res.json();
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
 * @param {object} geocodeJson - Geocode API response payload.
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
 * @param {object} geocodeJson - Geocode API response payload.
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
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs] - Optional timeout override in ms.
 * @returns {Promise<object>} Raw geocode JSON payload.
 */
async function reverseGeocode({
    lat,
    lng,
    apiKey,
    language,
    timestampSeconds,
    timeoutMs,
}) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${lat},${lng}`);
    url.searchParams.set('key', apiKey);
    if (language) url.searchParams.set('language', language);
    if (timestampSeconds != null) {
        url.searchParams.set('timestamp', String(timestampSeconds));
    }
    return fetchJson(url.toString(), { timeoutMs });
}

/**
 * @param {object} root0 - Timezone lookup options.
 * @param {number} root0.lat - Latitude in degrees.
 * @param {number} root0.lng - Longitude in degrees.
 * @param {string} root0.apiKey - Google Maps API key.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs] - Optional timeout override in ms.
 * @returns {Promise<object>} Raw timezone JSON payload.
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
    return fetchJson(url.toString(), { timeoutMs });
}

/**
 * Resolve an approximate user location and address from latitude/longitude.
 *
 * @param {object} root0 - Location lookup options.
 * @param {number} root0.lat - Latitude in degrees.
 * @param {number} root0.lng - Longitude in degrees.
 * @param {string} root0.apiKey - Google Maps API key.
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
    apiKey,
    language,
    includeTimezone = true,
    timestampSeconds,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    if (!isValidLatLng(lat, lng)) {
        throw new Error('lat and lng must be valid numbers.');
    }
    if (!apiKey) {
        throw new Error('apiKey is required.');
    }

    const geocode = await reverseGeocode({
        lat,
        lng,
        apiKey,
        language,
        timeoutMs,
    });

    const userLocation = mapGeocodeToUserLocation(geocode);
    const address = mapGeocodeToAddress(geocode);

    let timezone;
    let timezoneId;
    if (includeTimezone) {
        timezone = await lookupTimezone({
            lat,
            lng,
            apiKey,
            timestampSeconds,
            timeoutMs,
        });
        if (timezone?.status === 'OK' && timezone?.timeZoneId) {
            timezoneId = timezone.timeZoneId;
        }
    }

    return {
        lat,
        lng,
        userLocation,
        address,
        geocode,
        timezone,
        timezoneId,
    };
}
