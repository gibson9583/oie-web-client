/*
 * Plugin platform — the web equivalent of the Swing client's extension points.
 *
 * Core views register themselves through the same registries that third-party
 * plugins use, so a plugin can do anything a built-in view can. The plugin
 * entry module (declared in plugin.json → client.entry) must export:
 *
 *   export function register(platform, context) { ... }
 *
 * The optional context reads plugin-owned text assets from their manifest root.
 *
 * Extension points (mirroring com.mirth.connect.plugins.* on the Swing side):
 *   registerNavItem        — left rail entry             (ClientPlugin task panes)
 *   registerView           — routed full view            (ClientPlugin)
 *   registerDashboardTab   — tab under the dashboard     (DashboardTabPlugin)
 *   registerDashboardColumn— extra dashboard column      (DashboardColumnPlugin)
 *   registerChannelTab     — tab in the channel editor   (ChannelTabPlugin)
 *   registerSettingsPanel  — tab in Settings             (SettingsPanelPlugin)
 *   registerAttachmentViewer — message attachment viewer (AttachmentViewer)
 *   registerChannelAction  — Channels view row action    (ChannelPanelPlugin task)
 *   registerCodeTemplateAction — Code Templates row action
 *   registerCodeTemplateType — code-template properties and editor
 *   registerMessageAction  — message browser row action  (web-only; Swing has no hook)
 *   registerReferences     — Reference list + autocomplete entries (CodeTemplatePlugin)
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
import { engineFetch, assertEngineResponse, captureEngineSession } from './engine-fetch.js';
import * as ui from './ui.js';
import * as oie from './oie.js';
import { webSupportBase } from './websupport.js';
import { registerLoginAuthenticator } from './login-auth.js';
import * as columns from './columns.js';
import { createCodeEditor, setCodeEditorFactory } from './codeeditor.js';
import { createDiffEditor } from './diffeditor.js';
import { registerEditorLanguage } from './editor-languages.js';
import { createPluginContext } from './plugin-assets.js';
export type { EditorLanguageProvider, EditorLanguageDefinition } from './editor-languages.js';
export type { PluginContext } from './plugin-assets.js';
import { setAuthorizationController, checkTask, blockAuthorization, beginAuthorizationDiscovery, beginAuthorizationRegistration, authorizationRegistration } from './authorization.js';
import { registerIcon } from './icons.js';
import { registerCommand } from './commands.js';
import { apiUrl, appUrl } from './deployment.js';
import { addReferences, registeredReferences, registerTemplateCompletionSource } from './script-completions.js';
import type { Command } from './commands.js';
import type { OieObject } from './wire-types.js';
import type { Api } from './api.js';
import type { TaskRef } from './ui.js';
import type { RouteContext, RouteHandler } from './router.js';

/* ---- plugin-facing types ------------------------------------------------------
   These ARE the @oie/web-shell contract — the package's declarations are
   emitted from this module. */

/** The DOM toolkit subset exposed as `platform.ui` (the ui.ts surface). */
type DomToolkit = Pick<
    typeof import('./ui.js'),
    | 'h' | 'clear' | 'icon' | 'fmtNumber' | 'fmtDate' | 'escapeHtml' | 'toast' | 'modal'
    | 'confirmDialog' | 'promptDialog' | 'contextMenu' | 'closeContextMenu' | 'tabs' | 'DataTable'
    | 'field' | 'textInput' | 'numberInput' | 'select' | 'checkbox' | 'taskButton'
    | 'downloadFile' | 'saveFile' | 'pickFile' | 'loading'
>;

/** The resizable-columns helpers exposed as `platform.columns`. */
type ColumnsToolkit = Pick<typeof import('./columns.js'), 'createColumnManager' | 'decorateColumns'>;

/** The engine model helpers exposed as `platform.oie`. */
type OieHelpers = Pick<
    typeof import('./oie.js'),
    | 'uuid' | 'elementsToArray' | 'arrayToElements' | 'newChannel' | 'statePip' | 'stateLabel'
    | 'messageStatusTag' | 'elementTypeLabel' | 'destinationsOf' | 'setDestinations' | 'validateChannel'
    | 'emptyTransformer' | 'emptyFilter' | 'defaultSourceConnector' | 'defaultDestinationConnector'
    | 'CHANNEL_STATES' | 'MESSAGE_STATUSES' | 'STEP_TYPES' | 'RULE_TYPES'
>;

/**
 * A plugin's React component for an extension point. Plugins author UI against
 * `platform.React` (the shell's single React instance, so hooks/context work);
 * the shell renders it in-tree as `<Component {...props} />`. Typed structurally
 * — @oie/web-shell carries no `react` type dependency — so a component returning
 * JSX assigns cleanly to the `unknown` return.
 */
export type PluginComponent<P = Record<string, unknown>> = (props: P) => unknown;

export interface RouterApi {
    navigate(path: string): void;
    currentPath(): string;
}
export interface StoreApi {
    getState(key: string): any;
    /** Notifies this key's subscribers on every call, even when the value is unchanged. */
    setState(key: string, value: any): void;
    /** Returns an unsubscribe. */
    subscribe(key: string, fn: (value: any) => void): () => void;
}
export interface EventsApi {
    /** Returns an unsubscribe. */
    on(event: string, fn: (detail: any) => void): () => void;
    /** One detail value, delivered as the handler's sole argument. */
    emit(event: string, detail?: any): void;
}

/* ---- extension-point shapes ------------------------------------------------ */

export interface NavItem extends Pick<TaskRef, 'task'> {
    id: string;
    label: string;
    icon?: string;
    path: string;
    section?: string;
    order?: number;
    /** RBAC: checked as checkTask('view', task) — the nav entry hides when denied. Omit = always visible. */
    task?: string;
    [key: string]: any;
}

/** What a route handler / guard receives — `params` values are undefined for
    optional pattern segments that did not match. */
export interface ViewContext extends RouteContext {}
export interface ViewResult {
    el: HTMLElement;
    teardown?(): void;
}
export type ViewHandler = RouteHandler;
export interface ViewMeta {
    title?: string;
    [key: string]: any;
}

export type ConnectorMode = 'SOURCE' | 'DESTINATION';

export interface DashboardTab extends Pick<TaskRef, 'task'> {
    id: string;
    label: string;
    order?: number;
    /** RBAC: checked as checkTask('dashboard', task) — the tab hides when denied. Omit = always visible. */
    task?: string;
    /** Rendered in the dashboard's bottom tab strip. NOT remounted on selection
     *  change — the new selection arrives through the `selection` prop, so a tab
     *  may accumulate state (e.g. the Server Log's entries) across selections.
     *  It unmounts only when the user switches dock tabs or leaves the dashboard. */
    component: PluginComponent<{ selection: any; platform: Platform }>;
    [key: string]: any;
}
export interface DashboardColumn {
    id: string;
    label: string;
    order?: number;
    /** Channel-row cell content (a React node or string), called by the dashboard table for each status row — a per-cell renderer, not a mounted component. */
    cell(status: OieObject): unknown;
    /** Optional per-connector (child row) cell content; omit to leave connector rows blank in this column. */
    connectorCell?(child: OieObject): unknown;
    [key: string]: any;
}
export interface ChannelTab {
    id: string;
    label: string;
    order?: number;
    /** React tab body — rendered as `<Component {...ctx}/>`, authored against `platform.React`. */
    component: PluginComponent<{ channel: OieObject; platform: Platform; onChange(): void }>;
    [key: string]: any;
}
export interface SettingsPanel {
    id?: string;
    label: string;
    order?: number;
    /** A Settings tab. `setSave` registers the tab's save handler (Swing-style floppy task); `markDirty`/`markClean` drive the unsaved-changes prompt. */
    component: PluginComponent<{
        platform: Platform;
        setTasks(title: string, items: any[]): void;
        setSave(save: (() => boolean | Promise<boolean>) | null): void;
        markDirty(): void;
        markClean(): void;
    }>;
    [key: string]: any;
}
export interface AttachmentViewer {
    id: string;
    canHandle(attachment: OieObject): boolean;
    component: PluginComponent<{ attachment: OieObject; channelId: string; messageId: string | number; platform: Platform }>;
    [key: string]: any;
}
/** A node of a transformer's message tree, as shown on the Message Trees tab. */
export interface MessageTreeNode {
    /** Node name, with the data type's description when it has one, e.g. `PID.3 (Patient ID List)`. */
    label: string;
    /** Leaf text from the template, or null for a node with children. */
    value: string | null;
    /** The E4X or JSON accessor, e.g. `msg['PID']['PID.3']['PID.3.1'].toString()`. */
    accessor: string;
    children: MessageTreeNode[];
    /** JSON runtime type; `value` remains sample display text. */
    valueType?: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
}
/** Design-time result of a Mapper or Message Builder value against the inbound template. */
export type MappingPreview =
    | { status: 'ok'; raw: string; usedDefault: boolean; missing: boolean; steps: Array<{ find: string; replace: string; value: string }>; value: string }
    | { status: 'runtime'; reason: string }
    | { status: 'error'; reason: string };
export type { IteratorContext, MappingPreviewOptions } from './mapping-model.js';
import type { IteratorContext, MappingPreviewOptions } from './mapping-model.js';
export interface StepRuleType {
    label: string;
    create(): OieObject;
    /** Transformer step editors also get `messageTree`, `MessageFieldPicker`, `variables` and
     * `previewMapping` (API 4.11). Filter rule editors do not. */
    component: PluginComponent<{
        element: OieObject;
        onChange(): void;
        platform: Platform;
        /** The channel's destinations. */
        destinations?: Array<{ metaDataId: number | string; name: string }>;
        /** The inbound or outbound template as a tree, or null when there is no template or the engine cannot serialize it. */
        messageTree?(side: 'inbound' | 'outbound'): Promise<MessageTreeNode[] | null>;
        /** The host's Message Trees table as a field picker. `nodes` is undefined while loading and null when the template is unavailable. Pass `onSide` to offer Inbound and Outbound. */
        MessageFieldPicker?: PluginComponent<{
            side: 'inbound' | 'outbound';
            onSide?(side: 'inbound' | 'outbound'): void;
            nodes: MessageTreeNode[] | null | undefined;
            value?: string;
            onPick(node: MessageTreeNode): void;
            onRetry?(): void;
        }>;
        /** Map variables set by the other enabled steps, with their step numbers (`3`, or `5.2` inside an Iterator). */
        variables?(): Array<{ name: string; step: string }>;
        /** Current parent iterators, outermost first. Read again at action time;
         * membership and configured prefixes can change while editing. */
        iteratorContext?(): IteratorContext[];
        /** Evaluates `mapping`, `defaultValue` and `replacements` against the inbound template. */
        previewMapping?(step: { mapping?: string; defaultValue?: string; replacements?: unknown }, options?: MappingPreviewOptions): Promise<MappingPreview>;
    }>;
    [key: string]: any;
}
/** A custom properties class backed by an installed engine plugin. The engine
 * still executes the JavaScript returned by that class's getCode(); this hook
 * does not add a language compiler to the engine. Added in API 4.10. */
export interface CodeTemplateType {
    label: string;
    propertiesClass: string;
    order?: number;
    /** Allowed ContextType names. Omit for all contexts. Existing unsupported
     * selections are preserved and reported by validation, never silently lost. */
    contexts?: string[];
    /** Return fresh properties with one of the engine's existing type values:
     * FUNCTION, COMPILED_CODE, or DRAG_AND_DROP_CODE. The host sets @class and
     * supplies @version when absent. Source fields belong to the plugin. */
    create(ctx: { version: string; template: OieObject }): OieObject;
    /** Mutate properties, then call onChange(). Honor readOnly, including in
     * asynchronous callbacks. Use platform.React and the host code editor. */
    component: PluginComponent<{
        template: OieObject;
        properties: OieObject;
        onChange(): void;
        readOnly: boolean;
        platform: Platform;
    }>;
    /** Explicit Validate action: null means valid, a string describes a failure.
     * Receives a snapshot; custom source is never sent to the JavaScript validator.
     * Omit when this plugin cannot validate independently of deployment. */
    validate?(ctx: { template: OieObject; properties: OieObject; platform: Platform }): string | null | Promise<string | null>;
    /** Synchronous schema checks before save/import and explicit validation.
     * Return null or an error string. Do not require runtime availability or
     * reject incomplete source drafts; execution validation belongs in validate. */
    validateSave?(ctx: { template: OieObject; properties: OieObject; platform: Platform }): string | null;
    /** Synchronous declaration-only JavaScript for script autocomplete and the
     * Monaco language service. Return a function stub (with optional JSDoc),
     * never plugin-language source or executable runtime code. Receives a template snapshot;
     * missing/invalid results and provider failures contribute no completions. */
    getCompletionCode?(ctx: { template: OieObject; properties: OieObject; platform: Platform }): string | null;
}
export interface ConnectorPanel {
    defaults(version: string): OieObject;
    component: PluginComponent<{
        properties: OieObject;
        connector?: OieObject;
        channel?: OieObject;
        platform: Platform;
        onChange(): void;
    }>;
    [key: string]: any;
}
export interface ConnectorPropertiesPanel {
    id: string;
    title: string;
    order?: number;
    /** The JSON key inside `connector.properties.pluginProperties` (FQCN or a resolver). */
    propertiesClass: string | ((transportName: string, mode: ConnectorMode, connector: OieObject) => string);
    isSupported(transportName: string, mode: ConnectorMode, connector?: OieObject): boolean;
    defaults?(version: string, transportName?: string, mode?: ConnectorMode, connector?: OieObject): OieObject;
    component: PluginComponent<{
        getEntry(): OieObject | null;
        setEntry(entry: OieObject | null): void;
        propertiesClass: string;
        connector: OieObject;
        channel: OieObject;
        platform: Platform;
        onChange(): void;
    }>;
    [key: string]: any;
}
export interface DataTypeDef {
    label: string;
    propertiesClass?: string;
    [key: string]: any;
}
export interface TransmissionModeDef {
    label: string;
    order?: number;
    apply(tm: OieObject): void;
    sampleFrame?(tm: OieObject): string;
    openSettings?(tm: OieObject, onChange: () => void): void;
    [key: string]: any;
}
export interface ResourceTypeDef {
    label: string;
    propertiesClass?: string;
    detailHeader?: string;
    create(ctx: { version: string; containerIsArray: boolean }): OieObject;
    /** The resource's detail editor. `locked` is true for the built-in default resource; `refreshTable` re-reads the list. */
    component: PluginComponent<{ entry: OieObject; locked: boolean; platform: Platform; refreshTable(): void }>;
    [key: string]: any;
}

/** A per-channel action in the Channels view's right-click menu / task pane
    (Swing's ChannelPanelPlugin adding a task). */
export interface ChannelAction extends Pick<TaskRef, 'task'> {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    /** Default: enabled for a single-channel selection. */
    isEnabled?(ctx: ChannelActionContext): boolean;
    onInvoke(channel: OieObject, ctx: ChannelActionContext): void;
    [key: string]: any;
}
export interface ChannelActionContext {
    platform: Platform;
    channel: OieObject;
    selectedIds: string[];
    [key: string]: any;
}

/** A per-code-template action in the Code Templates view's right-click menu. */
export interface CodeTemplateAction extends Pick<TaskRef, 'task'> {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    isEnabled?(ctx: CodeTemplateActionContext): boolean;
    onInvoke(template: OieObject, ctx: CodeTemplateActionContext): void;
    [key: string]: any;
}
export interface CodeTemplateActionContext {
    platform: Platform;
    template: OieObject;
    library: OieObject | null;
    [key: string]: any;
}

/** A per-message action in the message browser: an item in a message row's
    right-click menu and, for the selected row, a Message Tasks button.
    Web-only — Swing's MessageBrowser takes no plugin tasks. */
export interface MessageAction extends Pick<TaskRef, 'task'> {
    id: string;
    label: string;
    icon?: string;
    order?: number;
    /** Default: enabled for every row. */
    isEnabled?(ctx: MessageActionContext): boolean;
    onInvoke(message: OieObject, ctx: MessageActionContext): void;
    [key: string]: any;
}
export interface MessageActionContext {
    platform: Platform;
    channelId: string;
    /** The engine Message the row belongs to (its connectorMessages included). */
    message: OieObject;
    /** The connector row in context: 0 is the source, otherwise a destination. */
    metaDataId: number;
    /** That connector's ConnectorMessage, or null when the source row is a
        placeholder (the search returned only destination rows). */
    connectorMessage: OieObject | null;
    [key: string]: any;
}

/** A Reference list entry for the script editors (Swing's
    CodeTemplatePlugin.getReferenceItems). */
export interface ReferenceItem {
    name: string;
    description?: string;
    code: string;
    /** FUNCTION drops the call, COMPILED_CODE is not draggable. Default: DRAG_AND_DROP_CODE (drops the code). */
    type?: 'FUNCTION' | 'DRAG_AND_DROP_CODE' | 'COMPILED_CODE';
    /** ContextType names the entry applies to, e.g. 'SOURCE_FILTER_TRANSFORMER'. Default: every context. */
    contexts?: string[];
}

/** A loaded plugin's manifest plus its load status. */
export interface PluginManifest {
    /** A load failure must block the UI until this authorization provider loads. */
    authorization?: boolean;
    id: string;
    name?: string;
    version?: string;
    entry?: string | null;
    status?: 'loaded' | 'error' | 'incompatible' | 'no-client' | string;
    error?: string;
    /** Minimum @oie API version the plugin declares it needs (plugin.json `oie.apiMin`). */
    apiMin?: string | null;
    [key: string]: any;
}

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
export const OIE_API_VERSION = '4.11.0';   // 4.11: message trees, variables and mapping preview for step editors

function parseApiVersion(v: unknown): { major: number; minor: number } {
    const [major, minor] = String(v == null ? '' : v).split('.');
    return { major: parseInt(major, 10) || 0, minor: parseInt(minor, 10) || 0 };
}

// Does `provided` satisfy a plugin's required minimum? Undeclared min => always
// compatible (opt-in check: bundled/framework plugins move in lockstep and don't
// declare one). Same major (no breaking change) and provided minor >= required.
export function apiCompatible(provided: string, requiredMin?: string | null): boolean {
    if (requiredMin == null || requiredMin === '') return true;
    const p = parseApiVersion(provided);
    const r = parseApiVersion(requiredMin);
    return p.major === r.major && p.minor >= r.minor;
}

const registries = {
    navItems: [] as NavItem[],
    dashboardTabs: [] as DashboardTab[],
    dashboardColumns: [] as DashboardColumn[],
    channelTabs: [] as ChannelTab[],
    channelActions: [] as ChannelAction[],
    codeTemplateActions: [] as CodeTemplateAction[],
    codeTemplateTypes: new Map<string, CodeTemplateType>(),
    messageActions: [] as MessageAction[],
    settingsPanels: [] as SettingsPanel[],
    attachmentViewers: [] as AttachmentViewer[],
    stepTypes: new Map<string, StepRuleType>(),
    ruleTypes: new Map<string, StepRuleType>(),
    connectorPanels: new Map<string, ConnectorPanel>(),
    connectorPropertiesPanels: [] as ConnectorPropertiesPanel[],
    dataTypes: new Map<string, DataTypeDef>(),
    transmissionModes: new Map<string, TransmissionModeDef>(),
    resourceTypes: new Map<string, ResourceTypeDef>()
};

function sorted<T extends { order?: number }>(list: T[]): T[] {
    return [...list].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/** The platform handed to every plugin's `register(platform)`. */
export interface Platform {
    /** The @oie/* API contract version this web administrator implements, independently of the engine version. */
    apiVersion: string;
    /* shared libraries */
    api: Api;
    ui: DomToolkit;
    oie: OieHelpers;
    columns: ColumnsToolkit;
    router: RouterApi;
    store: StoreApi;
    events: EventsApi;
    /** MFA/extended-login authenticator registry (see core/login-auth.ts). Must be called pre-login. */
    registerLoginAuthenticator: typeof registerLoginAuthenticator;
    createCodeEditor: typeof createCodeEditor;
    setCodeEditorFactory: typeof setCodeEditorFactory;
    /** Register a plugin-owned language definition, loaded only when requested
     * by createCodeEditor({ language: id }). Added in API 4.10. */
    registerEditorLanguage: typeof registerEditorLanguage;
    /** Read-only side-by-side diff viewer backed by the host's single Monaco (degrades to plain panes). */
    createDiffEditor: typeof createDiffEditor;
    /** The shell's own React instance — author plugin components against this so every plugin shares one React (hooks/context work). */
    React: any;
    /** Wrap a React component as a routed-view handler: `registerView(path, reactView(MyView), { title })`. The component receives the route's `ViewContext` as props. */
    reactView(component: PluginComponent<ViewContext>): ViewHandler;

    /** RBAC hook (Swing AuthorizationController): hide nav items / tasks / menu items. Default = allow all. */
    setAuthorizationController: typeof setAuthorizationController;
    checkTask: typeof checkTask;

    /* extension points */
    /** Add a glyph to the shared icon set: SVG path data on a 24x24 grid, rendered stroke-only in currentColor. Referenced by name anywhere an `icon` is accepted (nav items, actions, `ui.icon()`). Built-in names cannot be overridden. */
    registerIcon(name: string, pathData: string): void;
    registerNavItem(item: NavItem): void;
    /** Command-palette entry — same shape as a nav item. Returns an unregister fn. */
    registerCommand(command: Command): () => void;
    registerView(path: string, handler: ViewHandler, meta?: ViewMeta): void;
    registerDashboardTab(tab: DashboardTab): void;
    registerDashboardColumn(column: DashboardColumn): void;
    registerChannelTab(tab: ChannelTab): void;
    registerChannelAction(action: ChannelAction): void;
    registerCodeTemplateAction(action: CodeTemplateAction): void;
    registerCodeTemplateType(id: string, def: CodeTemplateType): void;
    registerMessageAction(action: MessageAction): void;
    /** Add Reference list and autocomplete entries under `category` — a new category or an existing one such as 'Conversion Functions'. */
    registerReferences(category: string, items: ReferenceItem[]): void;
    registerSettingsPanel(panel: SettingsPanel): void;
    registerAttachmentViewer(viewer: AttachmentViewer): void;
    registerStepType(type: string, def: StepRuleType): void;
    registerRuleType(type: string, def: StepRuleType): void;
    registerConnectorPanel(transportName: string, mode: ConnectorMode, def: ConnectorPanel): void;
    registerConnectorPropertiesPanel(def: ConnectorPropertiesPanel): void;
    registerDataType(name: string, def: DataTypeDef): void;
    registerTransmissionMode(name: string, def: TransmissionModeDef): void;
    registerResourceType(type: string, def: ResourceTypeDef): void;

    /* lookups (used by core views; available to plugins) */
    navItems(): NavItem[];
    dashboardTabs(): DashboardTab[];
    dashboardColumns(): DashboardColumn[];
    channelTabs(): ChannelTab[];
    channelActions(): ChannelAction[];
    codeTemplateActions(): CodeTemplateAction[];
    codeTemplateTypes(): Map<string, CodeTemplateType>;
    messageActions(): MessageAction[];
    references(): Array<ReferenceItem & { category: string }>;
    settingsPanels(): SettingsPanel[];
    attachmentViewers(): AttachmentViewer[];
    stepType(type: string): StepRuleType | undefined;
    stepTypes(): Map<string, StepRuleType>;
    ruleType(type: string): StepRuleType | undefined;
    ruleTypes(): Map<string, StepRuleType>;
    connectorPanel(transportName: string, mode: string): ConnectorPanel | undefined;
    connectorPanels(): Map<string, ConnectorPanel>;
    connectorPropertiesPanels(): ConnectorPropertiesPanel[];
    dataType(name: string): DataTypeDef | undefined;
    dataTypes(): Map<string, DataTypeDef>;
    transmissionModes(): TransmissionModeDef[];
    resourceTypes(): ResourceTypeDef[];
}

export const platform: Platform = {
    /* The @oie/* API contract version this web admin implements (see OIE_API_VERSION).
       Plugins can read platform.apiVersion to feature-detect at runtime. */
    apiVersion: OIE_API_VERSION,
    /* core libraries, handed to plugins so they share the app's toolkit */
    api: apiModule.default,
    ui,
    // MFA/extended-login: register an authenticator keyed by the server's
    // clientPluginClass (see core/login-auth.ts). Must be called pre-login.
    registerLoginAuthenticator,
    oie,
    columns,
    // The host's React instance (set by the shell at boot). Plugins author React
    // UI against THIS — e.g. `const React = platform.React` then JSX — so plugin
    // components share the one React the app renders with (hooks/context work).
    React: null,
    // Wraps a React component as a routed-view handler (set by the shell at
    // boot): platform.registerView(path, platform.reactView(MyView), { title }).
    reactView: null as any,
    router: { navigate: router.navigate, currentPath: router.currentPath },
    store: { getState: store.getState, setState: store.setState, subscribe: store.subscribe },
    events: { on: store.on, emit: store.emit },
    createCodeEditor,
    setCodeEditorFactory,
    registerEditorLanguage,
    // Read-only side-by-side diff viewer backed by the host's single Monaco
    // instance (core/diffeditor.ts). Plugins showing diffs use this so they
    // never bundle their own Monaco. Degrades to a plain two-pane view.
    createDiffEditor,

    /* RBAC hook (Swing AuthorizationController): a Role-Based Access Control plugin
       calls setAuthorizationController({ checkTask(taskGroup, taskName) }) to hide
       nav items / task buttons / right-click items. checkTask is consulted by the
       menu builders. Default = allow all. */
    setAuthorizationController(controller) {
        setAuthorizationController(controller);
        store.setState('webPlugins', [...(store.getState('webPlugins') || [])]);
    },
    checkTask,

    /* ---- extension points ---- */

    /* A plugin glyph for the shared icon set (core/icons.ts): pathData is SVG
       path data on a 24x24 grid, rendered stroke-only in currentColor — the
       same format as the built-ins. Register before referencing the name in a
       nav item / action / ui.icon() call. Built-in names are protected. */
    registerIcon,
    registerNavItem(item) { registries.navItems.push(item); },
    /* Command-palette entry. Same shape as a nav item ({ id, label, icon, section,
       task, rbac, path | run }); see core/commands.ts. */
    registerCommand(command) { return registerCommand(command); },
    registerView(path, handler, meta = {}) { router.register(path, handler, meta); },
    registerDashboardTab(tab) { registries.dashboardTabs.push(tab); },
    registerDashboardColumn(column) { registries.dashboardColumns.push(column); },
    registerChannelTab(tab) { registries.channelTabs.push(tab); },
    /* A per-channel action, shown in the Channels view's right-click menu and
       Channel Tasks pane when a single channel is selected (Swing's
       ChannelPanelPlugin adding a task). def = { id, label, icon?, order?,
       task?  (RBAC task name, gated via checkTask),
       isEnabled?(ctx) → bool  (default: enabled for a single-channel selection),
       onInvoke(channel, ctx) }. ctx = { platform, channel, selectedIds }. */
    registerChannelAction(action) { registries.channelActions.push(action); },
    /* A per-code-template action, shown in the Code Templates view's right-click
       menu when a single template is selected (Swing's code-template panel
       action). def = { id, label, icon?, order?, task?,
       isEnabled?(ctx) → bool, onInvoke(template, ctx) }.
       ctx = { platform, template, library }. */
    registerCodeTemplateAction(action) { registries.codeTemplateActions.push(action); },
    registerCodeTemplateType(id, def) {
        if (!id || ['FUNCTION', 'COMPILED_CODE', 'DRAG_AND_DROP_CODE'].includes(id)
            || !def.label || !def.propertiesClass
            || def.propertiesClass === 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties'
            || typeof def.create !== 'function' || typeof def.component !== 'function') {
            throw new Error('Code template types require a unique id, properties class, label, create function, and component');
        }
        if (registries.codeTemplateTypes.has(id)
            || [...registries.codeTemplateTypes.values()].some(type => type.propertiesClass === def.propertiesClass)) {
            throw new Error(`Code template type is already registered: ${id}`);
        }
        registries.codeTemplateTypes.set(id, def);
        if (def.getCompletionCode) registerTemplateCompletionSource(def.propertiesClass,
            template => def.getCompletionCode!({ template, properties: template.properties, platform }));
        store.emit('codeTemplateTypes:changed');
    },
    /* A per-message action, shown in the message browser's row right-click menu
       and, for the selected row, in the Message Tasks pane. Web-only: Swing's
       MessageBrowser has no plugin hook. def = { id, label, icon?, order?,
       task?  (RBAC task name under the `message` group, gated via checkTask),
       isEnabled?(ctx) → bool  (default: enabled for every row),
       onInvoke(message, ctx) }. ctx = { platform, channelId, message,
       metaDataId, connectorMessage }. */
    registerMessageAction(action) { registries.messageActions.push(action); },
    /* Script editor Reference list entries (Swing's CodeTemplatePlugin
       .getReferenceItems). items = [{ name, description?, code,
       type?  (FUNCTION | DRAG_AND_DROP_CODE (default) | COMPILED_CODE),
       contexts?  (ContextType names; default every context) }]. */
    registerReferences(category, items) {
        addReferences(items.map((item) => ({ ...item, category })));
    },
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
    channelActions: () => sorted(registries.channelActions),
    codeTemplateActions: () => sorted(registries.codeTemplateActions),
    codeTemplateTypes: () => new Map([...registries.codeTemplateTypes].sort(([, a], [, b]) => (a.order ?? 100) - (b.order ?? 100))),
    messageActions: () => sorted(registries.messageActions),
    references: () => registeredReferences() as Array<ReferenceItem & { category: string }>,
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
async function fetchEngineManifests(): Promise<PluginManifest[]> {
    let paths: string[];
    let wsBase: string | null;
    try {
        wsBase = await webSupportBase();
        if (wsBase === null) {
            // Neither engine-native endpoints nor the websupport plugin: engine-served
            // plugin UIs (and message trees / validation) are off. Say so once, visibly,
            // instead of plugin UIs silently not appearing.
            ui.toast('The Web Support plugin is not installed on this engine — plugin UIs, message trees, and script validation are disabled. Install "websupport" from the Extensions page.', 'warn');
            return [];
        }
        paths = apiModule.asList(await apiModule.get(`${wsBase}/webplugins`, undefined, { noAuthHandler: true }), 'string');
        if (paths.some(path => typeof path !== 'string' || !path.trim())) throw new Error('Invalid plugin discovery response');
    } catch (error) {
        throw new Error('Unable to discover authorization plugins', { cause: error });
    }

    const results = await Promise.all(paths.map(async (path): Promise<PluginManifest | null> => {
        const base = apiUrl(`${wsBase}/webplugins/${encodeURIComponent(path)}`);
        try {
            // Served raw by the engine (not XStream-wrapped), so read it as plain JSON.
            const res = await engineFetch(`${base}/plugin.json`, {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                signal: AbortSignal.timeout(120_000)
            });
            if (!res.ok) throw new Error(`Plugin manifest request failed (${res.status})`);
            const m = await res.json();
            assertEngineResponse(res);
            if (!m || typeof m.id !== 'string' || !m.id.trim()) throw new Error('Invalid plugin manifest');
            if (m.client?.entry != null && typeof m.client.entry !== 'string') throw new Error('Invalid plugin entry');
            if (m.client?.entry && !m.client.entry.trim()) throw new Error('Invalid plugin entry');
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
                source: 'engine',
                assetBase: base,
                authorization: m.authorization === true || m.id === 'rbac' || path === 'rbac'
            };
        } catch (e) {
            console.warn(`[plugins] engine plugin "${path}" manifest failed:`, e);
            throw new Error(`Unable to discover authorization for plugin ${path}`, { cause: e });
        }
    }));
    return results.filter((m): m is PluginManifest => !!m);
}

// Registries append during register(), so retries must reload the page. Sharing
// this promise also prevents simultaneous callers registering a plugin twice.
let pluginsLoading: Promise<PluginManifest[]> | null = null;
export function loadPlugins(): Promise<PluginManifest[]> {
    if (!pluginsLoading) {
        beginAuthorizationDiscovery();
        let assertEngineSession: () => void;
        try { assertEngineSession = captureEngineSession(); }
        catch (error) {
            // Keep the public Promise contract even when setup detects a stale
            // session synchronously. Failed attempts remain cached until reload.
            blockAuthorization(true);
            pluginsLoading = Promise.reject(error);
            return pluginsLoading;
        }
        const identity = () => {
            const user = store.getState('user');
            return user ? String(user.id ?? user.username) : null;
        };
        const user = identity();
        let invalidated = false;
        const assertSession = () => {
            assertEngineSession();
            if (invalidated || identity() !== user) throw new Error('Discarded plugin loading from the previous session');
        };
        store.subscribe('user', () => {
            if (identity() !== user) {
                invalidated = true;
                blockAuthorization(true);
            }
        });
        pluginsLoading = loadPluginsOnce(assertSession).then(loaded => {
            assertSession();
            blockAuthorization(false);
            store.setState('webPlugins', [...(store.getState('webPlugins') || [])]);
            assertSession();
            return loaded;
        }).catch(error => {
            blockAuthorization(true);
            throw error;
        });
    }
    return pluginsLoading;
}

async function loadPluginsOnce(assertSession: () => void): Promise<PluginManifest[]> {
    let manifests: PluginManifest[] = [];
    try {
        const res = await fetch(appUrl('/webadmin/plugins.json'), { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`Bundled plugin manifest request failed (${res.status})`);
        manifests = await res.json();
        if (!Array.isArray(manifests) || manifests.some(m => !m || typeof m.id !== 'string' || !m.id.trim())) throw new Error('Invalid bundled plugin manifests');
    } catch (e) {
        throw new Error('Unable to discover bundled authorization plugins', { cause: e });
    }
    assertSession();

    // Merge in the connected engine's own web plugins. Installs are forward-only —
    // the engine owns and serves an extension's web half — so the ENGINE copy is
    // authoritative for its id and supersedes any local manifest with the same id.
    // In practice the two sets are disjoint: /webadmin/plugins.json is the bundled
    // framework plugins (connectors, data types, viewers, …) that ship with the web
    // admin, and /api/webplugins is whatever the connected engine has installed.
    // Bundled manifests use logical root paths so the same JSON works in Node
    // and in a WAR context. Turn those into physical app URLs before import().
    manifests = manifests.map((manifest) => ({
        ...manifest,
        assetBase: appUrl(`/plugins/${encodeURIComponent(manifest.id)}`),
        entry: manifest.entry && manifest.entry.startsWith('/plugins/')
            ? appUrl(manifest.entry)
            : manifest.entry
    }));

    const engineManifests = await fetchEngineManifests();
    assertSession();
    const engineIds = new Set(engineManifests.map((m) => m.id).filter(Boolean));
    manifests = manifests.filter((m) => !engineIds.has(m.id)).concat(engineManifests);

    // Compatibility gate: a plugin that declares an @oie apiMin newer than what we
    // implement (or from a different major) would call APIs that aren't here and
    // crash on import/register. Skip those BEFORE importing — never run incompatible
    // code — and surface them so the mismatch is visible (Extensions → web plugins)
    // instead of a silent failure. Plugins with no apiMin (bundled/framework, and
    // any built before this contract) are unaffected.
    const isAuthorization = (manifest: PluginManifest) => manifest.authorization === true || manifest.id === 'rbac';
    const incompatible: PluginManifest[] = [];
    manifests = manifests.filter((m) => {
        if (apiCompatible(OIE_API_VERSION, m.apiMin)) return true;
        const message = `requires @oie API ${m.apiMin}, but this web administrator provides ${OIE_API_VERSION}`;
        console.warn(`[plugins] ${m.id} skipped — ${message}`);
        if (isAuthorization(m)) throw new Error(`Authorization plugin ${m.id} ${message}`);
        incompatible.push({ ...m, status: 'incompatible', error: message });
        return false;
    });

    // Import every plugin entry module IN PARALLEL — a serial `await import()`
    // per plugin cost a round-trip each (34 plugins ≈ 34 RTs; at 100ms that's
    // ~3.4s). Server-side modulepreload hints start these fetches even earlier.
    const imported = await Promise.all(manifests.map(async (manifest): Promise<{ manifest: PluginManifest; module?: any; failed?: boolean; error?: unknown }> => {
        if (!manifest.entry) return { manifest, module: null };
        // Plugin entries are runtime URLs (/plugins/<id>/…), not build-time paths —
        // tell Vite/Rollup not to analyze/bundle this import (it's loaded live).
        //
        // OIE protects every /api request with X-Requested-With. Browser import()
        // cannot attach that header, so a WAR (which talks to OIE directly rather
        // than through the Node proxy) fetches the single-file plugin module with
        // the header and imports its authenticated contents. Bare @oie/* imports
        // still resolve through the page import map. Node/Docker retain direct URL
        // imports, including support for plugins that split relative modules.
        try {
            if (manifest.source === 'engine' && store.getState('webadminConfig')?.deployment === 'war') {
                const res = await engineFetch(manifest.entry, {
                    credentials: 'same-origin',
                    headers: { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                    signal: AbortSignal.timeout(120_000)
                });
                if (!res.ok) throw new Error(`plugin module request failed (${res.status})`);
                const source = await res.text();
                assertEngineResponse(res);
                const objectUrl = URL.createObjectURL(new Blob([
                    source,
                    `\n//# sourceURL=${manifest.entry}\n`
                ], { type: 'text/javascript' }));
                try {
                    return { manifest, module: await import(/* @vite-ignore */ objectUrl) };
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            }
            return { manifest, module: await import(/* @vite-ignore */ manifest.entry) };
        }
        catch (e) { return { manifest, failed: true, error: e }; }
    }));

    // Establish required controllers before ordinary plugins consult checkTask.
    // Keep manifest order within each phase; views/commands remain unavailable
    // until the entire loader resolves. Permission queries during register() must
    // reflect the controller, including helpers imported from @oie/web-ui.
    assertSession();
    beginAuthorizationRegistration(manifests.some(isAuthorization));
    const registrationOrder = [
        ...imported.filter(({ manifest }) => isAuthorization(manifest)),
        ...imported.filter(({ manifest }) => !isAuthorization(manifest))
    ];
    const loaded: PluginManifest[] = [];
    for (const { manifest, module, failed, error } of registrationOrder) {
        assertSession();
        if (!manifest.entry) {
            if (isAuthorization(manifest)) throw new Error(`Authorization plugin ${manifest.id} has no entry module`);
            loaded.push({ ...manifest, status: 'no-client' }); continue;
        }
        if (failed) {
            if (isAuthorization(manifest)) throw new Error(`Authorization plugin ${manifest.id} failed to load`, { cause: error });
            console.error(`[plugins] ${manifest.id} failed:`, error);
            loaded.push({ ...manifest, status: 'error', error: error instanceof Error ? error.message : String(error) });
            continue;
        }
        if (typeof module.register === 'function') {
            const before = authorizationRegistration();
            try {
                await module.register(platform, createPluginContext(manifest.assetBase, manifest.source === 'engine', assertSession));
                assertSession();
                const after = authorizationRegistration();
                if (isAuthorization(manifest) && (!after.registered || after.revision === before.revision)) {
                    throw new Error('The authorization plugin did not install a controller');
                }
                loaded.push({ ...manifest, status: 'loaded' });
                console.log(`[plugins] ${manifest.id} v${manifest.version} registered`);
            } catch (e) {
                assertSession();
                if (isAuthorization(manifest) || authorizationRegistration().revision !== before.revision) {
                    throw new Error(`Authorization plugin ${manifest.id} failed to initialize`, { cause: e });
                }
                console.error(`[plugins] ${manifest.id} register failed:`, e);
                loaded.push({ ...manifest, status: 'error', error: e instanceof Error ? e.message : String(e) });
            }
        } else {
            if (isAuthorization(manifest)) throw new Error(`Authorization plugin ${manifest.id} has no register export`);
            loaded.push({ ...manifest, status: 'error', error: 'entry module has no register(platform) export' });
        }
    }
    assertSession();
    if (manifests.some(isAuthorization) && !authorizationRegistration().registered) {
        throw new Error('The authorization controller was removed during plugin loading');
    }
    // Include the version-skipped plugins so the mismatch is visible in the UI.
    store.setState('webPlugins', [...loaded, ...incompatible]);
    return loaded;
}
