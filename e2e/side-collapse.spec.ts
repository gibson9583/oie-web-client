import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/*
 * Collapsible side rails (react/ui.jsx useSideCollapse + CollapsedSideStrip):
 * the filter/transformer Reference panel and the Destination Mappings rails
 * collapse to a slim strip and come back on a click. The flag persists in
 * localStorage per rail name, and the two mappings rails (classic editor,
 * wizard) share one name — collapsing either collapses both.
 */

const CHANNEL_ID = 'collapse-channel';
const FIXTURES = { [`GET /channels/${CHANNEL_ID}`]: { channel: makeChannel(CHANNEL_ID) } };

const next = (page: any) => page.getByRole('button', { name: 'Next', exact: true });

test('transformer reference panel collapses to a strip, restores, and survives a reload', async ({ page }) => {
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${CHANNEL_ID}/transformer/0`);

    const wrap = page.locator('.split-reflow > .split-b');
    const handle = page.locator('.split-reflow > .split-handle[data-orient="h"]');
    await expect(page.getByRole('tab', { name: 'Message Trees', exact: true })).toBeVisible();
    await expect(handle).toBeVisible();

    // Collapse: tabs give way to the strip, the wrapper squeezes down, and the
    // splitter disappears (nothing left to drag).
    await page.getByRole('button', { name: 'Hide the reference panel' }).click();
    await expect(page.getByRole('tab', { name: 'Reference', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show Reference' })).toBeVisible();
    await expect(handle).toBeHidden();
    expect((await wrap.boundingBox())!.width).toBeLessThan(50);

    // Expand from the strip.
    await page.getByRole('button', { name: 'Show Reference' }).click();
    await expect(page.getByRole('tab', { name: 'Message Trees', exact: true })).toBeVisible();
    await expect(handle).toBeVisible();
    expect((await wrap.boundingBox())!.width).toBeGreaterThan(300);

    // The strip is named after whichever tab was active when it collapsed.
    await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Hide the reference panel' }).click();
    await expect(page.getByRole('button', { name: 'Show Message Templates' })).toBeVisible();

    // The collapse persists (localStorage) across a reload; the tab choice is
    // session state and resets to Reference.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show Reference' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reference', exact: true })).toHaveCount(0);
});

test('destination mappings rail collapses to a strip and back', async ({ page }) => {
    await mockEngine(page, FIXTURES);
    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();

    await expect(page.locator('.dest-mappings .panel-header')).toContainText('Destination Mappings');
    await page.getByRole('button', { name: 'Hide Destination Mappings' }).click();
    await expect(page.locator('.dest-mappings')).toHaveCount(0);

    await page.getByRole('button', { name: 'Show Destination Mappings' }).click();
    await expect(page.locator('.dest-mappings .panel-header')).toContainText('Destination Mappings');
});

test('the wizard rail shares the classic editor\'s collapsed state', async ({ page }) => {
    await mockEngine(page, FIXTURES);

    // Collapse the rail in the classic editor …
    await page.goto(`/channels/${CHANNEL_ID}/edit`);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await page.getByRole('button', { name: 'Hide Destination Mappings' }).click();
    await expect(page.getByRole('button', { name: 'Show Destination Mappings' })).toBeVisible();

    // … and the wizard's Destinations step starts with the strip.
    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('Collapse Channel');
    await next(page).click();   // Dependencies
    await next(page).click();   // Channel Options
    await next(page).click();   // Source
    await next(page).click();   // Destinations
    await expect(page.getByRole('button', { name: 'Show Destination Mappings' })).toBeVisible();

    // Expanding here brings the full rail back (and would un-collapse the classic one too).
    await page.getByRole('button', { name: 'Show Destination Mappings' }).click();
    await expect(page.locator('.panel-header', { hasText: 'Destination Mappings' })).toBeVisible();
});
