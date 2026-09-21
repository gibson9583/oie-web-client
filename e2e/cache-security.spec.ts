import { test, expect } from './base.js';
import { listen } from './server-harness.js';
import { mockEngine } from './mock.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { BrowserContext } from '@playwright/test';

// Real HTTP and a persistent profile: Playwright routing disables the browser
// cache, so mocks would hide this defect. The engine deliberately sends no
// cache directives, matching WAR deployments that bypass the Node proxy.
test('engine data is unavailable from disk cache after logout and browser restart', async ({ playwright }) => {
    let loggedIn = true, hits = 0;
    const profile = mkdtempSync(path.join(tmpdir(), 'oie-cache-test-'));
    const server = await listen((req, res) => {
        if (/^\/core\/[a-z-]+\.js$/.test(req.url || '')) {
            res.setHeader('Content-Type', 'text/javascript');
            res.end(readFileSync(path.join(process.cwd(), 'web-administrator/client', req.url!)));
        } else if (req.url === '/api/sensitive') {
            hits++;
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = loggedIn ? 200 : 401;
            res.end(JSON.stringify(loggedIn ? { data: 'SYNTHETIC-PATIENT-DATA' } : { error: 'unauthorized' }));
        } else {
            res.setHeader('Content-Type', 'text/html');
            res.end('<meta name="oie-webadmin-api-base" content="/api">');
        }
    });
    let context: BrowserContext | undefined;
    try {
        context = await playwright.chromium.launchPersistentContext(profile, { headless: true });
        let page = await context.newPage();
        await page.goto(server.url);
        expect(await page.evaluate(async () => {
            const api = await import(String('/core/api.js'));
            return api.get('/sensitive');
        })).toBe('SYNTHETIC-PATIENT-DATA');
        loggedIn = false;
        await context.close();
        context = await playwright.chromium.launchPersistentContext(profile, { headless: true });
        page = await context.newPage();
        await page.goto(server.url);
        const after = await page.evaluate(async () => {
            const response = await fetch('/api/sensitive', { cache: 'force-cache' });
            return { status: response.status, body: await response.text() };
        });
        expect(after.status).toBe(401);
        expect(after.body).not.toContain('SYNTHETIC-PATIENT-DATA');
        expect(hits).toBe(2);
    } finally {
        await context?.close();
        server.server.closeAllConnections(); server.server.close();
        rmSync(profile, { recursive: true, force: true });
    }
});

test('the background cache policy evicts legacy responses without removing sign-in or preferences', async ({ page, request }) => {
    // Use the real reset endpoint's headers on an origin simulating an older WAR. This
    // origin must be separate: the current Node proxy already forces no-store.
    const reset = await request.post('/webadmin/cache-reset', { headers: { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' } });
    expect(reset.status()).toBe(204);
    const headers = reset.headers();
    let loggedIn = true, hits = 0;
    const server = await listen((req, res) => {
        if (req.url === '/api/sensitive') {
            hits++;
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = loggedIn ? 200 : 401;
            res.end(loggedIn ? 'SYNTHETIC-LEGACY-DATA' : 'unauthorized');
        } else {
            if (req.url === '/upgraded') {
                res.setHeader('Cache-Control', headers['cache-control']);
                res.setHeader('Clear-Site-Data', headers['clear-site-data']);
            }
            res.setHeader('Content-Type', 'text/html');
            res.end('<title>Cache migration</title>');
        }
    });
    try {
        await page.goto(server.url);
        await page.evaluate(async () => {
            document.cookie = 'synthetic-session=keep; path=/';
            localStorage.setItem('theme', 'dark');
            await (await fetch('/api/sensitive')).text();
        });
        loggedIn = false;
        // Control proves the previous client really left a readable cache entry.
        expect(await page.evaluate(async () => (await fetch('/api/sensitive', { cache: 'force-cache' })).text()))
            .toBe('SYNTHETIC-LEGACY-DATA');
        expect(hits).toBe(1);
        // A subresource clears the cache without making the document wait.
        await page.evaluate(async () => { await (await fetch('/upgraded', { cache: 'no-store' })).text(); });
        expect(await page.evaluate(async () => (await fetch('/api/sensitive', { cache: 'force-cache' })).status)).toBe(401);
        expect(hits).toBe(2);
        expect(await page.evaluate(() => document.cookie)).toContain('synthetic-session=keep');
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    } finally { server.server.closeAllConnections(); server.server.close(); }
});

for (const outcome of ['success', 'failure']) {
    test(`slow cache cleanup does not block login and ${outcome === 'success' ? 'is not repeated' : 'retries after failure'}`, async ({ page }) => {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        let calls = 0;
        await mockEngine(page, { 'GET /users/current': { __status: 401 } });
        await page.route('**/webadmin/cache-reset', async route => {
            calls++;
            await held;
            await route.fulfill({ status: outcome === 'success' ? 204 : 503,
                headers: { 'Clear-Site-Data': '"cache"', 'Cache-Control': 'no-store', 'X-OIE-Cache-Migration': '1' } });
        });
        try {
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            await expect.poll(() => calls).toBe(1);
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            release();
            // Await the same migration promise so completion/failure is settled
            // before reloading; the shell must not have awaited it to render.
            await page.evaluate(async () => {
                const migration = await import(String('/core/cache-migration.js'));
                await migration.migrateLegacyCache().catch(() => {});
            });
            const beforeReload = calls;
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            if (outcome === 'success') expect(calls).toBe(beforeReload);
            else await expect.poll(() => calls).toBeGreaterThan(beforeReload);
        } finally { release(); }
    });
}
