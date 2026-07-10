/*
 * Configuration loader for the OIE Web Administrator.
 *
 * Resolution order (later wins):
 *   1. Built-in defaults
 *   2. config.json in the project root (optional)
 *   3. Environment variables
 *
 * Environment variables:
 *   WEBADMIN_PORT        Port the web administrator listens on (default 3030)
 *   WEBADMIN_HOST        Bind address (default 0.0.0.0)
 *   OIE_URL              Base URL of the engine, e.g. https://localhost:8443
 *   OIE_VERIFY_TLS       "true" to verify the engine's TLS certificate (default false,
 *                        engines ship with self-signed certs)
 *   WEBADMIN_DEV_MODE    "true" to let a user type an arbitrary engine URL at login
 *                        (a manual URL field). Trusted/dev deployments only — the
 *                        proxy will forward to whatever host is entered. Default false.
 *   WEBADMIN_PLUGIN_DIRS Additional local plugin directories (':'-separated) scanned
 *                        alongside the bundled ./plugins (e.g. for local development).
 *   WEBADMIN_CODE_TEMPLATE_COMPLETIONS
 *                        "false" to disable code-template autocompletion in the
 *                        script editors (avoids fetching large catalogs).
 *   WEBADMIN_TRUSTED_PROXIES
 *                        Comma-separated peer IPs trusted to set X-Forwarded-For
 *                        (loopback is always trusted). Default none.
 *   WEBADMIN_TLS_KEY / WEBADMIN_TLS_CERT / WEBADMIN_TLS_PASSPHRASE
 *                        PEM key + cert (and optional passphrase) to serve the UI
 *                        over HTTPS directly. Both key and cert required to enable;
 *                        default is plain HTTP (terminate TLS at a reverse proxy).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const defaults = {
    port: 3030,
    host: '0.0.0.0',
    engine: {
        // Base URL of the Open Integration Engine REST API host — the CURRENT/default
        // engine (used when the client hasn't selected one).
        url: 'https://127.0.0.1:8443',
        // Engines ship with self-signed certificates; verification is opt-in.
        verifyTls: false
    },
    // Selectable engines shown as a login dropdown (by `name`). Each entry:
    // { name, url, verifyTls? }. Empty → single-engine mode (just engine.url, no
    // picker). verifyTls falls back to engine.verifyTls when omitted.
    allowedUrls: [],
    // Let a user type an arbitrary engine URL at login (a manual URL field). The
    // proxy forwards to whatever is entered, so this is for trusted/dev deployments
    // only. Default false. (Distinct from WEBADMIN_DEV=1, which is Vite HMR.)
    devMode: false,
    // Offer the channel's own Code Template functions as autocompletions in the
    // script editors (scoped to the channel + editor context). This fetches the
    // full code-template library set; on servers with very large catalogs an
    // admin may want to turn it off. Default on.
    codeTemplateCompletions: true,
    // Peer IPs trusted to set X-Forwarded-For (a front TLS terminator / reverse
    // proxy). Loopback is always trusted; list a non-loopback front proxy here.
    // Requests from untrusted peers can't spoof the engine's audit-log client IP.
    trustedProxies: [],
    // Optional built-in TLS for the browser <-> web admin hop. Off by default
    // (plain HTTP) — most deployments terminate TLS at a reverse proxy. Set
    // { key, cert, passphrase? } (PEM file paths, relative to the app root or
    // absolute) to serve HTTPS directly; both key and cert are required.
    tls: null
};

function load() {
    const config = JSON.parse(JSON.stringify(defaults));

    const configFile = path.join(ROOT, 'config.json');
    if (fs.existsSync(configFile)) {
        try {
            const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            Object.assign(config, fileConfig, {
                engine: Object.assign({}, config.engine, fileConfig.engine || {})
            });
        } catch (e) {
            console.error(`[config] Failed to parse ${configFile}: ${e.message}`);
            process.exit(1);
        }
    }

    if (process.env.WEBADMIN_PORT) config.port = parseInt(process.env.WEBADMIN_PORT, 10);
    if (process.env.WEBADMIN_HOST) config.host = process.env.WEBADMIN_HOST;
    if (process.env.OIE_URL) config.engine.url = process.env.OIE_URL;
    if (process.env.OIE_VERIFY_TLS) config.engine.verifyTls = process.env.OIE_VERIFY_TLS === 'true';
    if (process.env.WEBADMIN_DEV_MODE) config.devMode = process.env.WEBADMIN_DEV_MODE === 'true';
    if (process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS) config.codeTemplateCompletions = process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS === 'true';
    if (process.env.WEBADMIN_TRUSTED_PROXIES) config.trustedProxies = process.env.WEBADMIN_TRUSTED_PROXIES.split(',').map(s => s.trim()).filter(Boolean);

    // Optional built-in TLS (config.json "tls" or the env vars below). Enabled only
    // when BOTH key and cert are given; paths resolve against the app root. Off →
    // plain HTTP. The server reads the PEM files at startup (index.js).
    const tls = Object.assign({}, config.tls);
    if (process.env.WEBADMIN_TLS_KEY) tls.key = process.env.WEBADMIN_TLS_KEY;
    if (process.env.WEBADMIN_TLS_CERT) tls.cert = process.env.WEBADMIN_TLS_CERT;
    if (process.env.WEBADMIN_TLS_PASSPHRASE) tls.passphrase = process.env.WEBADMIN_TLS_PASSPHRASE;
    config.tls = (tls.key && tls.cert)
        ? { key: path.resolve(ROOT, tls.key), cert: path.resolve(ROOT, tls.cert), passphrase: tls.passphrase || undefined }
        : null;

    // Plugin SEARCH list: the shipped first-party (bundled framework) plugins in
    // ./plugins — ALWAYS scanned — plus any extra LOCAL dirs from config.json
    // ("pluginDirs": [...]) or WEBADMIN_PLUGIN_DIRS (ROOT-anchored). Extensions
    // installed on the engine are served by the engine itself (GET /api/webplugins),
    // not stored here. De-duped.
    const extra = []
        .concat(Array.isArray(config.pluginDirs) ? config.pluginDirs : [])
        .concat(process.env.WEBADMIN_PLUGIN_DIRS ? process.env.WEBADMIN_PLUGIN_DIRS.split(path.delimiter) : [])
        .filter(Boolean)
        .map(p => path.resolve(ROOT, p));
    config.pluginDirs = [...new Set([path.join(ROOT, 'plugins'), ...extra])];

    // Normalize the selectable engine list. `allowedUrls` (when set) is the picker;
    // otherwise the single default engine. Each entry gets a display name (falling
    // back to the URL host) and a verifyTls (falling back to the default engine's).
    // Invalid URLs are dropped with a warning. The proxy routes by index into this.
    config.engines = buildEngines(config);

    config.root = ROOT;
    return config;
}

// Derive a readable label from a URL, e.g. "https://oie-prod:8443/" -> "oie-prod:8443".
function engineLabel(url) {
    try { return new URL(url).host; } catch { return String(url); }
}

function buildEngines(config) {
    const raw = Array.isArray(config.allowedUrls) && config.allowedUrls.length
        ? config.allowedUrls
        : [{ name: null, url: config.engine.url, verifyTls: config.engine.verifyTls }];

    const engines = [];
    for (const e of raw) {
        if (!e || !e.url) continue;
        let url;
        try {
            url = new URL(String(e.url));
            if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
        } catch {
            console.error(`[config] ignoring engine with invalid url: ${e && e.url}`);
            continue;
        }
        engines.push({
            name: (e.name && String(e.name).trim()) || engineLabel(e.url),
            url: url.origin + url.pathname.replace(/\/$/, ''),
            verifyTls: e.verifyTls != null ? !!e.verifyTls : !!config.engine.verifyTls
        });
    }
    // Always have at least the default engine so the proxy can route.
    if (!engines.length) {
        engines.push({ name: engineLabel(config.engine.url), url: config.engine.url, verifyTls: !!config.engine.verifyTls });
    }
    return engines;
}

module.exports = { load, buildEngines };
