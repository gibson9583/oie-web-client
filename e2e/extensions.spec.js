import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

/*
 * Extensions is a React port: two metadata grids (Connectors / Plugins) sharing
 * one single selection, a read-only Web Administrator Plugins grid, and a
 * selection-gated Extension Tasks pane. These fixtures give the connectors/
 * plugins maps real rows and a per-extension enabled flag so the grids and the
 * Enable/Disable gating are exercised. The Web Administrator Plugins grid is fed
 * from the on-disk plugin loader (environment-dependent), so assertions/clicks
 * are scoped to the Connectors/Plugins panels to avoid name collisions.
 */
const FIXTURES = {
    'GET /extensions/connectors': { map: { entry: [
        { string: 'File Reader', connectorMetaData: { name: 'File Reader', author: 'OIE', pluginVersion: '4.5.0', '@path': 'fileconnector' } }
    ] } },
    'GET /extensions/plugins': { map: { entry: [
        { string: 'Data Pruner', pluginMetaData: { name: 'Data Pruner', author: 'OIE', pluginVersion: '4.5.0', '@path': 'datapruner' } }
    ] } },
    // Per-extension enabled flag. The path segment is URL-encoded ("File%20Reader"),
    // so resolve from the decoded name: connector disabled, plugin enabled.
    'GET /extensions/*/enabled': (req) => {
        const name = decodeURIComponent(new URL(req.url()).pathname.split('/').slice(-2, -1)[0]);
        return name === 'Data Pruner' ? 'true' : 'false';
    },
    // java.util.Properties wire shape: unwrap() strips the single root key, so
    // wrap in "properties" to leave the inner "property" array intact.
    'GET /extensions/*/properties': { properties: { property: [
        { '@name': 'pollInterval', $: '1000' }
    ] } },
    'POST /extensions/*/_setEnabled': '',
};

/* Rows inside a named panel (Connectors / Plugins), away from the Web
   Administrator Plugins grid which is populated from disk. */
function panel(page, header) {
    return page.locator('.panel', { has: page.getByText(header, { exact: true }) });
}

test.beforeEach(async ({ page }) => {
    await mockEngine(page, FIXTURES);
});

test('Extensions lists connectors and plugins and gates the task pane on selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Extensions', exact: true }).click();
    await expect(page).toHaveURL(/\/extensions/);

    // Each metadata grid renders its row in its own panel.
    await expect(panel(page, 'Connectors').getByRole('cell', { name: 'File Reader', exact: true })).toBeVisible();
    await expect(panel(page, 'Plugins').getByRole('cell', { name: 'Data Pruner', exact: true })).toBeVisible();

    // Always-on task buttons are present in the (portaled) Extension Tasks pane.
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install Extension', exact: true })).toBeVisible();

    // Selection-gated buttons are hidden until a row is selected.
    await expect(page.getByRole('button', { name: 'Properties', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Uninstall', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(0);

    // Selecting the disabled connector reveals Enable (not Disable) + Properties + Uninstall.
    await panel(page, 'Connectors').locator('tr', { hasText: 'File Reader' }).first().click();
    await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Properties', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Uninstall', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(0);
});

const STUB_ZIP = { name: 'ext.zip', mimeType: 'application/zip', buffer: Buffer.from('PK stub') };

test('installing a package with no web UI says so (not a silent success)', async ({ page }) => {
    await mockEngine(page, { ...FIXTURES, 'POST /_webadmin/plugins/_install': { engineInstalled: true, webInstalled: false } });
    await page.goto('/extensions');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Install Extension', exact: true }).click();
    await (await chooser).setFiles(STUB_ZIP);

    await expect(page.getByText('No web UI was found in this package')).toBeVisible();
});

test('installing a package with a web UI reports it was added', async ({ page }) => {
    await mockEngine(page, { ...FIXTURES, 'POST /_webadmin/plugins/_install': { engineInstalled: true, webInstalled: true, pluginId: 'demo' } });
    await page.goto('/extensions');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Install Extension', exact: true }).click();
    await (await chooser).setFiles(STUB_ZIP);

    await expect(page.getByText('Its web UI was added')).toBeVisible();
});

test('Extensions shows Disable for an enabled extension and the two grids share one selection', async ({ page }) => {
    await page.goto('/extensions');

    // The enabled plugin offers Disable, not Enable.
    await panel(page, 'Plugins').locator('tr', { hasText: 'Data Pruner' }).first().click();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enable', exact: true })).toHaveCount(0);

    // Selecting in the connectors grid takes over the single selection: the
    // gated action flips to Enable (the connector is disabled).
    await panel(page, 'Connectors').locator('tr', { hasText: 'File Reader' }).first().click();
    await expect(page.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disable', exact: true })).toHaveCount(0);
});

test('Extensions Properties opens a modal for the selected extension', async ({ page }) => {
    await page.goto('/extensions');

    await panel(page, 'Connectors').locator('tr', { hasText: 'File Reader' }).first().click();
    await page.getByRole('button', { name: 'Properties', exact: true }).click();

    // The properties modal renders the key/value from the fixture and a Close button.
    await expect(page.getByText('File Reader — Properties', { exact: true })).toBeVisible();
    await expect(page.getByText('pollInterval', { exact: true })).toBeVisible();
    // The footer Close button (not the title-bar X icon, which also reads "Close").
    await expect(page.locator('.modal-foot').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
});
