import twilio from 'twilio';
import { SMS_REPLY_INSTRUCTIONS } from '../assistant/prompts.js';
import { openaiClient, twilioClient } from '../init.js';
import {
    buildSmsPrompt,
    buildSmsThreadText,
    extractSmsRequest,
    mergeAndSortMessages,
} from '../utils/sms.js';
import {
    DEFAULT_SMS_USER_LOCATION,
    IS_DEV,
    PRIMARY_CALLERS_SET,
    SECONDARY_CALLERS_SET,
} from '../env.js';
import { stringifyDeep } from '../utils/format.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';

/**
 * @param {import('fastify').FastifyRequest} request - Incoming Twilio SMS webhook request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function smsHandler(request, reply) {
    try {
        // Note: Global console wrappers already scrub sensitive data in logs.
        // No additional per-call redaction wrapper needed in this route.

            const { MessagingResponse } = twilio.twiml;
            const twiml = new MessagingResponse();

            const { bodyRaw, fromRaw, toRaw, fromE164, toE164 } = extractSmsRequest({
                body: request.body,
                normalizeUSNumberToE164,
            });

            // Concise incoming log
            console.info({
                event: 'sms.incoming',
                from: fromE164 || fromRaw || '',
                to: toE164 || toRaw || '',
                length: String(bodyRaw || '').length,
                preview: String(bodyRaw || '').slice(0, 160)
            });

            // Allowlist check: only PRIMARY or SECONDARY callers may use SMS auto-reply
            const isAllowed = !!fromE164 && (PRIMARY_CALLERS_SET.has(fromE164) || SECONDARY_CALLERS_SET.has(fromE164));
            if (!isAllowed) {
                // Concise log for restricted access
                console.warn({
                    event: 'sms.reply.restricted_twiml',
                    from: fromE164,
                    to: toE164
                });
                twiml.message('Sorry, this SMS line is restricted.');
                return reply.type('text/xml').send(twiml.toString());
            }

            if (!twilioClient) {
                // Concise log for missing Twilio client
                console.warn({
                    event: 'sms.reply.unconfigured_twiml',
                    from: toE164,
                    to: fromE164
                });
                twiml.message('SMS auto-reply is not configured.');
                return reply.type('text/xml').send(twiml.toString());
            }

            // Build a recent thread: last 12 hours, up to 10 combined messages (inbound/outbound)
            const now = new Date();
            const startWindow = new Date(now.getTime() - 12 * 60 * 60 * 1000);

            let inbound = [];
            let outbound = [];
            try {
                // Inbound: from caller → our Twilio number
                // Log Twilio API request details
                console.info({
                    event: 'twilio.messages.list.request',
                    direction: 'inbound',
                    params: {
                        dateSentAfter: startWindow.toISOString(),
                        from: fromE164,
                        to: toE164,
                        limit: 20,
                    }
                });
                inbound = await twilioClient.messages.list({
                    dateSentAfter: startWindow,
                    from: fromE164,
                    to: toE164,
                    limit: 20,
                });
            } catch (e) {
                console.warn('Failed to list inbound messages:', e?.message || e);
            }
            try {
                // Outbound: from our Twilio number → caller
                // Log Twilio API request details
                console.info({
                    event: 'twilio.messages.list.request',
                    direction: 'outbound',
                    params: {
                        dateSentAfter: startWindow.toISOString(),
                        from: toE164,
                        to: fromE164,
                        limit: 20,
                    }
                });
                outbound = await twilioClient.messages.list({
                    dateSentAfter: startWindow,
                    from: toE164,
                    to: fromE164,
                    limit: 20,
                });
            } catch (e) {
                console.warn('Failed to list outbound messages:', e?.message || e);
            }

            const combined = mergeAndSortMessages(inbound, outbound);
            const threadText = buildSmsThreadText({ messages: combined, fromE164, limit: 10 });
            const smsPrompt = buildSmsPrompt({ threadText, latestMessage: bodyRaw });

            // Dev-only: log the full SMS prompt for debugging
            if (IS_DEV) {
                console.log({
                    event: 'sms.prompt.debug',
                    prompt: smsPrompt
                });
            }

            // Prepare OpenAI request with web_search tool
            const reqPayload = {
                model: 'gpt-5.2',
                reasoning: { effort: 'high' },
                tools: [{
                    type: 'web_search',
                    user_location: DEFAULT_SMS_USER_LOCATION,
                }],
                instructions: SMS_REPLY_INSTRUCTIONS,
                input: smsPrompt,
                tool_choice: 'required',
                truncation: 'auto',
            };

            // Concise log of AI request (dev-friendly, but short)
            console.info({
                event: 'sms.ai.request',
                model: 'gpt-5.2',
                tools: ['web_search'],
                prompt_len: String(smsPrompt || '').length
            });

            let aiText = '';
            try {
                const aiResult = await openaiClient.responses.create(reqPayload);
                aiText = String(aiResult?.output_text || '').trim();
            } catch (e) {
                console.error('OpenAI SMS reply error:', e?.message || e);
                let detail = e?.message || stringifyDeep(e);
                if (!IS_DEV) {
                    detail = redactErrorDetail({
                        errorLike: e,
                        detail,
                        env: process.env,
                        secretKeys: REDACTION_KEYS
                    });
                }
                // Structured error log (redacted unless development)
                console.error({
                    event: 'sms.reply.ai_error',
                    from: fromE164,
                    to: toE164,
                    error: String(detail || '').slice(0, 220)
                });
                aiText = `Sorry—SMS reply error. Details: ${String(detail || '').slice(0, 220)}.`;
            }

            // Send the reply via Twilio API (from the same Twilio number the webhook hit)
            try {
                // Log Twilio API request details for SMS send
                console.info({
                    event: 'twilio.messages.create.request',
                    params: {
                        from: toE164,
                        to: fromE164,
                        length: String(aiText || '').length,
                        preview: String(aiText || '').slice(0, 160),
                    }
                });
                const sendRes = await twilioClient.messages.create({
                    from: toE164,
                    to: fromE164,
                    body: aiText,
                });
                // Always log SMS sends (with redaction unless development)
                const preview = String(aiText || '').slice(0, 160);
                console.info({
                    event: 'sms.reply.sent',
                    sid: sendRes?.sid,
                    from: toE164,
                    to: fromE164,
                    length: String(aiText || '').length,
                    preview,
                });
            } catch (e) {
                console.error('Failed to send Twilio SMS:', e?.message || e);
                // Fallback: reply via TwiML with redacted error details to ensure the user gets context
                let detail = e?.message || stringifyDeep(e);
                if (!IS_DEV) {
                    detail = redactErrorDetail({
                        errorLike: e,
                        detail,
                        env: process.env,
                        secretKeys: REDACTION_KEYS
                    });
                }
                // Structured error log (redacted unless development)
                console.error({
                    event: 'sms.reply.send_error',
                    from: toE164,
                    to: fromE164,
                    error: String(detail || '').slice(0, 220)
                });
                const fallbackMsg = `Sorry—SMS send error. Details: ${String(detail || '').slice(0, 220)}.`;
                // Log fallback TwiML generation
                console.warn({
                    event: 'sms.reply.fallback_twiml',
                    from: toE164,
                    to: fromE164,
                    preview: String(fallbackMsg).slice(0, 160)
                });
                twiml.message(fallbackMsg);
                return reply.type('text/xml').send(twiml.toString());
            }

            // Return empty TwiML to avoid duplicate auto-replies
            console.info({
                event: 'sms.webhook.completed',
                from: toE164,
                to: fromE164
            });
            return reply.type('text/xml').send(twiml.toString());
        } catch (e) {
            // Concise structured unhandled error
            console.error({
                event: 'sms.webhook.unhandled_error',
                error: (e?.message || String(e || '')).slice(0, 220)
            });
        return reply.code(500).send('');
    }
}
