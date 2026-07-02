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
 *   WEBADMIN_PLUGIN_DIRS Additional local plugin directories (':'-separated) scanned
 *                        alongside the bundled ./plugins (e.g. for local development).
 *   WEBADMIN_CODE_TEMPLATE_COMPLETIONS
 *                        "false" to disable code-template autocompletion in the
 *                        script editors (avoids fetching large catalogs).
 *   WEBADMIN_TRUSTED_PROXIES
 *                        Comma-separated peer IPs trusted to set X-Forwarded-For
 *                        (loopback is always trusted). Default none.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const defaults = {
    port: 3030,
    host: '0.0.0.0',
    engine: {
        // Base URL of the Open Integration Engine REST API host.
        url: 'https://127.0.0.1:8443',
        // Engines ship with self-signed certificates; verification is opt-in.
        verifyTls: false
    },
    // Offer the channel's own Code Template functions as autocompletions in the
    // script editors (scoped to the channel + editor context). This fetches the
    // full code-template library set; on servers with very large catalogs an
    // admin may want to turn it off. Default on.
    codeTemplateCompletions: true,
    // Peer IPs trusted to set X-Forwarded-For (a front TLS terminator / reverse
    // proxy). Loopback is always trusted; list a non-loopback front proxy here.
    // Requests from untrusted peers can't spoof the engine's audit-log client IP.
    trustedProxies: []
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
    if (process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS) config.codeTemplateCompletions = process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS === 'true';
    if (process.env.WEBADMIN_TRUSTED_PROXIES) config.trustedProxies = process.env.WEBADMIN_TRUSTED_PROXIES.split(',').map(s => s.trim()).filter(Boolean);

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

    config.root = ROOT;
    return config;
}

module.exports = { load };
