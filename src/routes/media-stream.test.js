import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

/**
 * @returns {{
 *  handlers: Record<string, Function>,
 *  sends: string[],
 *  closed: boolean,
 *  send: (payload: string) => void,
 *  close: () => void,
 *  on: (event: string, handler: Function) => void,
 * }} Connection mock for tests.
 */
function createConnection() {
    /** @type {Record<string, Function>} */
    const handlers = {};
    /** @type {string[]} */
    const sends = [];
    return {
        handlers,
        sends,
        closed: false,
        /** @param {string} payload - Raw payload to record. */
        send(payload) {
            sends.push(payload);
        },
        close() {
            this.closed = true;
            handlers.close?.();
        },
        /**
         * @param {string} event - Event name.
         * @param {Function} handler - Handler to register.
         * @returns {void}
         */
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
    /** @type {{ sendCalls: any[], requestResponseCalls: number, onEvent?: (event: any) => void, onAssistantOutput?: (event: any) => void, onToolCall?: (call: any, response: any) => void }} */
    const sessionState = {
        sendCalls: [],
        requestResponseCalls: 0,
        onEvent: undefined,
        onAssistantOutput: undefined,
        onToolCall: undefined,
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
        sessionState.onToolCall = options.onToolCall;
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

test('end_call waits for goodbye audio start and mark drain before closing', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});

        // Start event with streamSid to enable marks/closing behavior
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-GOODBYE',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        // Trigger end_call tool invocation
        sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'end_call',
                call_id: 'call-1',
                arguments: '{}',
            },
            {}
        );

        // Simulate assistant goodbye audio starting
        sessionState.onAssistantOutput?.({
            type: 'audio',
            delta: 'AUDIODELTA-GOODBYE',
            itemId: 'goodbye-item',
        });

        // Signal that the response finished (no function call in the response)
        sessionState.onEvent?.({ type: 'response.done', response: {} });

        // Should not close yet because a mark is still pending
        assert.equal(connection.closed, false);

        // Drain the mark queue
        connection.handlers.message(
            JSON.stringify({ event: 'mark', streamSid: 'SID-GOODBYE' })
        );

        // Now the connection should be closed after goodbye playback
        assert.equal(connection.closed, true);
    } finally {
        cleanup();
    }
});

test('no extra response.create after end_call (only goodbye)', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        // Begin a stream so marks and playback are enabled
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-NO-EXTRA',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        const callsBefore = sessionState.requestResponseCalls;

        // Trigger end_call
        sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'end_call',
                call_id: 'call-2',
                arguments: '{}',
            },
            {}
        );

        // One response should be requested for the goodbye
        const afterEndCall = sessionState.requestResponseCalls;
        assert.equal(afterEndCall, callsBefore + 1);

        // Simulate speech stopped (should not trigger another response during pending disconnect)
        sessionState.onEvent?.({ type: 'input_audio_buffer.speech_stopped' });
        assert.equal(sessionState.requestResponseCalls, afterEndCall);

        // Simulate goodbye audio and completion to allow close
        sessionState.onAssistantOutput?.({
            type: 'audio',
            delta: 'AUDIODELTA-GOODBYE',
            itemId: 'goodbye-item-2',
        });
        sessionState.onEvent?.({ type: 'response.done', response: {} });
        // Drain mark so call can close
        connection.handlers.message(
            JSON.stringify({ event: 'mark', streamSid: 'SID-NO-EXTRA' })
        );

        assert.equal(connection.closed, true);
        // Ensure still only one response request after end_call
        assert.equal(sessionState.requestResponseCalls, afterEndCall);
    } finally {
        cleanup();
    }
});
