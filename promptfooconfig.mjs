import {
    REALTIME_MODEL,
    REALTIME_TEMPERATURE,
    GPT_5_2_MODEL,
    DEFAULT_WEB_SEARCH_USER_LOCATION,
    buildRealtimeModelConfig,
    buildSearchModelConfig,
} from './src/config/openai-models.js';
import {
    REALTIME_WEB_SEARCH_INSTRUCTIONS,
    SMS_REPLY_INSTRUCTIONS,
} from './src/assistant/prompts.js';

/** @type {import('promptfoo').Config} */
const config = {
    prompts: ['tests/promptfoo/promptfoo-default-prompt.txt'],
    providers: [
        {
            id: `openai:realtime:${REALTIME_MODEL}`,
            label: REALTIME_MODEL,
            config: {
                ...buildRealtimeModelConfig(),
                temperature: REALTIME_TEMPERATURE,
            },
        },
        {
            id: `openai:${GPT_5_2_MODEL}`,
            label: `${GPT_5_2_MODEL}-sms`,
            config: {
                ...buildSearchModelConfig({
                    instructions: SMS_REPLY_INSTRUCTIONS,
                }),
            },
        },
        {
            id: `openai:${GPT_5_2_MODEL}`,
            label: `${GPT_5_2_MODEL}-realtime-web-search`,
            config: {
                ...buildSearchModelConfig({
                    instructions: REALTIME_WEB_SEARCH_INSTRUCTIONS,
                }),
            },
        },
    ],
    tests: [
        'tests/promptfoo/cases-voice.yaml',
        'tests/promptfoo/cases-sms.yaml',
        'tests/promptfoo/cases-realtime-web-search.yaml',
    ],
};

export default config;
