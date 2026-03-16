import August from 'august-yale';
import { IS_DEV } from '../env.js';

/** @type {August | null} */
let augustInstance = null;

/**
 * Get or create the August/Yale singleton client.
 * Requires AUGUST_INSTALL_ID, AUGUST_ID, and AUGUST_PASSWORD env vars.
 *
 * @returns {August | null} August client or null when not configured.
 */
export function getAugustClient() {
    if (augustInstance) return augustInstance;

    const installId = process.env.AUGUST_INSTALL_ID;
    const augustId = process.env.AUGUST_ID;
    const password = process.env.AUGUST_PASSWORD;

    if (!installId || !augustId || !password) {
        if (IS_DEV) {
            console.warn(
                'yale: credentials missing, smart lock features unavailable'
            );
        }
        return null;
    }

    augustInstance = new August({ installId, augustId, password });
    return augustInstance;
}

/**
 * Reset the singleton (test-only).
 */
export function resetAugustClientForTests() {
    augustInstance = null;
}

/**
 * @typedef {object} YaleLockOps
 * @property {() => Promise<Record<string, any>>} listLocks
 * @property {(lockId?: string) => Promise<any>} getLockStatus
 * @property {(lockId?: string) => Promise<any>} lockLock
 * @property {(lockId?: string) => Promise<any>} unlockLock
 */

/**
 * Real lock operations that delegate to the August client.
 *
 * @type {YaleLockOps}
 */
const realOps = {
    async listLocks() {
        const client = getAugustClient();
        if (!client) throw new Error('Yale/August is not configured.');
        return client.locks();
    },
    async getLockStatus(lockId) {
        const client = getAugustClient();
        if (!client) throw new Error('Yale/August is not configured.');
        return /** @type {any} */ (client).status(lockId);
    },
    async lockLock(lockId) {
        const client = getAugustClient();
        if (!client) throw new Error('Yale/August is not configured.');
        return /** @type {any} */ (client).lock(lockId);
    },
    async unlockLock(lockId) {
        const client = getAugustClient();
        if (!client) throw new Error('Yale/August is not configured.');
        return /** @type {any} */ (client).unlock(lockId);
    },
};

/** @type {YaleLockOps} */
let ops = realOps;

/**
 * List all locks on the account.
 *
 * @returns {Promise<Record<string, any>>} Map of lock IDs to lock info.
 */
export function listLocks() {
    return ops.listLocks();
}

/**
 * Get the status of a lock.
 *
 * @param {string} [lockId] - Lock ID.
 * @returns {Promise<any>} Lock status.
 */
export function getLockStatus(lockId) {
    return ops.getLockStatus(lockId);
}

/**
 * Lock a lock.
 *
 * @param {string} [lockId] - Lock ID.
 * @returns {Promise<any>} Lock status after locking.
 */
export function lockLock(lockId) {
    return ops.lockLock(lockId);
}

/**
 * Unlock a lock.
 *
 * @param {string} [lockId] - Lock ID.
 * @returns {Promise<any>} Lock status after unlocking.
 */
export function unlockLock(lockId) {
    return ops.unlockLock(lockId);
}

/**
 * Override lock operations for testing.
 *
 * @param {Partial<YaleLockOps>} overrides - Test overrides.
 */
export function setYaleLockOpsForTests(overrides) {
    ops = { ...realOps, ...overrides };
}

/**
 * Restore real lock operations.
 */
export function resetYaleLockOpsForTests() {
    ops = realOps;
}
