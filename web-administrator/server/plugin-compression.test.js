'use strict';
// Exercise the real route stack with benign compressed data. No exploit payloads.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const express = require('express');
const { installPluginRoutes } = require('./plugin-install.js');
const { engineCookiePrefix, requestContext } = require('./proxy.js');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
function send(server, route, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port,
            path: `/api/_webadmin/plugins/${route}`, method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': body.length, ...headers }
        }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.end(body);
    });
}

test('local plugin routes reject compressed bodies without invoking native decoders', async () => {
    const forwarded = [];
    let upstreamStatus = 200;
    const backend = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            forwarded.push({ path: req.url, body: Buffer.concat(chunks).toString(), encoding: req.headers['content-encoding'] });
            res.writeHead(upstreamStatus, { 'content-type': 'application/json' });
            res.end('{}');
        });
    });
    await listen(backend);
    const engine = { url: `http://127.0.0.1:${backend.address().port}`, verifyTls: false, key: 'k:test' };
    const app = express();
    installPluginRoutes(app, { engine, engines: [engine, { ...engine, key: 'k:other' }] });
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ type: error.type }));
    const front = http.createServer(app);
    const cookie = `${engineCookiePrefix(engine)}JSESSIONID=fabricated`;
    const headers = { cookie, 'x-requested-with': 'test', 'x-oie-context': requestContext(cookie) };
    const body = Buffer.from('{"path":"test-extension"}');
    const encodings = { br: zlib.brotliCompressSync(body), gzip: zlib.gzipSync(body), deflate: zlib.deflateSync(body) };
    const descriptors = new Map();
    let decodes = 0;
    for (const name of ['createBrotliDecompress', 'createGunzip', 'createInflate']) {
        const descriptor = Object.getOwnPropertyDescriptor(zlib, name);
        descriptors.set(name, descriptor);
        Object.defineProperty(zlib, name, { ...descriptor, value: (...args) => { decodes++; return descriptor.value(...args); } });
    }
    try {
        await listen(front);
        // Repeat and overlap rejected requests: no state or prior failure should
        // let a subsequent compressed request reach a decoder or the engine.
        for (let attempt = 0; attempt < 2; attempt++) {
            await Promise.all(['_install', '_uninstall'].flatMap(route => Object.entries(encodings).map(async ([encoding, compressed]) => {
                const response = await send(front, route, compressed, { ...headers, 'content-encoding': encoding });
                assert.equal(response.status, 415, `${route} ${encoding}`);
                assert.equal(JSON.parse(response.body).type, 'encoding.unsupported');
            })));
        }
        assert.equal((await send(front, '_uninstall', encodings.br, { 'content-encoding': 'br' })).status, 415,
            'uninstall must reject compression even without session/CSRF headers');
        assert.equal((await send(front, '_install', encodings.br, { 'content-encoding': 'br' })).status, 403);
        assert.equal((await send(front, '_install', encodings.br, { 'content-encoding': 'br', 'x-requested-with': 'test' })).status, 401);
        assert.equal((await send(front, '_uninstall', encodings.br, { ...headers, 'x-oie-context': 'stale', 'content-encoding': 'br' })).status, 409);
        assert.equal((await send(front, '_uninstall', encodings.br, { cookie: 'oie-engine=k:removed', 'content-encoding': 'br' })).status, 421);
        assert.equal(decodes, 0);
        assert.equal(forwarded.length, 0);
        // Ordinary clients still forward the original uncompressed body, and
        // engine authorization/error responses still propagate.
        for (const route of ['_install', '_uninstall']) {
            for (const encoding of [undefined, 'identity']) {
                const response = await send(front, route, body, { ...headers, ...(encoding ? { 'content-encoding': encoding } : {}) });
                assert.equal(response.status, 200);
                assert.equal(forwarded.at(-1).body, route === '_install' ? body.toString() : 'test-extension');
                assert.equal(forwarded.at(-1).encoding, undefined);
            }
            upstreamStatus = 403;
            assert.equal((await send(front, route, body, headers)).status, 403);
            upstreamStatus = 200;
        }
        assert.equal((await send(front, '_uninstall', body)).status, 403);
        assert.equal(decodes, 0);
    } finally {
        for (const [name, descriptor] of descriptors) Object.defineProperty(zlib, name, descriptor);
        await close(front);
        await close(backend);
    }
});
