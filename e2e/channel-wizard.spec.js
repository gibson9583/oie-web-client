import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Guided channel wizard: the New Channel chooser, the step flow, name validation,
 * and Create → completion. The wizard produces a normal channel (POST /channels),
 * so the mock's default fixtures cover it.
 */

test.describe('channel wizard', () => {
    test('New Channel chooser offers classic and guided, and routes to the wizard', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels');

        await page.getByRole('button', { name: 'New Channel' }).first().click();
        await expect(page.getByText('Guided setup')).toBeVisible();
        await expect(page.getByText('Classic editor')).toBeVisible();

        await page.getByText('Guided setup').click();
        await expect(page).toHaveURL(/\/channels\/new\/guided/);
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();
    });

    test('walks Basics → Source → Destinations → Review → Create', async ({ page }) => {
        let posted = false;
        page.on('request', (r) => {
            if (r.method() === 'POST' && /\/api\/channels$/.test(new URL(r.url()).pathname)) posted = true;
        });
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();

        // Basics — Next is disabled until a name is entered.
        const next = page.getByRole('button', { name: 'Next', exact: true });
        await expect(next).toBeDisabled();
        await page.locator('.view-body input').first().fill('Wizard Channel');
        await expect(next).toBeEnabled();
        await next.click();

        // Source — transport picker with the default Channel Reader.
        await expect(page.getByText('Connector type')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Channel Reader' })).toBeVisible();
        await page.getByRole('button', { name: 'Next', exact: true }).click();

        // Destinations — default Destination 1 present.
        await expect(page.getByText('Destination 1')).toBeVisible();
        await page.getByRole('button', { name: 'Next', exact: true }).click();

        // Review then Create.
        await expect(page.getByText('Wizard Channel')).toBeVisible();
        await page.getByRole('button', { name: 'Create Channel' }).click();

        await expect(page.getByText('Channel created')).toBeVisible({ timeout: 10_000 });
        expect(posted).toBe(true);
    });

    test('blocks a duplicate channel name', async ({ page }) => {
        await mockEngine(page, {
            // idsAndNames wire shape: a single 'map' root key the proxy unwraps to
            // { entry: [ { string: [id, name] } ] }.
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['abc', 'Taken Name'] }] } },
        });
        await page.goto('/channels/new/guided');
        await expect(page.getByText('Basics', { exact: true })).toBeVisible();

        await page.locator('.view-body input').first().fill('Taken Name');
        await expect(page.getByText(/already exists/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    });

    test('adds a second destination', async ({ page }) => {
        await mockEngine(page);
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Multi Dest');
        await page.getByRole('button', { name: 'Next', exact: true }).click();   // Source
        await page.getByRole('button', { name: 'Next', exact: true }).click();   // Destinations

        await expect(page.getByText('Destination 1')).toBeVisible();
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.getByText('Destination 2')).toBeVisible();
    });
});
