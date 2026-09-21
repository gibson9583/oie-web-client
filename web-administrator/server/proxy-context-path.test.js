'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createApiProxy, engineRequest, engineRequestPath, rewriteSetCookies, requestContext } = require('./proxy.js');
const { installPluginRoutes } = require('./plugin-install.js');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}
(async () => {
    const received = [];
    const engine = http.createServer((req, res) => {
        received.push({ path: req.url, cookie: req.headers.cookie || '' });
        req.resume();
        if (req.url.endsWith('/api/users/_login')) res.setHeader('Set-Cookie', 'JSESSIONID=session; Path=/engine-context/api; HttpOnly');
        res.end('ok');
    });
    const engineUrl = await listen(engine);
    const target = { url: engineUrl + '/engine-context/', verifyTls: false };
    const config = { engine: target };
    const app = express();
    installPluginRoutes(app, config);
    app.use('/api', createApiProxy(config));
    const front = http.createServer(app), url = await listen(front);
    try {
        for (const base of [engineUrl + '/engine-context', engineUrl + '/engine-context/']) {
            assert.equal(engineRequestPath(new URL(base), '/api/test?q=a%2Fb&x=2'), '/engine-context/api/test?q=a%2Fb&x=2');
        }
        assert.equal(engineRequestPath(new URL(engineUrl), '/api/test'), '/api/test');
        const login = await fetch(url + '/api/users/_login', { method: 'POST' });
        assert.equal(received.at(-1).path, '/engine-context/api/users/_login');
        const cookie = login.headers.getSetCookie()[0];
        assert.match(cookie, /; Path=\/api;/);
        const browserCookie = cookie.split(';')[0];
        await fetch(url + '/api/channels?q=a%2Fb&x=2', { headers: { cookie: browserCookie } });
        assert.deepEqual(received.at(-1), { path: '/engine-context/api/channels?q=a%2Fb&x=2', cookie: 'JSESSIONID=session' });
        await engineRequest(target, { method: 'GET', path: '/api/server/version' });
        assert.equal(received.at(-1).path, '/engine-context/api/server/version');
        const install = await fetch(url + '/api/_webadmin/plugins/_install', { method: 'POST', body: 'synthetic',
            headers: { 'content-type': 'application/zip', 'x-requested-with': 'test',
                'x-oie-context': requestContext(browserCookie), cookie: browserCookie } });
        assert.equal(install.status, 200);
        assert.equal(received.at(-1).path, '/engine-context/api/extensions/_install');
        await fetch(url + '/api/users/_logout', { method: 'POST', headers: { cookie: browserCookie,
            'x-oie-context': requestContext(browserCookie) } });
        assert.equal(received.at(-1).path, '/engine-context/api/users/_logout');
        assert.match(rewriteSetCookies(['JSESSIONID=x; Path=/engine-context; Domain=engine; Secure'], false, target)[0], /; Path=\/; SameSite=Lax$/);
        assert.match(rewriteSetCookies(['JSESSIONID=x; Path=/engine-context-other/api'], false, target)[0], /Path=\/engine-context-other\/api/);
        console.log('proxy-context-path: root/context paths, query encoding, cookies, login/logout, and plugin forwarding passed');
    } finally {
        for (const server of [front, engine]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
