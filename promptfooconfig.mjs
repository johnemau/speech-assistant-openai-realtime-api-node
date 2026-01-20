import { getToolDefinitions } from './src/tools/index.js';
import { DEFAULT_WEB_SEARCH_USER_LOCATION, REALTIME_MODEL, REALTIME_TEMPERATURE, GPT_5_2_MODEL } from './src/config/openai-models.js';
const config = {
    prompts: [
        'promptfoo-default.txt',
    ],
    providers: [
        {
            id: `openai:${REALTIME_MODEL}`,
            label: REALTIME_MODEL,
            config: {
                temperature: REALTIME_TEMPERATURE,
                tools: getToolDefinitions(),
            },
        },
        {
            id: `openai:${GPT_5_2_MODEL}`,
            label: GPT_5_2_MODEL,
            config: {
                reasoning: { effort: 'high' },
                tools: [{ type: 'web_search', user_location: DEFAULT_WEB_SEARCH_USER_LOCATION }],
                tool_choice: 'required',
            },
        },
    ],
    tests: 'tests/promptfoo/cases.yaml',
};

export default config;
export { DEFAULT_WEB_SEARCH_USER_LOCATION, REALTIME_MODEL, REALTIME_TEMPERATURE, GPT_5_2_MODEL };
