/*
 * Minimal app state: a key/value store with subscriptions, plus a global
 * event bus. Views and plugins share session/server state through this.
 */

const state = {};
const subs = {};

export function setState(key, value) {
    state[key] = value;
    (subs[key] || []).forEach(fn => fn(value));
}

export function getState(key) { return state[key]; }

export function subscribe(key, fn) {
    (subs[key] = subs[key] || []).push(fn);
    return () => { subs[key] = subs[key].filter(f => f !== fn); };
}

/* ---- event bus ---- */

const bus = new EventTarget();

export function emit(event, detail) {
    bus.dispatchEvent(new CustomEvent(event, { detail }));
}

export function on(event, fn) {
    const handler = (e) => fn(e.detail);
    bus.addEventListener(event, handler);
    return () => bus.removeEventListener(event, handler);
}

/* ---- per-user, per-server scope for local (localStorage) settings ---- */

// EVERY local setting (system prefs, theme, rail state) is namespaced by BOTH the
// engine's server id and the signed-in user id, so (a) the same browser pointed at
// a different engine, and (b) two users sharing one browser, each keep their own
// settings. Set at login, before the shell/views render; empty pre-login (falls
// back to the bare/global key).
let serverNamespace = '';
let userNamespace = '';

export function setPrefScope(serverId, userId) {
    serverNamespace = serverId ? String(serverId).trim() : '';
    userNamespace = (userId != null && userId !== '') ? String(userId).trim() : '';
}

export function scopedKey(base) {
    let key = base;
    if (serverNamespace) key += `:${serverNamespace}`;
    if (userNamespace) key += `:${userNamespace}`;
    return key;
}

/* ---- theme ---- */

// A theme is 'light' | 'dark'. A deployment skin (config `skin` — THEMING.md)
// restyles what those mean; it is server-linked into the shell and is NOT part
// of this value, so the toggle and the Settings dropdown never disturb it.

// Global "last used" theme — applied instantly at boot before the server/user are
// known, so first paint never flashes light->dark, and a pre-scope saved theme
// carries over.
const THEME_LAST_KEY = 'oie-theme';
// Set when a user explicitly picks a theme. Needed because pre-login scopedKey()
// falls back to the bare key — the very key the last-used cache writes on every
// boot — so "is there a stored theme" cannot distinguish a user's choice from
// boot's own cache without this marker.
const THEME_CHOSEN_KEY = 'oie-theme-chosen';

// Stored values may predate this build (a briefly-shipped '<skinId>:mode' form);
// reduce anything to a plain mode.
const asMode = (value) => (String(value || '').split(':').pop() === 'dark' ? 'dark' : 'light');

// Apply a theme WITHOUT recording it as the user's choice — boot restore and the
// server's defaultTheme come through here, so a deployment can later change its
// default and still reach every user who never picked one themselves.
export function applyTheme(value) {
    const mode = asMode(value);
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem(THEME_LAST_KEY, mode); } catch { /* private mode */ }
    setState('theme', mode);
}

export function setTheme(theme) {
    applyTheme(theme);
    try {
        localStorage.setItem(scopedKey('oie-theme'), asMode(theme));   // this user's theme on this server
        localStorage.setItem(THEME_CHOSEN_KEY, '1');                   // an explicit choice was made here
    } catch { /* private mode */ }
}

export function initTheme() {
    // Pre-login the server/user are unknown, so apply the last-used theme instantly
    // (no flash). reapplyScopedSettings() reconciles to this user's saved theme once
    // the server id + user are known. Light is the default (classic Swing look).
    let theme = 'light';
    try { theme = localStorage.getItem(THEME_LAST_KEY) || 'light'; } catch { /* private mode */ }
    applyTheme(theme);
}

// The server's defaultTheme (from /webadmin/config.json), applied only when no
// explicit choice stands — a user's own pick always wins. Post-login the scoped
// key IS this user's choice; pre-login the scope is bare and the same key holds
// boot's last-used cache, so the chosen-marker decides instead (meaning the
// login screen keeps the previous person's look on a shared browser, exactly as
// the last-used cache always has).
export function applyConfigTheme(config) {
    if (!config || !config.defaultTheme) return;
    try {
        const scoped = scopedKey('oie-theme');
        const chosen = scoped !== THEME_LAST_KEY
            ? localStorage.getItem(scoped)
            : localStorage.getItem(THEME_CHOSEN_KEY);
        if (chosen) return;
    } catch { /* private mode */ }
    if (asMode(config.defaultTheme) !== state.theme) applyTheme(config.defaultTheme);
}

/* ---- table density ---- */

export const TABLE_DENSITIES = ['compact', 'normal', 'wide'];

/* On <html> so it also reaches grids rendered inside dialogs, which Radix portals
   outside the app tree. */
export function setTableDensity(density) {
    const value = TABLE_DENSITIES.includes(density) ? density : 'normal';
    document.documentElement.dataset.tableDensity = value;
    setState('tableDensity', value);
}

/* ---- left nav (rail) collapse ---- */

// Phone/tablet: the rail is an off-canvas drawer that starts closed (content
// full-width), independent of the saved desktop open/closed preference.
function narrowViewport() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 768px)').matches;
}

export function setRailCollapsed(collapsed) {
    try { localStorage.setItem(scopedKey('oie-rail-collapsed'), collapsed ? '1' : '0'); } catch { /* private mode */ }
    setState('railCollapsed', !!collapsed);
}

export function initRailCollapsed() {
    let collapsed = false;
    try { collapsed = localStorage.getItem(scopedKey('oie-rail-collapsed')) === '1'; } catch { /* private mode */ }
    if (narrowViewport()) collapsed = true;   // drawer starts closed on small screens
    state.railCollapsed = collapsed;
}

// Reconcile the boot-applied local settings (theme, rail) to this user's saved
// values once the server id + user are known (post-login). The system prefs
// (core/prefs.js) read lazily and pick up the scope on their next access.
export function reapplyScopedSettings() {
    try {
        const t = localStorage.getItem(scopedKey('oie-theme'));
        if (t && t !== state.theme) setTheme(t);
    } catch { /* private mode */ }
    if (!narrowViewport()) {   // on a drawer viewport, leave the rail closed (initRailCollapsed)
        try {
            const r = localStorage.getItem(scopedKey('oie-rail-collapsed'));
            if (r !== null) setRailCollapsed(r === '1');
        } catch { /* private mode */ }
    }
}
