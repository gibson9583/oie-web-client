/*
 * Web-admin plugin install / uninstall — the decoupled, engine-gated path.
 *
 * One upload, fanned out server-side: the extension zip is forwarded to the
 * engine's own installer (which enforces the EXTENSIONS_MANAGE permission), and
 * ONLY if the engine accepts do we extract the `webadmin/` half into the web
 * admin's own pluginDir. So authorization is the engine's decision (one
 * authority, nothing reimplemented here) and the web admin no longer has to share
 * the engine's filesystem. See docs/web-plugin-install-design.md.
 *
 * Routes are registered under /api/_webadmin/* — handled locally BEFORE the /api
 * proxy — so the engine session cookie (Path=/api) is carried on the request and
 * forwarded to the engine for the authz decision.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { engineRequest } = require('./proxy');

const MAX_UPLOAD = '64mb';                       // express.raw cap (engine zips ~ a few MB)
const MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024; // zip-bomb guard (sum of declared sizes)
const MAX_ENTRY_SIZE = 16 * 1024 * 1024;         // per-entry cap, enforced BEFORE getData()
const MAX_ENTRIES = 4096;
// Same id shape the loader accepts; also the on-disk dir name, so keep it tight.
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

// CSRF: require the engine's anti-CSRF header. A cross-site request can't set a
// custom header without a preflight the same-origin policy/engine rejects — the
// same guard the proxy relies on.
function csrfOk(req) { return typeof req.headers['x-requested-with'] === 'string' && req.headers['x-requested-with'].length > 0; }

function relayEngine(res, engineRes) {
    res.status(engineRes.status);
    const ct = engineRes.headers && engineRes.headers['content-type'];
    if (ct) res.set('content-type', ct);
    return res.send(engineRes.body);
}

// Carve the single multipart "file" part's bytes out of the raw body (the
// browser's FormData has exactly that part). A wrong slice just yields an invalid
// zip → the web-half is skipped; it can't escape the extractor below.
function zipFromMultipart(buf, contentType) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
    if (!m) return null;
    const boundary = Buffer.from('\r\n--' + (m[1] || m[2]).trim());
    const headerEnd = buf.indexOf('\r\n\r\n');
    if (headerEnd < 0) return null;
    const start = headerEnd + 4;
    const end = buf.indexOf(boundary, start);
    return buf.subarray(start, end < 0 ? buf.length : end);
}

/*
 * Safely extract the `webadmin/` subtree of an engine-extension zip into
 * pluginDir/<id>/. Hardened against zip-slip, symlinks, and zip-bombs; writes to
 * a temp dir then atomically renames. Returns the installed plugin id, or null
 * if the zip carries no web half (engine-only extension).
 */
async function extractWebadmin(zipBytes, pluginDir) {
    const zip = await import('@zip.js/zip.js');
    zip.configure({ useWebWorkers: false });
    const reader = new zip.ZipReader(new zip.Uint8ArrayReader(new Uint8Array(zipBytes)));
    let tmp = null;
    try {
        const entries = await reader.getEntries();
        if (entries.length > MAX_ENTRIES) throw new Error('zip has too many entries');

        // Locate webadmin/plugin.json (native `webadmin/…` or engine-extension `<name>/webadmin/…`).
        const manifest = entries.find((e) => /(^|\/)webadmin\/plugin\.json$/.test(e.filename));
        if (!manifest) return null;                       // engine-only extension
        const prefix = manifest.filename.replace(/plugin\.json$/, '');   // e.g. "tls-manager/webadmin/"

        // Bound the read BEFORE getData so a manifest declaring a huge
        // uncompressedSize can't force a large inflation ahead of the total cap.
        if ((manifest.uncompressedSize || 0) > MAX_ENTRY_SIZE) throw new Error('webadmin/plugin.json too large');
        const manifestBytes = await manifest.getData(new zip.Uint8ArrayWriter());
        let id;
        try { id = JSON.parse(Buffer.from(manifestBytes).toString('utf8')).id; }
        catch { throw new Error('webadmin/plugin.json is not valid JSON'); }
        if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`invalid plugin id: ${id}`);

        // Record the engine extension's identity so uninstall can correlate the
        // forwarded extension back to THIS web-plugin dir (instead of a fragile
        // client-side name guess). The engine descriptor (plugin.xml) sits one
        // level up from webadmin/; its <name> is exactly what the Extensions list
        // shows, and the folder is the extension's install path.
        const extDir = prefix.replace(/webadmin\/$/, '').replace(/\/$/, '');   // "<folder>" or ""
        let engineName = null;
        const descriptor = entries.find((e) => e.filename === prefix.replace(/webadmin\/$/, '') + 'plugin.xml');
        if (descriptor && (descriptor.uncompressedSize || 0) <= MAX_ENTRY_SIZE) {
            try {
                const xml = Buffer.from(await descriptor.getData(new zip.Uint8ArrayWriter())).toString('utf8');
                const m = /<name>([\s\S]*?)<\/name>/.exec(xml);
                if (m) engineName = m[1].trim() || null;
            } catch { /* leave null — uninstall falls back to folder/id */ }
        }

        const webFiles = entries.filter((e) => e.filename.startsWith(prefix) && !e.directory);
        let total = 0;
        for (const e of webFiles) total += (e.uncompressedSize || 0);
        if (total > MAX_TOTAL_UNCOMPRESSED) throw new Error('webadmin payload too large');

        await fsp.mkdir(pluginDir, { recursive: true });
        const realPluginDir = await fsp.realpath(pluginDir);
        tmp = path.join(realPluginDir, `.tmp-${id}-${crypto.randomBytes(6).toString('hex')}`);
        await fsp.mkdir(tmp, { recursive: true });
        const realTmp = await fsp.realpath(tmp);

        for (const e of webFiles) {
            const rel = e.filename.slice(prefix.length);
            if (!rel || rel.endsWith('/')) continue;
            // zip-slip: no traversal / absolute; confine the resolved target to tmp.
            if (rel.includes('..') || path.isAbsolute(rel) || rel.includes('\0')) throw new Error(`unsafe entry: ${rel}`);
            const dest = path.resolve(realTmp, rel);
            if (dest !== realTmp && !dest.startsWith(realTmp + path.sep)) throw new Error(`entry escapes plugin dir: ${rel}`);
            if ((e.uncompressedSize || 0) > MAX_ENTRY_SIZE) throw new Error(`entry too large: ${rel}`);
            await fsp.mkdir(path.dirname(dest), { recursive: true });
            const data = await e.getData(new zip.Uint8ArrayWriter());
            // Always a regular file — we never create symlinks, so a symlink entry
            // can't be planted to redirect a later write.
            await fsp.writeFile(dest, Buffer.from(data));
        }

        // Uninstall-correlation marker (a dotfile — never served, dotfiles:'deny';
        // ignored by the loader, which only reads plugin.json).
        await fsp.writeFile(path.join(realTmp, '.oie-ext.json'), JSON.stringify({ engineName, extDir }));

        // Atomic swap: replace any prior install of this id.
        const target = path.join(realPluginDir, id);
        if (path.dirname(target) !== realPluginDir) throw new Error('invalid plugin id');
        await fsp.rm(target, { recursive: true, force: true });
        await fsp.rename(tmp, target);
        tmp = null;
        return id;
    } finally {
        try { await reader.close(); } catch { /* ignore */ }
        if (tmp) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
}

async function handleInstall(req, res, config) {
    if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF', message: 'Missing X-Requested-With header' });
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: 'EMPTY', message: 'No upload received' });

    // 1) Forward to the engine — it enforces EXTENSIONS_MANAGE. We do not decide.
    let engineRes;
    try {
        engineRes = await engineRequest(config, {
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
        console.error('[plugin-install] engine forward failed:', e.message);
        return res.status(502).json({ error: 'ENGINE_UNREACHABLE', message: 'Could not reach the Open Integration Engine.' });
    }
    if (engineRes.status < 200 || engineRes.status >= 300) return relayEngine(res, engineRes); // incl. 401/403 authz

    // 2) Engine accepted ⇒ extract the web half into our own pluginDir.
    let pluginId = null;
    try {
        const zipBytes = zipFromMultipart(body, req.headers['content-type']);
        if (zipBytes && zipBytes.length) pluginId = await extractWebadmin(zipBytes, config.pluginDir);
    } catch (e) {
        // Log the detail server-side only; the client gets a generic message so we
        // don't disclose pluginDir / server paths (matches the proxy's posture).
        console.error('[plugin-install] web-half extract failed:', e.message);
        return res.status(500).json({ engineInstalled: true, webInstalled: false, error: 'WEB_EXTRACT_FAILED', message: 'The engine extension installed, but its web UI could not be unpacked. Check the web administrator logs.' });
    }
    res.json({ engineInstalled: true, webInstalled: !!pluginId, pluginId, restartEngine: true, refresh: !!pluginId });
}

async function handleUninstall(req, res, config) {
    if (!csrfOk(req)) return res.status(403).json({ error: 'CSRF', message: 'Missing X-Requested-With header' });
    const enginePath = req.body && typeof req.body.path === 'string' ? req.body.path : null;
    const pluginId = req.body && typeof req.body.pluginId === 'string' ? req.body.pluginId : null;
    if (!enginePath) return res.status(400).json({ error: 'NO_PATH', message: 'Extension path is required' });

    // Engine enforces EXTENSIONS_MANAGE on uninstall too — gate the web-half on it.
    let engineRes;
    try {
        const fwd = Buffer.from(enginePath, 'utf8');
        engineRes = await engineRequest(config, {
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
        console.error('[plugin-install] engine uninstall forward failed:', e.message);
        return res.status(502).json({ error: 'ENGINE_UNREACHABLE', message: 'Could not reach the Open Integration Engine.' });
    }
    if (engineRes.status < 200 || engineRes.status >= 300) return relayEngine(res, engineRes);

    // Engine authorized + accepted ⇒ remove our own copy of the web half.
    // Correlate the forwarded extension back to its installed dir via the marker
    // we wrote at install — exact engine <name>, else the extension folder —
    // falling back to the client-supplied pluginId for pre-marker installs.
    let webRemoved = false;
    try {
        const realPluginDir = await fsp.realpath(config.pluginDir).catch(() => null);
        if (realPluginDir) {
            const fwdName = req.body && typeof req.body.name === 'string' ? req.body.name : null;
            const fwdPathBase = enginePath ? path.basename(String(enginePath)) : null;
            let dirName = null;
            for (const ent of await fsp.readdir(realPluginDir, { withFileTypes: true })) {
                if (!ent.isDirectory()) continue;
                let marker;
                try { marker = JSON.parse(await fsp.readFile(path.join(realPluginDir, ent.name, '.oie-ext.json'), 'utf8')); }
                catch { continue; }                          // no/invalid marker — skip
                if ((fwdName && marker.engineName && marker.engineName === fwdName) ||
                    (fwdPathBase && marker.extDir && marker.extDir === fwdPathBase)) { dirName = ent.name; break; }
            }
            // Legacy fallback: plugins installed before markers existed.
            if (!dirName && pluginId && ID_RE.test(pluginId)) dirName = pluginId;
            if (dirName) {
                const target = path.join(realPluginDir, dirName);
                if (path.dirname(target) === realPluginDir && fs.existsSync(target)) {
                    await fsp.rm(target, { recursive: true, force: true });
                    webRemoved = true;
                }
            }
        }
    } catch (e) { console.error('[plugin-install] web-half removal failed:', e.message); }
    res.json({ engineUninstalled: true, webRemoved, restartEngine: true, refresh: webRemoved });
}

// Mount BEFORE the /api proxy in server/index.js.
function installPluginRoutes(app, config) {
    app.post('/api/_webadmin/plugins/_install',
        express.raw({ type: () => true, limit: MAX_UPLOAD }),
        (req, res) => handleInstall(req, res, config));
    app.post('/api/_webadmin/plugins/_uninstall',
        express.json({ limit: '64kb' }),
        (req, res) => handleUninstall(req, res, config));
}

module.exports = { installPluginRoutes, extractWebadmin, zipFromMultipart, csrfOk };
