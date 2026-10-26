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
