/*
 * OIE Web Administrator — application shell (classic Administrator layout).
 *
 * Left sidebar = stacked task panes: "Engine" navigation, contextual
 * "<View> Tasks" panes (each view's .taskbar elements are relocated here),
 * plugin panes, and "Other". A status bar runs along the bottom.
 *
 * Boot sequence: check session → (login if needed) → register core views →
 * load plugins → build chrome → start router.
 */

import { h, clear, icon, toast, modal } from '@oie/web-ui';
import { timezoneMode, cycleTimezone, resolvedAbbr, loadServerTimezone, onTimezoneChange } from './core/timezone.js';
import { initSplitters } from './core/resize.js';
import * as router from './core/router.js';
import * as store from './core/store.js';
import api, { onSessionExpired, resetSessionExpired } from '@oie/web-api';
import { platform, loadPlugins } from '@oie/web-shell';
import { renderLogin } from './views/login.js';

import { register as registerDashboard } from './views/dashboard.js';
import { register as registerChannels } from './views/channels.js';
import { register as registerChannelEditor } from './views/channel-editor.js';
import { register as registerMessages } from './views/messages.js';
import { register as registerEvents } from './views/events.js';
import { register as registerAlerts } from './views/alerts.js';
import { register as registerUsers } from './views/users.js';
import { register as registerSettings } from './views/settings.js';
import { register as registerCodeTemplates } from './views/code-templates.js';
import { register as registerGlobalScripts } from './views/global-scripts.js';
import { register as registerExtensions } from './views/extensions.js';
import { register as registerConnectors } from './connectors/index.js';

const app = document.getElementById('app');

const HOMEPAGE_URL = 'https://github.com/OpenIntegrationEngine/engine';
const ISSUES_URL = 'https://github.com/OpenIntegrationEngine/engine/issues';

const BRAND_MARK_PATH = 'M12 2a10 10 0 1 0 10 10M22 2l-8.5 8.5M22 2h-6M22 2v6M7.5 12A4.5 4.5 0 1 0 12 7.5';

function brandMark(size = 26) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.classList.add('brand-mark');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', BRAND_MARK_PATH);
    svg.appendChild(path);
    return svg;
}

/* ---- collapsible sidebar pane ------------------------------------------------ */

const paneCollapsed = new Map();

function railPane(title, body, key) {
    const k = key || title;
    const pane = h('div.rail-pane', { class: paneCollapsed.get(k) ? 'collapsed' : null },
        h('div.rail-pane-header', {
            onClick: () => {
                pane.classList.toggle('collapsed');
                paneCollapsed.set(k, pane.classList.contains('collapsed'));
            }
        }, h('span.pane-title', title), h('span.pane-chevron', '▲')),
        h('div.rail-pane-body', body));
    return pane;
}

/* ---- chrome -------------------------------------------------------------------- */

let routeHandler = null;
let clockTimer = null;

function buildShell() {
    const engineHost = h('div');               // "Engine" navigation pane
    const tasksHost = h('div');                // contextual view-task panes
    const pluginNavHost = h('div');            // nav panes contributed by plugins
    const viewTitle = h('div.view-title', '');
    const serverChip = h('div.server-chip', h('span.pip.ok'), h('span', '…'));
    const outlet = h('main', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' } });
    const statusLeft = h('span', 'Connecting…');
    const statusClock = h('span.right', '');

    const user = store.getState('user');

    const themeToggle = h('button.icon-btn', {
        title: 'Toggle light/dark mode',
        onClick: () => {
            const next = (store.getState('theme') === 'light') ? 'dark' : 'light';
            store.setTheme(next);
            clear(themeToggle).appendChild(icon(next === 'light' ? 'moon' : 'sun'));
        }
    }, icon(store.getState('theme') === 'light' ? 'moon' : 'sun'));

    // Timestamp time zone — click to cycle Server (default) / Local / UTC. The
    // mode is remembered across sessions (persisted by cycleTimezone). Every
    // displayed timestamp (via fmtDate) re-renders in the chosen zone.
    const tzToggle = h('button.btn.tz-toggle', { onClick: () => { cycleTimezone(); router.navigate(router.currentPath()); } });
    function refreshTzToggle() {
        const mode = timezoneMode();
        const label = mode.charAt(0).toUpperCase() + mode.slice(1);
        const abbr = resolvedAbbr();
        clear(tzToggle).append(icon('clock'), h('span', `${label} · ${abbr}`));
        tzToggle.title = `Timestamps shown in ${label} time (${abbr}). Click to cycle Server / Local / UTC.`;
    }
    refreshTzToggle();
    onTimezoneChange(refreshTzToggle);
    // Resolve the engine's zone, then restamp the current view if its server-mode
    // timestamps were waiting on it (skipped when a view holds unsaved state).
    loadServerTimezone().then(() => {
        if (typeof store.getState('navGuard') !== 'function') router.navigate(router.currentPath());
    });

    /* "Other" pane — mirrors the Swing Administrator's Other task pane. */
    const otherPane = railPane('Other', h('div.taskbar',
        h('button.btn', { onClick: () => openApiDocs() }, icon('file'), 'View REST API'),
        h('button.btn', { onClick: () => showAbout() }, icon('info'), 'About'),
        h('button.btn', { onClick: () => window.open(HOMEPAGE_URL, '_blank') }, icon('globe'), 'Visit homepage'),
        h('button.btn', { onClick: () => window.open(ISSUES_URL, '_blank') }, icon('warning'), 'Report issue'),
        h('span.sep'),
        h('button.btn', { onClick: logout }, icon('logout'), 'Logout')
    ));

    const restartBanner = h('div.restart-banner.hidden');

    const shell = h('div.shell',
        h('aside.rail',
            h('div.rail-brand',
                h('img', { src: 'assets/oie_white_logo_banner_text_215x30.png', alt: 'Open Integration Engine', style: { width: '172px', height: 'auto', display: 'block' } })),
            h('div.rail-panes', engineHost, tasksHost, pluginNavHost, otherPane),
            h('div.rail-foot', h('span#rail-version', ''))),
        h('header.topbar',
            viewTitle,
            h('div.topbar-spacer'),
            serverChip,
            tzToggle,
            themeToggle,
            h('div.user-chip', { onClick: logout, title: 'Sign out' },
                icon('users'), h('span', user?.username || 'user'))),
        h('div.content', restartBanner, outlet),
        h('footer.statusbar', statusLeft, statusClock)
    );

    clear(app).appendChild(shell);
    router.setOutlet(outlet);
    renderNav(engineHost, pluginNavHost);
    initRestartWatch(restartBanner);

    /* Route changes: update title, nav highlight, and relocate the view's
       taskbars into contextual sidebar panes (classic task pane behavior). */
    if (routeHandler) window.removeEventListener('route:changed', routeHandler);
    routeHandler = (e) => {
        viewTitle.textContent = e.detail.meta?.title || '';
        document.title = (e.detail.meta?.title ? e.detail.meta.title + ' — ' : '') + 'OIE Administrator';
        renderNav(engineHost, pluginNavHost);
        relocateTaskbars(outlet, tasksHost, e.detail.meta?.title);
    };
    window.addEventListener('route:changed', routeHandler);

    /* Views refine the blue title strip after async loads (e.g.
       "Channel Messages - Test_Channel"). */
    window.addEventListener('webadmin:set-title', (e) => {
        if (e.detail?.title) {
            viewTitle.textContent = e.detail.title;
            document.title = e.detail.title + ' — OIE Administrator';
        }
    });

    /* Views that swap tasks without a route change (e.g. settings tabs)
       dispatch this to retitle their pane. */
    window.addEventListener('webadmin:retitle-tasks', (e) => {
        const title = e.detail?.title;
        const pane = tasksHost.querySelector('.rail-pane .pane-title');
        if (pane && title) pane.textContent = title;
    });

    /* Server identity chip + status bar. */
    const config = store.getState('webadminConfig') || {};
    Promise.all([api.server.version(), api.server.settings().catch(() => null)])
        .then(([version, settings]) => {
            store.setState('serverVersion', version);
            clear(serverChip);
            serverChip.appendChild(h('span.pip.ok'));
            serverChip.appendChild(h('span', `${settings?.environmentName ? settings.environmentName + ' · ' : ''}${settings?.serverName || 'engine'} · v${version}`));
            const railVersion = document.getElementById('rail-version');
            if (railVersion) railVersion.textContent = `engine v${version}`;
            statusLeft.textContent = `Connected to: ${config.engineUrl || '/api'} as ${user?.username || ''}` +
                (user?.firstName || user?.lastName ? ` (${[user.firstName, user.lastName].filter(Boolean).join(' ')})` : '');
        })
        .catch(() => {
            clear(serverChip);
            serverChip.appendChild(h('span.pip.err'));
            serverChip.appendChild(h('span', 'engine unreachable'));
            statusLeft.textContent = `Engine unreachable at ${config.engineUrl || '/api'}`;
        });

    if (clockTimer) clearInterval(clockTimer);
    const tick = () => {
        statusClock.textContent = new Intl.DateTimeFormat([], {
            hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
        }).format(new Date());
    };
    tick();
    clockTimer = setInterval(tick, 30000);
}

function relocateTaskbars(outlet, tasksHost, viewTitle) {
    clear(tasksHost);
    const view = outlet.querySelector(':scope > .view');
    if (!view) return;
    const taskbars = [...view.children].filter(el => el.classList.contains('taskbar'));
    taskbars.forEach((taskbar) => {
        const title = taskbar.dataset.paneTitle || `${viewTitle || 'View'} Tasks`;
        // Selection-dependent groups that declare their own pane title break
        // out into separate panes that show/hide with the selection.
        const ctxGroups = [...taskbar.querySelectorAll(':scope > .ctx-tasks')]
            .filter(ctx => ctx.dataset.paneTitle);
        tasksHost.appendChild(railPane(title, taskbar, `tasks:${title}`));
        for (const ctx of ctxGroups) {
            const pane = railPane(ctx.dataset.paneTitle,
                h('div.taskbar', ctx), `tasks:${ctx.dataset.paneTitle}`);
            pane.classList.add('ctx-pane');
            tasksHost.appendChild(pane);
        }
    });
}

function renderNav(engineHost, pluginNavHost) {
    clear(engineHost);
    clear(pluginNavHost);
    const current = router.currentPath();
    const sections = new Map();
    for (const item of platform.navItems()) {
        const section = item.section || 'Plugins';
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section).push(item);
    }
    // Classic order: Engine pane on top; plugin panes render below the
    // contextual task panes, above "Other".
    const ordered = [...sections.keys()].sort((a, b) =>
        (a === 'Engine' ? -1 : b === 'Engine' ? 1 : a.localeCompare(b)));
    for (const section of ordered) {
        const items = sections.get(section).map(item => {
            const active = current === item.path || current.startsWith(item.path + '/') ||
                (item.match && item.match(current));
            return h('button.rail-item', {
                class: active ? 'active' : null,
                onClick: () => router.navigate(item.path)
            }, icon(item.icon || 'puzzle', 15), h('span', item.label));
        });
        (section === 'Engine' ? engineHost : pluginNavHost).appendChild(railPane(section, items));
    }
}

/* ---- engine restart watcher ----------------------------------------------------------
 * After an extension install/uninstall the engine must restart. The banner
 * persists (localStorage) until the engine's extension list actually changes,
 * then offers a one-click UI reload so new plugin panels register.
 */

const RESTART_KEY = 'oie-restart-pending';
let restartTimer = null;

async function extensionSignature() {
    const [connectors, plugins] = await Promise.all([api.extensions.connectors(), api.extensions.plugins()]);
    const names = (map) => api.asList(map && map.entry)
        .map(entry => Object.values(entry).find(v => typeof v === 'string'))
        .filter(Boolean);
    return JSON.stringify([...names(connectors).sort(), ...names(plugins).sort()]);
}

function initRestartWatch(banner) {
    if (restartTimer) { clearInterval(restartTimer); restartTimer = null; }

    const render = (state) => {
        clear(banner);
        banner.classList.remove('hidden', 'success');
        if (state === 'waiting') {
            banner.appendChild(h('span.spinner', { style: { width: '13px', height: '13px' } }));
            banner.appendChild(h('span', 'Extension change staged — restart the engine to apply. Watching for the engine to come back…'));
        } else if (state === 'offline') {
            banner.appendChild(h('span.spinner', { style: { width: '13px', height: '13px' } }));
            banner.appendChild(h('span', 'Engine is restarting…'));
        } else if (state === 'done') {
            banner.classList.add('success');
            banner.appendChild(icon('check', 14));
            banner.appendChild(h('span', 'Engine restarted with updated extensions.'));
            banner.appendChild(h('button.btn.btn-sm.btn-primary', { onClick: () => location.reload() }, 'Reload UI'));
        }
        banner.appendChild(h('button.icon-btn', {
            style: { marginLeft: 'auto' },
            title: 'Dismiss',
            onClick: () => { stopWatch(); banner.classList.add('hidden'); }
        }, icon('x', 13)));
    };

    function stopWatch() {
        try { localStorage.removeItem(RESTART_KEY); } catch (e) { /* private mode */ }
        if (restartTimer) { clearInterval(restartTimer); restartTimer = null; }
    }

    async function poll() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(RESTART_KEY)); } catch (e) { /* corrupt */ }
        if (!saved) { stopWatch(); banner.classList.add('hidden'); return; }
        try {
            const sig = await extensionSignature();
            if (sig !== saved.sig) {
                render('done');
                if (restartTimer) { clearInterval(restartTimer); restartTimer = null; }
                try { localStorage.removeItem(RESTART_KEY); } catch (e) { /* ok */ }
            } else {
                render('waiting');
            }
        } catch (e) {
            render('offline');
        }
    }

    async function arm() {
        try {
            const sig = await extensionSignature().catch(() => null);
            localStorage.setItem(RESTART_KEY, JSON.stringify({ sig, ts: Date.now() }));
        } catch (e) { /* private mode — banner still shows for this session */ }
        render('waiting');
        if (!restartTimer) restartTimer = setInterval(poll, 8000);
    }

    window.addEventListener('webadmin:restart-pending', arm);

    // Resume after a page reload while a restart was still pending.
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(RESTART_KEY)); } catch (e) { /* none */ }
    if (saved) {
        render('waiting');
        poll();
        restartTimer = setInterval(poll, 8000);
    }
}

/* ---- Other pane actions ------------------------------------------------------------ */

function openApiDocs() {
    const config = store.getState('webadminConfig') || {};
    window.open((config.engineUrl || '') + '/api/', '_blank');
}

async function showAbout() {
    let about = null;
    try { about = await api.server.about(); } catch (e) { /* show what we can */ }
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

async function logout() {
    try { await api.auth.logout(); } catch (e) { /* session may already be gone */ }
    store.setState('user', null);
    store.setState('navGuard', null);
    resetSessionExpired();
    location.hash = '';
    boot();
}

/* ---- boot ----------------------------------------------------------------------------- */

let loginShowing = false;

function showLogin() {
    loginShowing = true;
    // A view with unsaved state may have left its navigation guard behind —
    // the session is gone, so the guard must not block or prompt anymore.
    store.setState('navGuard', null);
    clear(app).appendChild(renderLogin(async (user) => {
        loginShowing = false;
        resetSessionExpired();
        store.setState('user', user);
        await startApp();
    }));
}

let coreRegistered = false;

async function startApp() {
    if (!coreRegistered) {
        coreRegistered = true;

        try {
            const res = await fetch('/webadmin/config.json');
            if (res.ok) store.setState('webadminConfig', await res.json());
        } catch (e) { /* optional */ }

        // Warm up Monaco in the background so code editors upgrade instantly;
        // air-gapped installs silently keep the built-in editor.
        import('./core/monaco.js').then(m => m.ensureMonaco()).catch(() => {});

        // Connector property panels (the channel editor consumes this registry).
        // Transformer steps & filter rules now load as a plugin (transformer-steps).
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

        // Views with unsaved state register a leave-guard (e.g. the channel
        // editor's save prompt). Returning false cancels the navigation.
        router.setGuard(async (ctx) => {
            const guard = store.getState('navGuard');
            if (typeof guard === 'function') return await guard(ctx);
        });

        await loadPlugins();
    }

    buildShell();
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
        location.hash = '/dashboard';
    }
    router.start();
}

onSessionExpired(() => {
    if (loginShowing) return;
    toast('Session expired — please sign in again', 'warn');
    store.setState('user', null);
    showLogin();
});

async function boot() {
    store.initTheme();
    initSplitters();
    try {
        const user = await api.auth.current();
        if (user && user.username) {
            store.setState('user', user);
            await startApp();
            return;
        }
    } catch (e) { /* not signed in */ }
    showLogin();
}

export { brandMark };

boot();
