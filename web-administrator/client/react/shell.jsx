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
import { h, icon, modal, toast, contextMenu } from '@oie/web-ui';
import api, { onSessionExpired, resetSessionExpired } from '@oie/web-api';
import { platform, loadPlugins } from '@oie/web-shell';
import { LoginForm } from './views/login.jsx';
import { openEditUserModal, openChangePasswordModal } from './views/user-modals.js';
import { maybeShowWelcome } from './welcome.js';

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
            h('div.flex.items-center.gap-2.mb-[14px]', h('img', { src: '/assets/oie_logo_bottom_text.svg', alt: 'Open Integration Engine', style: { width: '120px', margin: '0 auto', display: 'block' } })),
            entries.length ? kv : h('div.text-text-dim', `Web Administrator v${(store.getState('webadminConfig') || {}).version || ''} — engine v${store.getState('serverVersion') || '?'}`)),
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
        // RBAC: hide a view the user isn't authorized for (Swing's "view" task pane).
        if (item.task && !platform.checkTask('view', item.task)) continue;
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
    // RBAC: each "other" task can be hidden (Swing's otherPane). checkTask returns
    // true unless an authorization plugin denies the (group, task).
    const can = (task) => platform.checkTask('other', task);
    return (
        <RailPane title="Other" paneKey="Other" group="other">
            <div className="taskbar">
                {can('goToUserAPI') && <button className="btn" onClick={openApiDocs}><Icon name="file" />View REST API</button>}
                {can('goToAbout') && <button className="btn" onClick={showAbout}><Icon name="info" />About</button>}
                {can('goToMirth') && <button className="btn" onClick={() => window.open(HOMEPAGE_URL, '_blank')}><Icon name="globe" />Visit homepage</button>}
                {can('doReportIssue') && <button className="btn" onClick={() => window.open(ISSUES_URL, '_blank')}><Icon name="warning" />Report issue</button>}
                <span className="sep" />
                {can('doLogout') && <button className="btn" onClick={onLogout}><Icon name="logout" />Logout</button>}
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
    const railCollapsed = useStoreKey('railCollapsed');
    return (
        <header className="topbar">
            <button className="icon-btn rail-toggle"
                title={railCollapsed ? 'Show navigation' : 'Hide navigation'}
                onClick={() => store.setRailCollapsed(!railCollapsed)}>
                <Icon name="menu" />
            </button>
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
            <UserMenu user={user} onLogout={onLogout} />
        </header>
    );
}

/* Top-right account menu (replaces the old logout-only chip, which read as a
   "go to profile" button — issue #8). The chip shows who's signed in; clicking
   opens an account menu with self-service Edit Account / Change Password, a
   jump to Administrator Settings, and Sign out. */
function UserMenu({ user, onLogout }) {
    const btnRef = useRef(null);
    const openMenu = () => {
        const me = store.getState('user') || user;
        const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(' ');
        const r = btnRef.current.getBoundingClientRect();
        // Re-read the current user after a self-edit so the chip/status bar update.
        const refreshMe = async () => {
            try { const u = await api.auth.current(); if (u && u.username) store.setState('user', u); }
            catch { /* keep current */ }
        };
        contextMenu(r.right, r.bottom + 4, [
            { header: true, label: me?.username || 'user', sub: fullName || null },
            '-',
            { label: 'Edit Account', icon: 'edit', onClick: () => openEditUserModal(store.getState('user') || me, { onSaved: refreshMe }) },
            { label: 'Change Password', icon: 'key', onClick: () => openChangePasswordModal(store.getState('user') || me) },
            { label: 'Settings', icon: 'settings', task: 'doShowSettings', group: 'view', onClick: () => router.navigate('/settings?tab=administrator') },
            '-',
            { label: 'Sign out', icon: 'logout', task: 'doLogout', group: 'other', onClick: onLogout }
        ], 'view');
    };
    return (
        <button className="user-chip" ref={btnRef} onClick={openMenu} aria-haspopup="menu" title="Account">
            <Icon name="users" /><span>{user?.username || 'user'}</span><Icon name="chevD" size={14} />
        </button>
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
    return <footer className="statusbar"><span>{left}</span><span className="ml-auto">{clock}</span></footer>;
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
            // Land on the dashboard for a bare root URL; a deep link (refresh /
            // bookmark of /channels/x/edit) is left intact for the router to match.
            if (router.currentPath() === '/') history.replaceState(null, '', '/dashboard');
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
    const railCollapsed = useStoreKey('railCollapsed');

    // On phone/tablet the rail is an off-canvas drawer — close it after navigating
    // (transient, so the desktop open/closed preference isn't overwritten).
    useEffect(() => {
        const close = () => {
            if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
                store.setState('railCollapsed', true);
            }
        };
        window.addEventListener('route:changed', close);
        return () => window.removeEventListener('route:changed', close);
    }, []);

    return (
        <div className={'shell' + (railCollapsed ? ' rail-collapsed' : '')}>
            <aside className="rail">
                <div className="rail-brand">
                    <img src="/assets/oie_white_logo_banner_text_215x30.png" alt="Open Integration Engine"
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
            {/* Off-canvas drawer backdrop (phone/tablet only via CSS) — tap to close. */}
            <div className="rail-backdrop" onClick={() => store.setState('railCollapsed', true)} />
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

/* Login Notification + consent modal (Swing CustomBannerPanelDialog). Resolves
   true when the user accepts, false on decline / dismiss. */
function loginNotificationDialog(message) {
    return new Promise((resolve) => {
        modal({
            title: 'Login Notification',
            body: h('div', { style: { whiteSpace: 'pre-wrap', maxWidth: '540px', maxHeight: '55vh', overflow: 'auto', lineHeight: '1.55' } }, String(message ?? '')),
            onClose: () => resolve(false),
            buttons: [
                { label: 'I Decline', onClick: () => resolve(false) },
                { label: 'I Accept', primary: true, onClick: () => resolve(true) }
            ]
        });
    });
}

/* Scope the local settings (system prefs, theme, rail state) to the connected
   engine's server id AND the signed-in user, so a different engine — or a different
   user on the same browser — keeps them separate. Runs before the authed shell
   (and its views) render. */
async function establishPrefScope(user) {
    let id = null;
    try { id = await api.server.id(); } catch { /* fall back to the un-scoped key */ }
    store.setPrefScope(id, user && user.id);
    store.reapplyScopedSettings();
}

export function App() {
    const user = useStoreKey('user');
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        store.initTheme();
        store.initRailCollapsed();
        initSplitters();
        let alive = true;
        (async () => {
            try {
                const u = await api.auth.current();
                if (u && u.username && alive) {
                    await establishPrefScope(u);   // scope prefs/theme to server+user before views render
                    if (alive) store.setState('user', u);
                }
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
        store.setPrefScope(null, null);   // next sign-in re-scopes to that user
        resetSessionExpired();
        history.replaceState(null, '', '/');
    };

    const onLoginSuccess = async (u) => {
        // Login notification + consent (Swing LoginPanel.handleSuccess): when the
        // server requires it, the user must accept the message before entering;
        // declining logs them back out.
        try {
            const pub = await api.server.publicSettings();
            const enabled = pub && (pub.loginNotificationEnabled === true || pub.loginNotificationEnabled === 'true');
            if (enabled && String(pub.loginNotificationMessage ?? '').trim()) {
                const accepted = await loginNotificationDialog(pub.loginNotificationMessage);
                if (!accepted) {
                    await api.auth.logout().catch(() => {});
                    toast('Login canceled — you must accept the notification to continue.', 'warn');
                    return;
                }
                if (u && u.id != null) api.users.acknowledgeNotification(u.id).catch(() => {});
            }
        } catch { /* public settings unavailable — don't block login */ }
        resetSessionExpired();
        store.setState('navGuard', null);
        // First-login wizard (Swing FirstLoginDialog): prompt for a password +
        // profile when the engine's "firstlogin" user preference is set. Fails
        // open internally, but guard here too so it can never block sign-in.
        try { await maybeShowWelcome(u); } catch { /* never block login on the welcome wizard */ }
        await establishPrefScope(u);   // scope prefs/theme to server+user before the shell renders
        store.setState('user', u);
    };

    if (!authChecked) return <BootSplash />;
    if (!user) return <LoginForm onSuccess={onLoginSuccess} />;
    return <AppShell user={user} onLogout={onLogout} />;
}
