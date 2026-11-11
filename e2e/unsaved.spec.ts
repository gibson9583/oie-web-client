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

test('Configuration Map value modal marks dirty only on edit, restores previous status on cancel, discards on leave without saving, and persists open edits on save', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const writes: string[] = [];
    await mockEngine(page, {
        'GET /server/configurationMap': { map: { entry: [
            { string: 'app.name', 'com.mirth.connect.util.ConfigurationProperty': { value: 'Alpha', comment: 'Initial comment' } }
        ] } },
        'PUT /server/configurationMap': (request: any) => {
            writes.push(request.postData() || '');
            return '';
        }
    });

    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Configuration Map', exact: true }).click();

    const firstRow = page.locator('table.dt tbody tr').first();
    const keyInput = firstRow.locator('td').nth(0).locator('input');
    const valueCell = firstRow.locator('td').nth(1);
    const valueInput = valueCell.locator('input');
    const commentInput = firstRow.locator('td').nth(2).locator('input');

    await expect(keyInput).toHaveValue('app.name');
    await expect(valueInput).toHaveValue('Alpha');
    expect(await preventsClose(page)).toBe(false);

    // 1. Opening modal does NOT mark dirty; closing without edits leaves view clean
    await valueCell.click();
    const editorModal = page.getByRole('dialog', { name: /Value — app\.name/ });
    await expect(editorModal).toBeVisible();
    expect(await preventsClose(page)).toBe(false);

    await editorModal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editorModal).toHaveCount(0);
    expect(await preventsClose(page)).toBe(false);
    await expect(valueInput).toHaveValue('Alpha');

    // 2. Modifying value marks dirty; cancelling modal restores clean status and discards draft
    await valueCell.click();
    await expect(editorModal).toBeVisible();
    const editorArea = editorModal.locator('textarea.ce-area');
    await editorArea.fill('Beta');
    await expect(page.getByRole('dialog', { name: 'Value — app.name *', exact: true })).toBeVisible();
    expect(await preventsClose(page)).toBe(true);

    await editorModal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editorModal).toHaveCount(0);
    expect(await preventsClose(page)).toBe(false);
    await expect(valueInput).toHaveValue('Alpha');

    // 3. Setting value -> navigating back -> cancelling leave keeps modal open and dirty
    await valueCell.click();
    await expect(editorModal).toBeVisible();
    await editorArea.fill('Gamma');
    expect(await preventsClose(page)).toBe(true);

    await page.goBack();
    const unsavedDialog = page.getByRole('dialog', { name: 'Unsaved Changes', exact: true });
    await expect(unsavedDialog).toBeVisible();

    await unsavedDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editorModal).toBeVisible();
    expect(await preventsClose(page)).toBe(true);

    // 4. Navigating back -> "Don't Save" navigates away without sending PUT requests
    await page.goBack();
    await expect(unsavedDialog).toBeVisible();
    await unsavedDialog.getByRole('button', { name: "Don't Save", exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await preventsClose(page)).toBe(false);
    expect(writes).toHaveLength(0);

    // Revisit settings tab to verify the value remained untouched
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Configuration Map', exact: true }).click();
    await expect(valueInput).toHaveValue('Alpha');
    expect(await preventsClose(page)).toBe(false);

    // 5. When table was already dirty before opening modal, closing modal preserves dirty state
    await commentInput.fill('Updated comment');
    expect(await preventsClose(page)).toBe(true);

    await valueCell.click();
    await expect(editorModal).toBeVisible();
    await editorModal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editorModal).toHaveCount(0);
    expect(await preventsClose(page)).toBe(true);

    // 6. When dirty and navigating back -> "Save Changes" saves both table edits and open modal edits
    await valueCell.click();
    await expect(editorModal).toBeVisible();
    await editorArea.fill('Delta');
    await expect(page.getByRole('dialog', { name: 'Value — app.name *', exact: true })).toBeVisible();

    await page.goBack();
    await expect(unsavedDialog).toBeVisible();
    await unsavedDialog.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator('.modal')).toHaveCount(0);
    expect(await preventsClose(page)).toBe(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('Delta');
    expect(writes[0]).toContain('Updated comment');
});