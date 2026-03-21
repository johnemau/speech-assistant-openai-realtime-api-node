import twilio from 'twilio';
import { getPrimaryCallerNumbers } from './email-page.js';
import { placeCall } from './place-call.js';
import { getServerBaseUrl } from '../env.js';

/**
 * @typedef {import('./place-call.js').CallLikeClient} CallLikeClient
 */

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
