import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const { execute } = await import('./gpt-web-search.js');
const { REALTIME_WEB_SEARCH_INSTRUCTIONS } =
    await import('../assistant/prompts.js');
const { DEFAULT_SMS_USER_LOCATION } =
    await import('../config/openai-models.js');

test('gpt-web-search.execute throws on missing query', async () => {
    const prevClient = init.openaiClient;
    init.setInitClients({
        openaiClient: { responses: { create: async () => ({}) } },
    });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { query: '' },
                }),
            /Missing query/
        );
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});

test('gpt-web-search.execute calls OpenAI with default location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            },
        },
    };
    const prevClient = init.openaiClient;
    init.setInitClients({ openaiClient });
    try {
        const out = await execute({
            args: { query: 'test' },
        });
        assert.deepEqual(out, { output_text: 'ok' });
        if (!payload) throw new Error('Missing payload');
        const req = /** @type {any} */ (payload);
        assert.equal(req.input, 'test');
        assert.equal(req.instructions, REALTIME_WEB_SEARCH_INSTRUCTIONS);
        assert.deepEqual(req.tools[0].user_location, DEFAULT_SMS_USER_LOCATION);
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});

test('gpt-web-search.execute uses explicit user_location', async () => {
    let payload = null;
    const openaiClient = {
        responses: {
            create: async (req) => {
                payload = req;
                return { output_text: 'ok' };
            },
        },
    };
    const prevClient = init.openaiClient;
    init.setInitClients({ openaiClient });
    try {
        const out = await execute({
            args: {
                query: 'test',
                user_location: { type: 'approximate', country: 'FR' },
            },
        });
        assert.deepEqual(out, { output_text: 'ok' });
        if (!payload) throw new Error('Missing payload');
        const req = /** @type {any} */ (payload);
        assert.deepEqual(req.tools[0].user_location, {
            type: 'approximate',
            country: 'FR',
        });
    } finally {
        init.setInitClients({ openaiClient: prevClient });
    }
});
