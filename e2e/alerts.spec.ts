import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Alerts list ported to React (multi-select + selection-gated task pane). The
// editor stays the legacy view.
test('Alerts lists alerts and gates task actions on selection/status', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page).toHaveURL(/\/alerts/);

    await expect(page.getByText('Error Alert')).toBeVisible();
    await expect(page.getByText('Deploy Alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Alert' })).toBeVisible();

    // No selection → single-selection actions hidden.
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toHaveCount(0);

    // Select the disabled alert → Edit/Delete appear; Enable shows (it's off),
    // Disable does not.
    await page.locator('tr', { hasText: 'Deploy Alert' }).first().click();
    await expect(page.getByRole('button', { name: 'Edit Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable Alert' })).toHaveCount(0);
});

// The alert editor supports adding actions via the Add button AND a right-click
// menu (Swing parity).
test('alert editor adds an action via right-click', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('button', { name: 'New Alert' }).click();
    await page.getByText('Classic editor').click();
    await expect(page).toHaveURL(/\/alerts\/.*\/edit/);

    await expect(page.getByText('No actions defined')).toBeVisible();
    await page.getByText('No actions defined').click({ button: 'right' });
    await page.getByRole('menu').getByText('Add Action').click();
    await expect(page.getByText('No actions defined')).toHaveCount(0);
});

// The empty landing state offers Create/Import actions (RBAC-gated like their
// task buttons) instead of a bare "No alerts" table.
test('an empty alert list lands on the create/import empty state', async ({ page }) => {
    await mockEngine(page, { 'GET /alerts': { list: '' } });
    await page.goto('/alerts');

    await expect(page.getByText('No Alerts Configured')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Alert' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Alert', exact: true }).last()).toBeVisible();

    // Create Alert opens the same New Alert chooser flow as the task button
    // (no saved default in a fresh session → the chooser modal).
    await page.getByRole('button', { name: 'Create Alert' }).click();
    await expect(page.getByText('Classic editor')).toBeVisible();
});

test('importing an alert with a duplicate name can overwrite the existing id', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByText('Error Alert', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({
        name: 'duplicate-alert.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<alertModel version="4.5.0"><id>foreign-id</id><name>Error Alert</name><enabled>true</enabled></alertModel>')
    });

    const dialog = page.getByRole('dialog', { name: 'Import Alert' });
    await expect(dialog.getByRole('button', { name: 'Create New', exact: true })).toBeVisible();
    const requestPromise = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/alerts');
    await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
    const body = (await requestPromise).postData() || '';
    expect(body).toContain('<id>al-1</id>');
    expect(body).not.toContain('foreign-id');
});

test('importing an alert with a duplicate name can create a renamed alert with a new id', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByText('Error Alert', { exact: true })).toBeVisible();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({
        name: 'duplicate-alert.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<alertModel version="4.5.0"><id>foreign-id</id><name>Error Alert</name><enabled>true</enabled></alertModel>')
    });

    await page.getByRole('dialog', { name: 'Import Alert' })
        .getByRole('button', { name: 'Create New', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Import Alert' });
    await rename.getByRole('textbox').fill('Imported Error Alert');
    const requestPromise = page.waitForRequest(request =>
        request.method() === 'POST' && new URL(request.url()).pathname === '/api/alerts');
    await rename.getByRole('button', { name: 'OK', exact: true }).click();

    const body = (await requestPromise).postData() || '';
    expect(body).toContain('<name>Imported Error Alert</name>');
    expect(body).not.toContain('foreign-id');
    expect(body).not.toContain('<id>al-1</id>');
});

test('alert import blocks an export from a newer server version', async ({ page }) => {
    let imported = false;
    page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/alerts') imported = true;
    });
    await page.goto('/alerts');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({
        name: 'future-alert.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<alertModel version="4.6.0"><id>future-id</id><name>Future Alert</name><enabled>true</enabled></alertModel>')
    });

    const dialog = page.getByRole('dialog', { name: 'Information' });
    await expect(dialog).toContainText('cannot be imported, because it originated from a newer version');
    expect(imported).toBe(false);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    expect(imported).toBe(false);
});

test('alert import can confirm and migrate an older export', async ({ page }) => {
    await page.goto('/alerts');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({
        name: 'older-alert.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<alertModel version="4.4.0"><id>older-id</id><name>Older Alert</name><enabled>true</enabled></alertModel>')
    });

    const dialog = page.getByRole('dialog', { name: 'Select an Option' });
    await expect(dialog).toContainText('automatically convert the alert');
    const request = page.waitForRequest(value =>
        value.method() === 'POST' && new URL(value.url()).pathname === '/api/alerts');
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click();
    expect((await request).postData()).toContain('<id>older-id</id>');
});
