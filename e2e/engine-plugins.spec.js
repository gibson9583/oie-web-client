import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Engine-served web plugins (issue: multi-engine plugin delivery). The connected
 * engine exposes the browser half of its installed extensions under
 * /api/webplugins — a discovery list of extension paths, then each path's
 * plugin.json + assets. loadPlugins() (core/platform.js) fetches that set and
 * registers those plugins alongside the locally-bundled ones, so a plugin's UI
 * follows the engine it's installed on. This exercises that path end-to-end with
 * a tiny engine-served plugin module.
 */
test('loads and registers a plugin served by the engine over /api/webplugins', async ({ page }) => {
    await mockEngine(page, {
        // Discovery: one enabled extension ships a web half (its install-dir path).
        'GET /webplugins': ['demoeng'],
        // That extension's manifest (served raw by the engine, plain JSON).
        'GET /webplugins/demoeng/plugin.json': {
            id: 'demo-eng', name: 'Demo Engine Plugin', version: '1.0.0',
            client: { entry: 'web/plugin.js' }
        }
    });

    // The plugin's ES-module entry. Registered AFTER mockEngine so this specific
    // route wins, and with a real JavaScript MIME type — import() refuses to
    // execute a module served as text/plain (which the generic mock would use).
    // Trailing * matches the dev server's `?import` query (the real engine serves
    // the file with a JS MIME directly, no query).
    await page.route('**/api/webplugins/demoeng/web/plugin.js*', (route) => route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: "export function register(platform){ window.__demoEngLoaded = true; platform.registerNavItem({ id: 'demo-eng', label: 'Demo Engine Plugin', icon: 'puzzle', path: '/demo-eng', section: 'Plugins' }); }"
    }));

    await page.goto('/dashboard');

    // The module executed (import resolved @oie/* against the host import map).
    await expect.poll(() => page.evaluate(() => window.__demoEngLoaded === true)).toBe(true);
    // And its nav item is registered into the rail (user-visible proof).
    await expect(page.getByRole('button', { name: 'Demo Engine Plugin' })).toBeVisible();
});

test('loads an engine plugin that declares a compatible @oie apiMin', async ({ page }) => {
    await mockEngine(page, {
        'GET /webplugins': ['okplug'],
        'GET /webplugins/okplug/plugin.json': {
            id: 'ok-plug', name: 'Compatible Plugin', version: '1.0.0',
            oie: { apiMin: '4.6' }, client: { entry: 'web/plugin.js' }
        }
    });
    await page.route('**/api/webplugins/okplug/web/plugin.js*', (route) => route.fulfill({
        status: 200, contentType: 'text/javascript',
        body: "export function register(platform){ window.__okLoaded=true; platform.registerNavItem({id:'ok-plug',label:'Compatible Plugin',icon:'puzzle',path:'/ok-plug',section:'Plugins'}); }"
    }));
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => window.__okLoaded === true)).toBe(true);
    await expect(page.getByRole('button', { name: 'Compatible Plugin' })).toBeVisible();
});

test('skips (before import) an engine plugin that needs a newer @oie apiMin', async ({ page }) => {
    await mockEngine(page, {
        'GET /webplugins': ['newplug'],
        'GET /webplugins/newplug/plugin.json': {
            id: 'new-plug', name: 'Too New Plugin', version: '1.0.0',
            oie: { apiMin: '4.9' }, client: { entry: 'web/plugin.js' }
        }
    });
    // If the gate works, this module is never imported (its code never runs).
    await page.route('**/api/webplugins/newplug/web/plugin.js*', (route) => route.fulfill({
        status: 200, contentType: 'text/javascript',
        body: "export function register(platform){ window.__newLoaded=true; platform.registerNavItem({id:'new-plug',label:'Too New Plugin',icon:'puzzle',path:'/new-plug',section:'Plugins'}); }"
    }));
    await page.goto('/dashboard');
    // Give load a beat, then assert the incompatible plugin did NOT execute or register
    // — the gate must skip it BEFORE importing, so its code never runs.
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__newLoaded === true)).toBe(false);
    await expect(page.getByRole('button', { name: 'Too New Plugin' })).toHaveCount(0);
});

test('degrades cleanly when the engine has no /api/webplugins endpoint', async ({ page }) => {
    // Older engine: the endpoint is absent. mockEngine returns an empty body for
    // unmatched /api calls, so discovery yields nothing and the app loads normally.
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
});
