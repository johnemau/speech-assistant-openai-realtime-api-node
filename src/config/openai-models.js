/**
 * Shared OpenAI model configuration for Realtime sessions and Response API calls.
 * Keep Promptfoo and runtime configs consistent.
 */

import { REALTIME_INSTRUCTIONS } from '../assistant/prompts.js';
import { getToolDefinitions } from '../tools/index.js';
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
