import {
    get_current_conditions as realGetCurrentConditions,
    get_daily_forecast as realGetDailyForecast,
    get_hourly_forecast as realGetHourlyForecast,
} from '../utils/weather-at-place.js';
import { getLatestTrackLocation as realGetLatestTrackLocation } from '../utils/spot-location.js';
import { execute as realGptWebSearch } from './gpt-web-search.js';
import { IS_DEV, isPrimaryCaller } from '../env.js';

const WEATHER_UNAVAILABLE_MESSAGE = 'Weather unavailable.';
const DEFAULT_LOCATION = {
    lat: 47.673988,
    lng: -122.121513,
    label: 'Redmond, Washington',
    userLocation: {
        type: 'approximate',
        city: 'Redmond',
        region: 'Washington',
        country: 'US',
    },
};

/** @type {typeof realGetCurrentConditions} */
let getCurrentConditionsImpl = realGetCurrentConditions;

/** @type {typeof realGetDailyForecast} */
let getDailyForecastImpl = realGetDailyForecast;

/** @type {typeof realGetHourlyForecast} */
let getHourlyForecastImpl = realGetHourlyForecast;

/** @type {typeof realGetLatestTrackLocation} */
let getLatestTrackLocationImpl = realGetLatestTrackLocation;

/** @type {typeof realGptWebSearch} */
let gptWebSearchImpl = realGptWebSearch;

/**
 * @typedef {'current'|'daily'|'hourly'} WeatherForecastType
 */

export const definition = {
    type: 'function',
    name: 'weather',
    parameters: {
        type: 'object',
        properties: {
            forecast_type: {
                type: 'string',
                description: 'current, daily, or hourly. Defaults to current.',
                enum: ['current', 'daily', 'hourly'],
            },
            address: {
                type: 'string',
                description: 'Optional address or place name.',
            },
            location: {
                type: 'object',
                description: 'Optional lat/lng pair.',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            lat: {
                type: 'number',
                description: 'Optional latitude (-90..90).',
            },
            lng: {
                type: 'number',
                description: 'Optional longitude (-180..180).',
            },
            days: {
                type: 'number',
                description: 'Daily forecast days (1..10).',
            },
            hours: {
                type: 'number',
                description: 'Hourly forecast hours (1..240).',
            },
            page_size: {
                type: 'number',
                description: 'Forecast page size.',
            },
            page_token: {
                type: 'string',
                description: 'Forecast page token.',
            },
            units_system: {
                type: 'string',
                description: 'Units system: METRIC or IMPERIAL.',
                enum: ['METRIC', 'IMPERIAL'],
            },
            language_code: {
                type: 'string',
                description: 'BCP-47 language code (e.g., "en").',
            },
        },
    },
    description:
        'Get current conditions or forecast for an address or lat/lng. If no location is provided, uses the primary caller’s latest tracked location; otherwise defaults to Redmond, Washington. Falls back to web search when weather is unavailable.',
};

/**
 * @param {WeatherForecastType} forecastType Forecast type.
 * @param {string} label Location label.
 * @param {number=} hours Optional hours.
 * @param {number=} days Optional days.
 * @returns {string} Web search query.
 */
function buildWeatherQuery(forecastType, label, hours, days) {
    const suffix = label ? ` in ${label}` : '';
    if (forecastType === 'daily') {
        const dayCount = Number.isFinite(days) ? Number(days) : null;
        return dayCount
            ? `daily weather forecast next ${dayCount} days${suffix}`
            : `daily weather forecast${suffix}`;
    }
    if (forecastType === 'hourly') {
        const hourCount = Number.isFinite(hours) ? Number(hours) : null;
        return hourCount
            ? `hourly weather forecast next ${hourCount} hours${suffix}`
            : `hourly weather forecast${suffix}`;
    }
    return `current weather${suffix}`;
}

/**
 * Execute weather tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ forecast_type?: string, address?: string, location?: { lat?: number, lng?: number }, lat?: number, lng?: number, days?: number, hours?: number, page_size?: number, page_token?: string, units_system?: 'METRIC'|'IMPERIAL', language_code?: string }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<object>} Weather tool payload.
 */
export async function execute({ args, context }) {
    const rawArgs = args ?? {};
    const forecastType = ['current', 'daily', 'hourly'].includes(
        String(rawArgs?.forecast_type)
    )
        ? /** @type {WeatherForecastType} */ (rawArgs.forecast_type)
        : 'current';

    const address =
        typeof rawArgs.address === 'string' ? rawArgs.address.trim() : '';

    const location = rawArgs?.location;
    const hasLocationLatLng =
        !!location &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lng);

    const hasLatLng =
        Number.isFinite(rawArgs?.lat) && Number.isFinite(rawArgs?.lng);

    /** @type {{ lat: number, lng: number } | null} */
    let latLng = null;
    /** @type {string} */
    let locationLabel = address || '';
    /** @type {object | undefined} */
    let userLocation = undefined;
    /** @type {'address'|'latlng'|'track'|'default'} */
    let locationSource = 'address';

    if (!address && hasLocationLatLng) {
        latLng = {
            lat: Number(location.lat),
            lng: Number(location.lng),
        };
        locationLabel = `${latLng.lat}, ${latLng.lng}`;
        locationSource = 'latlng';
    } else if (!address && hasLatLng) {
        latLng = {
            lat: Number(rawArgs.lat),
            lng: Number(rawArgs.lng),
        };
        locationLabel = `${latLng.lat}, ${latLng.lng}`;
        locationSource = 'latlng';
    }

    if (!address && !latLng) {
        const currentCallerE164 = context?.currentCallerE164 || null;
        const allowTrackedLocation =
            !!currentCallerE164 && isPrimaryCaller(currentCallerE164);
        if (allowTrackedLocation) {
            const latest = await getLatestTrackLocationImpl();
            const latestLocation = latest?.location;
            if (
                latestLocation &&
                Number.isFinite(latestLocation.lat) &&
                Number.isFinite(latestLocation.lng)
            ) {
                latLng = {
                    lat: Number(latestLocation.lat),
                    lng: Number(latestLocation.lng),
                };
                userLocation = latestLocation.userLocation || undefined;
                locationLabel =
                    latestLocation?.address?.formattedAddress ||
                    `${latLng.lat}, ${latLng.lng}`;
                locationSource = 'track';
            }
        }
    }

    if (!address && !latLng) {
        latLng = { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng };
        locationLabel = DEFAULT_LOCATION.label;
        userLocation = DEFAULT_LOCATION.userLocation;
        locationSource = 'default';
    }

    if (IS_DEV) {
        console.log('weather: execute start', {
            forecastType,
            hasAddress: Boolean(address),
            latLng,
            locationSource,
        });
    }

    const baseArgs = {
        units_system: rawArgs?.units_system,
        language_code: rawArgs?.language_code,
    };

    let weatherResult = null;
    if (forecastType === 'daily') {
        weatherResult = await getDailyForecastImpl({
            ...(address ? { address } : latLng || {}),
            ...baseArgs,
            days: rawArgs?.days,
            page_size: rawArgs?.page_size,
            page_token: rawArgs?.page_token,
        });
    } else if (forecastType === 'hourly') {
        weatherResult = await getHourlyForecastImpl({
            ...(address ? { address } : latLng || {}),
            ...baseArgs,
            hours: rawArgs?.hours,
            page_size: rawArgs?.page_size,
            page_token: rawArgs?.page_token,
        });
    } else {
        weatherResult = await getCurrentConditionsImpl({
            ...(address ? { address } : latLng || {}),
            ...baseArgs,
        });
    }

    if (!weatherResult) {
        const query = buildWeatherQuery(
            forecastType,
            locationLabel,
            rawArgs?.hours,
            rawArgs?.days
        );
        const webSearch = await gptWebSearchImpl({
            args: {
                query,
                user_location: userLocation,
            },
            context: context ?? {},
        });
        return {
            status: 'fallback',
            message: WEATHER_UNAVAILABLE_MESSAGE,
            forecast_type: forecastType,
            location: address || latLng || null,
            location_source: locationSource,
            query,
            web_search: webSearch,
        };
    }

    return {
        status: 'ok',
        forecast_type: forecastType,
        location: address || latLng || null,
        location_source: locationSource,
        result: weatherResult,
    };
}

/**
 * Test-only override for weather calls.
 * @param {{ getCurrentConditions?: typeof realGetCurrentConditions, getDailyForecast?: typeof realGetDailyForecast, getHourlyForecast?: typeof realGetHourlyForecast }} overrides - Replacement implementations.
 */
export function setWeatherForTests(overrides = {}) {
    getCurrentConditionsImpl =
        overrides.getCurrentConditions || realGetCurrentConditions;
    getDailyForecastImpl = overrides.getDailyForecast || realGetDailyForecast;
    getHourlyForecastImpl =
        overrides.getHourlyForecast || realGetHourlyForecast;
}

/** Restore the default weather implementations. */
export function resetWeatherForTests() {
    getCurrentConditionsImpl = realGetCurrentConditions;
    getDailyForecastImpl = realGetDailyForecast;
    getHourlyForecastImpl = realGetHourlyForecast;
}

/**
 * Test-only override for getLatestTrackLocation.
 * @param {typeof realGetLatestTrackLocation} override - Replacement implementation.
 */
export function setGetLatestTrackLocationForTests(override) {
    getLatestTrackLocationImpl = override || realGetLatestTrackLocation;
}

/** Restore the default getLatestTrackLocation implementation. */
export function resetGetLatestTrackLocationForTests() {
    getLatestTrackLocationImpl = realGetLatestTrackLocation;
}

/**
 * Test-only override for gpt_web_search.
 * @param {typeof realGptWebSearch} override - Replacement implementation.
 */
export function setGptWebSearchForTests(override) {
    gptWebSearchImpl = override || realGptWebSearch;
}

/** Restore the default gpt_web_search implementation. */
export function resetGptWebSearchForTests() {
    gptWebSearchImpl = realGptWebSearch;
}
