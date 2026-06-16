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
    render(host: HTMLElement, ctx: { selection: any; platform: Platform }): void;
    [key: string]: any;
}
export interface DashboardColumn {
    id: string;
    label: string;
    order?: number;
    render(dashboardStatus: OieObject): Node | string | number | null | undefined;
    [key: string]: any;
}
export interface ChannelTab {
    id: string;
    label: string;
    order?: number;
    render(host: HTMLElement, ctx: { channel: OieObject; platform: Platform; onChange(): void }): void;
    [key: string]: any;
}
export interface SettingsPanel {
    id?: string;
    label: string;
    order?: number;
    render(host: HTMLElement, ctx: { platform: Platform }): void;
    [key: string]: any;
}
export interface AttachmentViewer {
    id: string;
    canHandle(attachment: OieObject): boolean;
    render(host: HTMLElement, ctx: { attachment: OieObject; channelId: string; messageId: string | number; platform: Platform }): void;
    [key: string]: any;
}
export interface StepRuleType {
    label: string;
    create(): OieObject;
    render(host: HTMLElement, ctx: { element: OieObject; onChange(): void }): void;
    [key: string]: any;
}
export interface ConnectorPanel {
    defaults(version: string): OieObject;
    render(host: HTMLElement, ctx: {
        properties: OieObject;
        connector?: OieObject;
        channel?: OieObject;
        platform: Platform;
        onChange(): void;
    }): void;
    [key: string]: any;
}
export interface ConnectorPropertiesPanel {
    id: string;
    title: string;
    /** The JSON key inside `connector.properties.pluginProperties` (FQCN or a resolver). */
    propertiesClass: string | ((transportName: string, mode: ConnectorMode, connector: OieObject) => string);
    isSupported(transportName: string, mode: ConnectorMode, connector?: OieObject): boolean;
    defaults(version: string, transportName?: string, mode?: ConnectorMode, connector?: OieObject): OieObject;
    render(host: HTMLElement, ctx: {
        getEntry(): OieObject | null;
        setEntry(entry: OieObject | null): void;
        propertiesClass: string;
        connector: OieObject;
        channel: OieObject;
        platform: Platform;
        onChange(): void;
    }): void;
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
    renderDetail(host: HTMLElement, ctx: { entry: OieObject; locked: boolean; platform: Platform; refreshTable(): void }): void;
    [key: string]: any;
}

/** A loaded plugin's manifest plus its load status. */
export interface PluginManifest {
    id: string;
    name?: string;
    version?: string;
    entry?: string;
    status?: 'loaded' | 'error' | 'no-client' | string;
    error?: string;
    [key: string]: any;
}

/** The platform handed to every plugin's `register(platform)`. */
export interface Platform {
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
