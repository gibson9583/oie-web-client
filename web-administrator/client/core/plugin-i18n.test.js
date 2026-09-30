import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeI18n, scope } from './i18n.js';
import { loadPluginCatalog } from './plugin-i18n.js';
import { discardEngineResponses } from './engine-fetch.js';

await initializeI18n({ languages: ['zh-CN'], loadCatalog: async () => ({ Hello: '主界面' }) });
const manifest = { id: 'example', source: 'engine', base: '/engine/api/extensions/websupport/webplugins/example', i18n: { 'zh-CN': 'i18n/zh-CN.json' } };
const translated = () => scope('example').t('Hello');

test('plugin catalog requests preserve WAR paths, CSRF/session headers and no-store', async () => {
    const old = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        assert.equal(url, manifest.base + '/i18n/zh-CN.json');
        assert.equal(options.credentials, 'same-origin');
        assert.equal(options.cache, 'no-store');
        assert.equal(options.headers.get('X-Requested-With'), 'OpenIntegrationEngine-WebAdmin');
        assert.ok(options.headers.get('X-OIE-Context'));
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ Hello: '插件' });
    };
    try { await loadPluginCatalog(manifest); assert.equal(translated(), '插件'); }
    finally { globalThis.fetch = old; }
});

test('catalog failures remove old engine overrides and preserve host fallback', async () => {
    const old = globalThis.fetch;
    try {
        for (const response of [() => new Response('', { status: 404 }), () => new Response('broken'), () => Response.json({ Hello: 4 }), () => { throw new Error('timed out'); }]) {
            globalThis.fetch = async () => Response.json({ Hello: '旧引擎' });
            await loadPluginCatalog(manifest);
            globalThis.fetch = async () => response();
            await loadPluginCatalog(manifest);
            assert.equal(translated(), '主界面');
        }
        globalThis.fetch = async () => { throw new Error('must not fetch invalid path'); };
        for (const path of ['../secret.json', '/secret.json', 'https://host/catalog.json', 'i18n/%2e%2e/secret.json', 'i18n//zh.json', 'i18n/zh.json?x']) {
            await loadPluginCatalog({ ...manifest, i18n: { 'zh-CN': path } });
            assert.equal(translated(), '主界面');
        }
    } finally { globalThis.fetch = old; }
});

test('a stale body or out-of-order request cannot replace a newer catalog', async () => {
    const old = globalThis.fetch;
    try {
        let finish;
        globalThis.fetch = async () => {
            const response = Response.json({});
            response.json = () => new Promise(resolve => { finish = resolve; });
            return response;
        };
        const pending = loadPluginCatalog(manifest);
        while (!finish) await new Promise(resolve => setImmediate(resolve));
        globalThis.fetch = async () => Response.json({ Hello: '新引擎' });
        await loadPluginCatalog(manifest);
        finish({ Hello: '过期' }); await pending;
        assert.equal(translated(), '新引擎');

        finish = undefined;
        globalThis.fetch = async () => {
            const response = Response.json({});
            response.json = () => new Promise(resolve => { finish = resolve; });
            return response;
        };
        const revoked = loadPluginCatalog(manifest);
        while (!finish) await new Promise(resolve => setImmediate(resolve));
        discardEngineResponses(); finish({ Hello: '已注销' }); await revoked;
        assert.equal(translated(), '主界面');
    } finally { globalThis.fetch = old; }
});
