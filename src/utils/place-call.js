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
    try {
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
