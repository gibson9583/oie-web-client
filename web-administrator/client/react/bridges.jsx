/*
 * React bridges over the existing framework singletons. These DO NOT
 * reimplement state/routing/theme — they subscribe React to the same
 * core/store.js, core/router.js, core/timezone.js instances that 32 runtime
 * plugins and the not-yet-ported vanilla views still use. This is the strangler
 * seam: one shared framework instance, React just observes it.
 */

import { useSyncExternalStore, useState, useEffect, useReducer } from 'react';
import * as store from '../core/store.js';
import * as router from '../core/router.js';
import { timezoneMode, cycleTimezone, resolvedAbbr, onTimezoneChange } from '../core/timezone.js';
import { iconPath } from '../core/icons.js';
import api from '@oie/web-api';

/* ---- store ---- */

// Subscribe a component to one store key. core/store.js notifies per-key on every
// setState; getState returns the stored reference (stable) so getSnapshot is safe.
export function useStoreKey(key) {
    return useSyncExternalStore(
        (cb) => store.subscribe(key, cb),
        () => store.getState(key)
    );
}

/* ---- theme (default light = Swing parity) ---- */

export function useTheme() {
    const theme = useStoreKey('theme') || 'light';
    const toggle = () => store.setTheme(theme === 'light' ? 'dark' : 'light');
    return { theme, toggle };
}

/* ---- timezone toggle (Server / Local / UTC) ---- */

export function useTimezone() {
    const [, force] = useReducer((x) => x + 1, 0);
    // onTimezoneChange returns an unsubscribe.
    useEffect(() => onTimezoneChange(force), []);
    return { mode: timezoneMode(), abbr: resolvedAbbr(), cycle: cycleTimezone };
}

/* ---- view title (blue strip) ----
 * route:changed sets the static route title first; views then refine it via
 * webadmin:set-title (e.g. "Channel Messages - Test"). Same precedence as the
 * vanilla shell. Also keeps document.title in sync.
 */
export function useViewTitle() {
    const [title, setTitle] = useState('');
    useEffect(() => {
        const onRoute = (e) => setTitle(e.detail?.meta?.title || '');
        const onSet = (e) => { if (e.detail?.title) setTitle(e.detail.title); };
        window.addEventListener('route:changed', onRoute);
        window.addEventListener('webadmin:set-title', onSet);
        return () => {
            window.removeEventListener('route:changed', onRoute);
            window.removeEventListener('webadmin:set-title', onSet);
        };
    }, []);
    useEffect(() => {
        document.title = (title ? title + ' — ' : '') + 'OIE Administrator';
    }, [title]);
    return title;
}

/* ---- current route (for nav active-state) ----
 * Re-reads on every navigation. Plugins/views register late, so also re-render
 * when webPlugins lands (loadPlugins sets it) to surface plugin nav items.
 */
export function useRouteChange() {
    const [, force] = useReducer((x) => x + 1, 0);
    useStoreKey('webPlugins');   // re-render when plugins finish registering
    useEffect(() => {
        window.addEventListener('route:changed', force);
        return () => window.removeEventListener('route:changed', force);
    }, []);
    return router.currentPath();
}

/* ---- environment background color (Swing ServerSettings.defaultAdministrator-
   BackgroundColor → Frame.setupBackgroundPainters): tints the rail/task panes +
   the topbar/view-title with the server's color so environments are visually
   distinct. Theme-aware — dark mode dims the color into a deep tint that fits the
   dark theme; light mode uses it close to as-is (like Swing's blue task panes).
   Foreground is luminance-picked so text stays readable on any color. */
const ENV_COLOR_VARS = ['--rail-bg', '--topbar-bg', '--rail-fg', '--rail-fg-dim', '--topbar-fg'];
let lastEnvColor = null;   // remembered so a theme toggle can re-tint

/* Compute the rail/topbar gradients + readable foreground for a color object in
   a given theme (dark dims it). Shared by the live tint and the settings preview
   so they always match. Returns null for an invalid color. */
export function environmentColorVars(colorObj, dark) {
    if (!colorObj || typeof colorObj !== 'object' || colorObj.red === undefined) return null;
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const dimmed = dark ? 0.42 : 1;
    const r = clamp((Number(colorObj.red) || 0) * dimmed);
    const g = clamp((Number(colorObj.green) || 0) * dimmed);
    const b = clamp((Number(colorObj.blue) || 0) * dimmed);
    const shift = (amt) => `rgb(${clamp(r + amt)}, ${clamp(g + amt)}, ${clamp(b + amt)})`;
    const darkBg = (0.299 * r + 0.587 * g + 0.114 * b) < 140;   // perceived luminance
    return {
        railBg: `linear-gradient(180deg, ${shift(12)} 0%, ${shift(-14)} 100%)`,
        topbarBg: `linear-gradient(90deg, ${shift(-6)} 0%, ${shift(10)} 100%)`,
        fg: darkBg ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.85)',
        fgDim: darkBg ? 'rgba(255, 255, 255, 0.60)' : 'rgba(0, 0, 0, 0.55)'
    };
}

export function applyEnvironmentColor(colorObj) {
    lastEnvColor = (colorObj && typeof colorObj === 'object' && colorObj.red !== undefined) ? colorObj : null;
    const root = document.documentElement;
    const v = lastEnvColor && environmentColorVars(lastEnvColor, (root.dataset.theme || 'light') === 'dark');
    if (!v) {
        ENV_COLOR_VARS.forEach((p) => root.style.removeProperty(p));
        return;
    }
    root.style.setProperty('--rail-bg', v.railBg);
    root.style.setProperty('--topbar-bg', v.topbarBg);
    root.style.setProperty('--rail-fg', v.fg);
    root.style.setProperty('--rail-fg-dim', v.fgDim);
    root.style.setProperty('--topbar-fg', v.fg);
}

// Re-tint when the user toggles light/dark so the dimming tracks the theme.
store.subscribe('theme', () => { if (lastEnvColor) applyEnvironmentColor(lastEnvColor); });

/* Per-user override (Swing SettingsPanelAdministrator): stored as the server user
   preference "backgroundColor", serialized by XStream as <awt-color> XML. Parse
   leniently (any element order) and serialize in XStream's default shape so the
   value round-trips with the Swing administrator. */
export function parseColorPref(xml) {
    if (typeof xml !== 'string' || !xml.trim()) return null;
    const num = (tag) => { const m = xml.match(new RegExp(`<${tag}>\\s*(-?\\d+)`)); return m ? parseInt(m[1], 10) : null; };
    const red = num('red'), green = num('green'), blue = num('blue');
    if (red === null || green === null || blue === null) return null;
    const alpha = num('alpha');
    return { red, green, blue, alpha: alpha === null ? 255 : alpha };
}

export function serializeColorPref(c) {
    if (!c) return '';
    const n = (v) => Math.max(0, Math.min(255, Number(v) || 0));
    return `<awt-color>\n  <red>${n(c.red)}</red>\n  <green>${n(c.green)}</green>\n  <blue>${n(c.blue)}</blue>\n  <alpha>${c.alpha == null ? 255 : n(c.alpha)}</alpha>\n</awt-color>`;
}

/* ---- server identity (top-right chip + status bar) ---- */

export function useServerIdentity() {
    const [info, setInfo] = useState(null);
    useEffect(() => {
        let alive = true;
        const userId = store.getState('user')?.id;
        Promise.all([
            api.server.version(),
            api.server.settings().catch(() => null),
            userId != null ? api.users.getPreferences(userId).catch(() => null) : Promise.resolve(null)
        ])
            .then(([version, settings, prefs]) => {
                if (!alive) return;
                store.setState('serverVersion', version);
                // The user's personal override wins over the server default.
                const override = prefs && parseColorPref(prefs.backgroundColor);
                applyEnvironmentColor(override || (settings && settings.defaultAdministratorBackgroundColor));
                setInfo({ version, settings });
            })
            .catch(() => { if (alive) setInfo({ error: true }); });
        return () => { alive = false; };
    }, []);
    return info;
}

/* ---- engine restart watch (ported from app.js initRestartWatch) ---- */

const RESTART_KEY = 'oie-restart-pending';

async function extensionSignature() {
    const [connectors, plugins] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
    const names = (map) => api.asList(map && map.entry)
        .map((entry) => Object.values(entry).find((v) => typeof v === 'string'))
        .filter(Boolean);
    return JSON.stringify([...names(connectors).sort(), ...names(plugins).sort()]);
}

// Returns { state: 'hidden'|'waiting'|'offline'|'done', dismiss }. Arms on the
// webadmin:restart-pending window event and resumes after a reload.
export function useRestartWatch() {
    const [state, setState] = useState('hidden');
    useEffect(() => {
        let timer = null;
        const stop = () => {
            try { localStorage.removeItem(RESTART_KEY); } catch { /* private mode */ }
            if (timer) { clearInterval(timer); timer = null; }
        };
        const poll = async () => {
            let saved = null;
            try { saved = JSON.parse(localStorage.getItem(RESTART_KEY)); } catch { /* corrupt */ }
            if (!saved) { stop(); setState('hidden'); return; }
            try {
                const sig = await extensionSignature();
                // The engine is reachable. The restart is complete when EITHER it
                // cycled (we saw it go offline and it's now back) OR the extension
                // list changed. The offline->online transition is the reliable
                // signal: re-installing an already-present extension doesn't change
                // the name list, so the signature alone would never flip and the
                // banner would hang. (See the offline branch below.)
                if (saved.sawOffline || sig !== saved.sig) {
                    setState('done');
                    if (timer) { clearInterval(timer); timer = null; }
                    try { localStorage.removeItem(RESTART_KEY); } catch { /* ok */ }
                } else {
                    setState('waiting');
                }
            } catch {
                // Unreachable — the restart is underway; remember it so the next
                // successful poll counts as "came back".
                try { localStorage.setItem(RESTART_KEY, JSON.stringify({ ...saved, sawOffline: true })); } catch { /* ok */ }
                setState('offline');
            }
        };
        const arm = async () => {
            try {
                const sig = await extensionSignature().catch(() => null);
                localStorage.setItem(RESTART_KEY, JSON.stringify({ sig, ts: Date.now(), sawOffline: false }));
            } catch { /* private mode — still shows this session */ }
            setState('waiting');
            if (!timer) timer = setInterval(poll, 8000);
        };
        window.addEventListener('webadmin:restart-pending', arm);
        // Resume if a restart was pending across a reload.
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(RESTART_KEY)); } catch { /* none */ }
        if (saved) { setState('waiting'); poll(); timer = setInterval(poll, 8000); }
        return () => {
            window.removeEventListener('webadmin:restart-pending', arm);
            if (timer) clearInterval(timer);
        };
    }, []);
    const dismiss = () => {
        try { localStorage.removeItem(RESTART_KEY); } catch { /* ok */ }
        setState('hidden');
    };
    return { state, dismiss };
}

/* ---- icons (build the same <svg> the vanilla icon() does, no wrapper) ---- */

export function Icon({ name, size = 16 }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={iconPath(name)} />
        </svg>
    );
}
