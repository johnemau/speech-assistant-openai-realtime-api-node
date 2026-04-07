import crypto from 'node:crypto';
import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import { sendPageSms } from '../utils/page-sms.js';
import {
    placePageCall,
    isWithinCallingHours as defaultIsWithinCallingHours,
} from '../utils/page-call.js';

/**
 * Verify an HMAC-SHA256 signature against the raw request body.
 *
 * @param {string} apiKey - Secret key.
 * @param {Buffer} rawBody - Raw request body bytes.
 * @param {string} signature - Hex digest from the request header.
 * @returns {boolean} Whether the signature is valid.
 */
export function verifySignature(apiKey, rawBody, signature) {
    const expected = crypto
        .createHmac('sha256', apiKey)
        .update(rawBody)
        .digest('hex');
    if (expected.length !== signature.length) {
        return false;
    }
    return crypto.timingSafeEqual(
        Buffer.from(expected, 'utf8'),
        Buffer.from(signature, 'utf8')
    );
}

/**
 * Factory that creates a Skyvern webhook route handler with the given
 * per-route configuration.
 *
 * @param {object} config - Route configuration.
 * @param {string} config.routeName - Log prefix (e.g. 'reserve-study-room').
 * @param {string} config.eventPrefix - Event name prefix (e.g. 'reserve_study_room').
 * @param {string} config.noDataError - Error message when payload has no usable content.
 * @param {string} config.llmFailError - Error message when the LLM call fails.
 * @param {string} config.instructions - OpenAI system instructions.
 * @param {(content: string) => string} config.buildInput - Builds the LLM user input string.
 * @param {boolean} [config.withPageCall] - Whether to place a voice page call in addition to SMS.
 * @returns {{
 *   handler: (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>,
 *   setDeps: (overrides?: { isWithinCallingHoursFn?: typeof defaultIsWithinCallingHours }) => void,
 * }} Handler function and test-only dep override.
 */
export function createSkyvernWebhookHandler({
    routeName,
    eventPrefix,
    noDataError,
    llmFailError,
    instructions,
    buildInput,
    withPageCall = false,
}) {
    /** @type {{ isWithinCallingHoursFn: typeof defaultIsWithinCallingHours }} */
    const _deps = { isWithinCallingHoursFn: defaultIsWithinCallingHours };

    /**
     * Test-only override for internal dependencies.
     *
     * @param {{ isWithinCallingHoursFn?: typeof defaultIsWithinCallingHours }} overrides - Overrides.
     */
    function setDeps(overrides = {}) {
        if (overrides.isWithinCallingHoursFn !== undefined) {
            _deps.isWithinCallingHoursFn = overrides.isWithinCallingHoursFn;
        }
    }

    /**
     * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
     * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
     * @returns {Promise<void>}
     */
    async function handler(request, reply) {
        try {
            const apiKey = process.env.SKYVERN_API_KEY;
            if (!apiKey) {
                console.error(`${routeName}: SKYVERN_API_KEY env var not set`);
                return reply
                    .code(500)
                    .send({ error: 'Webhook endpoint not configured.' });
            }

            const signature =
                request.headers['x-skyvern-signature'] ||
                request.headers['X-Skyvern-Signature'];
            if (!signature || typeof signature !== 'string') {
                if (IS_DEV) {
                    console.log(
                        `${routeName}: missing x-skyvern-signature header`,
                        { event: `${eventPrefix}.unauthorized` }
                    );
                }
                return reply.code(401).send({ error: 'Unauthorized.' });
            }

            const rawBody = /** @type {any} */ (request).rawBody;
            if (!rawBody || !verifySignature(apiKey, rawBody, signature)) {
                if (IS_DEV) {
                    console.log(`${routeName}: invalid signature`, {
                        event: `${eventPrefix}.invalid_signature`,
                    });
                }
                return reply.code(401).send({ error: 'Unauthorized.' });
            }

            if (IS_DEV) {
                console.log(`${routeName}: incoming request`, {
                    event: `${eventPrefix}.request`,
                    method: request.method,
                    url: request.url,
                    body: request.body,
                });
            }

            const {
                output,
                failure_reason: failureReason,
                summary,
            } = /** @type {{ output?: object | null, failure_reason?: string | null, summary?: string | null }} */ (
                request.body || {}
            );

            const content =
                output != null
                    ? JSON.stringify(output)
                    : String(failureReason || summary || '').trim();

            if (!content) {
                if (IS_DEV) {
                    console.log(`${routeName}: no usable content in payload`, {
                        event: `${eventPrefix}.no_content`,
                    });
                }
                return reply.code(400).send({ error: noDataError });
            }

            // Compose message via LLM
            let aiResult;
            try {
                aiResult = await openaiClient.responses.create({
                    model: GPT_5_4_MODEL,
                    reasoning: { effort: 'xhigh' },
                    instructions,
                    input: buildInput(content),
                });
            } catch (e) {
                let detail = e?.message || String(e);
                if (!IS_DEV) {
                    detail = redactErrorDetail({
                        errorLike: e,
                        detail,
                        env: process.env,
                        secretKeys: REDACTION_KEYS,
                    });
                }
                console.error(`${routeName}: OpenAI error`, detail);
                return reply.code(500).send({ error: llmFailError });
            }

            const pageMessage = String(aiResult?.output_text || '').trim();
            if (!pageMessage) {
                console.error(`${routeName}: LLM returned empty message`);
                return reply
                    .code(500)
                    .send({ error: 'LLM returned no message.' });
            }

            if (IS_DEV) {
                console.log(`${routeName}: LLM message`, {
                    event: `${eventPrefix}.llm_result`,
                    pageMessage,
                });
            }

            const fromNumber =
                normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) ||
                '';
            if (!fromNumber) {
                console.error(
                    `${routeName}: TWILIO_SMS_FROM_NUMBER missing or invalid`
                );
                return reply.code(500).send({
                    error: 'Twilio from number not configured.',
                });
            }

            if (!twilioClient) {
                console.error(`${routeName}: Twilio client not initialized`);
                return reply
                    .code(500)
                    .send({ error: 'Twilio client not configured.' });
            }

            // Send SMS to all primary callers
            const smsResults = await sendPageSms({
                pageMessage,
                fromNumber,
                client: twilioClient,
            });
            console.info(`${routeName}: page SMS sent`, {
                event: `${eventPrefix}.sms_sent`,
                results: smsResults,
            });

            // Optionally place a voice page call
            let callResult = null;
            if (withPageCall) {
                const callingHours = await _deps.isWithinCallingHoursFn();
                if (callingHours.allowed) {
                    callResult = await placePageCall({
                        pageMessage,
                        fromNumber,
                        client: twilioClient,
                    });
                    console.info(`${routeName}: page call placed`, {
                        event: `${eventPrefix}.call_placed`,
                        result: callResult,
                    });
                } else {
                    console.info(
                        `${routeName}: page call skipped (outside calling hours)`,
                        {
                            event: `${eventPrefix}.call_skipped`,
                            hour: callingHours.hour,
                            timeZoneId: callingHours.timeZoneId,
                        }
                    );
                }
            }

            if (IS_DEV) {
                console.log(`${routeName}: complete`, {
                    event: `${eventPrefix}.success`,
                    pageMessage,
                    smsResults,
                    ...(withPageCall ? { callResult } : {}),
                });
            }

            return reply.send({
                message: pageMessage,
                sms_results: smsResults,
                ...(withPageCall ? { call_result: callResult } : {}),
            });
        } catch (e) {
            let detail = e?.message || String(e);
            if (!IS_DEV) {
                detail = redactErrorDetail({
                    errorLike: e,
                    detail,
                    env: process.env,
                    secretKeys: REDACTION_KEYS,
                });
            }
            console.error(`${routeName}: unexpected error`, detail);
            return reply.code(500).send({ error: 'Internal server error.' });
        }
    }

    return { handler, setDeps };
}
