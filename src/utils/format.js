import { inspect } from 'node:util';

// Helper: stringify objects for logging with deep nesting
/**
 * Stringify an object for logging with deep nesting.
 *
 * @param {unknown} obj - Value to stringify.
 * @returns {string} Stringified value.
 */
export function stringifyDeep(obj) {
    try {
        return inspect(obj, { depth: 10, colors: false, compact: false });
    } catch {
        try {
            return JSON.stringify(obj);
        } catch {
            return String(obj);
        }
    }
}
