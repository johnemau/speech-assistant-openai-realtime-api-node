export const definition = {
    type: 'function',
    name: 'update_mic_distance',
    parameters: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['near_field', 'far_field'],
                description:
                    'Set input noise_reduction.type to near_field or far_field.',
            },
            reason: {
                type: 'string',
                description:
                    'Optional short note about why (e.g., caller phrase).',
            },
        },
        required: ['mode'],
    },
    description:
        'Toggle mic processing based on caller phrases: speakerphone-on → far_field; off-speakerphone → near_field. Debounce and avoid redundant toggles; one tool call per turn.',
};

/**
 * Execute update_mic_distance tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ mode?: string, reason?: string }} root0.args - Tool arguments.
 * @param {{ micState?: { currentNoiseReductionType?: string, lastMicDistanceToggleTs?: number, farToggles: number, nearToggles: number, skippedNoOp: number }, applyNoiseReduction?: (mode: 'near_field' | 'far_field') => void }} root0.context - Tool context.
 * @returns {Promise<{ status: string, applied: boolean, reason?: string, mode?: string, current?: string, counters?: { farToggles: number, nearToggles: number, skippedNoOp: number } }>} Update result.
 */
export async function execute({ args, context }) {
    const { micState, applyNoiseReduction } = context;
    const requestedMode = String(args?.mode || '').trim();
    const reason =
        typeof args?.reason === 'string' ? args.reason.trim() : undefined;
    const validModes = new Set(['near_field', 'far_field']);
    if (!validModes.has(requestedMode)) {
        throw new Error(
            `Invalid mode: ${requestedMode}. Expected near_field or far_field.`
        );
    }

    const now = Date.now();
    const withinDebounce =
        now - (micState?.lastMicDistanceToggleTs || 0) < 2000;
    const isNoOp = requestedMode === micState?.currentNoiseReductionType;

    if (withinDebounce || isNoOp) {
        if (isNoOp && micState) micState.skippedNoOp += 1;
        return {
            status: 'noop',
            applied: false,
            reason: withinDebounce ? 'debounced' : 'already-set',
            mode: requestedMode,
            current: micState?.currentNoiseReductionType,
            counters: micState
                ? {
                      farToggles: micState.farToggles,
                      nearToggles: micState.nearToggles,
                      skippedNoOp: micState.skippedNoOp,
                  }
                : undefined,
        };
    }

    /** @type {'near_field' | 'far_field'} */
    const normalizedMode =
        requestedMode === 'far_field' ? 'far_field' : 'near_field';
    applyNoiseReduction?.(normalizedMode);
    if (micState) {
        micState.currentNoiseReductionType = normalizedMode;
        micState.lastMicDistanceToggleTs = now;
        if (normalizedMode === 'far_field') micState.farToggles += 1;
        else micState.nearToggles += 1;
    }

    return {
        status: 'ok',
        applied: true,
        mode: normalizedMode,
        current: micState?.currentNoiseReductionType,
        reason,
        counters: micState
            ? {
                  farToggles: micState.farToggles,
                  nearToggles: micState.nearToggles,
                  skippedNoOp: micState.skippedNoOp,
              }
            : undefined,
    };
}
