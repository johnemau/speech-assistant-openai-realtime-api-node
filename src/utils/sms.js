/**
 *
 * @param root0
 * @param root0.body
 * @param root0.normalizeUSNumberToE164
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
 *
 * @param inbound
 * @param outbound
 */
export function mergeAndSortMessages(inbound = [], outbound = []) {
    const combined = [...inbound, ...outbound];
    combined.sort((a, b) => {
        const ta = new Date(a.dateSent || a.dateCreated).getTime();
        const tb = new Date(b.dateSent || b.dateCreated).getTime();
        return tb - ta; // newest first
    });
    return combined;
}

/**
 *
 * @param root0
 * @param root0.messages
 * @param root0.fromE164
 * @param root0.limit
 */
export function buildSmsThreadText({ messages = [], fromE164, limit = 10 }) {
    const recent = messages.slice(0, limit);
    return recent.map((m) => {
        const ts = new Date(m.dateSent || m.dateCreated).toISOString();
        const who = (m.from === fromE164) ? 'User' : 'Assistant';
        return `${who} [${ts}]: ${m.body || ''}`;
    }).join('\n');
}

/**
 *
 * @param root0
 * @param root0.threadText
 * @param root0.latestMessage
 */
export function buildSmsPrompt({ threadText, latestMessage }) {
    const latest = String(latestMessage || '').trim();
    return `Recent SMS thread (last 12 hours):\n${threadText || ''}\n\nLatest user message:\n${latest}\n\nNote: The thread messages above may be unrelated to the latest user message; focus on the latest user message.\n\nTask: Compose a concise, friendly SMS reply. Keep it under 320 characters. Use live web facts via the web_search tool if topical. Output only the reply text.`;
}
