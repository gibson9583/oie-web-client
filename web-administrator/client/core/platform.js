/*
 * Plugin platform — the web equivalent of the Swing client's extension points.
 *
 * Core views register themselves through the same registries that third-party
 * plugins use, so a plugin can do anything a built-in view can. The plugin
 * entry module (declared in plugin.json → client.entry) must export:
 *
 *   export function register(platform) { ... }
 *
 * Extension points (mirroring com.mirth.connect.plugins.* on the Swing side):
 *   registerNavItem        — left rail entry             (ClientPlugin task panes)
 *   registerView           — routed full view            (ClientPlugin)
 *   registerDashboardTab   — tab under the dashboard     (DashboardTabPlugin)
 *   registerDashboardColumn— extra dashboard column      (DashboardColumnPlugin)
 *   registerChannelTab     — tab in the channel editor   (ChannelTabPlugin)
 *   registerSettingsPanel  — tab in Settings             (SettingsPanelPlugin)
 *   registerAttachmentViewer — message attachment viewer (AttachmentViewer)
 *   registerStepType / registerRuleType — transformer/filter editors
 *                                                        (TransformerStepPlugin/FilterRulePlugin)
 *   registerConnectorPanel — connector property editor   (ConnectorSettingsPanel)
 *   registerConnectorPropertiesPanel — extra section on supported connectors,
 *                            editing an entry in connector.properties
 *                            .pluginProperties              (ConnectorPropertiesPlugin)
 */

import * as router from './router.js';
import * as store from './store.js';
import * as apiModule from './api.js';
import * as ui from './ui.js';
import * as oie from './oie.js';
import { webSupportBase } from './websupport.js';
import { registerLoginAuthenticator } from './login-auth.js';
import * as columns from './columns.js';
import { createCodeEditor, setCodeEditorFactory } from './codeeditor.js';
import { setAuthorizationController, checkTask } from './authorization.js';

/* ---- @oie/* plugin API contract version --------------------------------------
 * The version of the framework surface (the `platform` registries + the @oie/web-*
 * exports) that this web admin implements. Tracks the OIE engine release line it
 * ships with (major.minor; the patch is ignored for compatibility): bump the MINOR
 * as the surface grows, the MAJOR on any breaking change (removed/renamed export,
 * changed registry signature).
 *
 * Plugins declare the MINIMUM they were built against in plugin.json
 * (`"oie": { "apiMin": "4.6" }`). We accept a plugin when it needs no newer than
 * what we implement AND no breaking change has happened since — i.e. same major
 * and our minor >= its required minor. This is forward-compatible by design: a
 * plugin built for 4.6 keeps working on 4.7, 4.9, … (older APIs never removed
 * within a major); it's rejected only when THIS web admin is too old (its apiMin
 * is newer than us) or a major bump dropped what it relies on. */
export const OIE_API_VERSION = '4.6.0';

function parseApiVersion(v) {
    const [major, minor] = String(v == null ? '' : v).split('.');
    return { major: parseInt(major, 10) || 0, minor: parseInt(minor, 10) || 0 };
}

// Does `provided` satisfy a plugin's required minimum? Undeclared min => always
// compatible (opt-in check: bundled/framework plugins move in lockstep and don't
// declare one). Same major (no breaking change) and provided minor >= required.
export function apiCompatible(provided, requiredMin) {
    if (requiredMin == null || requiredMin === '') return true;
    const p = parseApiVersion(provided);
    const r = parseApiVersion(requiredMin);
    return p.major === r.major && p.minor >= r.minor;
}

const registries = {
    navItems: [],
    dashboardTabs: [],
    dashboardColumns: [],
    channelTabs: [],
    settingsPanels: [],
    attachmentViewers: [],
    stepTypes: new Map(),
    ruleTypes: new Map(),
    connectorPanels: new Map(),
    connectorPropertiesPanels: [],
    dataTypes: new Map(),
    transmissionModes: new Map(),
    resourceTypes: new Map()
};

function sorted(list) {
    return [...list].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export const platform = {
    /* The @oie/* API contract version this web admin implements (see OIE_API_VERSION).
       Plugins can read platform.apiVersion to feature-detect at runtime. */
    apiVersion: OIE_API_VERSION,
    /* core libraries, handed to plugins so they share the app's toolkit */
    api: apiModule.default,
    ui,
    // MFA/extended-login: register an authenticator keyed by the server's
    // clientPluginClass (see core/login-auth.js). Must be called pre-login.
    registerLoginAuthenticator,
    oie,
    columns,
    // The host's React instance (set by the shell at boot). Plugins author React
    // UI against THIS — e.g. `const React = platform.React` then JSX — so plugin
    // components share the one React the app renders with (hooks/context work).
    React: null,
    // Wraps a React component as a routed-view handler (set by the shell at
    // boot): platform.registerView(path, platform.reactView(MyView), { title }).
    reactView: null,
    router: { navigate: router.navigate, currentPath: router.currentPath },
    store: { getState: store.getState, setState: store.setState, subscribe: store.subscribe },
    events: { on: store.on, emit: store.emit },
    createCodeEditor,
    setCodeEditorFactory,

    /* RBAC hook (Swing AuthorizationController): a Role-Based Access Control plugin
       calls setAuthorizationController({ checkTask(taskGroup, taskName) }) to hide
       nav items / task buttons / right-click items. checkTask is consulted by the
       menu builders. Default = allow all. */
    setAuthorizationController,
    checkTask,

    /* ---- extension points ---- */

    registerNavItem(item) { registries.navItems.push(item); },
    registerView(path, handler, meta = {}) { router.register(path, handler, meta); },
    registerDashboardTab(tab) { registries.dashboardTabs.push(tab); },
    registerDashboardColumn(column) { registries.dashboardColumns.push(column); },
    registerChannelTab(tab) { registries.channelTabs.push(tab); },
    registerSettingsPanel(panel) { registries.settingsPanels.push(panel); },
    registerAttachmentViewer(viewer) { registries.attachmentViewers.push(viewer); },
    registerStepType(type, def) { registries.stepTypes.set(type, def); },
    registerRuleType(type, def) { registries.ruleTypes.set(type, def); },
    registerConnectorPanel(transportName, mode, def) {
        registries.connectorPanels.set(`${mode}:${transportName}`, def);
    },
    /* def = { id, title,
       propertiesClass: FQCN string OR (transportName, mode, connector) → FQCN
         — the JSON key inside connector.properties.pluginProperties. Plugins
         like TLS managers use different classes per connector kind (listener
         vs sender vs HTTP dispatcher), hence the resolver form,
       isSupported(transportName, mode, connector) → bool,
       defaults(version, transportName, mode, connector) → complete entry object,
       component({ getEntry, setEntry, propertiesClass, connector, channel,
       platform, onChange }) — a React component authored against platform.React }.
       getEntry() returns the current entry or null; setEntry(obj|null)
       creates/replaces/removes it while preserving sibling plugin entries. */
    registerConnectorPropertiesPanel(def) { registries.connectorPropertiesPanels.push(def); },
    registerDataType(name, def) { registries.dataTypes.set(name, { name, ...def }); },
    registerTransmissionMode(name, def) { registries.transmissionModes.set(name, { name, ...def }); },
    registerResourceType(type, def) { registries.resourceTypes.set(type, { type, ...def }); },

    /* ---- lookups used by core views ---- */

    navItems: () => sorted(registries.navItems),
    dashboardTabs: () => sorted(registries.dashboardTabs),
    dashboardColumns: () => sorted(registries.dashboardColumns),
    channelTabs: () => sorted(registries.channelTabs),
    settingsPanels: () => sorted(registries.settingsPanels),
    attachmentViewers: () => [...registries.attachmentViewers],
    stepType: (type) => registries.stepTypes.get(type),
    stepTypes: () => registries.stepTypes,
    ruleType: (type) => registries.ruleTypes.get(type),
    ruleTypes: () => registries.ruleTypes,
    connectorPanel: (transportName, mode) => registries.connectorPanels.get(`${mode}:${transportName}`),
    connectorPanels: () => registries.connectorPanels,
    connectorPropertiesPanels: () => sorted(registries.connectorPropertiesPanels),
    dataType: (name) => registries.dataTypes.get(name),
    dataTypes: () => registries.dataTypes,
    transmissionModes: () => [...registries.transmissionModes.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    resourceTypes: () => [...registries.resourceTypes.values()]
};

/* ---- plugin bootstrap ----------------------------------------------------------- */

// Engine-served plugins: the connected engine exposes the browser half of its
// installed extensions (their webadmin/ folders) under /api/webplugins — a
// discovery list of extension paths, then each path's plugin.json + assets. We
// fetch that set and turn it into manifests whose `entry` is an /api/webplugins
// URL, so the existing import/register path loads them like any other plugin.
// Because /api is same-origin (through the proxy), these modules resolve @oie/*
// via the page import map to the SAME framework instance as bundled plugins.
//
// This is what makes plugins per-ENGINE rather than per-web-admin-install: a
// plugin's UI is served by whichever engine has it installed, so it appears only
// when connected to that engine (and stays version-matched to it). Engines older
// than this feature simply have no /api/webplugins endpoint, so this no-ops.
async function fetchEngineManifests() {
    let paths;
    let wsBase;
    try {
        wsBase = await webSupportBase();
        if (wsBase === null) {
            // Neither engine-native endpoints nor the websupport plugin: engine-served
            // plugin UIs (and message trees / validation) are off. Say so once, visibly,
            // instead of plugin UIs silently not appearing.
            ui.toast('The Web Support plugin is not installed on this engine — plugin UIs, message trees, and script validation are disabled. Install "websupport" from the Extensions page.', 'warn');
            return [];
        }
        paths = apiModule.asList(await apiModule.get(`${wsBase}/webplugins`), 'string').map(String).filter(Boolean);
    } catch {
        return []; // unreachable / not logged in yet — nothing to add
    }

    const results = await Promise.all(paths.map(async (path) => {
        const base = `/api${wsBase}/webplugins/${encodeURIComponent(path)}`;
        try {
            // Served raw by the engine (not XStream-wrapped), so read it as plain JSON.
            const res = await fetch(`${base}/plugin.json`, { credentials: 'same-origin' });
            if (!res.ok) return null;
            const m = await res.json();
            if (!m || !m.id) return null;
            const entry = m.client && m.client.entry ? `${base}/${m.client.entry}` : null;
            return {
                id: m.id,
                name: m.name || m.id,
                version: m.version || '0.0.0',
                author: m.author || '',
                description: m.description || '',
                // Minimum @oie API version the plugin was built against (compat gate).
                apiMin: m.oie && m.oie.apiMin ? String(m.oie.apiMin) : null,
                entry,
                source: 'engine'
            };
        } catch (e) {
            console.warn(`[plugins] engine plugin "${path}" manifest failed:`, e);
            return null;
        }
    }));
    return results.filter(Boolean);
}

export async function loadPlugins() {
    let manifests = [];
    try {
        const res = await fetch('/webadmin/plugins.json');
        if (res.ok) manifests = await res.json();
    } catch (e) {
        console.warn('[plugins] manifest fetch failed:', e);
    }

    // Merge in the connected engine's own web plugins. Installs are forward-only —
    // the engine owns and serves an extension's web half — so the ENGINE copy is
    // authoritative for its id and supersedes any local manifest with the same id.
    // In practice the two sets are disjoint: /webadmin/plugins.json is the bundled
    // framework plugins (connectors, data types, viewers, …) that ship with the web
    // admin, and /api/webplugins is whatever the connected engine has installed.
    const engineManifests = await fetchEngineManifests();
    const engineIds = new Set(engineManifests.map((m) => m.id).filter(Boolean));
    manifests = manifests.filter((m) => !engineIds.has(m.id)).concat(engineManifests);

    // Compatibility gate: a plugin that declares an @oie apiMin newer than what we
    // implement (or from a different major) would call APIs that aren't here and
    // crash on import/register. Skip those BEFORE importing — never run incompatible
    // code — and surface them so the mismatch is visible (Extensions → web plugins)
    // instead of a silent failure. Plugins with no apiMin (bundled/framework, and
    // any built before this contract) are unaffected.
    const incompatible = [];
    manifests = manifests.filter((m) => {
        if (apiCompatible(OIE_API_VERSION, m.apiMin)) return true;
        const message = `requires @oie API ${m.apiMin}, but this web administrator provides ${OIE_API_VERSION}`;
        console.warn(`[plugins] ${m.id} skipped — ${message}`);
        incompatible.push({ ...m, status: 'incompatible', error: message });
        return false;
    });

    // Import every plugin entry module IN PARALLEL — a serial `await import()`
    // per plugin cost a round-trip each (34 plugins ≈ 34 RTs; at 100ms that's
    // ~3.4s). Server-side modulepreload hints start these fetches even earlier.
    const imported = await Promise.all(manifests.map(async (manifest) => {
        if (!manifest.entry) return { manifest, module: null };
        // Plugin entries are runtime URLs (/plugins/<id>/…), not build-time paths —
        // tell Vite/Rollup not to analyze/bundle this import (it's loaded live).
        try { return { manifest, module: await import(/* @vite-ignore */ manifest.entry) }; }
        catch (e) { return { manifest, error: e }; }
    }));

    // Register in manifest order so ordering (nav items, tabs) stays stable.
    const loaded = [];
    for (const { manifest, module, error } of imported) {
        if (!manifest.entry) { loaded.push({ ...manifest, status: 'no-client' }); continue; }
        if (error) {
            console.error(`[plugins] ${manifest.id} failed:`, error);
            loaded.push({ ...manifest, status: 'error', error: error.message });
            continue;
        }
        if (typeof module.register === 'function') {
            try {
                await module.register(platform);
                loaded.push({ ...manifest, status: 'loaded' });
                console.log(`[plugins] ${manifest.id} v${manifest.version} registered`);
            } catch (e) {
                console.error(`[plugins] ${manifest.id} register failed:`, e);
                loaded.push({ ...manifest, status: 'error', error: e.message });
            }
        } else {
            loaded.push({ ...manifest, status: 'error', error: 'entry module has no register(platform) export' });
        }
    }
    // Include the version-skipped plugins so the mismatch is visible in the UI.
    store.setState('webPlugins', [...loaded, ...incompatible]);
    return loaded;
}
