/**
 * Determine if a value is truthy for env flags.
 *
 * @param {unknown} val - Input value.
 * @returns {boolean} True if value is a truthy env string.
 */
export function isTruthy(val) {
    const v = String(val || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Get the union of default and user-supplied secret env keys.
 *
 * @param {Record<string, string | undefined>} env - Environment object.
 * @param {string[]} [defaultKeys] - Default secret keys.
 * @returns {string[]} Secret env keys.
 */
export function getSecretEnvKeys(env, defaultKeys = []) {
    const extraKeys = (env.REDACT_ENV_KEYS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set([...defaultKeys, ...extraKeys]));
}

/**
 * Collect secret env values for a set of keys.
 *
 * @param {Record<string, string | undefined>} env - Environment object.
 * @param {string[]} [keys] - Keys to resolve.
 * @returns {string[]} Secret values.
 */
export function getSecretEnvValues(env, keys = []) {
    const values = [];
    for (const key of keys) {
        const value = env[key];
        if (typeof value === 'string' && value.length > 0) values.push(value);
    }
    return values;
}
