import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const { pageRepeatHandler } = await import('./page-repeat.js');

/**
 * @param {object} [options] - Request overrides.
 * @param {Record<string,string>} [options.query] - Query parameters.
 * @param {Record<string,string>} [options.headers] - Request headers.
 * @returns {{ request: any, reply: any }}
 */
function createMocks(options = {}) {
    const request = {
        query: options.query || {},
        headers: {
            host: 'example.com',
            'x-forwarded-proto': 'https',
            ...(options.headers || {}),
        },
    };
    /** @type {{ contentType: string | null, body: string | null, type: (t: string) => any, send: (b: string) => any }} */
    const reply = {
        contentType: null,
        body: null,
        type(t) {
            this.contentType = t;
            return this;
        },
        send(b) {
            this.body = b;
            return this;
        },
    };
    return { request, reply };
}

test('pageRepeatHandler: returns TwiML with page message repeated', async () => {
    const { request, reply } = createMocks({
        query: { message: 'Server is down' },
    });
    await pageRepeatHandler(request, reply);
    assert.equal(reply.contentType, 'text/xml');
    assert.match(reply.body || '', /Urgent page\. Server is down/);
    const repeats = (reply.body || '').match(/Repeating\. Server is down/g);
    assert.equal(repeats?.length, 2);
    assert.match(reply.body || '', /<Gather/);
    assert.match(reply.body || '', /Press any key to hear the message again/);
});

test('pageRepeatHandler: returns fallback when message is missing', async () => {
    const { request, reply } = createMocks({ query: {} });
    await pageRepeatHandler(request, reply);
    assert.equal(reply.contentType, 'text/xml');
    assert.match(reply.body || '', /Page message unavailable/);
});

test('pageRepeatHandler: constructs repeat URL from host header', async () => {
    const { request, reply } = createMocks({
        query: { message: 'Alert' },
        headers: { host: 'my-server.ngrok.io' },
    });
    await pageRepeatHandler(request, reply);
    assert.match(
        reply.body || '',
        /action="https:\/\/my-server\.ngrok\.io\/page-repeat/
    );
});
