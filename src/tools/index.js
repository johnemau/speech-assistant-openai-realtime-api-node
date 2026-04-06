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
    definition as transferCallDefinition,
    execute as executeTransferCall,
} from './transfer-call.js';
import {
    definition as getCurrentLocationDefinition,
    execute as executeGetCurrentLocation,
} from './get-current-location.js';
import {
    definition as getCurrentTimeDefinition,
    execute as executeGetCurrentTime,
} from './get-current-time.js';
import {
    definition as findCurrentlyNearbyPlaceDefinition,
    execute as executeFindCurrentlyNearbyPlace,
} from './find-currently-nearby-place.js';
import {
    definition as placesTextSearchDefinition,
    execute as executePlacesTextSearch,
} from './places-text-search.js';
import {
    definition as directionsDefinition,
    execute as executeDirections,
} from './directions.js';
import {
    definition as weatherDefinition,
    execute as executeWeather,
} from './weather.js';
import {
    definition as yaleLockDefinition,
    execute as executeYaleLock,
} from './yale-lock.js';
import {
    definition as getStudyRoomTimesDefinition,
    execute as executeGetStudyRoomTimes,
} from './get-study-room-times.js';
import { IS_DEV } from '../env.js';

// This module is the single source of truth for both tool declaration and tool
// dispatch, which makes it easier to verify that every advertised tool is wired.
const toolExecutors = new Map(
    /** @type {Array<[string, (input: { args: object, context: object }) => Promise<unknown>]>} */ ([
        ['gpt_web_search', executeGptWebSearch],
        ['send_email', executeSendEmail],
        ['send_sms', executeSendSms],
        ['update_mic_distance', executeUpdateMicDistance],
        ['end_call', executeEndCall],
        ['transfer_call', executeTransferCall],
        ['get_current_location', executeGetCurrentLocation],
        ['get_current_time', executeGetCurrentTime],
        ['find_currently_nearby_place', executeFindCurrentlyNearbyPlace],
        ['places_text_search', executePlacesTextSearch],
        ['directions', executeDirections],
        ['weather', executeWeather],
        ['yale_lock', executeYaleLock],
        ['get_study_room_times', executeGetStudyRoomTimes],
    ])
);

/**
 * Get tool definitions for the assistant session.
 *
 * @returns {Array<object>} Tool definitions.
 */
export function getToolDefinitions() {
    // Keep definition order stable so session payload diffs and test snapshots
    // stay readable when tools are added or removed.
    return [
        gptWebSearchDefinition,
        sendEmailDefinition,
        sendSmsDefinition,
        updateMicDistanceDefinition,
        endCallDefinition,
        transferCallDefinition,
        getCurrentLocationDefinition,
        getCurrentTimeDefinition,
        findCurrentlyNearbyPlaceDefinition,
        placesTextSearchDefinition,
        directionsDefinition,
        weatherDefinition,
        yaleLockDefinition,
        getStudyRoomTimesDefinition,
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
async function realExecuteToolCall({ name, args, context }) {
    if (IS_DEV) {
        console.log('tool-executor: dispatch', {
            name,
            hasArgs: Boolean(args),
            hasContext: Boolean(context),
        });
    }
    const executor = toolExecutors.get(name);
    if (!executor) throw new Error(`Unknown tool: ${name}`);
    // Individual tool modules own validation and side effects. The dispatcher is
    // intentionally thin so tests and logs have one choke point for execution.
    const result = await executor({ args, context });
    if (IS_DEV) {
        console.log('tool-executor: result', {
            name,
            result,
        });
    }
    return result;
}

let executeToolCallImpl = realExecuteToolCall;

/**
 * Execute a tool call by name (testable wrapper).
 *
 * @param {{ name: string, args: object, context: object }} root0 - Tool invocation data.
 * @returns {Promise<unknown>} Tool result.
 */
export async function executeToolCall({ name, args, context }) {
    if (IS_DEV) {
        console.log('tool-executor: execute tool call', {
            name,
        });
    }
    return executeToolCallImpl({ name, args, context });
}

/**
 * Test-only override for tool execution.
 * @param {(input: { name: string, args: object, context: object }) => Promise<unknown>} override - Replacement executor.
 */
export function setExecuteToolCallForTests(override) {
    if (IS_DEV) {
        console.log('tool-executor: set override', {
            hasOverride: Boolean(override),
        });
    }
    executeToolCallImpl = override || realExecuteToolCall;
}

/**
 * Restore the default tool executor.
 * @returns {void}
 */
export function resetExecuteToolCallForTests() {
    if (IS_DEV) {
        console.log('tool-executor: reset override');
    }
    executeToolCallImpl = realExecuteToolCall;
}
