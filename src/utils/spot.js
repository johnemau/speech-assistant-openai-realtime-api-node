const SPOT_THROTTLE_MS = 2.5 * 60 * 1000;

const spotLatestTrackCache = new Map();
/*
  cache entry shape:
  {
    fetchedAt: number, // ms epoch
    value: { latitude, longitude, unixTime, messageId, messengerId?, messengerName?, messageType } | null
  }
*/

/**
 * @param {number} lat - Latitude in degrees.
 * @param {number} lon - Longitude in degrees.
 * @returns {boolean} True when the coordinates are valid.
 */
function isValidLatLng(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (lat === -99999 || lon === -99999) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    return true;
}

/**
 * @param {string} url - Request URL.
 * @param {object} [init] - Fetch init options.
 * @param {number} [init.timeoutMs=15000] - Request timeout in ms.
 * @returns {Promise<Response | null>} Response or null on failure.
 */
async function fetchWithTimeout(url, { timeoutMs = 15000, ...init } = {}) {
    if (typeof fetch !== 'function') return null;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

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
 * Fetch the most recent TRACK message for a SPOT Public Feed.
 *
 * @param {string} feedId - SPOT public feed ID.
 * @param {string} feedPassword - SPOT public feed password.
 * @param {object} [opts] - Optional request settings.
 * @param {boolean} [opts.force=false] - Bypass throttle (still updates cache).
 * @param {number} [opts.timeoutMs=15000] - Request timeout in ms.
 * @returns {Promise<SpotLatestTrack | null>} Latest track data or null.
 */
export async function getLatestTrackLatLng(feedId, feedPassword, opts = {}) {
    const { force = false, timeoutMs = 15000 } = opts;

    if (!feedId || !feedPassword) return null;

    const cacheKey = `${feedId}:${feedPassword}`;
    const now = Date.now();
    const cached = spotLatestTrackCache.get(cacheKey);

    if (!force && cached && now - cached.fetchedAt < SPOT_THROTTLE_MS) {
        return cached.value;
    }

    const url =
        'https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/' +
        `${encodeURIComponent(feedId)}/latest.json?feedPassword=${encodeURIComponent(feedPassword)}`;

    const res = await fetchWithTimeout(url, {
        timeoutMs,
        headers: { Accept: 'application/json' },
    });

    if (!res || !res.ok) {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        return cached?.value ?? null;
    }

    let data;
    try {
        data = await res.json();
    } catch {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        return cached?.value ?? null;
    }

    // latest.json returns ONE message per device
    const msg =
        data?.response?.feedMessageResponse?.messages?.message ??
        data?.feedMessageResponse?.messages?.message ??
        null;

    if (!msg) {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        return cached?.value ?? null;
    }

    if ((msg.messageType || msg.message_type) !== 'TRACK') {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        return cached?.value ?? null;
    }

    const latitude = Number(msg.latitude);
    const longitude = Number(msg.longitude);

    if (!isValidLatLng(latitude, longitude)) {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        return cached?.value ?? null;
    }

    /** @type {SpotLatestTrack} */
    const result = {
        messageId: String(msg.id ?? ''),
        messengerId: msg.messengerId ? String(msg.messengerId) : undefined,
        messengerName: msg.messengerName
            ? String(msg.messengerName)
            : undefined,
        unixTime: Number(msg.unixTime),
        messageType: 'TRACK',
        latitude,
        longitude,
    };

    spotLatestTrackCache.set(cacheKey, { fetchedAt: now, value: result });
    return result;
}

/**
 * Test-only helper: reset module cache.
 */
export function resetSpotCacheForTests() {
    spotLatestTrackCache.clear();
}
