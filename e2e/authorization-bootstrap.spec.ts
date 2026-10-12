import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

// Exercise the real loader, authorization hook and shell with small engine-served
// providers. No engine installation/database is started by these regressions.
async function fixture(page: Page, overrides: Record<string, unknown> = {}) {
    await mockEngine(page, { 'GET /webplugins': [], ...overrides });
    await page.route('**/webadmin/plugins.json', route => route.fulfill({ json: [] }));
}

async function provider(page: Page, options: {
    id?: string; path?: string; authorization?: boolean; apiMin?: string;
    entry?: string | null; source?: string; importStatus?: number;
} = {}) {
    const path = options.path ?? 'rbac';
    await fixture(page, {
        'GET /webplugins': [path],
        [`GET /webplugins/${path}/plugin.json`]: {
            id: options.id ?? 'rbac', version: '1.0.0', authorization: options.authorization,
            oie: { apiMin: options.apiMin },
            client: { entry: options.entry === undefined ? 'web/plugin.js' : options.entry }
        }
    });
    await page.route(`**/api/webplugins/${path}/web/plugin.js*`, route => route.fulfill({
        status: options.importStatus ?? 200,
        contentType: 'text/javascript',
        body: options.source ?? 'export function register(p) { p.setAuthorizationController({ checkTask: () => true }); }'
    }));
}

async function permitted(page: Page) {
    const name = '@oie/web-shell';
    return page.evaluate(async moduleName => {
        const { platform } = await import(moduleName);
        return platform.checkTask('view', 'doShowDashboard');
    }, name);
}

async function expectBlocked(page: Page) {
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to load access controls' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
    await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toHaveCount(0);
    expect(await permitted(page)).toBe(false);
}

for (const mode of ['empty', 'missing'] as const) {
    test(`successful ${mode} discovery preserves engines without RBAC`, async ({ page }) => {
        await fixture(page, mode === 'missing' ? {
            'GET /webplugins': { __status: 404 },
            'GET /extensions/websupport/webplugins': { __status: 405 }
        } : {});
        await page.goto('/dashboard');
        if (mode === 'missing') {
            const warning = page.getByRole('dialog').filter({ hasText: 'The Web Support plugin is not installed' });
            await expect(warning).toBeVisible();
            await warning.locator('.btn-primary').click();
        }
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        expect(await permitted(page)).toBe(true);
    });
}

for (const endpoint of ['native', 'extension'] as const) {
    for (const failure of [403, 503, 'network'] as const) {
        test(`${endpoint} discovery ${failure} cannot start an unrestricted shell`, async ({ page }) => {
            const prefix = endpoint === 'native' ? '' : '/extensions/websupport';
            await fixture(page, {
                'GET /webplugins': { __status: 404 },
                [`GET ${prefix}/webplugins`]: { __status: failure === 'network' ? 503 : failure }
            });
            if (failure === 'network') await page.route(`**/api${prefix}/webplugins`, route => route.abort('failed'));
            await page.goto('/dashboard');
            await expectBlocked(page);
        });
    }
}

for (const failure of ['manifest-404', 'manifest-json', 'manifest-id', 'discovery-shape'] as const) {
    test(`an unknown plugin with ${failure} cannot conceal an authorization provider`, async ({ page }) => {
        await fixture(page, {
            'GET /webplugins': failure === 'discovery-shape' ? [42] : ['unidentified'],
            'GET /webplugins/unidentified/plugin.json': failure === 'manifest-404'
                ? { __status: 404 } : failure === 'manifest-json' ? '{invalid' : { id: false }
        });
        await page.goto('/dashboard');
        await expectBlocked(page);
    });
}

const criticalFailures = [
    { name: 'incompatible', apiMin: '999.0' },
    { name: 'no entry', entry: null },
    { name: 'module request failure', importStatus: 503 },
    { name: 'no register export', source: 'export const unrelated = true;' },
    { name: 'no controller', source: 'export function register() {}' },
    { name: 'null controller', source: 'export function register(p) { p.setAuthorizationController(null); }' },
    { name: 'invalid controller', source: 'export function register(p) { p.setAuthorizationController({}); }' },
    { name: 'throwing initialize', source: 'export function register(p) { p.setAuthorizationController({ checkTask: () => true, initialize() { throw new Error("init failed"); } }); }' },
    { name: 'throw before installing', source: 'export function register() { throw new Error("register failed"); }' },
    { name: 'throw after installing', source: 'export function register(p) { p.setAuthorizationController({ checkTask: () => true }); throw new Error("register failed"); }' }
];

for (const kind of ['known', 'declared'] as const) {
    for (const failure of criticalFailures) {
        test(`${kind} authorization provider: ${failure.name} blocks bootstrap`, async ({ page }) => {
            await provider(page, {
                ...(kind === 'declared' ? { id: 'custom-access', path: 'custom-access', authorization: true } : {}),
                ...failure
            });
            await page.goto('/dashboard');
            await expectBlocked(page);
        });
    }
}

test('a successfully installed controller still denies a throwing checkTask', async ({ page }) => {
    await provider(page, { source: 'export function register(p) { p.setAuthorizationController({ checkTask() { throw new Error("check failed"); } }); }' });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
    expect(await permitted(page)).toBe(false);
});

for (const failure of ['incompatible', 'no-entry', 'import', 'register', 'null-import', 'null-register'] as const) {
    test(`an ordinary plugin ${failure} failure does not disable access`, async ({ page }) => {
        await provider(page, {
            id: 'ordinary', path: 'ordinary',
            ...(failure === 'incompatible' ? { apiMin: '999.0' } : {}),
            ...(failure === 'no-entry' ? { entry: null } : {}),
            ...(failure === 'import' ? { importStatus: 503 } : {}),
            source: failure === 'null-import' ? 'throw null; export function register() {}'
                : failure === 'null-register' ? 'export function register() { throw null; }'
                : 'export function register() { throw new Error("ordinary failure"); }'
        });
        await page.goto('/dashboard');
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        expect(await permitted(page)).toBe(true);
    });
}

test('reload retries discovery and opens the shell only after it succeeds', async ({ page }) => {
    let available = false;
    await fixture(page, { 'GET /webplugins': () => available ? [] : { __status: 503 } });
    await page.goto('/dashboard');
    await expectBlocked(page);
    available = true;
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    expect(await permitted(page)).toBe(true);
});

test('concurrent and completed loadPlugins calls share one registration', async ({ page }) => {
    await provider(page, { source: `export async function register(p) {
        window.__registrations = (window.__registrations || 0) + 1;
        await new Promise(resolve => { window.__finishRegistration = resolve; });
        p.setAuthorizationController({ checkTask: () => true });
        p.registerNavItem({ id: 'once', label: 'Registered Once', path: '/once' });
    }` });
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => (window as any).__registrations)).toBe(1);
    expect(await permitted(page)).toBe(false);
    const before = await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { loadPlugins } = await import(name);
        const first = loadPlugins(), second = loadPlugins();
        (window as any).__pluginPromise = first;
        (window as any).__finishRegistration();
        return first === second;
    });
    expect(before).toBe(true);
    await expect(page.getByRole('button', { name: 'Registered Once', exact: true })).toHaveCount(1);
    expect(await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { loadPlugins } = await import(name);
        await loadPlugins();
        return { same: loadPlugins() === (window as any).__pluginPromise, registrations: (window as any).__registrations };
    })).toEqual({ same: true, registrations: 1 });
});

test('logout during delayed registration cannot reopen the prior session', async ({ page }) => {
    await provider(page, { source: `export async function register(p) {
        await new Promise(resolve => { window.__finishRegistration = resolve; });
        p.setAuthorizationController({ checkTask: () => true });
    }` });
    await page.goto('/dashboard');
    await expect.poll(() => page.evaluate(() => typeof (window as any).__finishRegistration)).toBe('function');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('admin');
    await page.locator('button.user-chip').click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await page.evaluate(() => (window as any).__finishRegistration());
    expect(await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { loadPlugins, platform } = await import(name);
        const outcome = await loadPlugins().then(() => 'loaded', () => 'rejected');
        return { outcome, allowed: platform.checkTask('view', 'doShowDashboard') };
    })).toEqual({ outcome: 'rejected', allowed: false });
    await expect(page.locator('input[type=password]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
});

test('session invalidation during plugin publication cannot release authorization', async ({ page }) => {
    await provider(page, { source: `export function register(p) {
        p.setAuthorizationController({ checkTask: () => true });
        p.store.subscribe('webPlugins', value => {
            if (Array.isArray(value)) p.store.setState('user', null);
        });
    }` });
    await page.goto('/dashboard');
    await expect(page.locator('input[type=password]')).toBeVisible();
    expect(await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { loadPlugins, platform } = await import(name);
        await loadPlugins().catch(() => {});
        return platform.checkTask('view', 'doShowDashboard');
    })).toBe(false);
});

for (const response of ['request-failure', 'malformed-list'] as const) {
    test(`bundled plugin discovery ${response} cannot bypass authorization`, async ({ page }) => {
        await fixture(page);
        await page.route('**/webadmin/plugins.json', route => route.fulfill(response === 'request-failure'
            ? { status: 503, body: 'Unavailable' } : { json: { unexpected: [] } }));
        await page.goto('/dashboard');
        await expectBlocked(page);
    });
}

test('a later plugin cannot clear the required authorization controller', async ({ page }) => {
    await fixture(page, {
        'GET /webplugins': ['rbac', 'ordinary'],
        'GET /webplugins/rbac/plugin.json': { id: 'rbac', client: { entry: 'web/plugin.js' } },
        'GET /webplugins/ordinary/plugin.json': { id: 'ordinary', client: { entry: 'web/plugin.js' } }
    });
    await page.route('**/api/webplugins/rbac/web/plugin.js*', route => route.fulfill({
        contentType: 'text/javascript',
        body: 'export function register(p) { p.setAuthorizationController({ checkTask: () => false }); }'
    }));
    await page.route('**/api/webplugins/ordinary/web/plugin.js*', route => route.fulfill({
        contentType: 'text/javascript', body: 'export function register(p) { p.setAuthorizationController(null); }'
    }));
    await page.goto('/dashboard');
    await expectBlocked(page);
});

test('bootstrap records the reload marker before awaiting shell configuration', async ({ page }) => {
    let configurations = 0;
    let release!: () => void;
    const heldConfiguration = new Promise<void>(resolve => { release = resolve; });
    await fixture(page);
    await page.route('**/webadmin/config.json', async route => {
        configurations++;
        if (configurations === 2) await heldConfiguration;
        await route.fulfill({ json: { engines: [{ name: 'Test Engine' }] } });
    });
    await page.goto('/dashboard');
    await expect.poll(() => configurations).toBeGreaterThanOrEqual(2);
    try {
        // While startEngine's config await is unresolved, another sign-in must
        // already know that this document cannot safely reuse its plugin state.
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('admin');
        await page.locator('button.user-chip').click();
        await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
        await expect(page.locator('input[type=password]')).toBeVisible();
    } finally { release(); }
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveCount(0);
});

test('same-user profile rename preserves permissions while a different user invalidates them', async ({ page }) => {
    await provider(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { platform } = await import(name);
        const user = platform.store.getState('user');
        // Edit Account refreshes this snapshot after saving the new username.
        platform.store.setState('user', { ...user, username: 'renamed-admin' });
        return platform.checkTask('view', 'doShowDashboard');
    })).toBe(true);
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    expect(await page.evaluate(async () => {
        const name = '@oie/web-shell';
        const { platform } = await import(name);
        platform.store.setState('user', { id: 99, username: 'another-user' });
        return platform.checkTask('view', 'doShowDashboard');
    })).toBe(false);
});
