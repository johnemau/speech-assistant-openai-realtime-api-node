import { getToolDefinitions } from './src/tools/index.js';
import {
    DEFAULT_WEB_SEARCH_USER_LOCATION,
    REALTIME_MODEL,
    REALTIME_TEMPERATURE,
    GPT_5_2_MODEL,
    buildRealtimeModelConfig,
    buildWebSearchResponseParams,
} from './src/config/openai-models.js';

const {
    input: _gpt52Input,
    instructions: _gpt52Instructions,
    ...gpt52WebSearchConfig
} = buildWebSearchResponseParams({
    input: '',
    instructions: '',
    userLocation: DEFAULT_WEB_SEARCH_USER_LOCATION,
});

/** @type {import('promptfoo').Config} */
const config = {
    prompts: ['promptfoo-default.txt'],
    providers: [
        {
            id: `openai:${REALTIME_MODEL}`,
            label: REALTIME_MODEL,
            config: {
                ...buildRealtimeModelConfig(),
                temperature: REALTIME_TEMPERATURE,
                tools: getToolDefinitions(),
            },
        },
        {
            id: `openai:${GPT_5_2_MODEL}`,
            label: GPT_5_2_MODEL,
            config: {
                ...gpt52WebSearchConfig,
            },
        },
    ],
    tests: 'tests/promptfoo/cases.yaml',
};

export default config;
export {
    DEFAULT_WEB_SEARCH_USER_LOCATION,
    REALTIME_MODEL,
    REALTIME_TEMPERATURE,
    GPT_5_2_MODEL,
};
