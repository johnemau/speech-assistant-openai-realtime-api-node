import { getPrimaryCallerNumbers } from './email-page.js';
import { placeCall } from './place-call.js';
import { getServerBaseUrl, IS_DEV } from '../env.js';
import { resolveTimeZoneId } from './time.js';
import { savePendingMessage } from './pending-messages.js';

/**
 * @typedef {import('./place-call.js').CallLikeClient} CallLikeClient
 */

const PAGE_CALL_START_HOUR = 7;
const PAGE_CALL_END_HOUR = 18;

/**
 * Check whether the current local time for the primary caller is within
 * calling hours (7 AM – 6 PM). Uses the SPOT-tracked timezone when available,
 * falling back to America/Los_Angeles.
 *
 * @param {object} [options] - Optional overrides for testing.
 * @param {Date} [options.now] - Current time override.
 * @param {(opts?: object) => Promise<import('./time.js').ResolveTimeZoneResult>} [options.resolveTimeZoneIdFn] - Timezone resolver.
 * @returns {Promise<{ allowed: boolean, hour: number, timeZoneId: string }>} Whether the call is allowed, the resolved hour, and timezone.
 */
export async function isWithinCallingHours({
    now = new Date(),
    resolveTimeZoneIdFn = resolveTimeZoneId,
} = {}) {
    const { timeZoneId } = await resolveTimeZoneIdFn({
        fallbackTimeZone: 'America/Los_Angeles',
    });
    const hour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone: timeZoneId,
            hour: 'numeric',
            hour12: false,
        }).format(now)
    );
    const allowed = hour >= PAGE_CALL_START_HOUR && hour < PAGE_CALL_END_HOUR;
    if (IS_DEV) {
        console.log('page-call: calling hours check', {
            hour,
            timeZoneId,
            allowed,
        });
    }
    return { allowed, hour, timeZoneId };
}

/**
 * Place a voice call to the first primary caller number and connect to the AI assistant.
 * The page message is stored by the returned call SID so the assistant can read it aloud.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.pageMessage - The page message to read.
 * @param {string} root0.fromNumber - Twilio number to call from.
 * @param {CallLikeClient} root0.client - Twilio client instance.
 * @returns {Promise<{ to: string, sid?: string, status?: string, error?: string }>} Call result.
 */
export async function placePageCall({ pageMessage, fromNumber, client }) {
    const numbers = getPrimaryCallerNumbers();
    const toNumber = numbers[0];
    if (!toNumber) {
        console.log('page-call: no primary caller numbers configured');
        return { to: '', error: 'No primary caller numbers configured.' };
    }
    const baseUrl = getServerBaseUrl();
    if (!baseUrl) {
        console.log('page-call: no server base URL configured');
        return { to: '', error: 'No server base URL configured.' };
    }
    const url = `${baseUrl}/incoming-call?source=page`;
    if (IS_DEV) {
        console.log('page-call: placing page call', {
            toNumber,
            fromNumber,
            url,
        });
    }
    const result = await placeCall({ url, toNumber, fromNumber, client });
    if (result.sid) {
        savePendingMessage(result.sid, pageMessage);
    }
    return result;
}
