import test from 'node:test';
import assert from 'node:assert/strict';

import { redactErrorDetail } from './redaction.js';

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
