import { test, expect } from './base.js';
import { listen } from './server-harness.js';
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

test('the shell cache policy evicts legacy responses without removing sign-in or preferences', async ({ page, request }) => {
    // Use the real shell's headers on an origin simulating an older WAR. This
    // origin must be separate: the current Node proxy already forces no-store.
    const shell = await request.get('/');
    const headers = shell.headers();
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
        await page.goto(server.url + '/upgraded');
        expect(await page.evaluate(async () => (await fetch('/api/sensitive', { cache: 'force-cache' })).status)).toBe(401);
        expect(hits).toBe(2);
        expect(await page.evaluate(() => document.cookie)).toContain('synthetic-session=keep');
        expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
    } finally { server.server.closeAllConnections(); server.server.close(); }
});
