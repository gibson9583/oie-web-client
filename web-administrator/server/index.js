#!/usr/bin/env node
/*
 * OIE Web Administrator — standalone NodeJS server.
 *
 * Serves the single-page web administrator, reverse-proxies the engine REST
 * API at /api, and loads web admin plugins. See ../README.md.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const { load } = require('./config');
const { createApiProxy } = require('./proxy');
const plugins = require('./plugins');
const { installSerialize } = require('./serialize');

const config = load();
const app = express();
const clientDir = path.join(config.root, 'client');

// Dev mode (npm run dev) serves the shell through Vite for HMR; production
// (npm start) serves the static files as before — zero extra dependencies.
const DEV = process.env.WEBADMIN_DEV === '1';

app.disable('x-powered-by');

// --- Content-Security-Policy -------------------------------------------------
// Same-origin by default. Allows the two CDNs the SPA actually uses — Google
// Fonts (fonts.googleapis.com / fonts.gstatic.com) and Monaco (cdn.jsdelivr.net,
// incl. its blob: worker) — plus data: images/frames for the attachment viewers.
// 'unsafe-inline' (the importmap + pervasive inline styles) and 'unsafe-eval'
// (Monaco's worker + the datatype script validator) are required by the current
// client. Dev (Vite HMR) additionally needs a WebSocket.
const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self' https://cdn.jsdelivr.net${DEV ? ' ws: wss:' : ''}`,
    "frame-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => { res.setHeader('Content-Security-Policy', CSP); next(); });

// --- Engine REST API proxy ---------------------------------------------------
app.use('/api', createApiProxy(config));

// --- Web admin metadata ------------------------------------------------------
app.get('/webadmin/config.json', (req, res) => {
    res.json({
        engineUrl: config.engine.url,
        version: require('../package.json').version,
        codeTemplateCompletions: config.codeTemplateCompletions !== false
    });
});

// --- Serializer bridge (optional, exact datatype serialization) --------------
const serializerBridge = installSerialize(app, config);

// --- Plugins -----------------------------------------------------------------
// Registered BEFORE the frontend so /plugins/* and /webadmin/plugins.json take
// precedence over Vite/static (plugins are served from disk, unbundled).
const loaded = plugins.install(app, config);

async function start() {
    if (DEV) {
        // --- Vite dev middleware (HMR) -------------------------------------
        // Vite is ESM-only, so load it dynamically; it only matters in dev.
        const { createServer } = await import('vite');
        const vite = await createServer({
            configFile: path.join(config.root, 'vite.config.js'),
            root: clientDir,
            server: { middlewareMode: true },
            appType: 'spa'   // Vite serves/transforms index.html for unmatched GETs
        });
        // The shell + framework modules (/app.js, /core/*.js, /connectors/*.js,
        // /css/*) are transformed and HMR-served by Vite. Plugin imports of
        // /core/ui.js etc. resolve here too, so there's a single instance.
        app.use(vite.middlewares);
    } else {
        // --- Static frontend (production) ----------------------------------
        // Serve the built shell (client/dist: bundled app + hashed assets) first,
        // then the source framework (client/core, client/connectors, …) that the
        // bundle AND runtime plugins import externally via /core/*.js — one shared
        // instance. If no build is present, fall back to serving source directly.
        const distDir = path.join(clientDir, 'dist');
        const built = fs.existsSync(path.join(distDir, 'index.html'));
        const shellDir = built ? distDir : clientDir;
        if (built) app.use(express.static(distDir));
        app.use(express.static(clientDir));
        // SPA fallback: render the shell with <link rel="modulepreload"> hints for
        // each plugin entry, so the browser fetches plugin code in parallel with
        // the app bundle rather than discovering it after the plugins.json fetch.
        const indexHtmlPath = path.join(shellDir, 'index.html');
        app.get('*', (req, res) => {
            let html;
            try { html = fs.readFileSync(indexHtmlPath, 'utf8'); }
            catch { return res.status(500).type('text').send('index.html not found — run "npm run build"'); }
            const preloads = plugins.clientEntries(config)
                .map((e) => `<link rel="modulepreload" href="${e}">`).join('\n  ');
            if (preloads) html = html.replace('</head>', `  ${preloads}\n</head>`);
            res.type('html').send(html);
        });
        if (!built) console.warn('  [build] No client/dist found — serving unbundled source. Run "npm run build" for the optimized bundle.');
    }

    app.listen(config.port, config.host, () => {
        console.log('');
        console.log('  Open Integration Engine — Web Administrator');
        console.log('  --------------------------------------------');
        console.log(`  UI:      http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}${DEV ? '  (dev — Vite HMR)' : ''}`);
        console.log(`  Engine:  ${config.engine.url} (TLS verify: ${config.engine.verifyTls})`);
        console.log(`  Plugins: ${loaded.length} loaded from ${config.pluginDir}`);
        const sb = serializerBridge.status();
        console.log(`  Serializer bridge: ${sb.configured ? `enabled (engine: ${sb.engineHome})` : 'disabled — using built-in JS parsing (set OIE_HOME for exact serialization)'}`);
        console.log('');
    });
}

start().catch((err) => {
    console.error('Failed to start web administrator:', err);
    process.exit(1);
});
