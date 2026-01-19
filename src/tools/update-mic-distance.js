export const definition = {
    type: 'function',
    name: 'update_mic_distance',
    parameters: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['near_field', 'far_field'],
                description: 'Set input noise_reduction.type to near_field or far_field.'
            },
            reason: {
                type: 'string',
                description: 'Optional short note about why (e.g., caller phrase).'
            }
        },
        required: ['mode']
    },
    description: 'Toggle mic processing based on caller phrases: speakerphone-on → far_field; off-speakerphone → near_field. Debounce and avoid redundant toggles; one tool call per turn.'
};

export async function execute({ args, context }) {
    const { micState, applyNoiseReduction } = context;
    const requestedMode = String(args?.mode || '').trim();
    const reason = typeof args?.reason === 'string' ? args.reason.trim() : undefined;
    const validModes = new Set(['near_field', 'far_field']);
    if (!validModes.has(requestedMode)) {
        throw new Error(`Invalid mode: ${requestedMode}. Expected near_field or far_field.`);
    }

    const now = Date.now();
    const withinDebounce = (now - (micState?.lastMicDistanceToggleTs || 0)) < 2000;
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
                ? { farToggles: micState.farToggles, nearToggles: micState.nearToggles, skippedNoOp: micState.skippedNoOp }
                : undefined
        };
    }

    applyNoiseReduction?.(requestedMode);
    if (micState) {
        micState.currentNoiseReductionType = requestedMode;
        micState.lastMicDistanceToggleTs = now;
        if (requestedMode === 'far_field') micState.farToggles += 1;
        else micState.nearToggles += 1;
    }

    return {
        status: 'ok',
        applied: true,
        mode: requestedMode,
        current: micState?.currentNoiseReductionType,
        reason,
        counters: micState
            ? { farToggles: micState.farToggles, nearToggles: micState.nearToggles, skippedNoOp: micState.skippedNoOp }
            : undefined
    };
}
