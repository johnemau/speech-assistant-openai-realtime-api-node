import {
    GPT_5_2_MODEL,
    buildSearchModelConfig,
} from '../../src/config/openai-models.js';
import { SMS_REPLY_INSTRUCTIONS } from '../../src/assistant/prompts.js';

/** @type {any} */
const config = {
    prompts: ['promptfoo-default-prompt.txt'],
    providers: [
        {
            id: `openai:${GPT_5_2_MODEL}`,
            label: `${GPT_5_2_MODEL}-sms`,
            config: {
                ...buildSearchModelConfig({
                    instructions: SMS_REPLY_INSTRUCTIONS,
                }),
            },
        },
    ],
    tests: ['cases-sms.yaml'],
};

export default config;
