import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readPcmuFile } from './audio.js';

test('audio.readPcmuFile reads non-empty buffer', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcmu-'));
    const filePath = path.join(tmpDir, 'sample.pcmu');
    const payload = Buffer.from([0x00, 0x11, 0x22, 0x33]);
    fs.writeFileSync(filePath, payload);

    const out = readPcmuFile(filePath);
    assert.ok(Buffer.isBuffer(out));
    assert.equal(out.length, payload.length);
    assert.equal(out[1], 0x11);
});

test('audio.readPcmuFile throws on empty file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcmu-'));
    const filePath = path.join(tmpDir, 'empty.pcmu');
    fs.writeFileSync(filePath, Buffer.alloc(0));

    assert.throws(() => readPcmuFile(filePath), /PCMU file is empty/);
});
