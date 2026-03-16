import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';
import {
    readPageCriteriaFile,
    buildPageEvaluationPrompt,
    parsePageEvaluation,
} from '../utils/email-page.js';
import { sendPageSms } from '../utils/page-sms.js';
import { placePageCall } from '../utils/page-call.js';

/**
 * POST /email-page handler.
 *
 * Accepts email content, validates a secret header, evaluates page-worthiness
 * via OpenAI, and pages the primary caller if warranted.
 *
 * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function emailPageHandler(request, reply) {
    try {
        const secret = process.env.EMAIL_PAGE_SECRET;
        if (!secret) {
            console.error('email-page: EMAIL_PAGE_SECRET env var not set');
            return reply
                .code(500)
                .send({ error: 'Page endpoint not configured.' });
        }

        // Validate secret header
        const headerSecret =
            request.headers['x-email-page-secret'] ||
            request.headers['X-Email-Page-Secret'];
        if (!headerSecret || headerSecret !== secret) {
            if (IS_DEV) {
                console.log('email-page: unauthorized request', {
                    event: 'email_page.unauthorized',
                });
            }
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        if (IS_DEV) {
            console.log('email-page: incoming request', {
                event: 'email_page.request',
                method: request.method,
                url: request.url,
                headers: request.headers,
                body: request.body,
            });
            console.log('email-page: request', request);
        }

        const rawBody = request.body;
        const bodyStr =
            typeof rawBody === 'object' && rawBody !== null
                ? /** @type {any} */ (rawBody).content || ''
                : rawBody || '';
        const emailContent = String(bodyStr).trim().replace(/\r\n/g, '\n');
        if (!emailContent) {
            if (IS_DEV) {
                console.log('email-page: missing email content', {
                    event: 'email_page.missing_content',
                });
            }
            return reply
                .code(400)
                .send({ error: 'Missing email content in body.' });
        }

        // Read page criteria
        let criteria;
        try {
            criteria = await readPageCriteriaFile();
        } catch (e) {
            if (IS_DEV) {
                console.log('email-page: criteria file read error detail', {
                    event: 'email_page.criteria_error',
                    error: e?.message,
                });
            }
            console.error(
                'email-page: failed to read criteria file',
                e?.message
            );
            return reply
                .code(500)
                .send({ error: 'Page criteria file not found.' });
        }

        // Evaluate page-worthiness via OpenAI
        const prompt = buildPageEvaluationPrompt({ emailContent, criteria });
        if (IS_DEV) {
            console.log('email-page: evaluating email', {
                event: 'email_page.evaluate',
                promptLen: prompt.length,
            });
        }

        let aiResult;
        try {
            aiResult = await openaiClient.responses.create({
                model: GPT_5_4_MODEL,
                instructions:
                    'You are a triage assistant. Respond ONLY with valid JSON.',
                input: prompt,
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
            console.error('email-page: OpenAI evaluation error', detail);
            return reply.code(500).send({ error: 'Failed to evaluate email.' });
        }

        const rawOutput = String(aiResult?.output_text || '').trim();

        if (IS_DEV) {
            console.log('email-page: AI evaluation result', {
                event: 'email_page.evaluation_result',
                rawOutput,
            });
        }

        // Parse the JSON from the model response
        let evaluation;
        try {
            evaluation = parsePageEvaluation(rawOutput);
        } catch {
            if (IS_DEV) {
                console.log('email-page: parse failure raw output', {
                    event: 'email_page.parse_error',
                    rawOutput,
                });
            }
            console.error('email-page: failed to parse AI response', rawOutput);
            return reply
                .code(500)
                .send({ error: 'Failed to parse evaluation result.' });
        }

        if (!evaluation.page_worthy) {
            console.info('email-page: email not page-worthy', {
                event: 'email_page.not_page_worthy',
            });
            return reply.send({ page_worthy: false });
        }

        const pageMessage = String(evaluation.page_message || '').trim();
        if (!pageMessage) {
            if (IS_DEV) {
                console.log('email-page: evaluation missing page_message', {
                    event: 'email_page.no_page_message',
                    evaluation,
                });
            }
            console.error('email-page: page_worthy but no page_message');
            return reply
                .code(500)
                .send({ error: 'Evaluation returned no page message.' });
        }

        // Determine the Twilio from number
        const fromNumber =
            normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) || '';
        if (!fromNumber) {
            if (IS_DEV) {
                console.log(
                    'email-page: TWILIO_SMS_FROM_NUMBER missing or invalid',
                    {
                        event: 'email_page.no_from_number',
                    }
                );
            }
            console.error('email-page: no Twilio from number configured');
            return reply.code(500).send({
                error: 'Twilio from number not configured.',
            });
        }

        if (!twilioClient) {
            if (IS_DEV) {
                console.log('email-page: Twilio client not initialized', {
                    event: 'email_page.no_twilio_client',
                });
            }
            console.error('email-page: Twilio client unavailable');
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
        console.info('email-page: page SMS sent', {
            event: 'email_page.sms_sent',
            results: smsResults,
        });

        // Call the first primary caller
        const callResult = await placePageCall({
            pageMessage,
            fromNumber,
            client: twilioClient,
        });
        console.info('email-page: page call placed', {
            event: 'email_page.call_placed',
            result: callResult,
        });

        if (IS_DEV) {
            console.log('email-page: page complete', {
                event: 'email_page.success',
                pageMessage,
                smsResults,
                callResult,
            });
        }

        return reply.send({
            page_worthy: true,
            page_message: pageMessage,
            sms_results: smsResults,
            call_result: callResult,
        });
    } catch (e) {
        if (IS_DEV) {
            console.log('email-page: unhandled error detail', {
                event: 'email_page.unhandled_error',
                error: e?.message || String(e),
                stack: e?.stack,
            });
        }
        console.error(
            `email-page: unhandled error: ${(e?.message || String(e)).slice(0, 220)}`
        );
        return reply.code(500).send({ error: 'Internal server error.' });
    }
}
