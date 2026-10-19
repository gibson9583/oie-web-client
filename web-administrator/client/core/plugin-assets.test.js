import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPluginContext } from './plugin-assets.js';
import { captureEngineSession, discardEngineResponses } from './engine-fetch.js';

function withFetch(t, fetcher) {
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    t.after(() => { globalThis.fetch = original; });
}

test('engine plugin text assets use their discovery root, authenticated no-store requests, and raw text', async t => {
    const calls = [];
    withFetch(t, async (url, init) => {
        calls.push({ url, init });
        return new Response(' {"grammar":"plugin-owned"}\n');
    });
    const context = createPluginContext('/api/extensions/websupport/webplugins/extension-folder', true, captureEngineSession());
    assert.equal(calls.length, 0, 'constructing the plugin context fetches no asset');
    assert.equal(await context.getAssetText('web/language.json'), ' {"grammar":"plugin-owned"}\n');
    assert.equal(calls[0].url, '/api/extensions/websupport/webplugins/extension-folder/web/language.json');
    assert.equal(calls[0].init.headers.get('X-Requested-With'), 'OpenIntegrationEngine-WebAdmin');
    assert.ok(calls[0].init.headers.get('X-OIE-Context'));
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('bundled plugin assets preserve the app context and encode literal path segments', async t => {
    let request;
    withFetch(t, async (url, init) => { request = { url, init }; return new Response('local'); });
    const context = createPluginContext('/oie-webadmin/plugins/example', false, captureEngineSession());
    assert.equal(await context.getAssetText('web/language data-λ.json'), 'local');
    assert.equal(request.url, '/oie-webadmin/plugins/example/web/language%20data-%CE%BB.json');
    assert.equal(request.init.headers, undefined);
    assert.equal(request.init.cache, 'no-store');
});

test('invalid plugin asset paths reject before any request', async t => {
    let calls = 0;
    withFetch(t, async () => { calls++; return new Response('unexpected'); });
    const context = createPluginContext('/plugins/example', false, captureEngineSession());
    for (const path of ['', '/', '/web/a.json', '//other/a', '.', '..', '../a', 'web/../a', 'web/./a',
        'web//a', 'web/', 'web\\a', 'https://example.com/a', 'data:text/plain,a', 'web/a?q=1', 'web/a#fragment',
        '%2e%2e/a', 'web/%2f..%2fa', 'web/%252e%252e/a', 'web/a\n.json', null, 42]) {
        await assert.rejects(context.getAssetText(path), /relative path/);
    }
    assert.equal(calls, 0);
});

test('asset HTTP failures reject and a later request can retry without a cached failure', async t => {
    let calls = 0;
    withFetch(t, async () => ++calls === 1 ? new Response('missing', { status: 404 }) : new Response('recovered'));
    const context = createPluginContext('/api/webplugins/example', true, captureEngineSession());
    await assert.rejects(context.getAssetText('web/language.json'), /404/);
    assert.equal(await context.getAssetText('web/language.json'), 'recovered');
    assert.equal(calls, 2);
});

for (const engine of [false, true]) {
    test(`${engine ? 'engine' : 'bundled'} asset reads reject before requesting after session invalidation`, async t => {
        let calls = 0;
        withFetch(t, async () => { calls++; return new Response('stale'); });
        const context = createPluginContext('/plugins/example', engine, captureEngineSession());
        discardEngineResponses();
        await assert.rejects(context.getAssetText('web/language.json'), /previous session/);
        assert.equal(calls, 0);
    });

    test(`${engine ? 'engine' : 'bundled'} asset reads reject when the session changes before response headers`, async t => {
        withFetch(t, async () => { discardEngineResponses(); return new Response('stale'); });
        const context = createPluginContext('/plugins/example', engine, captureEngineSession());
        await assert.rejects(context.getAssetText('web/language.json'), /previous session/);
    });

    test(`${engine ? 'engine' : 'bundled'} asset reads reject when the session changes during the complete body read`, async t => {
        let resolveBody;
        const bodyRead = new Promise(resolve => { resolveBody = resolve; });
        let finishBody;
        withFetch(t, async () => {
            const response = new Response(new ReadableStream({
                start(controller) {
                    finishBody = () => { controller.enqueue(new TextEncoder().encode('stale')); controller.close(); };
                }
            }));
            const text = response.text.bind(response);
            response.text = () => { resolveBody(); return text(); };
            return response;
        });
        const context = createPluginContext('/plugins/example', engine, captureEngineSession());
        const result = context.getAssetText('web/language.json');
        await bodyRead;
        discardEngineResponses();
        finishBody();
        await assert.rejects(result, /previous session/);
    });
}

test('the loader identity guard also rejects a text body after the authenticated user changes', async t => {
    let valid = true;
    const assertSession = () => { if (!valid) throw new Error('Previous user'); };
    withFetch(t, async () => {
        const response = new Response('old user data');
        const text = response.text.bind(response);
        response.text = async () => { const result = await text(); valid = false; return result; };
        return response;
    });
    const context = createPluginContext('/plugins/example', false, assertSession);
    await assert.rejects(context.getAssetText('web/language.json'), /Previous user/);
});
