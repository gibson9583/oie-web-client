'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createApiProxy, requestContext, forwardCookie } = require('./proxy.js');
const { installPluginRoutes } = require('./plugin-install.js');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

(async () => {
    const received = [];
    const backend = name => http.createServer((req, res) => {
        received.push({ name, path: req.url, cookie: req.headers.cookie || '' });
        req.resume();
        if (req.url === '/api/users/_login') res.setHeader('Set-Cookie', [
            `JSESSIONID=${name}; Path=/api; HttpOnly`,
            `OIDC_FLOW=${name}-flow; Path=/api; HttpOnly`
        ]);
        res.end('');
    });
    const first = backend('first'), second = backend('second');
    const engines = [
        { key: 'k:first', name: 'First', url: await listen(first), verifyTls: false },
        { key: 'k:second', name: 'Second', url: await listen(second), verifyTls: false }
    ];
    const config = { engines, engine: engines[0], trustedProxies: [] };
    const app = express();
    installPluginRoutes(app, config);
    app.use('/api', createApiProxy(config));
    const front = http.createServer(app), url = await listen(front);
    const send = (path, cookie, method = 'GET', expected = requestContext(cookie)) => fetch(url + path, {
        method,
        headers: { cookie, 'x-requested-with': 'test', ...(expected ? { 'x-oie-context': expected } : {}), 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {})
    });
    const pairs = response => response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    try {
        const firstLogin = await send('/api/users/_login', 'oie-engine=k:first; JSESSIONID=legacy', 'POST');
        const firstCookies = pairs(firstLogin);
        assert.equal(received.at(-1).cookie, '', 'legacy cookies are never sent to an engine');
        const secondLogin = await send('/api/users/_login', `oie-engine=k:second; ${firstCookies}`, 'POST');
        const both = firstCookies + '; ' + pairs(secondLogin);
        assert.equal(received.at(-1).cookie, '', 'first engine cookies never enter second login');
        await send('/api/users/current', `oie-engine=k:first; ${both}`);
        assert.equal(received.at(-1).cookie, 'JSESSIONID=first; OIDC_FLOW=first-flow');
        await send('/api/users/current', `oie-engine=k:second; ${both}`);
        assert.equal(received.at(-1).cookie, 'JSESSIONID=second; OIDC_FLOW=second-flow');
        assert.equal(forwardCookie(both, { ...engines[0], url: 'https://replacement:8443' }), '');
        const earlierLogin = await send('/api/users/_login', 'oie-engine=k:first; oie-login=earlier', 'POST');
        assert.ok(earlierLogin.headers.getSetCookie().some(c => c.startsWith('oie-login=earlier;')),
            'login response must carry its own generation with the session cookie');

        const oldCookie = `oie-engine=k:first; oie-login=one; ${both}`;
        const newCookie = `oie-engine=k:second; oie-login=two; ${both}`;
        for (const path of ['/api/server/settings', '/api/_webadmin/plugins/_install', '/api/_webadmin/plugins/_uninstall']) {
            const before = received.length;
            const changed = await send(path, newCookie, 'POST', requestContext(oldCookie));
            assert.equal(changed.status, 409);
            assert.equal((await changed.json()).error, 'SESSION_CHANGED');
            assert.equal(received.length, before, 'mismatched requests never reach a backend');
        }
        const missing = await send('/api/server/settings', oldCookie, 'POST', '');
        assert.equal(missing.status, 409, 'authenticated mutations require context');
        const installed = await send('/api/_webadmin/plugins/_install', oldCookie, 'POST');
        assert.equal(installed.status, 200);
        assert.equal(received.at(-1).cookie, 'JSESSIONID=first; OIDC_FLOW=first-flow');
        console.log('session-routing: cookie isolation, stale requests, and plugin forwarding passed');
    } finally {
        for (const server of [front, first, second]) { server.closeAllConnections(); server.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
