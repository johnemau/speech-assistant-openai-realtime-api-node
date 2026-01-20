/**
 * Shared OpenAI model configuration for Realtime sessions and Response API calls.
 * Keep Promptfoo and runtime configs consistent.
 */

/** @typedef {import('openai/resources/responses/responses').WebSearchTool.UserLocation} WebSearchUserLocation */
/** @typedef {import('openai/resources/responses/responses').ResponseCreateParamsNonStreaming} ResponseCreateParamsNonStreaming */

export const REALTIME_MODEL = 'gpt-realtime';
export const REALTIME_TEMPERATURE = 0.8;

export const GPT_5_2_MODEL = 'gpt-5.2';

/** @type {WebSearchUserLocation} */
export const DEFAULT_WEB_SEARCH_USER_LOCATION = {
    type: 'approximate',
    country: 'US',
    region: 'Washington',
};

// Backwards-friendly alias for existing imports
export const DEFAULT_SMS_USER_LOCATION = DEFAULT_WEB_SEARCH_USER_LOCATION;

/**
 * Build shared Realtime session config (excluding instructions/tools).
 *
 * @returns {import('openai/resources/realtime/realtime').SessionUpdateEvent['session']} Realtime session config.
 */
export function buildRealtimeSessionConfig() {
    return {
        type: 'realtime',
        model: REALTIME_MODEL,
        output_modalities: ['audio'],
        tool_choice: 'auto',
        audio: {
            input: {
                format: { type: 'audio/pcmu' },
                turn_detection: {
                    type: 'semantic_vad',
                    eagerness: 'low',
                    interrupt_response: true,
                    create_response: false,
                },
                noise_reduction: { type: 'near_field' },
            },
            output: { format: { type: 'audio/pcmu' }, voice: 'cedar' },
        },
    };
}

/**
 * Build a web_search tool descriptor.
 *
 * @param {object} [options] - Tool options.
 * @param {WebSearchUserLocation} [options.userLocation] - Explicit user location.
 * @returns {{ type: 'web_search', user_location: WebSearchUserLocation }} Tool config.
 */
export function buildWebSearchTool({ userLocation } = {}) {
    return {
        type: 'web_search',
        user_location: userLocation ?? DEFAULT_WEB_SEARCH_USER_LOCATION,
    };
}

/**
 * Build Response API params for GPT‑5.2 with web search.
 *
 * @param {object} options - Request inputs.
 * @param {string} options.input - Input prompt text.
 * @param {string} options.instructions - System/tool instructions.
 * @param {WebSearchUserLocation} [options.userLocation] - Optional user location.
 * @returns {ResponseCreateParamsNonStreaming} Response API request payload.
 */
export function buildWebSearchResponseParams({
    input,
    instructions,
    userLocation,
}) {
    return {
        ...buildSearchModelConfig({ instructions, userLocation }),
        input,
    };
}

/**
 * Build shared model config for web search requests (excluding input).
 *
 * @param {object} options - Request inputs.
 * @param {string} options.instructions - System/tool instructions.
 * @param {WebSearchUserLocation} [options.userLocation] - Optional user location.
 * @returns {Omit<ResponseCreateParamsNonStreaming, 'input'>} Response API config.
 */
export function buildSearchModelConfig({ instructions, userLocation }) {
    return {
        model: GPT_5_2_MODEL,
        reasoning: { effort: 'high' },
        tools: [buildWebSearchTool({ userLocation })],
        instructions,
        tool_choice: 'required',
        truncation: 'auto',
    };
}
