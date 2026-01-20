import test from 'node:test';
import assert from 'node:assert/strict';

import { execute } from './gpt-web-search.js';

test('gpt-web-search.execute throws on missing query', async () => {
    await assert.rejects(() => execute({
        args: { query: '' },
        context: { openaiClient: { responses: { create: async () => ({}) } } }
    }), /Missing query/);
});

test('gpt-web-search.execute calls OpenAI with default location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            }
        }
    };
    const out = await execute({
        args: { query: 'test' },
        context: {
            openaiClient,
            webSearchInstructions: 'instructions',
            defaultUserLocation: { type: 'approximate', country: 'US' }
        }
    });
    assert.deepEqual(out, { output_text: 'ok' });
    if (!payload) throw new Error('Missing payload');
    const req = /** @type {any} */ (payload);
    assert.equal(req.input, 'test');
    assert.equal(req.instructions, 'instructions');
    assert.deepEqual(req.tools[0].user_location, { type: 'approximate', country: 'US' });
});

test('gpt-web-search.execute uses explicit user_location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            }
        }
    };
    const out = await execute({
        args: { query: 'test', user_location: { type: 'approximate', country: 'FR' } },
        context: { openaiClient }
    });
    assert.deepEqual(out, { output_text: 'ok' });
    if (!payload) throw new Error('Missing payload');
    const req = /** @type {any} */ (payload);
    assert.deepEqual(req.tools[0].user_location, { type: 'approximate', country: 'FR' });
});
