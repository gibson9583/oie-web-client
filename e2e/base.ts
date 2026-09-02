/*
 * The `test` every mocked spec imports: one web-administrator server PER
 * WORKER, on its own port, with a fixed config.
 *
 * The suite used to share a single server booted by Playwright's webServer,
 * which forced workers: 1 — four browsers hammering one Node process starved
 * the login spec's boot and the run was slower than serial. Giving each worker
 * its own server removes the contention entirely: N workers, N servers, no
 * shared state, and the wall-clock divides by N.
 *
 * The fixed config also makes the suite hermetic. Booting from the repo root
 * picked up the developer's config.json — their engine list, their OIDC
 * provider, and a live probe of whatever engine they had running — so the
 * login card's shape depended on the machine. CI never had a config.json; now
 * neither does anyone else. The engine URL points at a closed local port so
 * the server's pre-auth probe fails instantly instead of waiting on a timeout.
 *
 * The `live` project spawns nothing and uses E2E_BASE_URL, as before.
 */

import { test as base, expect } from '@playwright/test';
import { startWebAdmin } from './server-harness.js';

/** Mirrors CI (no config.json): one engine, no picker, no OIDC provider. */
export const E2E_CONFIG = { engine: { url: 'https://127.0.0.1:1', verifyTls: false } };

type WorkerFixtures = { workerServer: string };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Playwright's own signature for "no test-scoped fixtures"
export const test = base.extend<{}, WorkerFixtures>({
    workerServer: [async ({}, use, workerInfo) => {
        if (workerInfo.project.name === 'live') {
            await use(process.env.E2E_BASE_URL || 'http://localhost:3030');
            return;
        }
        const app = await startWebAdmin(E2E_CONFIG);
        await use(app.url);
        app.stop();
    }, { scope: 'worker' }],
    // Every page.goto('/…') in the suite resolves against this worker's server.
    baseURL: async ({ workerServer }, use) => { await use(workerServer); },
});

export { expect };
