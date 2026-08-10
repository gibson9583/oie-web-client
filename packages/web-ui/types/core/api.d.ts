import type { AlertModel, AlertStatus, Attachment, Channel, ChannelDependency, ChannelGroup, ChannelStatistics, ChannelTag, CodeTemplate, CodeTemplateLibrary, DashboardStatus, DriverInfo, Message, MetaDataColumn, OieObject, ServerConfiguration, ServerEvent, ServerSettings, User, WireChannel } from './wire-types.js';
/** A response whose shape depends on the endpoint (often a count, id, or status). */
export type Json = any;
/** Query-string parameters; arrays expand to repeated keys, empty/null are dropped. */
export type QueryParams = Record<string, string | number | boolean | null | undefined | Array<string | number>>;
export interface RequestOptions {
    /** Return the raw response text instead of parsing it. */
    raw?: boolean;
    /** Treat 401 as a credentials error (don't fire the global session-expired handler). */
    noAuthHandler?: boolean;
    /** Client-side wait ceiling in ms (default 120 000). Pass `null` for engine
        operations that legitimately run longer (redeploy-all, restore, server
        export, filter-wide remove/reprocess, COUNT): aborting the request does
        not stop the engine — it only abandons the work mid-flight. */
    timeoutMs?: number | null;
}
export interface WriteOptions extends RequestOptions {
    params?: QueryParams;
    /** Content-Type for the request body (default `application/json`). */
    contentType?: string;
    /** Wrap the body under a single XStream root key, e.g. `{ channel: body }`. */
    wrapKey?: string;
}
export declare function onSessionExpired(fn: () => void): () => void;
export declare function resetSessionExpired(): void;
/** Subscribe to reachability changes. Returns an unsubscribe (see onSessionExpired). */
export declare function onConnectionChange(fn: (reachable: boolean) => void): () => void;
/** True while engine requests are getting answers. */
export declare function isEngineReachable(): boolean;
/** Thrown on a non-OK engine response. */
export declare class ApiError extends Error {
    status: number;
    /** The raw response text, when the failing response carried one. */
    body?: string;
    constructor(status: number, message: string, body?: string);
}
/** Parse an engine response body (JSON or XML), unwrapping the XStream root key. */
export declare function parseBody(text: string | null | undefined): Json;
export declare function get(path: string, params?: QueryParams | null, opts?: RequestOptions): Promise<Json>;
export declare function post(path: string, body?: any, { params, contentType, wrapKey, raw, noAuthHandler, timeoutMs }?: WriteOptions): Promise<Json>;
export declare function put(path: string, body?: any, { params, contentType, wrapKey, raw, timeoutMs }?: WriteOptions): Promise<Json>;
export declare function getXml(path: string, params?: QueryParams, opts?: RequestOptions): Promise<string>;
export declare function postXml(path: string, xml: string, params?: QueryParams): Promise<Json>;
export declare function putXml(path: string, xml: string, params?: QueryParams): Promise<Json>;
export declare function del(path: string, params?: QueryParams, opts?: RequestOptions): Promise<Json>;
export declare function asList<T = OieObject>(value: any, key?: string): T[];
export interface AuthApi {
    /** Idle-timeout logout — the engine event log records "Logged out due to inactivity". */
    inactivityLogout(): Promise<Json>;
    /** Returns the parsed LoginStatus / ExtendedLoginStatus body whatever the HTTP status (see implementation). */
    login(username: string, password: string, loginData?: string | null): Promise<Json>;
    logout(): Promise<Json>;
    current(): Promise<OieObject>;
}
export interface UsersApi {
    list(): Promise<User[]>;
    get(idOrName: string | number): Promise<User>;
    create(user: User | OieObject): Promise<Json>;
    update(userId: string | number, user: User | OieObject): Promise<Json>;
    remove(userId: string | number): Promise<Json>;
    updatePassword(userId: string | number, plainPassword: string): Promise<Json>;
    checkPassword(plainPassword: string): Promise<Json>;
    isLoggedIn(userId: string | number): Promise<Json>;
    getPreferences(userId: string | number): Promise<OieObject>;
    /** `opts` may pass `{ raw: true }` for values that are themselves XML (e.g. backgroundColor). */
    getPreference(userId: string | number, name: string, opts?: RequestOptions): Promise<Json>;
    setPreferences(userId: string | number, props: OieObject): Promise<Json>;
    setPreference(userId: string | number, name: string, value: string): Promise<Json>;
    acknowledgeNotification(userId: string | number): Promise<Json>;
}
export interface ChannelsApi {
    list(channelIds?: string | string[], pollingOnly?: boolean): Promise<WireChannel[]>;
    /** Returns the RAW engine shape (see `WireChannel`) — read destinations via `destinationsOf`. */
    get(channelId: string): Promise<WireChannel>;
    create(channel: WireChannel | Channel | OieObject): Promise<Json>;
    /**
     * `override=false` enables the engine's Swing-parity conflict check: the save
     * is rejected (body "false") when the channel changed after `startEdit` (when
     * the user opened it for editing). Callers prompt, then retry override=true.
     */
    update(channelId: string, channel: WireChannel | Channel | OieObject, override?: boolean, startEdit?: Date | string): Promise<Json>;
    remove(channelId: string): Promise<Json>;
    /** Map of channel id → name. */
    idsAndNames(): Promise<OieObject>;
    connectorNames(channelId: string): Promise<OieObject>;
    metaDataColumns(channelId: string): Promise<MetaDataColumn[]>;
    portsInUse(): Promise<OieObject[]>;
    setEnabled(channelId: string, enabled: boolean): Promise<Json>;
    setInitialState(channelId: string, state: string): Promise<Json>;
}
export interface ChannelGroupsApi {
    list(): Promise<ChannelGroup[]>;
    bulkUpdate(groups: ChannelGroup[] | OieObject[], removedIds?: string[]): Promise<Json>;
}
export interface StatusApi {
    list(channelIds?: string | string[], filter?: any, includeUndeployed?: boolean): Promise<DashboardStatus[]>;
    initial(fetchSize?: number, filter?: any): Promise<OieObject>;
    one(channelId: string): Promise<DashboardStatus>;
    start(channelId: string): Promise<Json>;
    stop(channelId: string): Promise<Json>;
    halt(channelId: string): Promise<Json>;
    pause(channelId: string): Promise<Json>;
    resume(channelId: string): Promise<Json>;
    startConnector(channelId: string, metaDataId: number): Promise<Json>;
    stopConnector(channelId: string, metaDataId: number): Promise<Json>;
}
export interface StatisticsApi {
    list(channelIds?: string | string[], includeUndeployed?: boolean): Promise<ChannelStatistics[]>;
    one(channelId: string): Promise<ChannelStatistics>;
    /** Map of channelId → metaDataIds to clear (empty/null array clears the whole channel). */
    clear(channelIdsToConnectors: Record<string, Array<number | null> | null>, received?: boolean, filtered?: boolean, sent?: boolean, errored?: boolean): Promise<Json>;
    clearAll(): Promise<Json>;
}
export interface EngineApi {
    deploy(channelId: string, returnErrors?: boolean): Promise<Json>;
    deployMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    undeploy(channelId: string, returnErrors?: boolean): Promise<Json>;
    undeployMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    redeployAll(returnErrors?: boolean): Promise<Json>;
}
export interface MessagesApi {
    search(channelId: string, params?: QueryParams): Promise<Message[]>;
    count(channelId: string, params?: QueryParams): Promise<Json>;
    get(channelId: string, messageId: string | number): Promise<Message>;
    maxMessageId(channelId: string): Promise<Json>;
    attachments(channelId: string, messageId: string | number): Promise<Attachment[]>;
    attachment(channelId: string, messageId: string | number, attachmentId: string): Promise<Attachment>;
    /** Reattach a DICOM message's pixel data and return the full raw Base64 DICOM (Swing getDICOMMessage). */
    getDicom(channelId: string, messageId: string | number, connectorMessage: OieObject): Promise<string>;
    processNew(channelId: string, rawData: string, destinationMetaDataIds?: number[], sourceMapEntries?: string[]): Promise<Json>;
    reprocess(channelId: string, messageId: string | number, replace?: boolean, filterDestinations?: boolean, metaDataIds?: number[]): Promise<Json>;
    remove(channelId: string, messageId: string | number): Promise<Json>;
    removeAll(channelId: string, restartRunningChannels?: boolean, clearStatistics?: boolean): Promise<Json>;
}
export interface EventsApi {
    search(params?: QueryParams): Promise<ServerEvent[]>;
    count(params?: QueryParams): Promise<Json>;
    get(eventId: string | number): Promise<ServerEvent>;
    maxEventId(): Promise<Json>;
}
export interface AlertsApi {
    list(): Promise<AlertModel[]>;
    get(alertId: string): Promise<AlertModel>;
    statuses(): Promise<AlertStatus[]>;
    create(alert: AlertModel | OieObject): Promise<Json>;
    update(alertId: string, alert: AlertModel | OieObject): Promise<Json>;
    remove(alertId: string): Promise<Json>;
    enable(alertId: string): Promise<Json>;
    disable(alertId: string): Promise<Json>;
    info(alertId: string): Promise<Json>;
    options(): Promise<OieObject>;
}
export interface ServerApi {
    id(): Promise<string>;
    version(): Promise<string>;
    buildDate(): Promise<string>;
    statusCode(): Promise<Json>;
    time(): Promise<OieObject>;
    timezone(): Promise<string>;
    jvm(): Promise<string>;
    about(): Promise<OieObject>;
    charsets(): Promise<string[]>;
    settings(): Promise<ServerSettings>;
    setSettings(settings: ServerSettings | OieObject): Promise<Json>;
    publicSettings(): Promise<OieObject>;
    updateSettings(): Promise<OieObject>;
    setUpdateSettings(settings: OieObject): Promise<Json>;
    configuration(params?: QueryParams): Promise<ServerConfiguration>;
    setConfiguration(config: ServerConfiguration | OieObject, deploy?: boolean, overwriteConfigMap?: boolean): Promise<Json>;
    testEmail(properties: OieObject): Promise<Json>;
    generateGUID(): Promise<string>;
    globalScripts(): Promise<OieObject>;
    setGlobalScripts(scripts: OieObject): Promise<Json>;
    configurationMap(): Promise<OieObject>;
    setConfigurationMap(map: OieObject): Promise<Json>;
    channelTags(): Promise<ChannelTag[]>;
    setChannelTags(tags: ChannelTag[] | OieObject[]): Promise<Json>;
    channelDependencies(): Promise<ChannelDependency[]>;
    setChannelDependencies(deps: ChannelDependency[] | OieObject[]): Promise<Json>;
    channelMetadata(): Promise<OieObject>;
    setChannelMetadata(metadata: OieObject): Promise<Json>;
    resources(): Promise<OieObject>;
    setResources(resources: OieObject): Promise<Json>;
    reloadResource(resourceId: string): Promise<Json>;
    databaseDrivers(): Promise<DriverInfo[]>;
    setDatabaseDrivers(drivers: DriverInfo[] | OieObject[]): Promise<Json>;
    passwordRequirements(): Promise<OieObject>;
    encryption(): Promise<OieObject>;
    licenseInfo(): Promise<OieObject>;
    protocolsAndCipherSuites(): Promise<OieObject>;
    rhinoLanguageVersion(): Promise<Json>;
}
export interface SystemApi {
    info(): Promise<OieObject>;
    stats(): Promise<OieObject>;
}
export interface CodeTemplatesApi {
    libraries(includeCodeTemplates?: boolean): Promise<CodeTemplateLibrary[]>;
    list(): Promise<CodeTemplate[]>;
    get(id: string): Promise<CodeTemplate>;
    /** `override=false` = engine revision check: rejected (body "false") when someone else saved since it was read. */
    update(id: string, codeTemplate: CodeTemplate | OieObject, override?: boolean): Promise<Json>;
    remove(id: string): Promise<Json>;
    updateLibraries(libraries: CodeTemplateLibrary[] | OieObject[], override?: boolean): Promise<Json>;
}
export interface ExtensionsApi {
    connectors(): Promise<OieObject>;
    plugins(): Promise<OieObject>;
    metadata(name: string): Promise<OieObject>;
    isEnabled(name: string): Promise<Json>;
    setEnabled(name: string, enabled: boolean): Promise<Json>;
    properties(name: string): Promise<OieObject>;
    setProperties(name: string, properties: OieObject): Promise<Json>;
}
export interface DatabaseTasksApi {
    list(): Promise<OieObject>;
    get(taskId: string): Promise<OieObject>;
    run(taskId: string): Promise<Json>;
    cancel(taskId: string): Promise<Json>;
}
export declare const auth: AuthApi;
export declare const users: UsersApi;
export declare const channels: ChannelsApi;
export declare const channelGroups: ChannelGroupsApi;
export declare const status: StatusApi;
export declare const statistics: StatisticsApi;
export declare const engine: EngineApi;
export declare const messages: MessagesApi;
export declare const events: EventsApi;
export declare const alerts: AlertsApi;
export declare const server: ServerApi;
export declare const system: SystemApi;
export declare const codeTemplates: CodeTemplatesApi;
export declare const extensions: ExtensionsApi;
export declare const databaseTasks: DatabaseTasksApi;
/** The full REST client (default export) — raw verbs plus every resource group. */
export interface Api {
    get: typeof get;
    post: typeof post;
    put: typeof put;
    del: typeof del;
    getXml: typeof getXml;
    postXml: typeof postXml;
    putXml: typeof putXml;
    asList: typeof asList;
    parseBody: typeof parseBody;
    onSessionExpired: typeof onSessionExpired;
    auth: AuthApi;
    users: UsersApi;
    channels: ChannelsApi;
    channelGroups: ChannelGroupsApi;
    status: StatusApi;
    statistics: StatisticsApi;
    engine: EngineApi;
    messages: MessagesApi;
    events: EventsApi;
    alerts: AlertsApi;
    server: ServerApi;
    system: SystemApi;
    codeTemplates: CodeTemplatesApi;
    extensions: ExtensionsApi;
    databaseTasks: DatabaseTasksApi;
}
declare const api: Api;
export default api;
