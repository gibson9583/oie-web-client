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
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
    },
    // Boot the web admin (Node server). With mocked /api it needs no engine.
    // reuseExistingServer lets you point at an already-running dev server (and is
    // how the live project reaches your real engine through the proxy).
    webServer: {
        command: 'npm start -w web-administrator',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [
        {
            name: 'ui',
            testIgnore: /live\.spec\.js/,
            use: { ...devices['Desktop Chrome'] },
        },
        // Only registered when E2E_LIVE=1, so the default run never needs an engine.
        ...(LIVE ? [{
            name: 'live',
            testMatch: /live\.spec\.js/,
            use: { ...devices['Desktop Chrome'] },
        }] : []),
    ],
});
