import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

async function open(page: any, prepare?: (channel: any) => void) {
    let channel = makeChannel('response-types');
    const first = ([] as any[]).concat(channel.destinationConnectors.connector)[0];
    first.name = 'Primary';
    const second = structuredClone(first);
    second.metaDataId = 2;
    second.name = 'Secondary';
    second.enabled = false;
    channel.nextMetaDataId = 3;
    channel.destinationConnectors.connector = [first, second];
    for (const dest of [first, second]) {
        dest.responseTransformer.inboundDataType = 'RAW';
        dest.responseTransformer.outboundDataType = 'RAW';
        dest.responseTransformer.inboundProperties = { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties' };
        dest.responseTransformer.outboundProperties = { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties' };
        dest.responseTransformer.futureSetting = { value: dest.name };
    }
    for (const transformer of [channel.sourceConnector.transformer, first.transformer, second.transformer]) {
        transformer.inboundDataType = 'RAW';
        transformer.outboundDataType = 'RAW';
        transformer.inboundProperties = { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties' };
        transformer.outboundProperties = { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties' };
    }
    channel.sourceConnector.transformer.inboundProperties.batchProperties = {
        '@class': 'com.mirth.connect.plugins.datatypes.raw.RawBatchProperties', '@version': '4.6.0',
        splitType: 'JavaScript', batchScript: null,
    };
    prepare?.(channel);
    const initial = structuredClone(channel);
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /channels/response-types': () => ({ channel }),
        'PUT /channels/response-types': (req: any) => {
            channel = JSON.parse(req.postData()).channel;
            writes.push(structuredClone(channel));
            return 'true';
        },
    });
    await page.goto('/channels/response-types/edit');
    await page.getByRole('button', { name: 'Set Data Types', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Set Data Types', exact: true });
    const row = (name: string) => dialog.locator('tbody tr').filter({ has: page.getByRole('cell', { name, exact: true }) });
    const save = async () => {
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        return writes[0];
    };
    return { initial, writes, dialog, row, save };
}

test('each destination has an editable response with ACK validation, including disabled destinations', async ({ page }) => {
    const { initial, dialog, row, save } = await open(page);
    await expect(dialog.locator('tbody tr')).toHaveCount(5);
    for (const name of ['Primary — Response', 'Secondary — Response']) {
        await row(name).locator('select').nth(0).selectOption('HL7V2');
        await row(name).locator('select').nth(1).selectOption('HL7V2');
        await expect(dialog.getByText('Response Validation', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Response Generation', { exact: true })).toHaveCount(0);
        await dialog.locator('.field').filter({ has: page.getByText('Successful ACK Codes', { exact: true }) }).locator('input').fill('AA');
    }
    const saved = await save();
    for (const [index, dest] of saved.destinationConnectors.connector.entries()) {
        expect(dest.responseTransformer).toMatchObject({ inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
            inboundProperties: { responseValidationProperties: { successfulACKCode: 'AA' } },
            futureSetting: { value: dest.name } });
        expect(dest.transformer).toEqual(initial.destinationConnectors.connector[index].transformer);
    }
});

test('source outbound updates destination input without touching response types or properties', async ({ page }) => {
    const { initial, row, save } = await open(page);
    await row('Source Connector').locator('select').nth(1).selectOption('XML');
    const saved = await save();
    for (const [index, dest] of saved.destinationConnectors.connector.entries()) {
        expect(dest.transformer.inboundDataType).toBe('XML');
        expect(dest.responseTransformer).toEqual(initial.destinationConnectors.connector[index].responseTransformer);
    }
});

test('destination outbound aligns only its own response types', async ({ page }) => {
    const { initial, row, save } = await open(page);
    await row('Primary').locator('select').nth(1).selectOption('XML');
    await expect(row('Primary — Response').locator('select').nth(0)).toHaveValue('XML');
    await expect(row('Primary — Response').locator('select').nth(1)).toHaveValue('XML');
    const saved = await save();
    expect(saved.destinationConnectors.connector[1].responseTransformer).toEqual(initial.destinationConnectors.connector[1].responseTransformer);
});

test('bulk response selection exposes validation and leaves unselected transformers intact', async ({ page }) => {
    const { initial, dialog, row, save } = await open(page);
    await dialog.getByRole('radio', { name: 'Bulk Edit', exact: true }).check();
    await expect(dialog.locator('tbody input[type=checkbox]:checked')).toHaveCount(0);
    for (const name of ['Primary — Response', 'Secondary — Response']) await row(name).getByRole('checkbox').check();
    const panels = dialog.locator('.panel').filter({ has: page.locator('.panel-header') });
    await panels.nth(0).locator('select').first().selectOption('HL7V2');
    await panels.nth(1).locator('select').first().selectOption('HL7V2');
    await expect(dialog.getByText('Response Validation', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Response Generation', { exact: true })).toHaveCount(0);
    await dialog.locator('.field').filter({ has: page.getByText('Successful ACK Codes', { exact: true }) }).locator('input').fill('CA');
    await dialog.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
    const saved = await save();
    expect(saved.sourceConnector.transformer).toEqual(initial.sourceConnector.transformer);
    for (const [index, dest] of saved.destinationConnectors.connector.entries()) {
        expect(dest.transformer).toEqual(initial.destinationConnectors.connector[index].transformer);
        expect(dest.responseTransformer.inboundProperties.responseValidationProperties.successfulACKCode).toBe('CA');
        expect(dest.responseTransformer.outboundDataType).toBe('HL7V2');
    }
});

test('bulk selection starts empty and resets when re-entered', async ({ page }) => {
    const { initial, dialog, row, writes } = await open(page);
    await dialog.getByRole('radio', { name: 'Bulk Edit', exact: true }).check();
    await expect(dialog.locator('tbody input[type=checkbox]:checked')).toHaveCount(0);
    await row('Primary — Response').getByRole('checkbox').check();
    await dialog.getByRole('radio', { name: 'Single Edit', exact: true }).check();
    await dialog.getByRole('radio', { name: 'Bulk Edit', exact: true }).check();
    await expect(dialog.locator('tbody input[type=checkbox]:checked')).toHaveCount(0);
    await dialog.locator('.panel select').first().selectOption('HL7V2');
    await dialog.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
    const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
    await expect(warning).toContainText('Select at least one connector');
    await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await page.locator('.panel input[type=text]').first().fill('Bulk selection unchanged');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    for (const [index, dest] of writes[0].destinationConnectors.connector.entries()) {
        expect(dest.responseTransformer).toEqual(initial.destinationConnectors.connector[index].responseTransformer);
    }
});

for (const dismiss of ['Cancel', 'Escape']) {
    test(`${dismiss} discards response type and property changes`, async ({ page }) => {
        const { initial, dialog, row, writes } = await open(page);
        await row('Primary — Response').locator('select').nth(0).selectOption('HL7V2');
        if (dismiss === 'Escape') await page.keyboard.press('Escape');
        else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await page.locator('.panel input[type=text]').first().fill('Only change the name');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        for (const [index, dest] of writes[0].destinationConnectors.connector.entries()) {
            expect(dest.responseTransformer).toEqual(initial.destinationConnectors.connector[index].responseTransformer);
        }
    });
}

test('hidden response array errors block OK and preserve imported metadata when repaired', async ({ page }) => {
    const { dialog, row, save } = await open(page, channel => {
        const response = channel.destinationConnectors.connector[0].responseTransformer;
        for (const side of ['inbound', 'outbound']) {
            response[`${side}DataType`] = 'DELIMITED';
            response[`${side}Properties`] = {
                '@class': 'com.mirth.connect.plugins.datatypes.delimited.DelimitedDataTypeProperties', future: { keep: 'properties' },
                serializationProperties: { columnWidths: { int: side === 'inbound' ? '0' : [7, 2], '@class': 'int-array', '@future': 'keep' } },
                deserializationProperties: {},
            };
        }
    });
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert').first()).toContainText('Primary — Response inbound:');
    await row('Primary — Response').getByRole('cell', { name: 'Primary — Response', exact: true }).click();
    const widths = dialog.getByLabel('Column Widths', { exact: true }).first();
    await expect(widths).toHaveValue('0');
    await widths.fill('5,3');
    await row('Source Connector').getByRole('cell', { name: 'Source Connector', exact: true }).click();
    const saved = (await save()).destinationConnectors.connector[0].responseTransformer;
    expect(saved.inboundProperties.serializationProperties.columnWidths).toEqual({ int: [5, 3], '@class': 'int-array', '@future': 'keep' });
    expect(saved.outboundProperties.serializationProperties.columnWidths).toEqual({ int: [7, 2], '@class': 'int-array', '@future': 'keep' });
    expect(saved.inboundProperties.future).toEqual({ keep: 'properties' });
    expect(saved.futureSetting).toEqual({ value: 'Primary' });
});

test('failed validation and Cancel do not materialize a missing response transformer', async ({ page }) => {
    const { dialog, row, writes } = await open(page, channel => {
        delete channel.destinationConnectors.connector[0].responseTransformer;
    });
    await row('Primary — Response').locator('select').first().selectOption('DELIMITED');
    await dialog.getByLabel('Column Widths', { exact: true }).first().fill('0');
    await row('Source Connector').getByRole('cell', { name: 'Source Connector', exact: true }).click();
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('.panel input[type=text]').first().fill('Unrelated name edit');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].destinationConnectors.connector[0]).not.toHaveProperty('responseTransformer');
});

test('response-only inbound bulk can save while disabled outbound has an invalid array draft', async ({ page }) => {
    const { initial, dialog, row, save } = await open(page);
    await dialog.getByLabel('Bulk Edit', { exact: true }).check();
    await row('Primary — Response').getByRole('checkbox').check();
    const panels = dialog.locator('.panel').filter({ has: page.locator('.panel-header') });
    await panels.nth(0).locator('select').first().selectOption('XML');
    await panels.nth(1).locator('select').first().selectOption('DELIMITED');
    await dialog.getByLabel('Column Widths', { exact: true }).first().fill('0');
    await dialog.getByRole('checkbox', { name: 'Outbound', exact: true }).uncheck();
    await dialog.getByRole('button', { name: 'Apply to Selected Connectors', exact: true }).click();
    const saved = await save();
    expect(saved.destinationConnectors.connector[0].responseTransformer).toMatchObject({ inboundDataType: 'XML', outboundDataType: 'RAW', futureSetting: { value: 'Primary' } });
    expect(saved.sourceConnector.transformer).toEqual(initial.sourceConnector.transformer);
    expect(saved.destinationConnectors.connector[0].transformer).toEqual(initial.destinationConnectors.connector[0].transformer);
    expect(saved.destinationConnectors.connector[1]).toEqual(initial.destinationConnectors.connector[1]);
});
