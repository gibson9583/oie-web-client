/*
 * Web administrator plugin loader.
 *
 * A plugin is a directory inside the configured plugin dir containing a
 * plugin.json manifest:
 *
 *   {
 *     "id": "hello-world",            // unique, url-safe
 *     "name": "Hello World",
 *     "version": "1.0.0",
 *     "author": "Example Corp",
 *     "description": "Demonstrates the web admin plugin API",
 *     "enabled": true,                 // optional, default true
 *     "client": { "entry": "web/plugin.js" },   // optional browser entry (ES module)
 *     "server": { "entry": "server.js" }        // optional server entry (CommonJS)
 *   }
 *
 * Client side: every file under the plugin directory is served at
 * /plugins/<id>/..., and the entry module is dynamically imported by the
 * frontend, which calls its exported register(platform) function.
 *
 * Server side: the entry module must export a function (router, context).
 * The router is an express.Router mounted at /plugin-api/<id>/ — use it to
 * add custom endpoints. context = { config, manifest, log }.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

function discover(pluginDirs) {
    const plugins = [];
    const seen = new Set();

    for (const pluginDir of pluginDirs) {
        if (!fs.existsSync(pluginDir)) continue;
        for (const entry of fs.readdirSync(pluginDir, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            // Native layout: <dir>/<name>/plugin.json. Engine-extension layout:
            // <extensions>/<name>/webadmin/plugin.json (web UI shipped inside an
            // engine extension zip).
            const candidates = [
                path.join(pluginDir, entry.name),
                path.join(pluginDir, entry.name, 'webadmin')
            ];
            const dir = candidates.find(d => fs.existsSync(path.join(d, 'plugin.json')));
            if (!dir) continue;

            try {
                const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
                if (!manifest.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(manifest.id)) {
                    console.error(`[plugins] ${entry.name}: plugin.json is missing a valid "id" — skipped`);
                    continue;
                }
                if (seen.has(manifest.id)) {
                    console.log(`[plugins] ${manifest.id}: already loaded from another directory — skipped`);
                    continue;
                }
                if (manifest.enabled === false) {
                    console.log(`[plugins] ${manifest.id}: disabled in manifest — skipped`);
                    continue;
                }
                seen.add(manifest.id);
                plugins.push({ dir, manifest });
            } catch (e) {
                console.error(`[plugins] ${entry.name}: failed to read plugin.json: ${e.message}`);
            }
        }
    }
    return plugins;
}

/*
 * Hot discovery: plugin directories are re-scanned on every manifest request
 * and plugin assets resolve their directory at request time. Installing an
 * engine extension that carries a webadmin/ folder therefore only needs a
 * BROWSER REFRESH — no web administrator restart.
 *
 * Server-side plugin entries (server.js) are the exception: they mount
 * Express routes and stay as loaded at startup (newly discovered ones are
 * mounted lazily on first sight, but updating an already-loaded server entry
 * still requires a restart because of Node's module cache).
 */
function install(app, config) {
    const dirs = config.pluginDirs || [config.pluginDir];
    const mountedServers = new Set();

    function toClientManifest(manifest) {
        return {
            id: manifest.id,
            name: manifest.name || manifest.id,
            version: manifest.version || '0.0.0',
            author: manifest.author || '',
            description: manifest.description || '',
            // Minimum @oie API version the plugin declares (client-side compat gate).
            apiMin: manifest.oie && manifest.oie.apiMin ? String(manifest.oie.apiMin) : null,
            entry: manifest.client && manifest.client.entry
                ? `/plugins/${manifest.id}/${manifest.client.entry}`
                : null
        };
    }

    function mountServerEntry(dir, manifest) {
        if (mountedServers.has(manifest.id)) return;
        mountedServers.add(manifest.id);
        if (!(manifest.server && manifest.server.entry)) return;
        const entryPath = path.join(dir, manifest.server.entry);
        try {
            const register = require(entryPath);
            const router = express.Router();
            register(router, {
                config,
                manifest,
                log: (msg) => console.log(`[plugin:${manifest.id}] ${msg}`)
            });
            app.use(`/plugin-api/${manifest.id}`, router);
            console.log(`[plugins] ${manifest.id}: server extension mounted at /plugin-api/${manifest.id}`);
        } catch (e) {
            console.error(`[plugins] ${manifest.id}: server entry failed to load: ${e.message}`);
        }
    }

    // Plugin assets: resolve the owning directory per request so newly
    // installed plugins serve immediately.
    app.get('/plugins/:id/*', (req, res) => {
        const found = discover(dirs).find(p => p.manifest.id === req.params.id);
        if (!found) return res.status(404).json({ error: 'PLUGIN_NOT_FOUND' });
        const file = path.normalize(req.params[0]);
        if (file.startsWith('..') || path.isAbsolute(file)) return res.status(400).end();
        // normalize() / { root } only constrain the path STRING — a symlink
        // landed inside the plugin dir (e.g. via an extension zip) would still
        // be followed off-tree. Resolve real paths and require the target to
        // stay within the plugin directory before serving.
        let realRoot, realTarget;
        try {
            realRoot = fs.realpathSync(found.dir);
            realTarget = fs.realpathSync(path.join(found.dir, file));
        } catch {
            return res.status(404).end();
        }
        if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
            return res.status(403).end();
        }
        // dotfiles:'deny' rejects dotfile segments (a checked-out .git/config,
        // .env, …) that sendFile's default 'ignore' only blocks as a leaf.
        res.sendFile(file, { root: found.dir, dotfiles: 'deny' }, (err) => {
            if (err && !res.headersSent) res.status(err.statusCode || 404).end();
        });
    });

    // The frontend bootstraps from this manifest — freshly scanned each time.
    app.get('/webadmin/plugins.json', (req, res) => {
        const plugins = discover(dirs);
        for (const { dir, manifest } of plugins) mountServerEntry(dir, manifest);
        res.json(plugins.map(p => toClientManifest(p.manifest)));
    });

    // Startup report (also mounts server entries present at boot).
    const initial = discover(dirs);
    for (const { dir, manifest } of initial) {
        mountServerEntry(dir, manifest);
        console.log(`[plugins] Loaded ${manifest.id} v${manifest.version || '0.0.0'}`);
    }
    return initial.map(p => toClientManifest(p.manifest));
}

// Fresh list of client plugin entry URLs, for <link rel="modulepreload"> hints
// in index.html (so the browser fetches plugin code in parallel with the shell
// instead of waiting on the plugins.json round-trip). Re-scanned per call.
function clientEntries(config) {
    const dirs = config.pluginDirs || [config.pluginDir];
    return discover(dirs)
        .map((p) => (p.manifest.client && p.manifest.client.entry)
            ? `/plugins/${p.manifest.id}/${p.manifest.client.entry}`
            : null)
        .filter(Boolean);
}

module.exports = { install, clientEntries };
