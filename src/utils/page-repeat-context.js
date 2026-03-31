import { IS_DEV } from '../env.js';

/** @type {Map<string, string>} */
const pageMessages = new Map();

/**
 * Store a page message keyed by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @param {string} message - Page message text.
 */
export function savePageMessage(callSid, message) {
    if (!callSid || !message) return;
    pageMessages.set(callSid, message);
    if (IS_DEV) {
        console.log('page-repeat-context: saved', {
            callSid,
            mapSize: pageMessages.size,
        });
    }
}

/**
 * Retrieve a stored page message by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @returns {string | undefined} The stored message, or undefined.
 */
export function readPageMessage(callSid) {
    return pageMessages.get(callSid);
}

/**
 * Remove a stored page message by CallSid.
 *
 * @param {string} callSid - Twilio CallSid.
 * @returns {boolean} True if an entry was removed.
 */
export function clearPageMessage(callSid) {
    const had = pageMessages.delete(callSid);
    if (IS_DEV && had) {
        console.log('page-repeat-context: cleared', {
            callSid,
            mapSize: pageMessages.size,
        });
    }
    return had;
}

/**
 * Reset all stored page messages. Intended for tests only.
 */
export function resetPageMessagesForTests() {
    pageMessages.clear();
}
