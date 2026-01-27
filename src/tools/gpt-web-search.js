import { openaiClient } from '../init.js';
import { REALTIME_WEB_SEARCH_INSTRUCTIONS } from '../assistant/prompts.js';
import {
    buildWebSearchResponseParams,
    DEFAULT_SMS_USER_LOCATION,
} from '../config/web-search-models.js';
import { getLatestTrackLocation } from '../utils/spot-location.js';
import { isPrimaryCaller } from '../env.js';

export const definition = {
    type: 'function',
    name: 'gpt_web_search',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description:
                    "The user's question or topic to research across the live web.",
            },
            user_location: {
                type: 'object',
                description:
                    'Optional approximate user location to improve local relevance. When the user explicitly states a location in the conversation, infer and include it here (set type="approximate"). If the user gives a city, also determine and include the region/state and country code when they can be reliably inferred (e.g., "I am in Tucson" → city=Tucson, region=Arizona, country=US). If the country is stated, use its two-letter code (e.g., US, FR). If any detail cannot be confidently determined from the conversation, omit it entirely; do not guess or default. For location-based questions without an explicit location, first attempt get_current_location; if it returns a specific, useful location, use it to populate user_location. If the location result is unhelpful and there is no caller-provided hint, omit user_location so the tool can derive location from tracking.',
                properties: {
                    type: {
                        type: 'string',
                        description: 'Location type; use "approximate".',
                    },
                    country: {
                        type: 'string',
                        description: 'Two-letter country code like US.',
                    },
                    region: {
                        type: 'string',
                        description: 'Region or state name.',
                    },
                    city: { type: 'string', description: 'Optional city.' },
                },
            },
        },
        required: ['query'],
    },
    description: 'Comprehensive web search',
};

/**
 * Execute gpt_web_search tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ query?: string, user_location?: object }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<object>} Full OpenAI response.
 */
export async function execute({ args, context }) {
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('Missing query.');
    let effectiveLocation = args?.user_location;
    const currentCallerE164 = context?.currentCallerE164 || null;
    const allowTrackedLocation =
        !!currentCallerE164 && isPrimaryCaller(currentCallerE164);
    if (!effectiveLocation && allowTrackedLocation) {
        try {
            const latestTrack = await getLatestTrackLocation();
            effectiveLocation = latestTrack?.location?.userLocation;
        } catch (error) {
            console.warn(
                'Failed to load tracked location; using default.',
                error
            );
        }
    }
    if (!effectiveLocation) {
        effectiveLocation = DEFAULT_SMS_USER_LOCATION;
    }
    const reqPayload = buildWebSearchResponseParams({
        input: query,
        instructions: REALTIME_WEB_SEARCH_INSTRUCTIONS,
        userLocation: effectiveLocation,
    });
    const result = await openaiClient.responses.create(reqPayload);
    return result;
}
