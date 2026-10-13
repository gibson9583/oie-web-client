import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Locator, Page } from '@playwright/test';

const PKG = 'com.mirth.connect.plugins.datatypes.delimited';
const properties = () => ({
    '@class': `${PKG}.DelimitedDataTypeProperties`, '@version': '4.6.0', future: { keep: true },
    serializationProperties: { '@class': `${PKG}.DelimitedSerializationProperties`, columnDelimiter: ',', recordDelimiter: '\\n', future: 17 },
    deserializationProperties: { '@class': `${PKG}.DelimitedDeserializationProperties`, columnDelimiter: ',', recordDelimiter: '\\n' },
});
async function setup(page: Page, surface = 'edit', loaded = false) {
    let channel = makeChannel('delimited-typing');
    for (const connector of [channel.sourceConnector, channel.destinationConnectors.connector[0]]) {
        for (const transformer of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
            for (const side of ['inbound', 'outbound']) {
                transformer[`${side}DataType`] = 'DELIMITED';
                transformer[`${side}Properties`] = properties();
            }
        }
    }
    if (loaded) Object.assign(channel.sourceConnector.transformer.inboundProperties.serializationProperties, {
        columnWidths: { int: [10, 20], '@class': 'int-array', '@future': 'widths' },
        columnNames: { string: ['first', 'second'], '@class': 'string-array', '@future': 'names' },
    });
    const writes: any[] = [];
    await mockEngine(page, {
        'GET /channels/delimited-typing': () => ({ channel }),
        'PUT /channels/delimited-typing': (request: any) => {
            channel = request.postDataJSON().channel;
            writes.push(structuredClone(channel));
            return true;
        },
    });
    await page.goto(`/channels/delimited-typing/${surface}`);
    return writes;
}
async function dialog(page: Page) {
    await page.getByRole('button', { name: 'Set Data Types', exact: true }).click();
    return page.getByRole('dialog', { name: 'Set Data Types', exact: true });
}
const widths = (host: Page | Locator) => host.getByLabel('Column Widths', { exact: true }).first();
const names = (host: Page | Locator) => host.getByLabel('Column Names', { exact: true }).first();
async function save(page: Page, writes: any[]) {
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    return writes[0];
}
async function typeLists(host: Page | Locator) {
    await widths(host).pressSequentially('10,20');
    await names(host).pressSequentially('lastName,firstName');
    await expect(widths(host)).toHaveValue('10,20');
    await expect(names(host)).toHaveValue('lastName,firstName');
}
function expectLists(properties: any) {
    expect(properties).toMatchObject({ future: { keep: true }, serializationProperties: {
        columnWidths: { int: [10, 20] }, columnNames: { string: ['lastName', 'firstName'] }, future: 17,
    } });
}

test('sequential Delimited typing saves both comma-separated lists', async ({ page }) => {
    const writes = await setup(page);
    const modal = await dialog(page);
    await typeLists(modal);
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    expectLists((await save(page, writes)).sourceConnector.transformer.inboundProperties);
});

test('appending and replacing middle entries preserves caret, attributes, and sibling fields', async ({ page }) => {
    const writes = await setup(page, 'edit', true);
    const modal = await dialog(page);
    const width = widths(modal), name = names(modal);
    await width.focus();
    await width.press('End');
    await width.pressSequentially(',30');
    await width.evaluate(input => (input as HTMLInputElement).setSelectionRange(3, 5));
    await width.pressSequentially('25');
    await expect(width).toHaveValue('10,25,30');
    expect(await width.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(5);
    await name.focus();
    await name.press('End');
    await name.pressSequentially(',third');
    await name.evaluate(input => (input as HTMLInputElement).setSelectionRange(6, 12));
    await name.pressSequentially('middle');
    await expect(name).toHaveValue('first,middle,third');
    expect(await name.evaluate(input => (input as HTMLInputElement).selectionStart)).toBe(12);
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    const saved = (await save(page, writes)).sourceConnector.transformer.inboundProperties;
    expect(saved.serializationProperties).toMatchObject({
        columnWidths: { int: [10, 25, 30], '@class': 'int-array', '@future': 'widths' },
        columnNames: { string: ['first', 'middle', 'third'], '@class': 'string-array', '@future': 'names' }, future: 17,
    });
    expect(saved.future).toEqual({ keep: true });
});

test('invalid typed lists survive remount, can be corrected, and Cancel and clear retain their contracts', async ({ page }) => {
    const writes = await setup(page, 'edit', true);
    let modal = await dialog(page);
    await widths(modal).fill('');
    await widths(modal).pressSequentially('10,,20');
    await names(modal).fill('');
    await names(modal).pressSequentially('1bad');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(modal).toBeVisible();
    expect(writes).toHaveLength(0);
    const rows = modal.locator('table.dt tbody tr');
    await rows.nth(1).locator('td').first().click();
    await rows.first().locator('td').first().click();
    await expect(widths(modal)).toHaveValue('10,,20');
    await expect(widths(modal)).toHaveAttribute('aria-invalid', 'true');
    await expect(names(modal)).toHaveValue('1bad');
    await widths(modal).fill('');
    await names(modal).fill('');
    await typeLists(modal);
    await expect(widths(modal)).toHaveAttribute('aria-invalid', 'false');
    await expect(names(modal)).toHaveAttribute('aria-invalid', 'false');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    modal = await dialog(page);
    await expect(widths(modal)).toHaveValue('10,20');
    await expect(names(modal)).toHaveValue('first,second');
    await widths(modal).fill('');
    await names(modal).fill('');
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    const saved = (await save(page, writes)).sourceConnector.transformer.inboundProperties.serializationProperties;
    expect(saved).not.toHaveProperty('columnWidths');
    expect(saved).not.toHaveProperty('columnNames');
    expect(saved.future).toBe(17);
});

for (const surface of ['transformer/0', 'response/1', 'guided']) {
    test(`${surface}: typed lists survive panel remount and save through the shared model`, async ({ page }) => {
        const writes = await setup(page, surface);
        if (surface === 'guided') {
            for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
            await page.getByRole('button', { name: 'Edit properties', exact: true }).click();
            await typeLists(page);
            await page.getByRole('button', { name: 'Hide properties', exact: true }).click();
            await page.getByRole('button', { name: 'Edit properties', exact: true }).click();
            await expect(widths(page)).toHaveValue('10,20');
            await expect(names(page)).toHaveValue('lastName,firstName');
        } else {
            await page.getByRole('tab', { name: 'Message Templates', exact: true }).click();
            await page.getByRole('button', { name: 'Properties…', exact: true }).first().click();
            const modal = page.getByRole('dialog', { name: 'Inbound Data Type Properties — Delimited Text', exact: true });
            await typeLists(modal);
            await modal.getByRole('button', { name: 'OK', exact: true }).click();
            await page.getByRole('button', { name: 'Properties…', exact: true }).first().click();
            await expect(widths(modal)).toHaveValue('10,20');
            await expect(names(modal)).toHaveValue('lastName,firstName');
            await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
            await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
        }
        const saved = await save(page, writes);
        const transformer = surface === 'response/1' ? saved.destinationConnectors.connector[0].responseTransformer
            : saved.sourceConnector.transformer;
        expectLists(transformer.inboundProperties);
    });
}

test('external list replacements, in-place edits, and type changes replace the local text buffer', async ({ page }) => {
    const writes = await setup(page, 'guided');
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Edit properties', exact: true }).click();
    await widths(page).pressSequentially('10,');
    await expect(widths(page)).toHaveValue('10,');
    for (const inplace of [false, true]) {
        await page.evaluate(async inplace => {
            const { getState } = await import(String('/core/store.js'));
            const group = getState('editingChannel').sourceConnector.transformer.inboundProperties.serializationProperties;
            if (inplace) group.columnWidths.int = [8, 3];
            else group.columnWidths = { int: [7, 2], '@future': 'external' };
        }, inplace);
        await page.getByRole('checkbox', { name: 'Numbered Rows', exact: true }).first().click();
        await expect(widths(page)).toHaveValue(inplace ? '8,3' : '7,2');
    }
    const inbound = page.locator('label').filter({ has: page.getByText('Inbound', { exact: true }) }).locator('select');
    await inbound.selectOption('RAW');
    await inbound.selectOption('DELIMITED');
    await expect(widths(page)).toHaveValue('');
    await typeLists(page);
    const saved = await save(page, writes);
    expect(saved.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths).toEqual({ int: [10, 20] });
});

test('composition input retains the current text and persists completed Unicode column names', async ({ page }) => {
    const writes = await setup(page);
    const modal = await dialog(page);
    const name = names(modal);
    await name.pressSequentially('first,');
    await expect(name).toHaveValue('first,');
    await name.dispatchEvent('compositionstart', { data: '' });
    for (const text of ['first,姓', 'first,姓名']) {
        await name.evaluate((input, text) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertCompositionText', isComposing: true }));
        }, text);
        await expect(name).toHaveValue(text);
    }
    await name.dispatchEvent('compositionend', { data: '姓名' });
    await modal.getByRole('button', { name: 'OK', exact: true }).click();
    const saved = (await save(page, writes)).sourceConnector.transformer.inboundProperties.serializationProperties;
    expect(saved.columnNames).toEqual({ string: ['first', '姓名'] });
});
