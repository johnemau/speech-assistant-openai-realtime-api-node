import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruthy, getSecretEnvKeys, getSecretEnvValues } from '../src/utils/env.js';
import { stringifyDeep } from '../src/utils/format.js';
import { normalizeUSNumberToE164 } from '../src/utils/phone.js';
import { createOpenAIClient, createTwilioClient, createEmailTransport } from '../src/utils/clients.js';
import { redactErrorDetail } from '../src/utils/redaction.js';

test('env.isTruthy handles common values', () => {
    assert.equal(isTruthy('true'), true);
    assert.equal(isTruthy('1'), true);
    assert.equal(isTruthy('YES'), true);
    assert.equal(isTruthy('on'), true);
    assert.equal(isTruthy('false'), false);
    assert.equal(isTruthy('0'), false);
    assert.equal(isTruthy(''), false);
    assert.equal(isTruthy(undefined), false);
});

test('env.getSecretEnvKeys merges extra keys', () => {
    const env = { REDACT_ENV_KEYS: 'EXTRA_ONE, EXTRA_TWO , ,EXTRA_ONE' };
    const keys = getSecretEnvKeys(env, ['DEFAULT']);
    assert.deepEqual(keys.sort(), ['DEFAULT', 'EXTRA_ONE', 'EXTRA_TWO'].sort());
});

test('env.getSecretEnvValues returns existing values', () => {
    const env = { FOO: 'alpha', BAR: '' };
    const values = getSecretEnvValues(env, ['FOO', 'BAR', 'BAZ']);
    assert.deepEqual(values, ['alpha']);
});

test('format.stringifyDeep returns a string', () => {
    const out = stringifyDeep({ a: { b: 1 } });
    assert.equal(typeof out, 'string');
    assert.ok(out.includes('a'));
});

test('phone.normalizeUSNumberToE164 normalizes typical inputs', () => {
    assert.equal(normalizeUSNumberToE164('206-555-1234'), '+12065551234');
    assert.equal(normalizeUSNumberToE164('+1 (425) 555-0123'), '+14255550123');
    assert.equal(normalizeUSNumberToE164('1 425 555 0123'), '+14255550123');
    assert.equal(normalizeUSNumberToE164(null), null);
});

test('clients.createOpenAIClient throws without api key', () => {
    assert.throws(() => createOpenAIClient({ apiKey: '' }), /Missing OpenAI API key/);
});

test('clients.createOpenAIClient returns client with api key', () => {
    const client = createOpenAIClient({ apiKey: 'sk-test' });
    assert.ok(client);
    assert.ok(client.responses);
});

test('clients.createTwilioClient returns null when missing credentials', () => {
    const client = createTwilioClient({ accountSid: '', authToken: '', apiKey: '', apiSecret: '' , logger: console });
    assert.equal(client, null);
});

test('clients.createTwilioClient returns a client with auth token', () => {
    const client = createTwilioClient({ accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', authToken: 'token', logger: console });
    assert.ok(client);
});

test('clients.createEmailTransport returns null without credentials', () => {
    const transport = createEmailTransport({ user: '', pass: '', serviceId: '', logger: console });
    assert.equal(transport, null);
});

test('redaction.redactErrorDetail removes secret values', () => {
    const env = { SECRET_ENV: 'super-secret' };
    const detail = 'oops super-secret leaked';
    const redacted = redactErrorDetail({
        errorLike: { message: 'super-secret' },
        detail,
        env,
        secretKeys: ['SECRET_ENV']
    });
    assert.ok(!redacted.includes('super-secret'));
});
