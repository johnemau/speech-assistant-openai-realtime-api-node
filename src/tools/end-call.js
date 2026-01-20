import { endCallDefinition } from './definitions.js';

export const definition = endCallDefinition;

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
    const reason = typeof args?.reason === 'string' ? args.reason.trim() : undefined;
    if (onEndCall) return onEndCall({ reason });
    return { status: 'ok', reason };
}
