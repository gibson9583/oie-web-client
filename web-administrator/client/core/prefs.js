/*
 * Browser-side user preferences (the web-admin equivalent of the Swing
 * Administrator settings panel). These are per-browser, stored in localStorage —
 * only the settings that actually map to web-admin behavior are kept; the
 * Swing panel's RSyntaxTextArea/editor shortcut settings do not apply (Monaco
 * manages its own). Namespaced per engine AND per user (scopedKey) so a different
 * engine, or a different user on the same browser, keeps separate settings.
 */

import { scopedKey } from './store.js';

const BASE_KEY = 'webadmin-prefs';
const storageKey = () => scopedKey(BASE_KEY);

export const PREF_DEFAULTS = {
    // System Preferences
    dashboardRefreshSeconds: 5,
    messagePageSize: 20,
    eventPageSize: 20,
    formatMessages: true,        // pretty-print XML/JSON in the message browser by default
    confirmReprocessRemove: true, // require the REPROCESSALL / remove confirmations
    // 'yes' | 'no' | 'ask' — bundle/import a channel's code template libraries
    importLibrariesWithChannels: 'ask',
    exportLibrariesWithChannels: 'ask',
    // 'ask' | 'classic' | 'guided' — the New Channel builder. 'ask' shows a chooser
    // each time (classic tabbed editor vs. step-by-step guided wizard); 'classic' or
    // 'guided' skip the chooser and go straight to that builder. The chooser's
    // "Remember my choice" sets this to the picked builder so it stops asking.
    newChannelDefault: 'ask',
    // 'ask' | 'classic' | 'guided' — the New Alert builder (same model as newChannelDefault).
    newAlertDefault: 'ask',
    // Show the "switch to the other view" task in the channel editor / wizard, so a
    // user can move a channel (with its unsaved edits) between the classic editor and
    // the wizard. Turn off if you only ever use one view.
    showViewSwitch: true,
    // Dashboard: which of the two interchangeable looks to show ('classic' table
    // | 'cards' card grid). One nav item; each view's rail toggles + persists this.
    dashboardView: 'classic',
    // Card view: remembered "group by" choice ('none' | 'group' | 'tag' | 'state').
    cardsGroupBy: 'none',
    // Card view: show Lifetime statistics (true) vs. Current (false).
    cardsLifetime: false
};

let cache = null;
let cacheKey = null;   // storageKey the cache belongs to; re-reads when the server namespace changes

function all() {
    const key = storageKey();
    if (cache && cacheKey === key) return cache;
    try { cache = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { cache = { ...PREF_DEFAULTS }; }
    cacheKey = key;
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
    cacheKey = storageKey();
    try { localStorage.setItem(storageKey(), JSON.stringify(cache)); } catch { /* private mode */ }
}

/** Reset all preferences to their defaults. */
export function resetPrefs() {
    cache = { ...PREF_DEFAULTS };
    cacheKey = storageKey();
    try { localStorage.removeItem(storageKey()); } catch { /* private mode */ }
}
