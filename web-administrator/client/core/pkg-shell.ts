/* @oie/web-shell public surface — the platform extension points + loadPlugins.
   Served barrel (import-map + Vite-alias target). The published package's type
   declarations are emitted from this graph (tsconfig.types-shell.json ->
   gen:types), so what compiles here IS the plugin-author contract. */
export { platform, loadPlugins, OIE_API_VERSION, apiCompatible } from './platform.js';
export type {
    Platform, PluginComponent, PluginManifest,
    RouterApi, StoreApi, EventsApi,
    NavItem, ViewContext, ViewResult, ViewHandler, ViewMeta, ConnectorMode,
    DashboardTab, DashboardColumn, ChannelTab, SettingsPanel, AttachmentViewer,
    StepRuleType, ConnectorPanel, ConnectorPropertiesPanel,
    DataTypeDef, TransmissionModeDef, ResourceTypeDef,
    ChannelAction, ChannelActionContext, CodeTemplateAction, CodeTemplateActionContext
} from './platform.js';
