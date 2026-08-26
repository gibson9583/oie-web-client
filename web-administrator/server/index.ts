#!/usr/bin/env node
/*
 * OIE Web Administrator — standalone NodeJS server.
 *
 * Serves the single-page web administrator, reverse-proxies the engine REST
 * API at /api, and loads web admin plugins. See ../README.md.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

import { load } from './config';
import type { TlsConfig } from './config';
import { createApiProxy } from './proxy';
import { installPluginRoutes } from './plugin-install';
import * as plugins from './plugins';

const config = load();
const app = express();
const clientDir = path.join(config.root, 'client');

// Dev mode (npm run dev) serves the shell through Vite for HMR; production
// (npm start) serves the static files as before — zero extra dependencies.
const DEV = process.env.WEBADMIN_DEV === '1';

// Build identity stamped by tools/build-info.mjs (gitignored; rebuilt by every
// build/start script and the Docker build). The version is package.json's; git
// supplies only which commit it was built from. Absent only on an install that
// never ran a build script — the version still holds, we just can't say which
// build it is.
let buildInfo: { version: string; commit?: string | null; dirty?: boolean; date?: string | null };
try {
    buildInfo = JSON.parse(fs.readFileSync(path.join(config.root, 'build-info.json'), 'utf8'));
} catch {
    buildInfo = { version: require('../package.json').version };
}

// Build the listening server: HTTPS when config.tls supplies a readable key+cert
// PEM (a convenience for standalone installs), else plain HTTP. Most deployments
// terminate TLS at a reverse proxy instead. Exits with a clear message on a bad key/cert.
function createServer(handler: http.RequestListener, tls: TlsConfig | null): http.Server | https.Server {
    if (!tls) return http.createServer(handler);
    try {
        return https.createServer({
            key: fs.readFileSync(tls.key),
            cert: fs.readFileSync(tls.cert),
            passphrase: tls.passphrase
        }, handler);
    } catch (e) {
        console.error(`[tls] Could not read the TLS key/cert (${(e as Error).message}). Check config.tls.key and config.tls.cert.`);
        process.exit(1);
    }
}

app.disable('x-powered-by');

// --- Content-Security-Policy -------------------------------------------------
// Fully same-origin: Monaco (/vendor/monaco) and the webfonts (/vendor/fonts,
// both built by tools/build-vendor.mjs) are served locally, so no external
// origin is needed at all and the app renders as designed air-gapped. data:
// covers the attachment viewers' inline images/frames.
//
// script-src carries no 'unsafe-inline'/'unsafe-eval': the shell's ONE inline
// script (the importmap) is authorized by a per-response nonce the shell route
// injects, script validation goes through the engine (core/serialize.js), and
// Monaco's workers are covered by worker-src blob:. Style-src keeps
// 'unsafe-inline' (pervasive inline styles). Dev (Vite HMR) still needs inline
// + eval (the react-refresh preamble, dep optimizer) and a WebSocket.
const cspFor = (nonce: string) => [
    "default-src 'self'",
    DEV ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self'${DEV ? ' ws: wss:' : ''}`,
    "frame-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
].join('; ');
app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    res.setHeader('Content-Security-Policy', cspFor(res.locals.cspNonce));
    // Plugin files are served from disk by extension (/plugins/:id/*); nosniff
    // stops a mistyped/omitted Content-Type from being sniffed into something
    // executable. Referrer-Policy keeps internal paths (and any engine URL in a
    // query) out of cross-origin Referer headers.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

// --- /api cache posture ------------------------------------------------------
// Nothing under /api may reach the browser's disk cache: engine responses carry
// channel configs (connector passwords) and message content (PHI), and the
// cache is a plaintext file under the profile that outlives logout on a shared
// workstation. Proxied engine responses get this forced in server/proxy.js
// (forceNoStore — writeHead would override a value set here); this middleware
// covers everything else under /api: the local _webadmin routes below and the
// proxy's engine-unreachable error path.
app.use('/api', (req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// --- Web-admin plugin install/uninstall (engine-gated) -----------------------
// Local /api/_webadmin/* routes, registered BEFORE the proxy so they're handled
// here (the engine has no such path) while the /api session cookie still flows.
installPluginRoutes(app, config);

// --- Engine REST API proxy ---------------------------------------------------
app.use('/api', createApiProxy(config));

// --- Web admin metadata ------------------------------------------------------
app.get('/webadmin/config.json', (req: Request, res: Response) => {
    // This endpoint is served pre-auth (the login screen fetches it), so it must
    // not disclose internal engine URLs. The client selects an engine by its
    // index (the oie-engine cookie) and the proxy resolves the real URL server
    // side (see server/proxy.js); the browser never needs the URL. Names are
    // already host-derived when unset (buildEngines → engineLabel), so the login
    // dropdown and the connected-engine label read fine from `name` alone.
    res.json({
        engines: config.engines.map((e) => ({ name: e.name })),
        devMode: !!config.devMode,
        version: buildInfo.version,
        build: { commit: buildInfo.commit || null, dirty: !!buildInfo.dirty, date: buildInfo.date || null },
        codeTemplateCompletions: config.codeTemplateCompletions !== false
    });
});

// --- Vendored Monaco editor (self-hosted ESM, for air-gapped installs) --------
// Code editors upgrade to Monaco loaded from this local path instead of a CDN, so
// syntax highlighting/completion work with no internet access. The editor bundle
// + workers are built by tools/build-vendor.mjs into client/vendor/monaco/ (ESM,
// self-contained). Mounted here (before the Vite/static frontend) so /vendor/
// monaco/* resolves in dev and prod alike. If the bundle isn't present, editors
// fall back to the plain textarea. Files are (re)built per install, so revalidate
// rather than cache immutably.
app.use('/vendor/monaco', express.static(path.join(clientDir, 'vendor', 'monaco'),
    { maxAge: '1d', dotfiles: 'deny' }));

// Webfonts (Inter + JetBrains Mono), vendored from the Fontsource packages by
// the same script — index.html links /vendor/fonts/fonts.css in place of the
// Google Fonts CDN. Same serving rationale as Monaco above.
app.use('/vendor/fonts', express.static(path.join(clientDir, 'vendor', 'fonts'),
    { maxAge: '1d', dotfiles: 'deny' }));

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
            configFile: path.join(config.root, 'vite.config.ts'),
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
        // Shell route: render index.html with <link rel="modulepreload"> hints for
        // each plugin entry (so the browser fetches plugin code in parallel with
        // the app bundle) and the CSP nonce on the importmap — the shell's one
        // inline script, which script-src authorizes per response.
        const indexHtmlPath = path.join(shellDir, 'index.html');
        const serveShell = (req: Request, res: Response) => {
            let html: string;
            try { html = fs.readFileSync(indexHtmlPath, 'utf8'); }
            catch { return res.status(500).type('text').send('index.html not found — run "npm run build"'); }
            html = html.replace('<script type="importmap"', `<script type="importmap" nonce="${res.locals.cspNonce}"`);
            const preloads = plugins.preloadLinks(config).join('\n  ');
            if (preloads) html = html.replace('</head>', `  ${preloads}\n</head>`);
            res.type('html').send(html);
        };
        // The raw file must never bypass the nonce injection: register the shell
        // route for /index.html ahead of the static mounts, and disable their
        // directory-index serving so `/` reaches the fallback too.
        app.get('/index.html', serveShell);
        // dotfiles:'deny' rejects nested dotfile segments (e.g. a /.git/config or
        // .env that ever landed under a served root) — express.static's default
        // 'ignore' only blocks them as a leaf. Matches the /plugins handler.
        if (built) app.use(express.static(distDir, { dotfiles: 'deny', index: false }));
        app.use(express.static(clientDir, { dotfiles: 'deny', index: false }));
        // SPA fallback. Express 5 named-wildcard note: `/*splat` does NOT match
        // the bare `/` — the braced `/{*splat}` form does, and `/` must reach
        // the shell now that the static mounts no longer serve a directory index.
        app.get('/{*splat}', serveShell);
        // The unbundled-source fallback below cannot actually boot the app: the shell
        // entry is /main.jsx (browsers refuse a text/jsx module) and app.css imports
        // Tailwind, so both need a build step. Say so plainly — the symptom is an
        // otherwise unexplained blank page stuck on the boot splash.
        if (!built) console.warn('  [build] No client/dist found — the app WILL NOT LOAD. Run "npm run build" (or "npm run dev" for the Vite dev server).');
    }

    const server = createServer(app, config.tls);
    const scheme = config.tls ? 'https' : 'http';

    server.listen(config.port, config.host, () => {
        console.log('');
        console.log('  Open Integration Engine — Web Administrator');
        console.log('  --------------------------------------------');
        // 0.0.0.0 / :: are bind-all addresses, not browsable — print the loopback
        // URL you actually open, and note the interface it's bound to.
        const wildcard = config.host === '0.0.0.0' || config.host === '::';
        console.log(`  UI:      ${scheme}://${wildcard ? 'localhost' : config.host}:${config.port}`
            + (wildcard ? `  (bound to ${config.host} — all interfaces)` : '')
            + (config.tls ? '  (TLS)' : '')
            + (DEV ? '  (dev — Vite HMR)' : ''));
        if (config.engines.length > 1) {
            console.log(`  Engines: ${config.engines.map((e: { name: string; url: string }) => `${e.name} (${e.url})`).join(', ')}`);
        } else {
            console.log(`  Engine:  ${config.engines[0].url} (TLS verify: ${config.engines[0].verifyTls})`);
        }
        if (config.devMode) console.log('  devMode: ON — a login-entered engine URL will be proxied (trusted deployments only)');
        console.log(`  Version: ${buildInfo.version}${buildInfo.commit ? ` (${String(buildInfo.commit).slice(0, 7)}${buildInfo.dirty ? '-dirty' : ''})` : ''}`);
        console.log(`  Plugins: ${loaded.length} loaded`);
        // Bind-posture warning: on a routable interface without TLS, the proxy
        // strips Secure from the JSESSIONID cookie (server/proxy.js), so the
        // admin session — plus channel configs and message content — crosses the
        // network in cleartext. Fine behind an upstream TLS terminator; a nudge
        // when nothing is protecting it.
        const loopback = config.host === '127.0.0.1' || config.host === '::1' || config.host === 'localhost';
        if (!loopback && !config.tls) {
            console.log('');
            console.log('  WARNING: bound to a non-loopback address without TLS — the engine session');
            console.log('           cookie and channel/message data cross the network in cleartext.');
            console.log('           Terminate TLS upstream, set config.tls, or bind host to 127.0.0.1.');
        }
        console.log('');
    });
}

start().catch((err) => {
    console.error('Failed to start web administrator:', err);
    process.exit(1);
});
