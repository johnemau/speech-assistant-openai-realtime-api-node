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
                    'HTML-only email body composed from the latest conversation context. Non-conversational (no follow-up questions); formatted for readability and concise. Include specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. For weather, directions, or any location-based content, include a Google Maps link to the place or route; for weather also include a NOAA forecast link using https://forecast.weather.gov/MapClick.php?lat=<lat>&lon=<lon> when coordinates are available. All links must be provided as clickable URLs. Do not include any follow-up questions. Include ASCII art by providing ascii_art when possible, otherwise omit it to use a built-in fallback.',
            },
            ascii_art: {
                type: 'string',
                description:
                    'Optional ASCII art (≤6 lines, ≤40 chars per line) tailored to the email context. Omit to use a random fallback.',
            },
        },
        required: ['subject', 'body_html'],
    },
    description:
        'Send an HTML email with the latest context. Requires a subject and HTML body; recipient is chosen by caller group.',
};

/**
 * Execute send_email tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ subject?: string, body_html?: string, ascii_art?: string }} root0.args - Tool arguments.
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

    const asciiArtOptions = [
        String.raw` /\_/\\
( o.o )
 > ^ <`,
        String.raw`  ^__^
 (oo)\\_______
 (__)\\       )\\/\\
     ||----w |
     ||     ||`,
        String.raw`  ^  ^
 (o)(o)
(  __  )
 \\  /\\
  ||||
  ||||`,
        String.raw`   ______
 _/[] []\\_
|_      _|
  O----O`,
        String.raw`  .-.
 /   \
|     |
 \   /
  '-'
 /|\\`,
        String.raw` /\_/\\
(=^.^=)
(")_(")`,
        String.raw` / \__
(    @\\___
 /         O
/   (_____/
/_____/   U`,
        String.raw` (\\_/)
 ('.')
(")_(")`,
        String.raw`  ,_,
 (o,o)
 /)__)
  " "`,
        String.raw`  ___
 /o o\\
 \\_^_/`,
        String.raw` ><(((('>`,
    ];

    const rawAsciiArt =
        typeof args?.ascii_art === 'string' ? args.ascii_art : '';
    const normalizedAsciiArt = normalizeAsciiArt(rawAsciiArt);
    const selectedAsciiArt = isAsciiArtValid(normalizedAsciiArt)
        ? normalizedAsciiArt
        : asciiArtOptions[Math.floor(Math.random() * asciiArtOptions.length)];
    const safeAsciiArt = escapeAsciiArt(selectedAsciiArt);
    const bodyHtmlWithArt = `${bodyHtml}\n\n<pre>${safeAsciiArt}</pre>`;

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
        html: bodyHtmlWithArt,
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

/**
 * Normalize ASCII art line breaks.
 *
 * @param {string} value - Raw ASCII art.
 * @returns {string} Normalized ASCII art.
 */
function normalizeAsciiArt(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

/**
 * Validate ASCII art size constraints.
 *
 * @param {string} value - Normalized ASCII art.
 * @returns {boolean} Whether the art is within limits.
 */
function isAsciiArtValid(value) {
    if (!value) return false;
    const lines = value.split('\n');
    if (lines.length > 6) return false;
    return lines.every((line) => line.length <= 40);
}

/**
 * Escape unsafe HTML characters in ASCII art.
 *
 * @param {string} value - ASCII art to escape.
 * @returns {string} Escaped ASCII art.
 */
function escapeAsciiArt(value) {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
