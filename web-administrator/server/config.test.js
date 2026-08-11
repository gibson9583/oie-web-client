'use strict';
/*
 * Tests for the config-document sources in config.js load():
 * WEBADMIN_CONFIG_JSON (inline JSON) and WEBADMIN_CONFIG (explicit file path),
 * their precedence (inline > file > default ./config.json), the per-setting
 * env overrides staying on top, and the fail-hard behavior for an explicit
 * source that is missing or unparseable (a typo'd mount must not silently
 * boot a default-configured server).
 *
 * Run: node server/config.test.js  (also picked up by `npm test`).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { load } = require('./config');

const CONFIG_ENV = [
    'WEBADMIN_CONFIG', 'WEBADMIN_CONFIG_JSON', 'WEBADMIN_PORT', 'WEBADMIN_HOST',
    'OIE_URL', 'OIE_VERIFY_TLS', 'WEBADMIN_TLS_KEY', 'WEBADMIN_TLS_CERT'
];
function withEnv(env, fn) {
    const saved = {};
    for (const k of CONFIG_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);
    try { return fn(); }
    finally {
        for (const k of CONFIG_ENV) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
    }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webadmin-config-'));

// --- WEBADMIN_CONFIG_JSON: the whole document inline, unknown keys survive ----
{
    const config = withEnv({
        WEBADMIN_CONFIG_JSON: JSON.stringify({
            port: 4545,
            allowedUrls: [{ name: 'prod', url: 'https://oie-prod:8443', verifyTls: true }],
            myPluginSetting: { enabled: true }
        })
    }, load);
    assert.strictEqual(config.port, 4545);
    assert.strictEqual(config.engines.length, 1);
    assert.strictEqual(config.engines[0].name, 'prod');
    assert.strictEqual(config.engines[0].verifyTls, true);
    assert.deepStrictEqual(config.myPluginSetting, { enabled: true });
    console.log('ok: WEBADMIN_CONFIG_JSON drives the full document');
}

// --- WEBADMIN_CONFIG: document loaded from an arbitrary file path -------------
{
    const file = path.join(tmp, 'my-config.json');
    fs.writeFileSync(file, JSON.stringify({
        port: 4546,
        engine: { url: 'https://oie-file:8443', verifyTls: true },
        tls: { key: '/certs/tls.key', cert: '/certs/tls.crt' }
    }));
    const config = withEnv({ WEBADMIN_CONFIG: file }, load);
    assert.strictEqual(config.port, 4546);
    assert.strictEqual(config.engine.url, 'https://oie-file:8443');
    // Absolute tls paths pass through untouched (the documented shape for mounts).
    assert.deepStrictEqual(config.tls, { key: '/certs/tls.key', cert: '/certs/tls.crt', passphrase: undefined });
    console.log('ok: WEBADMIN_CONFIG loads the document from a mounted path');
}

// --- Precedence: inline beats file; per-setting env vars beat the document ----
{
    const file = path.join(tmp, 'loser.json');
    fs.writeFileSync(file, JSON.stringify({ port: 1111 }));
    const config = withEnv({
        WEBADMIN_CONFIG: file,
        WEBADMIN_CONFIG_JSON: JSON.stringify({ port: 2222, engine: { url: 'https://doc:8443' } }),
        WEBADMIN_PORT: '3333'
    }, load);
    assert.strictEqual(config.port, 3333);
    assert.strictEqual(config.engine.url, 'https://doc:8443');
    console.log('ok: precedence is env var > inline JSON > file');
}

// --- Fail hard: explicit-but-broken sources exit 1 instead of booting on defaults
{
    for (const env of [
        { WEBADMIN_CONFIG: path.join(tmp, 'does-not-exist.json') },
        { WEBADMIN_CONFIG_JSON: '{not json' }
    ]) {
        let code = 0;
        try {
            execFileSync(process.execPath, ['-e', "require('./config').load()"], {
                cwd: __dirname, env: { ...process.env, ...env }, stdio: 'pipe'
            });
        } catch (e) { code = e.status; }
        assert.strictEqual(code, 1, `expected exit 1 for ${JSON.stringify(env)}`);
    }
    console.log('ok: missing WEBADMIN_CONFIG file / bad WEBADMIN_CONFIG_JSON fail startup');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('config.test.js: all tests passed');
