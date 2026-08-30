/*
 * React bridges over the existing framework singletons. These DO NOT
 * reimplement state/routing/theme — they subscribe React to the same
 * core/store.js, core/router.js, core/timezone.js instances that 32 runtime
 * plugins and the not-yet-ported vanilla views still use. This is the strangler
 * seam: one shared framework instance, React just observes it.
 */

import { useSyncExternalStore, useState, useEffect, useReducer, useCallback, useRef } from 'react';
import * as store from '../core/store.js';
import * as router from '../core/router.js';
import { timezoneMode, cycleTimezone, resolvedAbbr, onTimezoneChange } from '../core/timezone.js';
import { iconPath } from '../core/icons.js';
import api, { onConnectionChange, isEngineReachable } from '@oie/web-api';

/* ---- store ---- */

// Subscribe a component to one store key. core/store.js notifies per-key on every
// setState; getState returns the stored reference (stable) so getSnapshot is safe.
export function useStoreKey(key: any) {
    return useSyncExternalStore(
        (cb: any) => store.subscribe(key, cb),
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
    const [, force] = useReducer((x: any) => x + 1, 0);
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
        const onRoute = (e: any) => setTitle(e.detail?.meta?.title || '');
        const onSet = (e: any) => { if (e.detail?.title) setTitle(e.detail.title); };
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
    const [, force] = useReducer((x: any) => x + 1, 0);
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
const ENV_COLOR_VARS = ['--rail-bg', '--rail-fg', '--rail-fg-dim', '--topbar-fg'];
let lastEnvColor: any = null;   // remembered so a theme toggle can re-tint

/* Compute the rail/topbar gradients + readable foreground for a color object in
   a given theme (dark dims it). Shared by the live tint and the settings preview
   so they always match. Returns null for an invalid color. */
export function environmentColorVars(colorObj: any, dark: any) {
    if (!colorObj || typeof colorObj !== 'object' || colorObj.red === undefined) return null;
    const clamp = (v: any) => Math.max(0, Math.min(255, Math.round(v)));
    const dimmed = dark ? 0.42 : 1;
    const r = clamp((Number(colorObj.red) || 0) * dimmed);
    const g = clamp((Number(colorObj.green) || 0) * dimmed);
    const b = clamp((Number(colorObj.blue) || 0) * dimmed);
    const shift = (amt: any) => `rgb(${clamp(r + amt)}, ${clamp(g + amt)}, ${clamp(b + amt)})`;
    const darkBg = (0.299 * r + 0.587 * g + 0.114 * b) < 140;   // perceived luminance
    return {
        // One gradient for the whole chrome. There used to be a second, horizontal
        // one for the topbar, which is why a tinted environment showed the same
        // seam as the default palette: two ramps can only agree at a single point.
        // The topbar paints --rail-bg too (viewport-attached), so it samples the
        // top of this one.
        railBg: `linear-gradient(180deg, ${shift(12)} 0%, ${shift(-14)} 100%)`,
        // Dim foreground sits higher than a typical secondary text alpha: on a
        // saturated mid-luminance env color (bright red/green/blue) a 0.6 alpha
        // washes into the background, so the nav items + section labels were hard
        // to read. 0.75 / 0.64 keeps them legible while still reading as "dim".
        fg: darkBg ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.85)',
        fgDim: darkBg ? 'rgba(255, 255, 255, 0.75)' : 'rgba(0, 0, 0, 0.64)'
    };
}

/* sRGB <-> HSL + hex helpers for the dark-surface tint below. */
function rgbToHsl(r: any, g: any, b: any) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
    }
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return [h, s, l];
}
function hslToHex(h: any, s: any, l: any) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
        h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    const hx = (v: any) => Math.max(0, Math.min(255, Math.round((v + m) * 255))).toString(16).padStart(2, '0');
    return `#${hx(r)}${hx(g)}${hx(b)}`;
}
function hexHsl(hex: any) {
    const n = parseInt(hex.slice(1), 16);
    return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/* The dark theme's neutral surfaces (mirrors the :root dark tokens in app.css).
   In dark mode these get recolored to the chosen environment HUE so the main area
   harmonizes with the tinted rail/topbar instead of staying steel-blue. */
const DARK_SURFACE_TOKENS = {
    '--bg0': '#0c1116', '--bg1': '#111922', '--bg2': '#16212c', '--bg3': '#1c2a38',
    '--line': '#233140', '--line-strong': '#2f4254', '--pane-bg': '#16212c', '--statusbar-bg': '#111922'
};

/* Recolor each dark surface to the env color's hue, KEEPING its lightness (so text
   contrast is unchanged) and scaling the tint by the env color's own saturation.
   The tint ramps in by chroma so a near-gray pick stays neutral (the default dark
   palette). Returns null (no tint) for an invalid or low-chroma color. Exported so
   the settings preview can show the same tinted surface the live app uses. */
export function darkSurfaceTint(colorObj: any) {
    if (!colorObj || typeof colorObj !== 'object' || colorObj.red === undefined) return null;
    const [h, s] = rgbToHsl(Number(colorObj.red) || 0, Number(colorObj.green) || 0, Number(colorObj.blue) || 0);
    const strength = Math.max(0, Math.min(1, (s - 0.06) / 0.34));   // 0 below ~0.06 sat, full by 0.40
    if (strength <= 0) return null;
    const out: any = {};
    for (const tok in DARK_SURFACE_TOKENS) {
        const [, ts, tl] = hexHsl((DARK_SURFACE_TOKENS as any)[tok]);
        out[tok] = hslToHex(h, ts * strength, tl);
    }
    return out;
}

export function applyEnvironmentColor(colorObj: any) {
    lastEnvColor = (colorObj && typeof colorObj === 'object' && colorObj.red !== undefined) ? colorObj : null;
    const root = document.documentElement;
    const dark = (root.dataset.theme || 'light') === 'dark';
    const v = lastEnvColor && environmentColorVars(lastEnvColor, dark);

    // Rail / topbar chrome.
    if (!v) {
        ENV_COLOR_VARS.forEach((p: any) => root.style.removeProperty(p));
    } else {
        root.style.setProperty('--rail-bg', v.railBg);
        root.style.setProperty('--rail-fg', v.fg);
        root.style.setProperty('--rail-fg-dim', v.fgDim);
        root.style.setProperty('--topbar-fg', v.fg);
    }

    // Main surfaces: tint the neutral dark palette toward the env hue (dark mode
    // only; light mode and the no-color case keep the default tokens).
    const surf = lastEnvColor && dark ? darkSurfaceTint(lastEnvColor) : null;
    if (surf) {
        for (const tok in surf) root.style.setProperty(tok, surf[tok]);
    } else {
        Object.keys(DARK_SURFACE_TOKENS).forEach((p: any) => root.style.removeProperty(p));
    }
}

// Re-tint when the user toggles light/dark so the dimming tracks the theme.
store.subscribe('theme', () => { if (lastEnvColor) applyEnvironmentColor(lastEnvColor); });

/* Per-user override (Swing SettingsPanelAdministrator): stored as the server user
   preference "backgroundColor", serialized by XStream as <awt-color> XML. Parse
   leniently (any element order) and serialize in XStream's default shape so the
   value round-trips with the Swing administrator. */
export function parseColorPref(xml: any) {
    if (typeof xml !== 'string' || !xml.trim()) return null;
    const num = (tag: any) => { const m = xml.match(new RegExp(`<${tag}>\\s*(-?\\d+)`)); return m ? parseInt(m[1], 10) : null; };
    const red = num('red'), green = num('green'), blue = num('blue');
    if (red === null || green === null || blue === null) return null;
    const alpha = num('alpha');
    return { red, green, blue, alpha: alpha === null ? 255 : alpha };
}

export function serializeColorPref(c: any) {
    if (!c) return '';
    const n = (v: any) => Math.max(0, Math.min(255, Number(v) || 0));
    return `<awt-color>\n  <red>${n(c.red)}</red>\n  <green>${n(c.green)}</green>\n  <blue>${n(c.blue)}</blue>\n  <alpha>${c.alpha == null ? 255 : n(c.alpha)}</alpha>\n</awt-color>`;
}

/* ---- server identity (top-right chip + status bar) ---- */

export function useServerIdentity() {
    const [info, setInfo] = useState<any>(null);
    useEffect(() => {
        let alive = true;
        const userId = store.getState('user')?.id;
        Promise.all([
            api.server.version(),
            // Swing reads the identity fields (environment/server name) and the
            // default background color from the PUBLIC settings, which every
            // user may fetch — full /server/settings needs a permission and is
            // kept only as the fallback for engines that predate
            // /server/publicSettings.
            api.server.publicSettings().catch(() => api.server.settings()).catch(() => null),
            // Single-key RAW read, mirroring Swing's getUserPreference(id,
            // "backgroundColor"). The bulk getPreferences runs through api.js
            // unwrap() (collapses a one-entry Properties map to a scalar) and
            // parseBody would turn the <awt-color> XML into an object — both drop
            // the value. The raw per-key read returns the string verbatim.
            userId != null ? api.users.getPreference(userId, 'backgroundColor', { raw: true }).catch(() => null) : Promise.resolve(null)
        ])
            .then(([version, settings, bgPref]) => {
                if (!alive) return;
                store.setState('serverVersion', version);
                // The user's personal override wins over the server default.
                const override = parseColorPref(bgPref);
                applyEnvironmentColor(override || (settings && settings.defaultAdministratorBackgroundColor));
                setInfo({ version, settings });
            })
            .catch(() => { if (alive) setInfo({ error: true }); });
        return () => { alive = false; };
    }, []);
    return info;
}

/* ---- connection status (the topbar chip's pip) ----------------------------
 * Four states, from two independent signals:
 *
 *   offline       the BROWSER has no network — nothing else is worth saying
 *   unreachable   the browser is online but engine requests are failing
 *   reconnecting  a recovery probe is in flight
 *   ok            requests are getting answers
 *
 * The offline/unreachable split is the point: they look identical on a frozen
 * screen and call for completely different responses.
 *
 * Failure is observed passively, from traffic the app already makes (see
 * core/api.js). Only RECOVERY is polled, because nothing else would reveal it —
 * and by then the engine session is likely gone anyway, so the probe cannot be
 * accused of holding one open. Backoff keeps a long outage cheap.
 */

const PROBE_BASE_SECONDS = 3;
const PROBE_MAX_SECONDS = 30;

export function useConnectionStatus() {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' || navigator.onLine !== false));
    const [reachable, setReachable] = useState(isEngineReachable);
    const [probing, setProbing] = useState(false);
    const [retryIn, setRetryIn] = useState<any>(null);
    // Bumped after every probe so the countdown effect re-arms for the next round.
    const [round, setRound] = useState(0);
    const attemptRef = useRef(0);

    useEffect(() => onConnectionChange(setReachable), []);

    useEffect(() => {
        const up = () => setOnline(true);
        const down = () => setOnline(false);
        window.addEventListener('online', up);
        window.addEventListener('offline', down);
        return () => {
            window.removeEventListener('online', up);
            window.removeEventListener('offline', down);
        };
    }, []);

    /* Any answer at all flips reachability through core/api.js's send(), so the
       probe deliberately ignores its own result — including a 401, which means the
       engine is up and the session expired, and is onSessionExpired's story to tell. */
    const probe = useCallback(async () => {
        setProbing(true);
        try { await api.server.version(); } catch { /* the listener already recorded it */ }
        setProbing(false);
        setRound((n: any) => n + 1);
    }, []);

    useEffect(() => {
        if (reachable) { attemptRef.current = 0; setRetryIn(null); return; }
        if (!online) { setRetryIn(null); return; }   // no point probing a dead NIC

        const delay = Math.min(PROBE_MAX_SECONDS, PROBE_BASE_SECONDS * 2 ** attemptRef.current);
        attemptRef.current += 1;
        let left = delay;
        setRetryIn(left);
        const timer = setInterval(() => {
            left -= 1;
            if (left > 0) { setRetryIn(left); return; }
            clearInterval(timer);
            setRetryIn(null);
            probe();
        }, 1000);
        return () => clearInterval(timer);
    }, [reachable, online, round, probe]);

    // Coming back onto the network is worth an immediate look rather than a wait.
    useEffect(() => {
        if (online && !reachable) { attemptRef.current = 0; probe(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [online]);

    const state = !online ? 'offline'
        : probing ? 'reconnecting'
            : reachable ? 'ok' : 'unreachable';

    return { state, retryIn, retryNow: probe };
}

/* ---- engine restart watch (ported from app.js initRestartWatch) ---- */

const RESTART_KEY = 'oie-restart-pending';

async function extensionSignature() {
    const [connectors, plugins] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
    const names = (map: any) => api.asList(map && map.entry)
        .map((entry: any) => Object.values(entry).find((v: any) => typeof v === 'string'))
        .filter(Boolean);
    return JSON.stringify([...names(connectors).sort(), ...names(plugins).sort()]);
}

// Returns { state: 'hidden'|'waiting'|'offline'|'done', dismiss }. Arms on the
// webadmin:restart-pending window event and resumes after a reload.
export function useRestartWatch() {
    const [state, setState] = useState('hidden');
    useEffect(() => {
        let timer: any = null;
        const stop = () => {
            try { localStorage.removeItem(RESTART_KEY); } catch { /* private mode */ }
            if (timer) { clearInterval(timer); timer = null; }
        };
        const poll = async () => {
            let saved: any = null;
            try { saved = JSON.parse(localStorage.getItem(RESTART_KEY) as any); } catch { /* corrupt */ }
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
        let saved: any = null;
        try { saved = JSON.parse(localStorage.getItem(RESTART_KEY) as any); } catch { /* none */ }
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

export function Icon({ name, size = 16 }: any) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
            strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d={iconPath(name)} />
        </svg>
    );
}
