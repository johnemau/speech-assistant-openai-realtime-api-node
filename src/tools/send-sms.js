import { twilioClient, env } from '../init.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { ALLOW_SEND_SMS } from '../env.js';

export const definition = {
    type: 'function',
    name: 'send_sms',
    parameters: {
        type: 'object',
        properties: {
            body_text: {
                type: 'string',
                description:
                    'Concise, actionable SMS body with no filler or preamble. Include only the information requested and any sources as short labels with URLs (e.g., official page, business website, article). Keep wording tight and direct. You may add a single, short follow-up question (e.g., "Would you like me to get the hours of operation?") when helpful.',
            },
        },
        required: ['body_text'],
    },
    description:
        'Send an SMS that contains only the requested information and brief source labels with URLs. Keep it actionable and free of preamble or unnecessary words. A single short follow-up question is allowed when helpful (e.g., asking if you should get hours or more details).',
};

/**
 * Execute send_sms tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ body_text?: string }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null, currentTwilioNumberE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<{ sid?: string, status?: string, length: number }>} Send result.
 */
export async function execute({ args, context }) {
    const { currentCallerE164, currentTwilioNumberE164 } = context;

    if (!ALLOW_SEND_SMS) {
        throw new Error(
            'SMS sending disabled. Set ALLOW_SEND_SMS=true to enable send_sms.'
        );
    }
    let bodyText = String(args?.body_text || '').trim();
    if (!bodyText) throw new Error('Missing body_text.');
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

    if (!twilioClient) throw new Error('Twilio client unavailable.');
    const toNumber = currentCallerE164;
    const envFrom =
        normalizeUSNumberToE164?.(env?.TWILIO_SMS_FROM_NUMBER || '') || null;
    const fromNumber = currentTwilioNumberE164 || envFrom;
    if (!toNumber || !fromNumber)
        throw new Error(
            'SMS is not configured: missing caller or from number.'
        );

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
