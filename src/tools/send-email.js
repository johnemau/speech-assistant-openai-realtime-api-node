export const definition = {
    type: 'function',
    name: 'send_email',
    parameters: {
        type: 'object',
        properties: {
            subject: { type: 'string', description: 'Short subject summarizing the latest context.' },
            body_html: {
                type: 'string',
                description: 'HTML-only email body composed from the latest conversation context. Non-conversational (no follow-up questions); formatted for readability and concise. Include specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be provided as clickable URLs. Always conclude with a small, cute ASCII art at the end of the message.',
            }
        },
        required: ['subject', 'body_html']
    },
    description: 'Send an HTML email with the latest context. The assistant must supply a subject and a non-conversational, concise HTML body that includes specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be clickable URLs. Always conclude the email with a small, cute ASCII art at the end.'
};

/**
 *
 * @param root0
 * @param root0.args
 * @param root0.context
 */
export async function execute({ args, context }) {
    const {
        senderTransport,
        env,
        primaryCallersSet,
        secondaryCallersSet,
        currentCallerE164,
        allowLiveSideEffects,
    } = context;

    if (!allowLiveSideEffects) {
        throw new Error('Live side effects disabled. Set ALLOW_LIVE_SIDE_EFFECTS=true to enable send_email.');
    }
    const subject = String(args?.subject || '').trim();
    const bodyHtml = String(args?.body_html || '').trim();
    if (!subject || !bodyHtml) throw new Error('Missing subject or body_html.');

    let group = null;
    if (currentCallerE164 && primaryCallersSet?.has(currentCallerE164)) group = 'primary';
    else if (currentCallerE164 && secondaryCallersSet?.has(currentCallerE164)) group = 'secondary';

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
