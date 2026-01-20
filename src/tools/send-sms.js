import { twilioClient, env } from '../init.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { ALLOW_SEND_SMS } from '../env.js';
import { sendSmsDefinition } from './definitions.js';

export const definition = sendSmsDefinition;

/**
 * Execute send_sms tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ body_text?: string }} root0.args - Tool arguments.
 * @param {object} root0.context - Tool context.
 * @returns {Promise<{ sid?: string, status?: string, length: number }>} Send result.
 */
export async function execute({ args, context }) {
    const {
        currentCallerE164,
        currentTwilioNumberE164,
    } = context;

    if (!ALLOW_SEND_SMS) {
        throw new Error('SMS sending disabled. Set ALLOW_SEND_SMS=true to enable send_sms.');
    }
    let bodyText = String(args?.body_text || '').trim();
    if (!bodyText) throw new Error('Missing body_text.');
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

    if (!twilioClient) throw new Error('Twilio client unavailable.');
    const toNumber = currentCallerE164;
    const envFrom = normalizeUSNumberToE164?.(env?.TWILIO_SMS_FROM_NUMBER || '') || null;
    const fromNumber = currentTwilioNumberE164 || envFrom;
    if (!toNumber || !fromNumber) throw new Error('SMS is not configured: missing caller or from number.');

    const sendRes = await twilioClient.messages.create({
        from: fromNumber,
        to: toNumber,
        body: bodyText,
    });
    return {
        sid: sendRes?.sid,
        status: sendRes?.status,
        length: bodyText.length,
    };
}
