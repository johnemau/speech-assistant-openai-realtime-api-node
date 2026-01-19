export const definition = {
    type: 'function',
    name: 'gpt_web_search',
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: "The user's question or topic to research across the live web."
            },
            user_location: {
                type: 'object',
                description: 'Optional approximate user location to improve local relevance. Defaults to US Washington if not provided. When the user mentions a location, infer and include it here. Set type="approximate". If country is stated, use its two-letter code (e.g., US, FR); if not and the location is in the United States, default to US. Examples: "I am in Tucson Arizona" → region=Arizona, city=Tucson; "I will be in Paris, France" → region=Île-de-France, city=Paris.',
                properties: {
                    type: { type: 'string', description: 'Location type; use "approximate".' },
                    country: { type: 'string', description: 'Two-letter country code like US.' },
                    region: { type: 'string', description: 'Region or state name.' },
                    city: { type: 'string', description: 'Optional city.' }
                }
            }
        },
        required: ['query']
    },
    description: 'Comprehensive web search'
};

/**
 *
 * @param root0
 * @param root0.args
 * @param root0.context
 */
export async function execute({ args, context }) {
    const { openaiClient, webSearchInstructions, defaultUserLocation } = context;
    const query = String(args?.query || '').trim();
    if (!query) throw new Error('Missing query.');
    const effectiveLocation = args?.user_location ?? defaultUserLocation;
    const reqPayload = {
        model: 'gpt-5.2',
        reasoning: { effort: 'high' },
        tools: [{
            type: 'web_search',
            user_location: effectiveLocation,
        }],
        instructions: webSearchInstructions,
        input: query,
        tool_choice: 'required',
        truncation: 'auto',
    };
    const result = await openaiClient.responses.create(reqPayload);
    return result.output_text;
}
