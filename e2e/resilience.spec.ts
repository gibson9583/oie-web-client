import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * What the app does when something breaks — a render that throws, and an engine
 * that stops answering.
 *
 * Both are pinned by causing the REAL failure rather than by asserting on a
 * component in isolation:
 *
 *   the throw   the lazily-loaded view chunk is swapped for a module whose export
 *               throws on first render, so a genuine view really does fail inside
 *               the real root that reactView() builds
 *   the outage  every /api call is aborted at the network layer, which is what a
 *               stopped engine looks like from the browser — a rejected fetch, not
 *               an error status
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
async function breakView(page: any, chunk: any, exportName: any) {
    await page.addInitScript(() => { (window as any).__failView = true; });
    await page.route(`**/assets/${chunk}-*.js`, (route: any) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function ${exportName}() {
                   if (window.__failView) throw new Error('deliberate test failure');
                   return null;
               }`
    }));
}

/** Let the broken view render cleanly from the next mount onward. */
const repairView = (page: any) => page.evaluate(() => { (window as any).__failView = false; });

test.describe('an engine endpoint that fails', () => {
    test('a 500 on a view load is reported, dismissible, and the shell survives', async ({ page }) => {
        // The Events view searches on mount; the engine answers it with a 500.
        await mockEngine(page, { 'GET /events': { __status: 500, body: { message: 'database gone' } } });
        await page.goto('/events');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

        // The failure lands in the acknowledge-to-dismiss error dialog (not a
        // transient toast), naming the operation that failed.
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('Event search failed');
        // The footer's primary Close (the header has an icon-button named Close too).
        await dialog.locator('button.btn-primary', { hasText: 'Close' }).click();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // The view rendered its empty state rather than blanking, and the shell
        // still navigates.
        await expect(page.locator('.topbar')).toBeVisible();
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    });
});

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

test.describe('connection status in the status bar', () => {
    /* The chrome splits the two facts rather than repeating one of them: the topbar
       chip says WHICH engine (stable, glanced at once), the status bar says whether
       it is answering (changes, looked at when something seems wrong). So the chip
       carries no pip at all, and the assertions below hold it still while the bottom
       moves. */
    const barPip = (page: any) => page.locator('.statusbar .pip');

    test('healthy: identity up top, an ok pip down below', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        await expect(page.locator('.server-chip')).toContainText('E2E Engine');
        await expect(page.locator('.server-chip .pip')).toHaveCount(0);   // no status dot up top
        await expect(barPip(page)).toHaveClass(/\bok\b/);
        // The engine's own Environment - Server Name reaches the bar. Only the
        // identity is asserted: the configured engine name beside it comes from
        // the server's config.json, which differs per install (none in CI). The
        // full "name | identity" join is pinned in engine-plugins.spec.ts with
        // a routed config.
        await expect(page.locator('.statusbar')).toContainText('test - E2E Engine as admin');
    });

    test('the chip keeps showing which engine even while that engine is down', async ({ page, context }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        const identity = await page.locator('.server-chip').innerText();

        await context.setOffline(true);
        await expect(barPip(page)).toHaveClass(/\berr\b/);
        // Which engine you are pointed at has not changed, so neither has the chip.
        await expect(page.locator('.server-chip')).toHaveText(identity);
        await expect(page.locator('.server-chip .pip')).toHaveCount(0);

        await context.setOffline(false);
        await expect(barPip(page)).toHaveClass(/\bok\b/, { timeout: 15_000 });
        await expect(page.locator('.server-chip')).toHaveText(identity);
    });

    test('the status bar keeps its clock and truncates only the message', async ({ page, context }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        await context.setOffline(true);
        await expect(barPip(page)).toBeVisible();
        // The pip must not be what gets clipped when the message is long.
        const pipWidth = await barPip(page).evaluate((e: any) => e.getBoundingClientRect().width);
        expect(pipWidth).toBeGreaterThan(0);
        await expect(page.locator('.statusbar > .ml-auto')).not.toBeEmpty();
    });

    test('a browser with no network says so, and does not blame the engine', async ({ page, context }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        await context.setOffline(true);
        await expect(barPip(page)).toHaveClass(/\berr\b/);
        await expect(page.locator('.statusbar')).toContainText('No network connection');
        // The distinction that matters: this is the browser's fault, not the engine's.
        await expect(page.locator('.statusbar')).not.toContainText('Engine unreachable');
        // Nothing to retry against while the NIC is down, so no affordance is offered.
        await expect(page.locator('.status-retry')).toHaveCount(0);

        await context.setOffline(false);
        await expect(barPip(page)).toHaveClass(/\bok\b/, { timeout: 15_000 });
    });

    test('an engine that stops answering is reported while the browser stays online', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        // A stopped engine: the fetch is refused, which never reaches a status code.
        await page.route('**/api/**', (route) => route.abort('connectionrefused'));

        /* Discovery rides on requests the app already makes — there is no heartbeat
           of ours. Refresh rather than waiting on the background poll: the poll is
           the real-world path but fires on the user's dashboard interval (20s by
           default, and configurable), which would make this a race against a
           preference rather than a test of the behaviour. */
        await page.getByRole('button', { name: 'Refresh' }).first().click();
        await expect(page.locator('.statusbar')).toContainText('Engine unreachable', { timeout: 15_000 });
        // warn, not err: the browser is fine, so this is not the same fault as offline.
        await expect(barPip(page)).toHaveClass(/\bwarn\b/);
        // Retrying by hand moved here from the chip; it must still be reachable.
        await expect(page.locator('.status-retry')).toBeVisible();
    });

    test('it recovers on its own once the engine answers again', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();

        await page.route('**/api/**', (route) => route.abort('connectionrefused'));
        await page.getByRole('button', { name: 'Refresh' }).first().click();
        await expect(page.locator('.statusbar')).toContainText('Engine unreachable', { timeout: 15_000 });

        // Engine back. The backoff probe should notice without anyone clicking.
        await page.unroute('**/api/**');
        await mockEngine(page);
        await expect(barPip(page)).toHaveClass(/\bok\b/, { timeout: 30_000 });
        await expect(page.locator('.statusbar')).toContainText('Connected to:');
    });
});
