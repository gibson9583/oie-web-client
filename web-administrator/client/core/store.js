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

/* ---- theme ---- */

export function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('oie-theme', theme); } catch (e) { /* private mode */ }
    setState('theme', theme);
}

export function initTheme() {
    // Light is the default: it matches the classic Swing Administrator look.
    let theme = 'light';
    try { theme = localStorage.getItem('oie-theme') || 'light'; } catch (e) { /* private mode */ }
    document.documentElement.dataset.theme = theme;
    state.theme = theme;
}
