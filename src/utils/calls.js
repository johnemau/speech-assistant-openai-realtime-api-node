/**
 * Resolve a friendly name for a caller.
 *
 * @param {object} root0 - Caller info.
 * @param {string|null} root0.callerE164 - Caller number in E.164.
 * @param {Set<string>} root0.primaryCallersSet - Primary allowlist.
 * @param {Set<string>} root0.secondaryCallersSet - Secondary allowlist.
 * @param {string} root0.primaryName - Primary greeting name.
 * @param {string} root0.secondaryName - Secondary greeting name.
 * @param {string} [root0.fallbackName] - Fallback greeting name.
 * @returns {string} Resolved caller name.
 */
export function resolveCallerName({
    callerE164,
    primaryCallersSet,
    secondaryCallersSet,
    primaryName,
    secondaryName,
    fallbackName = 'legend',
}) {
    if (callerE164 && primaryCallersSet?.has(callerE164) && primaryName)
        return primaryName;
    if (callerE164 && secondaryCallersSet?.has(callerE164) && secondaryName)
        return secondaryName;
    return fallbackName;
}

/**
 * Compute a time-of-day greeting in a target time zone.
 *
 * @param {object} root0 - Time inputs.
 * @param {string} [root0.timeZone] - IANA time zone.
 * @param {Date} [root0.now] - Current time override.
 * @returns {string} Greeting string.
 */
export function getTimeGreeting({
    timeZone = 'America/Los_Angeles',
    now = new Date(),
} = {}) {
    const pacificHour = Number(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: 'numeric',
            hour12: false,
        }).format(now)
    );

    if (pacificHour >= 4 && pacificHour < 12) return 'Good morning';
    if (pacificHour >= 12 && pacificHour < 17) return 'Good afternoon';
    return 'Good evening';
}
