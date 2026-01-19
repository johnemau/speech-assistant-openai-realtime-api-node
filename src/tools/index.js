import { definition as gptWebSearchDefinition, execute as executeGptWebSearch } from './gpt-web-search.js';
import { definition as sendEmailDefinition, execute as executeSendEmail } from './send-email.js';
import { definition as sendSmsDefinition, execute as executeSendSms } from './send-sms.js';
import { definition as updateMicDistanceDefinition, execute as executeUpdateMicDistance } from './update-mic-distance.js';
import { definition as endCallDefinition, execute as executeEndCall } from './end-call.js';

const toolExecutors = new Map([
    ['gpt_web_search', executeGptWebSearch],
    ['send_email', executeSendEmail],
    ['send_sms', executeSendSms],
    ['update_mic_distance', executeUpdateMicDistance],
    ['end_call', executeEndCall],
]);

/**
 *
 */
export function getToolDefinitions() {
    return [
        gptWebSearchDefinition,
        sendEmailDefinition,
        sendSmsDefinition,
        updateMicDistanceDefinition,
        endCallDefinition,
    ];
}

/**
 *
 * @param root0
 * @param root0.name
 * @param root0.args
 * @param root0.context
 */
export async function executeToolCall({ name, args, context }) {
    const executor = toolExecutors.get(name);
    if (!executor) throw new Error(`Unknown tool: ${name}`);
    return executor({ args, context });
}
