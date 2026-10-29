import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

/* GET /extensions/disabled hides the matching bundled web UI, like Swing's
   LoadedExtensions. A connector stays selectable on a channel that already uses it. */
const source = (page: Page) => page.locator('.field').filter({ has: page.getByText('Source Connector', { exact: true }) }).locator('select');
const destination = (page: Page) => page.locator('.dest-type-row > select');
const options = (select: any): Promise<string[]> => select.locator('option').allTextContents();

async function settingsPanels(page: Page) {
    return page.evaluate(async () => {
        const pkg = '@oie/web-shell';
        return (await import(pkg)).platform.settingsPanels().map((panel: any) => panel.label);
    });
}

async function openChannel(page: Page, disabled: unknown, channel = makeChannel('disabled-ext')) {
    await mockEngine(page, { 'GET /extensions/disabled': disabled, [`GET /channels/${channel.id}`]: { channel } });
    await page.goto(`/channels/${channel.id}/edit`);
}

test('disabled connectors, steps, and plugins are hidden', async ({ page }) => {
    await openChannel(page, { 'linked-hash-set': { string: ['File Writer', 'Mapper Transformer Step', 'Data Pruner'] } });

    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await expect(source(page)).toBeVisible();
    expect(await options(source(page))).toContain('File Reader');

    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect(destination(page)).toBeVisible();
    const destinationTypes = await options(destination(page));
    expect(destinationTypes).toContain('HTTP Sender');
    expect(destinationTypes).not.toContain('File Writer');

    await expect.poll(() => settingsPanels(page)).not.toContain('Data Pruner');

    await page.goto('/channels/disabled-ext/transformer/0');
    const pane = page.locator('.element-list-pane');
    await pane.getByRole('button', { name: 'Add New Step' }).click();
    await expect(page.locator('.step-item').filter({ hasText: /^JavaScript$/ })).toBeVisible();
    await expect(page.locator('.step-item').filter({ hasText: /^Mapper$/ })).toHaveCount(0);
});

test('a disabled plugin is listed as Disabled on the Extensions page', async ({ page }) => {
    await mockEngine(page, { 'GET /extensions/disabled': { set: { string: 'Data Pruner' } } });
    await page.goto('/extensions');
    const row = page.locator('.panel', { has: page.getByText('Web Administrator Plugins', { exact: true }) })
        .getByRole('row').filter({ hasText: 'Data Pruner' });
    await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
});

test('a channel keeps its current connector type when that connector is disabled', async ({ page }) => {
    await openChannel(page, { set: { string: 'Channel Writer' } });
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await expect(destination(page)).toHaveValue('Channel Writer');
    const types = await options(destination(page));
    expect(types.filter(name => name === 'Channel Writer')).toHaveLength(1);
});

for (const [label, response] of [['fails', { __status: 500, body: {} }], ['is empty', { set: '' }]] as const) {
    test(`everything stays available when the disabled list ${label}`, async ({ page }) => {
        await openChannel(page, response);
        await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
        await expect(destination(page)).toBeVisible();
        expect(await options(destination(page))).toContain('File Writer');
        await expect.poll(() => settingsPanels(page)).toContain('Data Pruner');
    });
}
