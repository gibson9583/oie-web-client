import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Page } from '@playwright/test';

/*
 * Issue #74: an unsaved new channel or alert is protected from a tab close or
 * reload, and a reload that loses it lands on the list instead of an error.
 */

const preventsClose = (page: Page) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});

test('an untouched new channel is close-protected in the editor and its transformer', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels');
    await page.getByRole('button', { name: 'New Channel' }).first().click();
    const classic = page.getByRole('button', { name: /Classic/ });
    if (await classic.count()) await classic.first().click();
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
    expect(await preventsClose(page)).toBe(true);

    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    await expect(page.getByRole('tab', { name: 'Generated Script', exact: true })).toBeVisible();
    expect(await preventsClose(page)).toBe(true);

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: "Don't Save", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await preventsClose(page)).toBe(false);
});

test('reloading an unsaved new channel returns to the channel list', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels/lost-new-channel/edit?new=1');
    await expect(page).toHaveURL(/\/channels$/);
    await expect(page.getByText('The unsaved new channel was discarded.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await preventsClose(page)).toBe(false);
});

test('a stale channel link reports the missing channel and returns to the list', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels/deleted-channel/edit');
    await expect(page).toHaveURL(/\/channels$/);
    await expect(page.getByRole('dialog').getByText('Channel deleted-channel was not found.')).toBeVisible();
});

test('reloading an unsaved new channel transformer returns to the channel list', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels/lost-new-channel/transformer/0');
    await expect(page).toHaveURL(/\/channels$/);
    await expect(page.getByRole('dialog').getByText('Channel lost-new-channel was not found.')).toBeVisible();
});

test('reloading an unsaved new alert returns to the alert list', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/alerts/lost-new-alert/edit?new=1');
    await expect(page).toHaveURL(/\/alerts$/);
    await expect(page.getByText('The unsaved new alert was discarded.', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await preventsClose(page)).toBe(false);
});
