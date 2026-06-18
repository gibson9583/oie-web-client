'use strict';
/*
 * Security/behavior regression tests for the web-admin plugin install extractor.
 * Run as a plain node script (npm test). Covers the design's verification
 * checklist: happy-path extract, zip-slip rejection (no escape write), bad id,
 * over-large entry (zip-bomb guard before inflate), engine-only zip, the
 * multipart slice, and the CSRF check.
 */
const assert = require('assert');
const { mkdtempSync, existsSync, rmSync, lstatSync } = require('fs');
const os = require('os');
const path = require('path');
const { extractWebadmin, zipFromMultipart, csrfOk } = require('./plugin-install.js');

let failures = 0;
async function test(name, fn) {
    try { await fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

(async () => {
    const zip = await import('@zip.js/zip.js');
    zip.configure({ useWebWorkers: false });
    const buildZip = async (files) => {
        const w = new zip.ZipWriter(new zip.Uint8ArrayWriter());
        for (const [name, content] of Object.entries(files)) {
            await w.add(name, new zip.Uint8ArrayReader(Buffer.isBuffer(content) ? content : Buffer.from(String(content))));
        }
        return Buffer.from(await w.close());
    };
    const dirs = [];
    const newDir = () => { const d = mkdtempSync(path.join(os.tmpdir(), 'pi-test-')); dirs.push(d); return d; };

    console.log('plugin-install.test.js');

    await test('extracts webadmin/, excludes engine jars, returns id, writes regular files', async () => {
        const z = await buildZip({
            'ext/webadmin/plugin.json': JSON.stringify({ id: 'ext', name: 'Ext' }),
            'ext/webadmin/web/plugin.js': 'register',
            'ext/libs/x.jar': 'JAR'
        });
        const d = newDir();
        assert.strictEqual(await extractWebadmin(z, d), 'ext');
        assert.ok(existsSync(path.join(d, 'ext/plugin.json')));
        assert.ok(existsSync(path.join(d, 'ext/web/plugin.js')));
        assert.ok(!existsSync(path.join(d, 'ext/libs')), 'engine jars must not be extracted');
        assert.ok(lstatSync(path.join(d, 'ext/web/plugin.js')).isFile(), 'must be a regular file (never a symlink)');
    });

    await test('rejects zip-slip and writes nothing outside pluginDir', async () => {
        const marker = path.join(os.tmpdir(), 'PI_SLIP_' + process.pid + '.txt');
        const z = await buildZip({
            'p/webadmin/plugin.json': JSON.stringify({ id: 'p' }),
            ['p/webadmin/' + '../'.repeat(10) + 'tmp/' + path.basename(marker)]: 'PWNED'
        });
        await assert.rejects(() => extractWebadmin(z, newDir()), /unsafe|escape/i);
        const leaked = existsSync(marker);
        if (leaked) rmSync(marker);
        assert.ok(!leaked, 'zip-slip file must not be created');
    });

    await test('rejects an invalid plugin id', async () => {
        const z = await buildZip({ 'q/webadmin/plugin.json': JSON.stringify({ id: '../../etc' }) });
        await assert.rejects(() => extractWebadmin(z, newDir()), /invalid plugin id/i);
    });

    await test('rejects an over-large entry before inflating it', async () => {
        const z = await buildZip({
            'r/webadmin/plugin.json': JSON.stringify({ id: 'r' }),
            'r/webadmin/big.bin': Buffer.alloc(17 * 1024 * 1024)   // > MAX_ENTRY_SIZE (16MB)
        });
        await assert.rejects(() => extractWebadmin(z, newDir()), /too large/i);
    });

    await test('engine-only zip (no webadmin) returns null', async () => {
        const z = await buildZip({ 'e/plugin.xml': '<x/>', 'e/libs/y.jar': 'J' });
        assert.strictEqual(await extractWebadmin(z, newDir()), null);
    });

    await test('zipFromMultipart slices the file part exactly', async () => {
        const z = await buildZip({ 'a/webadmin/plugin.json': JSON.stringify({ id: 'a' }) });
        const b = '----Btest';
        const mp = Buffer.concat([
            Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.zip"\r\nContent-Type: application/zip\r\n\r\n`),
            z, Buffer.from(`\r\n--${b}--\r\n`)]);
        const sliced = zipFromMultipart(mp, `multipart/form-data; boundary=${b}`);
        assert.ok(sliced && Buffer.compare(Buffer.from(sliced), z) === 0);
    });

    await test('csrfOk requires X-Requested-With', async () => {
        assert.strictEqual(csrfOk({ headers: { 'x-requested-with': 'OpenIntegrationEngine-WebAdmin' } }), true);
        assert.strictEqual(csrfOk({ headers: {} }), false);
    });

    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
    console.log('  all passed');
})().catch((e) => { console.error(e); process.exit(1); });
