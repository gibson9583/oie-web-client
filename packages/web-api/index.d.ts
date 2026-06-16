/*
 * Type definitions for @oie/web-api — the engine REST client + model helpers.
 *
 * Model types are GENERATED from the engine's OpenAPI spec (./oie-schema.d.ts,
 * produced by gen-schema.mjs from /api/openapi.json) and re-exported below, so
 * they track the engine's Java model automatically. The method surface (names,
 * params, Promise shapes) is hand-maintained here and points at those models.
 *
 * Caveat — the schemas describe the engine's CLEAN logical model, but the wire
 * is XStream JSON which the framework normalizes at runtime. A few fields differ
 * from the schema until normalized: polymorphic `*Connectors.connector` wrapping,
 * filter/transformer `elements` keyed by Java class, the `@class`/`@version`
 * attributes, and one-element lists arriving as bare objects (use `asList`).
 * For those, prefer the model helpers (elementsToArray/destinationsOf) and the
 * loose `OieObject` rather than trusting the field type literally.
 */
import type { components } from './oie-schema';

/** Engine model schemas, generated from the OpenAPI spec. */
type Schemas = components['schemas'];

export type Channel = Schemas['Channel'];
export type Connector = Schemas['Connector'];
export type ChannelGroup = Schemas['ChannelGroup'];
export type ChannelStatistics = Schemas['ChannelStatistics'];
export type ChannelDependency = Schemas['ChannelDependency'];
export type ChannelTag = Schemas['ChannelTag'];
export type MetaDataColumn = Schemas['MetaDataColumn'];
export type DashboardStatus = Schemas['DashboardStatus'];
export type Message = Schemas['Message'];
export type Attachment = Schemas['Attachment'];
export type User = Schemas['User'];
export type AlertModel = Schemas['AlertModel'];
export type AlertStatus = Schemas['AlertStatus'];
export type CodeTemplate = Schemas['CodeTemplate'];
export type CodeTemplateLibrary = Schemas['CodeTemplateLibrary'];
export type ServerSettings = Schemas['ServerSettings'];
export type ServerConfiguration = Schemas['ServerConfiguration'];
export type ServerEvent = Schemas['ServerEvent'];
export type DriverInfo = Schemas['DriverInfo'];

/** The full generated schema set, for any model not aliased above. */
export type { components, paths, operations } from './oie-schema';

/** A loose engine object — fallback for dynamic/map payloads and XStream-quirk fields. */
export type OieObject = Record<string, any>;

/** A response whose shape depends on the endpoint (often a count, id, or status). */
export type Json = any;

/** Query-string parameters; arrays expand to repeated keys, empty/null are dropped. */
export type QueryParams = Record<
    string,
    string | number | boolean | null | undefined | Array<string | number>
>;

export interface RequestOptions {
    /** Return the raw response text instead of parsing it. */
    raw?: boolean;
    /** Treat 401 as a credentials error (don't fire the global session-expired handler). */
    noAuthHandler?: boolean;
}

export interface WriteOptions extends RequestOptions {
    params?: QueryParams;
    /** Content-Type for the request body (default `application/json`). */
    contentType?: string;
    /** Wrap the body under a single XStream root key, e.g. `{ channel: body }`. */
    wrapKey?: string;
}

/** Thrown on a non-OK engine response. */
export class ApiError extends Error {
    constructor(status: number, message: string, body?: string);
    status: number;
    body: string;
}

/** Register a callback fired once when the engine session expires (a background 401). */
export function onSessionExpired(fn: () => void): void;
/** Re-arm the session-expired handler after a successful re-login. */
export function resetSessionExpired(): void;
/** Parse an engine response body (JSON or XML), unwrapping the XStream root key. */
export function parseBody(text: string): Json;

export function get(path: string, params?: QueryParams, opts?: RequestOptions): Promise<Json>;
export function post(path: string, body?: any, opts?: WriteOptions): Promise<Json>;
export function put(path: string, body?: any, opts?: WriteOptions): Promise<Json>;
export function del(path: string, params?: QueryParams): Promise<Json>;
export function getXml(path: string, params?: QueryParams): Promise<string>;
export function postXml(path: string, xml: string, params?: QueryParams): Promise<Json>;
export function putXml(path: string, xml: string, params?: QueryParams): Promise<Json>;

/**
 * Normalize an XStream collection to an array. One-element collections arrive as
 * a bare object, and FQCN-keyed wrappers ({ list: { "com.x.Foo": [...] } }) are
 * unwrapped when `key` matches.
 */
export function asList<T = OieObject>(value: any, key?: string): T[];

/* ---- resource groups ------------------------------------------------------- */

export interface AuthApi {
    login(username: string, password: string): Promise<Json>;
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
    setPreferences(userId: string | number, props: OieObject): Promise<Json>;
}

export interface ChannelsApi {
    list(channelIds?: string | string[], pollingOnly?: boolean): Promise<Channel[]>;
    get(channelId: string): Promise<Channel>;
    create(channel: Channel | OieObject): Promise<Json>;
    update(channelId: string, channel: Channel | OieObject, override?: boolean): Promise<Json>;
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
    clear(
        channelIdsToConnectors: Record<string, Array<number | null> | null>,
        received?: boolean,
        filtered?: boolean,
        sent?: boolean,
        errored?: boolean
    ): Promise<Json>;
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
    processNew(
        channelId: string,
        rawData: string,
        destinationMetaDataIds?: number[],
        sourceMapEntries?: string[]
    ): Promise<Json>;
    reprocess(
        channelId: string,
        messageId: string | number,
        replace?: boolean,
        filterDestinations?: boolean,
        metaDataIds?: number[]
    ): Promise<Json>;
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
    update(id: string, codeTemplate: CodeTemplate | OieObject): Promise<Json>;
    remove(id: string): Promise<Json>;
    updateLibraries(libraries: CodeTemplateLibrary[] | OieObject[]): Promise<Json>;
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

export const auth: AuthApi;
export const users: UsersApi;
export const channels: ChannelsApi;
export const channelGroups: ChannelGroupsApi;
export const status: StatusApi;
export const statistics: StatisticsApi;
export const engine: EngineApi;
export const messages: MessagesApi;
export const events: EventsApi;
export const alerts: AlertsApi;
export const server: ServerApi;
export const system: SystemApi;
export const codeTemplates: CodeTemplatesApi;
export const extensions: ExtensionsApi;
export const databaseTasks: DatabaseTasksApi;

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

/* ---- model helpers (from oie.js) ----------------------------------------- */

/** A polymorphic filter rule / transformer step, tagged with its Java `__type`. */
export interface Element {
    __type: string;
    [key: string]: any;
}

export function uuid(): string;
export function elementsToArray(elements: OieObject | null | undefined): Element[];
export function arrayToElements(items: Element[]): OieObject | null;

export const CHANNEL_STATES: string[];
export function statePip(state: string): 'ok' | 'warn' | 'err' | 'busy' | '';
export function stateLabel(state: string | null | undefined): string;

export const MESSAGE_STATUSES: string[];
export function messageStatusTag(status: string): 'accent' | 'red' | 'blue' | 'amber' | '';

export const STEP_TYPES: Record<string, { label: string }>;
export const RULE_TYPES: Record<string, { label: string }>;
export function elementTypeLabel(type: string): string;

export function emptyTransformer(version: string): OieObject;
export function emptyFilter(version: string): OieObject;
export function defaultSourceConnector(version: string): OieObject;
export function defaultDestinationConnector(version: string, metaDataId?: number, name?: string): OieObject;
export function newChannel(name: string, version: string): OieObject;
export function destinationsOf(channel: OieObject): OieObject[];
export function setDestinations(channel: OieObject, destinations: OieObject[]): void;
export function validateChannel(channel: OieObject): string[];
