import { IS_DEV } from '../env.js';

/** @type {Map<string, string>} */
const pendingMessages = new Map();

/**
 * Store a pending message keyed by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @param {string} message - Pending message text.
 */
export function savePendingMessage(callSid, message) {
    if (!callSid || !message) return;
    pendingMessages.set(callSid, message);
    if (IS_DEV) {
        console.log('pending-messages: saved', {
            callSid,
            mapSize: pendingMessages.size,
        });
    }
}

/**
 * Retrieve a stored pending message by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @returns {string | undefined} The stored message, or undefined.
 */
export function readPendingMessage(callSid) {
    return pendingMessages.get(callSid);
}

/**
 * Remove a stored pending message by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @returns {boolean} True if an entry was removed.
 */
export function clearPendingMessage(callSid) {
    const had = pendingMessages.delete(callSid);
    if (IS_DEV && had) {
        console.log('pending-messages: cleared', {
            callSid,
            mapSize: pendingMessages.size,
        });
    }
    return had;
}

/**
 * Reset all stored pending messages. Intended for tests only.
 */
export function resetPendingMessagesForTests() {
    pendingMessages.clear();
}
