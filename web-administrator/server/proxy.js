/*
 * Reverse proxy for the engine REST API.
 *
 * The browser talks to /api/... on this server; we stream the request through to
 * the selected engine (.../api/...) and stream the response back. This keeps the
 * web administrator a standalone install: no CORS, no browser warnings about the
 * engine's self-signed cert, and the JSESSIONID cookie (Path=/api) round-trips
 * unchanged because the path is preserved.
 *
 * Multi-engine: the browser picks an engine at login and sets an `oie-engine`
 * cookie — the chosen engine's index into config.engines, or `custom` (with an
 * `oie-engine-url` cookie) when devMode allows a typed URL. resolveEngine() maps
 * that to a target per request; the client's base path stays /api. Those routing
 * cookies are stripped before the request is forwarded upstream.
 */

'use strict';

const http = require('http');
const https = require('https');

// Hop-by-hop headers must not be forwarded (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'
]);

function parseCookies(cookieHeader) {
    const out = {};
    for (const part of String(cookieHeader || '').split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (!k) continue;
        // A malformed value (bare `%`, `%ZZ`) must not throw and take down the whole
        // proxy call — fall back to the raw value (routing only reads oie-engine*).
        const raw = part.slice(i + 1).trim();
        try { out[k] = decodeURIComponent(raw); } catch { out[k] = raw; }
    }
    return out;
}

// Cookie header to forward upstream, minus the web-admin routing cookies (the
// engine has no use for them, and a typed custom URL shouldn't leak to it).
function forwardCookie(cookieHeader) {
    return String(cookieHeader || '').split(';')
        .map((s) => s.trim())
        .filter((s) => s && !/^oie-engine(-url)?=/i.test(s))
        .join('; ');
}

/*
 * Resolve which engine a request targets, from the `oie-engine` cookie:
 *   "<index>"  → config.engines[index]
 *   "custom"   → the `oie-engine-url` cookie, ONLY when config.devMode is on
 *   (absent/invalid) → the first configured engine (the default)
 * Returns { url, verifyTls }. Exported + pure for reuse (plugin-install) and tests.
 */
function resolveEngine(config, req) {
    const engines = Array.isArray(config.engines) && config.engines.length
        ? config.engines
        : [{ url: config.engine.url, verifyTls: !!config.engine.verifyTls }];
    const cookies = parseCookies(req && req.headers && req.headers['cookie']);
    const sel = cookies['oie-engine'];

    if (sel === 'custom' && config.devMode) {
        try {
            const u = new URL(cookies['oie-engine-url']);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                return { url: u.origin + u.pathname.replace(/\/$/, ''), verifyTls: false };
            }
        } catch { /* fall through to default */ }
    }
    if (sel != null && /^\d+$/.test(sel)) {
        const idx = parseInt(sel, 10);
        if (idx >= 0 && idx < engines.length) return engines[idx];
    }
    return engines[0];
}

// Is the immediate peer a trusted fronting proxy (loopback by default, plus any
// configured trustedProxies)? Only then do we believe the forwarding headers it
// set. Pure + exported for testing.
function isTrustedPeer(remoteAddress, trusted) {
    const peer = String(remoteAddress || '').replace(/^::ffff:/, '');
    if (!peer) return false;
    return peer === '127.0.0.1' || peer === '::1' || peer.startsWith('127.') || (!!trusted && trusted.has(peer));
}

// Compute the X-Forwarded-For to send upstream. The inbound chain is trusted
// (and our peer appended) only when the immediate peer is a trusted proxy;
// otherwise the peer's claimed chain is forgeable, so we send just the real
// socket IP. Pure + exported for testing.
function resolveForwardedFor(remoteAddress, priorXff, trusted) {
    const peer = String(remoteAddress || '').replace(/^::ffff:/, '');
    if (!peer) return priorXff || undefined;
    return (priorXff && isTrustedPeer(remoteAddress, trusted)) ? `${priorXff}, ${peer}` : peer;
}

// Other proxy-forwarding headers a client could spoof to the engine (host-header
// injection, forged scheme/port/client-IP). The proxy is the trust boundary, so a
// direct/untrusted client's values are dropped; a trusted fronting proxy keeps them.
// Covers the full set the engine's Jetty ForwardedRequestCustomizer honors, not just
// the common three, so the strip is complete.
const PROXY_FWD_HEADERS = [
    'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-proto', 'x-forwarded-prefix',
    'x-forwarded-server', 'x-forwarded-scheme', 'x-forwarded-ssl', 'x-forwarded-https',
    'x-proxied-https', 'forwarded', 'x-real-ip'
];

// Normalize the forwarding headers on the upstream request (mutates `headers`):
// set a trust-aware X-Forwarded-For, and strip the spoofable X-Forwarded-* /
// Forwarded / X-Real-IP headers unless the immediate peer is trusted. Pure +
// exported for testing.
function sanitizeForwardHeaders(headers, remoteAddress, priorXff, trusted) {
    const xff = resolveForwardedFor(remoteAddress, priorXff, trusted);
    if (xff) headers['x-forwarded-for'] = xff; else delete headers['x-forwarded-for'];
    if (!isTrustedPeer(remoteAddress, trusted)) {
        for (const h of PROXY_FWD_HEADERS) delete headers[h];
    }
    return headers;
}

function createApiProxy(config) {
    const trustedProxies = new Set(Array.isArray(config.trustedProxies) ? config.trustedProxies : []);
    // Keep-alive agents cached per engine (url + verifyTls) so switching engines
    // doesn't re-create sockets each request.
    const agents = new Map();
    function agentFor(engine) {
        const key = `${engine.url}|${engine.verifyTls}`;
        let entry = agents.get(key);
        if (!entry) {
            const target = new URL(engine.url);
            const isHttps = target.protocol === 'https:';
            entry = {
                target,
                isHttps,
                transport: isHttps ? https : http,
                agent: isHttps
                    ? new https.Agent({ keepAlive: true, rejectUnauthorized: !!engine.verifyTls })
                    : new http.Agent({ keepAlive: true })
            };
            agents.set(key, entry);
        }
        return entry;
    }

    return function apiProxy(req, res) {
        const engine = resolveEngine(config, req);
        const { target, isHttps, transport, agent } = agentFor(engine);

        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
        }
        headers['host'] = target.host;
        if (req.headers['cookie'] != null) {
            const fwd = forwardCookie(req.headers['cookie']);
            if (fwd) headers['cookie'] = fwd; else delete headers['cookie'];
        }
        // Do NOT synthesize the engine's anti-CSRF header (X-Requested-With):
        // that guard works precisely because a cross-site request can't set a
        // custom header without a preflight the engine rejects. The SPA sets it
        // on every request (client/core/api.js), so it passes through here as-is
        // for legitimate calls; forging it server-side would defeat the guard.
        //
        // One narrow, deliberate exception: plugin UI modules are loaded with
        // <script>/import(), which cannot attach custom headers. Those are GETs
        // of static assets under the websupport plugin's webplugins path — no
        // state changes — so the header is synthesized for exactly that shape,
        // mirroring the scoped filter exemption an engine with native web-support
        // endpoints applies itself. Every other request keeps the real guard.
        if ((req.method === 'GET' || req.method === 'HEAD')
                && req.headers['x-requested-with'] == null
                && req.originalUrl.startsWith('/api/extensions/websupport/webplugins/')) {
            headers['x-requested-with'] = 'OpenIntegrationEngine';
        }
        // Forward the real client IP for the engine's audit log (the engine reads
        // X-Forwarded-For, else the socket address = this proxy's loopback), and drop
        // the other spoofable forwarding headers from a direct client. Both honor a
        // client-supplied value ONLY when the immediate peer is a trusted proxy
        // (loopback by default, plus config.trustedProxies).
        sanitizeForwardHeaders(headers, req.socket.remoteAddress, req.headers['x-forwarded-for'], trustedProxies);

        const upstream = transport.request({
            agent,
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            method: req.method,
            path: req.originalUrl,
            headers
        }, (upstreamRes) => {
            const resHeaders = {};
            for (const [name, value] of Object.entries(upstreamRes.headers)) {
                if (!HOP_BY_HOP.has(name.toLowerCase())) resHeaders[name] = value;
            }
            // Reconcile the engine's session cookie with THIS connection's scheme as
            // it crosses our origin. Add SameSite=Lax (CSRF defense-in-depth). When
            // the front is HTTPS, add Secure. When the front is plain HTTP, STRIP any
            // Secure flag the engine set (it serves over HTTPS and Jetty marks the
            // JSESSIONID Secure): a browser silently drops a Secure cookie received
            // over HTTP, so leaving it on breaks login on an HTTP deployment — and
            // Secure protects nothing over a connection that's already plaintext.
            if (Array.isArray(resHeaders['set-cookie'])) {
                // Trust the client's X-Forwarded-Proto only from a trusted fronting
                // proxy; otherwise derive the scheme from the actual connection.
                const proto = isTrustedPeer(req.socket.remoteAddress, trustedProxies) ? req.headers['x-forwarded-proto'] : undefined;
                const secure = proto === 'https' || !!req.socket.encrypted;
                resHeaders['set-cookie'] = resHeaders['set-cookie'].map((c) => {
                    if (!/;\s*samesite=/i.test(c)) c += '; SameSite=Lax';
                    if (secure) { if (!/;\s*secure/i.test(c)) c += '; Secure'; }
                    else c = c.replace(/;\s*secure\b/ig, '');
                    return c;
                });
            }
            res.writeHead(upstreamRes.statusCode, resHeaders);
            upstreamRes.pipe(res);
        });

        upstream.on('error', (err) => {
            // Multi-address connect failures (e.g. ::1 and 127.0.0.1 both tried)
            // arrive as an AggregateError with an empty message — unwrap it.
            const causes = err.errors ? err.errors.map((e) => e.message) : [err.message];
            const detail = `${err.code || ''} ${causes.join('; ')}`.trim();
            // Full diagnostics (engine URL + socket error) go to the server log
            // only; the browser gets a generic message so we don't disclose the
            // internal engine address/port or socket topology to a client.
            console.error(`[proxy] ${req.method} ${req.originalUrl} -> ${engine.url} failed: ${detail}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({
                error: 'ENGINE_UNREACHABLE',
                message: 'Could not reach the Open Integration Engine. Check the web administrator logs for details.'
            }));
        });

        req.pipe(upstream);
    };
}

// Server-initiated request to the engine REST API (used by the web-admin plugin
// install/uninstall endpoints to forward to /api/extensions/_install etc. so the
// ENGINE makes the EXTENSIONS_MANAGE authorization decision). `engine` is a
// resolved { url, verifyTls } (see resolveEngine) — same TLS posture as the proxy.
// Buffers the response.
function engineRequest(engine, { method, path: reqPath, headers, body }) {
    return new Promise((resolve, reject) => {
        const target = new URL(engine.url);
        const isHttps = target.protocol === 'https:';
        const transport = isHttps ? https : http;
        const agent = isHttps
            ? new https.Agent({ rejectUnauthorized: !!engine.verifyTls })
            : new http.Agent();
        const h = {};
        for (const [name, value] of Object.entries(headers || {})) {
            if (value != null && !HOP_BY_HOP.has(name.toLowerCase())) h[name] = value;
        }
        h.host = target.host;
        const MAX_RESPONSE = 16 * 1024 * 1024;   // bound the buffered engine response
        const upstream = transport.request({
            agent,
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            method,
            path: reqPath,
            headers: h
        }, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (c) => {
                size += c.length;
                if (size > MAX_RESPONSE) { res.destroy(); reject(new Error('engine response too large')); return; }
                chunks.push(c);
            });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        });
        upstream.setTimeout(120000, () => upstream.destroy(new Error('engine request timed out')));
        upstream.on('error', reject);
        if (body && body.length) upstream.write(body);
        upstream.end();
    });
}

module.exports = { createApiProxy, resolveForwardedFor, isTrustedPeer, sanitizeForwardHeaders, resolveEngine, engineRequest };
