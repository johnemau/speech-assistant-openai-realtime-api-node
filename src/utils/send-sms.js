import { IS_DEV } from '../env.js';

/**
 * @typedef {{ messages: { create: Function } }} SmsLikeClient
 */

/**
 * Send a single SMS message.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.to - Destination E.164 number.
 * @param {string} root0.from - Twilio number to send from.
 * @param {string} root0.body - Message body.
 * @param {SmsLikeClient} root0.client - Twilio client instance.
 * @returns {Promise<{ sid?: string, status?: string }>} Send result.
 */
export async function sendSms({ to, from, body, client }) {
    if (IS_DEV) {
        console.log('[sendSms] Sending SMS', { to, from, body });
    }
    const res = await client.messages.create({ from, to, body });
    const result = { sid: res?.sid, status: res?.status };
    if (IS_DEV) {
        console.log('[sendSms] Response', result);
    }
    return result;
}
