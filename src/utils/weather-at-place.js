import { getLatLngFromAddress } from './address-lat-lng.js';
import {
    get_current_conditions as get_current_conditions_at_point,
    get_daily_forecast as get_daily_forecast_at_point,
    get_hourly_forecast as get_hourly_forecast_at_point,
} from './weather.js';

/**
 * @typedef {'METRIC'|'IMPERIAL'} UnitsSystem
 */

/**
 * @typedef {object} WeatherPlaceArgs
 * @property {string=} address Address string to resolve.
 * @property {number=} lat Latitude (-90..90).
 * @property {number=} lng Longitude (-180..180).
 * @property {{lat:number,lng:number}=} location Lat/lng pair.
 */

/**
 * @typedef {object} WeatherCommonArgs
 * @property {number=} lat Latitude (-90..90).
 * @property {number=} lng Longitude (-180..180).
 * @property {UnitsSystem=} units_system Units system (default METRIC).
 * @property {string=} language_code BCP-47 language code (default "en").
 */

/**
 * @typedef {object} WeatherPagingArgs
 * @property {number=} page_size Max records per page.
 * @property {string=} page_token Token from prior response.
 */

/**
 * @typedef {WeatherCommonArgs & WeatherPagingArgs & {days?: number}} DailyForecastArgs
 */

/**
 * @typedef {WeatherCommonArgs & WeatherPagingArgs & {hours?: number}} HourlyForecastArgs
 */

/**
 * @typedef {object} NormalizedCurrentConditions
 * @property {string|null} currentTime
 * @property {string|null} timeZoneId
 * @property {boolean|null} isDaytime
 * @property {number|null} relativeHumidity
 * @property {number|null} uvIndex
 * @property {{text:string|null, type:string|null, iconBaseUri:string|null}|null} weather
 * @property {{degrees:number|null, unit:string|null}|null} temperature
 * @property {{degrees:number|null, unit:string|null}|null} feelsLikeTemperature
 * @property {any|null} raw
 */

/**
 * @typedef {object} NormalizedForecastPage
 * @property {string|null} timeZoneId
 * @property {string|null} nextPageToken
 * @property {any[]} items
 * @property {any|null} raw
 */

/**
 * @typedef {WeatherPlaceArgs & WeatherCommonArgs} WeatherPlaceCommonArgs
 */

/**
 * @typedef {WeatherPlaceCommonArgs & DailyForecastArgs} WeatherPlaceDailyArgs
 */

/**
 * @typedef {WeatherPlaceCommonArgs & HourlyForecastArgs} WeatherPlaceHourlyArgs
 */

/**
 * @param {WeatherPlaceArgs | undefined | null} args Args to resolve location from.
 * @returns {Promise<{lat:number,lng:number}|null>} Resolved coordinates.
 */
async function resolveLatLng(args) {
    if (!args || typeof args !== 'object') return null;

    if (typeof args.address === 'string' && args.address.trim()) {
        return getLatLngFromAddress(args.address);
    }

    if (Number.isFinite(args.lat) && Number.isFinite(args.lng)) {
        return { lat: Number(args.lat), lng: Number(args.lng) };
    }

    if (
        args.location &&
        Number.isFinite(args.location.lat) &&
        Number.isFinite(args.location.lng)
    ) {
        return {
            lat: Number(args.location.lat),
            lng: Number(args.location.lng),
        };
    }

    return null;
}

/**
 * Get current conditions at a place (address or lat/lng).
 *
 * @param {WeatherPlaceCommonArgs} args Request arguments.
 * @param {{ttlMs?: number}=} options Optional caching options.
 * @returns {Promise<NormalizedCurrentConditions|null>} Normalized current conditions.
 */
export async function get_current_conditions(args, options = {}) {
    const loc = await resolveLatLng(args);
    if (!loc) return null;

    const { address, location, ...rest } = args ?? {};
    return get_current_conditions_at_point(
        {
            ...rest,
            lat: loc.lat,
            lng: loc.lng,
        },
        options
    );
}

/**
 * Get daily forecast page(s) for a place (address or lat/lng).
 *
 * @param {WeatherPlaceDailyArgs} args Request arguments.
 * @param {{ttlMs?: number}=} options Optional caching options.
 * @returns {Promise<NormalizedForecastPage|null>} Normalized forecast page.
 */
export async function get_daily_forecast(args, options = {}) {
    const loc = await resolveLatLng(args);
    if (!loc) return null;

    const { address, location, ...rest } = args ?? {};
    return get_daily_forecast_at_point(
        {
            ...rest,
            lat: loc.lat,
            lng: loc.lng,
        },
        options
    );
}

/**
 * Get hourly forecast page(s) for a place (address or lat/lng).
 *
 * @param {WeatherPlaceHourlyArgs} args Request arguments.
 * @param {{ttlMs?: number}=} options Optional caching options.
 * @returns {Promise<NormalizedForecastPage|null>} Normalized forecast page.
 */
export async function get_hourly_forecast(args, options = {}) {
    const loc = await resolveLatLng(args);
    if (!loc) return null;

    const { address, location, ...rest } = args ?? {};
    return get_hourly_forecast_at_point(
        {
            ...rest,
            lat: loc.lat,
            lng: loc.lng,
        },
        options
    );
}

/**
 * Back-compat alias for your requested function name typo.
 * @deprecated Prefer `get_hourly_forecast`.
 * @returns {Promise<NormalizedForecastPage|null>} Normalized forecast page.
 */
export const get_hourly_forcast = get_hourly_forecast;
