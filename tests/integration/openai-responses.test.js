import test from 'node:test';
import assert from 'node:assert/strict';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

const apiKey = process.env.OPENAI_API_KEY;
let importCounter = 0;

/**
 * @returns {Promise<typeof import('../../src/tools/gpt-web-search.js')>} Module import.
 */
async function loadWebSearchModule() {
    importCounter += 1;
    return import(`../../src/tools/gpt-web-search.js?test=${importCounter}`);
}

test('requires OPENAI_API_KEY', () => {
    assert.ok(
        apiKey,
        'OPENAI_API_KEY must be set in the environment or .env file.'
    );
});

test('gpt_web_search integration', async () => {
    const { execute } = await loadWebSearchModule();

    const result = /** @type {any} */ (
        await execute({
            args: {
                query: 'What time is it in Seattle right now?',
                user_location: {
                    type: 'approximate',
                    country: 'US',
                    region: 'Washington',
                    city: 'Seattle',
                },
            },
            context: {},
        })
    );

    assert.ok(result, 'Expected a response object');
    if (result.id != null) {
        assert.equal(typeof result.id, 'string');
        assert.ok(result.id.length > 0);
    }
    if (result.output != null) {
        assert.ok(Array.isArray(result.output));
    }
    if (result.output_text != null) {
        assert.equal(typeof result.output_text, 'string');
    }
});
