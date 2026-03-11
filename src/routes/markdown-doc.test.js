import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';

import { createMarkdownDocHandler } from './markdown-doc.js';

/**
 * @returns {{ statusCode: number | null, headers: Record<string, string>, payload: unknown, type: (contentType: string) => any, code: (statusCode: number) => any, send: (payload: unknown) => any }} Reply mock.
 */
function createReply() {
    return {
        statusCode: null,
        headers: {},
        payload: null,
        /**
         * @param {string} contentType - Response content type.
         * @returns {any} Reply for chaining.
         */
        type(contentType) {
            this.headers.type = contentType;
            return this;
        },
        /**
         * @param {number} statusCode - HTTP status code.
         * @returns {any} Reply for chaining.
         */
        code(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        /**
         * @param {unknown} payload - Payload body.
         * @returns {any} Reply for chaining.
         */
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
}

test('markdown-doc renders markdown file as html', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'markdown-doc-'));
    const mdPath = path.join(tmpDir, 'tos.md');
    await writeFile(
        mdPath,
        '# Terms\n\nUse this service responsibly.\n',
        'utf8'
    );

    const handler = createMarkdownDocHandler({
        filePath: mdPath,
        title: 'Terms of Service',
    });
    const reply = createReply();

    try {
        await handler(/** @type {any} */ ({}), /** @type {any} */ (reply));

        assert.equal(reply.statusCode, null);
        assert.equal(reply.headers.type, 'text/html; charset=utf-8');
        assert.match(String(reply.payload), /<h1>Terms<\/h1>/);
        assert.match(String(reply.payload), /<title>Terms of Service<\/title>/);
        assert.match(
            String(reply.payload),
            /@media \(prefers-color-scheme: dark\)/
        );
    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
});

test('markdown-doc returns 500 when file is missing', async () => {
    const handler = createMarkdownDocHandler({
        filePath: 'does-not-exist/tos.md',
    });
    const reply = createReply();

    await handler(/** @type {any} */ ({}), /** @type {any} */ (reply));

    assert.equal(reply.statusCode, 500);
    assert.equal(reply.headers.type, 'text/plain; charset=utf-8');
    assert.equal(reply.payload, 'Unable to load markdown document.');
});

test('markdown-doc returns 500 when file path is not configured', async () => {
    const handler = createMarkdownDocHandler({
        filePath: '',
    });
    const reply = createReply();

    await handler(/** @type {any} */ ({}), /** @type {any} */ (reply));

    assert.equal(reply.statusCode, 500);
    assert.equal(reply.headers.type, 'text/plain; charset=utf-8');
    assert.equal(reply.payload, 'Markdown file path is not configured.');
});

test('markdown-doc substitutes variables in markdown', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'markdown-doc-'));
    const mdPath = path.join(tmpDir, 'policy.md');
    await writeFile(
        mdPath,
        '# Contact\n\nEmail us at {{SERVICE_OPERATOR_EMAIL}}.\n',
        'utf8'
    );

    const handler = createMarkdownDocHandler({
        filePath: mdPath,
        title: 'Privacy Policy',
        variables: { SERVICE_OPERATOR_EMAIL: 'hello@example.com' },
    });
    const reply = createReply();

    try {
        await handler(/** @type {any} */ ({}), /** @type {any} */ (reply));

        assert.equal(reply.headers.type, 'text/html; charset=utf-8');
        assert.match(String(reply.payload), /hello@example\.com/);
        assert.ok(
            !String(reply.payload).includes('{{SERVICE_OPERATOR_EMAIL}}'),
            'placeholder should be replaced'
        );
    } finally {
        await rm(tmpDir, { recursive: true, force: true });
    }
});
