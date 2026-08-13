/*
 * React application shell — the classic Administrator chrome (rail of task
 * panes, blue topbar, content outlet, status bar), ported from app.js's
 * buildShell. It drives the EXISTING core/router.js (which the legacy views and
 * 32 plugins register into) by handing it the React-rendered outlet; views still
 * return DOM and their taskbars relocate into the rail. The strangler seam.
 */

import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    useStoreKey, useTheme, useTimezone, useViewTitle, useServerIdentity, useConnectionStatus,
    useRestartWatch, Icon
} from './bridges.jsx';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { NavRail } from './nav-rail.jsx';
import { setReactTasksHost, reactView } from './mount.jsx';
import * as store from '../core/store.js';
import * as router from '../core/router.js';
import { initSplitters } from '../core/resize.js';
import { h, icon, modal, toast, confirmDialog } from '@oie/web-ui';
import { CommandPalette } from './command-palette.jsx';
import { getPref } from '../core/prefs.js';
import api, { onSessionExpired, resetSessionExpired } from '@oie/web-api';
import { startIdleLogout, stopIdleLogout } from '../core/idle-logout.js';
import { getAnchor, describeRef } from '../core/compare.js';
import { registerLoginAuthenticators } from './login-authenticators.js';
import { hasUnsavedWork } from '../core/unsaved.js';
import { stashChannelDraft, peekChannelDraft, clearChannelDraft } from '../core/channel-draft.js';
import { queryClient } from './queries';
import { resetPaneCollapsed } from './ui';
import { disposeDetachedMonaco } from '../core/monaco.js';
import { invalidate as invalidateCompletions, clearActiveScope } from '../core/script-completions.js';
import { platform, loadPlugins } from '@oie/web-shell';
import { LoginForm } from './views/login.jsx';
import { openEditUserModal, openChangePasswordModal } from './views/user-modals.js';
import { maybeShowWelcome } from './welcome.js';

import { register as registerConnectors } from '../connectors/index.js';

const HOMEPAGE_URL = 'https://github.com/OpenIntegrationEngine/engine';
const ISSUES_URL = 'https://github.com/OpenIntegrationEngine/engine/issues';

/* ---- the app's own routes ----------------------------------------------------
 * Registration is EAGER — patterns, meta, match order and the nav items all have
 * to exist before router.start() — but each view MODULE is imported on first
 * navigation, so the initial download is the shell rather than all ~18k lines of
 * views. core/router.js awaits its handlers, so the deferral needs nothing more
 * than an async handler.
 *
 * ORDER IS LOAD-BEARING in two places: ':channelId' compiles to '([^/]+)', which
 * also matches the literal 'new', and the router returns on first match. So
 * '/channels/new/guided' MUST stay ahead of '/channels/:channelId/guided', and
 * likewise for the alert pair — otherwise the wizard still opens but carries the
 * wrong title. Keep each pair adjacent and in this order.
 *
 * Specifiers must stay STRING LITERALS: vite.config.mjs's externalFramework
 * plugin rewrites core/ imports per-module, and it cannot see a computed one —
 * a template literal here would silently produce a second framework instance.
 */
const VIEW_ROUTES = [
    { path: '/dashboard', meta: { title: 'Dashboard' },
        nav: { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard', section: 'Monitor', order: 0, task: 'doShowDashboard' },
        load: () => import('./views/dashboard.jsx'), pick: (m: any) => m.DashboardHost },
    { path: '/channels', meta: { title: 'Channels' },
        nav: { id: 'channels', label: 'Channels', icon: 'channels', path: '/channels', section: 'Design', order: 0, task: 'doShowChannel' },
        load: () => import('./views/channels.jsx'), pick: (m: any) => m.ChannelsView },
    { path: '/channels/:channelId/edit', meta: { title: 'Edit Channel' },
        load: () => import('./views/channel-editor.jsx'), pick: (m: any) => m.ChannelEditorView },
    { path: '/channels/:channelId/filter/:metaDataId', meta: { title: 'Filter' },
        load: () => import('./views/filter-transformer.jsx'), pick: (m: any) => m.FilterView },
    { path: '/channels/:channelId/transformer/:metaDataId', meta: { title: 'Transformer' },
        load: () => import('./views/filter-transformer.jsx'), pick: (m: any) => m.TransformerView },
    { path: '/channels/:channelId/response/:metaDataId', meta: { title: 'Response Transformer' },
        load: () => import('./views/filter-transformer.jsx'), pick: (m: any) => m.ResponseTransformerView },
    { path: '/channels/new/guided', meta: { title: 'New Channel — Wizard' },
        load: () => import('./views/channel-wizard.jsx'), pick: (m: any) => m.ChannelWizardView },
    { path: '/channels/:channelId/guided', meta: { title: 'Channel — Wizard' },
        load: () => import('./views/channel-wizard.jsx'), pick: (m: any) => m.ChannelWizardView },
    /* Channel-less entry to the message browser: the same view, with its channel
       picker as the way in. Registered BEFORE the parameterised route so
       '/messages' cannot be read as a channel id. */
    { path: '/messages', meta: { title: 'Messages' },
        nav: { id: 'messages', label: 'Messages', icon: 'messages', path: '/messages',
            section: 'Monitor', order: 1, task: 'doShowMessages' },
        load: () => import('./views/messages.jsx'), pick: (m: any) => m.MessagesView },
    { path: '/messages/:channelId', meta: { title: 'Messages' },
        load: () => import('./views/messages.jsx'), pick: (m: any) => m.MessagesView },
    { path: '/events', meta: { title: 'Events' },
        nav: { id: 'events', label: 'Events', icon: 'events', path: '/events', section: 'Monitor', order: 3, task: 'doShowEvents' },
        load: () => import('./views/events.jsx'), pick: (m: any) => m.EventsView },
    { path: '/alerts', meta: { title: 'Alerts' },
        nav: { id: 'alerts', label: 'Alerts', icon: 'alerts', path: '/alerts', section: 'Monitor', order: 2, task: 'doShowAlerts' },
        load: () => import('./views/alerts.jsx'), pick: (m: any) => m.AlertsList },
    { path: '/alerts/:alertId/edit', meta: { title: 'Edit Alert' },
        load: () => import('./views/alert-editor.jsx'), pick: (m: any) => m.AlertEditor },
    { path: '/alerts/new/guided', meta: { title: 'New Alert — Wizard' },
        load: () => import('./views/alert-wizard.jsx'), pick: (m: any) => m.AlertWizardView },
    { path: '/alerts/:alertId/guided', meta: { title: 'Alert — Wizard' },
        load: () => import('./views/alert-wizard.jsx'), pick: (m: any) => m.AlertWizardView },
    { path: '/users', meta: { title: 'Users' },
        nav: { id: 'users', label: 'Users', icon: 'users', path: '/users', section: 'Manage', order: 0, task: 'doShowUsers' },
        load: () => import('./views/users.jsx'), pick: (m: any) => m.UsersView },
    { path: '/settings', meta: { title: 'Settings' },
        nav: { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings', section: 'Manage', order: 1, task: 'doShowSettings' },
        load: () => import('./views/settings.jsx'), pick: (m: any) => m.SettingsView },
    { path: '/code-templates', meta: { title: 'Code Templates' },
        nav: { id: 'code-templates', label: 'Code Templates', icon: 'code', path: '/code-templates', section: 'Design', order: 1 },
        load: () => import('./views/code-templates.jsx'), pick: (m: any) => m.CodeTemplatesView },
    { path: '/global-scripts', meta: { title: 'Global Scripts' },
        nav: { id: 'global-scripts', label: 'Global Scripts', icon: 'scripts', path: '/global-scripts', section: 'Design', order: 2 },
        load: () => import('./views/global-scripts.jsx'), pick: (m: any) => m.GlobalScriptsView },
    { path: '/extensions', meta: { title: 'Extensions' },
        nav: { id: 'extensions', label: 'Extensions', icon: 'extensions', path: '/extensions', section: 'Manage', order: 2, task: 'doShowExtensions' },
        load: () => import('./views/extensions.jsx'), pick: (m: any) => m.ExtensionsView },
];

// A route handler that imports its view on first use. The module cache makes
// every later navigation a no-op await, and reactView still builds a fresh root
// per navigation exactly as it did when the component was imported eagerly.
//
// The token check matters on cold deep links: the shell re-navigates once the
// engine timezone resolves, and on a cold load that fires while the chunk is
// still downloading. Mounting the superseded view anyway would install ITS nav
// guard over the surviving view's, and then null the slot entirely when the
// discarded instance unmounts — leaving the visible view unguarded.
function lazyView(load: any, pick: any) {
    return async (ctx: any) => {
        const token = router.navigationToken();
        const mod = await load();
        if (router.navigationToken() !== token) return null;
        return reactView(pick(mod))(ctx);
    };
}

/*
 * The rail's bottom block. These were five inline buttons with no ids, which meant
 * the layout preference could not name them — so they are declared like any nav
 * item and simply carry an `action` instead of a `path`. That also makes rail
 * ACTIONS a thing a plugin can contribute, not just views.
 *
 * `rbac: 'other'` keeps Swing's pane key: these are gated as the "other" group,
 * while views are gated as "view".
 */
const OTHER_ACTIONS = [
    { id: 'rest-api', label: 'View REST API', icon: 'apiDoc', section: 'Other', order: 0,
        task: 'goToUserAPI', rbac: 'other', action: () => openApiDocs() },
    { id: 'about', label: 'About', icon: 'info', section: 'Other', order: 1,
        task: 'goToAbout', rbac: 'other', action: () => showAbout() },
    { id: 'homepage', label: 'Visit homepage', icon: 'globe', section: 'Other', order: 2,
        task: 'goToMirth', rbac: 'other', action: () => window.open(HOMEPAGE_URL, '_blank') },
    { id: 'report-issue', label: 'Report issue', icon: 'bug', section: 'Other', order: 3,
        task: 'doReportIssue', rbac: 'other', action: () => window.open(ISSUES_URL, '_blank') }
    /* Logout is deliberately NOT here. It is chrome, like the customize control:
       both must stay exactly where they are, so neither is hideable, renameable or
       draggable. The rail renders them in its footer strip — see react/nav-rail.jsx. */
];

/* Palette commands. Only the ones that mean something with no view mounted and
   no selection: the create/import entry points (which are routes), the settings
   sections (deep links), and the session actions. A view's selection-dependent
   tasks stay in its task pane, where the selection lives. */
const SETTINGS_TABS = [
    ['Server', 'server'], ['Administrator', 'administrator'], ['Tags', 'tags'],
    ['Configuration Map', 'configurationmap'], ['Database Tasks', 'databasetasks'],
    ['Resources', 'resources'], ['Data Pruner', 'datapruner']
];

function registerCommands(plat: any) {
    /* The wizard routes, which are reachable from anywhere. "New Channel" in the
       Channels view is a chooser (classic vs guided) whose classic path builds a
       channel object the view owns — reproducing that here would fork it, so the
       palette offers the route it can honestly navigate to and says which it is. */
    plat.registerCommand({ id: 'new-channel', label: 'New Channel (Wizard)', icon: 'plus',
        section: 'Create', order: 0, task: 'doNewChannel', rbac: 'channel',
        keywords: 'create add channel', path: '/channels/new/guided' });
    plat.registerCommand({ id: 'new-alert', label: 'New Alert (Wizard)', icon: 'plus',
        section: 'Create', order: 1, task: 'doNewAlert', rbac: 'alert',
        keywords: 'create add alert', path: '/alerts/new/guided' });

    SETTINGS_TABS.forEach(([label, tab], i) => plat.registerCommand({
        id: 'settings-' + tab, label: 'Settings: ' + label, icon: 'settings', section: 'Settings',
        order: i, task: 'doShowSettings', rbac: 'view', keywords: label,
        path: '/settings?tab=' + tab
    }));

    plat.registerCommand({ id: 'toggle-theme', label: 'Toggle light/dark mode', icon: 'sun',
        section: 'Session', order: 0, keywords: 'dark light theme',
        run: () => store.setTheme(store.getState('theme') === 'light' ? 'dark' : 'light') });
    plat.registerCommand({ id: 'customize-nav', label: 'Customize navigation', icon: 'settings',
        section: 'Session', order: 1, keywords: 'rail sidebar reorder rename',
        run: () => window.dispatchEvent(new CustomEvent('webadmin:customize-nav')) });
}

function registerViewRoutes(plat: any) {
    for (const route of VIEW_ROUTES) {
        if (route.nav) plat.registerNavItem(route.nav);
        plat.registerView(route.path, lazyView(route.load, route.pick), route.meta);
    }
    for (const action of OTHER_ACTIONS) plat.registerNavItem(action);
    registerCommands(plat);
}

/* ---- engine bootstrap (once) — mirrors app.js startApp registration block ---- */

let engineStarted: any = null;
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
        import('../core/monaco.js').then((m: any) => m.ensureMonaco()).catch(() => {});

        // Connector panels stay eager: the '*' wildcard panel is the fallback the
        // channel editor resolves at render time, so it must exist before any view.
        registerConnectors(platform);
        registerViewRoutes(platform);

        router.setNotFound(() => h('div.view', h('div.view-body',
            h('div.dt-empty', h('div.empty-icon', icon('search', 30)), 'View not found'))));

        router.setGuard(async (ctx: any) => {
            const guard = store.getState('navGuard');
            if (typeof guard === 'function') return await guard(ctx);
        });

        await loadPlugins();
        // Record which engine these plugins were discovered against. Plugin views
        // register into module-level registries that a soft sign-out doesn't clear,
        // so a later sign-in to a DIFFERENT engine (same page session) would show the
        // wrong engine's panels. login.jsx compares against this and forces a reload
        // when the target engine changes (see loadedEngineKey / engineSelectionKey).
        try { sessionStorage.setItem('oie-loaded-engine', loadedEngineKey()); } catch { /* private mode */ }
    })();
    return engineStarted;
}

/* ---- Other-pane actions (ported from app.js) ---- */

function openApiDocs() {
    // Open the engine's API docs through our same-origin proxy (/api/) rather
    // than the engine URL directly — carries the session, and avoids the
    // engine's self-signed-cert interstitial. The server no longer exposes the
    // engine URL to the browser (see /webadmin/config.json).
    window.open('/api/', '_blank');
}

async function showAbout() {
    let about: any = null;
    try { about = await api.server.about(); } catch { /* show what we can */ }
    const entries: any[] = [];
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
            h('div.flex.items-center.gap-2.mb-[13px]', h('img', { src: '/assets/oie_logo_bottom_text.svg', alt: 'Open Integration Engine', style: { width: '120px', margin: '0 auto', display: 'block' } })),
            entries.length ? kv : h('div.text-text-dim', `Web Administrator v${(store.getState('webadminConfig') || {}).version || ''} — engine v${store.getState('serverVersion') || '?'}`)),
        buttons: [{ label: 'Close', primary: true }]
    });
}

/* ---- rail ---- */

/* Label for a collapsed rail item. Portaled to <body> and position:fixed because
   .rail scrolls — an absolutely positioned child would be clipped by it, and would
   also pad its scrollWidth into a horizontal scrollbar. Shown on focus too, or the
   rail becomes unusable by keyboard once collapsed. */
function RailFlyout({ target }: any) {
    if (!target) return null;
    const r = target.el.getBoundingClientRect();
    return createPortal(
        <div className="rail-flyout visible" role="tooltip"
            style={{ left: r.right + 10, top: r.top + r.height / 2, transform: 'translateY(-50%)' }}>
            {target.label}
        </div>,
        document.body
    );
}

/* ---- topbar ---- */

/* Pip colours for the connection states. The status bar is the one place that
   reports connection health, so this lives with it rather than being shared. */
const CONN_PIP = { ok: 'ok', offline: 'err', unreachable: 'warn', reconnecting: 'busy' };

/*
 * Identity only: which engine this window is pointed at. Deliberately says nothing
 * about whether that engine is answering — a pip here as well as in the status bar
 * was the same fact twice, and the two bars are close enough together that the
 * repetition read as noise rather than emphasis.
 *
 * Note the split that makes this work: WHICH engine is stable, so it belongs in the
 * bar you stop reading after the first glance; whether it is UP changes, so it
 * belongs in the bar you look at when something seems wrong.
 */
function ServerChip({ info }: any) {
    if (!info) return <div className="server-chip"><span>…</span></div>;
    if (info.error) return <div className="server-chip"><span>engine details unavailable</span></div>;
    const identity = `${info.settings?.environmentName ? info.settings.environmentName + ' · ' : ''}${info.settings?.serverName || 'engine'} · v${info.version}`;
    return <div className="server-chip"><span>{identity}</span></div>;
}

function TopBar({ user, onLogout, serverInfo }: any) {
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
                {/* Plain hamburger when collapsed ("open it"), fold/collapse glyph when expanded.
                    size=24 sets the svg attr; `.topbar .rail-toggle svg` reinforces via CSS. */}
                <Icon name={railCollapsed ? 'menu' : 'menuOpen'} size={24} />
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

/* ---- engine selection (multi-engine) ---- */

function getCookie(name: any) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

// The engine this session is pointed at (from the oie-engine cookie + config),
// mirroring server/proxy.js resolveEngine — so the status bar / menu are accurate
// after a reload (the cookie persists), not just right after login. Returns a
// "name (url)" label so users can confirm their pick (or just the url if the name
// is the url, e.g. a devMode custom URL).
function currentEngineLabel(config: any) {
    const sel = getCookie('oie-engine');
    if (sel === 'custom') return getCookie('oie-engine-url') || 'custom engine';
    const engines = Array.isArray(config.engines) ? config.engines : [];
    const idx = /^\d+$/.test(sel) ? Number(sel) : 0;
    const eng = engines[idx] || engines[0];
    // The server sends name-only now (host-derived when unset), so the label is
    // just the name — no engine URL is exposed to the browser.
    return (eng && eng.name) || '';
}

// True when there's more than one engine to choose from (a dropdown or devMode).
function engineChoiceAvailable(config: any) {
    return (Array.isArray(config.engines) && config.engines.length > 1) || !!config.devMode;
}

// A stable key identifying the selected engine (index, or custom:<url>), derived
// from the routing cookies. Stored in sessionStorage when plugins load so a later
// sign-in to a different engine can detect the change and force a reload. login.jsx
// computes the same key from its picker state — keep the two formats in sync.
function loadedEngineKey() {
    const sel = getCookie('oie-engine') || '0';
    return sel === 'custom' ? `custom:${getCookie('oie-engine-url')}` : sel;
}

// Switch engine: drop the routing cookies and return to a fresh login (a full
// reload re-bootstraps the app against the newly-chosen engine).
async function switchEngine(onLogout: any) {
    document.cookie = 'oie-engine=; path=/; max-age=0';
    document.cookie = 'oie-engine-url=; path=/; max-age=0';
    try { await onLogout(); } catch { /* ignore */ }
    location.reload();
}

/* Top-right account menu (replaces the old logout-only chip, which read as a
   "go to profile" button — issue #8). The chip shows who's signed in; clicking
   opens an account menu with self-service Edit Account / Change Password, a
   jump to Administrator Settings, and Sign out. */
/* Account menu — Radix DropdownMenu. It brings the trigger/menu wiring, focus
   management, typeahead and Escape; we keep the RBAC gating (a task the user is not
   authorized for renders nothing, exactly as the popup did) and the .ctx-menu skin
   so it still looks like every other menu in the app. */
function UserMenu({ user, onLogout }: any) {
    const me = store.getState('user') || user;
    const config = store.getState('webadminConfig') || {};
    const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(' ');
    // Re-read the current user after a self-edit so the chip/status bar update.
    const refreshMe = async () => {
        try { const u = await api.auth.current(); if (u && u.username) store.setState('user', u); }
        catch { /* keep current */ }
    };
    const can = (group: any, task: any) => !task || platform.checkTask(group, task);
    const item = (label: any, icon: any, onSelect: any) => (
        <DropdownMenu.Item className="ctx-item" onSelect={onSelect}>
            <Icon name={icon} />{label}
        </DropdownMenu.Item>
    );
    return (
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button className="user-chip" title="Account">
                    <Icon name="users" /><span>{user?.username || 'user'}</span><Icon name="chevD" size={14} />
                </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content className="ctx-surface" align="end" sideOffset={4} collisionPadding={8}>
                    <DropdownMenu.Label className="ctx-head">
                        <div className="ctx-head-name">{me?.username || 'user'}</div>
                        {fullName ? <div className="ctx-head-sub">{fullName}</div> : null}
                    </DropdownMenu.Label>
                    <DropdownMenu.Separator className="ctx-sep" />
                    {item('Edit Account', 'edit', () => openEditUserModal(store.getState('user') || me, { onSaved: refreshMe }))}
                    {item('Change Password', 'key', () => openChangePasswordModal(store.getState('user') || me))}
                    {can('view', 'doShowSettings') && item('Settings', 'settings', () => router.navigate('/settings?tab=administrator'))}
                    <DropdownMenu.Separator className="ctx-sep" />
                    {engineChoiceAvailable(config) && item('Switch Engine', 'link', () => switchEngine(onLogout))}
                    {can('other', 'doLogout') && item('Sign out', 'logout', () => onLogout())}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    );
}

/* ---- status bar ---- */

function StatusBar({ user, serverInfo, conn }: any) {
    const config = useStoreKey('webadminConfig') || {};
    const [clock, setClock] = useState('');
    /* A compare selection outlives the view it was made in, so the status bar is
       where it stays visible — the reference only, never any content. */
    const [compareAnchor, setCompareAnchor] = useState(() => getAnchor());
    useEffect(() => store.on('compare:changed', () => setCompareAnchor(getAnchor())), []);
    useEffect(() => {
        const tick = () => setClock(new Intl.DateTimeFormat([], {
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        }).format(new Date()));
        tick();
        const t = setInterval(tick, 30000);
        return () => clearInterval(t);
    }, []);
    const engine = currentEngineLabel(config) || '/api';
    let left = 'Connecting…';
    // Live connection state outranks the one-shot identity fetch: the identity is
    // from load time, whereas this is how the last request actually went.
    if (conn.state === 'offline') {
        left = 'No network connection — showing the last data received';
    } else if (conn.state === 'reconnecting') {
        left = `Reconnecting to ${engine}…`;
    } else if (conn.state === 'unreachable') {
        left = `Engine unreachable at ${engine}` + (conn.retryIn != null ? ` — retrying in ${conn.retryIn}s` : '');
    } else if (serverInfo && !serverInfo.error) {
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ');
        left = `Connected to: ${engine} as ${user?.username || ''}` + (name ? ` (${name})` : '');
    } else if (serverInfo && serverInfo.error) {
        left = `Engine unreachable at ${engine}`;
    }
    /* Still waiting on the first identity fetch: pulse rather than claim a state. */
    const pip = conn.state === 'ok' && !serverInfo ? 'busy' : (CONN_PIP as any)[conn.state];
    /* Retrying by hand used to be a click on the topbar chip. Connection state lives
       here now, so the affordance follows it rather than disappearing — the backoff
       reaches 30s between attempts, which is a long time to wait once you know the
       engine is back. Offline is excluded: there is nothing to retry against. */
    const canRetry = conn.state === 'unreachable';
    return (
        <footer className="statusbar">
            <span>
                <span className={'pip ' + pip} aria-hidden="true" />
                {canRetry
                    ? <button type="button" className="status-text status-retry" onClick={conn.retryNow}
                        title="Retry the connection now instead of waiting for the countdown.">{left}</button>
                    : <span className="status-text">{left}</span>}
            </span>
            {compareAnchor && (
                <span className="status-compare ml-auto" title={describeRef(compareAnchor)}>
                    <span aria-hidden="true">⇄</span> selected for compare
                </span>
            )}
            <span className={compareAnchor ? '' : 'ml-auto'}>{clock}</span>
        </footer>
    );
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

function AppShell({ user, onLogout }: any) {
    const outletRef = useRef<any>(null);
    const reactTasksRef = useRef<any>(null);
    const serverInfo = useServerIdentity();
    const conn = useConnectionStatus();

    // Hand core/router.js the React outlet, start the engine once, then route.
    useEffect(() => {
        setReactTasksHost(reactTasksRef.current);
        let cancelled = false;
        (async () => {
            // The engine timezone resolves BEFORE the first route mounts, so the view
            // renders its timestamps in the right zone from the start. Loading it
            // after and remounting the view to restamp would tear the view down
            // mid-boot — a click landing in that gap is silently eaten. Riding
            // alongside startEngine, it costs boot no extra round trip.
            await Promise.all([
                startEngine(),
                import('../core/timezone.js').then((tz: any) => tz.loadServerTimezone()).catch(() => {}),
            ]);
            if (cancelled) return;
            router.setOutlet(outletRef.current);
            // Land on the dashboard for a bare root URL; a deep link (refresh /
            // bookmark of /channels/x/edit) is left intact for the router to match.
            if (router.currentPath() === '/') history.replaceState(null, '', '/dashboard');
            router.start();
        })();
        return () => { cancelled = true; };
    }, []);

    const railVersion = serverInfo && !serverInfo.error ? `engine v${serverInfo.version}` : '';
    const railCollapsed = useStoreKey('railCollapsed');
    const [peek, setPeek] = useState<any>(null);

    // On phone/tablet the rail is an off-canvas drawer — close it after navigating
    // (transient, so the desktop open/closed preference isn't overwritten). Only a
    // genuine navigation to a DIFFERENT path closes it: the drawer's start state
    // comes from initRailCollapsed, so the initial route settle must be ignored
    // (its route:changed can arrive after a slow boot, once the user has already
    // opened the drawer), and a same-path re-stamp (timezone-load restamp, tz
    // toggle) must not slam a just-opened drawer shut.
    useEffect(() => {
        let lastPath: any = null;
        const close = (e: any) => {
            const path = e?.detail?.path ?? null;
            const navigated = lastPath !== null && path !== lastPath;
            lastPath = path;
            if (navigated && window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
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
                    {/* Pre-whitened vector logo — NO CSS filter (the filter softened it; copying
                        the img grabbed the clean source, which is why it looked fine copied but off
                        in the bar). Crisp at any DPI on the dark/blue rail. Dropped entirely when
                        collapsed: it is a banner lockup, illegible at 56px, and its inline width
                        would beat any CSS that tried to hide it. */}
                    {!railCollapsed && (
                        <img src="/assets/oie_logo_banner_text_white.svg" alt="Open Integration Engine"
                            style={{ width: '100%', height: 'auto', display: 'block' }} />
                    )}
                </div>
                {/* Navigation only. Per-view task panes portal into .view-tasks in the
                    content column instead (see below) — they change on every navigation,
                    and having them here pushed the nav around and off-screen. */}
                {/* ONE list of groups, merged from the registry and the user's
                    navLayout preference — so an item can be dragged between the
                    app's groups, a plugin's section, the Other actions and groups
                    the user invents. See react/nav-rail.jsx. */}
                <div className="rail-panes">
                    <NavRail collapsed={railCollapsed} onPeek={setPeek} onLogout={onLogout} />
                </div>
                <div className="rail-foot"><span id="rail-version">{railVersion}</span></div>
            </aside>
            <CommandPalette />
            {/* Off-canvas drawer backdrop (phone/tablet only via CSS) — tap to close. */}
            {railCollapsed && <RailFlyout target={peek} />}
            <div className="rail-backdrop" onClick={() => store.setState('railCollapsed', true)} />
            <TopBar user={user} onLogout={onLogout} serverInfo={serverInfo} />
            <div className="content">
                <RestartBanner />
                {/* Every view's task pane lands here through <ViewTasks> — its own
                    column beside the content it acts on, separate from navigation so
                    the nav no longer moves when tasks change. Stays empty (and
                    collapsed away by CSS) for views that declare no tasks. */}
                <div className="content-row">
                    <div className="view-tasks" ref={reactTasksRef} />
                    <main ref={outletRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} />
                </div>
            </div>
            <StatusBar user={user} serverInfo={serverInfo} conn={conn} />
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
function loginNotificationDialog(message: any) {
    return new Promise((resolve: any) => {
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
async function establishPrefScope(user: any) {
    let id: any = null;
    try { id = await api.server.id(); } catch { /* fall back to the un-scoped key */ }
    store.setPrefScope(id, user && user.id);
    store.reapplyScopedSettings();
    // Density lives in the prefs store, so it can only be applied once the scope is
    // known — unlike the theme, which is mirrored to localStorage for boot.
    store.setTableDensity(getPref('tableDensity'));
}

export function App() {
    const user = useStoreKey('user');
    const [authChecked, setAuthChecked] = useState(false);
    // Bundled MFA/extended-login authenticators register pre-login (see
    // login-authenticators.js) — the login screen may need them before any
    // session or engine-served plugin exists.
    useEffect(() => { registerLoginAuthenticators(); }, []);

    useEffect(() => {
        store.initTheme();
        store.initRailCollapsed();
        initSplitters();
        let alive = true;
        (async () => {
            // Fetch the web-admin config (engine list, devMode) BEFORE the auth check
            // so the login screen can render the engine picker if there's a choice.
            try {
                const res = await fetch('/webadmin/config.json');
                if (res.ok && alive) store.setState('webadminConfig', await res.json());
            } catch { /* optional */ }
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
            // Swing's exportChannelOnError(): don't lose a dirty channel to a dead
            // session — stash it; the next login offers to resume.
            stashChannelDraft();
            // NOT a toast: toast(msg,'warn') routes through detailModal, which put a
            // blocking dialog over the login form. The login screen shows its own
            // reason inline instead — nothing to dismiss before signing back in.
            store.setState('loginNotice', 'Your session expired — please sign in again.');
            store.setState('user', null);
            scrubSessionState();
            // The deep link (which channel was open) must not sit in the address
            // bar over the login card for the next person to read (#24).
            history.replaceState(null, '', '/');
        });
        return () => { alive = false; off(); };
    }, []);

    // A login in ANOTHER TAB of this browser replaces the engine session cookie
    // for every tab (JSESSIONID is browser-wide), leaving this tab rendering the
    // previous user's UI while its API calls ride the new user's session. On tab
    // focus, re-check who the session belongs to and reload if it changed —
    // re-bootstrapping nav, plugins, and permissions as that user.
    useEffect(() => {
        if (!user) return undefined;
        let alive = true, last = 0;
        const check = async () => {
            const now = Date.now();
            if (now - last < 5000) return;   // focus + visibilitychange fire together
            last = now;
            try {
                const u = await api.auth.current();
                if (!alive || !u || !u.username) return;
                if (String(u.id) !== String(user.id)) {
                    stashChannelDraft();     // don't lose a dirty channel to the switch
                    toast(`This browser is now signed in as ${u.username} — reloading`, 'warn');
                    setTimeout(() => window.location.reload(), 800);
                }
            } catch { /* expired/unreachable — the session-expiry flow handles it */ }
        };
        const onVis = () => { if (document.visibilityState === 'visible') check(); };
        window.addEventListener('focus', check);
        document.addEventListener('visibilitychange', onVis);
        return () => {
            alive = false;
            window.removeEventListener('focus', check);
            document.removeEventListener('visibilitychange', onVis);
        };
    }, [user]);

    /* Everything a departed session must not leave behind for the next user of
       this tab (#22/#24): the TanStack cache (a different user signing in within
       staleTime saw the previous user's channels instantly), the code-template
       completion catalog, Monaco models/undo stacks (logout swaps the DOM via
       replaceState, so the route-change sweep never fires), the per-view pane
       layout, the working-copy store keys, and — in devMode — the typed engine
       URL cookie, which otherwise prefills for the next person. */
    const scrubSessionState = () => {
        queryClient.clear();
        invalidateCompletions();
        clearActiveScope();
        // Deferred: the editors only DETACH when React swaps in the login card,
        // which happens on the render after the setState calls around us.
        setTimeout(disposeDetachedMonaco, 0);
        resetPaneCollapsed();
        store.setState('editingChannel', null);
        store.setState('editingChannelNew', false);
        store.setState('editingChannelDirty', false);
        document.cookie = 'oie-engine-url=; Max-Age=0; path=/';
    };

    const onLogout = async () => {
        try { await api.auth.logout(); } catch { /* session may already be gone */ }
        // Explicit sign-out abandons any stash (an expiry stash is a safety net;
        // a deliberate logout on a shared workstation must not leave one behind).
        clearChannelDraft();
        /* The client-side counterpart to core/api.js's session-expired hook: a
           deliberate sign-out is never a 401, so anything holding session-scoped
           data (core/compare.js's selection, and the compare overlay's in-memory
           message content) has no other way to hear about it. Fired by the idle
           auto-logout below too — both are "this session is over". */
        store.emit('session:logout');
        store.setState('user', null);
        store.setState('navGuard', null);
        scrubSessionState();
        store.setPrefScope(null, null);   // next sign-in re-scopes to that user
        resetSessionExpired();
        history.replaceState(null, '', '/');
    };

    const onLoginSuccess = async (u: any, { graceMessage = null } = {}) => {
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
                    // Inline on the login screen, like the other reasons we send someone back.
                    store.setState('loginNotice', 'Sign-in canceled — the notification must be accepted to continue.');
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
        // Password grace period (Swing LoginPanel → ChangePasswordDialog): login was
        // accepted but the password is expiring — the engine's message says when.
        if (graceMessage != null) {
            const change = await confirmDialog('Password Expiring',
                graceMessage || 'Your password is expiring soon. Do you want to change it now?',
                { okLabel: 'Change Password' });
            if (change) openChangePasswordModal(u);
        }
        // A channel draft stashed when a previous session died (see channel-draft.js).
        // Scope is set above, so the key only resolves for the same engine + user.
        const draft = peekChannelDraft();
        if (draft && draft.channel && draft.channel.id) {
            const resume = await confirmDialog('Recovered Unsaved Changes',
                `Unsaved changes to channel "${draft.channel.name || draft.channel.id}" were recovered from your previous session. Resume editing?`,
                { okLabel: 'Resume Editing' });
            clearChannelDraft();
            if (resume) {
                store.setState('editingChannel', draft.channel);
                store.setState('editingChannelNew', !!draft.isNew);
                store.setState('editingChannelDirty', true);
                router.navigate(`/channels/${draft.channel.id}/edit`);
            }
        }
    };

    // Tab-close guard (Swing's confirmLeave on window close): the native browser
    // prompt when any editor holds unsaved work. Channel editor/wizard share the
    // 'editingChannelDirty' store flag; other editors register checks (core/unsaved).
    useEffect(() => {
        const onBeforeUnload = (e: any) => {
            if (!store.getState('user')) return;
            if (store.getState('editingChannelDirty') || hasUnsavedWork()) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

    // Engine policy: auto logout after N idle minutes (Settings → Server). The same
    // client-side enforcement as Swing's InactivityListener — the engine publishes
    // the interval; this client watches its own input events.
    useEffect(() => {
        if (!user) return undefined;
        startIdleLogout(async () => {
            // Stash first: the draft key derives from the pref scope cleared below.
            stashChannelDraft();
            // Swing parity: the dedicated inactivity operation, audited distinctly.
            try { await api.auth.inactivityLogout(); } catch { /* session may already be gone */ }
            store.emit('session:logout');
            store.setState('user', null);
            store.setState('navGuard', null);
            scrubSessionState();
            store.setPrefScope(null, null);
            resetSessionExpired();
            history.replaceState(null, '', '/');
            store.setState('loginNotice', 'You were signed out after a period of inactivity.');
        });
        return () => stopIdleLogout();
         
    }, [user]);

    if (!authChecked) return <BootSplash />;
    if (!user) return <LoginForm onSuccess={onLoginSuccess} />;
    return <AppShell user={user} onLogout={onLogout} />;
}
