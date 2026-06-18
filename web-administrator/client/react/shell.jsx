/*
 * React application shell — the classic Administrator chrome (rail of task
 * panes, blue topbar, content outlet, status bar), ported from app.js's
 * buildShell. It drives the EXISTING core/router.js (which the legacy views and
 * 32 plugins register into) by handing it the React-rendered outlet; views still
 * return DOM and their taskbars relocate into the rail. The strangler seam.
 */

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
    useStoreKey, useTheme, useTimezone, useViewTitle, useRouteChange,
    useServerIdentity, useRestartWatch, Icon
} from './bridges.jsx';
import { RailPane } from './ui.jsx';
import { setReactTasksHost, reactView } from './mount.jsx';
import * as store from '../core/store.js';
import * as router from '../core/router.js';
import { initSplitters } from '../core/resize.js';
import { h, icon, modal, toast } from '@oie/web-ui';
import api, { onSessionExpired, resetSessionExpired } from '@oie/web-api';
import { platform, loadPlugins } from '@oie/web-shell';
import { LoginForm } from './views/login.jsx';

import { register as registerDashboard } from './views/dashboard.jsx';
import { register as registerChannels } from './views/channels.jsx';
import { register as registerChannelEditor } from './views/channel-editor.jsx';
import { register as registerMessages } from './views/messages.jsx';
import { register as registerEvents } from './views/events.jsx';
import { register as registerAlerts } from './views/alerts.jsx';
import { register as registerUsers } from './views/users.jsx';
import { register as registerSettings } from './views/settings.jsx';
import { register as registerCodeTemplates } from './views/code-templates.jsx';
import { register as registerGlobalScripts } from './views/global-scripts.jsx';
import { register as registerExtensions } from './views/extensions.jsx';
import { register as registerConnectors } from '../connectors/index.js';

const HOMEPAGE_URL = 'https://github.com/OpenIntegrationEngine/engine';
const ISSUES_URL = 'https://github.com/OpenIntegrationEngine/engine/issues';

/* ---- engine bootstrap (once) — mirrors app.js startApp registration block ---- */

let engineStarted = null;
function startEngine() {
    if (engineStarted) return engineStarted;
    engineStarted = (async () => {
        // Share the host's React with plugins (so plugin components use the same
        // instance the app renders with). Set before any plugin/view registers.
        platform.React = React;
        // Lets a plugin register a full routed view from a React component:
        // platform.registerView(path, platform.reactView(MyView), { title }).
        platform.reactView = reactView;

        try {
            const res = await fetch('/webadmin/config.json');
            if (res.ok) store.setState('webadminConfig', await res.json());
        } catch { /* optional */ }

        // Warm Monaco in the background; air-gapped installs keep the baseline editor.
        import('../core/monaco.js').then((m) => m.ensureMonaco()).catch(() => {});

        registerConnectors(platform);
        registerDashboard(platform);
        registerChannels(platform);
        registerChannelEditor(platform);
        registerMessages(platform);
        registerEvents(platform);
        registerAlerts(platform);
        registerUsers(platform);
        registerSettings(platform);
        registerCodeTemplates(platform);
        registerGlobalScripts(platform);
        registerExtensions(platform);

        router.setNotFound(() => h('div.view', h('div.view-body',
            h('div.dt-empty', h('div.empty-icon', icon('search', 30)), 'View not found'))));

        router.setGuard(async (ctx) => {
            const guard = store.getState('navGuard');
            if (typeof guard === 'function') return await guard(ctx);
        });

        await loadPlugins();
    })();
    return engineStarted;
}

/* ---- Other-pane actions (ported from app.js) ---- */

function openApiDocs() {
    const config = store.getState('webadminConfig') || {};
    window.open((config.engineUrl || '') + '/api/', '_blank');
}

async function showAbout() {
    let about = null;
    try { about = await api.server.about(); } catch { /* show what we can */ }
    const entries = [];
    if (about && typeof about === 'object') {
        const raw = about.entry ? api.asList(about.entry) : Object.entries(about).map(([k, v]) => ({ string: [k, v] }));
        for (const entry of raw) {
            if (entry.string && Array.isArray(entry.string)) entries.push([entry.string[0], entry.string[1]]);
            else if (Array.isArray(entry)) entries.push(entry);
        }
    }
    const kv = h('dl.kv');
    entries.forEach(([k, v]) => { kv.appendChild(h('dt', String(k))); kv.appendChild(h('dd', String(v ?? ''))); });
    modal({
        title: 'About Open Integration Engine',
        body: h('div',
            h('div.flex.mb', h('img', { src: 'assets/oie_logo_bottom_text.svg', alt: 'Open Integration Engine', style: { width: '120px', margin: '0 auto', display: 'block' } })),
            entries.length ? kv : h('div.muted', `Web Administrator v${(store.getState('webadminConfig') || {}).version || ''} — engine v${store.getState('serverVersion') || '?'}`)),
        buttons: [{ label: 'Close', primary: true }]
    });
}

/* ---- rail ---- */

// Nav panes, grouped by section. `only`/`exclude` split the Engine pane (top)
// from plugin panes (below the contextual task panes) — matching app.js order.
function Nav({ only, exclude }) {
    const current = useRouteChange();
    const sections = new Map();
    for (const item of platform.navItems()) {
        const section = item.section || 'Plugins';
        if (only && section !== only) continue;
        if (exclude && section === exclude) continue;
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section).push(item);
    }
    const ordered = [...sections.keys()].sort((a, b) =>
        (a === 'Engine' ? -1 : b === 'Engine' ? 1 : a.localeCompare(b)));
    return (
        <>
            {ordered.map((section) => (
                <RailPane key={section} title={section} paneKey={section}>
                    {sections.get(section).map((item) => {
                        const active = current === item.path || current.startsWith(item.path + '/') ||
                            (item.match && item.match(current));
                        return (
                            <button key={item.id || item.path}
                                className={'rail-item' + (active ? ' active' : '')}
                                onClick={() => router.navigate(item.path)}>
                                <Icon name={item.icon || 'puzzle'} size={15} />
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </RailPane>
            ))}
        </>
    );
}

function OtherPane({ onLogout }) {
    return (
        <RailPane title="Other" paneKey="Other">
            <div className="taskbar">
                <button className="btn" onClick={openApiDocs}><Icon name="file" />View REST API</button>
                <button className="btn" onClick={showAbout}><Icon name="info" />About</button>
                <button className="btn" onClick={() => window.open(HOMEPAGE_URL, '_blank')}><Icon name="globe" />Visit homepage</button>
                <button className="btn" onClick={() => window.open(ISSUES_URL, '_blank')}><Icon name="warning" />Report issue</button>
                <span className="sep" />
                <button className="btn" onClick={onLogout}><Icon name="logout" />Logout</button>
            </div>
        </RailPane>
    );
}

/* ---- topbar ---- */

function ServerChip({ info }) {
    if (!info) return <div className="server-chip"><span className="pip ok" /><span>…</span></div>;
    if (info.error) return <div className="server-chip"><span className="pip err" /><span>engine unreachable</span></div>;
    const { version, settings } = info;
    const text = `${settings?.environmentName ? settings.environmentName + ' · ' : ''}${settings?.serverName || 'engine'} · v${version}`;
    return <div className="server-chip"><span className="pip ok" /><span>{text}</span></div>;
}

function TopBar({ user, onLogout, serverInfo }) {
    const title = useViewTitle();
    const { theme, toggle } = useTheme();
    const tz = useTimezone();
    const tzLabel = tz.mode.charAt(0).toUpperCase() + tz.mode.slice(1);
    return (
        <header className="topbar">
            <div className="view-title">{title}</div>
            <div className="topbar-spacer" />
            <ServerChip info={serverInfo} />
            <button className="btn tz-toggle"
                title={`Timestamps shown in ${tzLabel} time (${tz.abbr}). Click to cycle Server / Local / UTC.`}
                onClick={() => { tz.cycle(); router.navigate(router.currentPath()); }}>
                <Icon name="clock" /><span>{tzLabel} · {tz.abbr}</span>
            </button>
            <button className="icon-btn" title="Toggle light/dark mode" onClick={toggle}>
                <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>
            <div className="user-chip" onClick={onLogout} title="Sign out">
                <Icon name="users" /><span>{user?.username || 'user'}</span>
            </div>
        </header>
    );
}

/* ---- status bar ---- */

function StatusBar({ user, serverInfo }) {
    const config = useStoreKey('webadminConfig') || {};
    const [clock, setClock] = useState('');
    useEffect(() => {
        const tick = () => setClock(new Intl.DateTimeFormat([], {
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        }).format(new Date()));
        tick();
        const t = setInterval(tick, 30000);
        return () => clearInterval(t);
    }, []);
    let left = 'Connecting…';
    if (serverInfo && !serverInfo.error) {
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
        left = `Connected to: ${config.engineUrl || '/api'} as ${user?.username || ''}` + (name ? ` (${name})` : '');
    } else if (serverInfo && serverInfo.error) {
        left = `Engine unreachable at ${config.engineUrl || '/api'}`;
    }
    return <footer className="statusbar"><span>{left}</span><span className="right">{clock}</span></footer>;
}

/* ---- restart banner ---- */

function RestartBanner() {
    const { state, dismiss } = useRestartWatch();
    if (state === 'hidden') return <div className="restart-banner hidden" />;
    return (
        <div className={'restart-banner' + (state === 'done' ? ' success' : '')}>
            {state === 'waiting' && <>
                <span className="spinner" style={{ width: 13, height: 13 }} />
                <span>Extension change staged — restart the engine to apply. Watching for the engine to come back…</span>
            </>}
            {state === 'offline' && <>
                <span className="spinner" style={{ width: 13, height: 13 }} />
                <span>Engine is restarting…</span>
            </>}
            {state === 'done' && <>
                <Icon name="check" size={14} />
                <span>Engine restarted with updated extensions.</span>
                <button className="btn btn-sm btn-primary" onClick={() => location.reload()}>Reload UI</button>
            </>}
            <button className="icon-btn" style={{ marginLeft: 'auto' }} title="Dismiss" onClick={dismiss}>
                <Icon name="x" size={13} />
            </button>
        </div>
    );
}

/* ---- shell ---- */

function AppShell({ user, onLogout }) {
    const outletRef = useRef(null);
    const reactTasksRef = useRef(null);
    const serverInfo = useServerIdentity();

    // Hand core/router.js the React outlet, start the engine once, then route.
    useEffect(() => {
        setReactTasksHost(reactTasksRef.current);
        let cancelled = false;
        (async () => {
            await startEngine();
            if (cancelled) return;
            router.setOutlet(outletRef.current);
            if (!location.hash || location.hash === '#' || location.hash === '#/') location.hash = '/dashboard';
            router.start();
            // Restamp current view once the engine timezone resolves (skip if a
            // view holds unsaved state behind a nav guard).
            import('../core/timezone.js').then((tz) => tz.loadServerTimezone()).then(() => {
                if (typeof store.getState('navGuard') !== 'function') router.navigate(router.currentPath());
            });
        })();
        return () => { cancelled = true; };
    }, []);

    const railVersion = serverInfo && !serverInfo.error ? `engine v${serverInfo.version}` : '';

    return (
        <div className="shell">
            <aside className="rail">
                <div className="rail-brand">
                    <img src="assets/oie_white_logo_banner_text_215x30.png" alt="Open Integration Engine"
                        style={{ width: 172, height: 'auto', display: 'block' }} />
                </div>
                <div className="rail-panes">
                    <Nav only="Engine" />
                    <div ref={reactTasksRef} />
                    <Nav exclude="Engine" />
                    <OtherPane onLogout={onLogout} />
                </div>
                <div className="rail-foot"><span id="rail-version">{railVersion}</span></div>
            </aside>
            <TopBar user={user} onLogout={onLogout} serverInfo={serverInfo} />
            <div className="content">
                <RestartBanner />
                <main ref={outletRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} />
            </div>
            <StatusBar user={user} serverInfo={serverInfo} />
        </div>
    );
}

/* ---- login + auth gate ---- */

function BootSplash() {
    return (
        <div className="boot-splash">
            <div className="boot-mark" />
            <div className="boot-label">OPEN INTEGRATION ENGINE</div>
        </div>
    );
}

export function App() {
    const user = useStoreKey('user');
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        store.initTheme();
        initSplitters();
        let alive = true;
        (async () => {
            try {
                const u = await api.auth.current();
                if (u && u.username && alive) store.setState('user', u);
            } catch { /* not signed in */ }
            finally { if (alive) setAuthChecked(true); }
        })();
        const off = onSessionExpired(() => {
            // Ignore while already on the login screen (the boot auth-check 401),
            // matching the vanilla shell's loginShowing guard — otherwise a
            // spurious setState re-render can disrupt the login form.
            if (!store.getState('user')) return;
            toast('Session expired — please sign in again', 'warn');
            store.setState('user', null);
        });
        return () => { alive = false; if (typeof off === 'function') off(); };
    }, []);

    const onLogout = async () => {
        try { await api.auth.logout(); } catch { /* session may already be gone */ }
        store.setState('user', null);
        store.setState('navGuard', null);
        resetSessionExpired();
        location.hash = '';
    };

    const onLoginSuccess = (u) => {
        resetSessionExpired();
        store.setState('navGuard', null);
        store.setState('user', u);
    };

    if (!authChecked) return <BootSplash />;
    if (!user) return <LoginForm onSuccess={onLoginSuccess} />;
    return <AppShell user={user} onLogout={onLogout} />;
}
