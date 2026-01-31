/**
 * Shared OpenAI model configuration for Realtime sessions and Response API calls.
 * Keep Promptfoo and runtime configs consistent.
 */

import { REALTIME_INSTRUCTIONS } from '../assistant/prompts.js';
import { getToolDefinitions } from '../tools/index.js';
import { definition as sendEmailDefinition } from '../tools/send-email.js';
import { definition as getCurrentLocationDefinition } from '../tools/get-current-location.js';
import { definition as getCurrentTimeDefinition } from '../tools/get-current-time.js';
import { definition as findCurrentlyNearbyPlaceDefinition } from '../tools/find-currently-nearby-place.js';
import { definition as placesTextSearchDefinition } from '../tools/places-text-search.js';
import { definition as directionsDefinition } from '../tools/directions.js';
import { definition as weatherDefinition } from '../tools/weather.js';
import {
    GPT_5_2_MODEL,
    DEFAULT_WEB_SEARCH_USER_LOCATION,
    DEFAULT_SMS_USER_LOCATION,
    buildWebSearchTool,
    buildSearchModelConfig,
    buildWebSearchResponseParams,
} from './web-search-models.js';
import { REALTIME_TEMPERATURE } from './constants.js';

export const REALTIME_MODEL = 'gpt-realtime';
export { REALTIME_TEMPERATURE };

export {
    GPT_5_2_MODEL,
    DEFAULT_WEB_SEARCH_USER_LOCATION,
    DEFAULT_SMS_USER_LOCATION,
};

/**
 * Build shared Realtime model config.
 *
 * @returns {Omit<import('openai/resources/realtime/realtime').RealtimeSessionCreateRequest, 'type'>} Realtime model config.
 */
export function buildRealtimeModelConfig() {
    return {
        model: REALTIME_MODEL,
        output_modalities: ['audio'],
        tool_choice: 'auto',
        instructions: REALTIME_INSTRUCTIONS,
        tools: getToolDefinitions(),
        audio: {
            input: {
                format: { type: 'audio/pcmu' },
                turn_detection: {
                    type: 'server_vad',
                    threshold: 0.7,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                    create_response: true,
                    interrupt_response: false,
                },
                noise_reduction: { type: 'near_field' },
            },
            output: { format: { type: 'audio/pcmu' }, voice: 'cedar' },
        },
    };
}

/**
 * Build shared Realtime model config.
 *
 * @returns {import('openai/resources/realtime/realtime').RealtimeSessionCreateRequest} Realtime model sesssion.
 */
export function buildRealtimeSession() {
    return {
        type: 'realtime',
        ...buildRealtimeModelConfig(),
    };
}

/**
 * Build shared Realtime session config.
 *
 * @returns {import('openai/resources/realtime/realtime').SessionUpdateEvent['session']} Realtime session config.
 */
export function buildRealtimeSessionConfig() {
    return {
        type: 'realtime',
        ...buildRealtimeModelConfig(),
    };
}

export {
    buildWebSearchTool,
    buildSearchModelConfig,
    buildWebSearchResponseParams,
};

/** @type {Array<import('openai/resources/responses/responses').Tool>} */
const SMS_TOOL_DEFINITIONS = [
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        sendEmailDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        getCurrentLocationDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        getCurrentTimeDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        findCurrentlyNearbyPlaceDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        placesTextSearchDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        directionsDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        weatherDefinition
    ),
];

/**
 * Build tool config for SMS responses.
 *
 * @returns {{ tools: Array<import('openai/resources/responses/responses').Tool>, tool_choice: 'auto' }} Tool config.
 */
export function buildSmsToolConfig() {
    return {
        tools: [
            /** @type {import('openai/resources/responses/responses').Tool} */ (
                buildWebSearchTool({
                    userLocation: DEFAULT_SMS_USER_LOCATION,
                })
            ),
            ...SMS_TOOL_DEFINITIONS,
        ],
        tool_choice: 'auto',
    };
}

/**
 * Build shared model config for SMS requests (excluding input).
 *
 * @param {object} options - Request inputs.
 * @param {string} options.instructions - System/tool instructions.
 * @returns {Omit<import('openai/resources/responses/responses').ResponseCreateParamsNonStreaming, 'input'>} Response API config.
 */
export function buildSmsResponseConfig({ instructions }) {
    return {
        model: GPT_5_2_MODEL,
        reasoning: { effort: 'high' },
        truncation: 'auto',
        instructions,
        ...buildSmsToolConfig(),
    };
}
