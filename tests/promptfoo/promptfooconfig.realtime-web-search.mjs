import {
    GPT_5_2_MODEL,
    buildSearchModelConfig,
} from '../../src/config/openai-models.js';
import { REALTIME_WEB_SEARCH_INSTRUCTIONS } from '../../src/assistant/prompts.js';

/** @type {any} */
const config = {
    prompts: ['promptfoo-default-prompt.txt'],
    providers: [
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
    tests: ['cases-realtime-web-search.yaml'],
};

export default config;
