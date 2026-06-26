import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * History-API routing (clean URLs, no '#'). The app uses the browser History API
 * (history.pushState + popstate) via client/core/router.js; the Node server
 * serves index.html for unknown deep paths (SPA fallback), so deep links and
 * refreshes boot straight into the right view, and Back/Forward navigate.
 */
test.describe('history-api routing', () => {
    test('a bare root URL redirects to the dashboard with a clean path', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/');

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible();
        await expect(page).toHaveURL(/\/dashboard$/);
        expect(page.url()).not.toContain('#');
    });

    test('a deep link boots straight into the view (no hash)', async ({ page }) => {
        const id = 'rt-deeplink';
        await mockEngine(page, { [`GET /channels/${id}`]: { channel: makeChannel(id) } });

        await page.goto(`/channels/${id}/edit`);

        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible({ timeout: 15_000 });
        await expect(page).toHaveURL(new RegExp(`/channels/${id}/edit$`));
        expect(page.url()).not.toContain('#');

        // Assets must resolve absolutely (/assets/…), not relative to the deep path
        // (/channels/<id>/assets/…) — the rail logo actually loads.
        const logo = page.locator('.rail-brand img');
        await expect(logo).toBeVisible();
        expect(await logo.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    });

    test('in-app navigation pushes clean URLs and Back/Forward work (popstate)', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.locator('.rail-item.active')).toHaveText(/Dashboard/, { timeout: 15_000 });

        // Navigate within the SPA via the nav rail (router.navigate → pushState).
        await page.getByRole('button', { name: 'Channels', exact: true }).click();
        await expect(page).toHaveURL(/\/channels$/);
        await expect(page.locator('.rail-item.active')).toHaveText(/Channels/);
        expect(page.url()).not.toContain('#');

        // Back → popstate → dashboard re-routes (no full reload).
        await page.goBack();
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.locator('.rail-item.active')).toHaveText(/Dashboard/);

        // Forward → channels again.
        await page.goForward();
        await expect(page).toHaveURL(/\/channels$/);
        await expect(page.locator('.rail-item.active')).toHaveText(/Channels/);
    });

    test('the unsaved-changes guard blocks navigation and rolls the URL back', async ({ page }) => {
        const id = 'rt-guard';
        await mockEngine(page, { [`GET /channels/${id}`]: { channel: makeChannel(id) } });

        await page.goto(`/channels/${id}/edit`);
        const nameField = page.locator('.panel input[type=text]').first();
        await expect(nameField).toHaveValue(`RT ${id}`, { timeout: 15_000 });
        await nameField.fill('Edited Name');   // dirties the channel → arms the nav guard

        // Try to leave via the Dashboard nav item → the guard prompts.
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Unsaved Changes')).toBeVisible();

        // Cancel → stay put; the URL rolls back to the editor (no '#').
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/channels/${id}/edit$`));
        await expect(page.getByRole('button', { name: 'Summary', exact: true })).toBeVisible();
        expect(page.url()).not.toContain('#');
    });
});
