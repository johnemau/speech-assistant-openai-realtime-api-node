import test from 'node:test';
import assert from 'node:assert/strict';

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';

const init = await import('../init.js');
const { execute } = await import('./transfer-call.js');

test('transfer-call.execute delegates to onTransferCall', async () => {
    const res = await execute({
        args: {
            destination_number: '(206) 555-0100',
            destination_label: 'Best Buy Redmond',
        },
        context: {
            currentCallSid: 'CA123',
            /**
             * @param {{ destination_number: string, destination_label?: string }} input - Transfer inputs.
             * @returns {{ status: string, call_sid: string, destination_number: string, destination_label?: string }} Transfer result.
             */
            onTransferCall: (input) => ({
                status: 'pending',
                call_sid: 'CA123',
                destination_number: input.destination_number,
                destination_label: input.destination_label,
            }),
        },
    });

    assert.equal(res.status, 'pending');
    assert.equal(res.destination_number, '+12065550100');
    assert.equal(res.destination_label, 'Best Buy Redmond');
});

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
        await assert.rejects(
            () =>
                execute({
                    args: { destination_number: '206-8609' },
                    context: { currentCallSid: 'CA123' },
                }),
            /Invalid destination_number/
        );
        await assert.rejects(
            () =>
                execute({
                    args: { destination_number: '+123' },
                    context: { currentCallSid: 'CA123' },
                }),
            /Invalid destination_number/
        );
    } finally {
        init.setInitClients(prevClients);
    }
});

test('transfer-call.execute accepts E.164 destination_number', async () => {
    const twilioClient = {
        calls: () => ({ update: async () => ({}) }),
    };
    const prevClients = { twilioClient: init.twilioClient };
    init.setInitClients({ twilioClient });
    try {
        const res = await execute({
            args: { destination_number: '+442079460958' },
            context: { currentCallSid: 'CA123' },
        });

        assert.equal(res.destination_number, '+442079460958');
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
