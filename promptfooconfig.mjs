import { getToolDefinitions } from './src/tools/index.js';
import {
    createPromptfooGpt52Provider,
    createPromptfooRealtimeProvider,
} from './src/config/openai-models.js';

export default {
    prompts: [
        {
            label: 'default',
            raw: `System:
{{system_prompt}}

User:
{{user_prompt}}
`,
        },
    ],
    providers: [
        createPromptfooRealtimeProvider({ tools: getToolDefinitions() }),
        createPromptfooGpt52Provider(),
    ],
    tests: 'tests/promptfoo/cases.yaml',
};
