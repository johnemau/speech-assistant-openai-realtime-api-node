/**
 *
 * @param root0
 * @param root0.callerE164
 * @param root0.primaryCallersSet
 * @param root0.secondaryCallersSet
 * @param root0.primaryName
 * @param root0.secondaryName
 * @param root0.fallbackName
 */
export function resolveCallerName({
    callerE164,
    primaryCallersSet,
    secondaryCallersSet,
    primaryName,
    secondaryName,
    fallbackName = 'legend',
}) {
    if (callerE164 && primaryCallersSet?.has(callerE164) && primaryName) return primaryName;
    if (callerE164 && secondaryCallersSet?.has(callerE164) && secondaryName) return secondaryName;
    return fallbackName;
}

/**
 *
 * @param root0
 * @param root0.timeZone
 * @param root0.now
 */
export function getTimeGreeting({
    timeZone = 'America/Los_Angeles',
    now = new Date(),
} = {}) {
    const pacificHour = Number(new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        hour12: false
    }).format(now));

    if (pacificHour >= 5 && pacificHour < 12) return 'Good morning';
    if (pacificHour >= 12 && pacificHour < 17) return 'Good afternoon';
    return 'Good evening';
}
