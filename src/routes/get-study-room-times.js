import crypto from 'node:crypto';
import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import { sendPageSms } from '../utils/page-sms.js';
import { placePageCall, isWithinCallingHours } from '../utils/page-call.js';

/** @type {{ isWithinCallingHoursFn: typeof isWithinCallingHours }} */
const _deps = { isWithinCallingHoursFn: isWithinCallingHours };

/**
 * Test-only override for internal dependencies.
 *
 * @param {{ isWithinCallingHoursFn?: typeof isWithinCallingHours }} overrides - Overrides.
 */
export function setStudyRoomTimesDeps(overrides = {}) {
    if (overrides.isWithinCallingHoursFn !== undefined) {
        _deps.isWithinCallingHoursFn = overrides.isWithinCallingHoursFn;
    }
}

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
 * POST /get-study-room-times handler.
 *
 * Verifies the Skyvern HMAC-SHA256 webhook signature, extracts study room
 * availability from the payload, summarizes it via the LLM, then sends an
 * SMS and places a voice call to the primary caller.
 *
 * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function studyRoomTimesHandler(request, reply) {
    try {
        const apiKey = process.env.SKYVERN_API_KEY;
        if (!apiKey) {
            console.error(
                'get-study-room-times: SKYVERN_API_KEY env var not set'
            );
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
                    'get-study-room-times: missing x-skyvern-signature header',
                    { event: 'study_room_times.unauthorized' }
                );
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        const rawBody = /** @type {any} */ (request).rawBody;
        if (!rawBody || !verifySignature(apiKey, rawBody, signature)) {
            if (IS_DEV) {
                console.log('get-study-room-times: invalid signature', {
                    event: 'study_room_times.invalid_signature',
                });
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        if (IS_DEV) {
            console.log('get-study-room-times: incoming request', {
                event: 'study_room_times.request',
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
                console.log(
                    'get-study-room-times: no usable content in payload',
                    { event: 'study_room_times.no_content' }
                );
            }
            return reply.code(400).send({
                error: 'No study room data in payload.',
            });
        }

        // Summarize available rooms via LLM
        let aiResult;
        try {
            aiResult = await openaiClient.responses.create({
                model: GPT_5_4_MODEL,
                reasoning: { effort: 'xhigh' },
                instructions:
                    'You are a study room assistant. Summarize the available rooms concisely and in a phone-friendly way. Focus only on rooms with a capacity of at least 2.',
                input: `Study room data:\n${content}\n\nList the top most recent available rooms and times with a capacity of 2.`,
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
            console.error('get-study-room-times: OpenAI error', detail);
            return reply
                .code(500)
                .send({ error: 'Failed to summarize study room data.' });
        }

        const pageMessage = String(aiResult?.output_text || '').trim();
        if (!pageMessage) {
            console.error('get-study-room-times: LLM returned empty message');
            return reply.code(500).send({ error: 'LLM returned no message.' });
        }

        if (IS_DEV) {
            console.log('get-study-room-times: LLM message', {
                event: 'study_room_times.llm_result',
                pageMessage,
            });
        }

        const fromNumber =
            normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) || '';
        if (!fromNumber) {
            console.error(
                'get-study-room-times: TWILIO_SMS_FROM_NUMBER missing or invalid'
            );
            return reply.code(500).send({
                error: 'Twilio from number not configured.',
            });
        }

        if (!twilioClient) {
            console.error(
                'get-study-room-times: Twilio client not initialized'
            );
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
        console.info('get-study-room-times: page SMS sent', {
            event: 'study_room_times.sms_sent',
            results: smsResults,
        });

        // Call the first primary caller (only during calling hours)
        let callResult = null;
        const callingHours = await _deps.isWithinCallingHoursFn();
        if (callingHours.allowed) {
            callResult = await placePageCall({
                pageMessage,
                fromNumber,
                client: twilioClient,
            });
            console.info('get-study-room-times: page call placed', {
                event: 'study_room_times.call_placed',
                result: callResult,
            });
        } else {
            console.info(
                'get-study-room-times: page call skipped (outside calling hours)',
                {
                    event: 'study_room_times.call_skipped',
                    hour: callingHours.hour,
                    timeZoneId: callingHours.timeZoneId,
                }
            );
        }

        if (IS_DEV) {
            console.log('get-study-room-times: complete', {
                event: 'study_room_times.success',
                pageMessage,
                smsResults,
                callResult,
            });
        }

        return reply.send({
            message: pageMessage,
            sms_results: smsResults,
            call_result: callResult,
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
        console.error('get-study-room-times: unexpected error', detail);
        return reply.code(500).send({ error: 'Internal server error.' });
    }
}
