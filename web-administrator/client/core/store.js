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

// Global "last used" theme — applied instantly at boot before the server/user are
// known, so first paint never flashes light->dark, and a pre-scope saved theme
// carries over.
const THEME_LAST_KEY = 'oie-theme';

export function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem(scopedKey('oie-theme'), theme);   // this user's theme on this server
        localStorage.setItem(THEME_LAST_KEY, theme);           // last-used, for the next boot
    } catch { /* private mode */ }
    setState('theme', theme);
}

export function initTheme() {
    // Pre-login the server/user are unknown, so apply the last-used theme instantly
    // (no flash). reapplyScopedSettings() reconciles to this user's saved theme once
    // the server id + user are known. Light is the default (classic Swing look).
    let theme = 'light';
    try { theme = localStorage.getItem(THEME_LAST_KEY) || 'light'; } catch { /* private mode */ }
    document.documentElement.dataset.theme = theme;
    state.theme = theme;
}

/* ---- left nav (rail) collapse ---- */

export function setRailCollapsed(collapsed) {
    try { localStorage.setItem(scopedKey('oie-rail-collapsed'), collapsed ? '1' : '0'); } catch { /* private mode */ }
    setState('railCollapsed', !!collapsed);
}

export function initRailCollapsed() {
    let collapsed = false;
    try { collapsed = localStorage.getItem(scopedKey('oie-rail-collapsed')) === '1'; } catch { /* private mode */ }
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
    try {
        const r = localStorage.getItem(scopedKey('oie-rail-collapsed'));
        if (r !== null) setRailCollapsed(r === '1');
    } catch { /* private mode */ }
}
