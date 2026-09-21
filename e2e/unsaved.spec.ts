import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Page } from '@playwright/test';

const preventsClose = (page: Page) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});

test('F14: settings participates in close protection and clears it after save/unmount', async ({ page }) => {
    await mockEngine(page, { 'GET /server/settings': { serverSettings: { serverName: 'Original' } },
        'PUT /server/settings': '' });
    await page.goto('/settings');
    const name = page.locator('.field', { has: page.getByText('Server name', { exact: true }) }).locator('input');
    await expect(name).toHaveValue('Original');
    expect(await preventsClose(page)).toBe(false);
    await name.fill('Changed');
    await name.blur();
    expect(await preventsClose(page)).toBe(true);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Server settings saved', { exact: true })).toBeVisible();
    expect(await preventsClose(page)).toBe(false);
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await preventsClose(page)).toBe(false);
});

test('F14: global scripts participates in close protection and unregisters after discard', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page);
    await page.goto('/global-scripts');
    const editor = page.locator('textarea.ce-area').first();
    await expect(editor).toHaveValue('return;');
    expect(await preventsClose(page)).toBe(false);
    await editor.fill('// unsaved\nreturn;');
    expect(await preventsClose(page)).toBe(true);
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: "Don't Save", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await preventsClose(page)).toBe(false);
});
