import crypto from 'node:crypto';

export const TEST_API_KEY = 'test-skyvern-api-key';

/**
 * Build a valid x-skyvern-signature header for the given body and key.
 *
 * @param {string | Buffer} body - Raw request body.
 * @param {string} [key] - HMAC key (defaults to TEST_API_KEY).
 * @returns {string} Hex-encoded HMAC-SHA256 digest.
 */
export function makeSignature(body, key = TEST_API_KEY) {
    return crypto
        .createHmac('sha256', key)
        .update(typeof body === 'string' ? Buffer.from(body) : body)
        .digest('hex');
}

/**
 * @returns {{
 *   headers: Record<string, string>,
 *   statusCode: number | null,
 *   payload: unknown,
 *   code: (status: number) => any,
 *   send: (payload: unknown) => any,
 * }} Reply mock for tests.
 */
export function createReply() {
    return {
        headers: {},
        statusCode: null,
        payload: null,
        /**
         * @param {number} status - HTTP status code.
         * @returns {any} Reply for chaining.
         */
        code(status) {
            this.statusCode = status;
            return this;
        },
        /**
         * @param {unknown} payload - Reply payload.
         * @returns {any} Reply for chaining.
         */
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
}

/**
 * Build a fake request with a signed body.
 *
 * @param {object} body - Parsed body object.
 * @param {object} [options] - Options.
 * @param {string} [options.signatureKey] - Key to sign with (defaults to TEST_API_KEY).
 * @param {string | null} [options.signatureHeader] - Override the header value (null = omit).
 * @returns {{ headers: Record<string, string>, body: object, rawBody: Buffer }} Mock request.
 */
export function makeRequest(
    body,
    { signatureKey = TEST_API_KEY, signatureHeader = undefined } = {}
) {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const sig =
        signatureHeader !== undefined
            ? signatureHeader
            : makeSignature(raw, signatureKey);
    const headers = /** @type {Record<string, string>} */ ({});
    if (sig !== null) {
        headers['x-skyvern-signature'] = sig;
    }
    return { headers, body, rawBody: raw };
}
