/*
 * Boots real web-administrator servers for the e2e suite: one per worker
 * (see base.ts), and any a spec needs beyond that.
 */

import * as http from 'http';
import * as net from 'net';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const port = (probe.address() as net.AddressInfo).port;
            probe.close(() => resolve(port));
        });
    });
}

export async function listen(handler: http.RequestListener): Promise<{ server: http.Server; url: string }> {
    const port = await freePort();
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${port}` };
}

/**
 * Boots a real web administrator against the given config and waits until it
 * serves the pre-auth config document. Reports the child's stderr on failure —
 * without it a misconfiguration reads as a bare 20s timeout.
 */
export async function startWebAdmin(config: unknown): Promise<{ process: ChildProcess; url: string; stop: () => void }> {
    const port = await freePort();
    const url = `http://localhost:${port}`;
    // Playwright runs from the repo root (the config's directory).
    const serverDir = path.resolve(process.cwd(), 'web-administrator');
    const stderr: string[] = [];
    const child = spawn('node', ['server/index.js'], {
        cwd: serverDir,
        env: { ...process.env, WEBADMIN_PORT: String(port), WEBADMIN_CONFIG_JSON: JSON.stringify(config) },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr!.on('data', (chunk) => stderr.push(String(chunk)));

    // Ready when the pre-auth config document answers (its first request also
    // exercises the engine /public probe against the stub).
    const deadline = Date.now() + 20_000;
    for (;;) {
        try {
            const res = await fetch(`${url}/webadmin/config.json`);
            if (res.ok) break;
        } catch { /* not up yet */ }
        if (child.exitCode != null) throw new Error(`web admin exited early:\n${stderr.join('')}`);
        if (Date.now() > deadline) throw new Error(`web admin never became ready:\n${stderr.join('')}`);
        await new Promise((r) => setTimeout(r, 200));
    }
    return { process: child, url, stop: () => child.kill() };
}
