import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Events is the first medium view ported: criteria bar + DataTableHost +
// pagination + a React detail pane driven by selection.
test('Events lists results and shows detail on selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(page).toHaveURL(/\/events/);

    // Criteria bar + task pane.
    await expect(page.getByRole('button', { name: 'Export All Events' })).toBeVisible();

    // Results render through the table (level/outcome tags + names).
    await expect(page.getByText('Server startup')).toBeVisible();
    await expect(page.getByText('Channel deploy failed')).toBeVisible();

    // Detail pane: empty until a row is selected, then it shows the event.
    await expect(page.getByText('Select an event to view its details.')).toBeVisible();
    await page.locator('tr', { hasText: 'Server startup' }).first().click();
    await expect(page.getByText('Select an event to view its details.')).toHaveCount(0);
    // The selected event's id (101) appears only in the detail summary.
    await expect(page.getByText('101', { exact: true })).toBeVisible();
});

test('Events table columns are resizable + reorderable (like the dashboard)', async ({ page }) => {
    await page.goto('/events');
    const table = page.locator('.dt-wrap table.dt').first();
    // decorateColumns wired: fixed-layout table with a colgroup + resize grabbers,
    // draggable headers for reordering.
    await expect(table).toHaveClass(/dt-resizable/);
    await expect(table.locator('colgroup')).toHaveCount(1);
    await expect(table.locator('thead .col-resize').first()).toBeAttached();
    await expect(table.locator('thead th[draggable="true"]').first()).toBeAttached();
});
