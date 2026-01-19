import test from 'node:test';
import assert from 'node:assert/strict';

import { createOpenAIClient, createTwilioClient, createEmailTransport } from './clients.js';

test('clients.createOpenAIClient throws without api key', () => {
    assert.throws(() => createOpenAIClient({ apiKey: '' }), /Missing OpenAI API key/);
});

test('clients.createOpenAIClient returns client with api key', () => {
    const client = createOpenAIClient({ apiKey: 'sk-test' });
    assert.ok(client);
    assert.ok(client.responses);
});

test('clients.createTwilioClient returns null when missing credentials', () => {
    const client = createTwilioClient({
        accountSid: '',
        authToken: '',
        apiKey: '',
        apiSecret: '',
        logger: console
    });
    assert.equal(client, null);
});

test('clients.createTwilioClient returns a client with auth token', () => {
    const client = createTwilioClient({
        accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        authToken: 'token',
        logger: console
    });
    assert.ok(client);
});

test('clients.createEmailTransport returns null without credentials', () => {
    const transport = createEmailTransport({ user: '', pass: '', serviceId: '', logger: console });
    assert.equal(transport, null);
});
