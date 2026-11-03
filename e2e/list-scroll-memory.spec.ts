import { test, expect } from './base.js';
import { login, mockEngine } from './mock.js';

/*
 * Swing parity: the Dashboard and Channels lists keep their selection, filters and scroll position
 * when you leave them and come back.
 */

const COUNT = 80;
const ids = Array.from({ length: COUNT }, (_, i) => `c-${String(i).padStart(2, '0')}`);
const CHANNELS = ids.map((id) => ({ '@version': '4.6.0', id, name: `Channel ${id}`, revision: 1 }));
const STATUSES = ids.map((id) => ({ channelId: id, name: `Channel ${id}`, state: 'STARTED', statistics: {} }));
const GROUPS = Array.from({ length: 16 }, (_, i) => ({
    id: `g-${i}`, name: `Group ${String(i).padStart(2, '0')}`,
    channels: { channel: ids.slice(i * 5, i * 5 + 5).map(id => ({ id })) },
}));

const dashWrap = '.dash-content .dt-wrap';
const channelsWrap = '.oie-tablecard .dt-wrap';

test('Dashboard and Channels restore independent selections and scroll positions on return', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: STATUSES } },
        'GET /channels': { list: { channel: CHANNELS } },
    });
    const scrollTop = (sel: string) => page.locator(sel).evaluate((el) => el.scrollTop);
    const scrollTo = (sel: string, top: number) => page.locator(sel).evaluate((el, y) => { el.scrollTop = y; }, top);
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();

    await page.goto('/dashboard');
    await expect(page.getByText('Channel c-00', { exact: true })).toBeVisible();
    await page.getByText('Channel c-20', { exact: true }).click();
    await page.getByText('Channel c-21', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
    await scrollTo(dashWrap, 600);
    await expect.poll(() => scrollTop(dashWrap)).toBe(600);

    await go('Channels');
    await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();
    // First visit starts at the top.
    expect(await scrollTop(channelsWrap)).toBe(0);
    await page.getByText('Channel c-12', { exact: true }).click();
    await page.getByText('Channel c-13', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
    await scrollTo(channelsWrap, 400);
    await expect.poll(() => scrollTop(channelsWrap)).toBe(400);

    await go('Dashboard');
    await expect(page.locator(dashWrap)).toBeVisible();
    await expect.poll(() => scrollTop(dashWrap)).toBe(600);
    await expect(page.locator(`${dashWrap} tr[aria-selected="true"]`)).toHaveCount(2);
    for (const id of ['c-20', 'c-21']) await expect(page.locator(`${dashWrap} tr`).filter({ hasText: `Channel ${id}` })).toHaveAttribute('aria-selected', 'true');

    await go('Channels');
    await expect(page.locator(channelsWrap)).toBeVisible();
    await expect.poll(() => scrollTop(channelsWrap)).toBe(400);
    await expect(page.locator(`${channelsWrap} tr[aria-selected="true"]`)).toHaveCount(2);
    for (const id of ['c-12', 'c-13']) await expect(page.locator(`${channelsWrap} tr`).filter({ hasText: `Channel ${id}` })).toHaveAttribute('aria-selected', 'true');
});

for (const delayed of ['statuses', 'groups', 'tags'] as const) {
    test(`Dashboard restores its position after cached ${delayed} expire`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.clock.install();
        let holdResponse = false;
        let calls = 0;
        let releaseResponse!: () => void;
        const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
        const responses = {
            statuses: { list: { dashboardStatus: STATUSES } },
            groups: { list: { channelGroup: GROUPS } },
            tags: { set: { channelTag: [{ id: 'tag-scroll', name: 'c-0 tag', channelIds: { string: ids.slice(10) } }] } },
        };
        const respond = async (kind: typeof delayed) => {
            if (kind === delayed) {
                calls++;
                if (holdResponse) await responseReady;
            }
            return responses[kind];
        };
        await mockEngine(page, {
            'GET /channels/statuses': () => respond('statuses'),
            'GET /channelgroups': () => respond('groups'),
            'GET /server/channelTags': () => respond('tags'),
            'GET /channels': { list: { channel: CHANNELS } },
        });
        const scrollTop = () => page.locator(dashWrap).evaluate((el) => el.scrollTop);
        const rows = page.locator(dashWrap).locator('tbody tr');

        await page.goto('/dashboard');
        await expect(rows).toHaveCount(COUNT + GROUPS.length);
        if (delayed === 'tags') {
            // The text matches ten names and a tag on the other seventy rows.
            await page.getByPlaceholder('Enter channel tag or name').fill('c-0');
            await expect(rows).toHaveCount(COUNT + GROUPS.length);
        }
        await page.getByText('Channel c-70', { exact: true }).click();
        await page.locator(dashWrap).evaluate((el) => {
            // Beyond the ungrouped table's scroll range, to catch early clamping.
            el.scrollTop = 2500;
            return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        await expect.poll(scrollTop).toBe(2500);
        await page.getByRole('button', { name: 'Channels', exact: true }).click();
        await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();

        // Inactive queries expire after five minutes. Exercise each response
        // order so loading statuses, groups or filter tags cannot consume it.
        await page.clock.fastForward(301_000);
        holdResponse = true;
        const before = calls;
        try {
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect.poll(() => calls).toBeGreaterThan(before);
            await expect(rows).toHaveCount(delayed === 'statuses' ? 0 : delayed === 'tags' ? 12 : COUNT + 1);
            if (delayed === 'statuses') await expect(page.getByRole('status').filter({ hasText: 'Loading channels…' })).toBeVisible();
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        } finally {
            releaseResponse();
        }
        await expect(rows).toHaveCount(COUNT + GROUPS.length);
        await expect.poll(scrollTop).toBe(2500);
        await expect(page.locator(`${dashWrap} tr`).filter({ hasText: 'Channel c-70' })).toHaveAttribute('aria-selected', 'true');
    });
}


test('connector and group selections return, and explicit deselection is remembered', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: [{
            ...STATUSES[0], childStatuses: { dashboardStatus: [{
                channelId: ids[0], metaDataId: 0, name: 'Source', statusType: 'SOURCE_CONNECTOR', state: 'STARTED',
            }] },
        }] } },
        'GET /channels': { list: { channel: CHANNELS.slice(0, 1) } },
        'GET /channelgroups': { list: { channelGroup: GROUPS.slice(0, 1) } },
    });
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const source = () => page.locator(`${dashWrap} tr`).filter({ hasText: 'Source' });
    const group = () => page.locator(`${channelsWrap} tr`).filter({ hasText: '[Group 00]' });
    await page.goto('/dashboard');
    const channel = page.locator(`${dashWrap} tr`).filter({ hasText: 'Channel c-00' });
    await channel.focus();
    await channel.press('ArrowRight');
    await source().click();
    await go('Channels');
    await group().click();
    await go('Dashboard');
    await expect(source()).toHaveAttribute('aria-selected', 'true');
    await go('Channels');
    await expect(group()).toHaveAttribute('aria-selected', 'true');
    // Clear through the existing table background interaction.
    await page.locator(channelsWrap).click({ position: { x: 10, y: 200 } });
    await go('Dashboard');
    await go('Channels');
    await expect(page.locator(`${channelsWrap} tr[aria-selected="true"]`)).toHaveCount(0);
});

for (const surface of ['Dashboard', 'Channels']) {
    test(`${surface} prunes remembered selections after an authoritative removal`, async ({ page }) => {
        let removed = false;
        await mockEngine(page, {
            'GET /channels': () => ({ list: { channel: removed ? CHANNELS.slice(1) : CHANNELS } }),
            'GET /channels/statuses': () => ({ list: { dashboardStatus: removed ? STATUSES.slice(1) : STATUSES } }),
        });
        const wrap = surface === 'Dashboard' ? dashWrap : channelsWrap;
        const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
        await page.goto(surface === 'Dashboard' ? '/dashboard' : '/channels');
        await page.getByText('Channel c-00', { exact: true }).click();
        await page.getByText('Channel c-01', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
        await go(surface === 'Dashboard' ? 'Channels' : 'Dashboard');
        removed = true;
        await go(surface);
        await expect(page.locator(wrap).getByText('Channel c-00', { exact: true })).toHaveCount(0);
        await expect(page.locator(`${wrap} tr[aria-selected="true"]`)).toHaveCount(1);
        await expect(page.locator(`${wrap} tr`).filter({ hasText: 'Channel c-01' })).toHaveAttribute('aria-selected', 'true');
    });
}

for (const surface of ['Dashboard', 'Channels']) {
    test(`${surface} clears navigation selections and filters on sign out`, async ({ page }) => {
        await mockEngine(page);
        await page.goto(surface === 'Dashboard' ? '/dashboard' : '/channels');
        await page.getByText('Demo Started', { exact: true }).click();
        const filter = page.getByPlaceholder('Enter channel tag or name');
        await filter.fill('Demo');
        if (surface === 'Dashboard') await filter.press('Enter');
        await page.locator('button.user-chip').click();
        await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await login(page);
        await expect(page.locator('.shell')).toBeVisible();
        await page.getByRole('button', { name: surface, exact: true }).click();
        const wrap = surface === 'Dashboard' ? dashWrap : channelsWrap;
        await expect(page.locator(wrap).getByText('Demo Started', { exact: true })).toBeVisible();
        await expect(page.locator(`${wrap} tr[aria-selected="true"]`)).toHaveCount(0);
        await expect(filter).toHaveValue('');
        await expect(page.locator('.filter-chip-host .tag')).toHaveCount(0);
    });
}

test('Dashboard holds a remembered selection until statuses are read again', async ({ page }) => {
    let removed = false;
    let hold = false;
    let release!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await mockEngine(page, {
        'GET /channels': { list: { channel: CHANNELS } },
        'GET /channels/statuses': async () => {
            if (hold) await released;
            return { list: { dashboardStatus: removed ? STATUSES.slice(1) : STATUSES } };
        },
    });
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    await page.goto('/dashboard');
    await page.getByText('Channel c-00', { exact: true }).click();
    await page.getByText('Channel c-01', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
    await expect(stop).toBeVisible();
    await go('Channels');
    await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();
    // Undeployed elsewhere: the cached statuses still list c-00.
    removed = true;
    hold = true;
    try {
        await go('Dashboard');
        await expect(page.locator(dashWrap).getByText('Channel c-00', { exact: true })).toBeVisible();
        await expect(page.locator(`${dashWrap} tr[aria-selected="true"]`)).toHaveCount(0);
        await expect(stop).toHaveCount(0);
    } finally {
        release();
    }
    await expect(page.locator(dashWrap).getByText('Channel c-00', { exact: true })).toHaveCount(0);
    await expect(page.locator(`${dashWrap} tr[aria-selected="true"]`)).toHaveCount(1);
    await expect(page.locator(`${dashWrap} tr`).filter({ hasText: 'Channel c-01' })).toHaveAttribute('aria-selected', 'true');
    await expect(stop).toBeVisible();
});

test('text filters restore independently with selections, including no matches and clearing', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: STATUSES } },
        'GET /channels': { list: { channel: CHANNELS } },
    });
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const filter = page.getByPlaceholder('Enter channel tag or name');
    const selected = (wrap: string, id: string) => page.locator(`${wrap} tr`).filter({ hasText: `Channel ${id}` });
    await page.goto('/dashboard');
    await filter.fill('c-2');
    await page.locator(dashWrap).getByText('Channel c-20', { exact: true }).click();
    await go('Channels');
    await expect(filter).toHaveValue('');
    await filter.fill('c-3');
    await page.locator(channelsWrap).getByText('Channel c-30', { exact: true }).click();

    await go('Dashboard');
    await expect(filter).toHaveValue('c-2');
    await expect(selected(dashWrap, 'c-20')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(dashWrap).getByText('Channel c-00', { exact: true })).toHaveCount(0);
    await filter.fill('no matching channel');
    await go('Channels');
    await expect(filter).toHaveValue('c-3');
    await expect(selected(channelsWrap, 'c-30')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toHaveCount(0);
    await filter.fill('');

    await go('Dashboard');
    await expect(filter).toHaveValue('no matching channel');
    await expect(page.locator(dashWrap).getByText('Channel c-20', { exact: true })).toHaveCount(0);
    await filter.fill('');
    await expect(selected(dashWrap, 'c-20')).toHaveAttribute('aria-selected', 'true');
    await go('Channels');
    await expect(filter).toHaveValue('');
    await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();
    await go('Dashboard');
    await expect(filter).toHaveValue('');
    await expect(page.locator(dashWrap).getByText('Channel c-00', { exact: true })).toBeAttached();
});

test('Dashboard restores tag and channel chips together with text, and remembers chip removal', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/statuses': { list: { dashboardStatus: STATUSES } },
        'GET /channels': { list: { channel: CHANNELS } },
        'GET /server/channelTags': { set: { channelTag: [{
            id: 'production', name: 'Production', channelIds: { string: ids.slice(0, 2) },
        }] } },
    });
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const filter = page.getByPlaceholder('Enter channel tag or name');
    const chips = page.locator('.filter-chip-host .tag');
    await page.goto('/dashboard');
    await filter.fill('Prod');
    await page.getByRole('option').filter({ hasText: 'Production' }).click();
    await filter.fill('Channel c-02');
    await page.getByRole('option').filter({ hasText: 'Channel c-02' }).click();
    await filter.fill('c-09');
    await go('Channels');
    await go('Dashboard');
    await expect(filter).toHaveValue('c-09');
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: 'Production' })).toHaveCount(1);
    await expect(chips.filter({ hasText: 'Channel c-02' })).toHaveCount(1);
    for (const id of ['c-00', 'c-01', 'c-02']) await expect(page.locator(dashWrap).getByText(`Channel ${id}`, { exact: true })).toBeVisible();
    await expect(page.locator(dashWrap).getByText('Channel c-03', { exact: true })).toHaveCount(0);
    await chips.filter({ hasText: 'Production' }).getByTitle('Remove', { exact: true }).click();
    await chips.filter({ hasText: 'Channel c-02' }).getByTitle('Remove', { exact: true }).click();
    await go('Channels');
    await go('Dashboard');
    await expect(chips).toHaveCount(0);
    await expect(filter).toHaveValue('c-09');
    await expect(page.locator(dashWrap).getByText('Channel c-09', { exact: true })).toBeVisible();
});


test('Dashboard card view remembers text and state filters', async ({ page }) => {
    await mockEngine(page);
    const go = (name: string) => page.getByRole('button', { name, exact: true }).click();
    await page.goto('/dashboard');
    await go('Card view');
    const filter = page.getByPlaceholder('Filter channels & tags…');
    await filter.fill('Demo');
    await page.getByText('Stopped', { exact: true }).first().click();
    await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
    await go('Channels');
    await go('Dashboard');
    await expect(filter).toHaveValue('Demo');
    await expect(page.getByText('Demo Started', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Stopped', exact: true }).click();
    await filter.fill('');
    await go('Channels');
    await go('Dashboard');
    await expect(filter).toHaveValue('');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await expect(page.getByText('Demo Stopped', { exact: true })).toBeVisible();
});
