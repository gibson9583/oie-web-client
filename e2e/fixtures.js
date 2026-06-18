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

export const SAMPLE_CHANNELS = [
    { '@version': '4.5.0', id: 'c-started', name: 'Demo Started', revision: 1 },
    { '@version': '4.5.0', id: 'c-stopped', name: 'Demo Stopped', revision: 1 },
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

    // Server identity (status bar / shell).
    'GET /server/version': '4.5.0',
    'GET /server/timezone': 'EST (UTC -5)',
    'GET /server/settings': { serverSettings: { serverName: 'E2E Engine', environmentName: 'test' } },
    'GET /server/about': '',
    'GET /server/channelTags': '',
    'GET /server/channelDependencies': '',
    'GET /server/channelMetadata': {},

    // Dashboard + channels.
    'GET /channels/statuses': { list: { dashboardStatus: SAMPLE_STATUSES } },
    'GET /channels/statistics': { list: { channelStatistics: [] } },
    'GET /channels': { list: { channel: SAMPLE_CHANNELS } },
    'GET /channels/idsAndNames': {},
    'GET /channelgroups': '',

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
