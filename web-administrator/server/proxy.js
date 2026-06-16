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

function createApiProxy(config) {
    const target = new URL(config.engine.url);
    const isHttps = target.protocol === 'https:';
    const transport = isHttps ? https : http;

    const agent = isHttps
        ? new https.Agent({ keepAlive: true, rejectUnauthorized: config.engine.verifyTls })
        : new http.Agent({ keepAlive: true });

    return function apiProxy(req, res) {
        const headers = {};
        for (const [name, value] of Object.entries(req.headers)) {
            if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
        }
        headers['host'] = target.host;
        // The engine's CSRF protection requires this header on /api requests.
        if (!headers['x-requested-with']) headers['x-requested-with'] = 'OpenIntegrationEngine-WebAdmin';
        // Forward the real client IP for the engine's audit log. The engine reads
        // X-Forwarded-For and only falls back to the socket address — which here
        // is this proxy's loopback connection, so without this header every event
        // is logged as ::1. Append to any chain an upstream proxy already set so
        // the original client stays leftmost. (::ffff: is the IPv4-mapped prefix.)
        const clientIp = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        if (clientIp) {
            const prior = req.headers['x-forwarded-for'];
            headers['x-forwarded-for'] = prior ? `${prior}, ${clientIp}` : clientIp;
        }

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
            res.writeHead(upstreamRes.statusCode, resHeaders);
            upstreamRes.pipe(res);
        });

        upstream.on('error', (err) => {
            // Multi-address connect failures (e.g. ::1 and 127.0.0.1 both tried)
            // arrive as an AggregateError with an empty message — unwrap it.
            const causes = err.errors ? err.errors.map(e => e.message) : [err.message];
            const detail = `${err.code || ''} ${causes.join('; ')}`.trim();
            console.error(`[proxy] ${req.method} ${req.originalUrl} -> ${config.engine.url} failed: ${detail}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({
                error: 'ENGINE_UNREACHABLE',
                message: `Could not reach the engine at ${config.engine.url}: ${detail}`
            }));
        });

        req.pipe(upstream);
    };
}

module.exports = { createApiProxy };
