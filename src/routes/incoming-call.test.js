import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

function createReply() {
    return {
        headers: {},
        statusCode: null,
        payload: null,
        type(contentType) {
            this.headers.type = contentType;
            return this;
        },
        code(status) {
            this.statusCode = status;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return this;
        }
    };
}

async function loadIncomingCallHandler({
    primaryCaller = '+12065550100',
    secondaryCaller = '+14255550101',
    primaryName = 'Jordan',
    secondaryName = 'Taylor'
} = {}) {
    mock.module('../env.js', /** @type {any} */ ({
        ALL_ALLOWED_CALLERS_SET: new Set([primaryCaller, secondaryCaller]),
        PRIMARY_CALLERS_SET: new Set([primaryCaller]),
        SECONDARY_CALLERS_SET: new Set([secondaryCaller]),
        PRIMARY_USER_FIRST_NAME: primaryName,
        SECONDARY_USER_FIRST_NAME: secondaryName,
    }));

    const moduleUrl = new URL('./incoming-call.js', import.meta.url).href + `?test=incoming-${Math.random()}`;
    const { incomingCallHandler } = await import(moduleUrl);
    return incomingCallHandler;
}

test('incoming-call denies callers not in allowlist', async () => {
    const incomingCallHandler = await loadIncomingCallHandler();
    const request = {
        body: { From: '+19995550000', To: '+12065550100' },
        headers: { host: 'example.com' }
    };
    const reply = createReply();

    await incomingCallHandler(request, reply);

    assert.equal(reply.headers.type, 'text/xml');
    assert.ok(String(reply.payload).includes('restricted'));
    assert.ok(String(reply.payload).includes('Hangup'));
    mock.reset();
});

test('incoming-call responds with connect stream and parameters', async () => {
    const incomingCallHandler = await loadIncomingCallHandler();
    const request = {
        body: { From: '+1 (206) 555-0100', To: '+1 (425) 555-0101' },
        headers: { host: 'example.com' }
    };
    const reply = createReply();

    await incomingCallHandler(request, reply);

    const twiml = String(reply.payload);
    assert.equal(reply.headers.type, 'text/xml');
    assert.ok(twiml.includes('Connecting to your AI assistant'));
    assert.ok(twiml.includes('Jordan'));
    assert.ok(twiml.includes('wss://example.com/media-stream'));
    assert.ok(twiml.includes('caller_number'));
    assert.ok(twiml.includes('twilio_number'));
    mock.reset();
});