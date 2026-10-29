import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { login, mockEngine } from './mock.js';
import { SAMPLE_CHANNELS, SAMPLE_STATUSES } from './fixtures.js';
import { makeChannel } from './connector-fixtures.js';

// These exercise a client lifecycle bug: an engine request can take arbitrarily
// long, while route changes destroy and recreate the Channels component. Gates
// hold ordinary engine-shaped responses without wall-clock sleeps. Cache-lifetime
// cases advance the browser clock explicitly to exercise real Query GC timers.
const channelList = (channels = SAMPLE_CHANNELS) => ({ list: { channel: channels } });
const GROUPS = { list: { channelGroup: [{
    '@version': '4.6.0', id: 'g-cache', name: 'Cached group', revision: 1,
    channels: { channel: [{ id: 'c-started' }] },
}] } };
const TAGS = { set: { channelTag: [{
    id: 'tag-cache', name: 'Cached tag', channelIds: { string: ['c-started'] },
    backgroundColor: { red: 100, green: 150, blue: 200, alpha: 255 },
}] } };
const STATUSES = { list: { dashboardStatus: SAMPLE_STATUSES.map(status => ({
    ...status, deployedRevisionDelta: status.channelId === 'c-started' ? 2 : 0,
})) } };
const fixtures = {
    'GET /channels': channelList(),
    'GET /channelgroups': GROUPS,
    'GET /server/channelTags': TAGS,
    'GET /channels/statuses': STATUSES,
};

function gate() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

const name = (page: Page, text: string) => page.locator('.view-body').getByText(text, { exact: true });
const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh', exact: true });
const status = (page: Page) => page.locator('.view-body [role="status"]');
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// Dashboard also reads full channels for connector types. Hold/count the
// Channels view's requests only; a dashboard read must not consume a gate.
const fromChannels = (request: Request) => new URL(request.headers().referer || 'http://fixture/').pathname === '/channels';

async function loaded(page: Page) {
    await expect(name(page, 'Demo Started')).toBeVisible();
    await expect(name(page, 'Demo Stopped')).toBeVisible();
    await expect(status(page).filter({ hasText: /Loading channels/ })).toHaveCount(0);
    // Cached rows are already visible. Their drag affordance is restored only
    // once this mount's required reads have completed, without a loading banner.
    await expect(page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) })).toHaveAttribute('draggable', 'true');
}

async function dashboard(page: Page) {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('row').filter({ hasText: 'Demo Started' }).first()).toBeVisible();
    await settle(page);
}

async function channels(page: Page) {
    await page.getByRole('button', { name: 'Channels', exact: true }).click();
    await expect(page).toHaveURL(/\/channels$/);
}

async function signOut(page: Page) {
    await page.locator('button.user-chip').click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
}

async function finishChannels(page: Page, held: ReturnType<typeof gate>) {
    const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/channels'
        && response.request().method() === 'GET' && fromChannels(response.request()));
    held.release();
    await (await response).finished();
    await settle(page);
}

async function dismissError(page: Page) {
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function selectRow(page: Page, text: string) {
    // A second pointer click can activate the row. Space deliberately selects
    // after revalidation without depending on the browser's double-click clock.
    const row = page.getByRole('row').filter({ has: page.getByText(text, { exact: true }) });
    await row.focus();
    await row.press('Space');
}

test('first visit shows loading until the channel request completes', async ({ page }) => {
    const held = gate();
    await mockEngine(page, { ...fixtures, 'GET /channels': async () => {
        await held.promise;
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await expect(status(page)).toContainText('Loading channels');
        await expect(name(page, 'No channels')).toHaveCount(0);
        await expect(refresh(page)).toBeEnabled();
        await finishChannels(page, held);
        await loaded(page);
    } finally { held.release(); }
});

test('returning from Dashboard displays the snapshot but gates actions that need channel models', async ({ page }) => {
    const heldChannels = gate(), heldTags = gate();
    let hold = false, channelReads = 0, tagWaiting = false;
    await mockEngine(page, {
        ...fixtures,
        'GET /channels': async (request: Request) => {
            if (fromChannels(request)) { channelReads++; if (hold) await heldChannels.promise; }
            return channelList();
        },
        'GET /server/channelTags': async (request: Request) => {
            if (hold && fromChannels(request)) { tagWaiting = true; await heldTags.promise; }
            return TAGS;
        },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        await page.evaluate(async () => {
            const pkg = '@oie/web-shell';
            const { platform } = await import(pkg);
            platform.registerChannelAction({ id: 'cache-regression-action', label: 'Snapshot action', icon: 'puzzle', onInvoke: () => {} });
        });
        await name(page, 'Demo Started').click();
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Snapshot action', exact: true })).toBeVisible();
        await dashboard(page);
        hold = true;
        await channels(page);
        await expect.poll(() => channelReads).toBe(2);
        await expect.poll(() => tagWaiting).toBe(true);
        await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(name(page, 'Demo Stopped')).toBeVisible();
        await expect(page.getByRole('gridcell', { name: '[Cached group]', exact: true })).toBeVisible();
        const row = page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) });
        await expect(row.locator('.tag', { hasText: 'Cached tag' })).toBeVisible();
        await expect(row.locator('.cell-flag')).toHaveText('2');
        await selectRow(page, 'Demo Started');
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Snapshot action', exact: true })).toHaveCount(0);
        await expect(page.locator('.view-body [aria-selected="true"]')).toHaveCount(0);
        await expect(row).not.toHaveAttribute('draggable', 'true');
        await name(page, 'Demo Started').click({ button: 'right' });
        await expect(page.getByRole('menuitem', { name: 'Clone Channel', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(refresh(page)).toBeEnabled();

        // A fast channels endpoint cannot make cached rows actionable while
        // one of their prerequisite lists is still being revalidated.
        await finishChannels(page, heldChannels);
        await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
        await selectRow(page, 'Demo Started');
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toHaveCount(0);
        heldTags.release();
        await loaded(page);
        await selectRow(page, 'Demo Started');
        await expect(page).toHaveURL(/\/channels$/);
        await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
    } finally { heldChannels.release(); heldTags.release(); }
});

for (const activation of ['double-click', 'Enter']) {
    test(`a cached channel opens its current engine model by ID with ${activation}`, async ({ page }) => {
        const held = gate();
        const current = { ...makeChannel('c-started'), name: 'Current engine channel', description: 'Current engine description' };
        let hold = false, waiting = false, sourceReads = 0, writes = 0;
        await mockEngine(page, {
            ...fixtures,
            'GET /channels': async (request: Request) => {
                if (hold && fromChannels(request)) { waiting = true; await held.promise; }
                return channelList();
            },
            'GET /channels/c-started': () => { sourceReads++; return { channel: current }; },
            'POST /channels': () => { writes++; return true; },
            'PUT /channels/*': () => { writes++; return true; },
        });
        try {
            await page.goto('/channels');
            await loaded(page);
            await dashboard(page);
            hold = true;
            await channels(page);
            await expect.poll(() => waiting).toBe(true);
            const cached = page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) });
            await expect(cached).not.toHaveAttribute('draggable', 'true');
            if (activation === 'double-click') await cached.dblclick();
            else { await cached.focus(); await cached.press('Enter'); }
            await expect(page).toHaveURL(/\/channels\/c-started\/edit$/);
            await expect.poll(() => sourceReads).toBe(1);
            // The editor must fetch by ID, never seed itself from the stripped
            // display row (whose name still says Demo Started).
            await expect(page.locator('.panel input[type=text]').first()).toHaveValue(current.name);
            await finishChannels(page, held);
            await expect(page.locator('.panel input[type=text]').first()).toHaveValue(current.name);
            expect(writes).toBe(0);
        } finally { held.release(); }
    });
}

for (const responseStatus of [200, 503, 403]) {
    test(`a live selection accepts another row during refresh, then ${responseStatus === 403 ? 'clears on denial' : `survives ${responseStatus === 503 ? 'a transient failure' : 'success'}`}`, async ({ page }) => {
        const held = gate();
        let refreshing = false, waiting = false;
        await mockEngine(page, { ...fixtures, 'GET /channels': async () => {
            if (refreshing) {
                waiting = true;
                await held.promise;
                if (responseStatus !== 200) return { __status: responseStatus, body: { error: 'Channel refresh unavailable' } };
            }
            return channelList();
        } });
        try {
            await page.goto('/channels');
            await loaded(page);
            const first = page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) });
            const second = page.getByRole('row').filter({ has: page.getByText('Demo Stopped', { exact: true }) });
            const clone = page.getByRole('button', { name: 'Clone Channel', exact: true });
            await first.click();
            refreshing = true;
            await refresh(page).click();
            await expect.poll(() => waiting).toBe(true);
            await expect(first).toHaveAttribute('aria-selected', 'true');
            await expect(clone).toBeVisible();
            await second.click();
            await expect(first).toHaveAttribute('aria-selected', 'false');
            await expect(second).toHaveAttribute('aria-selected', 'true');
            await finishChannels(page, held);
            if (responseStatus !== 200) {
                await expect(page.locator('.view-body [role="alert"]')).toContainText('Channel refresh unavailable');
                await dismissError(page);
            }
            if (responseStatus === 403) {
                await expect(page.locator('.view-body [role="alert"]')).not.toContainText(/stale/i);
                await expect(first).toHaveCount(0);
                await expect(second).toHaveCount(0);
                await expect(clone).toHaveCount(0);
            } else {
                if (responseStatus === 503) await expect(page.locator('.view-body [role="alert"]')).toContainText(/stale/i);
                await expect(first).toHaveAttribute('aria-selected', 'false');
                await expect(second).toHaveAttribute('aria-selected', 'true');
                await expect(clone).toBeVisible();
            }
        } finally { held.release(); }
    });
}

test('the focused Clone task remains mounted throughout its post-action refresh', async ({ page }) => {
    const held = gate();
    let written: any = null, waiting = false;
    await mockEngine(page, {
        ...fixtures,
        'GET /channels': async () => {
            if (written) { waiting = true; await held.promise; }
            return channelList([...SAMPLE_CHANNELS, ...(written ? [written] : [])]);
        },
        'GET /channels/c-started': { channel: { ...makeChannel('c-started'), name: 'Demo Started' } },
        'POST /channels': (request: Request) => { written = request.postDataJSON().channel; return true; },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        await name(page, 'Demo Started').click();
        const clone = page.getByRole('button', { name: 'Clone Channel', exact: true });
        await clone.focus();
        await clone.press('Enter');
        await expect.poll(() => waiting).toBe(true);
        await expect(clone).toBeFocused();
        await expect(page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) }))
            .toHaveAttribute('aria-selected', 'true');
        await finishChannels(page, held);
        await expect(name(page, 'Demo Started copy')).toBeVisible();
        await expect(clone).toBeFocused();
    } finally { held.release(); }
});

test('a filter with no matches stays distinct from loading during a live refresh', async ({ page }) => {
    const held = gate();
    let refreshing = false, waiting = false;
    await mockEngine(page, { ...fixtures, 'GET /channels': async () => {
        if (refreshing) { waiting = true; await held.promise; }
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        await page.getByRole('radiogroup', { name: 'Row grouping' }).getByRole('radio', { name: 'Channel view' }).click();
        const filter = page.getByPlaceholder('Enter channel tag or name');
        await filter.fill('No such channel');
        await expect(name(page, 'No matching channels')).toBeVisible();
        await expect(name(page, 'No channels')).toHaveCount(0);
        refreshing = true;
        await refresh(page).click();
        await expect.poll(() => waiting).toBe(true);
        await expect(name(page, 'No matching channels')).toBeVisible();
        await expect(status(page).filter({ hasText: /Loading channels/ })).toHaveCount(0);
        await finishChannels(page, held);
        await expect(name(page, 'No matching channels')).toBeVisible();
        await filter.clear();
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(name(page, 'Demo Stopped')).toBeVisible();
    } finally { held.release(); }
});

test('a hidden tag still reports stale filtering after its refresh fails', async ({ page }) => {
    let failing = false;
    await mockEngine(page, { ...fixtures,
        'GET /server/channelTags': () => failing
            ? { __status: 503, body: { error: 'Tag refresh unavailable' } } : TAGS,
    });
    await page.goto('/channels');
    await loaded(page);
    await page.getByRole('radiogroup', { name: 'Tag display' }).getByRole('radio', { name: 'Off', exact: true }).click();
    const filter = page.getByPlaceholder('Enter channel tag or name');
    await filter.fill('Cached tag');
    await expect(name(page, 'Demo Started')).toBeVisible();
    await expect(name(page, 'Demo Stopped')).toHaveCount(0);
    await expect(page.locator('.view-body .tag')).toHaveCount(0);
    failing = true;
    await refresh(page).click();
    const alert = page.locator('.view-body [role="alert"]');
    await expect(alert).toContainText('Tag refresh unavailable');
    await expect(alert).toContainText(/stale/i);
    await dismissError(page);
    // Clearing the tag filter removes the only displayed effect of the old
    // tags; the error remains, but the freshly loaded rows are not stale.
    await filter.clear();
    await expect(name(page, 'Demo Stopped')).toBeVisible();
    await expect(alert).not.toContainText(/stale/i);
});

for (const endpoint of ['GET /channels', 'GET /channels/statuses']) {
    test(`a first-visit ${endpoint} failure does not claim that fresh data is stale`, async ({ page }) => {
        await mockEngine(page, { ...fixtures, [endpoint]: { __status: 503, body: { error: 'Initial read unavailable' } } });
        await page.goto('/channels');
        const alert = page.locator('.view-body [role="alert"]');
        await expect(alert).toContainText('Initial read unavailable');
        await expect(alert).not.toContainText(/stale/i);
        if (endpoint === 'GET /channels/statuses') await expect(name(page, 'Demo Started')).toBeVisible();
        else await expect(name(page, 'Demo Started')).toHaveCount(0);
    });
}

test('an active Channels snapshot survives five minutes and a recent refresh', async ({ page }) => {
    const returning = gate();
    let reads = 0;
    await page.clock.install();
    await mockEngine(page, { ...fixtures, 'GET /channels': async (request: Request) => {
        if (fromChannels(request)) {
            const read = ++reads;
            if (read >= 3) await returning.promise;
        }
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        expect(reads).toBe(1);
        await page.clock.fastForward(290_000);
        // Retaining the snapshot must not turn the explicit refresh into a
        // polling query or introduce an extra automatic request.
        expect(reads).toBe(1);
        const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/channels'
            && fromChannels(response.request()));
        await refresh(page).click();
        await (await refreshed).finished();
        await settle(page);
        await expect.poll(() => reads).toBe(2);
        await loaded(page);
        await page.clock.fastForward(11_000);
        expect(reads).toBe(2);
        await dashboard(page);
        await channels(page);
        await expect.poll(() => reads).toBe(3);
        // This returning read is held. The continuously active snapshot was
        // refreshed eleven seconds ago and must not have expired at 300s.
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(name(page, 'Demo Stopped')).toBeVisible();
        await expect(status(page)).toHaveCount(0);
        await finishChannels(page, returning);
        await loaded(page);
        expect(reads).toBe(3);
    } finally { returning.release(); }
});

test('a departed Channels snapshot expires after five inactive minutes', async ({ page }) => {
    const returning = gate();
    let reads = 0;
    await page.clock.install();
    await mockEngine(page, { ...fixtures, 'GET /channels': async (request: Request) => {
        if (fromChannels(request)) {
            const read = ++reads;
            if (read >= 2) await returning.promise;
        }
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        await dashboard(page);
        await page.clock.fastForward(301_000);
        expect(reads).toBe(1);
        await channels(page);
        await expect.poll(() => reads).toBe(2);
        await expect(status(page)).toContainText('Loading channels');
        await expect(name(page, 'Demo Started')).toHaveCount(0);
        await expect(name(page, 'Demo Stopped')).toHaveCount(0);
        await finishChannels(page, returning);
        await loaded(page);
        expect(reads).toBe(2);
    } finally { returning.release(); }
});

test('revisiting Channels starts a new inactive cache lifetime on the next departure', async ({ page }) => {
    const firstReturn = gate(), secondReturn = gate();
    let reads = 0;
    await page.clock.install();
    await mockEngine(page, { ...fixtures, 'GET /channels': async (request: Request) => {
        if (fromChannels(request)) {
            const read = ++reads;
            if (read === 2) await firstReturn.promise;
            if (read >= 3) await secondReturn.promise;
        }
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        await dashboard(page);
        await page.clock.fastForward(240_000);
        await channels(page);
        await expect.poll(() => reads).toBe(2);
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(status(page)).toHaveCount(0);
        await finishChannels(page, firstReturn);
        await loaded(page);
        await dashboard(page);
        // Six total minutes have elapsed, but only two since the latest
        // departure. The first departure's GC deadline must be canceled.
        await page.clock.fastForward(120_000);
        expect(reads).toBe(2);
        await channels(page);
        await expect.poll(() => reads).toBe(3);
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(name(page, 'Demo Stopped')).toBeVisible();
        await expect(status(page)).toHaveCount(0);
        await finishChannels(page, secondReturn);
        await loaded(page);
        expect(reads).toBe(3);
    } finally { firstReturn.release(); secondReturn.release(); }
});

for (const empty of [false, true]) {
    test(`manual refresh replaces rows with an authoritative ${empty ? 'empty list' : 'permission-filtered subset'} and prunes selection`, async ({ page }) => {
        const held = gate();
        let refreshing = false;
        await mockEngine(page, { ...fixtures, 'GET /channels': async () => {
            if (!refreshing) return channelList();
            await held.promise;
            return channelList(empty ? [] : [SAMPLE_CHANNELS[0]]);
        } });
        try {
            await page.goto('/channels');
            await loaded(page);
            await name(page, 'Demo Stopped').click();
            await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
            refreshing = true;
            await refresh(page).click();
            await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
            await expect(name(page, 'Demo Stopped')).toBeVisible();
            await finishChannels(page, held);
            await expect(name(page, 'Demo Stopped')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toHaveCount(0);
            await expect(page.locator('.view-body [aria-selected="true"]')).toHaveCount(0);
            if (empty) await expect(name(page, 'No channels')).toBeVisible();
            else await expect(name(page, 'Demo Started')).toBeVisible();
        } finally { held.release(); }
    });
}

for (const endpoint of ['GET /channels', 'GET /channelgroups', 'GET /server/channelTags', 'GET /channels/statuses'] as const) {
    test(`cached rows report ${endpoint} failure and recover on retry`, async ({ page }) => {
        const held = gate();
        let mode: 'ready' | 'failed' | 'retry' = 'ready';
        let waiting = false;
        await mockEngine(page, { ...fixtures, [endpoint]: async (request: Request) => {
            if (!fromChannels(request)) return fixtures[endpoint];
            if (mode === 'failed') return { __status: 503, body: { error: 'Cache revalidation unavailable' } };
            if (mode === 'retry') { waiting = true; await held.promise; }
            return fixtures[endpoint];
        } });
        try {
            await page.goto('/channels');
            await loaded(page);
            await dashboard(page);
            mode = 'failed';
            await channels(page);
            await expect(page.locator('.view-body [role="alert"]')).toContainText('Cache revalidation unavailable');
            await expect(page.locator('.view-body')).toContainText(/stale/i);
            await dismissError(page);
            await expect(name(page, 'Demo Started')).toBeVisible();
            await name(page, 'Demo Started').click();
            const clone = page.getByRole('button', { name: 'Clone Channel', exact: true });
            if (endpoint === 'GET /channels') await expect(clone).toHaveCount(0);
            else await expect(clone).toBeVisible();
            if (endpoint === 'GET /channelgroups') {
                await expect(page.getByRole('button', { name: 'Assign To Group', exact: true })).toHaveCount(0);
                await expect(page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) })).not.toHaveAttribute('draggable', 'true');
            }
            mode = 'retry';
            await refresh(page).click();
            await expect.poll(() => waiting).toBe(true);
            await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
            await expect(name(page, 'Demo Started')).toBeVisible();
            await selectRow(page, 'Demo Started');
            // Only this mount's successfully loaded full models can keep their
            // actions usable while retrying an independent prerequisite.
            if (endpoint === 'GET /channels') await expect(clone).toHaveCount(0);
            else await expect(clone).toBeVisible();
            held.release();
            await loaded(page);
            await expect(page.locator('.view-body [role="alert"]')).toHaveCount(0);
            await selectRow(page, 'Demo Started');
            await expect(page).toHaveURL(/\/channels$/);
            await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
        } finally { held.release(); }
    });
}

for (const endpoint of ['GET /channels', 'GET /channelgroups', 'GET /server/channelTags', 'GET /channels/statuses'] as const) {
    test(`a forbidden ${endpoint} response removes that cached data`, async ({ page }) => {
        let denied = false;
        await mockEngine(page, { ...fixtures, [endpoint]: (request: Request) => denied && fromChannels(request)
            ? { __status: 403, body: { error: 'Access no longer permitted' } } : fixtures[endpoint] });
        await page.goto('/channels');
        await loaded(page);
        await dashboard(page);
        denied = true;
        await channels(page);
        const alert = page.locator('.view-body [role="alert"]');
        await expect(alert).toContainText('Access no longer permitted');
        await expect(alert).not.toContainText(/stale/i);
        await dismissError(page);
        if (endpoint === 'GET /channels') {
            await expect(name(page, 'Demo Started')).toHaveCount(0);
            await expect(name(page, 'Demo Stopped')).toHaveCount(0);
            await expect(name(page, 'No channels')).toHaveCount(0);
        } else {
            await expect(name(page, 'Demo Started')).toBeVisible();
            if (endpoint === 'GET /channelgroups') await expect(name(page, '[Cached group]')).toHaveCount(0);
            if (endpoint === 'GET /server/channelTags') await expect(name(page, 'Cached tag')).toHaveCount(0);
            if (endpoint === 'GET /channels/statuses') await expect(page.locator('.view-body .cell-flag')).toHaveCount(0);
        }
    });
}

test('a forbidden group list preserves individual channel actions in flat mode', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, {
        ...fixtures,
        'GET /channelgroups': { __status: 403, body: { error: 'Group view not permitted' } },
        'GET /channels/c-started': { channel: { ...makeChannel('c-started'), name: 'Demo Started' } },
        'POST /channels': () => { writes++; return true; },
    });
    await page.goto('/channels');
    await expect(page.locator('.view-body [role="alert"]')).toContainText('Group view not permitted');
    await dismissError(page);
    await name(page, 'Demo Started').click();
    await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign To Group', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export All Groups', exact: true })).toBeDisabled();
    await expect(page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) })).not.toHaveAttribute('draggable', 'true');
    await page.getByRole('radiogroup', { name: 'Row grouping' }).getByRole('radio', { name: 'Channel view' }).click();
    // The mode switch preserves selection. Clicking the same row again here
    // can be the table's second click-to-open rather than a new selection.
    await expect(page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Assign To Group', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export All Groups', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
});

for (const responseStatus of [503, 403]) {
    test(`a live group selection ${responseStatus === 503 ? 'survives a transient failure' : 'is cleared by permission denial'}`, async ({ page }) => {
        let failing = false;
        await mockEngine(page, {
            ...fixtures,
            'GET /channelgroups': () => failing ? { __status: responseStatus, body: { error: 'Group refresh unavailable' } } : GROUPS,
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['c-started', 'Demo Started'] }] } },
        });
        await page.goto('/channels');
        await loaded(page);
        const group = page.getByRole('row').filter({ has: page.getByText('[Cached group]', { exact: true }) });
        await group.click();
        await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toBeVisible();
        await page.keyboard.press('Control+k');
        await expect(page.locator('.cmdk')).toBeVisible();
        const suggested = page.locator('.cmdk-opt[data-group="Suggested"]').filter({ hasText: 'Demo Started' });
        await expect(suggested.first()).toBeVisible();
        await page.keyboard.press('Escape');
        failing = true;
        await refresh(page).click();
        const alert = page.locator('.view-body [role="alert"]');
        await expect(alert).toContainText('Group refresh unavailable');
        await dismissError(page);
        if (responseStatus === 503) {
            await expect(alert).toContainText(/stale/i);
            await expect(group).toHaveAttribute('aria-selected', 'true');
            await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Disable Channel', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toBeVisible();
        } else {
            await expect(alert).not.toContainText(/stale/i);
            await expect(group).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Deploy Channel', exact: true })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Disable Channel', exact: true })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Export Group', exact: true })).toHaveCount(0);
        }
        await page.keyboard.press('Control+k');
        await expect(page.locator('.cmdk')).toBeVisible();
        if (responseStatus === 503) await expect(suggested.first()).toBeVisible();
        else await expect(suggested).toHaveCount(0);
        await page.keyboard.press('Escape');
    });
}

test('a group remains selected during refresh and actions use its refreshed membership', async ({ page }) => {
    const held = gate();
    let refreshing = false, waiting = false;
    const writes: string[] = [];
    await mockEngine(page, {
        ...fixtures,
        'GET /channelgroups': async () => {
            if (!refreshing) return GROUPS;
            waiting = true;
            await held.promise;
            return { list: { channelGroup: [{ ...GROUPS.list.channelGroup[0], revision: 2,
                channels: { channel: [{ id: 'c-stopped' }] } }] } };
        },
        'GET /channels/idsAndNames': { map: { entry: [
            { string: ['c-started', 'Demo Started'] }, { string: ['c-stopped', 'Demo Stopped'] },
        ] } },
        'POST /channels/*/enabled/false': (request: Request) => { writes.push(new URL(request.url()).pathname); return ''; },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        const group = page.getByRole('row').filter({ has: page.getByText('[Cached group]', { exact: true }) });
        await group.click();
        refreshing = true;
        await refresh(page).click();
        await expect.poll(() => waiting).toBe(true);
        await expect(group).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('button', { name: 'Disable Channel', exact: true })).toBeVisible();
        await page.keyboard.press('Control+k');
        const suggestions = page.locator('.cmdk-opt[data-group="Suggested"]');
        await expect(suggestions.filter({ hasText: 'Demo Started' }).first()).toBeVisible();
        await page.keyboard.press('Escape');
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/channelgroups');
        held.release();
        await (await response).finished();
        await settle(page);
        await expect(group).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Control+k');
        await expect(suggestions.filter({ hasText: 'Demo Stopped' }).first()).toBeVisible();
        await expect(suggestions.filter({ hasText: 'Demo Started' })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Disable Channel', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes).toEqual(['/api/channels/c-stopped/enabled/false']);
    } finally { held.release(); }
});

test('a superseded refresh cannot overwrite newer rows or the next navigation snapshot', async ({ page }) => {
    const older = gate(), returning = gate();
    let reads = 0;
    const latest = [{ ...SAMPLE_CHANNELS[0], name: 'Newest channel', revision: 3 }];
    await mockEngine(page, { ...fixtures, 'GET /channels': async (request: Request) => {
        if (!fromChannels(request)) return channelList();
        const read = ++reads;
        if (read === 2) { await older.promise; return channelList([{ ...SAMPLE_CHANNELS[0], name: 'Obsolete channel', revision: 2 }]); }
        if (read >= 4) await returning.promise;
        return read === 1 ? channelList() : channelList(latest);
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        await refresh(page).click();
        await expect.poll(() => reads).toBe(2);
        await refresh(page).click();
        await expect(name(page, 'Newest channel')).toBeVisible();
        await finishChannels(page, older);
        await expect(name(page, 'Newest channel')).toBeVisible();
        await expect(name(page, 'Obsolete channel')).toHaveCount(0);
        await dashboard(page);
        await channels(page);
        await expect.poll(() => reads).toBe(4);
        await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
        await expect(name(page, 'Newest channel')).toBeVisible();
        await expect(name(page, 'Obsolete channel')).toHaveCount(0);
        await finishChannels(page, returning);
    } finally { older.release(); returning.release(); }
});

test('a response from an unmounted Channels view cannot replace its last completed snapshot', async ({ page }) => {
    const abandoned = gate(), returning = gate();
    let reads = 0;
    await mockEngine(page, { ...fixtures, 'GET /channels': async (request: Request) => {
        if (!fromChannels(request)) return channelList();
        const read = ++reads;
        if (read === 2) { await abandoned.promise; return channelList([{ ...SAMPLE_CHANNELS[0], name: 'Abandoned response' }]); }
        if (read === 3) await returning.promise;
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        await refresh(page).click();
        await expect.poll(() => reads).toBe(2);
        await dashboard(page);
        await finishChannels(page, abandoned);
        await channels(page);
        await expect.poll(() => reads).toBe(3);
        await expect(page.locator('.view-body')).not.toContainText('Refreshing channels');
        await expect(name(page, 'Demo Started')).toBeVisible();
        await expect(name(page, 'Demo Stopped')).toBeVisible();
        await expect(name(page, 'Abandoned response')).toHaveCount(0);
        await finishChannels(page, returning);
        await loaded(page);
    } finally { abandoned.release(); returning.release(); }
});

test('logout clears cached channels and late reads cannot expose them to the next user', async ({ page }) => {
    const oldRead = gate(), nextRead = gate();
    let authenticated = true, userId = 1, reads = 0;
    await mockEngine(page, {
        ...fixtures,
        'GET /users/current': () => authenticated ? { user: { id: userId, username: userId === 1 ? 'admin' : 'operator' } } : { __status: 401 },
        'POST /users/_logout': () => { authenticated = false; return ''; },
        'POST /users/_login': () => { authenticated = true; userId = 2; return { status: 'SUCCESS' }; },
        'GET /channels': async (request: Request) => {
            if (!fromChannels(request)) return channelList();
            const read = ++reads;
            if (read === 2) { await oldRead.promise; return channelList(); }
            if (read >= 3) {
                await nextRead.promise;
                return channelList([{ ...SAMPLE_CHANNELS[0], id: 'operator-channel', name: 'Operator channel' }]);
            }
            return channelList();
        },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        await refresh(page).click();
        await expect.poll(() => reads).toBe(2);
        await signOut(page);
        // Login deliberately reloads the document. Complete the old response
        // while the signed-out document still exists to exercise the session
        // guard, rather than waiting for a response from an already canceled
        // request after that reload.
        await finishChannels(page, oldRead);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await login(page, 'operator');
        await expect(page.locator('.shell')).toBeVisible();
        await channels(page);
        await expect.poll(() => reads).toBe(3);
        await expect(status(page)).toContainText('Loading channels');
        await expect(name(page, 'Demo Started')).toHaveCount(0);
        await expect(name(page, 'Demo Stopped')).toHaveCount(0);
        await finishChannels(page, nextRead);
        await expect(name(page, 'Operator channel')).toBeVisible();
        await expect(name(page, 'Demo Started')).toHaveCount(0);
    } finally { oldRead.release(); nextRead.release(); }
});

test('a full page reload does not restore the in-memory channel snapshot', async ({ page }) => {
    const held = gate();
    let reloading = false;
    await mockEngine(page, { ...fixtures, 'GET /channels': async () => {
        if (reloading) await held.promise;
        return channelList();
    } });
    try {
        await page.goto('/channels');
        await loaded(page);
        reloading = true;
        await page.reload();
        await expect(status(page)).toContainText('Loading channels');
        await expect(name(page, 'Demo Started')).toHaveCount(0);
        await finishChannels(page, held);
        await loaded(page);
    } finally { held.release(); }
});

test('Clone reads the current source model before writing its independent copy', async ({ page }) => {
    const held = gate();
    const source = makeChannel('c-started');
    Object.assign(source, { name: 'Renamed by another administrator', description: 'Current engine description', revision: 9 });
    const writes: any[] = [];
    let reads = 0;
    await mockEngine(page, {
        ...fixtures,
        'GET /channels/c-started': async () => { reads++; await held.promise; return { channel: source }; },
        'POST /channels': (request: Request) => { writes.push(request.postDataJSON().channel); return true; },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        await name(page, 'Demo Started').click();
        await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
        await expect.poll(() => reads).toBe(1);
        expect(writes).toHaveLength(0);
        held.release();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toMatchObject({
            name: 'Renamed by another administrator copy', description: 'Current engine description', revision: 0,
            preprocessingScript: source.preprocessingScript,
        });
        expect(writes[0].id).not.toBe(source.id);
        expect(source.revision).toBe(9);
        await expect(page.getByText('Cloned Renamed by another administrator', { exact: true })).toBeVisible();
    } finally { held.release(); }
});

test('Clone performs no write when its source has been removed since the list loaded', async ({ page }) => {
    const writes: string[] = [];
    await mockEngine(page, {
        ...fixtures,
        'GET /channels/c-started': { __status: 404, body: { error: 'Channel no longer exists' } },
        'POST /channels': (request: Request) => { writes.push(request.postData() || ''); return true; },
    });
    await page.goto('/channels');
    await loaded(page);
    await name(page, 'Demo Started').click();
    await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Channel no longer exists');
    expect(writes).toHaveLength(0);
});

test('Clone performs no write when the engine returns no source channel', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, { ...fixtures, 'POST /channels': () => { writes++; return true; } });
    // ChannelServlet can return null for a missing or unauthorized channel;
    // JAX-RS sends that successful null result as an empty 204 response.
    await page.route('**/api/channels/c-started', route => route.fulfill({ status: 204, body: '' }));
    await page.goto('/channels');
    await loaded(page);
    await name(page, 'Demo Started').click();
    await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Channel is no longer available');
    expect(writes).toBe(0);
});

test('Clone cannot write after logout while its fresh source request is pending', async ({ page }) => {
    const held = gate();
    let reads = 0, authenticated = true;
    const writes: string[] = [];
    await mockEngine(page, {
        ...fixtures,
        'GET /users/current': () => authenticated ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
        'POST /users/_logout': () => { authenticated = false; return ''; },
        'GET /channels/c-started': async () => { reads++; await held.promise; return { channel: makeChannel('c-started') }; },
        'POST /channels': (request: Request) => { writes.push(request.postData() || ''); return true; },
    });
    try {
        await page.goto('/channels');
        await loaded(page);
        await name(page, 'Demo Started').click();
        await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
        await expect.poll(() => reads).toBe(1);
        await signOut(page);
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/channels/c-started');
        held.release();
        await (await response).finished();
        await settle(page);
        expect(writes).toHaveLength(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    } finally { held.release(); }
});
