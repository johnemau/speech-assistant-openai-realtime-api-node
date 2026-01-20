import { senderTransport, env } from '../init.js';
import { PRIMARY_CALLERS_SET, SECONDARY_CALLERS_SET, ALLOW_SEND_EMAIL } from '../env.js';
import { sendEmailDefinition } from './definitions.js';

export const definition = sendEmailDefinition;

/**
 * Execute send_email tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ subject?: string, body_html?: string }} root0.args - Tool arguments.
 * @param {object} root0.context - Tool context.
 * @returns {Promise<{ messageId: string, accepted: Array<string>, rejected: Array<string> }>} Send result.
 */
export async function execute({ args, context }) {
    const { currentCallerE164 } = context;

    if (!ALLOW_SEND_EMAIL) {
        throw new Error('Email sending disabled. Set ALLOW_SEND_EMAIL=true to enable send_email.');
    }
    const subject = String(args?.subject || '').trim();
    const bodyHtml = String(args?.body_html || '').trim();
    if (!subject || !bodyHtml) throw new Error('Missing subject or body_html.');

    let group = null;
    if (currentCallerE164 && PRIMARY_CALLERS_SET?.has(currentCallerE164)) group = 'primary';
    else if (currentCallerE164 && SECONDARY_CALLERS_SET?.has(currentCallerE164)) group = 'secondary';

    const fromEmail = env?.SENDER_FROM_EMAIL || null;
    const toEmail = group === 'primary'
        ? (env?.PRIMARY_TO_EMAIL || null)
        : (group === 'secondary' ? (env?.SECONDARY_TO_EMAIL || null) : null);

    if (!senderTransport || !fromEmail || !toEmail) {
        throw new Error('Email is not configured for this caller.');
    }

    const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject,
        html: bodyHtml,
        headers: {
            'X-From-Ai-Assistant': 'true'
        }
    };

    const info = await senderTransport.sendMail(mailOptions);
    return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
    };
}
