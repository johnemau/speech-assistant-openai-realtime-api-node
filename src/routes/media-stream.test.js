import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
    setExecuteToolCallForTests,
    resetExecuteToolCallForTests,
} from '../tools/index.js';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.WAIT_MUSIC_THRESHOLD_MS =
    process.env.WAIT_MUSIC_THRESHOLD_MS || '20';
process.env.WAIT_MUSIC_FOLDER =
    process.env.WAIT_MUSIC_FOLDER || path.join(process.cwd(), 'music');

/**
 * @returns {{ promise: Promise<unknown>, resolve: (value?: unknown) => void, reject: (error: Error) => void }} Deferred promise handle.
 */
function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve = () => {};
    /** @type {(error: Error) => void} */
    let reject = () => {};
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>} Promise resolved after delay.
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ sends: string[] }} connection - Connection mock with send buffer.
 * @param {number} baseline - Baseline send count to exceed.
 * @param {number} timeoutMs - Max time to wait.
 * @param {number} intervalMs - Polling interval.
 * @returns {Promise<boolean>} Whether send count increased in time.
 */
async function waitForSendIncrease(
    connection,
    baseline,
    timeoutMs,
    intervalMs = 50
) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (connection.sends.length > baseline) return true;
        await delay(intervalMs);
    }
    return false;
}

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
    waitMusicThreshold = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 20),
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
    const prevSpotFeedId = process.env.SPOT_FEED_ID;
    const prevSpotFeedPassword = process.env.SPOT_FEED_PASSWORD;
    const prev = {
        primary: new Set(env.PRIMARY_CALLERS_SET),
        secondary: new Set(env.SECONDARY_CALLERS_SET),
    };

    env.PRIMARY_CALLERS_SET.clear();
    env.SECONDARY_CALLERS_SET.clear();
    primaryCallers.forEach((value) => env.PRIMARY_CALLERS_SET.add(value));
    secondaryCallers.forEach((value) => env.SECONDARY_CALLERS_SET.add(value));

    delete process.env.SPOT_FEED_ID;
    delete process.env.SPOT_FEED_PASSWORD;

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
        if (prevSpotFeedId == null) {
            delete process.env.SPOT_FEED_ID;
        } else {
            process.env.SPOT_FEED_ID = prevSpotFeedId;
        }
        if (prevSpotFeedPassword == null) {
            delete process.env.SPOT_FEED_PASSWORD;
        } else {
            process.env.SPOT_FEED_PASSWORD = prevSpotFeedPassword;
        }
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
            String(greeting.item.content[0].text).includes(
                'Start the greeting with'
            )
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

        // Goodbye response is queued until the current response finishes
        const afterEndCall = sessionState.requestResponseCalls;
        assert.equal(afterEndCall, callsBefore);

        // Simulate the current response finishing to drain the queue
        sessionState.onEvent?.({ type: 'response.done', response: {} });
        assert.equal(sessionState.requestResponseCalls, callsBefore + 1);

        // Simulate speech stopped (should not trigger another response during pending disconnect)
        sessionState.onEvent?.({ type: 'input_audio_buffer.speech_stopped' });
        assert.equal(sessionState.requestResponseCalls, callsBefore + 1);

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
        assert.equal(sessionState.requestResponseCalls, callsBefore + 1);
    } finally {
        cleanup();
    }
});

test('speech_stopped requests a response when not hanging up', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});

        const before = sessionState.requestResponseCalls;
        // Simulate end of caller speech (no pending disconnect)
        sessionState.onEvent?.({ type: 'input_audio_buffer.speech_stopped' });
        const after = sessionState.requestResponseCalls;
        assert.equal(after, before + 1);
    } finally {
        cleanup();
    }
});

test('tool completion queues response after assistant finishes speaking', async () => {
    setExecuteToolCallForTests(async () => ({ status: 'ok' }));
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});

        sessionState.onEvent?.({ type: 'response.created' });

        const before = sessionState.requestResponseCalls;

        await sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-tool-queue-1',
                arguments: JSON.stringify({ mode: 'far_field' }),
            },
            {}
        );

        assert.equal(
            sessionState.requestResponseCalls,
            before,
            'should not request while assistant is speaking'
        );

        sessionState.onEvent?.({ type: 'response.done', response: {} });

        assert.equal(
            sessionState.requestResponseCalls,
            before + 1,
            'should request after assistant response completes'
        );
    } finally {
        resetExecuteToolCallForTests();
        connection.close();
        cleanup();
    }
});

test('tool completion waits until caller stops speaking', async () => {
    setExecuteToolCallForTests(async () => ({ status: 'ok' }));
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});

        sessionState.onEvent?.({ type: 'input_audio_buffer.speech_started' });

        const before = sessionState.requestResponseCalls;

        await sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-tool-queue-2',
                arguments: JSON.stringify({ mode: 'near_field' }),
            },
            {}
        );

        assert.equal(
            sessionState.requestResponseCalls,
            before,
            'should not request while caller is speaking'
        );

        sessionState.onEvent?.({ type: 'input_audio_buffer.speech_stopped' });

        assert.equal(
            sessionState.requestResponseCalls,
            before + 1,
            'should request after caller stops speaking'
        );
    } finally {
        resetExecuteToolCallForTests();
        connection.close();
        cleanup();
    }
});

test('waiting music resumes after interrupt while tool is running', async () => {
    const deferred = createDeferred();
    setExecuteToolCallForTests(async () => deferred.promise);

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-WAIT-RESUME',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        const toolPromise = sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-wait-1',
                arguments: JSON.stringify({ mode: 'far_field' }),
            },
            {}
        );

        const started = await waitForSendIncrease(connection, 0, 2000);
        assert.ok(
            started,
            'waiting music should send media while tool is running'
        );

        sessionState.onAssistantOutput?.({
            type: 'audio',
            delta: 'AUDIO-INTERRUPT',
            itemId: 'item-wait-1',
        });

        sessionState.onEvent?.({ type: 'response.done', response: {} });

        const sendsAfterInterrupt = connection.sends.length;
        const resumed = await waitForSendIncrease(
            connection,
            sendsAfterInterrupt,
            3500
        );
        assert.ok(
            resumed,
            'waiting music should resume after interruption while tool is running'
        );

        deferred.resolve();
        await toolPromise;
    } finally {
        resetExecuteToolCallForTests();
        connection.close();
        cleanup();
    }
});

test('user hangup with no active tools closes OpenAI session immediately', async () => {
    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();
    let sessionClosed = false;

    const sessionModule = await import('../assistant/session.js');
    sessionModule.setCreateAssistantSessionForTests((options) => {
        sessionState.onEvent = options.onEvent;
        sessionState.onAssistantOutput = options.onAssistantOutput;
        sessionState.onToolCall = options.onToolCall;
        return {
            openAiWs: { readyState: 1, close: () => {} },
            send: (payload) => {
                sessionState.sendCalls.push(payload);
            },
            requestResponse: () => {
                sessionState.requestResponseCalls += 1;
            },
            updateSession: () => {},
            close: () => {
                sessionClosed = true;
            },
            clearPendingMessages: () => {},
        };
    });

    try {
        mediaStreamHandler(connection, {});

        // Start the stream
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-HANGUP-NO-TOOLS',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        // User hangs up with no tools in progress
        connection.handlers.close();

        // OpenAI session should be closed immediately
        assert.equal(
            sessionClosed,
            true,
            'OpenAI session should close immediately when no tools are running'
        );
    } finally {
        sessionModule.resetCreateAssistantSessionForTests();
        cleanup();
    }
});

test('user hangup with active tools keeps session open until tools complete', async () => {
    const deferred = createDeferred();
    setExecuteToolCallForTests(async () => {
        await deferred.promise;
        return { status: 'ok' };
    });

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();
    let sessionClosed = false;

    const sessionModule = await import('../assistant/session.js');
    sessionModule.setCreateAssistantSessionForTests((options) => {
        sessionState.onEvent = options.onEvent;
        sessionState.onAssistantOutput = options.onAssistantOutput;
        sessionState.onToolCall = options.onToolCall;
        return {
            openAiWs: { readyState: 1, close: () => {} },
            send: (payload) => {
                sessionState.sendCalls.push(payload);
            },
            requestResponse: () => {
                sessionState.requestResponseCalls += 1;
            },
            updateSession: () => {},
            close: () => {
                sessionClosed = true;
            },
            clearPendingMessages: () => {},
        };
    });

    try {
        mediaStreamHandler(connection, {});

        // Start the stream
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-HANGUP-WITH-TOOLS',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        // Start a long-running tool
        const toolPromise = sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-hangup-1',
                arguments: JSON.stringify({ mode: 'far_field' }),
            },
            {}
        );

        // User hangs up while tool is running
        connection.handlers.close();

        // OpenAI session should still be open
        assert.equal(
            sessionClosed,
            false,
            'OpenAI session should remain open while tools are running'
        );

        // Complete the tool
        deferred.resolve();
        await toolPromise;

        // Simulate response.done after tool completes
        sessionState.onEvent?.({ type: 'response.done', response: {} });

        // Now OpenAI session should be closed
        assert.equal(
            sessionClosed,
            true,
            'OpenAI session should close after all tools complete'
        );
    } finally {
        resetExecuteToolCallForTests();
        sessionModule.resetCreateAssistantSessionForTests();
        cleanup();
    }
});

test('post-hangup completion does not send audio to Twilio', async () => {
    const deferred = createDeferred();
    setExecuteToolCallForTests(async () => {
        await deferred.promise;
        return { status: 'ok' };
    });

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});

        // Start the stream
        connection.handlers.message(
            JSON.stringify({
                event: 'start',
                start: {
                    streamSid: 'SID-SILENT-MODE',
                    customParameters: { caller_number: '+12065550100' },
                },
            })
        );

        // Start a tool
        const toolPromise = sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-silent-1',
                arguments: JSON.stringify({ mode: 'far_field' }),
            },
            {}
        );

        const sendsBeforeHangup = connection.sends.length;

        // User hangs up
        connection.handlers.close();

        // Complete the tool
        deferred.resolve();
        await toolPromise;

        // Simulate assistant audio after hangup
        sessionState.onAssistantOutput?.({
            type: 'audio',
            delta: 'AUDIO-AFTER-HANGUP',
            itemId: 'item-silent-1',
        });

        // No new audio should be sent to Twilio after hangup
        assert.equal(
            connection.sends.length,
            sendsBeforeHangup,
            'No audio should be sent to Twilio after user hangs up'
        );
    } finally {
        resetExecuteToolCallForTests();
        cleanup();
    }
});

test('transfer_call invalid number prompts for clarification', async () => {
    setExecuteToolCallForTests(async () => {
        throw new Error('Invalid destination_number.');
    });

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        await sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'transfer_call',
                call_id: 'call-transfer-invalid',
                arguments: JSON.stringify({
                    destination_number: '206-8609',
                }),
            },
            {}
        );

        const prompt = sessionState.sendCalls.find(
            (payload) =>
                payload?.item?.type === 'message' &&
                payload?.item?.role === 'user' &&
                String(payload?.item?.content?.[0]?.text || '').includes(
                    'number provided does not look valid'
                )
        );
        assert.ok(prompt, 'Expected clarification prompt for invalid number');

        const errorOutput = sessionState.sendCalls.find(
            (payload) =>
                payload?.item?.type === 'function_call_output' &&
                String(payload?.item?.output || '').includes(
                    'Invalid destination_number'
                )
        );
        assert.ok(errorOutput, 'Expected tool error output to be sent');
    } finally {
        resetExecuteToolCallForTests();
        cleanup();
    }
});

test('transfer_call missing number prompts for clarification', async () => {
    setExecuteToolCallForTests(async () => {
        throw new Error('Missing destination_number.');
    });

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        await sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'transfer_call',
                call_id: 'call-transfer-missing',
                arguments: JSON.stringify({}),
            },
            {}
        );

        const prompt = sessionState.sendCalls.find(
            (payload) =>
                payload?.item?.type === 'message' &&
                payload?.item?.role === 'user' &&
                String(payload?.item?.content?.[0]?.text || '').includes(
                    'number provided does not look valid'
                )
        );
        assert.ok(prompt, 'Expected clarification prompt for missing number');
    } finally {
        resetExecuteToolCallForTests();
        cleanup();
    }
});

test('non-transfer tool error does not prompt for number', async () => {
    setExecuteToolCallForTests(async () => {
        throw new Error('boom');
    });

    const { mediaStreamHandler, sessionState, cleanup } =
        await loadMediaStreamHandler();
    const connection = createConnection();

    try {
        mediaStreamHandler(connection, {});
        await sessionState.onToolCall?.(
            {
                type: 'function_call',
                name: 'update_mic_distance',
                call_id: 'call-mic-error',
                arguments: JSON.stringify({ mode: 'far_field' }),
            },
            {}
        );

        const prompt = sessionState.sendCalls.find(
            (payload) =>
                payload?.item?.type === 'message' &&
                payload?.item?.role === 'user' &&
                String(payload?.item?.content?.[0]?.text || '').includes(
                    'number provided does not look valid'
                )
        );
        assert.equal(
            Boolean(prompt),
            false,
            'Did not expect transfer clarification prompt'
        );
    } finally {
        resetExecuteToolCallForTests();
        cleanup();
    }
});
