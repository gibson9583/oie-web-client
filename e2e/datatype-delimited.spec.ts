import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Page } from '@playwright/test';

const PKG = 'com.mirth.connect.plugins.datatypes.delimited';
const properties = (widths: any = null, names: any = null) => ({
    '@class': `${PKG}.DelimitedDataTypeProperties`, '@version': '4.6.0', future: { keep: 'unknown' },
    serializationProperties: { '@class': `${PKG}.DelimitedSerializationProperties`, '@version': '4.6.0', columnDelimiter: ',', recordDelimiter: '\\n', columnWidths: widths, columnNames: names, quoteToken: '"', quoteEscapeToken: '\\', escapeWithDoubleQuote: true, numberedRows: false, ignoreCR: true, future: 17 },
    deserializationProperties: { '@class': `${PKG}.DelimitedDeserializationProperties`, '@version': '4.6.0', columnDelimiter: ',', recordDelimiter: '\\n', columnWidths: widths, quoteToken: '"', quoteEscapeToken: '\\', escapeWithDoubleQuote: true },
});
function fixture() {
    const channel = makeChannel('delimited-arrays');
    for (const connector of [channel.sourceConnector, channel.destinationConnectors.connector[0]]) {
        for (const transformer of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
            for (const side of ['inbound', 'outbound']) {
                transformer[`${side}DataType`] = 'DELIMITED';
                transformer[`${side}Properties`] = properties();
            }
        }
    }
    return channel;
}
async function setup(page: Page, channel = fixture(), surface = 'edit') {
    let server = structuredClone(channel);
    const writes: any[] = [];
    await mockEngine(page, { [`GET /channels/${channel.id}`]: { channel: server } });
    await page.route(url => url.pathname === `/api/channels/${channel.id}`, async route => {
        if (route.request().method() === 'PUT') {
            server = JSON.parse(route.request().postData()!).channel;
            writes.push(structuredClone(server));
            return route.fulfill({ status: 200, contentType: 'text/plain', body: 'true' });
        }
        if (route.request().method() === 'GET') return route.fulfill({ status: 200, json: { channel: server } });
        return route.fallback();
    });
    await page.goto(`/channels/${channel.id}/${surface}`);
    return writes;
}
async function dialog(page: Page) {
    await page.getByRole('button', { name: 'Set Data Types', exact: true }).click();
    return page.getByRole('dialog', { name: 'Set Data Types', exact: true });
}
async function save(page: Page, writes: any[], expected: number) {
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(expected);
    await expect(page.locator('.toast').filter({ hasText: 'Saved' }).first()).toBeVisible();
}

test('Delimited defaults omit arrays and a save repairs legacy null/empty arrays on every transformer side', async ({ page }) => {
    const channel = fixture();
    channel.destinationConnectors.connector[0].responseTransformer.inboundProperties.serializationProperties.columnWidths = { int: [] };
    const writes = await setup(page, channel);
    const modal = await dialog(page);
    const rows = modal.locator('table.dt tbody tr');
    await rows.nth(0).locator('select').first().selectOption('RAW');
    await rows.nth(0).locator('select').first().selectOption('DELIMITED');
    await expect(modal.getByLabel('Column Widths', { exact: true }).first()).toHaveValue('');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await save(page, writes, 1);
    for (const connector of [writes[0].sourceConnector, writes[0].destinationConnectors.connector[0]]) {
        for (const transformer of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
            for (const side of ['inbound', 'outbound']) {
                const props = transformer[`${side}Properties`];
                expect(props.serializationProperties).not.toHaveProperty('columnWidths');
                expect(props.serializationProperties).not.toHaveProperty('columnNames');
                expect(props.deserializationProperties).not.toHaveProperty('columnWidths');
            }
        }
    }
    expect(writes[0].destinationConnectors.connector[0].responseTransformer.inboundProperties.future).toEqual({ keep: 'unknown' });
});

test('Delimited lists preserve singleton/array wire shapes, cancel edits, and omit cleared lists', async ({ page }) => {
    const channel = fixture();
    const inbound = properties({ int: 5 }, { string: ['first', 'second'] });
    channel.sourceConnector.transformer.inboundProperties = inbound;
    channel.sourceConnector.transformer.outboundProperties = properties({ int: [5, 3] }, { string: 'only' });
    const writes = await setup(page, channel);
    let modal = await dialog(page);
    await expect(modal.getByLabel('Column Widths', { exact: true }).first()).toHaveValue('5');
    await expect(modal.getByLabel('Column Widths', { exact: true }).nth(1)).toHaveValue('5,3');
    await expect(modal.getByLabel('Column Names', { exact: true }).first()).toHaveValue('first,second');
    await modal.getByLabel('Column Widths', { exact: true }).first().fill('9,7');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    modal = await dialog(page);
    await expect(modal.getByLabel('Column Widths', { exact: true }).first()).toHaveValue('5');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await save(page, writes, 1);
    expect(writes[0].sourceConnector.transformer.inboundProperties.serializationProperties).toEqual(inbound.serializationProperties);
    expect(writes[0].sourceConnector.transformer.outboundProperties.serializationProperties.columnNames).toEqual({ string: 'only' });
    modal = await dialog(page);
    await modal.getByLabel('Column Widths', { exact: true }).first().fill('');
    await modal.getByLabel('Column Names', { exact: true }).first().fill('');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await save(page, writes, 2);
    const sent = writes[1].sourceConnector.transformer.inboundProperties;
    expect(sent.serializationProperties).not.toHaveProperty('columnWidths');
    expect(sent.serializationProperties).not.toHaveProperty('columnNames');
    expect(sent.future).toEqual({ keep: 'unknown' });
    expect(sent.serializationProperties.future).toBe(17);
});

test('engine JSON literals for true/false/null column names stay valid and save as strings', async ({ page }) => {
    const channel = fixture();
    channel.sourceConnector.transformer.inboundProperties = properties(null, { string: [true, false, null, 'normal'] });
    channel.sourceConnector.transformer.outboundProperties = properties(null, { string: true });
    const writes = await setup(page, channel);
    const modal = await dialog(page);
    const names = modal.getByLabel('Column Names', { exact: true });
    await expect(names.first()).toHaveValue('true,false,null,normal');
    await expect(names.first()).toHaveAttribute('aria-invalid', 'false');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.panel input[type=text]').first().fill('Unrelated rename');
    await save(page, writes, 1);
    expect(writes[0].sourceConnector.transformer.inboundProperties.serializationProperties.columnNames).toEqual({ string: ['true', 'false', 'null', 'normal'] });
    expect(writes[0].sourceConnector.transformer.outboundProperties.serializationProperties.columnNames).toEqual({ string: 'true' });
});

test('engine-accepted legacy column names survive an unrelated save', async ({ page }) => {
    const channel = fixture();
    channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnNames = { string: ['ª', 'µ', 'º'] };
    const writes = await setup(page, channel);
    await page.locator('.panel input[type=text]').first().fill('Legacy column names retained');
    await save(page, writes, 1);
    expect(writes[0].sourceConnector.transformer.inboundProperties.serializationProperties.columnNames)
        .toEqual({ string: ['ª', 'µ', 'º'] });
});

test('invalid Delimited widths/names block OK even on hidden rows, then valid values save as typed arrays', async ({ page }) => {
    const writes = await setup(page);
    const modal = await dialog(page);
    const widths = modal.getByLabel('Column Widths', { exact: true }).first();
    for (const invalid of ['0', '-1', '1.5', '2147483648', '5,,3']) {
        await widths.fill(invalid);
        await expect(widths).toHaveAttribute('aria-invalid', 'true');
        await modal.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(modal).toBeVisible();
        expect(writes).toHaveLength(0);
    }
    await modal.locator('table.dt tbody tr').nth(1).locator('td').first().click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.locator('table.dt tbody tr').first().locator('td').first().click();
    await expect(widths).toHaveValue('5,,3');
    await widths.fill('+5,3,');
    await expect(widths).toHaveAttribute('aria-invalid', 'false');
    await modal.getByLabel('Column Names', { exact: true }).first().fill('1bad');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel('Column Names', { exact: true }).first().fill('first,second,');
    await modal.getByLabel('Column Widths', { exact: true }).nth(1).fill('4,2');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await save(page, writes, 1);
    expect(writes[0].sourceConnector.transformer.inboundProperties.serializationProperties).toMatchObject({ columnWidths: { int: [5, 3] }, columnNames: { string: ['first', 'second'] } });
    expect(writes[0].sourceConnector.transformer.outboundProperties.deserializationProperties.columnWidths).toEqual({ int: [4, 2] });
});

test('invalid bulk lists cannot apply; type switches discard obsolete list errors', async ({ page }) => {
    const writes = await setup(page);
    const modal = await dialog(page);
    await modal.getByLabel('Bulk Edit', { exact: true }).check();
    await modal.locator('table.dt tbody tr').first().getByRole('checkbox').check();
    await modal.getByLabel('Column Widths', { exact: true }).first().fill('0');
    await modal.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel('Single Edit', { exact: true }).check();
    await expect(modal.getByLabel('Column Widths', { exact: true }).first()).toHaveValue('');
    await modal.getByLabel('Column Widths', { exact: true }).first().fill('0');
    await modal.locator('table.dt tbody tr').first().locator('select').first().selectOption('RAW');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await save(page, writes, 1);
    expect(writes[0].sourceConnector.transformer.inboundDataType).toBe('RAW');
});

test('partial bulk ignores disabled invalid outbound lists while applying valid inbound lists', async ({ page }) => {
    const writes = await setup(page);
    const modal = await dialog(page);
    await modal.getByLabel('Bulk Edit', { exact: true }).check();
    await modal.locator('table.dt tbody tr').nth(0).getByRole('checkbox').check();
    await modal.locator('table.dt tbody tr').nth(1).getByRole('checkbox').check();
    await modal.getByLabel('Column Widths', { exact: true }).first().fill('5,3');
    await modal.getByLabel('Column Widths', { exact: true }).nth(1).fill('0');
    await modal.getByRole('checkbox', { name: 'Outbound', exact: true }).uncheck();
    await modal.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await save(page, writes, 1);
    for (const connector of [writes[0].sourceConnector, writes[0].destinationConnectors.connector[0]]) {
        expect(connector.transformer.inboundProperties.serializationProperties.columnWidths).toEqual({ int: [5, 3] });
        expect(connector.transformer.outboundProperties.deserializationProperties).not.toHaveProperty('columnWidths');
        expect(connector.transformer.outboundProperties.future).toEqual({ keep: 'unknown' });
    }
});

for (const disabled of ['targets', 'sides']) {
    test(`unused invalid bulk draft does not block OK with no selected ${disabled}`, async ({ page }) => {
        const writes = await setup(page);
        const modal = await dialog(page);
        await modal.getByLabel('Bulk Edit', { exact: true }).check();
        await modal.getByLabel('Column Widths', { exact: true }).first().fill('0');
        const checkboxes = disabled === 'targets' ? modal.locator('table input[type=checkbox]')
            : modal.getByRole('checkbox', { name: /^(Inbound|Outbound)$/ });
        if (disabled === 'sides') await modal.locator('table.dt tbody tr').first().getByRole('checkbox').check();
        for (const checkbox of await checkboxes.all()) await checkbox.uncheck();
        await modal.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
        const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
        await expect(warning).toContainText(disabled === 'targets' ? 'Select at least one connector' : 'Choose Inbound and/or Outbound to apply');
        await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
        await modal.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(modal).toHaveCount(0);
        await save(page, writes, 1);
        expect(writes[0].sourceConnector.transformer.inboundProperties.serializationProperties).not.toHaveProperty('columnWidths');
    });
}

for (const surface of ['transformer/0', 'transformer/1', 'response/1']) {
    test(`Delimited ${surface} properties use the same validation and cancel contract`, async ({ page }) => {
        const writes = await setup(page, fixture(), surface);
        await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
        await page.getByRole('button', { name: 'Properties…', exact: true }).first().click();
        let modal = page.getByRole('dialog', { name: 'Inbound Data Type Properties — Delimited Text', exact: true });
        await modal.getByLabel('Column Widths', { exact: true }).fill('0');
        await modal.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(modal).toBeVisible();
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Properties…', exact: true }).first().click();
        modal = page.getByRole('dialog', { name: 'Inbound Data Type Properties — Delimited Text', exact: true });
        await expect(modal.getByLabel('Column Widths', { exact: true })).toHaveValue('');
        await modal.getByLabel('Column Widths', { exact: true }).fill('5,3');
        await modal.getByLabel('Column Names', { exact: true }).fill('first,second');
        await modal.getByRole('button', { name: 'OK', exact: true }).click();
        await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
        await save(page, writes, 1);
        const connector = surface === 'transformer/0' ? writes[0].sourceConnector : writes[0].destinationConnectors.connector[0];
        const target = surface.startsWith('response') ? connector.responseTransformer : connector.transformer;
        expect(target.inboundProperties.serializationProperties).toMatchObject({ columnWidths: { int: [5, 3] }, columnNames: { string: ['first', 'second'] }, future: 17 });
    });
}
