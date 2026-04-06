import crypto from 'node:crypto';
import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { RESERVE_ROOM_INSTRUCTIONS } from '../assistant/prompts.js';
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
export function setReserveStudyRoomDeps(overrides = {}) {
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
 * POST /reserve-study-room handler.
 *
 * Verifies the Skyvern HMAC-SHA256 webhook signature, extracts the reservation
 * result from the payload, composes a message via the LLM, then sends an SMS
 * and places a voice call to the primary caller.
 *
 * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function reserveStudyRoomHandler(request, reply) {
    try {
        const apiKey = process.env.SKYVERN_API_KEY;
        if (!apiKey) {
            console.error(
                'reserve-study-room: SKYVERN_API_KEY env var not set'
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
                    'reserve-study-room: missing x-skyvern-signature header',
                    { event: 'reserve_study_room.unauthorized' }
                );
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        const rawBody = /** @type {any} */ (request).rawBody;
        if (!rawBody || !verifySignature(apiKey, rawBody, signature)) {
            if (IS_DEV) {
                console.log('reserve-study-room: invalid signature', {
                    event: 'reserve_study_room.invalid_signature',
                });
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        if (IS_DEV) {
            console.log('reserve-study-room: incoming request', {
                event: 'reserve_study_room.request',
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
                    'reserve-study-room: no usable content in payload',
                    { event: 'reserve_study_room.no_content' }
                );
            }
            return reply.code(400).send({
                error: 'No reservation data in payload.',
            });
        }

        // Compose a reservation result message via LLM
        let aiResult;
        try {
            aiResult = await openaiClient.responses.create({
                model: GPT_5_4_MODEL,
                reasoning: { effort: 'xhigh' },
                instructions: RESERVE_ROOM_INSTRUCTIONS,
                input: `Reservation result:\n${content}`,
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
            console.error('reserve-study-room: OpenAI error', detail);
            return reply
                .code(500)
                .send({ error: 'Failed to compose reservation message.' });
        }

        const pageMessage = String(aiResult?.output_text || '').trim();
        if (!pageMessage) {
            console.error('reserve-study-room: LLM returned empty message');
            return reply.code(500).send({ error: 'LLM returned no message.' });
        }

        if (IS_DEV) {
            console.log('reserve-study-room: LLM message', {
                event: 'reserve_study_room.llm_result',
                pageMessage,
            });
        }

        const fromNumber =
            normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) || '';
        if (!fromNumber) {
            console.error(
                'reserve-study-room: TWILIO_SMS_FROM_NUMBER missing or invalid'
            );
            return reply.code(500).send({
                error: 'Twilio from number not configured.',
            });
        }

        if (!twilioClient) {
            console.error('reserve-study-room: Twilio client not initialized');
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
        console.info('reserve-study-room: page SMS sent', {
            event: 'reserve_study_room.sms_sent',
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
            console.info('reserve-study-room: page call placed', {
                event: 'reserve_study_room.call_placed',
                result: callResult,
            });
        } else {
            console.info(
                'reserve-study-room: page call skipped (outside calling hours)',
                {
                    event: 'reserve_study_room.call_skipped',
                    hour: callingHours.hour,
                    timeZoneId: callingHours.timeZoneId,
                }
            );
        }

        if (IS_DEV) {
            console.log('reserve-study-room: complete', {
                event: 'reserve_study_room.success',
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
        console.error('reserve-study-room: unexpected error', detail);
        return reply.code(500).send({ error: 'Internal server error.' });
    }
}
