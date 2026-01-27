import tzLookup from 'tz-lookup';
import { getSpotFeedId, getSpotFeedPassword, IS_DEV } from '../env.js';

const SPOT_THROTTLE_MS = 2.5 * 60 * 1000;

/**
 * @param {string} url - SPOT feed request URL.
 * @returns {string} URL with sensitive query params redacted.
 */
function redactSpotUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has('feedPassword')) {
            parsed.searchParams.set('feedPassword', 'REDACTED');
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

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
 * @typedef {RequestInit & { timeoutMs?: number }} SpotFetchInit
 */

/**
 * @param {string} url - Request URL.
 * @param {SpotFetchInit} [init] - Fetch init options.
 * @returns {Promise<Response | null>} Response or null on failure.
 */
async function fetchWithTimeout(url, { timeoutMs = 15000, ...init } = {}) {
    if (typeof fetch !== 'function') return null;

    const controller = new AbortController();
    const safeUrl = redactSpotUrl(url);
    const method = init?.method ?? 'GET';
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (IS_DEV) {
            const err = /** @type {any} */ (error);
            console.log('spot: fetch exception', {
                name: err?.name ?? null,
                message: err?.message ?? null,
                stack: err?.stack ?? null,
                url: safeUrl,
                request: {
                    method,
                    timeoutMs,
                },
            });
        }
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
 * @param {object} [opts] - Optional request settings.
 * @param {boolean} [opts.force=false] - Bypass throttle (still updates cache).
 * @param {number} [opts.timeoutMs=15000] - Request timeout in ms.
 * @returns {Promise<SpotLatestTrack | null>} Latest track data or null.
 */
export async function getLatestTrackLatLng(opts = {}) {
    const { force = false, timeoutMs = 15000 } = opts;
    const feedId = getSpotFeedId();
    const feedPassword = getSpotFeedPassword();

    if (IS_DEV) {
        console.log('getLatestTrackLatLng:start', {
            force,
            timeoutMs,
            hasFeedId: Boolean(feedId),
            hasFeedPassword: Boolean(feedPassword),
        });
    }

    if (!feedId || !feedPassword) {
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:missing-credentials');
        }
        return null;
    }

    const cacheKey = `${feedId}:${feedPassword}`;
    const now = Date.now();
    const cached = spotLatestTrackCache.get(cacheKey);

    if (!force && cached && now - cached.fetchedAt < SPOT_THROTTLE_MS) {
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:cache-hit', {
                ageMs: now - cached.fetchedAt,
            });
        }
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
        if (IS_DEV && res && !res.ok) {
            let errorBody = null;
            let contentType = null;
            try {
                contentType = res.headers?.get('content-type') ?? null;
                errorBody = await res.text();
            } catch {
                errorBody = null;
            }
            console.log('getLatestTrackLatLng:fetch-failed', {
                ok: res?.ok ?? false,
                status: res?.status ?? null,
                statusText: res?.statusText ?? null,
                url: redactSpotUrl(url),
                contentType,
                errorBody,
                request: {
                    timeoutMs,
                },
            });
        }
        return cached?.value ?? null;
    }

    let data;
    try {
        data = /** @type {any} */ (await res.json());
    } catch {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:json-parse-failed');
        }
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
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:missing-message');
        }
        return cached?.value ?? null;
    }

    if ((msg.messageType || msg.message_type) !== 'TRACK') {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:non-track', {
                messageType: msg.messageType || msg.message_type,
            });
        }
        return cached?.value ?? null;
    }

    const latitude = Number(msg.latitude);
    const longitude = Number(msg.longitude);

    if (!isValidLatLng(latitude, longitude)) {
        spotLatestTrackCache.set(cacheKey, {
            fetchedAt: now,
            value: cached?.value ?? null,
        });
        if (IS_DEV) {
            console.log('getLatestTrackLatLng:invalid-latlng', {
                latitude,
                longitude,
            });
        }
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
    if (IS_DEV) {
        console.log('getLatestTrackLatLng:return', {
            latitude: result.latitude,
            longitude: result.longitude,
            unixTime: result.unixTime,
            messageId: result.messageId,
        });
    }
    return result;
}

/**
 * Fetch the latest SPOT track and resolve its IANA timezone.
 *
 * @param {object} [opts] - Optional request settings.
 * @param {boolean} [opts.force=false] - Bypass throttle (still updates cache).
 * @param {number} [opts.timeoutMs=15000] - Request timeout in ms.
 * @returns {Promise<{ timezoneId: string, track: SpotLatestTrack } | null>} Timezone result or null.
 */
export async function getLatestTrackTimezone(opts = {}) {
    const track = await getLatestTrackLatLng(opts);
    if (!track) return null;

    try {
        const timezoneId = tzLookup(track.latitude, track.longitude);
        if (IS_DEV) {
            console.log('getLatestTrackTimezone:return', {
                latitude: track.latitude,
                longitude: track.longitude,
                timezoneId,
            });
        }
        return { timezoneId, track };
    } catch (error) {
        if (IS_DEV) {
            console.log('getLatestTrackTimezone:error', {
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            });
        }
        return null;
    }
}

/**
 * Test-only helper: reset module cache.
 */
export function resetSpotCacheForTests() {
    spotLatestTrackCache.clear();
}
