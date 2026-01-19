export function isTruthy(val) {
    const v = String(val || '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getSecretEnvKeys(env, defaultKeys = []) {
    const extraKeys = (env.REDACT_ENV_KEYS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set([...defaultKeys, ...extraKeys]));
}

export function getSecretEnvValues(env, keys = []) {
    const values = [];
    for (const key of keys) {
        const value = env[key];
        if (typeof value === 'string' && value.length > 0) values.push(value);
    }
    return values;
}
