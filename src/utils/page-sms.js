import { getPrimaryCallerNumbers } from './email-page.js';
import { sendSms } from './send-sms.js';

/**
 * @typedef {import('./send-sms.js').SmsLikeClient} SmsLikeClient
 */

/**
 * Send a page SMS to all primary caller numbers.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.pageMessage - The page message body.
 * @param {string} root0.fromNumber - Twilio number to send from.
 * @param {SmsLikeClient} root0.client - Twilio client instance.
 * @returns {Promise<Array<{ to: string, sid?: string, status?: string, error?: string }>>} Results.
 */
export async function sendPageSms({ pageMessage, fromNumber, client }) {
    const numbers = getPrimaryCallerNumbers();
    const results = [];
    for (const toNumber of numbers) {
        try {
            const res = await sendSms({
                to: toNumber,
                from: fromNumber,
                body: pageMessage,
                client,
            });
            results.push({
                to: toNumber,
                sid: res?.sid,
                status: res?.status,
            });
        } catch (e) {
            results.push({
                to: toNumber,
                error: e?.message || String(e),
            });
        }
    }
    return results;
}
