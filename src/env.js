import dotenv from 'dotenv';
import { normalizeUSNumberToE164 } from './utils/phone.js';
import { isTruthy } from './utils/env.js';

dotenv.config();

export const IS_DEV = String(process.env.NODE_ENV || '').toLowerCase() === 'development';

export const PRIMARY_CALLERS_SET = new Set(
    (process.env.PRIMARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
);

export const SECONDARY_CALLERS_SET = new Set(
    (process.env.SECONDARY_USER_PHONE_NUMBERS || '')
        .split(',')
        .map((s) => normalizeUSNumberToE164(s))
        .filter(Boolean)
);

// If both lists are empty, no callers are allowed.
export const ALL_ALLOWED_CALLERS_SET = new Set([
    ...PRIMARY_CALLERS_SET,
    ...SECONDARY_CALLERS_SET,
]);

// Waiting music configuration (optional)
export const WAIT_MUSIC_THRESHOLD_MS = Number(process.env.WAIT_MUSIC_THRESHOLD_MS || 500);
export const WAIT_MUSIC_VOLUME = Number(process.env.WAIT_MUSIC_VOLUME || 0.12); // 0.0 - 1.0
export const WAIT_MUSIC_FILE = process.env.WAIT_MUSIC_FILE || null; // e.g., assets/wait-music.pcmu

/** @type {import('openai/resources/responses/responses').WebSearchTool.UserLocation} */
export const DEFAULT_SMS_USER_LOCATION = { type: 'approximate', country: 'US', region: 'Washington' };

export const PRIMARY_USER_FIRST_NAME = process.env.PRIMARY_USER_FIRST_NAME;
export const SECONDARY_USER_FIRST_NAME = process.env.SECONDARY_USER_FIRST_NAME;

export let ALLOW_SEND_SMS = isTruthy(process.env.ALLOW_SEND_SMS);
export let ALLOW_SEND_EMAIL = isTruthy(process.env.ALLOW_SEND_EMAIL);
