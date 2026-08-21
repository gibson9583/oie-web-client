/*
 * Engine REST API client.
 *
 * Requests use the deployment's engine API root: the Node server's /api reverse
 * proxy for standalone/Docker installs, or the co-located engine API for a WAR.
 * We ask the engine for JSON (Accept: application/json); its XStream serializer
 * wraps every payload in a single root key (e.g. {"list": ...},
 * {"channel": ...}) which is unwrapped here. Some endpoints still answer in
 * XML or plain text, so parsing falls back gracefully.
 *
 * Writes must round-trip the same wrapped shape, so put()/post() accept a
 * wrapKey. When editing complex objects (channels, settings) always fetch,
 * mutate, and send the same object back — that preserves "@class"/"@version"
 * attributes and any properties contributed by server-side plugins.
 */

import * as oie from './oie.js';
import { API_BASE } from './deployment.js';
import type {
    AlertModel, AlertStatus, Attachment, Channel, ChannelDependency, ChannelGroup,
    ChannelStatistics, ChannelTag, CodeTemplate, CodeTemplateLibrary, DashboardStatus,
    DriverInfo, Message, MetaDataColumn, OieObject, ServerConfiguration, ServerEvent,
    ServerSettings, User, WireChannel
} from './wire-types.js';

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

const BASE = API_BASE;

const listeners: { sessionExpired: Array<() => void> } = { sessionExpired: [] };
let sessionExpiredFired = false;

// Deep clone JSON-serializable data (channels are plain engine JSON), so write
// transforms don't mutate the object the editor still holds.
const cloneJson = <T>(o: T): T => JSON.parse(JSON.stringify(o));

// Returns an unsubscribe. Callers that register from a React effect MUST call it
// on cleanup: without one, a remount (StrictMode's double-invoke, or any future
// remount of the registering component) leaves a second handler behind and one
// 401 then fires the whole expiry flow twice — two stacked "session expired"
// modals over the login screen.
export function onSessionExpired(fn: () => void): () => void {
    listeners.sessionExpired.push(fn);
    return () => {
        const i = listeners.sessionExpired.indexOf(fn);
        if (i >= 0) listeners.sessionExpired.splice(i, 1);
    };
}

/* Call after a successful re-login so the next 401 fires again. */
export function resetSessionExpired(): void { sessionExpiredFired = false; }

/* ---- engine reachability ----------------------------------------------------
 * Observed from the traffic the app already makes — deliberately NOT a heartbeat.
 * A poll would keep resetting the ENGINE's own session inactivity timeout, which
 * is the same reason core/idle-logout.js runs its check loop without any network
 * call. So this only ever reports on requests some view actually asked for.
 *
 * "Reachable" means the engine answered, whatever it said: a 500 is an engine
 * with an opinion, and a 401 is an expired session (onSessionExpired's job, and a
 * different message to the user). Only a rejected fetch — DNS, refused connection,
 * dropped socket — or a gateway status, where the proxy is telling us the upstream
 * never answered, counts as unreachable.
 */

const GATEWAY_STATUSES = new Set([502, 503, 504]);

const connectionListeners: Array<(reachable: boolean) => void> = [];
let engineReachable = true;

/** Subscribe to reachability changes. Returns an unsubscribe (see onSessionExpired). */
export function onConnectionChange(fn: (reachable: boolean) => void): () => void {
    connectionListeners.push(fn);
    return () => {
        const i = connectionListeners.indexOf(fn);
        if (i >= 0) connectionListeners.splice(i, 1);
    };
}

/** True while engine requests are getting answers. */
export function isEngineReachable(): boolean { return engineReachable; }

function setReachable(next: boolean): void {
    if (next === engineReachable) return;
    engineReachable = next;
    for (const fn of connectionListeners.slice()) {
        try { fn(next); } catch { /* a bad listener must not break the request */ }
    }
}

/*
 * The single send path for every verb below. Wrapping fetch (rather than handle)
 * is what makes a network failure observable at all: a rejected fetch never
 * reaches handle().
 */
function send(url: string, init: RequestInit, opts?: RequestOptions): Promise<Json> {
    // A hard ceiling so a wedged proxy/engine socket cannot hang a caller's
    // await forever (spinners that never resolve). Generous because legitimate
    // engine calls can be slow (large channel groups, message exports), and
    // overridable (RequestOptions.timeoutMs) because some operations are
    // legitimately open-ended: aborting them wouldn't stop the engine, only
    // orphan the work in flight.
    const timeoutMs = opts?.timeoutMs === undefined ? 120_000 : opts.timeoutMs;
    if (!init.signal && timeoutMs !== null) init.signal = AbortSignal.timeout(timeoutMs);
    return fetch(url, init).then(
        (response) => {
            setReachable(!GATEWAY_STATUSES.has(response.status));
            return handle(response, opts);
        },
        (err) => {
            // The ceiling above fired: the CLIENT stopped waiting. The bare
            // DOMException ("signal timed out") reads like an engine failure and
            // invites retrying an operation the engine may still be executing —
            // say what actually happened. A slow answer is also not an
            // unreachable engine, so reachability is left alone.
            if (err && err.name === 'TimeoutError') {
                throw new Error(`No response after ${Math.round((timeoutMs as number) / 1000)} seconds — the web administrator stopped waiting. The engine may still be completing the operation; check its result before retrying.`);
            }
            setReachable(false);
            throw err;
        }
    );
}

function headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = {
        // Prefer JSON, but accept anything — several endpoints (/server/version,
        // /server/id, /server/jvm, ...) produce only text/plain and answer 406
        // to a bare application/json Accept header.
        'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
        'X-Requested-With': 'OpenIntegrationEngine-WebAdmin'
    };
    if (contentType) h['Content-Type'] = contentType;
    return h;
}

/** Thrown on a non-OK engine response. */
export class ApiError extends Error {
    status: number;
    /** The raw response text, when the failing response carried one. */
    body?: string;
    constructor(status: number, message: string, body?: string) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

function unwrap(parsed: Json): Json {
    // XStream JSON puts the payload under a single root key.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        if (keys.length === 1) return parsed[keys[0]];
    }
    return parsed;
}

type XmlValue = string | number | boolean | { [tag: string]: XmlValue | XmlValue[] };

function xmlToObj(node: Element): XmlValue {
    if (!node.children || node.children.length === 0) {
        const text = node.textContent || '';
        if (text === 'true') return true;
        if (text === 'false') return false;
        if (/^-?\d+$/.test(text) && text.length < 16) return parseInt(text, 10);
        return text;
    }
    const obj: { [tag: string]: XmlValue | XmlValue[] } = {};
    for (const child of node.children) {
        const value = xmlToObj(child);
        if (Object.prototype.hasOwnProperty.call(obj, child.tagName)) {
            if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName] as XmlValue];
            (obj[child.tagName] as XmlValue[]).push(value);
        } else {
            obj[child.tagName] = value;
        }
    }
    return obj;
}

/** Parse an engine response body (JSON or XML), unwrapping the XStream root key. */
export function parseBody(text: string | null | undefined): Json {
    if (!text) return null;
    const trimmed = text.trim();
    if (trimmed[0] === '{' || trimmed[0] === '[') {
        try { return unwrap(JSON.parse(trimmed)); } catch { /* fall through */ }
    }
    if (trimmed[0] === '<') {
        try {
            const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
            if (!doc.querySelector('parsererror')) return xmlToObj(doc.documentElement);
        } catch { /* fall through */ }
    }
    return trimmed;
}

async function handle(response: Response, { raw = false, noAuthHandler = false }: RequestOptions = {}): Promise<Json> {
    if (response.status === 401) {
        // Auth endpoints (login / current) handle 401 themselves: a 401 there
        // means bad credentials or "not signed in", NOT an expired session, so
        // don't fire the global session-expired handler.
        if (noAuthHandler) {
            const text = await response.text().catch(() => '');
            // parseBody is total (its parses are internally guarded), so no try/catch.
            let message = 'Unauthorized';
            const parsed = parseBody(text);
            if (parsed && typeof parsed === 'object') message = parsed.message || parsed.error || message;
            throw new ApiError(401, message, text);
        }
        // Background polls all hit 401 at once when the engine restarts —
        // notify only once so the login screen isn't re-rendered mid-typing.
        if (!sessionExpiredFired) {
            sessionExpiredFired = true;
            listeners.sessionExpired.forEach(fn => fn());
        }
        throw new ApiError(401, 'Session expired');
    }
    const text = await response.text();
    if (!response.ok) {
        let message = text || `${response.status} ${response.statusText}`;
        // parseBody is total (its parses are internally guarded), so no try/catch.
        const parsed = parseBody(text);
        if (parsed && typeof parsed === 'object') {
            message = parsed.message || parsed.detailedError || parsed.error || message;
        }
        throw new ApiError(response.status, message, text);
    }
    if (raw) return text;
    return parseBody(text);
}

// The engine's ChannelServlet parses startEdit with "yyyy-MM-dd'T'HH:mm:ssZ" — an
// RFC-822 offset with NO milliseconds (millis make SimpleDateFormat.parse throw,
// which silently falls back to "now" and breaks the concurrent-edit check). That's
// NOT standard ISO-8601, so Date.toISOString() (millis + 'Z') can't be sent as-is.
// Reshape the built-in ISO string to the engine's form — sent as UTC (+0000), since
// only the absolute instant matters (the engine compares Calendars): drop the
// ".SSS" and turn the trailing 'Z' into '+0000'.
function fmtStartEdit(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, '+0000');
}

function qs(params: QueryParams | null | undefined): string {
    if (!params) return '';
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        for (const v of Array.isArray(value) ? value : [value]) {
            if (v === undefined || v === null) continue;
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
        }
    }
    return parts.length ? '?' + parts.join('&') : '';
}

// Encode interpolated path segments (ids are server-generated UUIDs/numbers, so
// this is a no-op in practice — defense-in-depth against a stray reserved char).
const enc = encodeURIComponent;

export function get(path: string, params?: QueryParams | null, opts?: RequestOptions): Promise<Json> {
    return send(BASE + path + qs(params), {
        method: 'GET', headers: headers(), credentials: 'same-origin'
    }, opts);
}

export function post(path: string, body?: any, { params, contentType = 'application/json', wrapKey, raw, noAuthHandler, timeoutMs }: WriteOptions = {}): Promise<Json> {
    let payload = body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof FormData)) {
        payload = JSON.stringify(wrapKey ? { [wrapKey]: body } : body);
    }
    return send(BASE + path + qs(params), {
        method: 'POST',
        headers: body instanceof FormData ? headers() : headers(contentType),
        credentials: 'same-origin',
        body: payload ?? null
    }, { raw, noAuthHandler, timeoutMs });
}

export function put(path: string, body?: any, { params, contentType = 'application/json', wrapKey, raw, timeoutMs }: WriteOptions = {}): Promise<Json> {
    let payload = body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
        payload = JSON.stringify(wrapKey ? { [wrapKey]: body } : body);
    }
    return send(BASE + path + qs(params), {
        method: 'PUT', headers: headers(contentType), credentials: 'same-origin', body: payload ?? null
    }, { raw, timeoutMs });
}

/* ---- Raw XML content negotiation -------------------------------------------
   The engine's XStream serializer answers Accept: application/xml with the
   same XML the Swing Administrator reads/writes, and its JAX-RS endpoints
   consume raw application/xml bodies. These helpers skip all client-side
   (de)serialization so import/export round-trips are byte-faithful. */

export function getXml(path: string, params?: QueryParams, opts?: RequestOptions): Promise<string> {
    return send(BASE + path + qs(params), {
        method: 'GET',
        headers: {
            'Accept': 'application/xml',
            'X-Requested-With': 'OpenIntegrationEngine-WebAdmin'
        },
        credentials: 'same-origin'
    }, { ...opts, raw: true });
}

export function postXml(path: string, xml: string, params?: QueryParams): Promise<Json> {
    return post(path, String(xml), { params, contentType: 'application/xml' });
}

export function putXml(path: string, xml: string, params?: QueryParams): Promise<Json> {
    return put(path, String(xml), { params, contentType: 'application/xml' });
}

export function del(path: string, params?: QueryParams, opts?: RequestOptions): Promise<Json> {
    return send(BASE + path + qs(params), {
        method: 'DELETE', headers: headers(), credentials: 'same-origin'
    }, opts);
}

/* When the engine returns a singleton or missing list, normalize to an array.
   XStream JSON renders one-element collections as a bare object, and classes
   without an @XStreamAlias use their fully-qualified name as the wrapper key
   (e.g. {"list":{"com.mirth...ServerLogItem":[...]}}). */
export function asList<T = OieObject>(value: any, key?: string): T[] {
    if (value === null || value === undefined || value === '') return [];
    if (key !== undefined && value && typeof value === 'object' && !Array.isArray(value)) {
        if (value[key] !== undefined) {
            value = value[key];
        } else {
            const keys = Object.keys(value).filter(k => !k.startsWith('@'));
            if (keys.length === 1) {
                const lastSegment = (keys[0].split('.').pop() ?? '').toLowerCase();
                // Unwrap when the lone key is the FQCN form of the expected
                // alias, or when it plainly holds the array we asked for.
                if (lastSegment === key.toLowerCase() || Array.isArray(value[keys[0]])) {
                    value = value[keys[0]];
                }
            }
        }
        if (value === null || value === undefined || value === '') return [];
    }
    return Array.isArray(value) ? value : [value];
}

/* ===========================================================================
   Resource-group surfaces
   ===========================================================================
   Each `const` below is annotated with its interface, so the implementation is
   checked against the declared public surface (and the generated @oie/web-api
   declarations stay truthful about what each method accepts and returns). */

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
    /* Bulk lifecycle. The engine dependency-orders the whole set server-side
       (DonkeyEngineController orders tiers, reversed for start/resume), which it
       can only do when it receives the set — a loop of single-channel calls runs
       in whatever order the caller happened to iterate. */
    startMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    stopMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    haltMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    pauseMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
    resumeMany(channelIds: string[], returnErrors?: boolean): Promise<Json>;
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
    /** Reattach a DICOM message's pixel data and return the full raw Base64 DICOM (Swing getDICOMMessage). */
    getDicom(channelId: string, messageId: string | number, connectorMessage: OieObject): Promise<string>;
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
    /** Audit that the user viewed a message on a PHI-bearing channel. */
    auditAccessedPHI(attributes: Record<string, string>): Promise<Json>;
    /** Audit that the user searched a PHI-bearing channel's message browser. */
    auditQueriedPHI(attributes: Record<string, string>): Promise<Json>;
    /** Audit the start of a message export. Callers must await this and abort on failure. */
    auditExport(attributes: Record<string, string>): Promise<Json>;
    /** Audit a message export that completed. */
    auditExportSuccess(attributes: Record<string, string>): Promise<Json>;
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

/* ===========================================================================
   Authentication & users                                          /users
   ========================================================================== */

export const auth: AuthApi = {
    // Idle-timeout logout (Swing parity): a distinct engine operation so the event
    // log records "Logged out due to inactivity" instead of a plain logout.
    inactivityLogout: () => post('/users/_inactivityLogout', '', { noAuthHandler: true }),
    // `loginData`, when present, is the second leg of an extended/MFA login: the
    // engine reads it from the X-Mirth-Login-Data header (UserServletInterface
    // .LOGIN_DATA_HEADER) and delegates to its MFA plugin instead of re-checking
    // the password. Matches Swing's client.login-with-header second leg.
    //
    // The login endpoint conveys its result in the BODY (LoginStatus /
    // ExtendedLoginStatus) and returns HTTP 401 for any not-yet-authenticated
    // result — INCLUDING an MFA challenge and plain bad credentials. So we read and
    // return the parsed body for ANY status; the caller inspects `.status` and
    // `.clientPluginClass`. (Using post()/handle() here would throw on the 401 and
    // discard the challenge — the MFA bug.) Only a network failure rejects.
    async login(username: string, password: string, loginData?: string | null): Promise<Json> {
        const form = new URLSearchParams({ username, password });
        const h = headers('application/x-www-form-urlencoded');
        if (loginData != null) h['X-Mirth-Login-Data'] = String(loginData);
        const res = await fetch(BASE + '/users/_login', {
            method: 'POST', headers: h, credentials: 'same-origin', body: form.toString(),
            signal: AbortSignal.timeout(120_000)
        });
        const text = await res.text().catch(() => '');
        const parsed = parseBody(text);
        // Return the parsed LoginStatus whatever its shape: unwrap() reduces a
        // minimal {status:'SUCCESS'} to the bare string 'SUCCESS', while a full
        // status (or an MFA ExtendedLoginStatus) stays an object. The caller reads
        // both via `result?.status || result` and `result.clientPluginClass`.
        if (parsed !== null && parsed !== undefined && parsed !== '') return parsed;
        throw new ApiError(res.status, text || `${res.status} ${res.statusText}`, text);
    },
    logout: () => post('/users/_logout', null, { noAuthHandler: true }),
    current: () => get('/users/current', undefined, { noAuthHandler: true })
};

export const users: UsersApi = {
    list: () => get('/users').then(v => asList<User>(v, 'user')),
    get: (idOrName) => get(`/users/${encodeURIComponent(idOrName)}`),
    create: (user) => post('/users', user, { wrapKey: 'user' }),
    update: (userId, user) => put(`/users/${enc(userId)}`, user, { wrapKey: 'user' }),
    remove: (userId) => del(`/users/${enc(userId)}`),
    updatePassword: (userId, plainPassword) =>
        put(`/users/${enc(userId)}/password`, plainPassword, { contentType: 'text/plain' }),
    checkPassword: (plainPassword) => post('/users/_checkPassword', plainPassword, { contentType: 'text/plain' }),
    isLoggedIn: (userId) => get(`/users/${enc(userId)}/loggedIn`),
    getPreferences: (userId) => get(`/users/${enc(userId)}/preferences`),
    // opts may pass { raw: true } to get the untouched text — needed for values
    // that are themselves XML (e.g. backgroundColor's <awt-color>), which parseBody
    // would otherwise turn into an object.
    getPreference: (userId, name, opts) => get(`/users/${enc(userId)}/preferences/${enc(name)}`, undefined, opts),
    setPreferences: (userId, props) => put(`/users/${enc(userId)}/preferences`, props, { wrapKey: 'properties' }),
    setPreference: (userId, name, value) => put(`/users/${enc(userId)}/preferences/${enc(name)}`, value, { contentType: 'text/plain' }),
    acknowledgeNotification: (userId) => post(`/users/${enc(userId)}/notificationAcknowledged`)
};

/* ===========================================================================
   Channels                                                       /channels
   ========================================================================== */

export const channels: ChannelsApi = {
    list: (channelIds, pollingOnly) =>
        get('/channels', { channelId: channelIds, pollingOnly }).then(v => asList<WireChannel>(v, 'channel')),
    // Transformer templates are base64-wrapped on the wire (engine
    // Base64StringConverter); decode on read and re-encode a clone on write so
    // the in-memory channel keeps plain-text templates. See oie.ts.
    get: (channelId) => get(`/channels/${enc(channelId)}`).then(c => oie.decodeChannelTemplates(c)),
    create: (channel) => post('/channels', oie.encodeChannelTemplates(cloneJson(channel)), { wrapKey: 'channel' }),
    // override=false enables the engine's Swing-parity conflict check: the save is
    // rejected (body "false") when the channel changed after `startEdit` (a Date —
    // when the user opened it for editing). Callers prompt, then retry override=true.
    update: (channelId, channel, override = true, startEdit) =>
        put(`/channels/${enc(channelId)}`, oie.encodeChannelTemplates(cloneJson(channel)), {
            wrapKey: 'channel',
            params: { override, startEdit: startEdit instanceof Date ? fmtStartEdit(startEdit) : startEdit }
        }),
    remove: (channelId) => del(`/channels/${enc(channelId)}`),
    idsAndNames: () => get('/channels/idsAndNames'),
    connectorNames: (channelId) => get(`/channels/${enc(channelId)}/connectorNames`),
    metaDataColumns: (channelId) => get(`/channels/${enc(channelId)}/metaDataColumns`).then(v => asList<MetaDataColumn>(v, 'metaDataColumn')),
    portsInUse: () => get('/channels/portsInUse').then(v => asList(v, 'channelPortData')),
    setEnabled: (channelId, enabled) => post(`/channels/${enc(channelId)}/enabled/${enabled}`),
    setInitialState: (channelId, state) => post(`/channels/${enc(channelId)}/initialState/${state}`)
};

export const channelGroups: ChannelGroupsApi = {
    list: () => get('/channelgroups').then(v => asList<ChannelGroup>(v, 'channelGroup')),
    bulkUpdate: (groups, removedIds = []) => {
        const form = new FormData();
        form.append('channelGroups', new Blob([JSON.stringify({ set: { channelGroup: groups } })], { type: 'application/json' }));
        form.append('removedChannelGroupIds', new Blob([JSON.stringify({ set: { string: removedIds } })], { type: 'application/json' }));
        return post('/channelgroups/_bulkUpdate', form, { params: { override: true } });
    }
};

/* ---- Status & statistics --------------------------------------------------- */

export const status: StatusApi = {
    list: (channelIds, filter, includeUndeployed) =>
        get('/channels/statuses', { channelId: channelIds, filter, includeUndeployed })
            .then(v => asList<DashboardStatus>(v, 'dashboardStatus')),
    initial: (fetchSize = 100, filter) => get('/channels/statuses/initial', { fetchSize, filter }),
    one: (channelId) => get(`/channels/${enc(channelId)}/status`),
    start: (channelId) => post(`/channels/${enc(channelId)}/_start`),
    stop: (channelId) => post(`/channels/${enc(channelId)}/_stop`),
    halt: (channelId) => post(`/channels/${enc(channelId)}/_halt`),
    pause: (channelId) => post(`/channels/${enc(channelId)}/_pause`),
    resume: (channelId) => post(`/channels/${enc(channelId)}/_resume`),
    startConnector: (channelId, metaDataId) => post(`/channels/${enc(channelId)}/connector/${metaDataId}/_start`),
    stopConnector: (channelId, metaDataId) => post(`/channels/${enc(channelId)}/connector/${metaDataId}/_stop`),

    /* The bulk lifecycle endpoints take form-urlencoded `channelId` repeated —
       NOT the JSON set that _deploy/_undeploy take (startChannels et al are
       declared application/x-www-form-urlencoded in the engine's API). */
    startMany: (channelIds, returnErrors = true) => postChannelIdForm('/channels/_start', channelIds, returnErrors),
    stopMany: (channelIds, returnErrors = true) => postChannelIdForm('/channels/_stop', channelIds, returnErrors),
    haltMany: (channelIds, returnErrors = true) => postChannelIdForm('/channels/_halt', channelIds, returnErrors),
    pauseMany: (channelIds, returnErrors = true) => postChannelIdForm('/channels/_pause', channelIds, returnErrors),
    resumeMany: (channelIds, returnErrors = true) => postChannelIdForm('/channels/_resume', channelIds, returnErrors)
};

function postChannelIdForm(path: string, channelIds: string[], returnErrors: boolean): Promise<Json> {
    const form = new URLSearchParams();
    for (const id of channelIds) form.append('channelId', id);
    // A bulk stop/start waits for every channel in the set to settle, so it can
    // legitimately outlast the normal request ceiling.
    return post(path, form.toString(), {
        contentType: 'application/x-www-form-urlencoded',
        params: { returnErrors },
        timeoutMs: null
    });
}

export const statistics: StatisticsApi = {
    list: (channelIds, includeUndeployed) =>
        get('/channels/statistics', { channelId: channelIds, includeUndeployed })
            .then(v => asList<ChannelStatistics>(v, 'channelStatistics')),
    one: (channelId) => get(`/channels/${enc(channelId)}/statistics`),
    clear: (channelIdsToConnectors, received = true, filtered = true, sent = true, errored = true) => {
        // Serialize Map<String, List<Integer>> as XStream's native XML — JSON
        // can't unambiguously express a list element of null. A plain
        // {id: null} object 500s, and a NULL list NPEs the donkey layer (it
        // iterates the list). A list of [null] targets metaDataId=null, which
        // the DAO maps to resetChannelStatistics (clears the whole channel) —
        // exactly what the Swing client sends.
        const esc = (s: string | number | null) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
        const entries = Object.entries(channelIdsToConnectors).map(([channelId, metaDataIds]) => {
            const ids = Array.isArray(metaDataIds) && metaDataIds.length ? metaDataIds : [null];
            const items = ids.map(m => (m == null ? '<null/>' : `<int>${m}</int>`)).join('');
            return `<entry><string>${esc(channelId)}</string><list>${items}</list></entry>`;
        });
        return postXml('/channels/_clearStatistics', `<map>${entries.join('')}</map>`,
            { received, filtered, sent, error: errored });
    },
    clearAll: () => post('/channels/_clearAllStatistics')
};

/* ---- Engine (deploy) --------------------------------------------------------- */

export const engine: EngineApi = {
    deploy: (channelId, returnErrors = true) => post(`/channels/${enc(channelId)}/_deploy`, null, { params: { returnErrors } }),
    // The fan-out deploys run as long as the slowest channel plus the deploy
    // scripts — minutes on a big server — so they carry no client ceiling.
    deployMany: (channelIds, returnErrors = true) =>
        post('/channels/_deploy', { set: { string: channelIds } }, { params: { returnErrors }, timeoutMs: null }),
    undeploy: (channelId, returnErrors = true) => post(`/channels/${enc(channelId)}/_undeploy`, null, { params: { returnErrors } }),
    undeployMany: (channelIds, returnErrors = true) =>
        post('/channels/_undeploy', { set: { string: channelIds } }, { params: { returnErrors } }),
    redeployAll: (returnErrors = true) => post('/channels/_redeployAll', null, { params: { returnErrors }, timeoutMs: null })
};

/* ===========================================================================
   Messages                                       /channels/{id}/messages
   ========================================================================== */

export const messages: MessagesApi = {
    search: (channelId, params) =>
        get(`/channels/${enc(channelId)}/messages`, params).then(v => asList<Message>(v, 'message')),
    // A COUNT over a large message table is legitimately slow (it's why the
    // browser defers it to an explicit button, like Swing) — no client ceiling.
    count: (channelId, params) => get(`/channels/${enc(channelId)}/messages/count`, params, { timeoutMs: null }),
    get: (channelId, messageId) => get(`/channels/${enc(channelId)}/messages/${enc(messageId)}`),
    maxMessageId: (channelId) => get(`/channels/${enc(channelId)}/messages/maxMessageId`),
    attachments: (channelId, messageId) =>
        get(`/channels/${enc(channelId)}/messages/${enc(messageId)}/attachments`).then(v => asList<Attachment>(v, 'attachment')),
    attachment: (channelId, messageId, attachmentId) =>
        get(`/channels/${enc(channelId)}/messages/${enc(messageId)}/attachments/${encodeURIComponent(attachmentId)}`),
    // Reattach a DICOM message's pixel-data attachment(s) and return the full,
    // raw Base64 DICOM (Swing getDICOMMessage). Body is the ConnectorMessage.
    getDicom: (channelId, messageId, connectorMessage) =>
        post(`/channels/${enc(channelId)}/messages/${enc(messageId)}/_getDICOMMessage`, connectorMessage, {
            wrapKey: (connectorMessage && connectorMessage['@class']) || 'com.mirth.connect.donkey.model.message.ConnectorMessage',
            raw: true
        }),
    processNew: (channelId, rawData, destinationMetaDataIds, sourceMapEntries) => {
        const params: QueryParams = {};
        if (destinationMetaDataIds && destinationMetaDataIds.length) params.destinationMetaDataId = destinationMetaDataIds;
        if (sourceMapEntries && sourceMapEntries.length) params.sourceMapEntry = sourceMapEntries;
        return post(`/channels/${enc(channelId)}/messages`, rawData, { contentType: 'text/plain', params });
    },
    reprocess: (channelId, messageId, replace = false, filterDestinations = false, metaDataIds = []) =>
        post(`/channels/${enc(channelId)}/messages/${enc(messageId)}/_reprocess`, null, {
            params: { replace, filterDestinations, metaDataId: metaDataIds }
        }),
    remove: (channelId, messageId) => del(`/channels/${enc(channelId)}/messages/${enc(messageId)}`),
    // The engine waits for stop/remove/restart to finish before responding, so a
    // large message table can legitimately outlast the normal request ceiling.
    removeAll: (channelId, restartRunningChannels = false, clearStatistics = true) =>
        del(`/channels/${enc(channelId)}/messages/_removeAll`,
            { restartRunningChannels, clearStatistics }, { timeoutMs: null }),

    /* ---- Cures Act functional audit operations -----------------------------
       Each takes a Map<String,String> of attributes and writes a ServerEvent
       ("Accessed PHI" / "Queried PHI" / "Export all messages" / "Successfully
       exported messages") to the event log. Serialized as XStream XML: a JSON
       object body deserializes to a bare LinkedHashMap the engine's map
       converter rejects, and the Swing client sends the same XML. */
    auditAccessedPHI: (attributes) => postXml('/channels/_auditAccessedPHIMessage', attributeMapXml(attributes)),
    auditQueriedPHI: (attributes) => postXml('/channels/_auditQueriedPHIMessage', attributeMapXml(attributes)),
    auditExport: (attributes) => postXml('/channels/_auditExportMessages', attributeMapXml(attributes)),
    auditExportSuccess: (attributes) => postXml('/channels/_auditExportMessagesSuccess', attributeMapXml(attributes))
};

/* XStream's native Map<String,String> form. Entries with a null/undefined value
   are dropped rather than serialized as the string "undefined". */
function attributeMapXml(attributes: Record<string, unknown>): string {
    const esc = (s: unknown) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const entries = Object.entries(attributes || {})
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `<entry><string>${esc(k)}</string><string>${esc(v)}</string></entry>`);
    return `<map>${entries.join('')}</map>`;
}

/* ===========================================================================
   Events                                                          /events
   ========================================================================== */

export const events: EventsApi = {
    search: (params) => get('/events', params).then(v => asList<ServerEvent>(v, 'serverEvent')),
    count: (params) => get('/events/count', params),
    get: (eventId) => get(`/events/${enc(eventId)}`),
    maxEventId: () => get('/events/maxEventId')
};

/* ===========================================================================
   Alerts                                                          /alerts
   ========================================================================== */

export const alerts: AlertsApi = {
    list: () => get('/alerts').then(v => asList<AlertModel>(v, 'alertModel')),
    get: (alertId) => get(`/alerts/${enc(alertId)}`),
    statuses: () => get('/alerts/statuses').then(v => asList<AlertStatus>(v, 'alertStatus')),
    create: (alert) => post('/alerts', alert, { wrapKey: 'alertModel' }),
    update: (alertId, alert) => put(`/alerts/${enc(alertId)}`, alert, { wrapKey: 'alertModel' }),
    remove: (alertId) => del(`/alerts/${enc(alertId)}`),
    enable: (alertId) => post(`/alerts/${enc(alertId)}/_enable`),
    disable: (alertId) => post(`/alerts/${enc(alertId)}/_disable`),
    info: (alertId) => post(`/alerts/${enc(alertId)}/_getInfo`, null),
    options: () => get('/alerts/options')
};

/* ===========================================================================
   Server configuration                                            /server
   ========================================================================== */

export const server: ServerApi = {
    id: () => get('/server/id', null, { raw: true }),
    version: () => get('/server/version', null, { raw: true }),
    buildDate: () => get('/server/buildDate', null, { raw: true }),
    statusCode: () => get('/server/status'),
    time: () => get('/server/time'),
    timezone: () => get('/server/timezone', null, { raw: true }),
    jvm: () => get('/server/jvm', null, { raw: true }),
    about: () => get('/server/about'),
    charsets: () => get('/server/charsets').then(v => asList<string>(v, 'string')),
    settings: () => get('/server/settings'),
    setSettings: (settings) => put('/server/settings', settings, { wrapKey: 'serverSettings' }),
    publicSettings: () => get('/server/publicSettings'),
    updateSettings: () => get('/server/updateSettings'),
    setUpdateSettings: (settings) => put('/server/updateSettings', settings, { wrapKey: 'updateSettings' }),
    configuration: (params) => get('/server/configuration', params),
    // A configuration restore with deploy=true redeploys every channel; cutting
    // it off client-side mid-restore invites a retry the engine is still
    // executing — no client ceiling.
    setConfiguration: (config, deploy = false, overwriteConfigMap = false) =>
        put('/server/configuration', config, { wrapKey: 'serverConfiguration', params: { deploy, overwriteConfigMap }, timeoutMs: null }),
    testEmail: (properties) => post('/server/_testEmail', properties, { wrapKey: 'properties' }),
    generateGUID: () => post('/server/_generateGUID', null, { raw: true }),
    globalScripts: () => get('/server/globalScripts'),
    setGlobalScripts: (scripts) => put('/server/globalScripts', scripts, { wrapKey: 'map' }),
    configurationMap: () => get('/server/configurationMap'),
    setConfigurationMap: (map) => put('/server/configurationMap', map, { wrapKey: 'map' }),
    channelTags: () => get('/server/channelTags').then(v => asList<ChannelTag>(v, 'channelTag')),
    setChannelTags: (tags) => put('/server/channelTags', { channelTag: tags }, { wrapKey: 'set' }),
    channelDependencies: () => get('/server/channelDependencies').then(v => asList<ChannelDependency>(v, 'channelDependency')),
    setChannelDependencies: (deps) => put('/server/channelDependencies', { channelDependency: deps }, { wrapKey: 'set' }),
    channelMetadata: () => get('/server/channelMetadata'),
    setChannelMetadata: (metadata) => put('/server/channelMetadata', metadata, { wrapKey: 'map' }),
    resources: () => get('/server/resources'),
    setResources: (resources) => put('/server/resources', resources, { wrapKey: 'list' }),
    reloadResource: (resourceId) => post(`/server/resources/${encodeURIComponent(resourceId)}/_reload`),
    databaseDrivers: () => get('/server/databaseDrivers').then(v => asList<DriverInfo>(v, 'driverInfo')),
    // List<DriverInfo> serializes as { list: { driverInfo: [...] } } (DriverInfo
    // is @XStreamAlias("driverInfo")). Requires the DATABASE_DRIVERS_EDIT perm.
    setDatabaseDrivers: (drivers) => put('/server/databaseDrivers', { driverInfo: drivers }, { wrapKey: 'list' }),
    passwordRequirements: () => get('/server/passwordRequirements'),
    encryption: () => get('/server/encryption'),
    licenseInfo: () => get('/server/licenseInfo'),
    protocolsAndCipherSuites: () => get('/server/protocolsAndCipherSuites'),
    rhinoLanguageVersion: () => get('/server/rhinoLanguageVersion')
};

/* ===========================================================================
   System info                                                     /system
   ========================================================================== */

export const system: SystemApi = {
    info: () => get('/system/info'),
    stats: () => get('/system/stats')
};

/* ===========================================================================
   Code templates                                /codeTemplateLibraries etc.
   ========================================================================== */

export const codeTemplates: CodeTemplatesApi = {
    libraries: (includeCodeTemplates = true) =>
        get('/codeTemplateLibraries', { includeCodeTemplates }).then(v => asList<CodeTemplateLibrary>(v, 'codeTemplateLibrary')),
    list: () => get('/codeTemplates').then(v => asList<CodeTemplate>(v, 'codeTemplate')),
    get: (id) => get(`/codeTemplates/${enc(id)}`),
    // override=false = engine revision check: rejected (body "false") when the sent
    // revision no longer matches the server's (someone else saved since it was read).
    update: (id, codeTemplate, override = true) => put(`/codeTemplates/${enc(id)}`, codeTemplate, { wrapKey: 'codeTemplate', params: { override } }),
    remove: (id) => del(`/codeTemplates/${enc(id)}`),
    updateLibraries: (libraries, override = true) =>
        put('/codeTemplateLibraries', { codeTemplateLibrary: libraries }, { wrapKey: 'list', params: { override } })
};

/* ===========================================================================
   Extensions                                                  /extensions
   ========================================================================== */

export const extensions: ExtensionsApi = {
    connectors: () => get('/extensions/connectors'),
    plugins: () => get('/extensions/plugins'),
    metadata: (name) => get(`/extensions/${encodeURIComponent(name)}`),
    isEnabled: (name) => get(`/extensions/${encodeURIComponent(name)}/enabled`),
    setEnabled: (name, enabled) => post(`/extensions/${encodeURIComponent(name)}/_setEnabled`, null, { params: { enabled } }),
    properties: (name) => get(`/extensions/${encodeURIComponent(name)}/properties`),
    setProperties: (name, properties) =>
        put(`/extensions/${encodeURIComponent(name)}/properties`, properties, { wrapKey: 'properties' })
};

/* ===========================================================================
   Database tasks                                            /databaseTasks
   ========================================================================== */

export const databaseTasks: DatabaseTasksApi = {
    list: () => get('/databaseTasks'),
    get: (taskId) => get(`/databaseTasks/${encodeURIComponent(taskId)}`),
    run: (taskId) => post(`/databaseTasks/${encodeURIComponent(taskId)}/_run`),
    cancel: (taskId) => post(`/databaseTasks/${encodeURIComponent(taskId)}/_cancel`)
};

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

const api: Api = {
    get, post, put, del, getXml, postXml, putXml, asList, parseBody, onSessionExpired,
    auth, users, channels, channelGroups, status, statistics, engine,
    messages, events, alerts, server, system, codeTemplates, extensions, databaseTasks
};

export default api;
