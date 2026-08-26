import { defineConfig, devices } from '@playwright/test';

/*
 * E2E config. Mock-by-default: the `ui` project intercepts /api/* in the browser
 * (see e2e/mock.js), so it runs with no engine, deterministically, anywhere.
 * The `live` project (real engine) is opt-in via E2E_LIVE=1 — see e2e/README.md.
 */
const LIVE = process.env.E2E_LIVE === '1';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3030';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry: serial (workers:1) so a retry adds no contention; recovers the
    // rare login→shell boot-timing flake that surfaces over a long suite run
    // (passes in isolation). A real regression still fails every attempt.
    retries: 1,
    // The whole suite shares ONE dev server. Parallel workers all hammering it at
    // once starve the login spec (the app bundle + plugin loads race its boot),
    // so run serially: the suite is small and each test is ~1s. Revisit with a
    // per-worker server or a lighter bundle if runtime becomes a problem.
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        // Live WAR deployments commonly use the engine's local/self-signed TLS
        // certificate. Mocked HTTP runs are unaffected.
        ignoreHTTPSErrors: BASE_URL.startsWith('https://'),
        // retain-on-failure (not on-first-retry) so the rare boot-timing flake
        // leaves the FAILING attempt's trace behind — on-first-retry only traces
        // the retry, which passes, so the flake was never diagnosable after the
        // fact. Passing runs delete their traces, so the steady-state cost is
        // recording overhead only.
        trace: 'retain-on-failure',
    },
    // Boot the web admin (Node server). With mocked /api it needs no engine.
    // reuseExistingServer lets you point at an already-running dev server (and is
    // how the live project reaches your real engine through the proxy).
    webServer: {
        command: 'npm start -w web-administrator',
        url: BASE_URL,
        ignoreHTTPSErrors: BASE_URL.startsWith('https://'),
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [
        {
            name: 'ui',
            testIgnore: /live\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        // Only registered when E2E_LIVE=1, so the default run never needs an engine.
        ...(LIVE ? [{
            name: 'live',
            testMatch: /live\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        }] : []),
    ],
});
