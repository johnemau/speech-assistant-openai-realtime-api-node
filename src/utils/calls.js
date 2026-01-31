import { getSpotFeedId, getSpotFeedPassword, isPrimaryCaller } from '../env.js';
import { getLatestTrackTimezone } from './spot.js';

/**
 * Resolve a friendly name for a caller.
 *
 * @param {object} root0 - Caller info.
 * @param {string|null} root0.callerE164 - Caller number in E.164.
 * @param {Set<string>} root0.primaryCallersSet - Primary allowlist.
 * @param {Set<string>} root0.secondaryCallersSet - Secondary allowlist.
 * @param {string} root0.primaryName - Primary greeting name.
 * @param {string} root0.secondaryName - Secondary greeting name.
 * @param {string} [root0.fallbackName] - Fallback greeting name.
 * @returns {string} Resolved caller name.
 */
export function resolveCallerName({
    callerE164,
    primaryCallersSet,
    secondaryCallersSet,
    primaryName,
    secondaryName,
    fallbackName = 'legend',
}) {
    if (callerE164 && primaryCallersSet?.has(callerE164) && primaryName)
        return primaryName;
    if (callerE164 && secondaryCallersSet?.has(callerE164) && secondaryName)
        return secondaryName;
    return fallbackName;
}

/**
 * Compute a time-of-day greeting in a target time zone.
 *
 * @param {object} root0 - Time inputs.
 * @param {string} [root0.timeZone] - IANA time zone.
 * @param {Date} [root0.now] - Current time override.
 * @returns {string} Greeting string.
 */
export function getTimeGreeting({
    timeZone = 'America/Los_Angeles',
    now = new Date(),
} = {}) {
    const pacificHour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            hour12: false,
        }).format(now)
    );

    if (pacificHour >= 4 && pacificHour < 12) return 'Good morning';
    if (pacificHour >= 12 && pacificHour < 17) return 'Good afternoon';
    return 'Good evening';
}

/**
 * Format a date/time string with a short timezone name and IANA ID.
 *
 * @param {object} root0 - Format inputs.
 * @param {string} [root0.timeZone] - IANA time zone.
 * @param {Date} [root0.now] - Current time override.
 * @param {string} [root0.locale] - Locale override.
 * @returns {string} Formatted date/time string.
 */
export function formatDateTimeWithTimeZone({
    timeZone = 'America/Los_Angeles',
    now = new Date(),
    locale = 'en-US',
} = {}) {
    const formatted = new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
    }).format(now);

    return `${formatted} (${timeZone})`;
}

/**
 * Resolve a formatted date/time string for the caller, using SPOT timezone
 * for primary callers when available.
 *
 * @param {object} root0 - Caller/time inputs.
 * @param {string | null} [root0.callerE164] - Caller number in E.164.
 * @param {Date} [root0.now] - Current time override.
 * @param {string} [root0.fallbackTimeZone] - Fallback IANA time zone.
 * @param {(callerE164?: string | null) => boolean} [root0.isPrimaryCallerFn] - Primary checker.
 * @param {() => Promise<{ timezoneId?: string | null } | null>} [root0.getLatestTrackTimezoneFn] - SPOT lookup.
 * @param {() => string | undefined} [root0.getSpotFeedIdFn] - SPOT feed ID accessor.
 * @param {() => string | undefined} [root0.getSpotFeedPasswordFn] - SPOT password accessor.
 * @param {(args: { timeZone?: string, now?: Date, locale?: string }) => string} [root0.formatDateTimeFn] - Formatter.
 * @returns {Promise<string>} Formatted date/time string.
 */
export async function getCallerDateTimeString({
    callerE164,
    now = new Date(),
    fallbackTimeZone = 'America/Los_Angeles',
    isPrimaryCallerFn = isPrimaryCaller,
    getLatestTrackTimezoneFn = getLatestTrackTimezone,
    getSpotFeedIdFn = getSpotFeedId,
    getSpotFeedPasswordFn = getSpotFeedPassword,
    formatDateTimeFn = formatDateTimeWithTimeZone,
} = {}) {
    let timeZone = fallbackTimeZone;
    const isPrimary = Boolean(isPrimaryCallerFn?.(callerE164));
    const hasSpotCredentials = Boolean(
        getSpotFeedIdFn?.() && getSpotFeedPasswordFn?.()
    );

    if (isPrimary && hasSpotCredentials && getLatestTrackTimezoneFn) {
        try {
            const trackTimezone = await getLatestTrackTimezoneFn();
            if (trackTimezone?.timezoneId) {
                timeZone = trackTimezone.timezoneId;
            }
        } catch {
            // Fall back to the default time zone.
        }
    }

    return formatDateTimeFn({ timeZone, now });
}
