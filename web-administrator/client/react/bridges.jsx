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

/* ---- server identity (top-right chip + status bar) ---- */

export function useServerIdentity() {
    const [info, setInfo] = useState(null);
    useEffect(() => {
        let alive = true;
        Promise.all([api.server.version(), api.server.settings().catch(() => null)])
            .then(([version, settings]) => {
                if (!alive) return;
                store.setState('serverVersion', version);
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
                if (sig !== saved.sig) {
                    setState('done');
                    if (timer) { clearInterval(timer); timer = null; }
                    try { localStorage.removeItem(RESTART_KEY); } catch { /* ok */ }
                } else {
                    setState('waiting');
                }
            } catch { setState('offline'); }
        };
        const arm = async () => {
            try {
                const sig = await extensionSignature().catch(() => null);
                localStorage.setItem(RESTART_KEY, JSON.stringify({ sig, ts: Date.now() }));
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

const BRAND_MARK_PATH = 'M12 2a10 10 0 1 0 10 10M22 2l-8.5 8.5M22 2h-6M22 2v6M7.5 12A4.5 4.5 0 1 0 12 7.5';

export function BrandMark({ size = 26 }) {
    return (
        <svg className="brand-mark" viewBox="0 0 24 24" width={size} height={size} fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d={BRAND_MARK_PATH} />
        </svg>
    );
}
