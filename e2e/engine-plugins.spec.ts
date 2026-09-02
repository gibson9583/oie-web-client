import { test, expect } from './base.js';
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
    await expect.poll(() => page.evaluate(() => (window as any).__demoEngLoaded === true)).toBe(true);
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
    await expect.poll(() => page.evaluate(() => (window as any).__okLoaded === true)).toBe(true);
    await expect(page.getByRole('button', { name: 'Compatible Plugin' })).toBeVisible();
});

test('WAR mode authenticates engine plugin assets before importing them', async ({ page }) => {
    let manifestHeader = '';
    let moduleHeader = '';

    // The Node test server has a stricter script-src policy than OIE's WAR
    // context. Mirror the deployed WAR response here so Chromium can execute
    // the authenticated temporary module URL this test exists to exercise.
    await page.route('**/dashboard', async (route) => {
        const response = await route.fetch();
        const headers = response.headers();
        headers['content-security-policy'] = "frame-ancestors 'none'";
        await route.fulfill({ response, headers });
    });
    await page.route('**/webadmin/config.json', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ engines: [{ name: 'This OIE server' }], deployment: 'war' })
    }));
    await mockEngine(page, {
        // Force discovery through the extension endpoint used by a stock OIE
        // server rather than the optional engine-native endpoint.
        'GET /webplugins': { __status: 404 },
        'GET /extensions/websupport/webplugins': ['warplug'],
        'GET /extensions/websupport/webplugins/warplug/plugin.json': (req: any) => {
            manifestHeader = req.headers()['x-requested-with'] || '';
            return {
                id: 'war-plug', name: 'WAR Plugin', version: '1.0.0',
                client: { entry: 'web/plugin.js' }
            };
        }
    });
    await page.route('**/api/extensions/websupport/webplugins/warplug/web/plugin.js*', (route) => {
        moduleHeader = route.request().headers()['x-requested-with'] || '';
        return route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: "import { platform as sharedPlatform } from '@oie/web-shell'; export function register(platform){ window.__warPluginLoaded = sharedPlatform === platform; platform.registerNavItem({id:'war-plug',label:'WAR Plugin',icon:'puzzle',path:'/war-plug',section:'Plugins'}); }"
        });
    });

    await page.goto('/dashboard');

    await expect.poll(() => page.evaluate(() => (window as any).__warPluginLoaded === true)).toBe(true);
    expect(manifestHeader).toBe('OpenIntegrationEngine-WebAdmin');
    expect(moduleHeader).toBe('OpenIntegrationEngine-WebAdmin');
    await expect(page.getByRole('button', { name: 'WAR Plugin' })).toBeVisible();
});

// The WAR bakes a placeholder engine name into its static config (it cannot
// know its host at build time) — the status bar must replace it, never show it.
const warConfig = (page: any) => page.route('**/webadmin/config.json', (route: any) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ engines: [{ name: 'This OIE server' }], deployment: 'war' })
}));

test('WAR mode: the status bar shows the engine identity, not the placeholder', async ({ page }) => {
    await warConfig(page);
    await mockEngine(page);
    await page.goto('/dashboard');
    // The engine's own Environment - Server Name (public settings, as in the
    // Swing status bar) labels the connection.
    await expect(page.locator('.statusbar')).toContainText('Connected to: test - E2E Engine as admin');
    await expect(page.locator('.statusbar')).not.toContainText('This OIE server');
});

test('standalone: the engine identity is appended after the configured name', async ({ page }) => {
    // Pin the config name (the real one comes from the install's config.json,
    // which CI does not have) so the "name | identity" join is deterministic.
    await page.route('**/webadmin/config.json', (route: any) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ engines: [{ name: 'TEST' }] })
    }));
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.locator('.statusbar')).toContainText('Connected to: TEST | test - E2E Engine as admin');
});

test('WAR mode: the serving host stands in when the engine has no names', async ({ page }) => {
    await warConfig(page);
    await mockEngine(page, {
        'GET /server/publicSettings': { __status: 404 },
        'GET /server/settings': { __status: 403 }
    });
    await page.goto('/dashboard');
    // The page is served by the engine in WAR mode, so its host IS the engine.
    await expect(page.locator('.statusbar')).toContainText(/Connected to: (localhost|127\.0\.0\.1):\d+ as admin/);
    await expect(page.locator('.statusbar')).not.toContainText('This OIE server');
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
    // Deterministic settle point: the dashboard rows render only after boot,
    // and boot awaits loadPlugins() — so once they're visible, the plugin
    // phase is over and the assertions below can't race it.
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    // The incompatible plugin did NOT execute or register — the gate must skip
    // it BEFORE importing, so its code never runs.
    expect(await page.evaluate(() => (window as any).__newLoaded === true)).toBe(false);
    await expect(page.getByRole('button', { name: 'Too New Plugin' })).toHaveCount(0);
});

test('degrades cleanly when the engine has no /api/webplugins endpoint', async ({ page }) => {
    // Older engine: the endpoint is absent. mockEngine returns an empty body for
    // unmatched /api calls, so discovery yields nothing and the app loads normally.
    await mockEngine(page);
    await page.goto('/dashboard');
    // exact: the task pane's own header is a disclosure button named
    // "Dashboard Tasks", which a substring match also picks up.
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
});
