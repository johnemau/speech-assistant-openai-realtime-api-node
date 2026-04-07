import crypto from 'node:crypto';
import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { PLACE_HOLD_ON_BOOK_INSTRUCTIONS } from '../assistant/prompts.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import { sendPageSms } from '../utils/page-sms.js';

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
 * POST /place-hold-on-book handler.
 *
 * Verifies the Skyvern HMAC-SHA256 webhook signature, extracts the hold
 * result from the payload, composes a message via the LLM, then sends an SMS
 * to the primary caller(s).
 *
 * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function placeHoldOnBookHandler(request, reply) {
    try {
        const apiKey = process.env.SKYVERN_API_KEY;
        if (!apiKey) {
            console.error(
                'place-hold-on-book: SKYVERN_API_KEY env var not set'
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
                    'place-hold-on-book: missing x-skyvern-signature header',
                    { event: 'place_hold_on_book.unauthorized' }
                );
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        const rawBody = /** @type {any} */ (request).rawBody;
        if (!rawBody || !verifySignature(apiKey, rawBody, signature)) {
            if (IS_DEV) {
                console.log('place-hold-on-book: invalid signature', {
                    event: 'place_hold_on_book.invalid_signature',
                });
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        if (IS_DEV) {
            console.log('place-hold-on-book: incoming request', {
                event: 'place_hold_on_book.request',
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
                    'place-hold-on-book: no usable content in payload',
                    { event: 'place_hold_on_book.no_content' }
                );
            }
            return reply.code(400).send({
                error: 'No hold data in payload.',
            });
        }

        // Compose a hold result message via LLM
        let aiResult;
        try {
            aiResult = await openaiClient.responses.create({
                model: GPT_5_4_MODEL,
                reasoning: { effort: 'xhigh' },
                instructions: PLACE_HOLD_ON_BOOK_INSTRUCTIONS,
                input: `Hold result:\n${content}`,
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
            console.error('place-hold-on-book: OpenAI error', detail);
            return reply
                .code(500)
                .send({ error: 'Failed to compose hold message.' });
        }

        const pageMessage = String(aiResult?.output_text || '').trim();
        if (!pageMessage) {
            console.error('place-hold-on-book: LLM returned empty message');
            return reply.code(500).send({ error: 'LLM returned no message.' });
        }

        if (IS_DEV) {
            console.log('place-hold-on-book: LLM message', {
                event: 'place_hold_on_book.llm_result',
                pageMessage,
            });
        }

        const fromNumber =
            normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) || '';
        if (!fromNumber) {
            console.error(
                'place-hold-on-book: TWILIO_SMS_FROM_NUMBER missing or invalid'
            );
            return reply.code(500).send({
                error: 'Twilio from number not configured.',
            });
        }

        if (!twilioClient) {
            console.error('place-hold-on-book: Twilio client not initialized');
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
        console.info('place-hold-on-book: page SMS sent', {
            event: 'place_hold_on_book.sms_sent',
            results: smsResults,
        });

        if (IS_DEV) {
            console.log('place-hold-on-book: complete', {
                event: 'place_hold_on_book.success',
                pageMessage,
                smsResults,
            });
        }

        return reply.send({
            message: pageMessage,
            sms_results: smsResults,
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
        console.error('place-hold-on-book: unexpected error', detail);
        return reply.code(500).send({ error: 'Internal server error.' });
    }
}
