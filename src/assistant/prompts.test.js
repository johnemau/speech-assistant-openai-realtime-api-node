import test from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_MESSAGE, WEB_SEARCH_INSTRUCTIONS, SMS_REPLY_INSTRUCTIONS } from './prompts.js';

test('assistant.prompts include key tool references', () => {
    assert.ok(SYSTEM_MESSAGE.includes('gpt_web_search'));
    assert.ok(SYSTEM_MESSAGE.includes('send_sms'));
    assert.ok(SYSTEM_MESSAGE.includes('send_email'));
    assert.ok(SYSTEM_MESSAGE.includes('end_call'));
});

test('assistant.prompts include search guidance', () => {
    assert.ok(WEB_SEARCH_INSTRUCTIONS.length > 0);
    assert.ok(SMS_REPLY_INSTRUCTIONS.length > 0);
    assert.ok(SMS_REPLY_INSTRUCTIONS.includes('web_search'));
});
