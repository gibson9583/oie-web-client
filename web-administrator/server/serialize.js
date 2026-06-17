/*
 * Serializer bridge — runs the engine's own datatype serializers so message
 * trees match the runtime exactly (strict + non-strict, every data type).
 *
 * A single long-lived `java --source 21` process (server/bridge/Serializer.java)
 * is launched with the engine install's jars on the classpath and kept warm.
 * Requests are multiplexed over its stdio with a line protocol (see the .java).
 * If the engine home or a JVM is unavailable, the bridge stays disabled and the
 * client falls back to its built-in JS parsing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REQUEST_TIMEOUT_MS = 15000;
const RESTART_BACKOFF_MS = 5000;
// One JVM serves all requests over a serial stdin loop, so cap how many can be
// outstanding at once — past this the warm process is saturated and further
// requests are shed (429) rather than queued unboundedly.
const MAX_PENDING = 16;

function buildClasspath(engineHome) {
    const cp = [];
    const star = (d) => path.join(engineHome, d, '*');
    for (const dir of ['client-lib', 'server-lib']) {
        if (fs.existsSync(path.join(engineHome, dir))) cp.push(star(dir));
    }
    const extDir = path.join(engineHome, 'extensions');
    if (fs.existsSync(extDir)) {
        for (const name of fs.readdirSync(extDir)) {
            if (!name.startsWith('datatype-')) continue;
            const jar = path.join(extDir, name, `${name}-shared.jar`);
            if (fs.existsSync(jar)) cp.push(jar);
        }
    }
    return cp.join(path.delimiter);
}

function createBridge(config) {
    const engineHome = config.engineHome;
    const javaBin = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java';
    const source = path.join(config.root, 'server', 'bridge', 'Serializer.java');

    // Preconditions: an engine home with the datatype jars must exist.
    let configured = false;
    if (engineHome && fs.existsSync(engineHome) && fs.existsSync(source)) {
        const cp = buildClasspath(engineHome);
        configured = cp.includes('datatype-hl7v2-shared.jar') || cp.includes('client-lib');
    }

    let proc = null;
    let ready = false;
    let lastError = null;
    let buffer = '';
    let nextId = 1;
    let lastExitAt = 0;
    let spawnedMtimeMs = 0;      // Serializer.java mtime at the moment we spawned
    const pending = new Map();   // id -> { resolve, reject, timer }

    function rejectAll(err) {
        for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); }
        pending.clear();
    }

    function sourceMtime() {
        try { return fs.statSync(source).mtimeMs; } catch { return 0; }
    }

    // The bridge runs `java --source 21 Serializer.java`, which compiles the
    // source in-memory at spawn — there is no .class cache and the process is
    // long-lived, so an edit to Serializer.java would otherwise be ignored until
    // the next server restart (producing stale "Unsupported data type" errors).
    // Retire the running process whenever the source is newer than what we
    // compiled; the next start() recompiles it.
    function retireIfStale() {
        if (!proc || sourceMtime() <= spawnedMtimeMs) return;
        const old = proc;
        proc = null;
        ready = false;
        buffer = '';
        // Detach lifecycle handlers so the intentional kill neither nulls out a
        // freshly-spawned process nor trips the crash-loop backoff.
        old.removeAllListeners('exit');
        old.removeAllListeners('error');
        old.on('error', () => {});
        rejectAll(new Error('serializer bridge reloading (Serializer.java changed)'));
        try { old.kill(); } catch { /* already gone */ }
    }

    function start() {
        retireIfStale();
        if (proc || !configured) return;
        if (Date.now() - lastExitAt < RESTART_BACKOFF_MS) return;   // crash-loop guard
        const cp = buildClasspath(engineHome);
        try {
            proc = spawn(javaBin, ['-Xmx512m', '--source', '21', '-cp', cp, source], {
                cwd: path.dirname(source),
                stdio: ['pipe', 'pipe', 'pipe']
            });
            spawnedMtimeMs = sourceMtime();
        } catch (e) {
            lastError = e.message; proc = null; return;
        }
        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', onData);
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (d) => { lastError = String(d).trim().slice(0, 500); });
        proc.on('error', (e) => { lastError = e.message; });
        proc.on('exit', (code) => {
            ready = false; proc = null; buffer = ''; lastExitAt = Date.now();
            rejectAll(new Error('serializer bridge exited' + (code != null ? ` (code ${code})` : '')));
        });
    }

    function onData(chunk) {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, i);
            buffer = buffer.slice(i + 1);
            if (line === 'READY') { ready = true; lastError = null; continue; }
            if (!line.startsWith('RES\t')) continue;
            const parts = line.split('\t');
            const id = parts[1];
            const p = pending.get(id);
            if (!p) continue;
            pending.delete(id);
            clearTimeout(p.timer);
            if (parts[2] === 'OK') {
                let meta = null;
                if (parts[5]) {
                    try { meta = JSON.parse(Buffer.from(parts[5], 'base64').toString('utf8')); } catch { /* ignore */ }
                }
                p.resolve({ format: parts[3], text: Buffer.from(parts[4] || '', 'base64').toString('utf8'), meta });
            } else {
                p.reject(new Error(Buffer.from(parts[3] || '', 'base64').toString('utf8') || 'serialize failed'));
            }
        }
    }

    function serialize({ dataType, serializationProperties, message }) {
        return new Promise((resolve, reject) => {
            if (!configured) return reject(new Error('serializer bridge not configured'));
            if (pending.size >= MAX_PENDING) {
                const e = new Error('serializer bridge busy'); e.busy = true;
                return reject(e);
            }
            start();
            if (!proc) return reject(new Error(lastError || 'serializer bridge unavailable'));
            const id = String(nextId++);
            const overrides = flattenProps(serializationProperties);
            const wire = [
                id, dataType,
                Buffer.from(String(message ?? ''), 'utf8').toString('base64'),
                Buffer.from(overrides, 'utf8').toString('base64')
            ].join('\t') + '\n';
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error('serialize timed out'));
            }, REQUEST_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            try {
                proc.stdin.write(wire);
            } catch (e) {
                pending.delete(id); clearTimeout(timer); reject(e);
            }
        });
    }

    // Coarse status only — the engine install path and raw JVM stderr stay
    // server-side (the route is unauthenticated). The client only needs
    // `configured` to decide whether to use the bridge or fall back.
    function status() {
        return { configured, ready };
    }

    // Warm start so the first real request is fast.
    if (configured) start();

    return { serialize, status, configured: () => configured };
}

/* Flatten an engine SerializationProperties object to key=value lines. Only
   primitive fields are forwarded; the Java side coerces by declared field type
   and ignores anything it doesn't recognize. */
function flattenProps(props) {
    if (!props || typeof props !== 'object') return '';
    const lines = [];
    for (const [k, v] of Object.entries(props)) {
        if (k.startsWith('@')) continue;
        if (v === null || v === undefined) continue;
        if (typeof v === 'object') continue;   // nested props left at engine defaults
        lines.push(`${k}=${v}`);
    }
    return lines.join('\n');
}

// The serializer routes are unauthenticated (JSESSIONID is scoped to /api and
// never reaches /webadmin) and drive the warm JVM, so restrict them to loopback
// by default — local browsers and a same-host reverse proxy reach them; direct
// remote exposure requires the explicit serializeAllowRemote opt-in.
function isLoopback(addr) {
    if (!addr) return false;
    const a = addr.replace(/^::ffff:/, '');
    return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

function installSerialize(app, config) {
    const bridge = createBridge(config);
    const localOnly = (req, res, next) => {
        if (config.serializeAllowRemote || isLoopback(req.socket && req.socket.remoteAddress)) return next();
        return res.status(403).json({ ok: false, error: 'serializer bridge is loopback-only' });
    };

    app.get('/webadmin/serialize/status', localOnly, (req, res) => res.json(bridge.status()));

    // Body: { dataType, serializationProperties?, message }
    app.post('/webadmin/serialize', localOnly, express_json_limit, (req, res) => {
        const body = req.body || {};
        if (!body.dataType || body.message == null) {
            return res.status(400).json({ ok: false, error: 'dataType and message are required' });
        }
        bridge.serialize(body).then(
            ({ format, text, meta }) => res.json({ ok: true, format, data: text, meta: meta || null }),
            (err) => res.status(err.busy ? 429 : (bridge.configured() ? 502 : 503))
                .json({ ok: false, error: err.message })
        );
    });

    return bridge;
}

// Local JSON body parser (templates can be large) without adding global middleware.
const express = require('express');
const express_json_limit = express.json({ limit: '8mb' });

module.exports = { installSerialize, createBridge, isLoopback };
