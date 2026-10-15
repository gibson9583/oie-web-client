import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

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
    ...['/channels/new/guided'].flatMap(path => [
        [path, 'view', 'doShowChannel'], [path, 'channel', 'doNewChannel'],
    ]),
    ['/channels/new-channel/edit?new=1', 'view', 'doShowChannel'],
    ...['/alerts/new/guided'].flatMap(path => [
        [path, 'view', 'doShowAlerts'], [path, 'alert', 'doNewAlert'],
    ]),
    ['/alerts/new-alert/edit?new=1', 'view', 'doShowAlerts'],
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

/* Route/palette parity matrix:
 * - New drafts: actual classic creation and connector-editor handoff keep create
 *   permission and dirty protection; a query flag or mismatched draft cannot
 *   grant access to an existing object.
 * - New wizard aliases: canonical and decoded IDs require create, not edit.
 * - Commands: parent view AND action, at render and at activation.
 * - Templates: route AND catalog permission, for suggestions/search/recents,
 *   before fetch, after an in-flight fetch, and at activation.
 */
const editorFamilies = [
    { family: 'channels', kind: 'Channel', group: 'channel', parent: 'doShowChannel', create: 'doNewChannel', edit: 'doEditChannel' },
    { family: 'alerts', kind: 'Alert', group: 'alert', parent: 'doShowAlerts', create: 'doNewAlert', edit: 'doEditAlert' },
];

async function navigateWithinShell(page: Page, path: string) {
    await page.evaluate(async target => {
        const pkg = '@oie/web-shell';
        const { platform } = await import(pkg);
        await new Promise<void>(resolve => {
            window.addEventListener('route:changed', () => resolve(), { once: true });
            platform.router.navigate(target);
        });
    }, path);
}

async function openPalette(page: Page) {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    return page.locator('.cmdk-field input');
}

async function closePalette(page: Page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
}

const paletteOption = (page: Page, label: string) => page.locator('.cmdk-opt')
    .filter({ has: page.locator('.cmdk-label', { hasText: new RegExp('^' + label + '$') }) });
const hasUnsavedWork = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));

for (const { family, kind, group, create, edit } of editorFamilies) {
    test(`a real new ${kind} classic draft rechecks create permission before mounting`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, `window.__denyNewDraft && g==='${group}' && t==='${create}'`);
        await mockEngine(page);
        await page.goto(`/${family}`);
        await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
        const chooser = page.getByRole('dialog', { name: `New ${kind}`, exact: true });
        await expect(chooser).toBeVisible();
        const reads = await rejectProtectedReads(page);
        await page.evaluate(() => { (window as any).__denyNewDraft = true; });
        await chooser.getByText('Classic editor', { exact: true }).click();
        await expectDenied(page, errors);
        expect(reads).toEqual([]);
        // No editor ever mounted or set its dirty bit. The unsaved model still
        // needs tab-close protection solely from its trusted creation identity.
        expect(await page.evaluate(async family => {
            const pkg = '@oie/web-shell';
            return (await import(pkg)).platform.store.getState(family === 'channels' ? 'editingChannelDirty' : 'editingAlertDirty') === true;
        }, family)).toBe(false);
        expect(await hasUnsavedWork(page)).toBe(true);
    });

    for (const id of ['new', '%6eew']) {
        test(`${kind} wizard ${id} rejects a denied create action before protected reads`, async ({ page }) => {
            const errors = observeFailures(page);
            await installRbacPlugin(page, `g==='${group}'&&t==='${create}'`);
            await mockEngine(page);
            const reads = await rejectProtectedReads(page);
            await page.goto(`/${family}/${id}/guided`);
            await expectDenied(page, errors);
            expect(reads).toEqual([]);
        });

        test(`${kind} wizard ${id} permits creation when editing existing objects is denied`, async ({ page }) => {
            const errors = observeFailures(page);
            await installRbacPlugin(page, `g==='${group}'&&t==='${edit}'`);
            await mockEngine(page);
            await page.goto(`/${family}/${id}/guided`);
            await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
            await page.locator('.view-body input').first().fill('Create-only wizard');
            await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
            await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
            expect(errors).toEqual([]);
        });
    }

    for (const query of ['', '?new=1']) {
        test(`existing ${kind} ${query || 'without query'} cannot borrow create permission`, async ({ page }) => {
            const errors = observeFailures(page);
            await installRbacPlugin(page, `g==='${group}'&&t==='${edit}'`);
            await mockEngine(page);
            const reads = await rejectProtectedReads(page);
            await page.goto(`/${family}/existing/edit${query}`);
            await expectDenied(page, errors);
            expect(reads).toEqual([]);
        });
    }

    test(`an in-memory ${kind} draft cannot grant create permission to a different ID`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, `g==='${group}'&&(t==='${edit}'||(window.__denyNewDraft&&t==='${create}'))`);
        await mockEngine(page);
        await page.goto(`/${family}`);
        await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
        const chooser = page.getByRole('dialog', { name: `New ${kind}`, exact: true });
        await expect(chooser).toBeVisible();
        const reads = await rejectProtectedReads(page);
        // The creation factory seeds a trusted draft, but denying its first
        // mount leaves that model in memory without mounting an editor/guard.
        await page.evaluate(() => { (window as any).__denyNewDraft = true; });
        await chooser.getByText('Classic editor', { exact: true }).click();
        await expectDenied(page, errors);
        await page.evaluate(() => { (window as any).__denyNewDraft = false; });
        const retained = await retainedModel(page, family);
        const enterDifferent = () => page.evaluate(async family => {
            const pkg = '@oie/web-shell';
            (await import(pkg)).platform.router.navigate(`/${family}/different-existing/edit?new=1`);
        }, family);
        // The retained draft now has a shell leave guard too. Cancellation must
        // preserve it; consent discards it before the target's edit gate runs.
        await enterDifferent();
        const prompt = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
        await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(await retainedModel(page, family)).toEqual(retained);
        expect(reads).toEqual([]);
        await enterDifferent();
        await prompt.getByRole('button', { name: 'Discard Changes', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${family}/different-existing/edit\\?new=1$`));
        await expectDenied(page, errors);
        expect(reads).toEqual([]);
    });

    test(`${kind} classic creation and wizard handoff retain create-only access and the dirty guard`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, `g==='${group}'&&t==='${edit}'`);
        await mockEngine(page);
        await page.goto(`/${family}`);
        await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
        await page.getByRole('dialog', { name: `New ${kind}`, exact: true }).getByText('Classic editor', { exact: true }).click();
        const name = page.locator('.view-body input[type=text]').first();
        await name.fill('Create-only draft');
        await name.blur();
        await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
        await expect(page.locator('.view-body input').first()).toHaveValue('Create-only draft');
        await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
        await expect(name).toHaveValue('Create-only draft');
        expect(await hasUnsavedWork(page)).toBe(true);
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(name).toHaveValue('Create-only draft');
        expect(await hasUnsavedWork(page)).toBe(true);
        expect(errors).toEqual([]);
    });
}

for (const kind of ['Filter', 'Transformer']) {
    test(`a create-only channel draft returns from ${kind} with its name and dirty guard`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, "g==='channel'&&t==='doEditChannel'");
        await mockEngine(page);
        await page.goto('/channels');
        await page.getByRole('button', { name: 'New Channel', exact: true }).click();
        await page.getByRole('dialog', { name: 'New Channel', exact: true }).getByText('Classic editor', { exact: true }).click();
        const name = page.locator('.view-body input[type=text]').first();
        await name.fill(`New draft ${kind}`);
        await name.blur();
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        await page.getByRole('button', { name: `Edit ${kind}`, exact: true }).click();
        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
        await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await expect(name).toHaveValue(`New draft ${kind}`);
        expect(await hasUnsavedWork(page)).toBe(true);
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Unsaved Changes', exact: true });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(name).toHaveValue(`New draft ${kind}`);
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await dialog.getByRole('button', { name: "Don't Save", exact: true }).click();
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        expect(await hasUnsavedWork(page)).toBe(false);
        expect(errors).toEqual([]);
    });
}

for (const { family, kind, group, parent, create } of editorFamilies) {
    for (const [denyGroup, denyTask] of [['view', parent], [group, create]]) {
        test(`New ${kind} command rechecks ${denyGroup}/${denyTask} before rendering and activation`, async ({ page }) => {
            const errors = observeFailures(page);
            await installAuthorizationPlugin(page, `
                window.__deniedCommand = true;
                p.setAuthorizationController({ checkTask: (g,t) => !(window.__deniedCommand && g==='${denyGroup}' && t==='${denyTask}') });
            `);
            await mockEngine(page);
            await page.goto('/users');
            await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
            const command = paletteOption(page, `New ${kind} \\(Wizard\\)`);
            await (await openPalette(page)).fill(`>New ${kind}`);
            await expect(command).toHaveCount(0);
            await closePalette(page);
            await page.evaluate(() => { (window as any).__deniedCommand = false; });
            await (await openPalette(page)).fill(`>New ${kind}`);
            await expect(command).toHaveCount(1);
            // Revoke and click in one task; the entry must recheck rather than
            // trusting permissions captured by the already-rendered result.
            await command.evaluate(element => {
                (window as any).__deniedCommand = true;
                (element as HTMLElement).click();
            });
            await expect(page).toHaveURL(/\/users$/);
            await expect(page.locator('.cmdk')).toBeVisible();
            await closePalette(page);
            await openPalette(page);
            await expect(page.locator('.cmdk-opt[data-group="Recent"]')).toHaveCount(0);
            await closePalette(page);
            await page.evaluate(() => { (window as any).__deniedCommand = false; });
            await (await openPalette(page)).fill(`>New ${kind}`);
            await command.click();
            await expect(page).toHaveURL(new RegExp(`/${family}/new/guided\\?fresh=1$`));
            await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
            expect(errors).toEqual([]);
        });
    }
}

for (const { family, kind, group, edit } of editorFamilies) {
    for (const entry of ['palette', 'list']) {
        test(`New ${kind} from ${entry} starts fresh after a denied persisted-editor handoff`, async ({ page }) => {
            const errors = observeFailures(page);
            let reads = 0;
            await installRbacPlugin(page, `window.__denyExistingEdit && g==='${group}' && t==='${edit}'`);
            await mockEngine(page, {
                'GET /channels/persisted': () => {
                    reads++;
                    return { channel: { ...makeChannel('persisted'), name: 'Persisted channel' } };
                },
                'GET /alerts/persisted': () => {
                    reads++;
                    return { alertModel: { ...DEFAULT_FIXTURES['GET /alerts'].list.alertModel[0], id: 'persisted', name: 'Persisted alert' } };
                },
            });
            await page.goto(`/${family}/persisted/edit`);
            await expect(page.locator('.view-body input[type=text]').first()).toHaveValue(`Persisted ${kind.toLowerCase()}`);
            await page.evaluate(() => { (window as any).__denyExistingEdit = true; });
            await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
            await expectDenied(page, errors);
            // A real editor created the retained working model. New must not
            // resume it, nor use its edit mode to reject an allowed creator.
            expect(await page.evaluate(async family => {
                const pkg = '@oie/web-shell';
                return (await import(pkg)).platform.store.getState(family === 'channels' ? 'editingChannel' : 'editingAlert')?.id;
            }, family)).toBe('persisted');
            await navigateWithinShell(page, entry === 'palette' ? '/users' : `/${family}`);
            if (entry === 'palette') {
                await (await openPalette(page)).fill(`>New ${kind}`);
                await paletteOption(page, `New ${kind} \\(Wizard\\)`).click();
            } else {
                await page.getByRole('button', { name: `New ${kind}`, exact: true }).click();
                await page.getByRole('dialog', { name: `New ${kind}`, exact: true }).getByText('Wizard', { exact: true }).click();
            }
            await expect(page).toHaveURL(new RegExp(`/${family}/new/guided\\?fresh=1$`));
            await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
            await expect(page.locator('.view-body input').first()).toHaveValue('');
            await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toHaveCount(0);
            expect(reads).toBe(1);
            expect(errors).toEqual([]);
        });
    }
}

const rbacLibrary = {
    ...DEFAULT_FIXTURES['GET /codeTemplateLibraries'].list.codeTemplateLibrary[0],
    id: 'rbac-library', name: 'RBAC Library', enabledChannelIds: { string: 'c-started' },
    codeTemplates: { codeTemplate: [{
        ...DEFAULT_FIXTURES['GET /codeTemplateLibraries'].list.codeTemplateLibrary[0].codeTemplates.codeTemplate[0],
        id: 'rbac-helper', name: 'RBAC Helper',
    }] },
};
const rbacCatalog = { list: { codeTemplateLibrary: [rbacLibrary] } };

for (const [group, task] of [['channel', 'doEditCodeTemplates'], ['codeTemplate', 'doRefreshCodeTemplates']]) {
    test(`template ${group}/${task} gates suggestions, search, recents, catalog reads, and stale activation`, async ({ page }) => {
        const errors = observeFailures(page);
        let reads = 0;
        await installAuthorizationPlugin(page, `
            window.__deniedTemplates = true;
            p.setAuthorizationController({ checkTask: (g,t) => !(window.__deniedTemplates && g==='${group}' && t==='${task}') });
        `);
        await mockEngine(page, { 'GET /codeTemplateLibraries': () => { reads++; return rbacCatalog; } });
        await page.goto('/messages/c-started');
        await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeVisible();
        let query = await openPalette(page);
        await expect(paletteOption(page, 'RBAC Library')).toHaveCount(0);
        await expect(paletteOption(page, 'RBAC Helper')).toHaveCount(0);
        await query.fill('RBAC');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        expect(reads).toBe(0);
        await closePalette(page);
        await page.evaluate(() => { (window as any).__deniedTemplates = false; });
        await openPalette(page);
        await expect(paletteOption(page, 'RBAC Library')).toBeVisible();
        await expect(paletteOption(page, 'RBAC Helper')).toBeVisible();
        await paletteOption(page, 'RBAC Helper').evaluate(element => {
            (window as any).__deniedTemplates = true;
            (element as HTMLElement).click();
        });
        await expect(page).toHaveURL(/\/messages\/c-started$/);
        await expect(page.locator('.cmdk')).toBeVisible();
        await closePalette(page);
        await page.evaluate(() => { (window as any).__deniedTemplates = false; });
        query = await openPalette(page);
        await query.fill('RBAC Helper');
        await paletteOption(page, 'RBAC Helper').click();
        await expect(page).toHaveURL(/\/code-templates\?libraryId=rbac-library&templateId=rbac-helper$/);
        await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
        await navigateWithinShell(page, '/messages/c-started');
        await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeVisible();
        await openPalette(page);
        await expect(page.locator('.cmdk-opt[data-group="Recent"]', { hasText: 'RBAC Helper' })).toBeVisible();
        await closePalette(page);
        await page.evaluate(() => { (window as any).__deniedTemplates = true; });
        const beforeDeniedOpen = reads;
        query = await openPalette(page);
        await expect(page.locator('.cmdk-opt[data-group="Recent"]', { hasText: 'RBAC Helper' })).toHaveCount(0);
        await expect(paletteOption(page, 'RBAC Library')).toHaveCount(0);
        await expect(paletteOption(page, 'RBAC Helper')).toHaveCount(0);
        await query.fill('RBAC');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        expect(reads).toBe(beforeDeniedOpen);
        expect(errors).toEqual([]);
    });

    test(`revoking template ${group}/${task} while catalog loads cannot publish stale destinations`, async ({ page }) => {
        const errors = observeFailures(page);
        let reads = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await installRbacPlugin(page, `window.__deniedTemplates && g==='${group}' && t==='${task}'`);
        await mockEngine(page, { 'GET /codeTemplateLibraries': async () => { reads++; await gate; return rbacCatalog; } });
        try {
            await page.goto('/messages/c-started');
            await expect(page.getByRole('button', { name: 'Send Message', exact: true })).toBeVisible();
            const query = await openPalette(page);
            await expect.poll(() => reads).toBe(1);
            await page.evaluate(() => { (window as any).__deniedTemplates = true; });
            const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/codeTemplateLibraries');
            release();
            await (await response).finished();
            await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
            await expect(paletteOption(page, 'RBAC Library')).toHaveCount(0);
            await expect(paletteOption(page, 'RBAC Helper')).toHaveCount(0);
            await query.fill('RBAC');
            await expect(page.locator('.cmdk-opt')).toHaveCount(0);
            await closePalette(page);
            await openPalette(page);
            await expect(paletteOption(page, 'RBAC Helper')).toHaveCount(0);
            expect(reads).toBe(1);
            expect(errors).toEqual([]);
        } finally { release(); }
    });
}

const retainedDraftHandoffs = [
    { family: 'channels', kind: 'Channel', child: 'Filter', segment: 'filter/0', module: 'filter-transformer', group: 'channelEdit', task: 'doEditFilter' },
    { family: 'channels', kind: 'Channel', child: 'Wizard', segment: 'guided', module: 'channel-wizard', group: 'channel', task: 'doEditChannel' },
    { family: 'alerts', kind: 'Alert', child: 'Wizard', segment: 'guided', module: 'alert-wizard', group: 'alert', task: 'doEditAlert' },
];
const retainedDraftFixtures = {
    'GET /channels/retained': { channel: { ...makeChannel('retained'), name: 'Saved channel' } },
    'GET /alerts/retained': { alertModel: {
        '@version': '4.6.0', id: 'retained', name: 'Saved alert', enabled: true,
        trigger: {
            '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] },
            alertChannels: { newChannelSource: false, newChannelDestination: false, enabledChannels: null, disabledChannels: null, partialChannels: null },
        },
        actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] }, properties: null,
    } },
};

test('successful existing Alert wizard save clears retained draft protection before returning to the list', async ({ page }) => {
    const errors = observeFailures(page);
    let writes = 0;
    await mockEngine(page, {
        ...retainedDraftFixtures,
        'PUT /alerts/retained': (request: Request) => {
            writes++;
            expect(request.postDataJSON().alertModel.name).toBe('Saved wizard edit');
            return '';
        },
    });
    await page.goto('/alerts/retained/guided');
    await page.locator('.view-body input[type=text]').first().fill('Saved wizard edit');
    await page.getByRole('button', { name: 'Save Alert', exact: true }).first().click();
    await expect(page).toHaveURL(/\/alerts$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await hasUnsavedWork(page)).toBe(false);
    expect(writes).toBe(1);
    expect(errors).toEqual([]);
});
async function retainedModel(page: Page, family: string) {
    return page.evaluate(async family => {
        const pkg = '@oie/web-shell';
        const model = (await import(pkg)).platform.store.getState(family === 'channels' ? 'editingChannel' : 'editingAlert');
        return model ? { id: model.id, name: model.name } : null;
    }, family);
}
async function openRetainedHandoff(page: Page, child: string, deniedPath?: string) {
    if (child === 'Filter') {
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
    }
    const action = page.getByRole('button', { name: child === 'Filter' ? 'Edit Filter' : 'Open in Wizard', exact: true });
    await expect(action).toBeVisible();
    if (deniedPath) {
        const sourceUrl = page.url();
        const original = child === 'Filter' ? await retainedModel(page, 'channels') : null;
        // Render while permitted, then revoke without notifying React. Tagged
        // task buttons must reject this stale click at action time.
        await action.evaluate(element => {
            (window as any).__denyHandoff = true;
            (element as HTMLElement).click();
        });
        if (child === 'Filter') {
            await expect(page).toHaveURL(sourceUrl);
            await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            expect(await retainedModel(page, 'channels')).toEqual(original);
            expect(await hasUnsavedWork(page)).toBe(true);
            // History, bookmarks and plugin navigation can still request the
            // denied URL. Exercise the independent route gate and retained-draft
            // protection without weakening the blocked task-button behavior.
            await navigateWithinShell(page, deniedPath);
        }
    } else await action.click();
}

for (const { family, kind, child, segment, module, group, task } of retainedDraftHandoffs) {
    for (const timing of ['denied before import', 'revoked during import', 'replacement during import']) {
        test(`retained dirty ${kind} ${child} ${timing} requires cancel or discard before New`, async ({ page }) => {
            const errors = observeFailures(page);
            const writes: string[] = [];
            let held = false;
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            await installRbacPlugin(page, `window.__denyHandoff && g==='${group}' && t==='${task}'`);
            await mockEngine(page, retainedDraftFixtures);
            page.on('request', request => {
                if (/^\/api\/(?:channels|alerts)(?:\/|$)/.test(new URL(request.url()).pathname)
                    && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + request.url());
            });
            if (timing !== 'denied before import') {
                await page.route(`**/assets/${module}-*.js`, async route => {
                    held = true;
                    await gate;
                    await route.continue();
                });
            }
            try {
                await page.goto(`/${family}/retained/edit`);
                const name = page.locator('.view-body input[type=text]').first();
                await name.fill('Keep this retained draft');
                await name.blur();
                const handoffPath = `/${family}/retained/${segment}`;
                await openRetainedHandoff(page, child, timing === 'denied before import' ? handoffPath : undefined);
                await expect(page).toHaveURL(new RegExp(handoffPath + '$'));
                if (timing !== 'denied before import') await expect.poll(() => held).toBe(true);
                if (timing === 'revoked during import') {
                    await page.evaluate(() => { (window as any).__denyHandoff = true; });
                    release();
                }
                if (timing !== 'replacement during import') await expectDenied(page, errors);
                await expect.poll(() => hasUnsavedWork(page)).toBe(true);
                expect(await retainedModel(page, family)).toEqual({ id: 'retained', name: 'Keep this retained draft' });

                await (await openPalette(page)).fill(`>New ${kind}`);
                await paletteOption(page, `New ${kind} \\(Wizard\\)`).click();
                const dialog = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
                await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
                await expect(page).toHaveURL(new RegExp(handoffPath + '$'));
                expect(await retainedModel(page, family)).toEqual({ id: 'retained', name: 'Keep this retained draft' });
                expect(await hasUnsavedWork(page)).toBe(true);
                if (timing === 'replacement during import') {
                    // Cancel supersedes the original lazy navigation. Its
                    // accepted target must resume after the chunk finishes,
                    // rather than leaving an empty outlet behind the same URL.
                    release();
                    await expect(page.getByRole('button', { name: child === 'Filter' ? 'Back to Channel' : 'Next', exact: true })).toBeVisible();
                    if (child === 'Wizard') await expect(page.locator('.view-body input').first()).toHaveValue('Keep this retained draft');
                    expect(await retainedModel(page, family)).toEqual({ id: 'retained', name: 'Keep this retained draft' });
                    expect(await hasUnsavedWork(page)).toBe(true);
                }

                await (await openPalette(page)).fill(`>New ${kind}`);
                await paletteOption(page, `New ${kind} \\(Wizard\\)`).click();
                // A resumed editor owns its ordinary guard again; denied
                // targets continue to use the shell's retained-draft guard.
                const discardLabel = timing === 'replacement during import'
                    ? child === 'Filter' ? "Don't Save" : 'Discard'
                    : 'Discard Changes';
                await page.getByRole('dialog').getByRole('button', { name: discardLabel, exact: true }).click();
                release();
                await expect(page).toHaveURL(new RegExp(`/${family}/new/guided\\?fresh=1$`));
                await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
                await expect(page.locator('.view-body input').first()).toHaveValue('');
                expect((await retainedModel(page, family))?.id).not.toBe('retained');
                expect(writes).toEqual([]);
                expect(errors).toEqual([]);
            } finally { release(); }
        });
    }

    test(`retained dirty ${kind} resumes the same editor after denied ${child} access recovers`, async ({ page }) => {
        const errors = observeFailures(page);
        await installRbacPlugin(page, `window.__denyHandoff && g==='${group}' && t==='${task}'`);
        await mockEngine(page, retainedDraftFixtures);
        await page.goto(`/${family}/retained/edit`);
        const name = page.locator('.view-body input[type=text]').first();
        await name.fill('Resume this retained draft');
        await name.blur();
        await openRetainedHandoff(page, child, `/${family}/retained/${segment}`);
        await expectDenied(page, errors);
        await page.evaluate(() => { (window as any).__denyHandoff = false; });
        await navigateWithinShell(page, `/${family}/retained/edit`);
        if (kind === 'Channel') await page.getByRole('tab', { name: 'Summary', exact: true }).click();
        await expect(name).toHaveValue('Resume this retained draft');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(await hasUnsavedWork(page)).toBe(true);
        expect(errors).toEqual([]);
    });
}
