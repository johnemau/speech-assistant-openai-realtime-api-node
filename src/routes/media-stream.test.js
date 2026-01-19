import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

function createConnection() {
    const handlers = {};
    const sends = [];
    return {
        handlers,
        sends,
        send(payload) {
            sends.push(payload);
        },
        close() {
            handlers.close?.();
        },
        on(event, handler) {
            handlers[event] = handler;
        }
    };
}

async function loadMediaStreamHandler({
    primaryCallers = new Set(['+12065550100']),
    secondaryCallers = new Set(),
    primaryName = 'Jordan',
    secondaryName = '',
    waitMusicThreshold = 10000
} = {}) {
    const sessionState = {
        sendCalls: [],
        requestResponseCalls: 0,
        onEvent: null,
        onAssistantOutput: null
    };

    mock.module('../env.js', /** @type {any} */ ({
        DEFAULT_SMS_USER_LOCATION: { type: 'approximate', country: 'US', region: 'Washington' },
        IS_DEV: false,
        PRIMARY_CALLERS_SET: primaryCallers,
        SECONDARY_CALLERS_SET: secondaryCallers,
        WAIT_MUSIC_FILE: null,
        WAIT_MUSIC_THRESHOLD_MS: waitMusicThreshold,
        PRIMARY_USER_FIRST_NAME: primaryName,
        SECONDARY_USER_FIRST_NAME: secondaryName,
    }));

    mock.module('../init.js', /** @type {any} */ ({
        openaiClient: {},
        twilioClient: {},
        senderTransport: {},
        env: {},
        VOICE: 'cedar',
        TEMPERATURE: 0.2,
        SHOW_TIMING_MATH: false,
    }));

    mock.module('../assistant/session.js', /** @type {any} */ ({
        safeParseToolArguments: (args) => {
            if (args && typeof args === 'object') return args;
            try {
                return JSON.parse(String(args || '{}'));
            } catch {
                return {};
            }
        },
        createAssistantSession: (options) => {
            sessionState.onEvent = options.onEvent;
            sessionState.onAssistantOutput = options.onAssistantOutput;
            return {
                openAiWs: { readyState: 1, close: () => {} },
                send: (payload) => sessionState.sendCalls.push(payload),
                requestResponse: () => { sessionState.requestResponseCalls += 1; },
                updateSession: () => {},
                close: () => {},
                clearPendingMessages: () => {}
            };
        }
    }));

    const moduleUrl = new URL('./media-stream.js', import.meta.url).href + `?test=media-${Math.random()}`;
    const { mediaStreamHandler } = await import(moduleUrl);
    return { mediaStreamHandler, sessionState };
}

test('media-stream start event sends initial greeting and response.create', async () => {
    const { mediaStreamHandler, sessionState } = await loadMediaStreamHandler();
    const connection = createConnection();

    mediaStreamHandler(connection, {});
    connection.handlers.message(JSON.stringify({
        event: 'start',
        start: {
            streamSid: 'SID123',
            customParameters: {
                caller_number: '+1 (206) 555-0100',
                twilio_number: '+1 (425) 555-0101'
            }
        }
    }));

    assert.equal(sessionState.requestResponseCalls, 1);
    assert.equal(sessionState.sendCalls.length, 1);
    const greeting = sessionState.sendCalls[0];
    assert.equal(greeting.type, 'conversation.item.create');
    assert.ok(String(greeting.item.content[0].text).includes('Jordan'));

    connection.close();
    mock.reset();
});

test('media-stream media event appends input audio buffer', async () => {
    const { mediaStreamHandler, sessionState } = await loadMediaStreamHandler();
    const connection = createConnection();

    mediaStreamHandler(connection, {});
    connection.handlers.message(JSON.stringify({
        event: 'media',
        media: { timestamp: 123, payload: 'BASE64AUDIO' }
    }));

    assert.equal(sessionState.sendCalls.length, 1);
    assert.deepEqual(sessionState.sendCalls[0], {
        type: 'input_audio_buffer.append',
        audio: 'BASE64AUDIO'
    });

    connection.close();
    mock.reset();
});

test('media-stream forwards assistant audio deltas to Twilio', async () => {
    const { mediaStreamHandler, sessionState } = await loadMediaStreamHandler();
    const connection = createConnection();

    mediaStreamHandler(connection, {});
    connection.handlers.message(JSON.stringify({
        event: 'start',
        start: { streamSid: 'SID999', customParameters: { caller_number: '+12065550100' } }
    }));

    sessionState.onAssistantOutput({ type: 'audio', delta: 'AUDIODELTA', itemId: 'item1' });

    assert.equal(connection.sends.length, 2);
    const mediaEvent = JSON.parse(connection.sends[0]);
    const markEvent = JSON.parse(connection.sends[1]);
    assert.equal(mediaEvent.event, 'media');
    assert.equal(mediaEvent.streamSid, 'SID999');
    assert.equal(mediaEvent.media.payload, 'AUDIODELTA');
    assert.equal(markEvent.event, 'mark');
    assert.equal(markEvent.streamSid, 'SID999');

    connection.close();
    mock.reset();
});