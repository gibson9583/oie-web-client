import { registerLoginAuthenticator } from './login-auth.js';
import { createCodeEditor, setCodeEditorFactory } from './codeeditor.js';
import { createDiffEditor } from './diffeditor.js';
import { setAuthorizationController, checkTask } from './authorization.js';
import type { Command } from './commands.js';
import type { OieObject } from './wire-types.js';
import type { Api } from './api.js';
import type { TaskRef } from './ui.js';
import type { RouteContext, RouteHandler } from './router.js';
/** The DOM toolkit subset exposed as `platform.ui` (the ui.ts surface). */
type DomToolkit = Pick<typeof import('./ui.js'), 'h' | 'clear' | 'icon' | 'fmtNumber' | 'fmtDate' | 'escapeHtml' | 'toast' | 'modal' | 'confirmDialog' | 'promptDialog' | 'contextMenu' | 'closeContextMenu' | 'tabs' | 'DataTable' | 'field' | 'textInput' | 'numberInput' | 'select' | 'checkbox' | 'taskButton' | 'downloadFile' | 'saveFile' | 'pickFile' | 'loading'>;
/** The resizable-columns helpers exposed as `platform.columns`. */
type ColumnsToolkit = Pick<typeof import('./columns.js'), 'createColumnManager' | 'decorateColumns'>;
/** The engine model helpers exposed as `platform.oie`. */
type OieHelpers = Pick<typeof import('./oie.js'), 'uuid' | 'elementsToArray' | 'arrayToElements' | 'newChannel' | 'statePip' | 'stateLabel' | 'messageStatusTag' | 'elementTypeLabel' | 'destinationsOf' | 'setDestinations' | 'validateChannel' | 'emptyTransformer' | 'emptyFilter' | 'defaultSourceConnector' | 'defaultDestinationConnector' | 'CHANNEL_STATES' | 'MESSAGE_STATUSES' | 'STEP_TYPES' | 'RULE_TYPES'>;
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
export interface ViewContext extends RouteContext {
}
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
    component: PluginComponent<{
        selection: any;
        platform: Platform;
    }>;
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
    component: PluginComponent<{
        channel: OieObject;
        platform: Platform;
        onChange(): void;
    }>;
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
        setSave(save: (() => boolean) | null): void;
        markDirty(): void;
        markClean(): void;
    }>;
    [key: string]: any;
}
export interface AttachmentViewer {
    id: string;
    canHandle(attachment: OieObject): boolean;
    component: PluginComponent<{
        attachment: OieObject;
        channelId: string;
        messageId: string | number;
        platform: Platform;
    }>;
    [key: string]: any;
}
export interface StepRuleType {
    label: string;
    create(): OieObject;
    component: PluginComponent<{
        element: OieObject;
        onChange(): void;
        platform: Platform;
    }>;
    [key: string]: any;
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
    create(ctx: {
        version: string;
        containerIsArray: boolean;
    }): OieObject;
    /** The resource's detail editor. `locked` is true for the built-in default resource; `refreshTable` re-reads the list. */
    component: PluginComponent<{
        entry: OieObject;
        locked: boolean;
        platform: Platform;
        refreshTable(): void;
    }>;
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
/** A loaded plugin's manifest plus its load status. */
export interface PluginManifest {
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
export declare const OIE_API_VERSION = "4.6.0";
export declare function apiCompatible(provided: string, requiredMin?: string | null): boolean;
/** The platform handed to every plugin's `register(platform)`. */
export interface Platform {
    /** The @oie/* API contract version this web administrator implements — tracks the OIE engine release line (e.g. "4.6.0"). */
    apiVersion: string;
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
    /** Read-only side-by-side diff viewer backed by the host's single Monaco (degrades to plain panes). */
    createDiffEditor: typeof createDiffEditor;
    /** The shell's own React instance — author plugin components against this so every plugin shares one React (hooks/context work). */
    React: any;
    /** Wrap a React component as a routed-view handler: `registerView(path, reactView(MyView), { title })`. The component receives the route's `ViewContext` as props. */
    reactView(component: PluginComponent<ViewContext>): ViewHandler;
    /** RBAC hook (Swing AuthorizationController): hide nav items / tasks / menu items. Default = allow all. */
    setAuthorizationController: typeof setAuthorizationController;
    checkTask: typeof checkTask;
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
    registerSettingsPanel(panel: SettingsPanel): void;
    registerAttachmentViewer(viewer: AttachmentViewer): void;
    registerStepType(type: string, def: StepRuleType): void;
    registerRuleType(type: string, def: StepRuleType): void;
    registerConnectorPanel(transportName: string, mode: ConnectorMode, def: ConnectorPanel): void;
    registerConnectorPropertiesPanel(def: ConnectorPropertiesPanel): void;
    registerDataType(name: string, def: DataTypeDef): void;
    registerTransmissionMode(name: string, def: TransmissionModeDef): void;
    registerResourceType(type: string, def: ResourceTypeDef): void;
    navItems(): NavItem[];
    dashboardTabs(): DashboardTab[];
    dashboardColumns(): DashboardColumn[];
    channelTabs(): ChannelTab[];
    channelActions(): ChannelAction[];
    codeTemplateActions(): CodeTemplateAction[];
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
export declare const platform: Platform;
export declare function loadPlugins(): Promise<PluginManifest[]>;
export {};
