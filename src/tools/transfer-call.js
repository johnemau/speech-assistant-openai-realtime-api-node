import { twilioClient } from '../init.js';
import { IS_DEV } from '../env.js';
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/**
 * Normalize transfer destination to E.164.
 * Accepts US 10-digit or 11-digit with leading 1, and full E.164 input.
 *
 * @param {string} input - Raw phone number input.
 * @returns {string | null} Normalized E.164 number or null.
 */
function normalizeTransferDestination(input) {
    const trimmed = String(input || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('+')) {
        const normalized = '+' + trimmed.replace(/[^0-9]/g, '');
        return E164_PATTERN.test(normalized) ? normalized : null;
    }
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
}

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
            destination_label: {
                type: 'string',
                description:
                    'Optional person or business name to announce before transferring (e.g., "Best Buy Redmond").',
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
 * @param {{ destination_number?: string, destination_label?: string }} root0.args - Tool arguments.
 * @param {{ currentCallSid?: string | null, onTransferCall?: (input: { destination_number: string, destination_label?: string }) => any }} root0.context - Tool context.
 * @returns {Promise<{ status: string, call_sid?: string, destination_number?: string, destination_label?: string }>} Transfer result.
 */
export async function execute({ args, context }) {
    const onTransferCall = context?.onTransferCall;
    if (!onTransferCall && !twilioClient)
        throw new Error('Twilio client unavailable.');
    const callSid = context?.currentCallSid;
    if (!callSid) throw new Error('Missing CallSid for transfer.');

    const rawDest = String(args?.destination_number || '').trim();
    if (!rawDest) throw new Error('Missing destination_number.');

    const destination = normalizeTransferDestination(rawDest);
    if (!destination) {
        throw new Error(`Invalid destination_number: "${rawDest}"`);
    }
    const destinationLabelRaw =
        typeof args?.destination_label === 'string'
            ? args.destination_label.trim()
            : '';
    const destinationLabel = destinationLabelRaw || undefined;

    if (onTransferCall) {
        if (IS_DEV) {
            console.log('transfer_call: deferring update', {
                callSid,
                destination,
                destinationLabel,
            });
        }
        return onTransferCall({
            destination_number: destination,
            destination_label: destinationLabel,
        });
    }

    const client = twilioClient;
    if (!client) throw new Error('Twilio client unavailable.');

    if (IS_DEV) {
        console.log('transfer_call: updating call', {
            callSid,
            destination,
        });
    }

    await client.calls(callSid).update({
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
        destination_label: destinationLabel,
    };
}
