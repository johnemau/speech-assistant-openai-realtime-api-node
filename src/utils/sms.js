import { isPrimaryCaller } from '../env.js';
import { formatDateTimeWithTimeZone } from './calls.js';
import { getLatestTrackLocation } from './spot-location.js';
import { resolveTimeZoneId } from './time.js';

/**
 * Extract SMS request details from a webhook body.
 *
 * @param {object} root0 - Extraction inputs.
 * @param {Record<string, string>} root0.body - Webhook body.
 * @param {(input: string) => (string | null)} root0.normalizeUSNumberToE164 - Normalizer.
 * @returns {{
 *   bodyRaw: string,
 *   fromRaw: string,
 *   toRaw: string,
 *   fromE164: string | null,
 *   toE164: string | null,
 * }} Extracted SMS fields.
 */
export function extractSmsRequest({ body = {}, normalizeUSNumberToE164 }) {
    const bodyRaw = body?.Body || body?.body || '';
    const fromRaw = body?.From || body?.from || '';
    const toRaw = body?.To || body?.to || '';

    const fromE164 = normalizeUSNumberToE164?.(fromRaw);
    const toE164 = normalizeUSNumberToE164?.(toRaw);

    return {
        bodyRaw,
        fromRaw,
        toRaw,
        fromE164,
        toE164,
    };
}

/**
 * Merge inbound and outbound messages and sort newest-first.
 *
 * @typedef {{
 *  dateSent?: string | Date | null,
 *  dateCreated?: string | Date | null,
 *  from?: string,
 *  body?: string,
 * }} SmsMessage
 *
 * @param {Array<SmsMessage>} inbound - Inbound messages.
 * @param {Array<SmsMessage>} outbound - Outbound messages.
 * @returns {Array<SmsMessage>} Combined, sorted messages.
 */
export function mergeAndSortMessages(inbound = [], outbound = []) {
    const combined = [...inbound, ...outbound];
    combined.sort((a, b) => {
        const ta = new Date(a.dateSent || a.dateCreated || 0).getTime();
        const tb = new Date(b.dateSent || b.dateCreated || 0).getTime();
        return tb - ta; // newest first
    });
    return combined;
}

/**
 * Build a text thread from recent messages.
 *
 * @param {object} root0 - Thread inputs.
 * @param {Array<SmsMessage>} [root0.messages] - Messages.
 * @param {string} root0.fromE164 - Caller number in E.164.
 * @param {number} [root0.limit] - Max messages to include.
 * @returns {string} Thread text.
 */
export function buildSmsThreadText({ messages = [], fromE164, limit = 10 }) {
    const recent = messages.slice(0, limit);
    return recent
        .map((m) => {
            const ts = new Date(m.dateSent || m.dateCreated || 0).toISOString();
            const who = m.from === fromE164 ? 'User' : 'Assistant';
            return `${who} [${ts}]: ${m.body || ''}`;
        })
        .join('\n');
}

/**
 * Build a short SMS context section with current time and estimated location.
 *
 * @param {object} root0 - Context inputs.
 * @param {string | null} [root0.callerE164] - Caller number in E.164.
 * @returns {Promise<string>} Context text.
 */
export async function buildSmsContextSection({ callerE164 } = {}) {
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

    return `Current time: ${currentTime}\nEstimated location: ${estimatedLocation}`;
}

/**
 * @typedef {object} EstimatedLocation
 * @property {{ formattedAddress?: string, street?: string, city?: string, region?: string, country?: string }} [address]
 * @property {{ city?: string, region?: string, country?: string }} [userLocation]
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
 * Build an SMS prompt for the model.
 *
 * @param {object} root0 - Prompt inputs.
 * @param {string} root0.threadText - Thread text.
 * @param {string} root0.latestMessage - Latest inbound message.
 * @param {string} [root0.contextSection] - Context section.
 * @returns {string} Prompt text.
 */
export function buildSmsPrompt({ threadText, latestMessage, contextSection }) {
    const latest = String(latestMessage || '').trim();
    const context = String(contextSection || '').trim();
    const contextBlock = context ? `${context}\n\n` : '';
    return `${contextBlock}Recent SMS thread (last 12 hours):\n${threadText || ''}\n\nLatest user message:\n${latest}`;
}
