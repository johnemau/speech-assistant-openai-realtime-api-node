export const definition = {
    type: 'function',
    name: 'end_call',
    parameters: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description:
                    'Optional short phrase indicating why the caller wants to end.',
            },
        },
    },
    description:
        'Politely end the call. The server will close the Twilio media-stream and OpenAI WebSocket after the assistant says a brief goodbye.',
};

/**
 * Execute end_call tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {object} root0.args - Tool arguments.
 * @param {object} root0.context - Tool context.
 * @returns {Promise<{ status: string, reason?: string }>} Tool result.
 */
export async function execute({ args, context }) {
    const { onEndCall } = context;
    const reason =
        typeof args?.reason === 'string' ? args.reason.trim() : undefined;
    if (onEndCall) return onEndCall({ reason });
    return { status: 'ok', reason };
}
