import { PRIMARY_CALLERS_SET } from '../env.js';
import { getLatestTrackLocation } from '../utils/spot-location.js';

const LOCATION_UNAVAILABLE_MESSAGE = 'Location infomration not available.';

/**
 * @typedef {object} CurrentLocationResult
 * @property {number} lat
 * @property {number} lng
 * @property {{ type: 'approximate', country?: string, region?: string, city?: string }} userLocation
 * @property {{ formattedAddress?: string, street?: string, city?: string, region?: string, postalCode?: string, country?: string, countryCode?: string }} address
 * @property {object} geocode
 * @property {object} [timezone]
 * @property {string} [timezoneId]
 */

export const definition = {
    type: 'function',
    name: 'get_current_location',
    parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
    },
    description:
        'Get the current tracked location for the caller. Only available for primary callers; returns location, address, and timezone details when available. Prefer reading location.address and location.userLocation when mentioning the street, city, and region.',
};

/**
 * Execute get_current_location tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {object} [root0.args] - Tool arguments (unused).
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<{ status: 'ok', track: object, location: CurrentLocationResult } | { status: 'unavailable', message: string }>} Location result.
 */
export async function execute({ args: _args, context }) {
    const currentCallerE164 = context?.currentCallerE164 || null;
    if (!currentCallerE164 || !PRIMARY_CALLERS_SET.has(currentCallerE164)) {
        return {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        };
    }

    const latest = await getLatestTrackLocation();
    if (!latest) {
        return {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        };
    }

    return {
        status: 'ok',
        track: latest.track,
        location: latest.location,
    };
}
