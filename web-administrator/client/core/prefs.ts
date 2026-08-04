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

/*
 * The dashboard's poll interval, in seconds — Swing's default, and deliberately
 * the same number.
 *
 * The status poll fetches EVERY deployed channel's statuses on every tick, so its
 * cost is the channel count times the rate. At five seconds a thousand-channel
 * engine was being asked for the whole board twelve times a minute, per open
 * dashboard; the Swing client has always asked three times a minute
 * (StatusUpdater's DEFAULT_INTERVAL_TIME), and its own tooltip tells operators to
 * raise it further for "slower servers with more channels".
 *
 * Anyone who wants the faster board still has the preference on Settings →
 * Administrator, which is exactly how the desktop client offers it.
 */
export const DASHBOARD_REFRESH_SECONDS = 20;

/** The web admin's preference set. Stored values may add unknown keys (older or
    newer builds, plugins) — reads fall back to these defaults per key. */
export interface PrefValues {
    // System Preferences
    dashboardRefreshSeconds: number;
    messagePageSize: number;
    eventPageSize: number;
    /** pretty-print XML/JSON in the message browser by default */
    formatMessages: boolean;
    /** require the REPROCESSALL / remove confirmations */
    confirmReprocessRemove: boolean;
    /** bundle/import a channel's code template libraries */
    importLibrariesWithChannels: 'yes' | 'no' | 'ask';
    exportLibrariesWithChannels: 'yes' | 'no' | 'ask';
    /** the New Channel builder: 'ask' shows a chooser each time (classic tabbed
        editor vs. step-by-step guided wizard); 'classic' or 'guided' skip it. */
    newChannelDefault: 'ask' | 'classic' | 'guided';
    /** the New Alert builder (same model as newChannelDefault) */
    newAlertDefault: 'ask' | 'classic' | 'guided';
    /** show the "switch to the other view" task in the channel editor / wizard */
    showViewSwitch: boolean;
    /** which of the two interchangeable dashboard looks to show */
    dashboardView: 'classic' | 'cards';
    /** card view: remembered "group by" choice */
    cardsGroupBy: 'none' | 'group' | 'tag' | 'state';
    /** card view: show Lifetime statistics (true) vs. Current (false) */
    cardsLifetime: boolean;
    /** row height in the data grids only — forms and editors keep the baseline */
    tableDensity: 'compact' | 'normal' | 'wide';
    /** command palette: ids of the last few entries run, most recent first */
    paletteRecent: string[];
    /** per-user navigation layout: a SPARSE overlay on platform.navItems() —
        null = untouched. The merge and every edit live in core/nav-layout.ts. */
    navLayout: any;
}

export const PREF_DEFAULTS: PrefValues = {
    dashboardRefreshSeconds: DASHBOARD_REFRESH_SECONDS,
    messagePageSize: 20,
    eventPageSize: 20,
    formatMessages: true,
    confirmReprocessRemove: true,
    importLibrariesWithChannels: 'ask',
    exportLibrariesWithChannels: 'ask',
    newChannelDefault: 'ask',
    newAlertDefault: 'ask',
    showViewSwitch: true,
    dashboardView: 'classic',
    cardsGroupBy: 'none',
    cardsLifetime: false,
    tableDensity: 'normal',
    paletteRecent: [],
    navLayout: null
};

let cache: Record<string, any> | null = null;
let cacheKey: string | null = null;   // storageKey the cache belongs to; re-reads when the server namespace changes

function all(): Record<string, any> {
    const key = storageKey();
    if (cache && cacheKey === key) return cache;
    let next: Record<string, any>;
    try { next = { ...PREF_DEFAULTS, ...JSON.parse(localStorage.getItem(key) || '{}') }; }
    catch { next = { ...PREF_DEFAULTS }; }
    cache = next;
    cacheKey = key;
    return next;
}

/** Read one preference (falls back to its default). */
export function getPref(key: string): any {
    const v = all()[key];
    return v === undefined ? (PREF_DEFAULTS as Record<string, any>)[key] : v;
}

/** Merge and persist a set of preferences. */
export function setPrefs(obj: Partial<PrefValues> & Record<string, any>): void {
    cache = { ...all(), ...obj };
    cacheKey = storageKey();
    try { localStorage.setItem(storageKey(), JSON.stringify(cache)); } catch { /* private mode */ }
}

/** Reset all preferences to their defaults. */
export function resetPrefs(): void {
    cache = { ...PREF_DEFAULTS };
    cacheKey = storageKey();
    try { localStorage.removeItem(storageKey()); } catch { /* private mode */ }
}
