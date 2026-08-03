'use strict';
/*
 * Tests for the branding-skin mount (server/skin.js): the /webadmin/skin/ static
 * route (serving, dotfile/traversal guards), the disabled states (unconfigured,
 * skin.css missing), and the shell <link> injection.
 *
 * Run: node server/skin.test.js  (also picked up by `npm test`).
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const skin = require('./skin.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

// GET with a RAW request path (no client-side normalization), so the server's own
// guards are what's under test.
function get(port, rawPath) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
            let body = '';
            res.on('data', (d) => { body += d; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        r.on('error', reject);
        r.end();
    });
}

function listen(app) {
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

async function main() {
    // A skin dir with a stylesheet, a relative asset, a dotfile, and a secret
    // OUTSIDE the dir that traversal must not reach.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skin-test-'));
    const skinDir = path.join(tmp, 'brand');
    fs.mkdirSync(skinDir);
    fs.writeFileSync(path.join(skinDir, 'skin.css'), ':root { --accent: #34d399; }');
    fs.writeFileSync(path.join(skinDir, 'brand.svg'), '<svg/>');
    fs.writeFileSync(path.join(skinDir, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(tmp, 'outside.txt'), 'OUT-OF-TREE');

    {
        const app = express();
        const dir = skin.install(app, { skin: skinDir });
        const { server, port } = await listen(app);

        await test('configured skin: install returns the dir', () => {
            assert.strictEqual(dir, skinDir);
        });
        await test('skin.css is served', async () => {
            const res = await get(port, '/webadmin/skin/skin.css');
            assert.strictEqual(res.status, 200);
            assert.ok(res.body.includes('--accent'));
        });
        await test('an asset beside skin.css is served', async () => {
            const res = await get(port, '/webadmin/skin/brand.svg');
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body, '<svg/>');
        });
        await test('dotfiles are denied', async () => {
            const res = await get(port, '/webadmin/skin/.env');
            assert.ok(res.status === 403 || res.status === 404, `status ${res.status}`);
            assert.ok(!res.body.includes('SECRET'));
        });
        await test('encoded traversal cannot escape the skin dir', async () => {
            const res = await get(port, '/webadmin/skin/..%2foutside.txt');
            assert.ok(res.status >= 400, `status ${res.status}`);
            assert.ok(!res.body.includes('OUT-OF-TREE'));
        });
        server.close();
    }

    await test('unconfigured: install is a no-op and the route is absent', async () => {
        const app = express();
        const dir = skin.install(app, { skin: null });
        assert.strictEqual(dir, null);
        const { server, port } = await listen(app);
        const res = await get(port, '/webadmin/skin/skin.css');
        assert.strictEqual(res.status, 404);
        server.close();
    });

    await test('a skin dir without skin.css disables the skin', async () => {
        const empty = path.join(tmp, 'empty');
        fs.mkdirSync(empty);
        const app = express();
        assert.strictEqual(skin.install(app, { skin: empty }), null);
    });

    await test('injectLink adds the stylesheet after existing head links', () => {
        const html = '<html><head><link rel="stylesheet" href="/assets/app.css">\n</head><body></body></html>';
        const out = skin.injectLink(html);
        const app = out.indexOf('/assets/app.css');
        const sk = out.indexOf('/webadmin/skin/skin.css');
        assert.ok(sk > app, 'skin link must come after the app stylesheet');
        assert.ok(out.indexOf('</head>') > sk, 'skin link must sit inside <head>');
    });

    await test('injectLink leaves head-less html unchanged', () => {
        const html = '<html><body></body></html>';
        assert.strictEqual(skin.injectLink(html), html);
    });

    fs.rmSync(tmp, { recursive: true, force: true });
    if (failures) { console.error(`${failures} failing`); process.exit(1); }
    console.log('  all passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
