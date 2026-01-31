import { twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
import { normalizeUSNumberToE164 } from '../utils/phone.js';

export const definition = {
    type: 'function',
    name: 'transfer_call',
    parameters: {
        type: 'object',
        properties: {
            destination_number: {
                type: 'string',
                description:
                    'E.164 phone number to transfer the caller to (e.g., +1-5-5-5-1-2-3-4-5-6-7).',
            },
        },
        required: ['destination_number'],
    },
    description:
        'Transfer the active call to a phone number by updating the live Twilio call with <Dial>.',
};

/**
 * Execute transfer_call tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ destination_number?: string }} root0.args - Tool arguments.
 * @param {{ currentCallSid?: string | null }} root0.context - Tool context.
 * @returns {Promise<{ status: string, call_sid?: string, destination_number?: string }>} Transfer result.
 */
export async function execute({ args, context }) {
    if (!twilioClient) throw new Error('Twilio client unavailable.');
    const callSid = context?.currentCallSid;
    if (!callSid) throw new Error('Missing CallSid for transfer.');

    const rawDest = String(args?.destination_number || '').trim();
    if (!rawDest) throw new Error('Missing destination_number.');

    const destination = normalizeUSNumberToE164(rawDest) || rawDest || null;
    if (!destination) throw new Error('Invalid destination_number.');

    if (IS_DEV) {
        console.log('transfer_call: updating call', {
            callSid,
            destination,
        });
    }

    await twilioClient.calls(callSid).update({
        twiml: `<Response><Dial>${destination}</Dial></Response>`,
    });

    if (IS_DEV) {
        console.log('transfer_call: update complete', {
            callSid,
            destination,
        });
    }

    return {
        status: 'ok',
        call_sid: callSid,
        destination_number: destination,
    };
}
