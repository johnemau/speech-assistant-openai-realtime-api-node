import { GPT_5_4_MODEL } from '../../src/config/openai-models.js';
import {
    PAGE_EVALUATION_TEMPLATE,
    renderTemplate,
} from '../../src/assistant/prompts.js';

const DUMMY_CRITERIA = [
    '1. Production outage or service degradation affecting customers.',
    '2. Security incident or data breach.',
    '3. Infrastructure failure requiring immediate human intervention.',
].join('\n');

/** @type {any} */
const config = {
    prompts: [
        /**
         * Render the page-evaluation template with dummy criteria and inject
         * the promptfoo `{{user_prompt}}` variable as the email content.
         */
        renderTemplate(PAGE_EVALUATION_TEMPLATE, {
            criteria: DUMMY_CRITERIA,
            emailContent: '{{user_prompt}}',
        }),
    ],
    providers: [
        {
            id: `openai:responses:${GPT_5_4_MODEL}`,
            label: `${GPT_5_4_MODEL}-page-evaluation`,
            config: {
                model: GPT_5_4_MODEL,
                instructions:
                    'You are a triage assistant. Respond ONLY with valid JSON.',
            },
        },
    ],
    tests: ['cases-page-evaluation.yaml'],
};

export default config;
