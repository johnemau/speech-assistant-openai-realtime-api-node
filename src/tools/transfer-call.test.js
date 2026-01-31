import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const { execute } = await import('./transfer-call.js');

test('transfer-call.execute errors without Twilio client', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({ twilioClient: null });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { destination_number: '+12065550100' },
                    context: { currentCallSid: 'CA123' },
                }),
            /Twilio client unavailable/
        );
    } finally {
        init.setInitClients(prevClients);
    }
});

test('transfer-call.execute errors without CallSid', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({
        twilioClient: { calls: () => ({ update: async () => ({}) }) },
    });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { destination_number: '+12065550100' },
                    context: { currentCallSid: null },
                }),
            /Missing CallSid/
        );
    } finally {
        init.setInitClients(prevClients);
    }
});

test('transfer-call.execute validates destination_number', async () => {
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({
        twilioClient: { calls: () => ({ update: async () => ({}) }) },
    });
    try {
        await assert.rejects(
            () =>
                execute({
                    args: { destination_number: '   ' },
                    context: { currentCallSid: 'CA123' },
                }),
            /Missing destination_number/
        );
    } finally {
        init.setInitClients(prevClients);
    }
});

test('transfer-call.execute updates Twilio call with Dial TwiML', async () => {
    /** @type {{ sid: string, opts: { twiml: string } } | null} */
    let lastUpdate = null;
    const twilioClient = {
        calls: (/** @type {string} */ sid) => ({
            update: async (/** @type {{ twiml: string }} */ opts) => {
                lastUpdate = { sid, opts };
                return {};
            },
        }),
    };
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({ twilioClient });
    try {
        const res = await execute({
            args: { destination_number: '(206) 555-0100' },
            context: { currentCallSid: 'CA123' },
        });

        if (!lastUpdate) throw new Error('Missing update call');
        const update = /** @type {{ sid: string, opts: { twiml: string } }} */ (
            lastUpdate
        );
        assert.equal(update.sid, 'CA123');
        assert.equal(
            update.opts.twiml,
            '<Response><Dial>+12065550100</Dial></Response>'
        );
        assert.equal(res.destination_number, '+12065550100');
    } finally {
        init.setInitClients(prevClients);
    }
});
