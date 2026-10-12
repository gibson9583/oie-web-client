import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

/*
 * Command palette (⌘K / Ctrl+K). What is pinned here is the behaviour that makes
 * it trustworthy rather than merely present: it reads the SAME registries the
 * rail and task panes read, it filters through the same RBAC check, a leading
 * character scopes the search, and running an entry actually navigates.
 */

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

const open = async (page: any) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
};

test('opens on the shortcut, closes on Escape, and returns focus', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    await open(page);
    // The field takes focus, not the first result — typing is the point.
    await expect(page.locator('.cmdk-field input')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
});

test('finds views, and a deep-linked settings section, by subsequence', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await open(page);

    // The views come from platform.navItems() — the rail's own list.
    await page.locator('.cmdk-field input').fill('chan');
    await expect(page.locator('.cmdk-opt', { hasText: 'Channels' }).first()).toBeVisible();

    /* "prune" reaches a Settings TAB, not just the Settings view: the sections are
       registered as commands with their own deep links. */
    await page.locator('.cmdk-field input').fill('prune');
    await expect(page.locator('.cmdk-opt')).toHaveCount(1);
    await expect(page.locator('.cmdk-opt').first()).toContainText('Data Pruner');

    // Matched characters are marked, so the ranking shows its working.
    await expect(page.locator('.cmdk-opt b').first()).toBeVisible();
});

test('a prefix scopes the search', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await open(page);

    await page.locator('.cmdk-field input').fill('#demo');
    await expect(page.locator('.cmdk-scope')).toHaveText('Channels');
    const labels = await page.locator('.cmdk-opt .cmdk-label').allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /demo/i.test(l))).toBe(true);

    await page.locator('.cmdk-field input').fill('/set');
    await expect(page.locator('.cmdk-scope')).toHaveText('Views');
    await expect(page.locator('.cmdk-opt').first()).toContainText('Settings');
});

test('running an entry navigates and is remembered as recent', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    await open(page);
    await page.locator('.cmdk-field input').fill('/events');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events/);
    await expect(page.locator('.cmdk')).toHaveCount(0);

    // Reopening with an empty query leads with what was just run.
    await open(page);
    await expect(page.locator('.cmdk-group').first()).toHaveText('Recent');
    await expect(page.locator('.cmdk-opt').first()).toContainText('Events');
});

test('arrow keys move the selection and only one option is selected', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await open(page);
    await page.locator('.cmdk-field input').fill('set');

    const selected = page.locator('.cmdk-opt[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const first = await selected.textContent();

    await page.keyboard.press('ArrowDown');
    await expect(selected).toHaveCount(1);
    expect(await selected.textContent()).not.toBe(first);

    await page.keyboard.press('ArrowUp');
    expect(await selected.textContent()).toBe(first);
});

test('the palette offers exactly the rail\'s items, not a parallel list', async ({ page }) => {
    /* The authorization guarantee, stated as something observable. Both read
       platform.navItems() and both filter through the same checkTask(), so the
       sets must be identical — if the palette ever grew its own list, or skipped
       the RBAC filter, this is where it would show up. (The suite's fixtures
       permit every task, so denying one is not expressible here; what can be
       pinned is that there is one source, not two.) */
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    const railItems = page.locator('.rail-nav [data-nav-item] .rail-label, .rail-nav [data-nav-item] span');
    // The shell frame can mount before its navigation registry renders.
    await expect(railItems.first()).toBeVisible();
    const railLabels = await railItems
        .evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()).filter(Boolean))].sort());

    await open(page);
    await page.locator('.cmdk-field input').fill('/');          // every view, unfiltered
    const paletteLabels = await page.locator('.cmdk-opt .cmdk-label')
        .evaluateAll((els) => els.map((e) => e.textContent.trim()).sort());

    expect(railLabels.length).toBeGreaterThan(5);
    expect(paletteLabels).toEqual(railLabels);
});

// Hold the actual bootstrap boundary so shortcut timing is deterministic. The
// normal .shell marker precedes plugin discovery and permission verification.
async function holdBootstrap(page: any, fail = false, denied: 'scripts' | 'all' | null = null) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let discovered = false;
    let namesRequests = 0;
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        discovered = true;
        await gate;
        await route.fulfill(fail ? { status: 503, body: 'Discovery unavailable' } : {
            json: denied ? [{ id: 'test-bootstrap-access', authorization: true, entry: '/plugins/test-bootstrap-access/entry.js' }] : []
        });
    });
    await page.route('**/plugins/test-bootstrap-access/entry.js*', (route: any) => route.fulfill({
        contentType: 'text/javascript',
        body: `export function register(p) {
            p.setAuthorizationController({ checkTask: (g,t) => !(${denied === 'all'
                ? "true"
                : "g === 'channel' && t === 'doEditGlobalScripts'"}) });
        }`,
    }));
    await page.route('**/api/channels/idsAndNames', (route: any) => {
        namesRequests++;
        return route.fulfill({ json: { map: { entry: { string: ['demo-id', 'Demo channel'] } } } });
    });
    await page.goto('/channels');
    await expect(page.locator('.shell')).toBeVisible();
    await expect.poll(() => discovered).toBe(true);
    return { release, namesRequests: () => namesRequests };
}

test('an early shortcut opens only after bootstrap and uses the verified permissions', async ({ page }) => {
    const pending = await holdBootstrap(page, false, 'scripts');
    try {
        await page.keyboard.press('Control+k');
        await page.keyboard.press('Enter');
        await expect(page.locator('.cmdk')).toHaveCount(0);
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        expect(pending.namesRequests()).toBe(0);
        await expect(page).toHaveURL(/\/channels$/);
        pending.release();
        await expect(page.locator('.cmdk')).toBeVisible();
        await expect.poll(pending.namesRequests).toBe(1);
        await page.locator('.cmdk-field input').fill('/Global Scripts');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        await page.locator('.cmdk-field input').fill('/Events');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/events$/);
    } finally { pending.release(); }
});

for (const cancel of ['Escape', 'Control+k']) {
    test(`${cancel} cancels an early shortcut request without fetching channels`, async ({ page }) => {
        const pending = await holdBootstrap(page);
        try {
            await page.keyboard.press('Control+k');
            await page.keyboard.press(cancel);
            pending.release();
            await expect(page.getByRole('button', { name: 'Channels', exact: true })).toBeVisible();
            await expect(page.locator('.cmdk')).toHaveCount(0);
            expect(pending.namesRequests()).toBe(0);
            await open(page);
            await expect.poll(pending.namesRequests).toBe(1);
        } finally { pending.release(); }
    });
}

test('a queued shortcut never opens or fetches channels after bootstrap failure', async ({ page }) => {
    const pending = await holdBootstrap(page, true);
    try {
        await page.keyboard.press('Control+k');
        pending.release();
        await expect(page.getByRole('alert').filter({ hasText: 'Unable to load access controls' })).toBeVisible();
        await expect(page.locator('.cmdk')).toHaveCount(0);
        expect(pending.namesRequests()).toBe(0);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+k');
        await expect(page.locator('.cmdk')).toHaveCount(0);
        expect(pending.namesRequests()).toBe(0);
    } finally { pending.release(); }
});

test('shell teardown discards an early shortcut before bootstrap completes', async ({ page }) => {
    const pending = await holdBootstrap(page);
    try {
        await page.keyboard.press('Control+k');
        await page.evaluate(async () => {
            const name = '@oie/web-shell';
            (await import(name)).platform.store.setState('user', null);
        });
        await expect(page.locator('.shell')).toHaveCount(0);
        pending.release();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('.cmdk')).toHaveCount(0);
        expect(pending.namesRequests()).toBe(0);
    } finally { pending.release(); }
});


test('an early shortcut never fetches channels for a fully denied verified role', async ({ page }) => {
    const pending = await holdBootstrap(page, false, 'all');
    try {
        await page.keyboard.press('Control+k');
        expect(pending.namesRequests()).toBe(0);
        pending.release();
        await expect(page.locator('.cmdk')).toBeVisible();
        await page.locator('.cmdk-field input').fill('#Demo channel');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        expect(pending.namesRequests()).toBe(0);
        await page.locator('.cmdk-field input').fill('/');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
        await page.locator('.cmdk-field input').fill('>Settings');
        await expect(page.locator('.cmdk-opt')).toHaveCount(0);
    } finally { pending.release(); }
});

test('a queued shortcut stays blocked if a provider fails after installing its controller', async ({ page }) => {
    let namesRequests = 0;
    page.on('request', (request: any) => {
        if (new URL(request.url()).pathname === '/api/channels/idsAndNames') namesRequests++;
    });
    await page.route('**/webadmin/plugins.json', (route: any) => route.fulfill({
        json: [{ id: 'test-failed-access', authorization: true, entry: '/plugins/test-failed-access/entry.js' }],
    }));
    await page.route('**/plugins/test-failed-access/entry.js*', (route: any) => route.fulfill({
        contentType: 'text/javascript',
        body: `export async function register(p) {
            p.setAuthorizationController({ checkTask: () => true });
            await new Promise(resolve => { window.releaseFailedAccess = resolve; });
            throw new Error('Provider failed after controller installation');
        }`,
    }));
    await page.goto('/channels');
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseFailedAccess)).toBe('function');
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toHaveCount(0);
    expect(namesRequests).toBe(0);
    await page.evaluate(() => (window as any).releaseFailedAccess());
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to load access controls' })).toBeVisible();
    await expect(page.locator('.cmdk')).toHaveCount(0);
    expect(namesRequests).toBe(0);
});
