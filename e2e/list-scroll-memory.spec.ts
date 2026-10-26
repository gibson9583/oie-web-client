import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

/*
 * Swing parity: the Dashboard and Channels lists keep their scroll position
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

test('Dashboard and Channels restore their scroll position on return', async ({ page }) => {
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
    await scrollTo(dashWrap, 600);
    await expect.poll(() => scrollTop(dashWrap)).toBe(600);

    await go('Channels');
    await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();
    // First visit starts at the top.
    expect(await scrollTop(channelsWrap)).toBe(0);
    await scrollTo(channelsWrap, 400);
    await expect.poll(() => scrollTop(channelsWrap)).toBe(400);

    await go('Dashboard');
    await expect(page.locator(dashWrap)).toBeVisible();
    await expect.poll(() => scrollTop(dashWrap)).toBe(600);

    await go('Channels');
    await expect(page.locator(channelsWrap)).toBeVisible();
    await expect.poll(() => scrollTop(channelsWrap)).toBe(400);
});

for (const delayed of ['statuses', 'groups'] as const) {
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
            'GET /channels': { list: { channel: CHANNELS } },
        });
        const scrollTop = () => page.locator(dashWrap).evaluate((el) => el.scrollTop);
        const rows = page.locator(dashWrap).locator('tbody tr');

        await page.goto('/dashboard');
        await expect(rows).toHaveCount(COUNT + GROUPS.length);
        await page.locator(dashWrap).evaluate((el) => {
            // Beyond the ungrouped table's scroll range, to catch early clamping.
            el.scrollTop = 2500;
            return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        await expect.poll(scrollTop).toBe(2500);
        await page.getByRole('button', { name: 'Channels', exact: true }).click();
        await expect(page.locator(channelsWrap).getByText('Channel c-00', { exact: true })).toBeAttached();

        // Inactive queries expire after five minutes. Exercise both response
        // orders so neither status placeholders nor missing groups consume it.
        await page.clock.fastForward(301_000);
        holdResponse = true;
        const before = calls;
        try {
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect.poll(() => calls).toBeGreaterThan(before);
            await expect(rows).toHaveCount(delayed === 'statuses' ? 1 : COUNT + 1);
            await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        } finally {
            releaseResponse();
        }
        await expect(rows).toHaveCount(COUNT + GROUPS.length);
        await expect.poll(scrollTop).toBe(2500);
    });
}
