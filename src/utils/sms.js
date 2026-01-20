/**
 * Extract SMS request details from a webhook body.
 *
 * @param {object} root0 - Extraction inputs.
 * @param {Record<string, string>} root0.body - Webhook body.
 * @param {(input: string) => (string | null)} root0.normalizeUSNumberToE164 - Normalizer.
 * @returns {{
 *   bodyRaw: string,
 *   fromRaw: string,
 *   toRaw: string,
 *   fromE164: string | null,
 *   toE164: string | null,
 * }} Extracted SMS fields.
 */
export function extractSmsRequest({ body = {}, normalizeUSNumberToE164 }) {
    const bodyRaw = body?.Body || body?.body || '';
    const fromRaw = body?.From || body?.from || '';
    const toRaw = body?.To || body?.to || '';

    const fromE164 = normalizeUSNumberToE164?.(fromRaw);
    const toE164 = normalizeUSNumberToE164?.(toRaw);

    return {
        bodyRaw,
        fromRaw,
        toRaw,
        fromE164,
        toE164,
    };
}

/**
 * Merge inbound and outbound messages and sort newest-first.
 *
 * @typedef {{
 *  dateSent?: string | Date | null,
 *  dateCreated?: string | Date | null,
 *  from?: string,
 *  body?: string,
 * }} SmsMessage
 *
 * @param {Array<SmsMessage>} inbound - Inbound messages.
 * @param {Array<SmsMessage>} outbound - Outbound messages.
 * @returns {Array<SmsMessage>} Combined, sorted messages.
 */
export function mergeAndSortMessages(inbound = [], outbound = []) {
    const combined = [...inbound, ...outbound];
    combined.sort((a, b) => {
        const ta = new Date(a.dateSent || a.dateCreated || 0).getTime();
        const tb = new Date(b.dateSent || b.dateCreated || 0).getTime();
        return tb - ta; // newest first
    });
    return combined;
}

/**
 * Build a text thread from recent messages.
 *
 * @param {object} root0 - Thread inputs.
 * @param {Array<SmsMessage>} [root0.messages] - Messages.
 * @param {string} root0.fromE164 - Caller number in E.164.
 * @param {number} [root0.limit] - Max messages to include.
 * @returns {string} Thread text.
 */
export function buildSmsThreadText({ messages = [], fromE164, limit = 10 }) {
    const recent = messages.slice(0, limit);
    return recent
        .map((m) => {
            const ts = new Date(m.dateSent || m.dateCreated || 0).toISOString();
            const who = m.from === fromE164 ? 'User' : 'Assistant';
            return `${who} [${ts}]: ${m.body || ''}`;
        })
        .join('\n');
}

/**
 * Build an SMS prompt for the model.
 *
 * @param {object} root0 - Prompt inputs.
 * @param {string} root0.threadText - Thread text.
 * @param {string} root0.latestMessage - Latest inbound message.
 * @returns {string} Prompt text.
 */
export function buildSmsPrompt({ threadText, latestMessage }) {
    const latest = String(latestMessage || '').trim();
    return `Recent SMS thread (last 12 hours):\n${threadText || ''}\n\nLatest user message:\n${latest}\n\nNote: The thread messages above may be unrelated to the latest user message; focus on the latest user message.\n\nTask: Compose a concise, friendly SMS reply. Keep it under 320 characters. Use live web facts via the web_search tool if topical. Output only the reply text.`;
}
