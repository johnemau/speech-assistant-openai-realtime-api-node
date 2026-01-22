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
 * @param {string} [root0.feedId] - SPOT public feed ID.
 * @param {string} [root0.feedPassword] - SPOT public feed password.
 * @param {string} [root0.apiKey] - Google Maps API key.
 * @param {string} [root0.language] - Optional locale string.
 * @param {boolean} [root0.includeTimezone=true] - Whether to include timezone lookup.
 * @param {number} [root0.timestampSeconds] - Optional UNIX timestamp in seconds.
 * @param {number} [root0.timeoutMs=15000] - Optional timeout override in ms.
 * @param {boolean} [root0.force=false] - Bypass SPOT throttle (still updates cache).
 * @returns {Promise<{ track: SpotLatestTrack, location: Awaited<ReturnType<typeof locationFromLatLng>> } | null>} Combined track + location data or null.
 */
export async function getLatestTrackLocation({
    feedId,
    feedPassword,
    apiKey,
    language,
    includeTimezone = true,
    timestampSeconds,
    timeoutMs = 15000,
    force = false,
} = {}) {
    if (!feedId || !feedPassword) return null;

    const track = await getLatestTrackLatLng(feedId, feedPassword, {
        force,
        timeoutMs,
    });

    if (!track) return null;

    const location = await locationFromLatLng({
        lat: track.latitude,
        lng: track.longitude,
        apiKey,
        language,
        includeTimezone,
        timestampSeconds,
        timeoutMs,
    });

    return { track, location };
}
