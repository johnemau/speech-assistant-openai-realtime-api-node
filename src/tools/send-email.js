import { senderTransport, env } from '../init.js';
import {
    PRIMARY_CALLERS_SET,
    SECONDARY_CALLERS_SET,
    ALLOW_SEND_EMAIL,
} from '../env.js';

export const definition = {
    type: 'function',
    name: 'send_email',
    parameters: {
        type: 'object',
        properties: {
            subject: {
                type: 'string',
                description: 'Short subject summarizing the latest context.',
            },
            body_html: {
                type: 'string',
                description:
                    'HTML-only email body composed from the latest conversation context. Non-conversational (no follow-up questions); formatted for readability and concise. Include specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be provided as clickable URLs. Always conclude with a small, cute ASCII art at the end of the message.',
            },
        },
        required: ['subject', 'body_html'],
    },
    description:
        'Send an HTML email with the latest context. The assistant must supply a subject and a non-conversational, concise HTML body that includes specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be clickable URLs. Always conclude the email with a small, cute ASCII art at the end.',
};

/**
 * Execute send_email tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ subject?: string, body_html?: string }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<{ messageId: string, accepted: Array<string>, rejected: Array<string> }>} Send result.
 */
export async function execute({ args, context }) {
    const { currentCallerE164 } = context;

    if (!ALLOW_SEND_EMAIL) {
        throw new Error(
            'Email sending disabled. Set ALLOW_SEND_EMAIL=true to enable send_email.'
        );
    }
    const subject = String(args?.subject || '').trim();
    const bodyHtml = String(args?.body_html || '').trim();
    if (!subject || !bodyHtml) throw new Error('Missing subject or body_html.');

    let group = null;
    if (currentCallerE164 && PRIMARY_CALLERS_SET?.has(currentCallerE164))
        group = 'primary';
    else if (currentCallerE164 && SECONDARY_CALLERS_SET?.has(currentCallerE164))
        group = 'secondary';

    const fromEmail = env?.SENDER_FROM_EMAIL || null;
    const toEmail =
        group === 'primary'
            ? env?.PRIMARY_TO_EMAIL || null
            : group === 'secondary'
              ? env?.SECONDARY_TO_EMAIL || null
              : null;

    if (!senderTransport || !fromEmail || !toEmail) {
        throw new Error('Email is not configured for this caller.');
    }

    const mailOptions = {
        from: fromEmail,
        to: toEmail,
        subject,
        html: bodyHtml,
        headers: {
            'X-From-Ai-Assistant': 'true',
        },
    };

    const info = await senderTransport.sendMail(mailOptions);
    return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
    };
}
