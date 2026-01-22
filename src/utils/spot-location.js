import {
    getGoogleMapsApiKey,
    getSpotFeedId,
    getSpotFeedPassword,
    IS_DEV,
} from '../env.js';
import { getLatestTrackLatLng } from './spot.js';
import { locationFromLatLng } from './location.js';

/**
 * @typedef {object} SpotLatestTrack
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} unixTime
 * @property {string} messageId
 * @property {string} [messengerId]
 * @property {string} [messengerName]
 * @property {'TRACK'} messageType
 */

/**
 * Fetch the latest SPOT track and enrich it with reverse geocoding details.
 *
 * @param {object} [root0] - Lookup options.
 * @param {string} [root0.language] - Optional locale string.
 * @param {boolean} [root0.includeTimezone=true] - Whether to include timezone lookup.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs=15000] - Optional timeout override in ms.
 * @param {boolean} [root0.force=false] - Bypass SPOT throttle (still updates cache).
 * @returns {Promise<{ track: SpotLatestTrack, location: Awaited<ReturnType<typeof locationFromLatLng>> } | null>} Combined track + location data or null.
 */
export async function getLatestTrackLocation({
    language,
    includeTimezone = true,
    timestampSeconds,
    timeoutMs = 15000,
    force = false,
} = {}) {
    if (IS_DEV) {
        console.log('getLatestTrackLocation:start', {
            includeTimezone,
            language,
            timestampSeconds,
            timeoutMs,
            force,
            hasFeedId: Boolean(getSpotFeedId()),
            hasFeedPassword: Boolean(getSpotFeedPassword()),
            hasApiKey: Boolean(getGoogleMapsApiKey()),
        });
    }
    if (!getSpotFeedId() || !getSpotFeedPassword()) return null;
    if (!getGoogleMapsApiKey()) {
        console.error('GOOGLE_MAPS_API_KEY is required for spot location.');
        return null;
    }

    const track = await getLatestTrackLatLng({
        force,
        timeoutMs,
    });

    if (!track) {
        if (IS_DEV) {
            console.log('getLatestTrackLocation:no-track');
        }
        return null;
    }

    const location = await locationFromLatLng({
        lat: track.latitude,
        lng: track.longitude,
        language,
        includeTimezone,
        timestampSeconds,
        timeoutMs,
    });

    const result = { track, location };
    if (IS_DEV) {
        console.log('getLatestTrackLocation:return', {
            latitude: result.track.latitude,
            longitude: result.track.longitude,
            timezoneId: result.location.timezoneId,
        });
    }
    return result;
}
