import twilio from 'twilio';
import { getTimeGreeting, resolveCallerName } from '../utils/calls.js';
import {
    ALL_ALLOWED_CALLERS_SET,
    PRIMARY_CALLERS_SET,
    PRIMARY_USER_FIRST_NAME,
    SECONDARY_CALLERS_SET,
    SECONDARY_USER_FIRST_NAME,
    IS_DEV,
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
    const body = /** @type {Record<string, string>} */ (request.body || {});
    const fromRaw = body.From || body.from || body.Caller;
    const fromE164 = normalizeUSNumberToE164(fromRaw);
    const toRaw = body.To || body.to || '';
    const toE164 = normalizeUSNumberToE164(toRaw);
    console.log('Incoming call from:', fromRaw, '=>', fromE164);

    if (!fromE164 || !ALL_ALLOWED_CALLERS_SET.has(fromE164)) {
        const { VoiceResponse } = twilio.twiml;
        const denyTwiml = new VoiceResponse();
        denyTwiml.say(
            { voice: 'Google.en-US-Chirp3-HD-Charon' },
            'Sorry, this line is restricted. Goodbye.'
        );
        denyTwiml.hangup();
        if (IS_DEV) {
            console.log('denyTwiml:', denyTwiml.toString());
        }
        return reply.type('text/xml').send(denyTwiml.toString());
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

    const { VoiceResponse } = twilio.twiml;
    const twimlResponse = new VoiceResponse();
    twimlResponse.say(
        { voice: 'Google.en-US-Chirp3-HD-Charon' },
        `${timeGreeting} ${callerName}. Connecting to your AI assistant momentarily.`
    );
    const connect = twimlResponse.connect();
    const stream = connect.stream({
        url: `wss://${request.headers.host}/media-stream`,
    });
    stream.parameter({ name: 'caller_number', value: fromE164 });
    stream.parameter({ name: 'twilio_number', value: toE164 || '' });

    if (IS_DEV) {
        console.log('twimlResponse:', twimlResponse.toString());
    }
    reply.type('text/xml').send(twimlResponse.toString());
}
