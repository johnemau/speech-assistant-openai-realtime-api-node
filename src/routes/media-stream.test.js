import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

/**
 * @returns {{
 *  handlers: Record<string, Function>,
 *  sends: string[],
 *  send: (payload: string) => void,
 *  close: () => void,
 *  on: (event: string, handler: Function) => void,
 * }}
 */
function createConnection() {
    /** @type {Record<string, Function>} */
    const handlers = {};
    /** @type {string[]} */
    const sends = [];
    return {
        handlers,
        sends,
        /** @param {string} payload */
        send(payload) {
            sends.push(payload);
        },
        close() {
            handlers.close?.();
        },
        /** @param {string} event @param {Function} handler */
        on(event, handler) {
            handlers[event] = handler;
        },
    };
}

async function loadMediaStreamHandler({
    primaryCallers = new Set(['+12065550100']),
    secondaryCallers = new Set(),
    waitMusicThreshold = 10000,
} = {}) {
    /** @type {{ sendCalls: any[], requestResponseCalls: number, onEvent?: (event: any) => void, onAssistantOutput?: (event: any) => void }} */
    const sessionState = {
        sendCalls: [],
        requestResponseCalls: 0,
        onEvent: undefined,
        onAssistantOutput: undefined,
    };

    const env = await import('../env.js');
    const prev = {
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
    };

    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    primaryCallers.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
    secondaryCallers.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));

    if (Number.isFinite(waitMusicThreshold)) {
        process.env.WAIT_MUSIC_THRESHOLD_MS = String(waitMusicThreshold);
    }

    const sessionModule = await import('../assistant/session.js');
    sessionModule.setCreateAssistantSessionForTests((options) => {
        sessionState.onEvent = options.onEvent;
        sessionState.onAssistantOutput = options.onAssistantOutput;
        return {
            openAiWs: { readyState: 1, close: () => {} },
            send: (payload) => sessionState.sendCalls.push(payload),
            requestResponse: () => {
                sessionState.requestResponseCalls += 1;
            },
            updateSession: () => {},
            close: () => {},
            clearPendingMessages: () => {},
        };
    });

    const moduleUrl =
        new URL('./media-stream.js', import.meta.url).href +
        `?test=media-${Math.random()}`;
    const { mediaStreamHandler } = await import(moduleUrl);

    const cleanup = () => {
        env.PRIMARY_CALLERS_SET.clear();
        env.SECONDARY_CALLERS_SET.clear();
        prev.primary.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
        prev.secondary.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));
        sessionModule.resetCreateAssistantSessionForTests();
    };

    return { mediaStreamHandler, sessionState, cleanup };
}

test('media-stream start event sends initial greeting and response.create', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID123',
                    customParameters: {
                        caller_number: '+1 (206) 555-0100',
                        twilio_number: '+1 (425) 555-0101',
                    },
                },
            })
        );

        assert.equal(sessionState.requestResponseCalls, 1);
        assert.equal(sessionState.sendCalls.length, 1);
        const greeting = sessionState.sendCalls[0];
        assert.equal(greeting.type, 'conversation.item.create');
        assert.ok(
            String(greeting.item.content[0].text).includes('Greet the caller')
        );
    } finally {
        connection.close();
        cleanup();
    }
});

test('media-stream media event appends input audio buffer', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        connection.handlers.message(
            JSON.stringify({
                event: 'media',
                media: { timestamp: 123, payload: 'BASE64AUDIO' },
            })
        );

        assert.equal(sessionState.sendCalls.length, 1);
        assert.deepEqual(sessionState.sendCalls[0], {
            type: 'input_audio_buffer.append',
            audio: 'BASE64AUDIO',
        });
    } finally {
        connection.close();
        cleanup();
    }
});

test('media-stream forwards assistant audio deltas to Twilio', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID999',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        sessionState.onAssistantOutput?.({
            type: 'audio',
            delta: 'AUDIODELTA',
            itemId: 'item1',
        });

        assert.equal(connection.sends.length, 2);
        const mediaEvent = JSON.parse(connection.sends[0]);
        const markEvent = JSON.parse(connection.sends[1]);
        assert.equal(mediaEvent.event, 'media');
        assert.equal(mediaEvent.streamSid, 'SID999');
        assert.equal(mediaEvent.media.payload, 'AUDIODELTA');
        assert.equal(markEvent.event, 'mark');
        assert.equal(markEvent.streamSid, 'SID999');
    } finally {
        connection.close();
        cleanup();
    }
});
