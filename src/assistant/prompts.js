import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPrompt(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

export const REALTIME_INSTRUCTIONS = readPrompt('prompts/realtime-instructions.md');
export const WEB_SEARCH_INSTRUCTIONS = readPrompt('prompts/web-search-instructions.md');
export const SMS_REPLY_INSTRUCTIONS = readPrompt('prompts/sms-reply-instructions.md');
