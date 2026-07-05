'use strict';
/*
 * Security tests for the plugin asset server (plugins.js `/plugins/:id/*`).
 *
 * The web admin does NOT extract plugin zips (install forwards to the engine), so
 * the local attack surface is SERVING files out of a plugin directory. A malicious
 * or zip-slipped extension could plant a `..` path, an absolute path, a dotfile, or
 * a SYMLINK escaping the plugin dir. These tests boot the real Express route and
 * fire those payloads over HTTP, asserting each is blocked and no out-of-tree file
 * content leaks — locking the path-normalize + realpath-containment + dotfile guards
 * against regression.
 *
 * Run: node server/plugins.test.js  (also picked up by `npm test`).
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { install } = require('./plugins.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

// GET with a RAW request path (no client-side normalization), so the server's own
// guards are what's under test. Encoded traversal reaches the handler post-decode.
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

(async () => {
    console.log('plugins.test.js');

    // ---- temp plugin layout + an out-of-tree secret + an escaping symlink ----
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oie-plugins-'));
    const pluginsDir = path.join(tmp, 'plugins');
    const pdir = path.join(pluginsDir, 'demo');
    fs.mkdirSync(path.join(pdir, 'web'), { recursive: true });
    fs.writeFileSync(path.join(pdir, 'plugin.json'), JSON.stringify({ id: 'demo', name: 'Demo', client: { entry: 'web/plugin.js' } }));
    fs.writeFileSync(path.join(pdir, 'web', 'plugin.js'), 'export const OK = 1;');
    fs.writeFileSync(path.join(pdir, '.secret'), 'DOTFILE-SECRET');
    const secret = path.join(tmp, 'secret.txt');   // OUTSIDE any plugin dir
    fs.writeFileSync(secret, 'TOP-SECRET');
    const link = path.join(pdir, 'escape');
    let symlinkOk = true;
    try { fs.symlinkSync(secret, link); } catch { symlinkOk = false; }

    const app = express();
    install(app, { pluginDirs: [pluginsDir] });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    await test('serves a legitimate in-tree plugin asset (200)', async () => {
        const r = await get(port, '/plugins/demo/web/plugin.js');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.includes('OK = 1'), 'expected the real asset body');
    });

    await test('unknown plugin id → 404', async () => {
        assert.strictEqual((await get(port, '/plugins/nope/web/plugin.js')).status, 404);
    });

    await test('encoded ../ traversal is blocked and the secret is not served', async () => {
        const r = await get(port, '/plugins/demo/%2e%2e%2f%2e%2e%2fsecret.txt');
        assert.notStrictEqual(r.status, 200);
        assert.ok(!r.body.includes('TOP-SECRET'), 'traversal leaked an out-of-tree file');
    });

    await test('encoded absolute path is blocked (400)', async () => {
        const r = await get(port, '/plugins/demo/%2fetc%2fhostname');
        assert.strictEqual(r.status, 400);
    });

    await test('symlink escaping the plugin dir is not followed (403, no leak)', async () => {
        if (!symlinkOk) { console.log('       (symlinks unsupported on this FS — skipped)'); return; }
        const r = await get(port, '/plugins/demo/escape');
        // The realpath-containment guard rejects a symlink whose target is outside
        // the plugin dir (the zip-slip / symlink-escape defense).
        assert.strictEqual(r.status, 403);
        assert.ok(!r.body.includes('TOP-SECRET'), 'symlink escape leaked an out-of-tree file');
    });

    await test('dotfiles are not served', async () => {
        const r = await get(port, '/plugins/demo/.secret');
        assert.notStrictEqual(r.status, 200);
        assert.ok(!r.body.includes('DOTFILE-SECRET'), 'dotfile leaked');
    });

    await test('a null byte in the path is rejected', async () => {
        const r = await get(port, '/plugins/demo/web%2fplugin.js%00.txt');
        assert.notStrictEqual(r.status, 200);
    });

    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('  all passed');
})();
