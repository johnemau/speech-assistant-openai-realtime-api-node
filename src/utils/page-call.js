import twilio from 'twilio';
import { getPrimaryCallerNumbers } from './email-page.js';
import { placeCall } from './place-call.js';
import { getServerBaseUrl, IS_DEV } from '../env.js';
import { resolveTimeZoneId } from './time.js';

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

/** @type {import('twilio/lib/twiml/VoiceResponse.js').SayAttributes} */
const SAY_ATTRS = { voice: 'Google.en-US-Chirp3-HD-Charon' };

/**
 * Build TwiML markup for a page call that reads the message three times
 * and then offers the listener the option to press any key to hear it again.
 *
 * @param {string} pageMessage - The page message to read aloud.
 * @param {object} [options] - Optional settings.
 * @param {string} [options.repeatUrl] - URL for the Gather action to replay the message.
 * @returns {string} TwiML XML string.
 */
export function buildPageCallTwiml(pageMessage, options) {
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();

    response.say(SAY_ATTRS, `Urgent page. ${pageMessage}`);
    response.pause({ length: 1 });
    response.say(SAY_ATTRS, `Repeating. ${pageMessage}`);
    response.pause({ length: 1 });
    response.say(SAY_ATTRS, `Repeating. ${pageMessage}`);

    const repeatUrl = options?.repeatUrl;
    if (repeatUrl) {
        const gather = response.gather({
            numDigits: 1,
            timeout: 10,
            action: repeatUrl,
            method: 'POST',
        });
        gather.say(SAY_ATTRS, 'Press any key to hear the message again.');
    } else {
        response.say(SAY_ATTRS, 'Press any key to hear the message again.');
        response.pause({ length: 30 });
    }

    return response.toString();
}

/**
 * Place a voice call to the first primary caller number and read the page message.
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
        return { to: '', error: 'No primary caller numbers configured.' };
    }
    const baseUrl = getServerBaseUrl();
    const repeatUrl = baseUrl
        ? `${baseUrl}/page-repeat?message=${encodeURIComponent(pageMessage)}`
        : undefined;
    const twiml = buildPageCallTwiml(pageMessage, { repeatUrl });
    return placeCall({ twiml, toNumber, fromNumber, client });
}
