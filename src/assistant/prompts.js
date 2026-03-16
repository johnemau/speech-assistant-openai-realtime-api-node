import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} relativePath - Prompt file path relative to this module.
 * @returns {string} Prompt content.
 */
function readPrompt(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

export const REALTIME_INSTRUCTIONS = readPrompt(
    'prompts/realtime-instructions.md'
);
export const REALTIME_WEB_SEARCH_INSTRUCTIONS = readPrompt(
    'prompts/realtime-web-search-instructions.md'
);
export const SMS_REPLY_INSTRUCTIONS = readPrompt(
    'prompts/sms-reply-instructions.md'
);
export const PAGE_EVALUATION_TEMPLATE = readPrompt(
    'prompts/page-evaluation-instructions.md'
);

/**
 * Render a prompt template by replacing `{{ key }}` placeholders with values.
 *
 * @param {string} template - Template string with `{{ key }}` placeholders.
 * @param {Record<string, string>} vars - Key-value pairs to inject.
 * @returns {string} Rendered prompt.
 */
export function renderTemplate(template, vars) {
    return template.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) =>
        key in vars ? vars[key] : `{{ ${key} }}`
    );
}
