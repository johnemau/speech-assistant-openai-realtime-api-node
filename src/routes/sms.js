import twilio from 'twilio';
import { SMS_REPLY_INSTRUCTIONS } from '../assistant/prompts.js';
import { openaiClient, twilioClient } from '../init.js';
import {
    buildSmsPrompt,
    buildSmsThreadText,
    extractSmsRequest,
    mergeAndSortMessages,
} from '../utils/sms.js';
import { IS_DEV, PRIMARY_CALLERS_SET, SECONDARY_CALLERS_SET } from '../env.js';
import {
    buildWebSearchTool,
    DEFAULT_SMS_USER_LOCATION,
    GPT_5_2_MODEL,
} from '../config/openai-models.js';
import { stringifyDeep } from '../utils/format.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import { safeParseToolArguments } from '../assistant/session.js';
import { executeToolCall } from '../tools/index.js';
import { definition as sendEmailDefinition } from '../tools/send-email.js';
import { definition as getCurrentLocationDefinition } from '../tools/get-current-location.js';
import { definition as findCurrentlyNearbyPlaceDefinition } from '../tools/find-currently-nearby-place.js';
import { definition as placesTextSearchDefinition } from '../tools/places-text-search.js';

/** @type {Array<import('openai/resources/responses/responses').Tool>} */
const SMS_TOOL_DEFINITIONS = [
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        sendEmailDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        getCurrentLocationDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        findCurrentlyNearbyPlaceDefinition
    ),
    /** @type {import('openai/resources/responses/responses').Tool} */ (
        placesTextSearchDefinition
    ),
];

const MAX_SMS_TOOL_ROUNDS = 6;

/**
 * Build tool config for SMS responses.
 * @returns {{ tools: Array<import('openai/resources/responses/responses').Tool>, tool_choice: 'auto' }} Tool config.
 */
function buildSmsToolConfig() {
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
    try {
        const output = await executeToolCall({
            name,
            args: parsedArgs,
            context,
        });
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
    const baseConfig = {
        model: GPT_5_2_MODEL,
        reasoning: { effort: /** @type {'high'} */ ('high') },
        truncation: 'auto',
        instructions,
        ...buildSmsToolConfig(),
    };

    let response = await openaiClient.responses.create({
        ...baseConfig,
        input,
    });

    let rounds = 0;
    while (rounds < MAX_SMS_TOOL_ROUNDS) {
        const toolCalls =
            response?.output?.filter(
                (item) => item?.type === 'function_call'
            ) || [];
        if (!toolCalls.length) return response;

        /** @type {Array<import('openai/resources/responses/responses').ResponseInputItem>} */
        const outputs = [];
        for (const toolCall of toolCalls) {
            const toolName = toolCall?.name;
            const callId = toolCall?.call_id;
            if (!toolName || !callId) continue;

            const toolResult = await executeSmsToolCallSafe({
                name: toolName,
                arguments: toolCall?.arguments,
                context,
            });

            outputs.push(
                /** @type {import('openai/resources/responses/responses').ResponseInputItem} */ ({
                    type: 'function_call_output',
                    call_id: callId,
                    output: JSON.stringify(toolResult),
                })
            );
        }

        response = await openaiClient.responses.create({
            ...baseConfig,
            previous_response_id: response?.id,
            input: outputs,
        });

        rounds += 1;
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

        // Allowlist check: only PRIMARY or SECONDARY callers may use SMS auto-reply
        const isAllowed =
            !!fromE164 &&
            (PRIMARY_CALLERS_SET.has(fromE164) ||
                SECONDARY_CALLERS_SET.has(fromE164));
        if (!isAllowed) {
            // Concise log for restricted access
            console.warn(
                `sms reply restricted (twiml): from=${fromE164 || ''} to=${toE164 || ''}`,
                {
                    event: 'sms.reply.restricted_twiml',
                    from: fromE164,
                    to: toE164,
                }
            );
            twiml.message('Sorry, this SMS line is restricted.');
            return reply.type('text/xml').send(twiml.toString());
        }

        if (!fromE164) {
            twiml.message('Sorry, this SMS line is restricted.');
            return reply.type('text/xml').send(twiml.toString());
        }

        const toNumber = toE164 || toRaw || '';
        if (!toNumber) {
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
        const smsPrompt = buildSmsPrompt({
            threadText,
            latestMessage: bodyRaw,
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
            `sms ai request: model=${GPT_5_2_MODEL} tools=web_search,places_text_search,find_currently_nearby_place,get_current_location,send_email promptLen=${String(smsPrompt || '').length}`,
            {
                event: 'sms.ai.request',
                model: GPT_5_2_MODEL,
                tools: [
                    'web_search',
                    'places_text_search',
                    'find_currently_nearby_place',
                    'get_current_location',
                    'send_email',
                ],
                prompt_len: String(smsPrompt || '').length,
            }
        );

        let aiText = '';
        try {
            const aiResult = await runSmsResponseWithTools({
                input: smsPrompt,
                instructions: SMS_REPLY_INSTRUCTIONS,
                context: { currentCallerE164: fromE164 },
            });
            aiText = String(aiResult?.output_text || '').trim();
        } catch (e) {
            console.error('OpenAI SMS reply error:', e?.message || e);
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
            twiml.message(fallbackMsg);
            return reply.type('text/xml').send(twiml.toString());
        }

        // Return empty TwiML to avoid duplicate auto-replies
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
        return reply.code(500).send('');
    }
}
