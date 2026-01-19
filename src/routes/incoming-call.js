import { getTimeGreeting, resolveCallerName } from '../utils/calls.js';
import {
    ALL_ALLOWED_CALLERS_SET,
    PRIMARY_CALLERS_SET,
    PRIMARY_USER_FIRST_NAME,
    SECONDARY_CALLERS_SET,
    SECONDARY_USER_FIRST_NAME,
} from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';

/**
 * @param {import('fastify').FastifyRequest} request - Incoming Twilio webhook request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function incomingCallHandler(request, reply) {
    // Route for Twilio to handle incoming calls
    // <Say> punctuation to improve text-to-speech translation
    const fromRaw = request.body?.From || request.body?.from || request.body?.Caller;
    const fromE164 = normalizeUSNumberToE164(fromRaw);
    const toRaw = request.body?.To || request.body?.to || '';
    const toE164 = normalizeUSNumberToE164(toRaw);
    console.log('Incoming call from:', fromRaw, '=>', fromE164);

        if (!fromE164 || !ALL_ALLOWED_CALLERS_SET.has(fromE164)) {
            const denyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Charon">Sorry, this line is restricted. Goodbye.</Say>
                              <Hangup/>
                          </Response>`;
            return reply.type('text/xml').send(denyTwiml);
        }

        const primaryName = String(PRIMARY_USER_FIRST_NAME || '').trim();
        const secondaryName = String(SECONDARY_USER_FIRST_NAME || '').trim();
        const callerName = resolveCallerName({
            callerE164: fromE164,
            primaryCallersSet: PRIMARY_CALLERS_SET,
            secondaryCallersSet: SECONDARY_CALLERS_SET,
            primaryName,
            secondaryName,
            fallbackName: 'legend',
        });

        const timeGreeting = getTimeGreeting({ timeZone: 'America/Los_Angeles' });

        const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say voice="Google.en-US-Chirp3-HD-Charon">${timeGreeting} ${callerName}. Connecting to your AI assistant momentarily.</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream">
                                      <Parameter name="caller_number" value="${fromE164}" />
                                      <Parameter name="twilio_number" value="${toE164 || ''}" />
                                  </Stream>
                              </Connect>
                          </Response>`;

    reply.type('text/xml').send(twimlResponse);
}
