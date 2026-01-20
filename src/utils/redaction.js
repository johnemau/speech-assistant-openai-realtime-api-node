import patchLogs from 'redact-logs';
import { scrub, findSensitiveValues } from '@zapier/secret-scrubber';
import { isTruthy, getSecretEnvKeys, getSecretEnvValues } from './env.js';

export const DEFAULT_SECRET_ENV_KEYS = [
    'OPENAI_API_KEY',
    'NGROK_AUTHTOKEN',
    'SMTP_NODEMAILER_SERVICE_ID',
    'SMTP_PASS',
    'SMTP_USER',
    'SENDER_FROM_EMAIL',
    'PRIMARY_TO_EMAIL',
    'SECONDARY_TO_EMAIL',
    'TWILIO_SMS_FROM_NUMBER',
    // Caller-related environment variables
    'PRIMARY_USER_PHONE_NUMBERS',
    'SECONDARY_USER_PHONE_NUMBERS',
    'PRIMARY_USER_FIRST_NAME',
    'SECONDARY_USER_FIRST_NAME',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_API_KEY',
    'TWILIO_API_SECRET',
];

export const REDACTION_KEYS = getSecretEnvKeys(
    process.env,
    DEFAULT_SECRET_ENV_KEYS
);

/**
 * Patch console logging to redact configured secrets.
 *
 * @param {Record<string, string | undefined>} [env] - Environment object.
 * @returns {{ redactionDisabled: boolean, secretKeys: string[], envSecretValues: string[] }} Redaction state.
 */
export function setupConsoleRedaction(env = process.env) {
    /** @type {null | (() => void)} */
    let disableLogRedaction = null;
    /** @type {string[]} */
    let secretKeys = [];

    try {
        secretKeys = getSecretEnvKeys(env, DEFAULT_SECRET_ENV_KEYS);
        // Enable redaction by default
        disableLogRedaction = patchLogs(secretKeys);
        // Optional: brief confirmation without leaking values
        console.log('Log redaction enabled for env keys:', secretKeys);
        // If env flag is truthy, disable the redaction immediately
        if (isTruthy(env.DISABLE_LOG_REDACTION)) {
            try {
                disableLogRedaction();
                console.log(
                    'Log redaction disabled via DISABLE_LOG_REDACTION env flag.'
                );
            } catch (err) {
                console.warn(
                    'Failed to disable log redaction:',
                    err?.message || err
                );
            }
        }
    } catch (e) {
        console.warn('Failed to initialize log redaction:', e?.message || e);
    }

    const redactionDisabled = isTruthy(env.DISABLE_LOG_REDACTION);

    // Wrap console methods to proactively scrub sensitive data in any logged objects
    // Skip entirely if DISABLE_LOG_REDACTION is truthy
    if (!redactionDisabled) {
        try {
            const envSecretValues = getSecretEnvValues(env, secretKeys);

            const original = {
                log: console.log.bind(console),
                error: console.error.bind(console),
                warn: console.warn.bind(console),
                info: console.info.bind(console),
            };

            /** @param {unknown[]} args */
            const sanitizeArgs = (args) => {
                /** @type {string[]} */
                let guessed = [];
                try {
                    for (const a of args) {
                        if (a && typeof a === 'object') {
                            try {
                                guessed.push(...findSensitiveValues(a));
                            } catch {
                                // noop: best-effort discovery of sensitive values
                                void 0;
                            }
                        }
                    }
                } catch {
                    // noop: best-effort discovery of sensitive values
                    void 0;
                }
                const secrets = Array.from(
                    new Set([...envSecretValues, ...guessed])
                );

                return args.map((a) => {
                    try {
                        if (
                            typeof a === 'string' ||
                            (a && typeof a === 'object') ||
                            Array.isArray(a)
                        ) {
                            return scrub(a, secrets);
                        }
                    } catch {
                        // noop: scrub failures should not block logging
                        void 0;
                    }
                    return a;
                });
            };

            console.log = (...args) => original.log(...sanitizeArgs(args));
            console.error = (...args) => original.error(...sanitizeArgs(args));
            console.warn = (...args) => original.warn(...sanitizeArgs(args));
            console.info = (...args) => original.info(...sanitizeArgs(args));
            return { redactionDisabled, secretKeys, envSecretValues };
        } catch (e) {
            // If scrubber initialization fails, leave console untouched
            console.warn(
                'Secret scrubber initialization failed:',
                e?.message || e
            );
        }
    } else {
        console.warn(
            'DISABLE_LOG_REDACTION is truthy; secret scrubber not initialized.'
        );
    }

    const envSecretValues = getSecretEnvValues(env, secretKeys);
    return { redactionDisabled, secretKeys, envSecretValues };
}

/**
 * Redact sensitive details from a string using known secrets.
 *
 * @param {object} root0 - Redaction inputs.
 * @param {unknown} root0.errorLike - Error or data to scan for secrets.
 * @param {string} root0.detail - Detail string to redact.
 * @param {Record<string, string | undefined>} [root0.env] - Environment object.
 * @param {string[]} [root0.secretKeys] - Secret keys to use.
 * @returns {string} Redacted detail.
 */
export function redactErrorDetail({
    errorLike,
    detail,
    env = process.env,
    secretKeys = [],
}) {
    let redacted = detail;
    try {
        const keys =
            secretKeys.length > 0
                ? secretKeys
                : getSecretEnvKeys(env, DEFAULT_SECRET_ENV_KEYS);
        const envVals = getSecretEnvValues(env, keys);
        /** @type {string[]} */
        let guessed = [];
        const errorLikeObj =
            errorLike && typeof errorLike === 'object' ? errorLike : {};
        try {
            guessed = findSensitiveValues(errorLikeObj);
        } catch {
            // noop: best-effort discovery of sensitive values
            void 0;
        }
        const secrets = Array.from(new Set([...envVals, ...guessed]));
        redacted = scrub(redacted, secrets);
    } catch {
        // noop: fallback to original detail when redaction fails
        void 0;
    }
    return redacted;
}
