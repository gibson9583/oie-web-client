'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createApiProxy, engineRequest } = require('./proxy.js');

async function listen(handler) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
function response(url, disconnect = false) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { agent: false });
        const timer = setTimeout(() => {
            reject(new Error('proxy left a broken response open'));
            req.destroy();
        }, 1500);
        req.on('error', error => { clearTimeout(timer); reject(error); });
        req.on('response', res => {
            let body = '';
            res.on('data', chunk => { body += chunk; if (disconnect) res.destroy(); });
            res.on('error', () => { /* close reports the final completeness */ });
            res.on('close', () => { clearTimeout(timer); resolve({ complete: res.complete, body }); });
        });
    });
}

(async () => {
    let disconnected;
    const engine = await listen((req, res) => {
        if (req.url === '/api/ok') { res.end('complete response'); return; }
        res.writeHead(req.url === '/api/error' ? 500 : 200, { 'Content-Length': '100' });
        res.write('partial');
        if (req.url === '/api/disconnect') res.on('close', () => disconnected());
        else setTimeout(() => res.destroy(), 20);
    });
    const target = { url: engine.url, verifyTls: false };
    const proxy = createApiProxy({ engine: target });
    const front = await listen((req, res) => { req.originalUrl = req.url; proxy(req, res); });
    try {
        for (const path of ['/api/truncated', '/api/error']) {
            const result = await response(front.url + path);
            assert.equal(result.complete, false, `${path} must fail promptly, never report a complete body`);
            assert.equal(result.body, 'partial');
        }
        await assert.rejects(engineRequest(target, { method: 'GET', path: '/api/truncated' }));
        assert.deepEqual(await response(front.url + '/api/ok'), { complete: true, body: 'complete response' });
        const closed = new Promise(resolve => { disconnected = resolve; });
        await response(front.url + '/api/disconnect', true);
        let timer;
        try {
            await Promise.race([closed, new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('upstream survived a browser disconnect')), 1500);
            })]);
        } finally { clearTimeout(timer); }
        console.log('proxy-streaming: truncated success/error, buffered errors, normal completion, and disconnect passed');
    } finally { await close(front.server); await close(engine.server); }
})().catch(error => { console.error(error); process.exitCode = 1; });
