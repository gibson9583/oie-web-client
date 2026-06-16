/*
 * Browser-side user preferences (the web-admin equivalent of the Swing
 * Administrator settings panel). These are per-browser, stored in localStorage —
 * only the settings that actually map to web-admin behavior are kept; the
 * Swing panel's RSyntaxTextArea/editor shortcut settings do not apply (Monaco
 * manages its own).
 */

const KEY = 'webadmin-prefs';

export const PREF_DEFAULTS = {
    // System Preferences
    dashboardRefreshSeconds: 5,
    messagePageSize: 20,
    eventPageSize: 20,
    formatMessages: true,        // pretty-print XML/JSON in the message browser by default
    confirmReprocessRemove: true, // require the REPROCESSALL / remove confirmations
    // 'yes' | 'no' | 'ask' — bundle/import a channel's code template libraries
    importLibrariesWithChannels: 'ask',
    exportLibrariesWithChannels: 'ask'
};

let cache = null;

function all() {
    if (cache) return cache;
    try { cache = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { cache = { ...PREF_DEFAULTS }; }
    return cache;
}

/** Read one preference (falls back to its default). */
export function getPref(key) {
    const v = all()[key];
    return v === undefined ? PREF_DEFAULTS[key] : v;
}

/** Merge and persist a set of preferences. */
export function setPrefs(obj) {
    cache = { ...all(), ...obj };
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
}

/** Reset all preferences to their defaults. */
export function resetPrefs() {
    cache = { ...PREF_DEFAULTS };
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}
