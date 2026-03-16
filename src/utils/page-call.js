import twilio from 'twilio';
import { getPrimaryCallerNumbers } from './email-page.js';
import { placeCall } from './place-call.js';

/**
 * @typedef {import('./place-call.js').CallLikeClient} CallLikeClient
 */

/**
 * Build TwiML markup for a page call that reads the message twice.
 *
 * @param {string} pageMessage - The page message to read aloud.
 * @returns {string} TwiML XML string.
 */
export function buildPageCallTwiml(pageMessage) {
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();
    response.say(
        { voice: 'Google.en-US-Chirp3-HD-Charon' },
        `Urgent page. ${pageMessage}`
    );
    response.pause({ length: 1 });
    response.say(
        { voice: 'Google.en-US-Chirp3-HD-Charon' },
        `Repeating. ${pageMessage}`
    );
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
    const twiml = buildPageCallTwiml(pageMessage);
    return placeCall({ twiml, toNumber, fromNumber, client });
}
