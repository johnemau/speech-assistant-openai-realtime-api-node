import { IS_DEV } from '../env.js';

const REDACTED_VALUE = 'REDACTED';
const MAX_PREVIEW_CHARS = 2000;
const SECRET_KEYS = new Set([
    'key',
    'apikey',
    'api_key',
    'api-key',
    'access_token',
    'refresh_token',
    'token',
    'authorization',
    'password',
    'feedpassword',
    'x-goog-api-key',
]);

/**
 * @param {unknown} value - Value to test.
 * @returns {boolean} - True when value is a plain object.
 */
function isPlainObject(value) {
    return (
        !!value &&
        typeof value === 'object' &&
        (value.constructor === Object ||
            Object.getPrototypeOf(value) === Object.prototype)
    );
}

/**
 * @param {string} key - Key name to inspect.
 * @returns {boolean} - True when key is considered secret.
 */
function isSecretKey(key) {
    return SECRET_KEYS.has(String(key).toLowerCase());
}

/**
 * @param {unknown} value - Value to redact.
 * @returns {unknown} - Redacted value.
 */
function redactSecretsInObject(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactSecretsInObject(item));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    if (!isPlainObject(value)) {
        return value;
    }

    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, val] of Object.entries(value)) {
        if (isSecretKey(key)) {
            out[key] = REDACTED_VALUE;
        } else {
            out[key] = redactSecretsInObject(val);
        }
    }
    return out;
}

/**
 * @param {string} url - Request URL.
 * @returns {{ safeUrl: string, params: Record<string, string | string[]> | null }} - Redacted URL and params.
 */
function sanitizeUrl(url) {
    try {
        const parsed = new URL(url);
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSecretKey(key)) {
                parsed.searchParams.set(key, REDACTED_VALUE);
            }
        }
        /** @type {Record<string, string | string[]>} */
        const params = {};
        for (const [key, value] of parsed.searchParams.entries()) {
            const safeValue = isSecretKey(key) ? REDACTED_VALUE : value;
            if (Object.prototype.hasOwnProperty.call(params, key)) {
                const current = params[key];
                params[key] = Array.isArray(current)
                    ? [...current, safeValue]
                    : [current, safeValue];
            } else {
                params[key] = safeValue;
            }
        }
        return { safeUrl: parsed.toString(), params };
    } catch {
        return { safeUrl: url, params: null };
    }
}

/**
 * @param {unknown} body - Request body.
 * @returns {unknown} - Normalized body for logging.
 */
function normalizeBody(body) {
    if (body == null) return null;

    if (typeof body === 'string') {
        try {
            const parsed = JSON.parse(body);
            return redactSecretsInObject(parsed);
        } catch {
            return body;
        }
    }

    if (typeof URLSearchParams !== 'undefined') {
        if (body instanceof URLSearchParams) {
            /** @type {Record<string, string>} */
            const obj = {};
            for (const [key, value] of body.entries()) {
                obj[key] = isSecretKey(key) ? REDACTED_VALUE : value;
            }
            return obj;
        }
    }

    if (typeof FormData !== 'undefined') {
        if (body instanceof FormData) {
            /** @type {Record<string, unknown>} */
            const obj = {};
            for (const [key, value] of body.entries()) {
                obj[key] = isSecretKey(key) ? REDACTED_VALUE : value;
            }
            return obj;
        }
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
        return body.toString('utf8');
    }

    if (isPlainObject(body) || Array.isArray(body)) {
        return redactSecretsInObject(body);
    }

    return body;
}

/**
 * @param {unknown} value - Response value to preview.
 * @returns {{ text: string | null, truncated: boolean }} - Preview info.
 */
function buildPreview(value) {
    if (value == null) return { text: null, truncated: false };

    let text;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch {
            text = String(value);
        }
    }

    if (text.length <= MAX_PREVIEW_CHARS) {
        return { text, truncated: false };
    }

    return { text: text.slice(0, MAX_PREVIEW_CHARS), truncated: true };
}

/**
 * Log a sanitized HTTP request when IS_DEV is true.
 *
 * @param {object} params - Request log data.
 * @param {string} params.tag - Log tag label.
 * @param {string} params.url - Request URL.
 * @param {string=} params.method - HTTP method.
 * @param {unknown=} params.body - Request body.
 * @param {number | null=} params.timeoutMs - Timeout in ms.
 */
export function logHttpRequest({ tag, url, method, body, timeoutMs }) {
    if (!IS_DEV) return;

    const { safeUrl, params } = sanitizeUrl(url);
    const safeBody = normalizeBody(body);

    console.log(`${tag}: http request`, {
        url: safeUrl,
        params,
        method: method ?? 'GET',
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
        body: safeBody,
    });
}

/**
 * Log a sanitized HTTP response preview when IS_DEV is true.
 *
 * @param {object} params - Response log data.
 * @param {string} params.tag - Log tag label.
 * @param {string} params.url - Request URL.
 * @param {number | null=} params.status - HTTP status code.
 * @param {string | null=} params.statusText - HTTP status text.
 * @param {number | null=} params.durationMs - Duration in ms.
 * @param {string | null=} params.contentType - Response content-type.
 * @param {unknown=} params.body - Parsed response body.
 */
export function logHttpResponse({
    tag,
    url,
    status,
    statusText,
    durationMs,
    contentType,
    body,
}) {
    if (!IS_DEV) return;

    const { safeUrl, params } = sanitizeUrl(url);
    const preview = buildPreview(body);

    console.log(`${tag}: http response`, {
        url: safeUrl,
        params,
        status: Number.isFinite(status) ? status : null,
        statusText: statusText ?? null,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
        contentType: contentType ?? null,
        preview: preview.text,
        previewTruncated: preview.truncated,
    });
}
