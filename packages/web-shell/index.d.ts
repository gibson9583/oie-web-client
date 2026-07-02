/*
 * Type definitions for @oie/web-shell — the Shell API. `platform` is the object
 * a plugin registers through (the web equivalent of the Swing ClientPlugin SPI);
 * `loadPlugins` is the bootstrap the shell itself calls.
 *
 * Library members (`platform.api`/`ui`/`oie`/`columns`) are typed by reference
 * to @oie/web-api and @oie/web-ui so they stay in sync with those packages.
 */

import type { Api, OieObject } from '@oie/web-api';

/** The DOM toolkit subset exposed as `platform.ui` (the ui.js surface). */
type DomToolkit = Pick<
    typeof import('@oie/web-ui'),
    | 'h' | 'clear' | 'icon' | 'fmtNumber' | 'fmtDate' | 'escapeHtml' | 'toast' | 'modal'
    | 'confirmDialog' | 'promptDialog' | 'contextMenu' | 'closeContextMenu' | 'tabs' | 'DataTable'
    | 'field' | 'textInput' | 'numberInput' | 'select' | 'checkbox' | 'taskButton'
    | 'downloadFile' | 'saveFile' | 'pickFile' | 'loading'
>;

/** The resizable-columns helpers exposed as `platform.columns`. */
type ColumnsToolkit = Pick<typeof import('@oie/web-ui'), 'createColumnManager' | 'decorateColumns'>;

/** The engine model helpers exposed as `platform.oie`. */
type OieHelpers = Pick<
    typeof import('@oie/web-api'),
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
    setState(key: string, value: any): void;
    subscribe(key: string, fn: (value: any) => void): void;
}
export interface EventsApi {
    on(event: string, fn: (...args: any[]) => void): void;
    emit(event: string, ...args: any[]): void;
}

/* ---- extension-point shapes ------------------------------------------------ */

export interface NavItem {
    id: string;
    label: string;
    icon?: string;
    path: string;
    section?: string;
    order?: number;
}
export interface ViewContext {
    params: Record<string, string>;
    query: Record<string, string> | URLSearchParams;
}
export interface ViewResult {
    el: HTMLElement;
    teardown?(): void;
}
export type ViewHandler = (ctx: ViewContext) => ViewResult;
export interface ViewMeta {
    title?: string;
}

export type ConnectorMode = 'SOURCE' | 'DESTINATION';

export interface DashboardTab {
    id: string;
    label: string;
    order?: number;
    /** Rendered in the dashboard's bottom tab strip; re-mounts when the selection changes. */
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
        setSave(save: (() => boolean) | null): void;
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
export interface StepRuleType {
    label: string;
    create(): OieObject;
    component: PluginComponent<{ element: OieObject; onChange(): void; platform: Platform }>;
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
    /** The JSON key inside `connector.properties.pluginProperties` (FQCN or a resolver). */
    propertiesClass: string | ((transportName: string, mode: ConnectorMode, connector: OieObject) => string);
    isSupported(transportName: string, mode: ConnectorMode, connector?: OieObject): boolean;
    defaults(version: string, transportName?: string, mode?: ConnectorMode, connector?: OieObject): OieObject;
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

/** A loaded plugin's manifest plus its load status. */
export interface PluginManifest {
    id: string;
    name?: string;
    version?: string;
    entry?: string;
    status?: 'loaded' | 'error' | 'incompatible' | 'no-client' | string;
    error?: string;
    /** Minimum @oie API version the plugin declares it needs (plugin.json `oie.apiMin`). */
    apiMin?: string | null;
    [key: string]: any;
}

/** The platform handed to every plugin's `register(platform)`. */
export interface Platform {
    /** The @oie/* API contract version this web administrator implements — tracks the OIE engine release line (e.g. "4.6.0"). */
    apiVersion: string;
    /* shared libraries */
    api: Api;
    ui: DomToolkit;
    oie: OieHelpers;
    columns: ColumnsToolkit;
    router: RouterApi;
    store: StoreApi;
    events: EventsApi;
    createCodeEditor: typeof import('@oie/web-ui').createCodeEditor;
    setCodeEditorFactory: typeof import('@oie/web-ui').setCodeEditorFactory;
    /** The shell's own React instance — author plugin components against this so every plugin shares one React (hooks/context work). */
    React: any;
    /** Wrap a React component as a routed-view handler: `registerView(path, reactView(MyView), { title })`. The component receives the route's `ViewContext` as props. */
    reactView(component: PluginComponent<ViewContext>): ViewHandler;

    /* extension points */
    registerNavItem(item: NavItem): void;
    registerView(path: string, handler: ViewHandler, meta?: ViewMeta): void;
    registerDashboardTab(tab: DashboardTab): void;
    registerDashboardColumn(column: DashboardColumn): void;
    registerChannelTab(tab: ChannelTab): void;
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

export const platform: Platform;
/** Discover, import, and register every plugin; returns each plugin's load status. */
export function loadPlugins(): Promise<PluginManifest[]>;

/** The @oie/* API contract version this build implements (same value as `platform.apiVersion`). */
export const OIE_API_VERSION: string;
/**
 * True if `provided` satisfies a plugin's required minimum: same major (no breaking
 * change) and provided minor >= required minor. An empty/undefined `requiredMin` is
 * always compatible. Use with `OIE_API_VERSION`/`platform.apiVersion`.
 */
export function apiCompatible(provided: string, requiredMin?: string | null): boolean;
