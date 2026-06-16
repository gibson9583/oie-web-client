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
import * as columns from './columns.js';
import { createCodeEditor, setCodeEditorFactory } from './codeeditor.js';

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
    /* core libraries, handed to plugins so they share the app's toolkit */
    api: apiModule.default,
    ui,
    oie,
    columns,
    router: { navigate: router.navigate, currentPath: router.currentPath },
    store: { getState: store.getState, setState: store.setState, subscribe: store.subscribe },
    events: { on: store.on, emit: store.emit },
    createCodeEditor,
    setCodeEditorFactory,

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
       render(host, { getEntry, setEntry, propertiesClass, connector, channel,
       platform, onChange }) }.
       getEntry() returns the current entry or null; setEntry(obj|null)
       creates/replaces/removes it while preserving sibling plugin entries. */
    registerConnectorPropertiesPanel(def) { registries.connectorPropertiesPanels.push(def); },
    registerDataType(name, def) { registries.dataTypes.set(name, def); },
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

export async function loadPlugins() {
    let manifests = [];
    try {
        const res = await fetch('/webadmin/plugins.json');
        if (res.ok) manifests = await res.json();
    } catch (e) {
        console.warn('[plugins] manifest fetch failed:', e);
    }

    // Import every plugin entry module IN PARALLEL — a serial `await import()`
    // per plugin cost a round-trip each (34 plugins ≈ 34 RTs; at 100ms that's
    // ~3.4s). Server-side modulepreload hints start these fetches even earlier.
    const imported = await Promise.all(manifests.map(async (manifest) => {
        if (!manifest.entry) return { manifest, module: null };
        try { return { manifest, module: await import(manifest.entry) }; }
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
    store.setState('webPlugins', loaded);
    return loaded;
}
