export function getToolDefinitions() {
    const gptWebSearchTool = {
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

    const sendEmailTool = {
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

    const sendSmsTool = {
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

    const updateMicDistanceTool = {
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

    const endCallTool = {
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

    return [gptWebSearchTool, sendEmailTool, sendSmsTool, updateMicDistanceTool, endCallTool];
}

export async function executeToolCall({ name, args, context }) {
    const {
        openaiClient,
        twilioClient,
        senderTransport,
        env,
        normalizeUSNumberToE164,
        primaryCallersSet,
        secondaryCallersSet,
        currentCallerE164,
        currentTwilioNumberE164,
        webSearchInstructions,
        defaultUserLocation,
        micState,
        applyNoiseReduction,
        allowLiveSideEffects,
        onEndCall,
    } = context;

    if (name === 'gpt_web_search') {
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

    if (name === 'send_email') {
        if (!allowLiveSideEffects) {
            throw new Error('Live side effects disabled. Set ALLOW_LIVE_SIDE_EFFECTS=true to enable send_email.');
        }
        const subject = String(args?.subject || '').trim();
        const bodyHtml = String(args?.body_html || '').trim();
        if (!subject || !bodyHtml) throw new Error('Missing subject or body_html.');

        let group = null;
        if (currentCallerE164 && primaryCallersSet?.has(currentCallerE164)) group = 'primary';
        else if (currentCallerE164 && secondaryCallersSet?.has(currentCallerE164)) group = 'secondary';

        const fromEmail = env?.SENDER_FROM_EMAIL || null;
        const toEmail = group === 'primary'
            ? (env?.PRIMARY_TO_EMAIL || null)
            : (group === 'secondary' ? (env?.SECONDARY_TO_EMAIL || null) : null);

        if (!senderTransport || !fromEmail || !toEmail) {
            throw new Error('Email is not configured for this caller.');
        }

        const mailOptions = {
            from: fromEmail,
            to: toEmail,
            subject,
            html: bodyHtml,
            headers: {
                'X-From-Ai-Assistant': 'true'
            }
        };

        const info = await senderTransport.sendMail(mailOptions);
        return {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
        };
    }

    if (name === 'send_sms') {
        if (!allowLiveSideEffects) {
            throw new Error('Live side effects disabled. Set ALLOW_LIVE_SIDE_EFFECTS=true to enable send_sms.');
        }
        let bodyText = String(args?.body_text || '').trim();
        if (!bodyText) throw new Error('Missing body_text.');
        bodyText = bodyText.replace(/\s+/g, ' ').trim();

        if (!twilioClient) throw new Error('Twilio client unavailable.');
        const toNumber = currentCallerE164;
        const envFrom = normalizeUSNumberToE164?.(env?.TWILIO_SMS_FROM_NUMBER || '') || null;
        const fromNumber = currentTwilioNumberE164 || envFrom;
        if (!toNumber || !fromNumber) throw new Error('SMS is not configured: missing caller or from number.');

        const sendRes = await twilioClient.messages.create({
            from: fromNumber,
            to: toNumber,
            body: bodyText,
        });
        return {
            sid: sendRes?.sid,
            status: sendRes?.status,
            length: bodyText.length,
        };
    }

    if (name === 'update_mic_distance') {
        const requestedMode = String(args?.mode || '').trim();
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : undefined;
        const validModes = new Set(['near_field', 'far_field']);
        if (!validModes.has(requestedMode)) {
            throw new Error(`Invalid mode: ${requestedMode}. Expected near_field or far_field.`);
        }

        const now = Date.now();
        const withinDebounce = (now - (micState?.lastMicDistanceToggleTs || 0)) < 2000;
        const isNoOp = requestedMode === micState?.currentNoiseReductionType;

        if (withinDebounce || isNoOp) {
            if (isNoOp && micState) micState.skippedNoOp += 1;
            return {
                status: 'noop',
                applied: false,
                reason: withinDebounce ? 'debounced' : 'already-set',
                mode: requestedMode,
                current: micState?.currentNoiseReductionType,
                counters: micState
                    ? { farToggles: micState.farToggles, nearToggles: micState.nearToggles, skippedNoOp: micState.skippedNoOp }
                    : undefined
            };
        }

        applyNoiseReduction?.(requestedMode);
        if (micState) {
            micState.currentNoiseReductionType = requestedMode;
            micState.lastMicDistanceToggleTs = now;
            if (requestedMode === 'far_field') micState.farToggles += 1;
            else micState.nearToggles += 1;
        }

        return {
            status: 'ok',
            applied: true,
            mode: requestedMode,
            current: micState?.currentNoiseReductionType,
            reason,
            counters: micState
                ? { farToggles: micState.farToggles, nearToggles: micState.nearToggles, skippedNoOp: micState.skippedNoOp }
                : undefined
        };
    }

    if (name === 'end_call') {
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : undefined;
        if (onEndCall) return onEndCall({ reason });
        return { status: 'ok', reason };
    }

    throw new Error(`Unknown tool: ${name}`);
}
