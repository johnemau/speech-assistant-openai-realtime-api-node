import { GPT_5_4_MODEL } from '../../src/config/openai-models.js';
import { STUDY_ROOM_INSTRUCTIONS } from '../../src/assistant/prompts.js';

/** @type {any} */
const config = {
    prompts: ['promptfoo-default-prompt.txt'],
    providers: [
        {
            id: `openai:responses:${GPT_5_4_MODEL}`,
            label: `${GPT_5_4_MODEL}-study-room-times`,
            config: {
                model: GPT_5_4_MODEL,
                instructions: STUDY_ROOM_INSTRUCTIONS,
            },
        },
    ],
    tests: ['cases-study-room-times.yaml'],
};

export default config;
