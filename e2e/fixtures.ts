/*
 * Canned engine responses in the XStream wire shapes the client expects
 * (api.js unwraps a single root key and `asList(v, key)` normalizes one-element
 * collections). Keys are "METHOD /path" (no /api prefix, no query string);
 * `*` matches a single path segment. Values:
 *   - string            → text/plain body (e.g. /server/version)
 *   - { __status, body }→ a specific HTTP status (e.g. 401)
 *   - object/array      → application/json body
 */

export const SAMPLE_USER = { id: 1, username: 'admin', firstName: 'Admin', lastName: 'User' };

export const SAMPLE_STATUSES = [
    { channelId: 'c-started', name: 'Demo Started', state: 'STARTED', statistics: {} },
    { channelId: 'c-stopped', name: 'Demo Stopped', state: 'STOPPED', statistics: {} },
];

// Like the real engine, every channel record carries exportData.metadata — the
// deploy walker refuses records with no readable enabled flag (fail closed).
export const SAMPLE_CHANNELS = [
    { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1, exportData: { metadata: { enabled: true } } },
    { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1, exportData: { metadata: { enabled: true } } },
];

export const SAMPLE_USERS = [
    { id: 1, username: 'admin', firstName: 'Admin', lastName: 'User', email: 'admin@example.com' },
    { id: 2, username: 'operator', firstName: 'Op', lastName: 'Erator', email: 'op@example.com' },
];

export const SAMPLE_ALERTS = [
    { id: 'al-1', name: 'Error Alert', enabled: true },
    { id: 'al-2', name: 'Deploy Alert', enabled: false },
];

export const SAMPLE_EVENTS = [
    { id: 101, eventTime: { time: 1700000000000 }, level: 'INFORMATION', name: 'Server startup', outcome: 'SUCCESS', userId: 0, ipAddress: '127.0.0.1', serverId: 'srv-1', attributes: '' },
    { id: 102, eventTime: { time: 1700000100000 }, level: 'ERROR', name: 'Channel deploy failed', outcome: 'FAILURE', userId: 1, ipAddress: '10.0.0.5', serverId: 'srv-1', attributes: '' },
];

/** Authenticated happy-path defaults. Tests override individual keys as needed. */
export const DEFAULT_FIXTURES = {
    // Auth — current returns a user, so boot skips the login screen by default.
    'GET /users/current': { user: SAMPLE_USER },
    'POST /users/_login': { status: 'SUCCESS', message: 'ok' },
    'POST /users/_logout': '',
    // Established admin has completed first-login, so the welcome wizard stays
    // hidden by default; the welcome spec overrides this to simulate a new user.
    'GET /users/*/preferences/firstlogin': 'false',

    // Server identity (status bar / shell).
    'GET /server/version': '4.5.0',
    'GET /server/id': 'e2e-server-1',
    'GET /server/timezone': 'EST (UTC -5)',
    'GET /server/settings': { serverSettings: { serverName: 'E2E Engine', environmentName: 'test' } },
    'GET /server/about': '',
    'GET /server/channelTags': '',
    'GET /server/channelDependencies': { set: '' },
    // A real empty XStream <list/> parses to ''. Keeping this explicit means
    // message views can distinguish it from an unmocked/empty HTTP response.
    'GET /channels/*/metaDataColumns': { list: '' },
    'GET /server/channelMetadata': {},

    // Dashboard + channels.
    'GET /channels/statuses': { list: { dashboardStatus: SAMPLE_STATUSES } },
    'GET /channels/statistics': { list: { channelStatistics: [] } },
    'GET /channels': { list: { channel: SAMPLE_CHANNELS } },
    // Bulk deploy/undeploy preflights each id through the addressable channel
    // endpoint. This mirrors an authorized engine response; tests for deletion
    // or revocation override the exact path with an empty/forbidden answer.
    'GET /channels/*': (request: any) => {
        const id = decodeURIComponent(new URL(request.url()).pathname.split('/').pop() || '');
        if (id === 'no-such-channel') return '';
        const known = SAMPLE_CHANNELS.find(channel => channel.id === id);
        return { channel: known || {
            '@version': '4.5.0', id, name: id, revision: 1,
            exportData: { metadata: { enabled: true } }
        } };
    },
    // The addressable status servlet authorizes the id before returning state,
    // unlike the filtered collection endpoint. Bulk-deployment result checks
    // deliberately use this route.
    'GET /channels/*/status': (request: any) => {
        const parts = new URL(request.url()).pathname.split('/');
        const id = decodeURIComponent(parts[parts.length - 2] || '');
        const known = SAMPLE_STATUSES.find(status => status.channelId === id);
        return { dashboardStatus: known || {
            channelId: id, name: id, state: 'STARTED', statistics: {}
        } };
    },
    // The real engine answers these writes with an explicit boolean; the client
    // treats anything else as an unknown outcome, so the defaults must say true.
    'POST /channelgroups/_bulkUpdate': { boolean: true },
    'POST /channels': { boolean: true },
    'PUT /channels/*': { boolean: true },

    'GET /channels/idsAndNames': { map: { entry: [
        { string: ['c-started', 'Demo Started'] },
        { string: ['c-stopped', 'Demo Stopped'] },
    ] } },
    // A genuine empty XStream <list/> parses as ''. An HTTP response with no
    // body parses as null and is an unusable whole-set baseline, not "no groups".
    'GET /channelgroups': { list: '' },

    // Users view.
    'GET /users': { list: { user: SAMPLE_USERS } },

    // Alerts view.
    'GET /alerts': { list: { alertModel: SAMPLE_ALERTS } },

    // Events view (ServerEvent is XStream-aliased to "event"; api unwraps it).
    'GET /events': { list: { serverEvent: SAMPLE_EVENTS } },
    'GET /events/count': '2',

    // Code Templates view (library with one FUNCTION template).
    'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [
        {
            '@version': '4.5.0', id: 'lib-1', name: 'Demo Library', revision: 1, description: 'Demo',
            includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '',
            codeTemplates: { codeTemplate: [
                {
                    '@version': '4.5.0', id: 'tpl-1', name: 'Trim Whitespace', revision: 1,
                    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
                    properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION', code: 'function trim(s) { return String(s).trim(); }' }
                }
            ] }
        }
    ] } },

    // Global scripts view (XStream map of script key -> body).
    'GET /server/globalScripts': { map: { entry: [
        { string: ['Deploy', 'return;'] },
        { string: ['Undeploy', 'return;'] },
        { string: ['Preprocessor', 'return message;'] },
        { string: ['Postprocessor', 'return;'] }
    ] } },

    // Extensions (restart watcher / extensions view) — empty maps.
    'GET /extensions/connectors': {},
    'GET /extensions/plugins': {},

    // Channel lifecycle — accept and no-op (tests assert the request fired).
    'POST /channels/*/_start': '',
    'POST /channels/*/_stop': '',
    'POST /channels/*/_deploy': '',
};
