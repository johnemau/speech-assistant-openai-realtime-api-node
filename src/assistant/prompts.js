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
