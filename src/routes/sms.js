import twilio from 'twilio';
import { SMS_REPLY_INSTRUCTIONS } from '../assistant/prompts.js';
import { openaiClient, twilioClient } from '../init.js';
import {
    buildSmsPrompt,
    buildSmsContextSection,
    buildSmsThreadText,
    extractSmsRequest,
    mergeAndSortMessages,
} from '../utils/sms.js';
import { IS_DEV, ALL_ALLOWED_CALLERS_SET } from '../env.js';
import {
    buildSmsResponseConfig,
    GPT_5_2_MODEL,
} from '../config/openai-models.js';
import { stringifyDeep } from '../utils/format.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import { safeParseToolArguments } from '../assistant/session.js';
import { executeToolCall } from '../tools/index.js';
import {
    appendSmsConsentRecord,
    getSmsConsentStatus,
    isStartKeyword,
    isStopKeyword,
    isHelpKeyword,
    normalizeSmsKeyword,
} from '../utils/sms-consent.js';

const MAX_SMS_TOOL_ROUNDS = 9;

/**
 * Execute a tool call safely for SMS.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.name - Tool name to execute.
 * @param {unknown} root0.arguments - Raw tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Caller context.
 * @returns {Promise<object>} Tool result payload.
 */
async function executeSmsToolCallSafe({ name, arguments: rawArgs, context }) {
    const parsedArgs = safeParseToolArguments(rawArgs);
    if (IS_DEV) {
        console.log('sms tool call: start', {
            name,
            args: parsedArgs,
            hasCaller: Boolean(context?.currentCallerE164),
            caller: context?.currentCallerE164,
        });
    }
    try {
        if (IS_DEV) {
            console.log('sms tool call: executing', {
                event: 'sms.tool_call.executing',
                name,
                argsKeys: Object.keys(parsedArgs || {}),
            });
        }

        const output = await executeToolCall({
            name,
            args: parsedArgs,
            context,
        });

        if (IS_DEV) {
            console.log('sms tool call: success', {
                name,
                output,
                outputType: typeof output,
                outputKeys:
                    output && typeof output === 'object'
                        ? Object.keys(output)
                        : [],
            });
        }
        return output || { status: 'ok' };
    } catch (e) {
        let detail = e?.message || stringifyDeep(e);
        if (!IS_DEV) {
            detail = redactErrorDetail({
                errorLike: e,
                detail,
                env: process.env,
                secretKeys: REDACTION_KEYS,
            });
        }
        if (IS_DEV) {
            console.log('sms tool call: error', {
                name,
                detail,
                errorStack: e?.stack,
                errorType: e?.constructor?.name,
            });
        }
        return {
            status: 'error',
            message: String(detail || '').slice(0, 220),
        };
    }
}

/**
 * Run SMS response with multi-step tool calls.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.input - Prompt input sent to the model.
 * @param {string} root0.instructions - System instructions for SMS.
 * @param {{ currentCallerE164?: string | null }} root0.context - Caller context.
 * @returns {Promise<import('openai/resources/responses/responses').Response>} Final response.
 */
async function runSmsResponseWithTools({ input, instructions, context }) {
    /** @type {import('openai/resources/responses/responses').ResponseCreateParamsNonStreaming} */
    const baseConfig = buildSmsResponseConfig({ instructions });

    if (IS_DEV) {
        console.log('sms response: start', {
            inputLength: input?.length || 0,
            hasCaller: Boolean(context?.currentCallerE164),
            model: baseConfig.model,
        });
    }

    let response = await openaiClient.responses.create({
        ...baseConfig,
        input,
    });

    if (IS_DEV) {
        console.log('sms response: initial response received', {
            event: 'sms.response.initial_received',
            responseId: response?.id,
            outputItemCount: response?.output?.length || 0,
            outputTypes: response?.output?.map((item) => item?.type) || [],
        });
    }

    let rounds = 0;
    while (rounds < MAX_SMS_TOOL_ROUNDS) {
        const toolCalls =
            response?.output?.filter(
                (item) => item?.type === 'function_call'
            ) || [];

        if (IS_DEV) {
            console.log('sms response: tool call evaluation', {
                event: 'sms.response.tool_call_check',
                round: rounds,
                toolCallCount: toolCalls.length,
                maxRounds: MAX_SMS_TOOL_ROUNDS,
            });
        }

        if (!toolCalls.length) {
            if (IS_DEV) {
                console.log('sms response: no tool calls, returning', {
                    event: 'sms.response.no_tool_calls',
                    round: rounds,
                    finalResponseId: response?.id,
                });
            }
            return response;
        }

        /** @type {Array<import('openai/resources/responses/responses').ResponseInputItem>} */
        const outputs = [];
        for (const toolCall of toolCalls) {
            const toolName = toolCall?.name;
            const callId = toolCall?.call_id;

            if (IS_DEV) {
                console.log('sms response: processing tool call', {
                    event: 'sms.response.tool_call_processing',
                    round: rounds,
                    toolName,
                    callId,
                });
            }

            if (!toolName || !callId) {
                if (IS_DEV) {
                    console.log('sms response: skipping invalid tool call', {
                        event: 'sms.response.tool_call_invalid',
                        round: rounds,
                        hasName: Boolean(toolName),
                        hasId: Boolean(callId),
                    });
                }
                continue;
            }

            const toolResult = await executeSmsToolCallSafe({
                name: toolName,
                arguments: toolCall?.arguments,
                context,
            });

            if (IS_DEV) {
                console.log('sms response: tool call executed', {
                    event: 'sms.response.tool_call_executed',
                    round: rounds,
                    toolName,
                    callId,
                    toolResult,
                });
            }

            outputs.push(
                /** @type {import('openai/resources/responses/responses').ResponseInputItem} */ ({
                    type: 'function_call_output',
                    call_id: callId,
                    output: JSON.stringify(toolResult),
                })
            );
        }

        if (IS_DEV) {
            console.log('sms response: creating continuation response', {
                event: 'sms.response.continuation_create',
                round: rounds,
                outputCount: outputs.length,
                previousResponseId: response?.id,
            });
        }

        response = await openaiClient.responses.create({
            ...baseConfig,
            previous_response_id: response?.id,
            input: outputs,
        });

        if (IS_DEV) {
            console.log('sms response: continuation response received', {
                event: 'sms.response.continuation_received',
                round: rounds,
                newResponseId: response?.id,
                outputItemCount: response?.output?.length || 0,
                outputTypes: response?.output?.map((item) => item?.type) || [],
            });
        }

        rounds += 1;
    }

    if (IS_DEV) {
        console.log('sms response: max rounds reached', {
            event: 'sms.response.max_rounds_reached',
            rounds: MAX_SMS_TOOL_ROUNDS,
            finalResponseId: response?.id,
        });
    }

    return response;
}

/**
 * @param {import('fastify').FastifyRequest} request - Incoming Twilio SMS webhook request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function smsHandler(request, reply) {
    try {
        // Note: Global console wrappers already scrub sensitive data in logs.
        // No additional per-call redaction wrapper needed in this route.

        const body = /** @type {Record<string, string>} */ (request.body || {});

        const { MessagingResponse } = twilio.twiml;
        const twiml = new MessagingResponse();

        const { bodyRaw, fromRaw, toRaw, fromE164, toE164 } = extractSmsRequest(
            {
                body,
                normalizeUSNumberToE164,
            }
        );
        const keyword = normalizeSmsKeyword(bodyRaw);

        // Concise incoming log
        console.info(
            `sms incoming: from=${fromE164 || fromRaw || ''} to=${toE164 || toRaw || ''} length=${String(bodyRaw || '').length}`,
            {
                event: 'sms.incoming',
                from: fromE164 || fromRaw || '',
                to: toE164 || toRaw || '',
                length: String(bodyRaw || '').length,
                preview: String(bodyRaw || '').slice(0, 160),
            }
        );

        if (!fromE164) {
            if (IS_DEV) {
                console.log('sms handler: early return - missing fromE164', {
                    event: 'sms.handler.return_missing_from',
                    fromRaw,
                    fromE164,
                });
            }
            twiml.message('Sorry, this SMS line is restricted.');
            return reply.type('text/xml').send(twiml.toString());
        }

        // Use env var if set, otherwise let the consent functions use their defaults
        const consentRecordsPath = process.env.SMS_CONSENT_RECORDS_FILE_PATH;
        const nowIso = new Date().toISOString();

        if (IS_DEV && consentRecordsPath) {
            console.log('sms handler: using custom consent records path', {
                event: 'sms.handler.consent_records_path',
                filePath: consentRecordsPath,
            });
        }

        if (isHelpKeyword(keyword)) {
            if (IS_DEV) {
                console.log('sms handler: early return - help keyword', {
                    event: 'sms.handler.return_help_keyword',
                    keyword,
                    from: fromE164,
                });
            }
            twiml.message(
                'Reply STOP to unsubscribe. Msg&Data Rates May Apply.'
            );
            return reply.type('text/xml').send(twiml.toString());
        }

        if (isStopKeyword(keyword)) {
            if (IS_DEV) {
                console.log('sms handler: processing STOP keyword', {
                    event: 'sms.handler.stop_keyword_start',
                    keyword,
                    from: fromE164,
                });
            }
            try {
                await appendSmsConsentRecord(
                    {
                        phoneNumber: fromE164,
                        keyword,
                        status: 'opted_out',
                        timestamp: nowIso,
                    },
                    consentRecordsPath
                );
                if (IS_DEV) {
                    console.log(
                        'sms handler: STOP consent recorded successfully',
                        {
                            event: 'sms.handler.stop_consent_recorded',
                            phoneNumber: fromE164,
                            status: 'opted_out',
                        }
                    );
                }
            } catch (err) {
                console.error('sms: error recording STOP consent', {
                    event: 'sms.consent.stop_error',
                    phoneNumber: fromE164,
                    errorMessage: err?.message,
                    errorCode: err?.code,
                });
                if (IS_DEV) {
                    console.log(
                        'sms handler: STOP consent error - re-throwing',
                        {
                            event: 'sms.handler.stop_consent_error_throw',
                            phoneNumber: fromE164,
                            errorMessage: err?.message,
                        }
                    );
                }
                throw err;
            }
            if (IS_DEV) {
                console.log('sms handler: returning STOP confirmation', {
                    event: 'sms.handler.return_stop_confirmation',
                    from: fromE164,
                });
            }
            twiml.message(
                'You have successfully been unsubscribed. You will not receive any more messages from this number. Reply START to resubscribe.'
            );
            return reply.type('text/xml').send(twiml.toString());
        }

        if (isStartKeyword(keyword)) {
            if (IS_DEV) {
                console.log('sms handler: processing START keyword', {
                    event: 'sms.handler.start_keyword_start',
                    keyword,
                    from: fromE164,
                });
            }
            try {
                await appendSmsConsentRecord(
                    {
                        phoneNumber: fromE164,
                        keyword,
                        status: 'confirmed',
                        timestamp: nowIso,
                    },
                    consentRecordsPath
                );
                if (IS_DEV) {
                    console.log(
                        'sms handler: START consent recorded successfully',
                        {
                            event: 'sms.handler.start_consent_recorded',
                            phoneNumber: fromE164,
                            status: 'confirmed',
                        }
                    );
                }
            } catch (err) {
                console.error('sms: error recording START consent', {
                    event: 'sms.consent.start_error',
                    phoneNumber: fromE164,
                    errorMessage: err?.message,
                    errorCode: err?.code,
                });
                if (IS_DEV) {
                    console.log(
                        'sms handler: START consent error - re-throwing',
                        {
                            event: 'sms.handler.start_consent_error_throw',
                            phoneNumber: fromE164,
                            errorMessage: err?.message,
                        }
                    );
                }
                throw err;
            }
            if (IS_DEV) {
                console.log('sms handler: returning START confirmation', {
                    event: 'sms.handler.return_start_confirmation',
                    from: fromE164,
                });
            }
            twiml.message(
                'You have successfully been re-subscribed to messages from this number. Reply HELP for help. Reply STOP to unsubscribe. Msg&Data Rates May Apply.'
            );
            return reply.type('text/xml').send(twiml.toString());
        }

        const consentStatus = await getSmsConsentStatus(
            fromE164,
            consentRecordsPath
        );

        if (IS_DEV) {
            console.log('sms handler: consent status checked', {
                event: 'sms.handler.consent_status_checked',
                from: fromE164,
                consentStatus,
            });
        }

        if (consentStatus !== 'confirmed') {
            if (IS_DEV) {
                console.log('sms handler: early return - not enrolled', {
                    event: 'sms.handler.return_not_enrolled',
                    from: fromE164,
                    consentStatus,
                });
            }
            twiml.message(
                'You are not enrolled yet. Reply START to subscribe. Reply HELP for help.'
            );
            return reply.type('text/xml').send(twiml.toString());
        }

        // Check if caller is on allowlist
        if (!ALL_ALLOWED_CALLERS_SET.has(fromE164)) {
            if (IS_DEV) {
                console.log(
                    'sms handler: early return - caller not allowlisted',
                    {
                        event: 'sms.handler.return_caller_not_allowlisted',
                        from: fromE164,
                        allowlistSize: ALL_ALLOWED_CALLERS_SET.size,
                    }
                );
            }
            twiml.message(
                'Sorry, this SMS line is restricted to approved users. Contact support for access.'
            );
            return reply.type('text/xml').send(twiml.toString());
        }

        const toNumber = toE164 || toRaw || '';
        if (!toNumber) {
            if (IS_DEV) {
                console.log('sms handler: early return - missing toNumber', {
                    event: 'sms.handler.return_missing_to',
                    toE164,
                    toRaw,
                });
            }
            twiml.message('SMS auto-reply is not configured.');
            return reply.type('text/xml').send(twiml.toString());
        }

        if (!twilioClient) {
            // Concise log for missing Twilio client
            console.warn(
                `sms reply unconfigured (twiml): from=${toE164 || ''} to=${fromE164 || ''}`,
                {
                    event: 'sms.reply.unconfigured_twiml',
                    from: toE164,
                    to: fromE164,
                }
            );
            if (IS_DEV) {
                console.log(
                    'sms handler: early return - missing twilioClient',
                    {
                        event: 'sms.handler.return_missing_twilio_client',
                        from: toE164,
                        to: fromE164,
                    }
                );
            }
            twiml.message('SMS auto-reply is not configured.');
            return reply.type('text/xml').send(twiml.toString());
        }

        // Build a recent thread: last 12 hours, up to 10 combined messages (inbound/outbound)
        const now = new Date();
        const startWindow = new Date(now.getTime() - 12 * 60 * 60 * 1000);

        /** @type {Array<any>} */
        let inbound = [];
        /** @type {Array<any>} */
        let outbound = [];
        try {
            // Inbound: from caller → our Twilio number
            // Log Twilio API request details
            console.info(
                `twilio messages list request (inbound): from=${fromE164 || ''} to=${toE164 || ''} after=${startWindow.toISOString()} limit=20`,
                {
                    event: 'twilio.messages.list.request',
                    direction: 'inbound',
                    params: {
                        dateSentAfter: startWindow.toISOString(),
                        from: fromE164,
                        to: toNumber,
                        limit: 20,
                    },
                }
            );
            inbound = await twilioClient.messages.list({
                dateSentAfter: startWindow,
                from: fromE164,
                to: toNumber,
                limit: 20,
            });
        } catch (e) {
            console.warn('Failed to list inbound messages:', e?.message || e);
        }
        try {
            // Outbound: from our Twilio number → caller
            // Log Twilio API request details
            console.info(
                `twilio messages list request (outbound): from=${toE164 || ''} to=${fromE164 || ''} after=${startWindow.toISOString()} limit=20`,
                {
                    event: 'twilio.messages.list.request',
                    direction: 'outbound',
                    params: {
                        dateSentAfter: startWindow.toISOString(),
                        from: toNumber,
                        to: fromE164,
                        limit: 20,
                    },
                }
            );
            outbound = await twilioClient.messages.list({
                dateSentAfter: startWindow,
                from: toNumber,
                to: fromE164,
                limit: 20,
            });
        } catch (e) {
            console.warn('Failed to list outbound messages:', e?.message || e);
        }

        const combined = mergeAndSortMessages(inbound, outbound);
        const threadText = buildSmsThreadText({
            messages: combined,
            fromE164,
            limit: 10,
        });
        const contextSection = await buildSmsContextSection({
            callerE164: fromE164,
        });
        const smsPrompt = buildSmsPrompt({
            threadText,
            latestMessage: bodyRaw,
            contextSection,
        });

        // Dev-only: log the full SMS prompt for debugging
        if (IS_DEV) {
            console.log('sms prompt debug', {
                event: 'sms.prompt.debug',
                prompt: smsPrompt,
            });
        }

        // Concise log of AI request (dev-friendly, but short)
        console.info(
            `sms ai request: model=${GPT_5_2_MODEL} tools=web_search,places_text_search,find_currently_nearby_place,get_current_location,send_email,directions promptLen=${String(smsPrompt || '').length}`,
            {
                event: 'sms.ai.request',
                model: GPT_5_2_MODEL,
                tools: [
                    'web_search',
                    'places_text_search',
                    'find_currently_nearby_place',
                    'get_current_location',
                    'send_email',
                    'directions',
                    'weather',
                ],
                prompt_len: String(smsPrompt || '').length,
            }
        );

        let aiText = '';
        try {
            if (IS_DEV) {
                console.log('sms handler: calling AI response with tools', {
                    event: 'sms.handler.ai_call_start',
                    from: fromE164,
                    promptLen: String(smsPrompt || '').length,
                });
            }
            const aiResult = await runSmsResponseWithTools({
                input: smsPrompt,
                instructions: SMS_REPLY_INSTRUCTIONS,
                context: { currentCallerE164: fromE164 },
            });
            aiText = String(aiResult?.output_text || '').trim();
            if (IS_DEV) {
                console.log('sms handler: AI response received', {
                    event: 'sms.handler.ai_response_success',
                    from: fromE164,
                    aiTextLen: String(aiText).length,
                    aiPreview: String(aiText).slice(0, 160),
                });
            }
        } catch (e) {
            console.error('OpenAI SMS reply error:', e?.message || e);
            if (IS_DEV) {
                console.log('sms handler: AI response error caught', {
                    event: 'sms.handler.ai_response_error',
                    from: fromE164,
                    errorType: e?.constructor?.name,
                    errorMessage: e?.message,
                    errorStack: e?.stack,
                });
            }
            let detail = e?.message || stringifyDeep(e);
            if (!IS_DEV) {
                detail = redactErrorDetail({
                    errorLike: e,
                    detail,
                    env: process.env,
                    secretKeys: REDACTION_KEYS,
                });
            }
            // Structured error log (redacted unless development)
            console.error(
                `sms reply AI error: from=${fromE164 || ''} to=${toE164 || ''} error=${String(detail || '').slice(0, 220)}`,
                {
                    event: 'sms.reply.ai_error',
                    from: fromE164,
                    to: toE164,
                    error: String(detail || '').slice(0, 220),
                }
            );
            aiText = `Sorry—SMS reply error. Details: ${String(detail || '').slice(0, 220)}.`;
        }

        // Send the reply via Twilio API (from the same Twilio number the webhook hit)
        try {
            if (IS_DEV) {
                console.log('sms handler: sending Twilio SMS', {
                    event: 'sms.handler.twilio_send_start',
                    from: toNumber,
                    to: fromE164,
                    aiTextLen: String(aiText || '').length,
                    aiPreview: String(aiText || '').slice(0, 160),
                });
            }
            // Log Twilio API request details for SMS send
            console.info(
                `twilio messages create request: from=${toE164 || ''} to=${fromE164 || ''} length=${String(aiText || '').length}`,
                {
                    event: 'twilio.messages.create.request',
                    params: {
                        from: toNumber,
                        to: fromE164,
                        length: String(aiText || '').length,
                        preview: String(aiText || '').slice(0, 160),
                    },
                }
            );
            const sendRes = await twilioClient.messages.create({
                from: toNumber,
                to: fromE164,
                body: aiText,
            });
            if (IS_DEV) {
                console.log('sms handler: Twilio SMS sent successfully', {
                    event: 'sms.handler.twilio_send_success',
                    sid: sendRes?.sid,
                    from: toNumber,
                    to: fromE164,
                });
            }
            // Always log SMS sends (with redaction unless development)
            const preview = String(aiText || '').slice(0, 160);
            console.info(
                `sms reply sent: sid=${sendRes?.sid || ''} from=${toE164 || ''} to=${fromE164 || ''} length=${String(aiText || '').length}`,
                {
                    event: 'sms.reply.sent',
                    sid: sendRes?.sid,
                    from: toNumber,
                    to: fromE164,
                    length: String(aiText || '').length,
                    preview,
                }
            );
        } catch (e) {
            console.error('Failed to send Twilio SMS:', e?.message || e);
            if (IS_DEV) {
                console.log('sms handler: Twilio SMS send error caught', {
                    event: 'sms.handler.twilio_send_error',
                    from: toNumber,
                    to: fromE164,
                    errorType: e?.constructor?.name,
                    errorMessage: e?.message,
                    errorStack: e?.stack,
                });
            }
            // Fallback: reply via TwiML with redacted error details to ensure the user gets context
            let detail = e?.message || stringifyDeep(e);
            if (!IS_DEV) {
                detail = redactErrorDetail({
                    errorLike: e,
                    detail,
                    env: process.env,
                    secretKeys: REDACTION_KEYS,
                });
            }
            // Structured error log (redacted unless development)
            console.error(
                `sms reply send error: from=${toE164 || ''} to=${fromE164 || ''} error=${String(detail || '').slice(0, 220)}`,
                {
                    event: 'sms.reply.send_error',
                    from: toE164,
                    to: fromE164,
                    error: String(detail || '').slice(0, 220),
                }
            );
            const fallbackMsg = `Sorry—SMS send error. Details: ${String(detail || '').slice(0, 220)}.`;
            // Log fallback TwiML generation
            console.warn(
                `sms reply fallback twiml: from=${toE164 || ''} to=${fromE164 || ''} preview=${String(fallbackMsg).slice(0, 160)}`,
                {
                    event: 'sms.reply.fallback_twiml',
                    from: toE164,
                    to: fromE164,
                    preview: String(fallbackMsg).slice(0, 160),
                }
            );
            if (IS_DEV) {
                console.log('sms handler: returning fallback TwiML error', {
                    event: 'sms.handler.return_fallback_twiml',
                    from: toE164,
                    to: fromE164,
                    fallbackPreview: String(fallbackMsg).slice(0, 160),
                });
            }
            twiml.message(fallbackMsg);
            return reply.type('text/xml').send(twiml.toString());
        }

        // Return empty TwiML to avoid duplicate auto-replies
        if (IS_DEV) {
            console.log('sms handler: successful completion', {
                event: 'sms.handler.return_success',
                from: toE164,
                to: fromE164,
                aiTextLen: String(aiText || '').length,
            });
        }
        console.info(
            `sms webhook completed: from=${toE164 || ''} to=${fromE164 || ''}`,
            { event: 'sms.webhook.completed', from: toE164, to: fromE164 }
        );
        return reply.type('text/xml').send(twiml.toString());
    } catch (e) {
        // Concise structured unhandled error
        console.error(
            `sms webhook unhandled error: ${(e?.message || String(e || '')).slice(0, 220)}`,
            {
                event: 'sms.webhook.unhandled_error',
                error: (e?.message || String(e || '')).slice(0, 220),
            }
        );
        if (IS_DEV) {
            console.log('sms handler: unhandled error caught at top level', {
                event: 'sms.handler.unhandled_error',
                errorType: e?.constructor?.name,
                errorMessage: e?.message,
                errorStack: e?.stack,
            });
        }
        return reply.code(500).send('');
    }
}
