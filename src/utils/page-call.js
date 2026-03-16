import { getPrimaryCallerNumbers } from './email-page.js';

/**
 * @typedef {{ calls: { create: Function } }} CallLikeClient
 */

/**
 * Build TwiML markup for a page call that reads the message twice.
 *
 * @param {string} pageMessage - The page message to read aloud.
 * @returns {string} TwiML XML string.
 */
export function buildPageCallTwiml(pageMessage) {
    return [
        '<Response>',
        `<Say voice="Google.en-US-Chirp3-HD-Charon">Urgent page. ${pageMessage}</Say>`,
        '<Pause length="1"/>',
        `<Say voice="Google.en-US-Chirp3-HD-Charon">Repeating. ${pageMessage}</Say>`,
        '</Response>',
    ].join('');
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
    try {
        const twiml = buildPageCallTwiml(pageMessage);
        const call = await client.calls.create({
            from: fromNumber,
            to: toNumber,
            twiml,
        });
        return { to: toNumber, sid: call?.sid, status: call?.status };
    } catch (e) {
        return { to: toNumber, error: e?.message || String(e) };
    }
}
