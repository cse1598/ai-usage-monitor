// A manual override exists only while it differs from the system.
// The saved 'auto' state follows the system even after a session restart.
export function syncMode(mode, systemValue) {
    if (mode === 'auto' || mode === systemValue)
        return {mode: 'auto', value: systemValue};
    return {mode, value: mode};
}

export function toggleMode(currentValue, systemValue, first, second) {
    const next = currentValue === first ? second : first;
    return syncMode(next, systemValue);
}
