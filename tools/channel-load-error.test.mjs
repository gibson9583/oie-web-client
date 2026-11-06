import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import api, { ApiError, onSessionExpired, parseBody, resetSessionExpired } from '../web-administrator/client/core/api.js';

const { code } = await transform(await readFile(new URL('../web-administrator/client/react/load-error.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(() => ({ parseBody }), module, module.exports);
const { loadErrorMessage } = module.exports;

// Fields observed from the installed engine's Jetty/Jersey channel writers.
// The servlet suffix and URL vary; neither carries the conversion cause.
const jettyBody = JSON.stringify({ servlet: 'org.glassfish.jersey.servlet.ServletContainer-1dfd5f51',
    message: 'Request failed.', url: '/api/channels/invalid', status: '500' });

for (const [label, path, resource, call] of [
    ['collection', '/api/channels', 'channels', () => api.channels.list()],
    ['individual', '/api/channels/invalid', 'channel', () => api.channels.get('invalid')]
]) {
    for (const response of [
        { name: 'captured generic 500', status: 500, body: jettyBody, expected: /engine server log/ },
        { name: 'empty 500', status: 500, body: '', expected: /engine server log/ },
        { name: 'useful detail', status: 500, body: JSON.stringify({ message: 'Request failed.', detailedError: 'Channel conversion rejected: <channel>' }), expected: /Channel conversion rejected: <channel>/ },
        { name: 'permission denial', status: 403, body: '{}', expected: /Access denied.*view channels/ },
        { name: 'network failure', network: true, expected: /fetch failed/ }
    ]) test(`real ${label} API ${response.name} keeps the error contract and formats its diagnostic`, async () => {
        const originalFetch = globalThis.fetch;
        const requests = [];
        try {
            globalThis.fetch = async (url, options) => {
                requests.push({ path: String(url), accept: new Headers(options.headers).get('Accept') });
                if (response.network) throw new TypeError('fetch failed');
                return new Response(response.body, { status: response.status, statusText: 'Server Error' });
            };
            await assert.rejects(call(), error => {
                if (!response.network) {
                    assert.ok(error instanceof ApiError);
                    assert.equal(error.status, response.status);
                    assert.equal(error.body, response.body);
                }
                const before = { message: error.message, status: error.status, body: error.body };
                const message = loadErrorMessage(error, resource, 'channels');
                assert.match(message, response.expected);
                assert.doesNotMatch(message, /serializ|ServletContainer|Request failed/i);
                if (response.network) assert.doesNotMatch(message, /HTTP|engine server log/);
                else assert.match(message, new RegExp(`HTTP ${response.status}`));
                if (response.status === 403) assert.doesNotMatch(message, /engine server log/);
                assert.deepEqual({ message: error.message, status: error.status, body: error.body }, before);
                return true;
            });
            assert.equal(requests.length, 1, 'failure never triggers a fallback or a second read');
            assert.equal(requests[0].path, path);
            assert.match(requests[0].accept, /^application\/json/);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
}

test('channel 401 still invokes the existing session-expiry handler once', async () => {
    const originalFetch = globalThis.fetch;
    let expired = 0;
    const off = onSessionExpired(() => { expired++; });
    resetSessionExpired();
    try {
        globalThis.fetch = async () => new Response('', { status: 401 });
        for (const call of [() => api.channels.list(), () => api.channels.get('invalid')]) {
            await assert.rejects(call(), error => {
                assert.equal(loadErrorMessage(error, 'channels'), 'HTTP 401. Session expired');
                return true;
            });
        }
        assert.equal(expired, 1);
    } finally {
        off();
        resetSessionExpired();
        globalThis.fetch = originalFetch;
    }
});
