import { getGoogleMapsApiKey, IS_DEV } from '../env.js';

/**
 * Google Maps Platform Weather API
 * - Current conditions:  GET https://weather.googleapis.com/v1/currentConditions:lookup
 * - Daily forecast:      GET https://weather.googleapis.com/v1/forecast/days:lookup
 * - Hourly forecast:     GET https://weather.googleapis.com/v1/forecast/hours:lookup
 */

/**
 * @typedef {'METRIC'|'IMPERIAL'} UnitsSystem
 */

/**
 * @typedef {object} WeatherLocation
 * @property {number} lat
 * @property {number} lng
 */

/**
 * @typedef {object} WeatherCommonArgs
 * @property {number} lat Latitude (-90..90).
 * @property {number} lng Longitude (-180..180).
 * @property {UnitsSystem=} units_system Units system (default METRIC).
 * @property {string=} language_code BCP-47 language code (default "en").
 */

/**
 * @typedef {object} WeatherPagingArgs
 * @property {number=} page_size Max records per page:
 *  - days: 1..10 (default 5)
 *  - hours: 1..24 (default 24)
 * @property {string=} page_token Token from prior response.
 */

/**
 * @typedef {WeatherCommonArgs & WeatherPagingArgs & {days?: number}} DailyForecastArgs
 * @property {number=} days Total days to fetch (1..10, default 10).
 */

/**
 * @typedef {WeatherCommonArgs & WeatherPagingArgs & {hours?: number}} HourlyForecastArgs
 * @property {number=} hours Total hours to fetch (1..240, default 240).
 */

/**
 * @typedef {object} NormalizedCurrentConditions
 * @property {string|null} currentTime RFC3339 timestamp (UTC).
 * @property {string|null} timeZoneId IANA TZ id (e.g., "America/Los_Angeles").
 * @property {boolean|null} isDaytime
 * @property {number|null} relativeHumidity 0..100
 * @property {number|null} uvIndex
 * @property {{text:string|null, type:string|null, iconBaseUri:string|null}|null} weather
 * @property {{degrees:number|null, unit:string|null}|null} temperature
 * @property {{degrees:number|null, unit:string|null}|null} feelsLikeTemperature
 * @property {any|null} raw Full API response.
 */

/**
 * @typedef {object} NormalizedForecastPage
 * @property {string|null} timeZoneId
 * @property {string|null} nextPageToken
 * @property {any[]} items Forecast records (day/hour objects), as returned by the API.
 * @property {any|null} raw Full API response.
 */

const DEFAULT_TTL_MS = 150000;

/**
 * @type {Map<string, {expiresAt:number, value:any}>}
 */
const cache = new Map();

/**
 * @param {object} o
 * @returns {string}
 */
function stableJsonKey(o) {
    return JSON.stringify(o, Object.keys(o).sort());
}

/**
 * @param {WeatherCommonArgs} args
 * @param {string} apiKey
 * @returns {string|null}
 */
function validateCommon(args, apiKey) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';

    if (typeof args.lat !== 'number' || args.lat < -90 || args.lat > 90) {
        return 'Invalid lat';
    }
    if (typeof args.lng !== 'number' || args.lng < -180 || args.lng > 180) {
        return 'Invalid lng';
    }

    if (
        args.units_system &&
        args.units_system !== 'METRIC' &&
        args.units_system !== 'IMPERIAL'
    ) {
        return 'Invalid units_system';
    }

    if (args.language_code && typeof args.language_code !== 'string') {
        return 'Invalid language_code';
    }

    return null;
}

/**
 * @param {number|undefined} n
 * @param {number} min
 * @param {number} max
 * @param {string} name
 * @returns {string|null}
 */
function validateRange(n, min, max, name) {
    if (n == null) return null;
    if (!Number.isFinite(n) || n < min || n > max) {
        return `Invalid ${name} (${min}..${max})`;
    }
    return null;
}

/**
 * @param {string} endpointPath e.g. "/v1/currentConditions:lookup"
 * @param {Record<string, string | number | undefined | null>} query
 * @returns {string}
 */
function buildUrl(endpointPath, query) {
    const u = new URL(`https://weather.googleapis.com${endpointPath}`);
    for (const [k, v] of Object.entries(query)) {
        if (v == null || v === '') continue;
        u.searchParams.set(k, String(v));
    }
    return u.toString();
}

/**
 * @param {string} cacheKeyStr
 * @param {number} ttlMs
 * @param {() => Promise<any>} fn
 */
async function withCache(cacheKeyStr, ttlMs, fn) {
    const now = Date.now();
    const hit = cache.get(cacheKeyStr);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = await fn();
    cache.set(cacheKeyStr, { expiresAt: now + ttlMs, value });
    return value;
}

/**
 * Get current conditions at a point.
 *
 * @param {WeatherCommonArgs} args
 * @param {{ttlMs?: number}=} options
 * @returns {Promise<NormalizedCurrentConditions|null>}
 */
export async function get_current_conditions(args, options = {}) {
    try {
        const apiKey = String(getGoogleMapsApiKey() || '');
        const err = validateCommon(args, apiKey);
        if (err) return null;

        const ttlMs = Number.isFinite(options.ttlMs)
            ? options.ttlMs
            : DEFAULT_TTL_MS;

        const lat = Math.round(args.lat * 1e6) / 1e6;
        const lng = Math.round(args.lng * 1e6) / 1e6;

        const key = stableJsonKey({
            op: 'current',
            lat,
            lng,
            units_system: args.units_system ?? 'METRIC',
            language_code: args.language_code ?? 'en',
        });

        return await withCache(key, ttlMs, async () => {
            const url = buildUrl('/v1/currentConditions:lookup', {
                key: apiKey,
                'location.latitude': lat,
                'location.longitude': lng,
                unitsSystem: args.units_system,
                languageCode: args.language_code,
            });

            const resp = await fetch(url, { method: 'GET' });

            if (!resp.ok) {
                if (IS_DEV) {
                    let errorBody = null;
                    try {
                        errorBody = await resp.text();
                    } catch {
                        errorBody = null;
                    }
                    console.log('weather: current http error', {
                        status: resp.status,
                        statusText: resp.statusText,
                        url: resp.url,
                        errorBody,
                        request: {
                            lat,
                            lng,
                            units_system: args.units_system ?? 'METRIC',
                            language_code: args.language_code ?? 'en',
                        },
                    });
                }
                return null;
            }

            /** @type {any} */
            const data = await resp.json();

            /** @type {NormalizedCurrentConditions} */
            const normalized = {
                currentTime:
                    typeof data?.currentTime === 'string'
                        ? data.currentTime
                        : null,
                timeZoneId:
                    typeof data?.timeZone?.id === 'string'
                        ? data.timeZone.id
                        : null,
                isDaytime:
                    typeof data?.isDaytime === 'boolean'
                        ? data.isDaytime
                        : null,
                relativeHumidity: Number.isFinite(data?.relativeHumidity)
                    ? data.relativeHumidity
                    : null,
                uvIndex: Number.isFinite(data?.uvIndex) ? data.uvIndex : null,
                weather: data?.weatherCondition
                    ? {
                          text:
                              typeof data.weatherCondition?.description
                                  ?.text === 'string'
                                  ? data.weatherCondition.description.text
                                  : null,
                          type:
                              typeof data.weatherCondition?.type === 'string'
                                  ? data.weatherCondition.type
                                  : null,
                          iconBaseUri:
                              typeof data.weatherCondition?.iconBaseUri ===
                              'string'
                                  ? data.weatherCondition.iconBaseUri
                                  : null,
                      }
                    : null,
                temperature: data?.temperature
                    ? {
                          degrees: Number.isFinite(data.temperature?.degrees)
                              ? data.temperature.degrees
                              : null,
                          unit:
                              typeof data.temperature?.unit === 'string'
                                  ? data.temperature.unit
                                  : null,
                      }
                    : null,
                feelsLikeTemperature: data?.feelsLikeTemperature
                    ? {
                          degrees: Number.isFinite(
                              data.feelsLikeTemperature?.degrees
                          )
                              ? data.feelsLikeTemperature.degrees
                              : null,
                          unit:
                              typeof data.feelsLikeTemperature?.unit ===
                              'string'
                                  ? data.feelsLikeTemperature.unit
                                  : null,
                      }
                    : null,
                raw: data ?? null,
            };

            return normalized;
        });
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('weather: current exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
            });
        }
        return null;
    }
}

/**
 * Get daily forecast page(s) for a point.
 *
 * @param {DailyForecastArgs} args
 * @param {{ttlMs?: number}=} options
 * @returns {Promise<NormalizedForecastPage|null>}
 */
export async function get_daily_forecast(args, options = {}) {
    try {
        const apiKey = String(getGoogleMapsApiKey() || '');
        const err = validateCommon(args, apiKey);
        if (err) return null;

        const e1 = validateRange(args.days, 1, 10, 'days');
        if (e1) return null;

        const e2 = validateRange(args.page_size, 1, 10, 'page_size');
        if (e2) return null;

        if (args.page_token != null && typeof args.page_token !== 'string') {
            return null;
        }

        const ttlMs = Number.isFinite(options.ttlMs)
            ? options.ttlMs
            : DEFAULT_TTL_MS;

        const lat = Math.round(args.lat * 1e6) / 1e6;
        const lng = Math.round(args.lng * 1e6) / 1e6;

        const key = stableJsonKey({
            op: 'days',
            lat,
            lng,
            units_system: args.units_system ?? 'METRIC',
            language_code: args.language_code ?? 'en',
            days: args.days ?? 10,
            page_size: args.page_size ?? 5,
            page_token: args.page_token ?? null,
        });

        return await withCache(key, ttlMs, async () => {
            const url = buildUrl('/v1/forecast/days:lookup', {
                key: apiKey,
                'location.latitude': lat,
                'location.longitude': lng,
                unitsSystem: args.units_system,
                languageCode: args.language_code,
                days: args.days,
                pageSize: args.page_size,
                pageToken: args.page_token,
            });

            const resp = await fetch(url, { method: 'GET' });

            if (!resp.ok) {
                if (IS_DEV) {
                    let errorBody = null;
                    try {
                        errorBody = await resp.text();
                    } catch {
                        errorBody = null;
                    }
                    console.log('weather: days http error', {
                        status: resp.status,
                        statusText: resp.statusText,
                        url: resp.url,
                        errorBody,
                        request: { lat, lng, ...args },
                    });
                }
                return null;
            }

            /** @type {any} */
            const data = await resp.json();

            /** @type {NormalizedForecastPage} */
            const out = {
                timeZoneId:
                    typeof data?.timeZone?.id === 'string'
                        ? data.timeZone.id
                        : null,
                nextPageToken:
                    typeof data?.nextPageToken === 'string'
                        ? data.nextPageToken
                        : null,
                items: Array.isArray(data?.forecastDays)
                    ? data.forecastDays
                    : [],
                raw: data ?? null,
            };

            return out;
        });
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('weather: days exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
            });
        }
        return null;
    }
}

/**
 * Get hourly forecast page(s) for a point.
 *
 * @param {HourlyForecastArgs} args
 * @param {{ttlMs?: number}=} options
 * @returns {Promise<NormalizedForecastPage|null>}
 */
export async function get_hourly_forecast(args, options = {}) {
    try {
        const apiKey = String(getGoogleMapsApiKey() || '');
        const err = validateCommon(args, apiKey);
        if (err) return null;

        const e1 = validateRange(args.hours, 1, 240, 'hours');
        if (e1) return null;

        const e2 = validateRange(args.page_size, 1, 24, 'page_size');
        if (e2) return null;

        if (args.page_token != null && typeof args.page_token !== 'string') {
            return null;
        }

        const ttlMs = Number.isFinite(options.ttlMs)
            ? options.ttlMs
            : DEFAULT_TTL_MS;

        const lat = Math.round(args.lat * 1e6) / 1e6;
        const lng = Math.round(args.lng * 1e6) / 1e6;

        const key = stableJsonKey({
            op: 'hours',
            lat,
            lng,
            units_system: args.units_system ?? 'METRIC',
            language_code: args.language_code ?? 'en',
            hours: args.hours ?? 240,
            page_size: args.page_size ?? 24,
            page_token: args.page_token ?? null,
        });

        return await withCache(key, ttlMs, async () => {
            const url = buildUrl('/v1/forecast/hours:lookup', {
                key: apiKey,
                'location.latitude': lat,
                'location.longitude': lng,
                unitsSystem: args.units_system,
                languageCode: args.language_code,
                hours: args.hours,
                pageSize: args.page_size,
                pageToken: args.page_token,
            });

            const resp = await fetch(url, { method: 'GET' });

            if (!resp.ok) {
                if (IS_DEV) {
                    let errorBody = null;
                    try {
                        errorBody = await resp.text();
                    } catch {
                        errorBody = null;
                    }
                    console.log('weather: hours http error', {
                        status: resp.status,
                        statusText: resp.statusText,
                        url: resp.url,
                        errorBody,
                        request: { lat, lng, ...args },
                    });
                }
                return null;
            }

            /** @type {any} */
            const data = await resp.json();

            /** @type {NormalizedForecastPage} */
            const out = {
                timeZoneId:
                    typeof data?.timeZone?.id === 'string'
                        ? data.timeZone.id
                        : null,
                nextPageToken:
                    typeof data?.nextPageToken === 'string'
                        ? data.nextPageToken
                        : null,
                items: Array.isArray(data?.forecastHours)
                    ? data.forecastHours
                    : [],
                raw: data ?? null,
            };

            return out;
        });
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('weather: hours exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
            });
        }
        return null;
    }
}

/**
 * Back-compat alias for your requested function name typo.
 * @deprecated Prefer `get_hourly_forecast`.
 */
export const get_hourly_forcast = get_hourly_forecast;
