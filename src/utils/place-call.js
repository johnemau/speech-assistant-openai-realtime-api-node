import { IS_DEV } from '../env.js';

/**
 * @typedef {{ calls: { create: Function } }} CallLikeClient
 */

/**
 * Place an outbound voice call via Twilio using pre-built TwiML.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.twiml - TwiML XML string for the call.
 * @param {string} root0.toNumber - E.164 destination number.
 * @param {string} root0.fromNumber - Twilio number to call from.
 * @param {CallLikeClient} root0.client - Twilio client instance.
 * @returns {Promise<{ to: string, sid?: string, status?: string, error?: string }>} Call result.
 */
export async function placeCall({ twiml, toNumber, fromNumber, client }) {
    if (IS_DEV) {
        console.log('place-call: request', {
            toNumber,
            fromNumber,
            twimlLength: twiml?.length,
            twimlPreview: twiml?.slice(0, 200),
        });
    }
    try {
        const call = await client.calls.create({
            from: fromNumber,
            to: toNumber,
            twiml,
        });
        const result = { to: toNumber, sid: call?.sid, status: call?.status };
        if (IS_DEV) {
            console.log('place-call: result', result);
        }
        return result;
    } catch (e) {
        const result = { to: toNumber, error: e?.message || String(e) };
        if (IS_DEV) {
            console.log('place-call: error', result);
        }
        return result;
    }
}
