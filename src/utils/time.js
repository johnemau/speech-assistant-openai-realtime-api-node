import { getSpotFeedId, getSpotFeedPassword, isPrimaryCaller } from '../env.js';
import { getLatLngFromAddress } from './address-lat-lng.js';
import { locationFromLatLng } from './location.js';
import { getLatestTrackTimezone } from './spot.js';

/**
 * @typedef {object} ResolveTimeZoneResult
 * @property {string} timeZoneId
 * @property {'explicit_time_zone' | 'location' | 'coordinates' | 'spot' | 'default'} source
 */

/**
 * Resolve a timezone ID from explicit input, location, or SPOT fallback.
 *
 * @param {object} root0 - Resolver inputs.
 * @param {string} [root0.timeZone] - Explicit IANA timezone override.
 * @param {string} [root0.location] - Location text query.
 * @param {number} [root0.lat] - Latitude.
 * @param {number} [root0.lng] - Longitude.
 * @param {{ lat?: number, lng?: number }} [root0.locationLatLng] - Lat/lng object.
 * @param {string | null} [root0.callerE164] - Caller number in E.164.
 * @param {string} [root0.fallbackTimeZone] - Fallback IANA timezone.
 * @param {(address: string) => Promise<{ lat: number, lng: number } | null>} [root0.getLatLngFromAddressFn] - Address resolver.
 * @param {(input: { lat: number, lng: number, includeTimezone?: boolean }) => Promise<{ timezoneId?: string }>} [root0.locationFromLatLngFn] - Lat/lng timezone resolver.
 * @param {() => Promise<{ timezoneId?: string | null } | null>} [root0.getLatestTrackTimezoneFn] - SPOT timezone lookup.
 * @param {(callerE164?: string | null) => boolean} [root0.isPrimaryCallerFn] - Primary caller check.
 * @param {() => string | undefined} [root0.getSpotFeedIdFn] - SPOT feed ID accessor.
 * @param {() => string | undefined} [root0.getSpotFeedPasswordFn] - SPOT password accessor.
 * @returns {Promise<ResolveTimeZoneResult>} Resolved timezone ID and source.
 */
export async function resolveTimeZoneId({
    timeZone,
    location,
    lat,
    lng,
    locationLatLng,
    callerE164,
    fallbackTimeZone = 'America/Los_Angeles',
    getLatLngFromAddressFn = getLatLngFromAddress,
    locationFromLatLngFn = locationFromLatLng,
    getLatestTrackTimezoneFn = getLatestTrackTimezone,
    isPrimaryCallerFn = isPrimaryCaller,
    getSpotFeedIdFn = getSpotFeedId,
    getSpotFeedPasswordFn = getSpotFeedPassword,
} = {}) {
    const explicitTimeZone =
        typeof timeZone === 'string' ? timeZone.trim() : '';
    if (explicitTimeZone) {
        return { timeZoneId: explicitTimeZone, source: 'explicit_time_zone' };
    }

    const normalizedLocation =
        typeof location === 'string' ? location.trim() : '';

    const locationLat = Number.isFinite(locationLatLng?.lat)
        ? Number(locationLatLng?.lat)
        : undefined;
    const locationLng = Number.isFinite(locationLatLng?.lng)
        ? Number(locationLatLng?.lng)
        : undefined;

    const explicitLat = Number.isFinite(lat) ? Number(lat) : undefined;
    const explicitLng = Number.isFinite(lng) ? Number(lng) : undefined;

    /** @type {{ lat: number, lng: number } | null} */
    let resolvedLatLng = null;
    /** @type {ResolveTimeZoneResult['source']} */
    let source = 'default';

    if (typeof locationLat === 'number' && typeof locationLng === 'number') {
        resolvedLatLng = { lat: locationLat, lng: locationLng };
        source = 'coordinates';
    } else if (
        typeof explicitLat === 'number' &&
        typeof explicitLng === 'number'
    ) {
        resolvedLatLng = { lat: explicitLat, lng: explicitLng };
        source = 'coordinates';
    } else if (normalizedLocation) {
        resolvedLatLng = await getLatLngFromAddressFn(normalizedLocation);
        if (resolvedLatLng) source = 'location';
    }

    if (resolvedLatLng) {
        try {
            const locationResult = await locationFromLatLngFn({
                lat: resolvedLatLng.lat,
                lng: resolvedLatLng.lng,
                includeTimezone: true,
            });
            if (locationResult?.timezoneId) {
                return { timeZoneId: locationResult.timezoneId, source };
            }
        } catch {
            return { timeZoneId: fallbackTimeZone, source: 'default' };
        }

        return { timeZoneId: fallbackTimeZone, source: 'default' };
    }

    const isPrimary = Boolean(isPrimaryCallerFn?.(callerE164));
    const hasSpotCredentials = Boolean(
        getSpotFeedIdFn?.() && getSpotFeedPasswordFn?.()
    );

    if (isPrimary && hasSpotCredentials && getLatestTrackTimezoneFn) {
        try {
            const trackTimezone = await getLatestTrackTimezoneFn();
            if (trackTimezone?.timezoneId) {
                return { timeZoneId: trackTimezone.timezoneId, source: 'spot' };
            }
        } catch {
            return { timeZoneId: fallbackTimeZone, source: 'default' };
        }
    }

    return { timeZoneId: fallbackTimeZone, source: 'default' };
}
