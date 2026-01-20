import { openaiClient } from '../init.js';
import { WEB_SEARCH_INSTRUCTIONS } from '../assistant/prompts.js';
import { DEFAULT_SMS_USER_LOCATION } from '../env.js';

export const definition = {
    type: 'function',
    name: 'gpt_web_search',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: "The user's question or topic to research across the live web."
            },
            user_location: {
                type: 'object',
                description: 'Optional approximate user location to improve local relevance. Defaults to US Washington if not provided. When the user mentions a location, infer and include it here. Set type="approximate". If country is stated, use its two-letter code (e.g., US, FR); if not and the location is in the United States, default to US. Examples: "I am in Tucson Arizona" → region=Arizona, city=Tucson; "I will be in Paris, France" → region=Île-de-France, city=Paris.',
                properties: {
                    type: { type: 'string', description: 'Location type; use "approximate".' },
                    country: { type: 'string', description: 'Two-letter country code like US.' },
                    region: { type: 'string', description: 'Region or state name.' },
                    city: { type: 'string', description: 'Optional city.' }
                }
            }
        },
        required: ['query']
    },
    description: 'Comprehensive web search'
};

/**
 * Execute gpt_web_search tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ query?: string, user_location?: object }} root0.args - Tool arguments.
 * @returns {Promise<object>} Full OpenAI response.
 */
export async function execute({ args }) {
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('Missing query.');
    const effectiveLocation = args?.user_location ?? DEFAULT_SMS_USER_LOCATION;
    /** @type {import('openai/resources/responses/responses').ResponseCreateParamsNonStreaming} */
    const reqPayload = {
        model: 'gpt-5.2',
        reasoning: { effort: 'high' },
        tools: [{
            type: 'web_search',
            user_location: effectiveLocation,
        }],
        instructions: WEB_SEARCH_INSTRUCTIONS,
        input: query,
        tool_choice: 'required',
        truncation: 'auto',
    };
    const result = await openaiClient.responses.create(reqPayload);
    return result;
}
