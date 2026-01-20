export const gptWebSearchDefinition = {
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

export const sendEmailDefinition = {
    type: 'function',
    name: 'send_email',
    parameters: {
        type: 'object',
        properties: {
            subject: { type: 'string', description: 'Short subject summarizing the latest context.' },
            body_html: {
                type: 'string',
                description: 'HTML-only email body composed from the latest conversation context. Non-conversational (no follow-up questions); formatted for readability and concise. Include specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be provided as clickable URLs. Always conclude with a small, cute ASCII art at the end of the message.',
            }
        },
        required: ['subject', 'body_html']
    },
    description: 'Send an HTML email with the latest context. The assistant must supply a subject and a non-conversational, concise HTML body that includes specific details the caller requested and, when available, links to new articles, official business websites, Google Maps locations, email and phone contact information, addresses, and hours of operation relevant to any business, event, or news the caller requested. All links must be clickable URLs. Always conclude the email with a small, cute ASCII art at the end.'
};

export const sendSmsDefinition = {
    type: 'function',
    name: 'send_sms',
    parameters: {
        type: 'object',
        properties: {
            body_text: {
                type: 'string',
                description: 'Concise, actionable SMS body with no filler or preamble. Include only the information requested and any sources as short labels with URLs (e.g., official page, business website, article). Keep wording tight and direct. You may add a single, short follow-up question (e.g., "Would you like me to get the hours of operation?") when helpful.'
            }
        },
        required: ['body_text']
    },
    description: 'Send an SMS that contains only the requested information and brief source labels with URLs. Keep it actionable and free of preamble or unnecessary words. A single short follow-up question is allowed when helpful (e.g., asking if you should get hours or more details).'
};

export const updateMicDistanceDefinition = {
    type: 'function',
    name: 'update_mic_distance',
    parameters: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['near_field', 'far_field'],
                description: 'Set input noise_reduction.type to near_field or far_field.'
            },
            reason: {
                type: 'string',
                description: 'Optional short note about why (e.g., caller phrase).'
            }
        },
        required: ['mode']
    },
    description: 'Toggle mic processing based on caller phrases: speakerphone-on → far_field; off-speakerphone → near_field. Debounce and avoid redundant toggles; one tool call per turn.'
};

export const endCallDefinition = {
    type: 'function',
    name: 'end_call',
    parameters: {
        type: 'object',
        properties: {
            reason: { type: 'string', description: 'Optional short phrase indicating why the caller wants to end.' }
        }
    },
    description: 'Politely end the call. The server will close the Twilio media-stream and OpenAI WebSocket after the assistant says a brief goodbye.'
};

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
    ];
}
