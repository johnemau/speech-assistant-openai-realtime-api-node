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
export const DEFAULT_WEB_SEARCH_USER_LOCATION = { type: 'approximate', country: 'US', region: 'Washington' };

// Backwards-friendly alias for existing imports
export const DEFAULT_SMS_USER_LOCATION = DEFAULT_WEB_SEARCH_USER_LOCATION;

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
export function buildWebSearchResponseParams({ input, instructions, userLocation }) {
    return {
        model: GPT_5_2_MODEL,
        reasoning: { effort: 'high' },
        tools: [buildWebSearchTool({ userLocation })],
        instructions,
        input,
        tool_choice: 'required',
        truncation: 'auto',
    };
}
