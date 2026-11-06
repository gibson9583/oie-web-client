import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transform } from 'esbuild';
import api, { ApiError, parseBody } from '../web-administrator/client/core/api.js';

// Exercise the shipped view's formatter with the real API parser. Rendering and
// lifecycle imports are unused here; the browser tests cover the load callback.
const { code } = await transform(await readFile(new URL('../web-administrator/client/react/views/code-templates.tsx', import.meta.url), 'utf8'),
    { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
const { code: helperCode } = await transform(await readFile(new URL('../web-administrator/client/react/load-error.ts', import.meta.url), 'utf8'),
    { loader: 'ts', format: 'cjs' });
const helper = { exports: {} };
new Function('require', 'module', 'exports', helperCode)(() => ({ parseBody }), helper, helper.exports);
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => name === '../load-error.js' ? helper.exports : {}, module, module.exports);
const { codeTemplateLoadError } = module.exports;

test('empty and generic 5xx errors include status and server-log guidance without inventing a cause', () => {
    for (const error of [new ApiError(500, 'Request failed'), new ApiError(503, '', ''),
        new ApiError(500, '{}', '{}')]) {
        const message = codeTemplateLoadError(error);
        assert.match(message, new RegExp(`HTTP ${error.status}`));
        assert.match(message, /Check the engine server log/);
        assert.doesNotMatch(message, /Request failed|\{\}|serializ/i);
    }
});

test('the shipped Jetty serialization-failure response points to its missing server-side detail', () => {
    const body = JSON.stringify({ servlet: 'org.glassfish.jersey.servlet.ServletContainer-425357dd',
        message: 'Request failed.', url: '/api/codeTemplateLibraries/invalid', status: '500' });
    const message = codeTemplateLoadError(new ApiError(500, 'Request failed.', body));
    assert.match(message, /HTTP 500/);
    assert.match(message, /Check the engine server log/);
    assert.doesNotMatch(message, /Request failed|servlet|ServletContainer|serializ/i);
});

test('real API errors for empty HTTP response bodies still provide server-log guidance', async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const [status, statusText] of [[500, 'Server Error'], [500, 'Internal Server Error'], [503, 'Service Unavailable']]) {
            globalThis.fetch = async () => new Response('', { status, statusText });
            await assert.rejects(api.codeTemplates.libraries(true), error => {
                assert.ok(error instanceof ApiError);
                assert.equal(error.message, `${status} ${statusText}`, 'exercise the actual API fallback contract');
                const message = codeTemplateLoadError(error);
                assert.match(message, new RegExp(`HTTP ${status}`));
                assert.match(message, /Check the engine server log/);
                assert.doesNotMatch(message, /serializ/i);
                return true;
            });
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('the Node proxy connection failure keeps its web-administrator-log instructions', () => {
    const detail = 'Could not reach the Open Integration Engine. Check the web administrator logs for details.';
    const message = codeTemplateLoadError(new ApiError(502, detail, JSON.stringify({ error: 'ENGINE_UNREACHABLE', message: detail })));
    assert.match(message, /HTTP 502/);
    assert.ok(message.includes(detail));
    assert.doesNotMatch(message, /engine server log|serializ/i);
});

test('the raw response retains useful detail hidden behind a generic API message', () => {
    const detail = 'ObjectJSONSerializer: Illegal character entity: expansion character (code 0xfffe)';
    const body = JSON.stringify({ message: 'Request failed', detailedError: detail });
    const error = new ApiError(500, 'Request failed', body);
    const message = codeTemplateLoadError(error);
    assert.match(message, /HTTP 500/);
    assert.ok(message.includes(detail));
    assert.doesNotMatch(message, /Request failed/);
    assert.equal(error.body, body, 'formatting preserves the original response evidence');
});

test('meaningful server messages and detail are retained once, including literal markup in text', () => {
    const body = JSON.stringify({ message: 'The library could not be returned', detailedError: 'Invalid value: <template>', error: 'The library could not be returned' });
    const message = codeTemplateLoadError(new ApiError(500, 'The library could not be returned', body));
    assert.equal(message.split('The library could not be returned').length - 1, 1);
    assert.ok(message.includes('Invalid value: <template>'));
    assert.ok(codeTemplateLoadError(new ApiError(500, 'plain server error', 'plain server error')).includes('plain server error'));
});

test('generic HTML error documents cannot swamp the detail dialog with markup', () => {
    const body = '<!DOCTYPE html><html><head><style>body { color: red }</style></head><body><h1>HTTP ERROR 500</h1><script>alert(1)</script></body></html>';
    const message = codeTemplateLoadError(new ApiError(500, body, body));
    assert.match(message, /HTTP 500/);
    assert.match(message, /engine server log/);
    assert.doesNotMatch(message, /DOCTYPE|<html|<script|color: red/);
});

test('authentication and permission errors stay distinct from server failures', () => {
    const expired = codeTemplateLoadError(new ApiError(401, 'Session expired'));
    assert.match(expired, /HTTP 401.*Session expired/);
    const denied = codeTemplateLoadError(new ApiError(403, 'Unauthorized operation: getCodeTemplateLibraries',
        JSON.stringify({ message: 'Unauthorized operation: getCodeTemplateLibraries' })));
    assert.match(denied, /HTTP 403.*Unauthorized operation/);
    const emptyDenied = codeTemplateLoadError(new ApiError(403, '', ''));
    assert.match(emptyDenied, /HTTP 403.*Access denied/);
    for (const message of [expired, denied, emptyDenied]) assert.doesNotMatch(message, /server log|serializ/i);
});

test('network and timeout messages retain the original cause without claiming an HTTP response', () => {
    for (const error of [new TypeError('Failed to fetch'), new Error('The web administrator stopped waiting')]) {
        const message = codeTemplateLoadError(error);
        assert.ok(message.includes(error.message));
        assert.doesNotMatch(message, /HTTP|server log|serializ/i);
    }
});

test('a Jetty reason phrase alone is not detail, so the status fallback explains it', () => {
    const jetty = (status, message) => new ApiError(status, message, JSON.stringify({ servlet: 'org.glassfish.jersey.servlet.ServletContainer-425357dd',
        message, url: '/api/codeTemplateLibraries', status: String(status) }));
    assert.equal(codeTemplateLoadError(jetty(403, 'Forbidden')), 'Load failed: HTTP 403. Access denied. Check your permissions to view code templates.');
    assert.equal(codeTemplateLoadError(jetty(404, 'Not Found')), 'Load failed: HTTP 404. The code template libraries could not be loaded.');
    assert.match(codeTemplateLoadError(jetty(503, 'Service Unavailable')), /^Load failed: HTTP 503\. The code template libraries could not be loaded\.\n\nCheck the engine server log/);
    // A phrase only counts as the reason for its own status, and longer text is real detail.
    assert.match(codeTemplateLoadError(jetty(500, 'Forbidden')), /HTTP 500\. Forbidden/);
    assert.match(codeTemplateLoadError(jetty(403, 'Forbidden: role lacks viewCodeTemplates')), /HTTP 403\. Forbidden: role lacks viewCodeTemplates/);
});
