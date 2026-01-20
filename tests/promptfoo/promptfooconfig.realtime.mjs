import {
    REALTIME_MODEL,
    REALTIME_TEMPERATURE,
    buildRealtimeModelConfig,
} from '../../src/config/openai-models.js';

/** @type {any} */
const config = {
    prompts: ['promptfoo-default-prompt.txt'],
    providers: [
        {
            id: `openai:realtime:${REALTIME_MODEL}`,
            label: REALTIME_MODEL,
            config: {
                ...buildRealtimeModelConfig(),
                temperature: REALTIME_TEMPERATURE,
            },
        },
    ],
    tests: ['cases-voice.yaml'],
};

export default config;
