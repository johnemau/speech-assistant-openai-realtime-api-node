// Allowed callers (E.164). Configure via env `PRIMARY_USER_PHONE_NUMBERS` and `SECONDARY_USER_PHONE_NUMBERS` as comma-separated numbers.
/**
 *
 * @param input
 */
export function normalizeUSNumberToE164(input) {
    if (!input) return null;
    // Remove non-digits except leading +
    const trimmed = String(input).trim();
    if (trimmed.startsWith('+')) {
        // Keep only + and digits
        const normalized = '+' + trimmed.replace(/[^0-9]/g, '');
        return normalized;
    }
    // Strip all non-digits
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (!digits) return null;
    // Ensure leading country code 1 for US
    const withCountry = digits.startsWith('1') ? digits : ('1' + digits);
    return '+' + withCountry;
}
