/*
 * Reverse proxy for the engine REST API.
 *
 * The browser talks to /api/... on this server; we stream the request through to
 * the engine (default https://localhost:8443/api/...) and stream the response
 * back. This keeps the web administrator a fully standalone install: no CORS,
 * no browser warnings about the engine's self-signed certificate, and the
 * JSESSIONID cookie (Path=/api) round-trips unchanged because the path is
 * preserved.
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

// Hop-by-hop headers must not be forwarded (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'
]);

// Compute the X-Forwarded-For to send upstream. The inbound chain is trusted
// (and our peer appended) only when the immediate peer is a trusted proxy;
// otherwise the peer's claimed chain is forgeable, so we send just the real
// socket IP. Pure + exported for testing.
function resolveForwardedFor(remoteAddress, priorXff, trusted) {
    const peer = String(remoteAddress || '').replace(/^::ffff:/, '');
    if (!peer) return priorXff || undefined;
    const peerTrusted = peer === '127.0.0.1' || peer === '::1' || peer.startsWith('127.') || (trusted && trusted.has(peer));
    return (priorXff && peerTrusted) ? `${priorXff}, ${peer}` : peer;
}

function createApiProxy(config) {
    const target = new URL(config.engine.url);
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;
    const trustedProxies = new Set(Array.isArray(config.trustedProxies) ? config.trustedProxies : []);

    const agent = isHttps
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: config.engine.verifyTls })
        : new http.Agent({ keepAlive: true });

    return function apiProxy(req, res) {
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
        }
        headers['host'] = target.host;
        // Do NOT synthesize the engine's anti-CSRF header (X-Requested-With):
        // that guard works precisely because a cross-site request can't set a
        // custom header without a preflight the engine rejects. The SPA sets it
        // on every request (client/core/api.js), so it passes through here as-is
        // for legitimate calls; forging it server-side would defeat the guard.
        // Forward the real client IP for the engine's audit log (the engine reads
        // X-Forwarded-For, else the socket address = this proxy's loopback). A
        // client-supplied chain is honored ONLY when the immediate peer is a
        // trusted proxy (loopback by default, plus config.trustedProxies);
        // otherwise it's forgeable, so we overwrite with the real socket IP.
        const xff = resolveForwardedFor(req.socket.remoteAddress, req.headers['x-forwarded-for'], trustedProxies);
        if (xff) headers['x-forwarded-for'] = xff;

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
            // Harden the engine's session cookie as it crosses our origin: add
            // SameSite (CSRF defense-in-depth) and, when the connection is HTTPS,
            // Secure so the session can't be sent over plain HTTP. The engine
            // sets neither because it serves the cookie on its own context.
            if (Array.isArray(resHeaders['set-cookie'])) {
                const https = req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
                resHeaders['set-cookie'] = resHeaders['set-cookie'].map((c) => {
                    if (!/;\s*samesite=/i.test(c)) c += '; SameSite=Lax';
                    if (https && !/;\s*secure/i.test(c)) c += '; Secure';
                    return c;
                });
            }
            res.writeHead(upstreamRes.statusCode, resHeaders);
            upstreamRes.pipe(res);
        });

        upstream.on('error', (err) => {
            // Multi-address connect failures (e.g. ::1 and 127.0.0.1 both tried)
            // arrive as an AggregateError with an empty message — unwrap it.
            const causes = err.errors ? err.errors.map(e => e.message) : [err.message];
            const detail = `${err.code || ''} ${causes.join('; ')}`.trim();
            // Full diagnostics (engine URL + socket error) go to the server log
            // only; the browser gets a generic message so we don't disclose the
            // internal engine address/port or socket topology to a client.
            console.error(`[proxy] ${req.method} ${req.originalUrl} -> ${config.engine.url} failed: ${detail}`);
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

module.exports = { createApiProxy, resolveForwardedFor };
