import { defineConfig, devices } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/*
 * E2E config. Mock-by-default: the `ui` project intercepts /api/* in the browser
 * (see e2e/mock.js), so it runs with no engine, deterministically, anywhere.
 * The `live` project (real engine) is opt-in via E2E_LIVE=1 — see e2e/README.md.
 */
const LIVE = process.env.E2E_LIVE === '1';
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3030';
// Shared with retry workers, unique across independent invocations. Cleanup
// must never remove another run's channel just because its worker index matches.
const RUN_ID = process.env.E2E_RUN_ID ||= randomUUID();
// Run the failure-sensitive flows in every supported browser engine.
// The full UI catalog remains in Chromium; these cover saves, dialogs,
// downloads, Monaco/fallback, authentication and plugin recovery across engines.
const CRITICAL = /(?:login|sso|dashboard|global-scripts|send-message|message-import|message-result-lifecycle|keyboard|editor-handoff|alert-save-lifecycle|save-lifecycle|datapruner-save|settings-save|wizard-recovery|channel-dependencies|dependency-handoff|dialog-actions|export|monaco-intellisense|sanitizer|resilience|viewer-lifecycle|dicom-viewer|engine-plugins)\.spec\.ts$/;

export default defineConfig({
    metadata: { runId: RUN_ID },
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // One retry: recovers the rare login→shell boot-timing flake that surfaces
    // over a long run (passes in isolation). A real regression still fails
    // every attempt.
    retries: 1,
    // Parallel by default (Playwright's default is half the cores). Each worker
    // boots its OWN web-administrator server — see e2e/base.ts — so workers
    // never contend for one Node process, which is what used to force
    // workers: 1. E2E_WORKERS overrides, e.g. E2E_WORKERS=1 to bisect a flake.
    workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
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
    // No webServer block: the mocked `ui` project boots one server per worker
    // from e2e/base.ts, on a free port with a fixed config, so a run never
    // depends on — or collides with — a dev server on :3030. The `live` project
    // uses BASE_URL as-is and expects you to have started that deployment.
    projects: [
        {
            name: 'ui',
            testIgnore: /live\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        { name: 'firefox', testMatch: CRITICAL, use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', testMatch: CRITICAL, use: { ...devices['Desktop Safari'] } },
        // Only registered when E2E_LIVE=1, so the default run never needs an engine.
        ...(LIVE ? [{
            name: 'live',
            testMatch: /live\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        }] : []),
    ],
});
