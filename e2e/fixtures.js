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

    // Extensions (restart watcher / extensions view) — empty maps.
    'GET /extensions/connectors': {},
    'GET /extensions/plugins': {},

    // Channel lifecycle — accept and no-op (tests assert the request fired).
    'POST /channels/*/_start': '',
    'POST /channels/*/_stop': '',
    'POST /channels/*/_deploy': '',
};
