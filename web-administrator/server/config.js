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
 *   WEBADMIN_PLUGIN_DIR  Directory containing web admin plugins (default ./plugins)
 *   WEBADMIN_PLUGIN_DIRS Additional plugin directories (':'-separated). Point one
 *                        at the engine's extensions directory to auto-load web
 *                        plugins shipped inside engine extensions
 *                        (extensions/<name>/webadmin/plugin.json).
 *   WEBADMIN_CODE_TEMPLATE_COMPLETIONS
 *                        "false" to disable code-template autocompletion in the
 *                        script editors (avoids fetching large catalogs).
 *   WEBADMIN_SERIALIZE_ALLOW_REMOTE
 *                        "true" to allow non-loopback clients to reach the
 *                        unauthenticated serializer bridge endpoints (default
 *                        loopback-only).
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
    pluginDir: path.join(ROOT, 'plugins'),
    // Filesystem path to the engine install (the directory containing
    // client-lib/, server-lib/, extensions/). When set and a JVM is available,
    // the message-tree serializer bridge runs the engine's OWN datatype
    // serializers for byte-exact output (strict + non-strict, all data types).
    // Without it, the web admin falls back to its built-in JS parsing.
    // Deployment-specific — set in config.json (or the OIE_HOME env var).
    engineHome: null,
    // Offer the channel's own Code Template functions as autocompletions in the
    // script editors (scoped to the channel + editor context). This fetches the
    // full code-template library set; on servers with very large catalogs an
    // admin may want to turn it off. Default on.
    codeTemplateCompletions: true,
    // The serializer bridge endpoints (/webadmin/serialize*) are reachable only
    // from loopback by default — they are unauthenticated (JSESSIONID is scoped
    // to /api and never reaches them) and drive the warm JVM. Local browsers and
    // a same-host reverse proxy work as-is; set this true only if the web admin
    // is exposed directly to remote browsers AND fronted by your own auth/TLS.
    serializeAllowRemote: false,
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
    if (process.env.WEBADMIN_PLUGIN_DIR) config.pluginDir = path.resolve(process.env.WEBADMIN_PLUGIN_DIR);
    if (process.env.OIE_HOME) config.engineHome = process.env.OIE_HOME;
    if (process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS) config.codeTemplateCompletions = process.env.WEBADMIN_CODE_TEMPLATE_COMPLETIONS === 'true';
    if (process.env.WEBADMIN_SERIALIZE_ALLOW_REMOTE) config.serializeAllowRemote = process.env.WEBADMIN_SERIALIZE_ALLOW_REMOTE === 'true';
    if (process.env.WEBADMIN_TRUSTED_PROXIES) config.trustedProxies = process.env.WEBADMIN_TRUSTED_PROXIES.split(',').map(s => s.trim()).filter(Boolean);
    if (config.engineHome) config.engineHome = path.resolve(config.engineHome);

    // Effective search list: the primary dir plus any extras from config.json
    // ("pluginDirs": [...]) or WEBADMIN_PLUGIN_DIRS.
    const extra = []
        .concat(Array.isArray(config.pluginDirs) ? config.pluginDirs : [])
        .concat(process.env.WEBADMIN_PLUGIN_DIRS ? process.env.WEBADMIN_PLUGIN_DIRS.split(path.delimiter) : [])
        .filter(Boolean)
        .map(p => path.resolve(p));
    config.pluginDirs = [config.pluginDir, ...extra];

    config.root = ROOT;
    return config;
}

module.exports = { load };
