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

export function setupConsoleRedaction(env = process.env) {
    let disableLogRedaction = null;
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
                console.log('Log redaction disabled via DISABLE_LOG_REDACTION env flag.');
            } catch (err) {
                console.warn('Failed to disable log redaction:', err?.message || err);
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

            const sanitizeArgs = (args) => {
                let guessed = [];
                try {
                    for (const a of args) {
                        if (a && typeof a === 'object') {
                            try {
                                guessed.push(...findSensitiveValues(a));
                            } catch {}
                        }
                    }
                } catch {}
                const secrets = Array.from(new Set([
                    ...envSecretValues,
                    ...guessed,
                ]));

                return args.map((a) => {
                    try {
                        if (typeof a === 'string' || (a && typeof a === 'object') || Array.isArray(a)) {
                            return scrub(a, secrets);
                        }
                    } catch {}
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
            console.warn('Secret scrubber initialization failed:', e?.message || e);
        }
    } else {
        console.warn('DISABLE_LOG_REDACTION is truthy; secret scrubber not initialized.');
    }

    const envSecretValues = getSecretEnvValues(env, secretKeys);
    return { redactionDisabled, secretKeys, envSecretValues };
}

export function redactErrorDetail({ errorLike, detail, env = process.env, secretKeys = [] }) {
    let redacted = detail;
    try {
        const keys = secretKeys.length > 0 ? secretKeys : getSecretEnvKeys(env, DEFAULT_SECRET_ENV_KEYS);
        const envVals = getSecretEnvValues(env, keys);
        let guessed = [];
        try { guessed = findSensitiveValues(errorLike); } catch {}
        const secrets = Array.from(new Set([...envVals, ...guessed]));
        redacted = scrub(redacted, secrets);
    } catch {}
    return redacted;
}
