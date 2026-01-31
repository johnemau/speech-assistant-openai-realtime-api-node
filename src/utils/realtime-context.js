import { isPrimaryCaller } from '../env.js';
import { formatDateTimeWithTimeZone } from './calls.js';
import { getLatestTrackLocation } from './spot-location.js';
import { resolveTimeZoneId } from './time.js';

/**
 * @typedef {object} EstimatedLocation
 * @property {{ formattedAddress?: string, street?: string, city?: string, region?: string, country?: string }} [address]
 * @property {{ city?: string, region?: string, country?: string }} [userLocation]
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} [timezoneId]
 */

/**
 * Format an estimated location string from a location payload.
 *
 * @param {EstimatedLocation | null} location - Location payload.
 * @returns {string} Formatted location string.
 */
function formatEstimatedLocation(location) {
    if (!location) return 'Unavailable';

    const formattedAddress = location?.address?.formattedAddress;
    if (formattedAddress) return formattedAddress;

    const street = location?.address?.street;
    const city = location?.address?.city || location?.userLocation?.city;
    const region = location?.address?.region || location?.userLocation?.region;
    const country =
        location?.address?.country || location?.userLocation?.country;

    const parts = [street, city, region, country].filter(Boolean);
    if (parts.length) return parts.join(', ');

    return 'Unavailable';
}

/**
 * Build a realtime instructions context section with estimated time/location.
 *
 * @param {object} root0 - Context inputs.
 * @param {string | null} [root0.callerE164] - Caller number in E.164.
 * @returns {Promise<string>} Context section text.
 */
export async function buildRealtimeContextSection({ callerE164 } = {}) {
    const isPrimary = Boolean(isPrimaryCaller(callerE164));

    /** @type {Awaited<ReturnType<typeof getLatestTrackLocation>> | null} */
    let latest = null;
    if (isPrimary) {
        try {
            latest = await getLatestTrackLocation();
        } catch {
            latest = null;
        }
    }

    const location = latest?.location || null;
    const estimatedLocation = formatEstimatedLocation(location);

    const locationLatLng =
        location &&
        Number.isFinite(location.lat) &&
        Number.isFinite(location.lng)
            ? { lat: location.lat, lng: location.lng }
            : undefined;

    let timeZoneId = location?.timezoneId;
    if (!timeZoneId) {
        const resolved = await resolveTimeZoneId({
            callerE164,
            locationLatLng,
        });
        timeZoneId = resolved?.timeZoneId;
    }

    const safeTimeZone =
        typeof timeZoneId === 'string' && timeZoneId.trim()
            ? timeZoneId.trim()
            : 'America/Los_Angeles';

    let currentTime;
    try {
        currentTime = formatDateTimeWithTimeZone({ timeZone: safeTimeZone });
    } catch {
        currentTime = formatDateTimeWithTimeZone({
            timeZone: 'America/Los_Angeles',
        });
    }

    return `At start of call (estimated):\nEstimated current time: ${currentTime}\nEstimated current location: ${estimatedLocation}\nThese may change during the call. If the user asks for time or location, or if you need the latest, call get_current_time or get_current_location to refresh.`;
}
