/*
 * Web-admin plugin install / uninstall — a thin, engine-gated forward.
 *
 * The extension zip is streamed to the engine's own installer, which enforces the
 * EXTENSIONS_MANAGE permission, installs the extension (its Java half AND its
 * `webadmin/` browser half), and serves that web half itself via /api/webplugins.
 * The web administrator keeps NO local copy — a plugin's UI follows the engine it
 * is installed on. So this module just forwards the request and relays the result;
 * authorization and storage are entirely the engine's.
 *
 * Routes are registered under /api/_webadmin/* — handled locally BEFORE the /api
 * proxy — so the engine session cookie (Path=/api) is carried on the request and
 * forwarded to the engine for the authz decision.
 */
import express from 'express';
import type { Request, Response, NextFunction, Express } from 'express';
import { engineRequest, resolveEngine } from './proxy';

const MAX_UPLOAD = '16mb';   // express.raw cap (engine zips are a few MB)

// CSRF: require the engine's anti-CSRF header. A cross-site request can't set a
// custom header without a preflight the same-origin policy/engine rejects — the
// same guard the proxy relies on.
export function csrfOk(req: { headers: Record<string, any> }): boolean { return typeof req.headers['x-requested-with'] === 'string' && req.headers['x-requested-with'].length > 0; }

// Cheap pre-parse gate: reject BEFORE express.raw buffers the upload. The engine
// is still the real authorizer (EXTENSIONS_MANAGE), but there is no reason to
// read up to MAX_UPLOAD from a caller that omits the CSRF header or carries no
// engine session cookie — it could never be authorized. Blunts unauthenticated
// memory-pressure/DoS against the web tier.
export function hasSession(req: { headers: Record<string, any> }): boolean { return /(?:^|;\s*)JSESSIONID=/.test(req.headers['cookie'] || ''); }
export function preUploadGate(req: Request, res: Response, next: NextFunction): any {
    if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF', message: 'Missing X-Requested-With header' });
    if (!hasSession(req)) return res.status(401).json({ error: 'NO_SESSION', message: 'No engine session' });
    next();
}

function relayEngine(res: Response, engineRes: { status: number; headers: Record<string, any>; body: Buffer }): Response {
    res.status(engineRes.status);
    const ct = engineRes.headers && engineRes.headers['content-type'];
    if (ct) res.set('content-type', ct);
    return res.send(engineRes.body);
}

async function handleInstall(req: Request, res: Response, config: any): Promise<any> {
    if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF', message: 'Missing X-Requested-With header' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'EMPTY', message: 'No upload received' });

    // Forward the upload to the engine — it enforces EXTENSIONS_MANAGE, installs the
    // extension (Java + its webadmin/ half), and serves the web half via /api/webplugins.
    let engineRes;
    try {
        engineRes = await engineRequest(resolveEngine(config, req), {
            method: 'POST',
            path: '/api/extensions/_install',
            headers: {
                'content-type': req.headers['content-type'],
                'content-length': String(body.length),
                cookie: req.headers['cookie'] || '',
                'x-requested-with': req.headers['x-requested-with']
            },
            body
        });
    } catch (e) {
        console.error('[plugin-install] engine forward failed:', (e as Error).message);
        return res.status(502).json({ error: 'ENGINE_UNREACHABLE', message: 'Could not reach the Open Integration Engine.' });
    }
    if (engineRes.status < 200 || engineRes.status >= 300) return relayEngine(res, engineRes); // incl. 401/403 authz
    // The extension (and any web half) loads after the engine restarts.
    res.json({ engineInstalled: true, restartEngine: true });
}

async function handleUninstall(req: Request, res: Response, config: any): Promise<any> {
    if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF', message: 'Missing X-Requested-With header' });
    const enginePath = req.body && typeof req.body.path === 'string' ? req.body.path : null;
    if (!enginePath) return res.status(400).json({ error: 'NO_PATH', message: 'Extension path is required' });

    // Engine enforces EXTENSIONS_MANAGE on uninstall too, and owns the web half.
    let engineRes;
    try {
        const fwd = Buffer.from(enginePath, 'utf8');
        engineRes = await engineRequest(resolveEngine(config, req), {
            method: 'POST',
            path: '/api/extensions/_uninstall',
            headers: {
                'content-type': req.headers['content-type'] || 'application/json',
                'content-length': String(fwd.length),
                cookie: req.headers['cookie'] || '',
                'x-requested-with': req.headers['x-requested-with']
            },
            body: fwd
        });
    } catch (e) {
        console.error('[plugin-install] engine uninstall forward failed:', (e as Error).message);
        return res.status(502).json({ error: 'ENGINE_UNREACHABLE', message: 'Could not reach the Open Integration Engine.' });
    }
    if (engineRes.status < 200 || engineRes.status >= 300) return relayEngine(res, engineRes);
    res.json({ engineUninstalled: true, restartEngine: true });
}

// Mount BEFORE the /api proxy in server/index.js.
export function installPluginRoutes(app: Express, config: any): void {
    app.post('/api/_webadmin/plugins/_install',
        preUploadGate,
        express.raw({ type: () => true, limit: MAX_UPLOAD }),
        (req, res) => handleInstall(req, res, config));
    app.post('/api/_webadmin/plugins/_uninstall',
        express.json({ limit: '64kb' }),
        (req, res) => handleUninstall(req, res, config));
}

