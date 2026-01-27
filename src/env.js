import dotenv from 'dotenv';
import { normalizeUSNumberToE164 } from './utils/phone.js';
import { isTruthy } from './utils/env.js';

dotenv.config();

export const IS_DEV =
    String(process.env.NODE_ENV || '').toLowerCase() === 'development';

const primaryCallerNumbers = /** @type {string[]} */ (
    (process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
        .map((value) => String(value))
);

export const PRIMARY_CALLERS_SET = new Set(primaryCallerNumbers);

const secondaryCallerNumbers = /** @type {string[]} */ (
    (process.env.SECONDARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
        .map((value) => String(value))
);

export const SECONDARY_CALLERS_SET = new Set(secondaryCallerNumbers);

// If both lists are empty, no callers are allowed.
export const ALL_ALLOWED_CALLERS_SET = new Set([
    ...PRIMARY_CALLERS_SET,
    ...SECONDARY_CALLERS_SET,
]);

/**
 * Check whether a caller is in the primary allowlist, using live env values
 * as a fallback for test environments that mutate process.env after module load.
 *
 * @param {string | null | undefined} callerE164 - Caller number in E.164.
 * @returns {boolean} Whether the caller is in the primary allowlist.
 */
export function isPrimaryCaller(callerE164) {
    if (!callerE164) return false;
    if (PRIMARY_CALLERS_SET.has(callerE164)) return true;
    const envList = String(process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
        .map((value) => String(value));
    if (envList.length === 0) return false;
    return envList.includes(String(callerE164));
}

// Waiting music configuration (optional)
export const WAIT_MUSIC_THRESHOLD_MS = Number(
    process.env.WAIT_MUSIC_THRESHOLD_MS || 500
);
export const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0
export const WAIT_MUSIC_FOLDER = process.env.WAIT_MUSIC_FOLDER || 'music';

export const PRIMARY_USER_FIRST_NAME = process.env.PRIMARY_USER_FIRST_NAME;
export const SECONDARY_USER_FIRST_NAME = process.env.SECONDARY_USER_FIRST_NAME;

export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
export const SPOT_FEED_ID = process.env.SPOT_FEED_ID;
export const SPOT_FEED_PASSWORD = process.env.SPOT_FEED_PASSWORD;

/**
 * @returns {string | undefined} Google Maps API key from env.
 */
export function getGoogleMapsApiKey() {
    return process.env.GOOGLE_MAPS_API_KEY;
}

/**
 * @returns {string | undefined} SPOT public feed ID from env.
 */
export function getSpotFeedId() {
    return process.env.SPOT_FEED_ID;
}

/**
 * @returns {string | undefined} SPOT public feed password from env.
 */
export function getSpotFeedPassword() {
    return process.env.SPOT_FEED_PASSWORD;
}

export let ALLOW_SEND_SMS = isTruthy(process.env.ALLOW_SEND_SMS);
export let ALLOW_SEND_EMAIL = isTruthy(process.env.ALLOW_SEND_EMAIL);

/**
 * Test/helper override for SMS sending flag.
 * @param {boolean} value - Whether to allow SMS sending.
 */
export function setAllowSendSms(value) {
    ALLOW_SEND_SMS = Boolean(value);
}

/**
 * Test/helper override for email sending flag.
 * @param {boolean} value - Whether to allow email sending.
 */
export function setAllowSendEmail(value) {
    ALLOW_SEND_EMAIL = Boolean(value);
}
