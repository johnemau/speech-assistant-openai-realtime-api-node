import WebSocket from 'ws';
import JSON5 from 'json5';

/**
 * @typedef {Pick<WebSocket, 'readyState' | 'close'>} AssistantSessionWebSocket
 */

/**
 * @param {import('ws').RawData} data - Raw WebSocket payload.
 * @returns {string} UTF-8 decoded message string.
 */
function toUtf8String(data) {
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
    return String(data);
}

/**
 * Safely parse tool-call arguments into an object.
 *
 * @param {unknown} args - Raw tool arguments from the model.
 * @returns {Record<string, unknown>} Parsed arguments object.
 */
export function safeParseToolArguments(args) {
    if (args == null) return {};
    if (typeof args === 'object') return /** @type {Record<string, unknown>} */ (args);
    let str = String(args);
    // Normalize and trim possible BOMs/whitespace
    str = str.replace(/^\uFEFF/, '').trim();
    try {
        // First attempt: strict JSON
        return JSON.parse(str);
    } catch {
        // Second attempt: relaxed JSON (JSON5) for single quotes, unquoted keys, etc.
        try {
            return JSON5.parse(str);
        } catch {
            // Final attempt: minimal repairs + quoting bare keys, then JSON5 parse
            let repaired = str
                .replace(/^\uFEFF/, '')
                .replace(/[\u201C\u201D]/g, '"') // smart double quotes → standard
                .replace(/[\u2018\u2019]/g, "'") // smart single quotes → standard
                .replace(/\r\n/g, '\n')
                .replace(/\n/g, '\\n') // escape literal newlines within strings
                .replace(/,\s*([}\]])/g, '$1'); // remove trailing commas

            // Add quotes around unquoted property names at object boundaries
            repaired = repaired.replace(/([{|,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*):/g, '$1"$2"$3:');

            return JSON5.parse(repaired);
        }
    }
}

/**
 * Create a realtime assistant session and wire event handlers.
 *
 * @param {object} root0 - Session options.
 * @param {string} root0.apiKey - OpenAI API key.
 * @param {string} [root0.model] - Realtime model name.
 * @param {number} [root0.temperature] - Sampling temperature.
 * @param {string} [root0.voice] - Voice id.
 * @param {string} [root0.instructions] - System instructions.
 * @param {Array<object>} [root0.tools] - Tool definitions.
 * @param {string[]} [root0.outputModalities] - Output modalities.
 * @param {object} [root0.audioConfig] - Audio session config.
 * @param {string} [root0.toolChoice] - Tool choice policy.
 * @param {(event: object) => void} [root0.onEvent] - Raw event handler.
 * @param {(event: object) => void} [root0.onAssistantOutput] - Assistant output handler.
 * @param {(call: object, response: object) => void} [root0.onToolCall] - Tool call handler.
 * @param {() => void} [root0.onOpen] - WebSocket open handler.
 * @param {() => void} [root0.onClose] - WebSocket close handler.
 * @param {(error: Error) => void} [root0.onError] - WebSocket error handler.
 * @returns {{
 *   openAiWs: AssistantSessionWebSocket,
 *   send: (obj: unknown) => void,
 *   requestResponse: () => void,
 *   updateSession: (partialSession: object) => void,
 *   close: () => void,
 *   clearPendingMessages: () => void,
 * }} Session helpers.
 */
function realCreateAssistantSession({
    apiKey,
    model = 'gpt-realtime',
    temperature = 0.8,
    voice,
    instructions,
    tools = [],
    outputModalities = ['audio'],
    audioConfig,
    toolChoice = 'auto',
    onEvent,
    onAssistantOutput,
    onToolCall,
    onOpen,
    onClose,
    onError,
}) {
    if (!apiKey) throw new Error('Missing OpenAI API key.');

    const openAiWs = new WebSocket(`wss://api.openai.com/v1/realtime?model=${model}&temperature=${temperature}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        }
    });

    const pendingOpenAiMessages = [];
    const openAiSend = (obj) => {
        try {
            const payload = JSON.stringify(obj);
            if (openAiWs.readyState === WebSocket.OPEN) {
                openAiWs.send(payload);
            } else {
                pendingOpenAiMessages.push(payload);
            }
        } catch (e) {
            console.error('Failed to send/queue OpenAI message:', e);
        }
    };

    const flushPendingOpenAiMessages = () => {
        if (openAiWs.readyState !== WebSocket.OPEN) return;
        try {
            while (pendingOpenAiMessages.length > 0) {
                const msg = pendingOpenAiMessages.shift();
                openAiWs.send(msg);
            }
        } catch (e) {
            console.error('Failed to flush OpenAI queued messages:', e);
        }
    };

    const initializeSession = () => {
        const sessionPayload = {
            type: 'session.update',
            session: {
                type: 'realtime',
                model,
                output_modalities: outputModalities,
                instructions,
                tools,
                tool_choice: toolChoice,
            }
        };
        if (audioConfig) {
            sessionPayload.session.audio = audioConfig;
        }
        if (voice) {
            sessionPayload.session.voice = voice;
        }
        openAiSend(sessionPayload);
        flushPendingOpenAiMessages();
    };

    openAiWs.on('open', () => {
        initializeSession();
        onOpen?.();
    });

    openAiWs.on('message', (data) => {
        try {
            const response = JSON.parse(toUtf8String(data));
            onEvent?.(response);

            if (response.type === 'response.output_audio.delta' && response.delta) {
                onAssistantOutput?.({
                    type: 'audio',
                    delta: response.delta,
                    itemId: response.item_id,
                    response,
                });
            }

            if (response.type === 'response.output_text.delta' && response.delta != null) {
                onAssistantOutput?.({
                    type: 'text',
                    delta: response.delta,
                    itemId: response.item_id,
                    response,
                });
            }

            if (response.type === 'response.output_text.done' && response.text != null) {
                onAssistantOutput?.({
                    type: 'text_done',
                    text: response.text,
                    itemId: response.item_id,
                    response,
                });
            }

            if (response.type === 'response.done') {
                const functionCall = response.response?.output?.[0];
                if (functionCall?.type === 'function_call') {
                    onToolCall?.(functionCall, response);
                }
            }
        } catch (error) {
            console.error('Error processing OpenAI message:', error, 'Raw message:', data);
        }
    });

    openAiWs.on('close', () => {
        pendingOpenAiMessages.length = 0;
        onClose?.();
    });

    openAiWs.on('error', (error) => {
        onError?.(error);
    });

    return {
        openAiWs,
        send: openAiSend,
        requestResponse: () => openAiSend({ type: 'response.create' }),
        updateSession: (partialSession) => openAiSend({
            type: 'session.update',
            session: {
                type: 'realtime',
                ...partialSession,
            }
        }),
        close: () => {
            try { openAiWs.close(); } catch {
                // noop: ignore close errors
                void 0;
            }
        },
        clearPendingMessages: () => { pendingOpenAiMessages.length = 0; },
    };
}

/** @type {(args: Parameters<typeof realCreateAssistantSession>[0]) => ReturnType<typeof realCreateAssistantSession>} */
let createAssistantSessionImpl = realCreateAssistantSession;

/**
 * Create a realtime assistant session and wire event handlers.
 *
 * @param {Parameters<typeof realCreateAssistantSession>[0]} options - Session options.
 * @returns {ReturnType<typeof realCreateAssistantSession>} Session helpers.
 */
export function createAssistantSession(options) {
    return createAssistantSessionImpl(options);
}

/**
 * Test-only override for createAssistantSession.
 * @param {typeof realCreateAssistantSession} override - Replacement implementation.
 */
export function setCreateAssistantSessionForTests(override) {
    createAssistantSessionImpl = override || realCreateAssistantSession;
}

/** Restore the default createAssistantSession implementation. */
export function resetCreateAssistantSessionForTests() {
    createAssistantSessionImpl = realCreateAssistantSession;
}
