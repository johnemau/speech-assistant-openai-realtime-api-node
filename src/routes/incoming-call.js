import twilio from 'twilio';
import { ALL_ALLOWED_CALLERS_SET, IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';

/**
 * @param {import('fastify').FastifyRequest} request - Incoming Twilio webhook request.
 * @param {import('fastify').FastifyReply} reply - Fastify reply interface.
 * @returns {Promise<void>}
 */
export async function incomingCallHandler(request, reply) {
    const query = /** @type {Record<string, string>} */ (request.query || {});
    const body = /** @type {Record<string, string>} */ (request.body || {});

    // --- Standard inbound call path ---
    // Route for Twilio to handle incoming calls
    // <Say> punctuation to improve text-to-speech translation
    const fromRaw = body.From || body.from || body.Caller;
    const fromE164 = normalizeUSNumberToE164(fromRaw);
    const toRaw = body.To || body.to || '';
    const toE164 = normalizeUSNumberToE164(toRaw);
    const callSid = body.CallSid || body.callSid || '';

    // For page calls (outbound from server), Twilio calls our number as From
    // and the user's number as To. Use To as the effective caller for allowlist
    // and stream parameter so the assistant can personalize the greeting.
    const isPageCall = query.source === 'page';
    const callerE164 = isPageCall ? toE164 : fromE164;
    console.log('incoming-call: received', {
        from: fromRaw,
        fromE164,
        toE164,
        isPageCall,
    });

    if (!callerE164 || !ALL_ALLOWED_CALLERS_SET.has(callerE164)) {
        const { VoiceResponse } = twilio.twiml;
        const denyTwiml = new VoiceResponse();
        denyTwiml.say(
            { voice: 'Google.en-US-Chirp3-HD-Charon' },
            'Sorry, this line is restricted. Goodbye.'
        );
        denyTwiml.hangup();
        if (IS_DEV) {
            console.log('incoming-call: deny twiml', denyTwiml.toString());
        }
        return reply.type('text/xml').send(denyTwiml.toString());
    }

    const { VoiceResponse } = twilio.twiml;
    const twimlResponse = new VoiceResponse();
    const connect = twimlResponse.connect();
    const stream = connect.stream({
        url: `wss://${request.headers.host}/media-stream`,
    });
    stream.parameter({ name: 'caller_number', value: callerE164 });
    stream.parameter({
        name: 'twilio_number',
        value: isPageCall ? fromE164 || '' : toE164 || '',
    });
    stream.parameter({ name: 'call_sid', value: callSid || '' });
    if (isPageCall) {
        stream.parameter({ name: 'source', value: 'page' });
    }

    if (IS_DEV) {
        console.log('incoming-call: twiml response', twimlResponse.toString());
    }
    reply.type('text/xml').send(twimlResponse.toString());
}
