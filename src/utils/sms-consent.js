import path from 'node:path';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { IS_DEV } from '../env.js';

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
    const normalized = String(value || '')
        .trim()
        .toUpperCase();

    if (IS_DEV) {
        console.log('sms-consent: keyword normalized', {
            event: 'sms-consent.keyword.normalized',
            input: value,
            output: normalized,
        });
    }

    return normalized;
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is STOP.
 */
export function isStopKeyword(keyword) {
    const result = keyword === 'STOP';
    if (IS_DEV) {
        console.log('sms-consent: stop keyword check', {
            event: 'sms-consent.keyword.check_stop',
            keyword,
            isStop: result,
        });
    }
    return result;
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is START.
 */
export function isStartKeyword(keyword) {
    const result = keyword === 'START';
    if (IS_DEV) {
        console.log('sms-consent: start keyword check', {
            event: 'sms-consent.keyword.check_start',
            keyword,
            isStart: result,
        });
    }
    return result;
}

/**
 * @param {string} keyword - Normalized keyword.
 * @returns {boolean} True when keyword is YES.
 */
export function isYesKeyword(keyword) {
    const result = keyword === 'YES';
    if (IS_DEV) {
        console.log('sms-consent: yes keyword check', {
            event: 'sms-consent.keyword.check_yes',
            keyword,
            isYes: result,
        });
    }
    return result;
}

/**
 * @param {string} [filePath] - Optional custom records path.
 * @returns {Promise<void>} Ensures records directory exists.
 */
async function ensureRecordsDir(filePath = DEFAULT_CONSENT_RECORDS_PATH) {
    if (IS_DEV) {
        console.log('sms-consent: ensuring records dir', {
            event: 'sms-consent.records_dir.ensure_start',
            filePath,
            isDefault: filePath === DEFAULT_CONSENT_RECORDS_PATH,
        });
    }

    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
    const recordsDir = path.dirname(absolutePath);

    try {
        await mkdir(recordsDir, { recursive: true });
        if (IS_DEV) {
            console.log('sms-consent: records dir created/verified', {
                event: 'sms-consent.records_dir.ensured',
                absolutePath,
                recordsDir,
            });
        }
    } catch (err) {
        if (IS_DEV) {
            console.log('sms-consent: error ensuring records dir', {
                event: 'sms-consent.records_dir.error',
                recordsDir,
                errorMessage: err?.message || String(err),
                errorStack: err?.stack,
            });
        }
        throw err;
    }
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
    if (IS_DEV) {
        console.log('sms-consent: appending consent record', {
            event: 'sms-consent.record.append_start',
            record,
            filePath,
            isDefault: filePath === DEFAULT_CONSENT_RECORDS_PATH,
        });
    }

    try {
        await ensureRecordsDir(filePath);
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(process.cwd(), filePath);

        if (IS_DEV) {
            console.log('sms-consent: writing record to file', {
                event: 'sms-consent.record.write_start',
                absolutePath,
                record,
            });
        }

        await appendFile(absolutePath, `${JSON.stringify(record)}\n`, 'utf8');

        if (IS_DEV) {
            console.log('sms-consent: record appended successfully', {
                event: 'sms-consent.record.appended',
                absolutePath,
                phoneNumber: record?.phoneNumber,
                status: record?.status,
                keyword: record?.keyword,
            });
        }
    } catch (err) {
        if (IS_DEV) {
            console.log('sms-consent: error appending record', {
                event: 'sms-consent.record.append_error',
                record,
                errorMessage: err?.message || String(err),
                errorStack: err?.stack,
            });
        }
        throw err;
    }
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
    if (IS_DEV) {
        console.log('sms-consent: getting consent status', {
            event: 'sms-consent.status.query_start',
            phoneNumber,
            filePath,
            isDefault: filePath === DEFAULT_CONSENT_RECORDS_PATH,
        });
    }

    if (!phoneNumber) {
        if (IS_DEV) {
            console.log('sms-consent: no phone number provided', {
                event: 'sms-consent.status.no_phone',
                phoneNumber,
            });
        }
        return null;
    }

    const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);

    let text = '';
    try {
        if (IS_DEV) {
            console.log('sms-consent: reading records file', {
                event: 'sms-consent.records_file.read_start',
                absolutePath,
            });
        }

        text = await readFile(absolutePath, 'utf8');

        if (IS_DEV) {
            console.log('sms-consent: records file read', {
                event: 'sms-consent.records_file.read_success',
                absolutePath,
                fileSize: text.length,
                lineCount: text.split('\n').filter(Boolean).length,
            });
        }
    } catch (err) {
        // File not existing yet is expected (no enrollments yet), so only log non-ENOENT errors
        if (IS_DEV && err?.code !== 'ENOENT') {
            console.log('sms-consent: error reading records file', {
                event: 'sms-consent.records_file.read_error',
                absolutePath,
                errorMessage: err?.message || String(err),
                errorCode: err?.code,
            });
        } else if (IS_DEV && err?.code === 'ENOENT') {
            console.log('sms-consent: records file not found (no enrollments yet)', {
                event: 'sms-consent.records_file.not_found',
                absolutePath,
            });
        }
        return null;
    }

    const lines = text.split('\n').filter(Boolean);
    if (IS_DEV) {
        console.log('sms-consent: scanning records file', {
            event: 'sms-consent.records_scan_start',
            totalLines: lines.length,
            phoneNumber,
            searchDirection: 'reverse',
        });
    }

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
            const record = /** @type {SmsConsentRecord} */ (
                JSON.parse(lines[index])
            );

            if (record?.phoneNumber === phoneNumber && record?.status) {
                if (IS_DEV) {
                    console.log('sms-consent: matching record found', {
                        event: 'sms-consent.record.found',
                        phoneNumber,
                        lineIndex: index,
                        status: record.status,
                        keyword: record.keyword,
                        timestamp: record.timestamp,
                    });
                }
                return record.status;
            }
        } catch (parseErr) {
            if (IS_DEV) {
                console.log('sms-consent: ignoring malformed record', {
                    event: 'sms-consent.record.parse_error',
                    lineIndex: index,
                    lineContent: lines[index]?.slice(0, 100),
                    errorMessage: parseErr?.message || String(parseErr),
                });
            }
            // Ignore malformed lines and continue scanning older entries.
        }
    }

    if (IS_DEV) {
        console.log('sms-consent: no matching record found', {
            event: 'sms-consent.status.not_found',
            phoneNumber,
            totalLines: lines.length,
        });
    }

    return null;
}
