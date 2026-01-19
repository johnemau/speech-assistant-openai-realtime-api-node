import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUSNumberToE164 } from './phone.js';

test('phone.normalizeUSNumberToE164 normalizes typical inputs', () => {
    assert.equal(normalizeUSNumberToE164('206-555-1234'), '+12065551234');
    assert.equal(normalizeUSNumberToE164('+1 (425) 555-0123'), '+14255550123');
    assert.equal(normalizeUSNumberToE164('1 425 555 0123'), '+14255550123');
    assert.equal(normalizeUSNumberToE164(null), null);
});
