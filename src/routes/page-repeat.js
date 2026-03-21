import twilio from 'twilio';
import { buildPageCallTwiml } from '../utils/page-call.js';

/**
 * POST /page-repeat handler.
 *
 * Called by Twilio when the listener presses a key during the page call
 * Gather. Replays the page message using the `message` query parameter
 * and offers the option to press a key again.
 *
 * @param {import('fastify').FastifyRequest} request - Incoming HTTP request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function pageRepeatHandler(request, reply) {
    const message =
        /** @type {string | undefined} */ (
            /** @type {Record<string,string>} */ (request.query)?.message
        ) || '';

    if (!message) {
        const { VoiceResponse } = twilio.twiml;
        const response = new VoiceResponse();
        response.say('Page message unavailable. Goodbye.');
        reply.type('text/xml').send(response.toString());
        return;
    }

    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const host = request.headers.host || '';
    const baseUrl = host ? `${protocol}://${host}` : '';
    const repeatUrl = baseUrl
        ? `${baseUrl}/page-repeat?message=${encodeURIComponent(message)}`
        : undefined;

    const twiml = buildPageCallTwiml(message, { repeatUrl });
    reply.type('text/xml').send(twiml);
}
