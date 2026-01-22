import {
    definition as gptWebSearchDefinition,
    execute as executeGptWebSearch,
} from './gpt-web-search.js';
import {
    definition as sendEmailDefinition,
    execute as executeSendEmail,
} from './send-email.js';
import {
    definition as sendSmsDefinition,
    execute as executeSendSms,
} from './send-sms.js';
import {
    definition as updateMicDistanceDefinition,
    execute as executeUpdateMicDistance,
} from './update-mic-distance.js';
import {
    definition as endCallDefinition,
    execute as executeEndCall,
} from './end-call.js';
import {
    definition as getCurrentLocationDefinition,
    execute as executeGetCurrentLocation,
} from './get-current-location.js';
import {
    definition as findCurrentlyNearbyPlaceDefinition,
    execute as executeFindCurrentlyNearbyPlace,
} from './find-currently-nearby-place.js';

const toolExecutors = new Map(
    /** @type {Array<[string, (input: { args: object, context: object }) => Promise<unknown>]>} */ ([
        ['gpt_web_search', executeGptWebSearch],
        ['send_email', executeSendEmail],
        ['send_sms', executeSendSms],
        ['update_mic_distance', executeUpdateMicDistance],
        ['end_call', executeEndCall],
        ['get_current_location', executeGetCurrentLocation],
        ['find_currently_nearby_place', executeFindCurrentlyNearbyPlace],
    ])
);

/**
 * Get tool definitions for the assistant session.
 *
 * @returns {Array<object>} Tool definitions.
 */
export function getToolDefinitions() {
    return [
        gptWebSearchDefinition,
        sendEmailDefinition,
        sendSmsDefinition,
        updateMicDistanceDefinition,
        endCallDefinition,
        getCurrentLocationDefinition,
        findCurrentlyNearbyPlaceDefinition,
    ];
}

/**
 * Execute a tool call by name.
 *
 * @param {object} root0 - Tool invocation data.
 * @param {string} root0.name - Tool name.
 * @param {object} root0.args - Tool arguments.
 * @param {object} root0.context - Tool context.
 * @returns {Promise<unknown>} Tool result.
 */
export async function executeToolCall({ name, args, context }) {
    const executor = toolExecutors.get(name);
    if (!executor) throw new Error(`Unknown tool: ${name}`);
    return executor({ args, context });
}
