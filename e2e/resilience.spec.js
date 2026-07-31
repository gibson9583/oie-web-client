import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * What the app does when a render throws.
 *
 * Pinned by causing the REAL failure rather than by asserting on a component in
 * isolation: the lazily-loaded view chunk is swapped for a module whose export
 * throws, so a genuine view really does fail inside the real root that
 * reactView() builds.
 */

/*
 * Replace a view's chunk with a module whose export throws while a page-level flag
 * is set. Two details are load-bearing:
 *
 *   the flag    React RETRIES a render that threw, so a module that throws only
 *               once quietly succeeds on the retry and renders nothing at all —
 *               the failure has to be stable, and switchable from the test to show
 *               that Retry recovers.
 *   returning null  needs no React import, which an injected module cannot get:
 *               'react' is bundled, not in the page's import map.
 */
async function breakView(page, chunk, exportName) {
    await page.addInitScript(() => { window.__failView = true; });
    await page.route(`**/assets/${chunk}-*.js`, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function ${exportName}() {
                   if (window.__failView) throw new Error('deliberate test failure');
                   return null;
               }`
    }));
}

/** Let the broken view render cleanly from the next mount onward. */
const repairView = (page) => page.evaluate(() => { window.__failView = false; });

test.describe('a view that throws', () => {
    test('reports the failure instead of blanking, and the shell survives', async ({ page }) => {
        await mockEngine(page);
        await breakView(page, 'events', 'EventsView');

        await page.goto('/dashboard');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await page.goto('/events');

        const report = page.locator('.view-error');
        await expect(report).toBeVisible();
        await expect(report).toContainText('This view failed to render');
        // The thrown message is shown, not swallowed — it is what identifies the bug.
        await expect(report).toContainText('deliberate test failure');

        /* The point of the boundary: navigation is still there, so you can leave.
           Without one this root empties and the outlet is blank. */
        await expect(page.locator('.topbar')).toBeVisible();
        await expect(page.locator('.rail-nav')).toBeVisible();
        await expect(page.locator('.server-chip')).toBeVisible();
    });

    test('retry remounts the view rather than re-rendering it', async ({ page }) => {
        await mockEngine(page);
        await breakView(page, 'events', 'EventsView');

        await page.goto('/dashboard');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await page.goto('/events');
        await expect(page.locator('.view-error')).toBeVisible();

        /* Clear the fault, then Retry. The boundary rebuilds its children under a
           new key, so the view is constructed afresh and comes back. */
        await repairView(page);
        await page.getByRole('button', { name: 'Retry' }).click();
        await expect(page.locator('.view-error')).toHaveCount(0);
    });

    test('the navigation still works after a view has failed', async ({ page }) => {
        await mockEngine(page);
        await breakView(page, 'events', 'EventsView');

        await page.goto('/dashboard');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await page.goto('/events');
        await expect(page.locator('.view-error')).toBeVisible();

        // Leaving the broken view is the whole point of keeping the rail alive.
        await page.goto('/channels');
        await expect(page.locator('.view-error')).toHaveCount(0);
        await expect(page.getByText('Demo Started')).toBeVisible();
    });
});
