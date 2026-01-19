import test from 'node:test';
import assert from 'node:assert/strict';

import { stringifyDeep } from './format.js';

test('format.stringifyDeep returns a string', () => {
    const out = stringifyDeep({ a: { b: 1 } });
    assert.equal(typeof out, 'string');
    assert.ok(out.includes('a'));
});
