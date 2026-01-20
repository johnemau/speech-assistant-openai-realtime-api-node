import { updateMicDistanceDefinition } from './definitions.js';

export const definition = updateMicDistanceDefinition;

/**
 * Execute update_mic_distance tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ mode?: string, reason?: string }} root0.args - Tool arguments.
 * @param {object} root0.context - Tool context.
 * @returns {Promise<{ status: string, applied: boolean, reason?: string, mode?: string, current?: string, counters?: { farToggles: number, nearToggles: number, skippedNoOp: number } }>} Update result.
 */
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
