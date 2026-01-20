import { openaiClient } from '../init.js';
import { WEB_SEARCH_INSTRUCTIONS } from '../assistant/prompts.js';
import { DEFAULT_SMS_USER_LOCATION } from '../env.js';
import { gptWebSearchDefinition } from './definitions.js';

export const definition = gptWebSearchDefinition;

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
