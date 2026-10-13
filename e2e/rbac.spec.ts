import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * Authorization is enforced before a built-in view mounts as well as in the
 * rail/task controls. Deep links must not start a denied view's API reads.
 */
async function installAuthorizationPlugin(page: Page, registerBody: string) {
    // Keep the actual bundled plugins: their settings panels participate in RBAC.
    await page.route('**/webadmin/plugins.json', async route => {
        const resp = await route.fetch();
        const manifests = await resp.json();
        manifests.push({ id: 'test-rbac', version: '1.0.0', entry: '/plugins/test-rbac/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    await page.route('**/plugins/test-rbac/entry.js*', route => route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: `export async function register(p){ ${registerBody} }`,
    }));
}

async function installRbacPlugin(page: Page, denyExpr: string) {
    await installAuthorizationPlugin(page, `p.setAuthorizationController({ checkTask:(g,t)=> !(${denyExpr}) });`);
}

const protectedReads = /^\/api\/(?:channels(?:\/|$)|channelgroups(?:\/|$)|alerts(?:\/|$)|events(?:\/|$)|users$|codeTemplate(?:s|Libraries)(?:\/|$)|server\/(?:settings|channelTags|channelDependencies|channelMetadata|globalScripts|resources|configurationMap)$|extensions\/(?:connectors|plugins|Data%20Pruner|datapruner)(?:\/|$))/;

function observeFailures(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

async function rejectProtectedReads(page: Page, paths = protectedReads) {
    const reads: string[] = [];
    // The forbidden APIs answer 403 if a regression mounts the protected view.
    // Checking the requests also detects a hidden transient mount before denial.
    await page.route('**/api/**', async route => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        if (req.method() !== 'GET' || !paths.test(path)) return route.fallback();
        reads.push(path);
        await route.fulfill({ status: 403, contentType: 'text/plain', body: 'Missing permission: test protected resource' });
    });
    return reads;
}

async function expectDenied(page: Page, errors: string[], message = "You don't have permission to view this page. Contact your administrator if you need access.") {
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Access denied' })).toContainText(message);
    await expect(page.locator('.shell')).toBeVisible();
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('button.user-chip')).toBeVisible();
    await expect(page.locator('.view-error')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
}

// Every route family and each independently denied prerequisite. Child views
// must require their parent permission even when their own action is allowed.
const deniedRoutes = [
    ['/dashboard', 'view', 'doShowDashboard', 'Dashboard'],
    ['/channels', 'view', 'doShowChannel', 'Channels'],
    ['/messages', 'view', 'doShowMessages', 'Messages'],
    ['/events', 'view', 'doShowEvents', 'Events'],
    ['/alerts', 'view', 'doShowAlerts', 'Alerts'],
    ['/users', 'view', 'doShowUsers', 'Users'],
    ['/settings?tab=server', 'view', 'doShowSettings', 'Settings'],
    ['/extensions', 'view', 'doShowExtensions', 'Extensions'],
    ['/code-templates', 'channel', 'doEditCodeTemplates', 'Code Templates'],
    ['/global-scripts', 'channel', 'doEditGlobalScripts', 'Global Scripts'],
    ['/messages/c-started', 'view', 'doShowMessages'],
    ...['edit', 'guided', 'filter/0', 'transformer/0', 'response/1'].map(path => [`/channels/c-started/${path}`, 'view', 'doShowChannel']),
    ...['edit', 'guided'].map(path => [`/channels/c-started/${path}`, 'channel', 'doEditChannel']),
    ['/channels/c-started/filter/0', 'channelEdit', 'doEditFilter'],
    ['/channels/c-started/transformer/0', 'channelEdit', 'doEditTransformer'],
    ['/channels/c-started/response/1', 'channelEdit', 'doEditResponseTransformer'],
    ...['edit', 'guided'].map(path => [`/alerts/al-1/${path}`, 'view', 'doShowAlerts']),
    ...['edit', 'guided'].map(path => [`/alerts/al-1/${path}`, 'alert', 'doEditAlert']),
    ...['/channels/new/guided', '/channels/new-channel/edit?new=1'].flatMap(path => [
        [path, 'view', 'doShowChannel'], [path, 'channel', 'doNewChannel'],
    ]),
    ...['/alerts/new/guided', '/alerts/new-alert/edit?new=1'].flatMap(path => [
        [path, 'view', 'doShowAlerts'], [path, 'alert', 'doNewAlert'],
    ]),
];

for (const [path, group, task, nav] of deniedRoutes) {
    test(`direct ${path} denies ${group}/${task} before protected reads`, async ({ page }, testInfo) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, `g===${JSON.stringify(group)}&&t===${JSON.stringify(task)}`);
        await mockEngine(page);
        const reads = await rejectProtectedReads(page);
        await page.goto(path);
        await expectDenied(page, errors);
        if (nav) await expect(page.getByRole('button', { name: nav, exact: true })).toHaveCount(0);
        expect(reads).toEqual([]);
        if (path === '/dashboard' && testInfo.project.name === 'ui') {
            const desktop = testInfo.outputPath('access-denied-desktop.png');
            await page.screenshot({ path: desktop });
            await testInfo.attach('access-denied-desktop', { path: desktop, contentType: 'image/png' });
            await page.setViewportSize({ width: 375, height: 812 });
            await page.reload();
            await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            const mobile = testInfo.outputPath('access-denied-mobile.png');
            await page.screenshot({ path: mobile });
            await testInfo.attach('access-denied-mobile', { path: mobile, contentType: 'image/png' });
            expect(reads).toEqual([]);
        }
    });
}

test('an allowed dashboard still hides a denied dashboard task', async ({ page }) => {
    await installRbacPlugin(page, "g==='dashboard'&&t==='doRefreshStatuses'");
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks).toBeVisible();
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toHaveCount(0);
});

test('denied routes preserve navigation and back/forward through allowed pages', async ({ page }) => {
    const errors = observeFailures(page);
    await installRbacPlugin(page, "g==='view'&&t==='doShowDashboard'");
    await mockEngine(page);
    const reads = await rejectProtectedReads(page, /^\/api\/channels\/statuses$/);
    await page.goto('/dashboard');
    await expectDenied(page, errors);
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectDenied(page, errors);
    await page.goForward();
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
    expect(reads).toEqual([]);
    expect(errors).toEqual([]);
});

for (const path of ['/settings', '/settings?tab=server']) {
    test(`${path} with no permitted settings sections remains usable`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, "g.startsWith('settings_')");
        await mockEngine(page);
        const reads = await rejectProtectedReads(page, /^\/api\/(?:server\/(?:settings|channelTags|resources|configurationMap)$|extensions\/(?:Data%20Pruner|datapruner)(?:\/|$))/);
        await page.goto(path);
        await expectDenied(page, errors, 'No settings sections are available with your current permissions. Contact your administrator if you need access.');
        await expect(page.getByRole('tab')).toHaveCount(0);
        await expect(page.locator('.rail-pane', { hasText: 'Server Tasks' })).toHaveCount(0);
        expect(reads).toEqual([]);
        // The empty settings page must not leave an unsaved-work guard behind.
        await page.getByRole('button', { name: 'Users', exact: true }).click();
        await expect(page).toHaveURL(/\/users$/);
        await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}

test('a failed asynchronous permission load fails closed and reload can recover', async ({ page }) => {
    const errors = observeFailures(page);
    let requested = false;
    let fail = true;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await installAuthorizationPlugin(page, `
        let allowed = false;
        try { await p.api.get('/extensions/test-rbac/permissions'); allowed = true; } catch {}
        p.setAuthorizationController({ checkTask: () => allowed });
    `);
    await mockEngine(page, {
        'GET /extensions/test-rbac/permissions': async () => {
            requested = true;
            await gate;
            return fail ? { __status: 503 } : { allowed: true };
        },
    });
    const reads: string[] = [];
    page.on('request', req => {
        if (req.method() === 'GET' && protectedReads.test(new URL(req.url()).pathname)) reads.push(req.url());
    });
    try {
        await page.goto('/settings');
        await expect.poll(() => requested).toBe(true);
        await expect(page.getByRole('tab')).toHaveCount(0);
        expect(reads).toEqual([]);
        release();
        await expectDenied(page, errors);
        await expect(page.getByRole('tab')).toHaveCount(0);
        for (const label of ['Dashboard', 'Channels', 'Settings', 'Code Templates', 'Global Scripts']) {
            await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
        }
        expect(reads).toEqual([]);
        fail = false;
        await page.reload();
        await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally { release(); }
});

test('permissions revoked while a view module loads are checked again before mounting', async ({ page }) => {
    const errors = observeFailures(page);
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await installRbacPlugin(page, "window.__denyScripts&&g==='channel'&&t==='doEditGlobalScripts'");
    await mockEngine(page);
    const reads = await rejectProtectedReads(page, /^\/api\/server\/globalScripts$/);
    await page.route('**/assets/global-scripts-*.js', async route => {
        held = true;
        await gate;
        await route.continue();
    });
    try {
        await page.goto('/settings');
        await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Global Scripts', exact: true }).click();
        await expect.poll(() => held).toBe(true);
        await page.evaluate(() => { (window as any).__denyScripts = true; });
        release();
        await expectDenied(page, errors);
        expect(reads).toEqual([]);
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
        await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
        expect(errors).toEqual([]);
    } finally { release(); }
});

test('a denied navigation supersedes an allowed view whose module is still loading', async ({ page }) => {
    const errors = observeFailures(page);
    let held = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await installRbacPlugin(page, "g==='view'&&t==='doShowEvents'");
    await mockEngine(page);
    const reads = await rejectProtectedReads(page, /^\/api\/(?:server\/globalScripts|events(?:\/.*)?)$/);
    await page.route('**/assets/global-scripts-*.js', async route => {
        const response = await route.fetch();
        held = true;
        await gate;
        await route.fulfill({ response, body: await response.text() + '\nwindow.__scriptsModuleReleased = true;' });
    });
    try {
        await page.goto('/settings');
        await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Global Scripts', exact: true }).click();
        await expect.poll(() => held).toBe(true);
        await page.evaluate(async () => {
            const pkg = '@oie/web-shell';
            (await import(pkg)).platform.router.navigate('/events');
        });
        await expectDenied(page, errors);
        release();
        await expect.poll(() => page.evaluate(() => (window as any).__scriptsModuleReleased)).toBe(true);
        await expect(page).toHaveURL(/\/events$/);
        await expectDenied(page, errors);
        await expect(page.locator('.rail-pane', { hasText: 'Script Tasks' })).toHaveCount(0);
        expect(reads).toEqual([]);
        await page.getByRole('button', { name: 'Users', exact: true }).click();
        await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(errors).toEqual([]);
    } finally { release(); }
});

test('an unsaved editor can cancel and then discard before entering a denied route', async ({ page }) => {
    const errors = observeFailures(page);
    const writes: string[] = [];
    await installRbacPlugin(page, "g==='view'&&t==='doShowEvents'");
    await mockEngine(page, {
        'GET /channels/guarded': { channel: makeChannel('guarded') },
    });
    const reads = await rejectProtectedReads(page, /^\/api\/events(?:\/|$)/);
    page.on('request', req => {
        if (new URL(req.url()).pathname.startsWith('/api/channels') && !['GET', 'HEAD'].includes(req.method())) writes.push(req.method());
    });
    const enterDenied = () => page.evaluate(async () => {
        const pkg = '@oie/web-shell';
        (await import(pkg)).platform.router.navigate('/events');
    });
    await page.goto('/channels/guarded/edit');
    const name = page.locator('.view-body input[type=text]').first();
    await name.fill('Keep until discarded');
    await name.blur();
    await enterDenied();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/channels\/guarded\/edit$/);
    await expect(name).toHaveValue('Keep until discarded');
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
    expect(reads).toEqual([]);
    await enterDenied();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: "Don't Save", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    await expectDenied(page, errors);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
});

test('a denied channel task is not offered through the command palette either', async ({ page }) => {
    // Deny the channel-edit and message-browser view tasks. Hiding the taskbar
    // buttons is not enough — the palette builds its own channel entries, and
    // it must apply the same checkTask gate (#22).
    await installRbacPlugin(page, "g==='view'&&(t==='doShowChannel'||t==='doShowMessages')");
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.locator('.cmdk-field input').fill('#demo');
    // The channel exists (the dashboard just listed it), but a role denied both
    // channel tasks gets no channel entries offered.
    await expect(page.locator('.cmdk-scope')).toHaveText('Channels');
    await expect(page.locator('.cmdk-opt')).toHaveCount(0);
});

test('a forbidden settings deep link falls back to a permitted tab', async ({ page }) => {
    // A Viewer-style role: every built-in settings tab denied except
    // Administrator, which is the user's own preferences and is never gated.
    // Built-in tabs used to be appended unconditionally, so the Server tab
    // rendered for everyone and its first request came back as an error dialog
    // reading "Missing permission: viewServerSettings" — the engine gates each
    // tab, and the RBAC plugin maps every built-in tab's tasks.
    await installRbacPlugin(page,
        "g.startsWith('settings_') && g!=='settings_Administrator' && !(g==='settings_Tags'&&t==='doRefresh')");
    await mockEngine(page);
    const forbiddenReads = await rejectProtectedReads(page, /^\/api\/server\/settings$/);
    await page.goto('/settings?tab=server');

    // Administrator opens first, and nothing errored.
    await expect(page.getByRole('tab', { name: 'Administrator' })).toBeVisible();
    await expect(page.getByText('Dashboard refresh interval')).toBeVisible();
    await expect(page.getByText(/Missing permission/)).toHaveCount(0);
    for (const hidden of ['Server', 'Configuration Map', 'Database Tasks', 'Resources']) {
        await expect(page.getByRole('tab', { name: hidden })).toHaveCount(0);
    }
    // View-only (doRefresh allowed, doSave denied) keeps the tab, read-only, like Swing.
    await expect(page.getByRole('tab', { name: 'Tags' })).toBeVisible();
    await page.getByRole('tab', { name: 'Tags' }).click();
    const tasks = page.locator('.rail-pane', { hasText: 'Tag Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    for (const action of ['Save', 'Add Tag']) {
        await expect(tasks.getByRole('button', { name: action, exact: true })).toHaveCount(0);
    }
    // Administrator reads the optional server-default background color once.
    // Its 403 is tolerated; the forbidden Server tab must never mount (which
    // would issue an additional settings read and display an error dialog).
    expect(forbiddenReads).toEqual(['/api/server/settings']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.view-error')).toHaveCount(0);
});

test('a plugin settings panel remains available when all built-in tabs are denied', async ({ page }) => {
    const errors = observeFailures(page);
    await installRbacPlugin(page, "g.startsWith('settings_')&&!(g==='settings_Data Pruner'&&t==='doRefresh')");
    await mockEngine(page, {
        'GET /extensions/Data%20Pruner/properties': { properties: { property: [
            { '@name': 'pruningBlockSize', $: '1000' },
        ] } },
        'GET /extensions/datapruner/status': {},
    });
    await page.goto('/settings?tab=server');
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Data Pruner', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.field', { has: page.getByText('Block Size', { exact: true }) }).locator('input').first()).toHaveValue('1000');
    const tasks = page.locator('.rail-pane', { hasText: 'Data Pruner Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('signing in again in the same tab gets a fresh page', async ({ page }) => {
    // Plugins — and the RBAC controller's permission set with them — load once
    // per page. A soft sign-out followed by a sign-in used to run the new
    // session under the stale set: an administrator signing in after a viewer
    // got a view-only Settings page, and a role re-synced at sign-in (which the
    // OIDC extension does every time) went unseen until a manual reload. Any
    // sign-in after plugins have loaded now reloads, exactly as a different
    // engine does; only the first sign-in of a page session takes the soft path.
    let who: string | null = null;
    await mockEngine(page, {
        'GET /users/current': () => (who ? { user: { id: who === 'admin' ? 1 : 2, username: who } } : { __status: 401 }),
        'POST /users/_login': (req: any) => { who = new URLSearchParams(req.postData() || '').get('username'); return { status: 'SUCCESS' }; },
        'POST /users/_logout': () => { who = null; return ''; },
    });
    await page.goto('/');
    await login(page, 'admin', 'admin');
    await expect(page.locator('.statusbar')).toContainText('as admin');
    // The marker lands once the plugins have loaded, a beat after the shell shows.
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('admin');

    // A marker that only survives if the page is NOT reloaded.
    await page.evaluate(() => { (window as any).__softPath = true; });
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await login(page, 'viewer', 'x');
    await expect(page.locator('.statusbar')).toContainText('as viewer');
    expect(await page.evaluate(() => (window as any).__softPath), 'a different user must get a fresh page').toBeUndefined();
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('viewer');

    // The SAME user signing back in reloads too: the engine may have re-synced
    // their role at that sign-in, and the page's permission set would not know.
    await page.evaluate(() => { (window as any).__softPath = true; });
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page.locator('input[type=password]')).toBeVisible();
    await login(page, 'viewer', 'x');
    await expect(page.locator('.statusbar')).toContainText('as viewer');
    expect(await page.evaluate(() => (window as any).__softPath), 'a re-sign-in by the same user must also get a fresh page').toBeUndefined();
});

test('with no RBAC controller, the Dashboard nav and Refresh task are visible', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    const tasks = page.locator('.rail-pane', { hasText: 'Dashboard Tasks' });
    await expect(tasks.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
});
