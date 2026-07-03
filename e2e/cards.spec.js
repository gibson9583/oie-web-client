import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Card view — the modern card view of the Dashboard. It's one of the Dashboard's
 * two interchangeable looks (the other is the classic table); there's a single
 * "Dashboard" nav item and a remembered `dashboardView` preference. Tests reach
 * the cards via the "Card view" toggle in the Dashboard Tasks rail. Uses the same
 * channel-status data as the classic table (GET /channels/statuses).
 */

// Land on the Dashboard and switch to the card view.
async function openCards(page) {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Card view' }).click();
    await expect(page.getByPlaceholder('Filter channels & tags…')).toBeVisible();
}

test.describe('card view', () => {
    test('shows the summary and channel cards', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);

        // Channel cards (from the sample statuses) + a summary stat.
        await expect(page.getByText('Demo Started')).toBeVisible();
        await expect(page.getByText('Demo Stopped')).toBeVisible();
        await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
    });

    test('filters channels by name', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        await expect(page.getByText('Demo Stopped')).toBeVisible();

        await page.getByPlaceholder('Filter channels & tags…').fill('Started');
        await expect(page.getByText('Demo Started')).toBeVisible();
        await expect(page.getByText('Demo Stopped')).toHaveCount(0);
    });

    test('groups by state into collapsible sections', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);

        await page.locator('select').first().selectOption('state');
        // Cards still render, now under state sections.
        await expect(page.getByText('Demo Started')).toBeVisible();
        await expect(page.getByText('Demo Stopped')).toBeVisible();
    });

    test('double-clicking a card opens the message browser', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        await page.getByText('Demo Started').dblclick();
        await expect(page).toHaveURL(/\/messages\/c-started/);
    });

    test('remembers the group-by choice across reloads', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        await page.locator('select').first().selectOption('state');
        await page.reload();
        // The view preference persists too, so we land back on the cards.
        await expect(page.locator('select').first()).toHaveValue('state');
    });

    test('multi-selects cards and shows gated tasks in the Dashboard Tasks rail', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        // Selecting a started + a stopped channel surfaces both Start and Stop tasks.
        await page.getByText('Demo Started').click();
        await page.getByText('Demo Stopped').click({ modifiers: ['ControlOrMeta'] });
        const rail = page.locator('.taskbar');
        await expect(rail.getByText('Stop', { exact: true })).toBeVisible();
        await expect(rail.getByText('Start', { exact: true })).toBeVisible();
    });

    test('clicking a selected card again deselects it', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        const rail = page.locator('.taskbar');
        await page.getByText('Demo Started').click();
        await expect(rail.getByText('Stop', { exact: true })).toBeVisible();
        // Clicking the same card again clears the selection — no explicit deselect action.
        await page.getByText('Demo Started').click();
        await expect(rail.getByText('Stop', { exact: true })).toHaveCount(0);
    });

    test('right-clicking a card opens an actions menu', async ({ page }) => {
        await mockEngine(page);
        await openCards(page);
        await page.getByText('Demo Stopped').click({ button: 'right' });
        await expect(page.locator('.ctx-menu')).toBeVisible();
        await expect(page.locator('.ctx-menu').getByText('Start')).toBeVisible();
    });

    test('is an alternate of the classic table under one Dashboard nav item', async ({ page }) => {
        await mockEngine(page);
        // The Dashboard defaults to the classic table (offers a "Card view" toggle).
        await page.goto('/dashboard');
        await expect(page.getByRole('button', { name: 'Card view' })).toBeVisible();
        await expect(page.getByPlaceholder('Filter channels & tags…')).toHaveCount(0);

        // Switch to cards, then back to the table via the rail toggles.
        await page.getByRole('button', { name: 'Card view' }).click();
        await expect(page.getByPlaceholder('Filter channels & tags…')).toBeVisible();
        await page.getByRole('button', { name: 'Table view' }).click();
        await expect(page.getByPlaceholder('Filter channels & tags…')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Card view' })).toBeVisible();

        // There is no separate card-view nav item — the Dashboard is the single entry.
        await expect(page.getByRole('link', { name: 'Monitor' })).toHaveCount(0);
    });
});
