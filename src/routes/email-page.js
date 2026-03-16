import { readFile } from 'node:fs/promises';
import { openaiClient, twilioClient } from '../init.js';
import { IS_DEV, PRIMARY_CALLERS_SET } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';
import { GPT_5_4_MODEL } from '../config/openai-models.js';
import { REDACTION_KEYS, redactErrorDetail } from '../utils/redaction.js';

/**
 * Read the page criteria file from disk.
 *
 * @returns {Promise<string>} File contents.
 */
async function readPageCriteriaFile() {
    const filePath =
        process.env.EMAIL_PAGE_CRITERIA_FILE_PATH ||
        'data/email-page-criteria.md';
    return readFile(filePath, 'utf-8');
}

/**
 * Build the prompt to evaluate whether an email is page-worthy and compose a summary.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.emailContent - Raw email content from the POST body.
 * @param {string} root0.criteria - Page criteria text from the criteria file.
 * @returns {string} Prompt for the model.
 */
function buildPageEvaluationPrompt({ emailContent, criteria }) {
    return [
        'You are an email triage assistant. Your job is to determine whether the following email is "page worthy" and, if so, compose a concise page message.',
        '',
        '## Page Criteria (ordered by importance)',
        criteria,
        '',
        '## Email Content',
        emailContent,
        '',
        '## Instructions',
        '1. Evaluate the email against the criteria above.',
        '2. If the email does NOT meet the criteria, respond with exactly: {"page_worthy": false}',
        '3. If the email DOES meet the criteria, respond with a JSON object:',
        '   {"page_worthy": true, "page_message": "<concise summary of the email suitable for an urgent page, max 300 chars>"}',
        '4. Respond ONLY with the JSON object, no other text.',
    ].join('\n');
}

/**
 * Get all primary caller phone numbers as an array of E.164 strings.
 * Uses the live env var to support test overrides.
 *
 * @returns {string[]} Primary caller numbers.
 */
function getPrimaryCallerNumbers() {
    // Prefer live env for test flexibility
    const fromEnv = String(process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
        .map((v) => String(v));
    if (fromEnv.length) return fromEnv;
    return [...PRIMARY_CALLERS_SET];
}

/**
 * Send a page SMS to all primary caller numbers.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.pageMessage - The page message body.
 * @param {string} root0.fromNumber - Twilio number to send from.
 * @returns {Promise<Array<{ to: string, sid?: string, status?: string, error?: string }>>} Results.
 */
async function sendPageSms({ pageMessage, fromNumber }) {
    const numbers = getPrimaryCallerNumbers();
    const results = [];
    for (const toNumber of numbers) {
        try {
            const res = await /** @type {NonNullable<typeof twilioClient>} */ (
                twilioClient
            ).messages.create({
                from: fromNumber,
                to: toNumber,
                body: pageMessage,
            });
            results.push({
                to: toNumber,
                sid: res?.sid,
                status: res?.status,
            });
        } catch (e) {
            results.push({
                to: toNumber,
                error: e?.message || String(e),
            });
        }
    }
    return results;
}

/**
 * Place a voice call to the first primary caller number and read the page message.
 *
 * @param {object} root0 - Named parameters.
 * @param {string} root0.pageMessage - The page message to read.
 * @param {string} root0.fromNumber - Twilio number to call from.
 * @returns {Promise<{ to: string, sid?: string, status?: string, error?: string }>} Call result.
 */
async function placePageCall({ pageMessage, fromNumber }) {
    const numbers = getPrimaryCallerNumbers();
    const toNumber = numbers[0];
    if (!toNumber) {
        return { to: '', error: 'No primary caller numbers configured.' };
    }
    try {
        // Use TwiML to read the page message aloud, repeated twice for clarity, then hang up
        const twiml = [
            '<Response>',
            `<Say voice="Google.en-US-Chirp3-HD-Charon">Urgent page. ${pageMessage}</Say>`,
            '<Pause length="1"/>',
            `<Say voice="Google.en-US-Chirp3-HD-Charon">Repeating. ${pageMessage}</Say>`,
            '</Response>',
        ].join('');

        const call = await /** @type {NonNullable<typeof twilioClient>} */ (
            twilioClient
        ).calls.create({
            from: fromNumber,
            to: toNumber,
            twiml,
        });
        return { to: toNumber, sid: call?.sid, status: call?.status };
    } catch (e) {
        return { to: toNumber, error: e?.message || String(e) };
    }
}

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
            return reply.code(401).send({ error: 'Unauthorized.' });
        }

        const body = /** @type {Record<string, unknown>} */ (
            request.body || {}
        );
        const emailContent = String(body.content || '').trim();
        if (!emailContent) {
            return reply
                .code(400)
                .send({ error: 'Missing email content in body.' });
        }

        // Read page criteria
        let criteria;
        try {
            criteria = await readPageCriteriaFile();
        } catch (e) {
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
            // Strip markdown code fences if present
            const cleaned = rawOutput
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '');
            evaluation = JSON.parse(cleaned);
        } catch {
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
            console.error('email-page: page_worthy but no page_message');
            return reply
                .code(500)
                .send({ error: 'Evaluation returned no page message.' });
        }

        // Determine the Twilio from number
        const fromNumber =
            normalizeUSNumberToE164(process.env.TWILIO_SMS_FROM_NUMBER) || '';
        if (!fromNumber) {
            console.error('email-page: no Twilio from number configured');
            return reply.code(500).send({
                error: 'Twilio from number not configured.',
            });
        }

        if (!twilioClient) {
            console.error('email-page: Twilio client unavailable');
            return reply
                .code(500)
                .send({ error: 'Twilio client not configured.' });
        }

        // Send SMS to all primary callers
        const smsResults = await sendPageSms({ pageMessage, fromNumber });
        console.info('email-page: page SMS sent', {
            event: 'email_page.sms_sent',
            results: smsResults,
        });

        // Call the first primary caller
        const callResult = await placePageCall({ pageMessage, fromNumber });
        console.info('email-page: page call placed', {
            event: 'email_page.call_placed',
            result: callResult,
        });

        return reply.send({
            page_worthy: true,
            page_message: pageMessage,
            sms_results: smsResults,
            call_result: callResult,
        });
    } catch (e) {
        console.error(
            `email-page: unhandled error: ${(e?.message || String(e)).slice(0, 220)}`
        );
        return reply.code(500).send({ error: 'Internal server error.' });
    }
}
