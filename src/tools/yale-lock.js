import { PRIMARY_CALLERS_SET } from '../env.js';
import {
    listLocks,
    getLockStatus,
    lockLock,
    unlockLock,
} from '../utils/yale.js';

export const definition = {
    type: 'function',
    name: 'yale_lock',
    parameters: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['lock', 'unlock', 'status', 'list'],
                description:
                    'Action to perform: lock, unlock, status (get current lock state), or list (list all locks).',
            },
            lock_id: {
                type: 'string',
                description:
                    'The lock ID to act on. Required for lock/unlock/status when multiple locks exist. Omit when only one lock on account or when using list.',
            },
            lock_name: {
                type: 'string',
                description:
                    'Optional human-readable lock name the caller used (e.g. "front door"). Used for confirmation only.',
            },
        },
        required: ['action'],
    },
    description:
        'Control Yale/August smart locks. Lock, unlock, check status, or list available locks. Only available to primary callers.',
};

/**
 * Execute yale_lock tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ action?: string, lock_id?: string, lock_name?: string }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<object>} Tool result.
 */
export async function execute({ args, context }) {
    const currentCallerE164 = context?.currentCallerE164 || null;
    if (!currentCallerE164 || !PRIMARY_CALLERS_SET.has(currentCallerE164)) {
        return {
            status: 'error',
            message: 'Smart lock control is only available to primary callers.',
        };
    }

    const action = String(args?.action || '')
        .trim()
        .toLowerCase();
    const lockId =
        typeof args?.lock_id === 'string' ? args.lock_id.trim() : undefined;
    const lockName =
        typeof args?.lock_name === 'string' ? args.lock_name.trim() : undefined;

    switch (action) {
        case 'list': {
            const locks = await listLocks();
            return { status: 'ok', action: 'list', locks };
        }
        case 'status': {
            const lockStatus = await getLockStatus(lockId);
            return {
                status: 'ok',
                action: 'status',
                lock_name: lockName,
                lock: lockStatus,
            };
        }
        case 'lock': {
            const lockStatus = await lockLock(lockId);
            return {
                status: 'ok',
                action: 'lock',
                lock_name: lockName,
                lock: lockStatus,
            };
        }
        case 'unlock': {
            const lockStatus = await unlockLock(lockId);
            return {
                status: 'ok',
                action: 'unlock',
                lock_name: lockName,
                lock: lockStatus,
            };
        }
        default:
            return {
                status: 'error',
                message: `Unknown action: ${action}. Use lock, unlock, status, or list.`,
            };
    }
}
