/*
 * Engine REST API client.
 *
 * All requests go through the Node server's /api reverse proxy. We ask the
 * engine for JSON (Accept: application/json); its XStream-based serializer
 * wraps every payload in a single root key (e.g. {"list": ...},
 * {"channel": ...}) which is unwrapped here. Some endpoints still answer in
 * XML or plain text, so parsing falls back gracefully.
 *
 * Writes must round-trip the same wrapped shape, so put()/post() accept a
 * wrapKey. When editing complex objects (channels, settings) always fetch,
 * mutate, and send the same object back — that preserves "@class"/"@version"
 * attributes and any properties contributed by server-side plugins.
 */

const BASE = '/api';

const listeners = { sessionExpired: [] };
let sessionExpiredFired = false;

export function onSessionExpired(fn) { listeners.sessionExpired.push(fn); }

/* Call after a successful re-login so the next 401 fires again. */
export function resetSessionExpired() { sessionExpiredFired = false; }

function headers(contentType) {
    const h = {
        // Prefer JSON, but accept anything — several endpoints (/server/version,
        // /server/id, /server/jvm, ...) produce only text/plain and answer 406
        // to a bare application/json Accept header.
        'Accept': 'application/json, text/plain;q=0.9, */*;q=0.8',
        'X-Requested-With': 'OpenIntegrationEngine-WebAdmin'
    };
    if (contentType) h['Content-Type'] = contentType;
    return h;
}

export class ApiError extends Error {
    constructor(status, message, body) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

function unwrap(parsed) {
    // XStream JSON puts the payload under a single root key.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const keys = Object.keys(parsed);
        if (keys.length === 1) return parsed[keys[0]];
    }
    return parsed;
}

function xmlToObj(node) {
    if (!node.children || node.children.length === 0) {
        const text = node.textContent || '';
        if (text === 'true') return true;
        if (text === 'false') return false;
        if (/^-?\d+$/.test(text) && text.length < 16) return parseInt(text, 10);
        return text;
    }
    const obj = {};
    for (const child of node.children) {
        const value = xmlToObj(child);
        if (Object.prototype.hasOwnProperty.call(obj, child.tagName)) {
            if (!Array.isArray(obj[child.tagName])) obj[child.tagName] = [obj[child.tagName]];
            obj[child.tagName].push(value);
        } else {
            obj[child.tagName] = value;
        }
    }
    return obj;
}

export function parseBody(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (trimmed[0] === '{' || trimmed[0] === '[') {
        try { return unwrap(JSON.parse(trimmed)); } catch (e) { /* fall through */ }
    }
    if (trimmed[0] === '<') {
        try {
            const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
            if (!doc.querySelector('parsererror')) return xmlToObj(doc.documentElement);
        } catch (e) { /* fall through */ }
    }
    return trimmed;
}

async function handle(response, { raw = false, noAuthHandler = false } = {}) {
    if (response.status === 401) {
        // Auth endpoints (login / current) handle 401 themselves: a 401 there
        // means bad credentials or "not signed in", NOT an expired session, so
        // don't fire the global session-expired handler.
        if (noAuthHandler) {
            const text = await response.text().catch(() => '');
            let message = 'Unauthorized';
            try {
                const parsed = parseBody(text);
                if (parsed && typeof parsed === 'object') message = parsed.message || parsed.error || message;
            } catch (e) { /* keep default */ }
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
        try {
            const parsed = parseBody(text);
            if (parsed && typeof parsed === 'object') {
                message = parsed.message || parsed.detailedError || parsed.error || message;
            }
        } catch (e) { /* keep raw text */ }
        throw new ApiError(response.status, message, text);
    }
    if (raw) return text;
    return parseBody(text);
}

function qs(params) {
    if (!params) return '';
    const parts = [];
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        for (const v of Array.isArray(value) ? value : [value]) {
            if (v === undefined || v === null) continue;
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
        }
    }
    return parts.length ? '?' + parts.join('&') : '';
}

export function get(path, params, opts) {
    return fetch(BASE + path + qs(params), {
        method: 'GET', headers: headers(), credentials: 'same-origin'
    }).then(r => handle(r, opts));
}

export function post(path, body, { params, contentType = 'application/json', wrapKey, raw, noAuthHandler } = {}) {
    let payload = body;
    if (body !== undefined && body !== null && typeof body !== 'string' && !(body instanceof FormData)) {
        payload = JSON.stringify(wrapKey ? { [wrapKey]: body } : body);
    }
    return fetch(BASE + path + qs(params), {
        method: 'POST',
        headers: body instanceof FormData ? headers() : headers(contentType),
        credentials: 'same-origin',
        body: payload ?? null
    }).then(r => handle(r, { raw, noAuthHandler }));
}

export function put(path, body, { params, contentType = 'application/json', wrapKey, raw } = {}) {
    let payload = body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
        payload = JSON.stringify(wrapKey ? { [wrapKey]: body } : body);
    }
    return fetch(BASE + path + qs(params), {
        method: 'PUT', headers: headers(contentType), credentials: 'same-origin', body: payload ?? null
    }).then(r => handle(r, { raw }));
}

/* ---- Raw XML content negotiation -------------------------------------------
   The engine's XStream serializer answers Accept: application/xml with the
   same XML the Swing Administrator reads/writes, and its JAX-RS endpoints
   consume raw application/xml bodies. These helpers skip all client-side
   (de)serialization so import/export round-trips are byte-faithful. */

export function getXml(path, params) {
    return fetch(BASE + path + qs(params), {
        method: 'GET',
        headers: {
            'Accept': 'application/xml',
            'X-Requested-With': 'OpenIntegrationEngine-WebAdmin'
        },
        credentials: 'same-origin'
    }).then(r => handle(r, { raw: true }));
}

export function postXml(path, xml, params) {
    return post(path, String(xml), { params, contentType: 'application/xml' });
}

export function putXml(path, xml, params) {
    return put(path, String(xml), { params, contentType: 'application/xml' });
}

export function del(path, params) {
    return fetch(BASE + path + qs(params), {
        method: 'DELETE', headers: headers(), credentials: 'same-origin'
    }).then(handle);
}

/* When the engine returns a singleton or missing list, normalize to an array.
   XStream JSON renders one-element collections as a bare object, and classes
   without an @XStreamAlias use their fully-qualified name as the wrapper key
   (e.g. {"list":{"com.mirth...ServerLogItem":[...]}}). */
export function asList(value, key) {
    if (value === null || value === undefined || value === '') return [];
    if (key !== undefined && value && typeof value === 'object' && !Array.isArray(value)) {
        if (value[key] !== undefined) {
            value = value[key];
        } else {
            const keys = Object.keys(value).filter(k => !k.startsWith('@'));
            if (keys.length === 1) {
                const lastSegment = keys[0].split('.').pop().toLowerCase();
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
   Authentication & users                                          /users
   ========================================================================== */

export const auth = {
    login(username, password) {
        const form = new URLSearchParams({ username, password });
        return post('/users/_login', form.toString(), { contentType: 'application/x-www-form-urlencoded', noAuthHandler: true });
    },
    logout: () => post('/users/_logout', null, { noAuthHandler: true }),
    current: () => get('/users/current', undefined, { noAuthHandler: true })
};

export const users = {
    list: () => get('/users').then(v => asList(v, 'user')),
    get: (idOrName) => get(`/users/${encodeURIComponent(idOrName)}`),
    create: (user) => post('/users', user, { wrapKey: 'user' }),
    update: (userId, user) => put(`/users/${userId}`, user, { wrapKey: 'user' }),
    remove: (userId) => del(`/users/${userId}`),
    updatePassword: (userId, plainPassword) =>
        put(`/users/${userId}/password`, plainPassword, { contentType: 'text/plain' }),
    checkPassword: (plainPassword) => post('/users/_checkPassword', plainPassword, { contentType: 'text/plain' }),
    isLoggedIn: (userId) => get(`/users/${userId}/loggedIn`),
    getPreferences: (userId) => get(`/users/${userId}/preferences`),
    setPreferences: (userId, props) => put(`/users/${userId}/preferences`, props, { wrapKey: 'properties' })
};

/* ===========================================================================
   Channels                                                       /channels
   ========================================================================== */

export const channels = {
    list: (channelIds, pollingOnly) =>
        get('/channels', { channelId: channelIds, pollingOnly }).then(v => asList(v, 'channel')),
    get: (channelId) => get(`/channels/${channelId}`),
    create: (channel) => post('/channels', channel, { wrapKey: 'channel' }),
    update: (channelId, channel, override = true) =>
        put(`/channels/${channelId}`, channel, { wrapKey: 'channel', params: { override } }),
    remove: (channelId) => del(`/channels/${channelId}`),
    idsAndNames: () => get('/channels/idsAndNames'),
    connectorNames: (channelId) => get(`/channels/${channelId}/connectorNames`),
    metaDataColumns: (channelId) => get(`/channels/${channelId}/metaDataColumns`).then(v => asList(v, 'metaDataColumn')),
    portsInUse: () => get('/channels/portsInUse').then(v => asList(v, 'channelPortData')),
    setEnabled: (channelId, enabled) => post(`/channels/${channelId}/enabled/${enabled}`),
    setInitialState: (channelId, state) => post(`/channels/${channelId}/initialState/${state}`)
};

export const channelGroups = {
    list: () => get('/channelgroups').then(v => asList(v, 'channelGroup')),
    bulkUpdate: (groups, removedIds = []) => {
        const form = new FormData();
        form.append('channelGroups', new Blob([JSON.stringify({ set: { channelGroup: groups } })], { type: 'application/json' }));
        form.append('removedChannelGroupIds', new Blob([JSON.stringify({ set: { string: removedIds } })], { type: 'application/json' }));
        return post('/channelgroups/_bulkUpdate', form, { params: { override: true } });
    }
};

/* ---- Status & statistics --------------------------------------------------- */

export const status = {
    list: (channelIds, filter, includeUndeployed) =>
        get('/channels/statuses', { channelId: channelIds, filter, includeUndeployed })
            .then(v => asList(v, 'dashboardStatus')),
    initial: (fetchSize = 100, filter) => get('/channels/statuses/initial', { fetchSize, filter }),
    one: (channelId) => get(`/channels/${channelId}/status`),
    start: (channelId) => post(`/channels/${channelId}/_start`),
    stop: (channelId) => post(`/channels/${channelId}/_stop`),
    halt: (channelId) => post(`/channels/${channelId}/_halt`),
    pause: (channelId) => post(`/channels/${channelId}/_pause`),
    resume: (channelId) => post(`/channels/${channelId}/_resume`),
    startConnector: (channelId, metaDataId) => post(`/channels/${channelId}/connector/${metaDataId}/_start`),
    stopConnector: (channelId, metaDataId) => post(`/channels/${channelId}/connector/${metaDataId}/_stop`)
};

export const statistics = {
    list: (channelIds, includeUndeployed) =>
        get('/channels/statistics', { channelId: channelIds, includeUndeployed })
            .then(v => asList(v, 'channelStatistics')),
    one: (channelId) => get(`/channels/${channelId}/statistics`),
    clear: (channelIdsToConnectors, received = true, filtered = true, sent = true, errored = true) => {
        // Serialize Map<String, List<Integer>> as XStream's native XML — JSON
        // can't unambiguously express a list element of null. A plain
        // {id: null} object 500s, and a NULL list NPEs the donkey layer (it
        // iterates the list). A list of [null] targets metaDataId=null, which
        // the DAO maps to resetChannelStatistics (clears the whole channel) —
        // exactly what the Swing client sends.
        const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
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

export const engine = {
    deploy: (channelId, returnErrors = true) => post(`/channels/${channelId}/_deploy`, null, { params: { returnErrors } }),
    deployMany: (channelIds, returnErrors = true) =>
        post('/channels/_deploy', { set: { string: channelIds } }, { params: { returnErrors } }),
    undeploy: (channelId, returnErrors = true) => post(`/channels/${channelId}/_undeploy`, null, { params: { returnErrors } }),
    undeployMany: (channelIds, returnErrors = true) =>
        post('/channels/_undeploy', { set: { string: channelIds } }, { params: { returnErrors } }),
    redeployAll: (returnErrors = true) => post('/channels/_redeployAll', null, { params: { returnErrors } })
};

/* ===========================================================================
   Messages                                       /channels/{id}/messages
   ========================================================================== */

export const messages = {
    search: (channelId, params) =>
        get(`/channels/${channelId}/messages`, params).then(v => asList(v, 'message')),
    count: (channelId, params) => get(`/channels/${channelId}/messages/count`, params),
    get: (channelId, messageId) => get(`/channels/${channelId}/messages/${messageId}`),
    maxMessageId: (channelId) => get(`/channels/${channelId}/messages/maxMessageId`),
    attachments: (channelId, messageId) =>
        get(`/channels/${channelId}/messages/${messageId}/attachments`).then(v => asList(v, 'attachment')),
    attachment: (channelId, messageId, attachmentId) =>
        get(`/channels/${channelId}/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`),
    processNew: (channelId, rawData, destinationMetaDataIds, sourceMapEntries) => {
        const params = {};
        if (destinationMetaDataIds && destinationMetaDataIds.length) params.destinationMetaDataId = destinationMetaDataIds;
        if (sourceMapEntries && sourceMapEntries.length) params.sourceMapEntry = sourceMapEntries;
        return post(`/channels/${channelId}/messages`, rawData, { contentType: 'text/plain', params });
    },
    reprocess: (channelId, messageId, replace = false, filterDestinations = false, metaDataIds = []) =>
        post(`/channels/${channelId}/messages/${messageId}/_reprocess`, null, {
            params: { replace, filterDestinations, metaDataId: metaDataIds }
        }),
    remove: (channelId, messageId) => del(`/channels/${channelId}/messages/${messageId}`),
    removeAll: (channelId, restartRunningChannels = false, clearStatistics = true) =>
        del(`/channels/${channelId}/messages/_removeAll`, { restartRunningChannels, clearStatistics })
};

/* ===========================================================================
   Events                                                          /events
   ========================================================================== */

export const events = {
    search: (params) => get('/events', params).then(v => asList(v, 'serverEvent')),
    count: (params) => get('/events/count', params),
    get: (eventId) => get(`/events/${eventId}`),
    maxEventId: () => get('/events/maxEventId')
};

/* ===========================================================================
   Alerts                                                          /alerts
   ========================================================================== */

export const alerts = {
    list: () => get('/alerts').then(v => asList(v, 'alertModel')),
    get: (alertId) => get(`/alerts/${alertId}`),
    statuses: () => get('/alerts/statuses').then(v => asList(v, 'alertStatus')),
    create: (alert) => post('/alerts', alert, { wrapKey: 'alertModel' }),
    update: (alertId, alert) => put(`/alerts/${alertId}`, alert, { wrapKey: 'alertModel' }),
    remove: (alertId) => del(`/alerts/${alertId}`),
    enable: (alertId) => post(`/alerts/${alertId}/_enable`),
    disable: (alertId) => post(`/alerts/${alertId}/_disable`),
    info: (alertId) => post(`/alerts/${alertId}/_getInfo`, null),
    options: () => get('/alerts/options')
};

/* ===========================================================================
   Server configuration                                            /server
   ========================================================================== */

export const server = {
    id: () => get('/server/id', null, { raw: true }),
    version: () => get('/server/version', null, { raw: true }),
    buildDate: () => get('/server/buildDate', null, { raw: true }),
    statusCode: () => get('/server/status'),
    time: () => get('/server/time'),
    timezone: () => get('/server/timezone', null, { raw: true }),
    jvm: () => get('/server/jvm', null, { raw: true }),
    about: () => get('/server/about'),
    charsets: () => get('/server/charsets').then(v => asList(v, 'string')),
    settings: () => get('/server/settings'),
    setSettings: (settings) => put('/server/settings', settings, { wrapKey: 'serverSettings' }),
    updateSettings: () => get('/server/updateSettings'),
    setUpdateSettings: (settings) => put('/server/updateSettings', settings, { wrapKey: 'updateSettings' }),
    configuration: (params) => get('/server/configuration', params),
    setConfiguration: (config, deploy = false, overwriteConfigMap = false) =>
        put('/server/configuration', config, { wrapKey: 'serverConfiguration', params: { deploy, overwriteConfigMap } }),
    testEmail: (properties) => post('/server/_testEmail', properties, { wrapKey: 'properties' }),
    generateGUID: () => post('/server/_generateGUID', null, { raw: true }),
    globalScripts: () => get('/server/globalScripts'),
    setGlobalScripts: (scripts) => put('/server/globalScripts', scripts, { wrapKey: 'map' }),
    configurationMap: () => get('/server/configurationMap'),
    setConfigurationMap: (map) => put('/server/configurationMap', map, { wrapKey: 'map' }),
    channelTags: () => get('/server/channelTags').then(v => asList(v, 'channelTag')),
    setChannelTags: (tags) => put('/server/channelTags', { channelTag: tags }, { wrapKey: 'set' }),
    channelDependencies: () => get('/server/channelDependencies').then(v => asList(v, 'channelDependency')),
    setChannelDependencies: (deps) => put('/server/channelDependencies', { channelDependency: deps }, { wrapKey: 'set' }),
    channelMetadata: () => get('/server/channelMetadata'),
    setChannelMetadata: (metadata) => put('/server/channelMetadata', metadata, { wrapKey: 'map' }),
    resources: () => get('/server/resources'),
    setResources: (resources) => put('/server/resources', resources, { wrapKey: 'list' }),
    reloadResource: (resourceId) => post(`/server/resources/${encodeURIComponent(resourceId)}/_reload`),
    databaseDrivers: () => get('/server/databaseDrivers').then(v => asList(v, 'driverInfo')),
    passwordRequirements: () => get('/server/passwordRequirements'),
    encryption: () => get('/server/encryption'),
    licenseInfo: () => get('/server/licenseInfo'),
    protocolsAndCipherSuites: () => get('/server/protocolsAndCipherSuites'),
    rhinoLanguageVersion: () => get('/server/rhinoLanguageVersion')
};

/* ===========================================================================
   System info                                                     /system
   ========================================================================== */

export const system = {
    info: () => get('/system/info'),
    stats: () => get('/system/stats')
};

/* ===========================================================================
   Code templates                                /codeTemplateLibraries etc.
   ========================================================================== */

export const codeTemplates = {
    libraries: (includeCodeTemplates = true) =>
        get('/codeTemplateLibraries', { includeCodeTemplates }).then(v => asList(v, 'codeTemplateLibrary')),
    list: () => get('/codeTemplates').then(v => asList(v, 'codeTemplate')),
    get: (id) => get(`/codeTemplates/${id}`),
    update: (id, codeTemplate) => put(`/codeTemplates/${id}`, codeTemplate, { wrapKey: 'codeTemplate', params: { override: true } }),
    remove: (id) => del(`/codeTemplates/${id}`),
    updateLibraries: (libraries) =>
        put('/codeTemplateLibraries', { codeTemplateLibrary: libraries }, { wrapKey: 'list', params: { override: true } })
};

/* ===========================================================================
   Extensions                                                  /extensions
   ========================================================================== */

export const extensions = {
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

export const databaseTasks = {
    list: () => get('/databaseTasks'),
    get: (taskId) => get(`/databaseTasks/${encodeURIComponent(taskId)}`),
    run: (taskId) => post(`/databaseTasks/${encodeURIComponent(taskId)}/_run`),
    cancel: (taskId) => post(`/databaseTasks/${encodeURIComponent(taskId)}/_cancel`)
};

export default {
    get, post, put, del, getXml, postXml, putXml, asList, parseBody, onSessionExpired,
    auth, users, channels, channelGroups, status, statistics, engine,
    messages, events, alerts, server, system, codeTemplates, extensions, databaseTasks
};
