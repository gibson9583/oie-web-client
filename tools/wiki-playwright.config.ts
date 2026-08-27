import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const WIKI_PORT = process.env.WIKI_PORT || '3039';
const BASE_URL = process.env.WIKI_BASE_URL || `http://127.0.0.1:${WIKI_PORT}`;
const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));

export default defineConfig({
    testDir: '.',
    testMatch: /wiki-screenshots\.spec\.ts/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
    outputDir: '../test-results/wiki-screenshots',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: BASE_URL,
        viewport: { width: 1440, height: 1000 },
        colorScheme: 'light',
        trace: 'retain-on-failure',
    },
    webServer: {
        command: `WEBADMIN_PORT=${WIKI_PORT} WEBADMIN_CONFIG_JSON='{"engine":{"url":"https://127.0.0.1:8443","verifyTls":false},"allowedUrls":[]}' npm start -w web-administrator`,
        cwd: ROOT_DIR,
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 60_000,
    },
});
