import test from 'node:test';
import assert from 'node:assert/strict';

import { isTruthy, getSecretEnvKeys, getSecretEnvValues } from './env.js';

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
