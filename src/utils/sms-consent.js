import path from 'node:path';
import { mkdir, readFile, appendFile } from 'node:fs/promises';

const DEFAULT_CONSENT_RECORDS_PATH =
    process.env.SMS_CONSENT_RECORDS_FILE_PATH ||
    'data/sms-consent-records.jsonl';

/**
 * @typedef {'pending' | 'confirmed' | 'opted_out'} SmsConsentStatus
 */

/**
 * @typedef {object} SmsConsentRecord
 * @property {string} phoneNumber - E.164 phone number.
 * @property {string} keyword - Consent keyword (`START`, `YES`, `STOP`).
 * @property {SmsConsentStatus} status - Derived consent status.
 * @property {string} timestamp - ISO timestamp.
 */

/**
 * @param {string} value - Keyword-like input.
 * @returns {string} Normalized uppercase keyword.
 */
export function normalizeSmsKeyword(value) {
    return String(value || '')
        .trim()
        .toUpperCase();
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is STOP.
 */
export function isStopKeyword(keyword) {
    return keyword === 'STOP';
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is START.
 */
export function isStartKeyword(keyword) {
    return keyword === 'START';
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is YES.
 */
export function isYesKeyword(keyword) {
    return keyword === 'YES';
}

/**
 * @param {string} [filePath] - Optional custom records path.
 * @returns {Promise<void>} Ensures records directory exists.
 */
async function ensureRecordsDir(filePath = DEFAULT_CONSENT_RECORDS_PATH) {
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
    const recordsDir = path.dirname(absolutePath);
    await mkdir(recordsDir, { recursive: true });
}

/**
 * @param {SmsConsentRecord} record - Record to append.
 * @param {string} [filePath] - Optional custom records path.
 * @returns {Promise<void>} Persisted result.
 */
export async function appendSmsConsentRecord(
    record,
    filePath = DEFAULT_CONSENT_RECORDS_PATH
) {
    await ensureRecordsDir(filePath);
    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
    await appendFile(absolutePath, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * @param {string} phoneNumber - E.164 caller number.
 * @param {string} [filePath] - Optional custom records path.
 * @returns {Promise<SmsConsentStatus | null>} Latest consent status for number.
 */
export async function getSmsConsentStatus(
    phoneNumber,
    filePath = DEFAULT_CONSENT_RECORDS_PATH
) {
    if (!phoneNumber) return null;

    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

    let text = '';
    try {
        text = await readFile(absolutePath, 'utf8');
    } catch {
        return null;
    }

    const lines = text.split('\n').filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const record = /** @type {SmsConsentRecord} */ (
                JSON.parse(lines[index])
            );
            if (record?.phoneNumber === phoneNumber && record?.status) {
                return record.status;
            }
        } catch {
            // Ignore malformed lines and continue scanning older entries.
        }
    }

    return null;
}
