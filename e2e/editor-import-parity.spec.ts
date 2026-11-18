import { test, expect } from './base.js';
import type { Page } from '@playwright/test';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const stepType = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const ruleType = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const templateText = (value: any) => value?.['@encoding'] === 'base64' ? Buffer.from(value.$, 'base64').toString('utf8') : value;
const step = (name: string) => ({ '@version': '4.6.0', name, sequenceNumber: '0', enabled: true, script: 'return true;' });
const xml = (key: string, value: any): string => {
    if (Array.isArray(value)) return value.map(child => xml(key, child)).join('');
    const escape = (text: any) => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    if (!value || typeof value !== 'object') return `<${key}>${escape(value)}</${key}>`;
    const entries = Object.entries(value);
    return `<${key}${entries.filter(([name]) => name.startsWith('@')).map(([name, child]) => ` ${name.slice(1)}="${escape(child)}"`).join('')}>${entries.filter(([name]) => !name.startsWith('@')).map(([name, child]) => name === '$' ? escape(child) : xml(name, child)).join('')}</${key}>`;
};
async function upload(page: Page, button: string, content: string, name = 'import.xml') {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/xml', buffer: Buffer.from(content) });
}
async function setup(page: Page, channel: any, route = 'edit') {
    await mockEngine(page, { [`GET /channels/${channel.id}`]: { channel } });
    const writes: any[] = [];
    await page.route(url => url.pathname === `/api/channels/${channel.id}`, async request => {
        if (request.request().method() !== 'PUT') return request.fallback();
        writes.push(JSON.parse(request.request().postData()!).channel);
        return request.fulfill({ status: 200, contentType: 'text/plain', body: 'true' });
    });
    await page.goto(`/channels/${channel.id}/${route}`);
    return writes;
}
async function save(page: Page, writes: any[]) {
    await page.getByRole('button', { name: /^(Save Changes|Save Channel)$/ }).click();
    await expect.poll(() => writes.length).toBe(1);
    return writes[0];
}

test('Swing destination XML appends with fresh identity and unique name, preserves original and aligns inbound type', async ({ page }) => {
    const channel = makeChannel('import-destination');
    const original = structuredClone(channel.destinationConnectors.connector[0]);
    const imported = structuredClone(original);
    imported.metaDataId = 77;
    imported.name = 'destination 1';
    imported.enabled = false;
    imported.waitForPrevious = false;
    imported.transformer.inboundDataType = 'XML';
    imported.transformer.outboundTemplate = { '@encoding': 'base64', '$': Buffer.from('001').toString('base64') };
    imported.properties.channelTemplate = 'false';
    const writes = await setup(page, channel);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await upload(page, 'Import Connector', xml('connector', imported));
    await expect(page.getByRole('cell', { name: 'Destination 2', exact: true })).toBeVisible();
    const sent = await save(page, writes);
    expect(sent.destinationConnectors.connector).toHaveLength(2);
    expect(sent.destinationConnectors.connector[0]).toEqual(original);
    const added = sent.destinationConnectors.connector[1];
    expect(added.metaDataId).toBe(2);
    expect(added.name).toBe('Destination 2');
    expect(added.enabled).toBe(false);
    expect(added.waitForPrevious).toBe(false);
    expect(added.transformer.inboundDataType).toBe('HL7V2');
    expect(templateText(added.transformer.outboundTemplate)).toBe('001');
    expect(added.properties.channelTemplate).toBe('false');
    expect(added.properties.destinationConnectorProperties.queueEnabled).toBe(false);
    expect(sent.nextMetaDataId).toBe(3);
});

test('Swing source XML replaces source with id zero, aligns destinations and automatic attachment handling', async ({ page }) => {
    const channel = makeChannel('import-source');
    channel.properties.attachmentProperties.type = 'DICOM';
    const imported = structuredClone(channel.sourceConnector);
    imported.metaDataId = 55;
    imported.transformer.outboundDataType = 'XML';
    imported.transformer.inboundDataType = 'RAW';
    imported.transformer.elements = { [stepType]: step('Imported source step') };
    imported.properties.sourceConnectorProperties.processBatch = false;
    const writes = await setup(page, channel);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await upload(page, 'Import Connector', xml('connector', imported));
    await expect(page.getByRole('button', { name: 'Edit Transformer (1)', exact: true })).toBeVisible();
    const sent = await save(page, writes);
    expect(sent.sourceConnector.metaDataId).toBe(0);
    expect(sent.sourceConnector.properties.sourceConnectorProperties.processBatch).toBe(false);
    expect(sent.destinationConnectors.connector[0].transformer.inboundDataType).toBe('XML');
    expect(sent.destinationConnectors.connector[0].transformer.inboundProperties['@class']).toContain('XML');
    expect(sent.properties.attachmentProperties.type).toBe('None');
});

for (const kind of ['filter', 'transformer', 'response']) {
    test(`${kind} XML append retains existing settings, order and disabled imported elements`, async ({ page }) => {
        const channel = makeChannel(`append-${kind}`);
        const connector = kind === 'response' ? channel.destinationConnectors.connector[0] : channel.sourceConnector;
        const key = kind === 'response' ? 'responseTransformer' : kind;
        const type = kind === 'filter' ? ruleType : stepType;
        connector[key].elements = { [type]: step('Existing') };
        const initial = structuredClone(connector[key]);
        const imported = { ...initial, elements: { [type]: { ...step('Imported'), enabled: false } }, inboundDataType: 'XML', outboundDataType: 'XML', inboundTemplate: 'imported template' };
        const writes = await setup(page, channel, `${kind}/${kind === 'response' ? 1 : 0}`);
        await upload(page, `Import ${kind === 'response' ? 'Response Transformer' : kind === 'filter' ? 'Filter' : 'Transformer'}`, xml(kind === 'filter' ? 'filter' : 'transformer', imported));
        await page.getByRole('button', { name: 'Append', exact: true }).click();
        await expect(page.locator('input.grid-name')).toHaveCount(2);
        const sent = await save(page, writes);
        const result = (kind === 'response' ? sent.destinationConnectors.connector[0] : sent.sourceConnector)[key];
        expect(result.elements[type].map((element: any) => element.name)).toEqual(['Existing', 'Imported']);
        expect(result.elements[type][1].enabled).toBe(false);
        for (const property of ['inboundDataType', 'outboundDataType', 'inboundTemplate']) expect(templateText(result[property])).toEqual(initial[property]);
    });
}

test('full transformer XML replacement imports data types, properties and templates and clears existing steps', async ({ page }) => {
    const channel = makeChannel('replace-transformer');
    channel.sourceConnector.transformer.elements = { [stepType]: step('Existing') };
    channel.sourceConnector.transformer.outboundTemplate = 'old template';
    const imported = {
        '@version': '4.6.0', elements: '', inboundDataType: 'RAW', outboundDataType: 'XML',
        inboundTemplate: '001', outboundTemplate: '',
        inboundProperties: { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties', '@version': '4.6.0', batchProperties: { '@class': 'com.mirth.connect.plugins.datatypes.raw.RawBatchProperties', splitType: 'JavaScript', batchScript: 'return null;' } },
        outboundProperties: { '@class': 'com.mirth.connect.plugins.datatypes.xml.XMLDataTypeProperties', '@version': '4.6.0', serializationProperties: { '@class': 'com.mirth.connect.plugins.datatypes.xml.XMLSerializationProperties', stripNamespaces: false } }
    };
    const writes = await setup(page, channel, 'transformer/0');
    await upload(page, 'Import Transformer', xml('transformer', imported));
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.locator('input.grid-name')).toHaveCount(0);
    const sent = await save(page, writes);
    expect(sent.sourceConnector.transformer.elements).toBeNull();
    expect(templateText(sent.sourceConnector.transformer.inboundTemplate)).toBe('001');
    expect(templateText(sent.sourceConnector.transformer.outboundTemplate)).toBe('');
    expect(sent.sourceConnector.transformer.outboundDataType).toBe('XML');
    expect(sent.sourceConnector.transformer.outboundProperties.serializationProperties.stripNamespaces).toBe(false);
    expect(sent.destinationConnectors.connector[0].transformer.inboundDataType).toBe('XML');
});

test('cancelled replacement and malformed XML preserve the edited draft', async ({ page }) => {
    const channel = makeChannel('cancel-transformer');
    channel.sourceConnector.transformer.elements = { [stepType]: step('Existing') };
    const writes = await setup(page, channel, 'transformer/0');
    await page.locator('input.grid-name').fill('Local draft');
    await upload(page, 'Import Transformer', xml('transformer', { elements: { [stepType]: step('Imported') } }));
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('input.grid-name')).toHaveValue('Local draft');
    await upload(page, 'Import Transformer', '<filter><elements/></filter>');
    await expect(page.getByText(/Expected a valid <transformer> export/)).toBeVisible();
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('input.grid-name')).toHaveValue('Local draft');
    const sent = await save(page, writes);
    expect(sent.sourceConnector.transformer.elements[stepType][0].name).toBe('Local draft');
});

test('wrong connector mode and failed resource lookup leave destination list untouched', async ({ page }) => {
    const channel = makeChannel('failed-connector');
    const writes = await setup(page, channel);
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await upload(page, 'Import Connector', xml('connector', channel.sourceConnector));
    await expect(page.getByText(/You must be on the Source tab/)).toBeVisible();
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.route('**/api/server/resources', route => route.fulfill({ status: 500, body: 'Resource lookup failed' }));
    await upload(page, 'Import Connector', xml('connector', channel.destinationConnectors.connector[0]));
    await expect(page.getByText(/Import failed:.*Resource lookup failed/)).toBeVisible();
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('cell', { name: 'Destination 2', exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(0);
});

test('destination import ignores a delayed resource response after the user leaves the destinations tab', async ({ page }) => {
    const channel = makeChannel('stale-connector');
    const writes = await setup(page, channel);
    let release: () => void = () => {};
    let requested = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/server/resources', async route => {
        requested = true;
        await pending;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await upload(page, 'Import Connector', xml('connector', channel.destinationConnectors.connector[0]));
    await expect.poll(() => requested).toBe(true);
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    release();
    await page.locator('.panel input[type=text]').first().fill('Unrelated draft');
    const sent = await save(page, writes);
    expect(sent.destinationConnectors.connector).toHaveLength(1);
    expect(sent.destinationConnectors.connector[0]).toEqual(channel.destinationConnectors.connector[0]);
});

test('empty modern filter XML can replace all rules and legacy layouts fail without clearing the draft', async ({ page }) => {
    const channel = makeChannel('empty-filter');
    channel.sourceConnector.filter.elements = { [ruleType]: step('Keep until replaced') };
    const writes = await setup(page, channel, 'filter/0');
    await upload(page, 'Import Filter', '<filter version="3.4.0"><rules><rule><name>Legacy rule</name></rule></rules></filter>');
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('legacy export requires engine migration');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('input.grid-name')).toHaveValue('Keep until replaced');
    await upload(page, 'Import Filter', '<filter version="4.6.0"/>');
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.locator('input.grid-name')).toHaveCount(0);
    const sent = await save(page, writes);
    expect(sent.sourceConnector.filter.elements).toBeNull();
});

test('connector import stops when the engine session expires during resource lookup', async ({ page }) => {
    const channel = makeChannel('expired-connector');
    const writes = await setup(page, channel);
    let release: () => void = () => {};
    let requested = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/server/resources', async route => {
        requested = true;
        await pending;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/session-expiry-probe', route => route.fulfill({ status: 401, body: '' }));
    await page.getByRole('tab', { name: 'Destinations', exact: true }).click();
    await upload(page, 'Import Connector', xml('connector', channel.destinationConnectors.connector[0]));
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(async () => {
        const store = await import(String('/core/store.js'));
        (window as any).importChannelBeforeExpiry = store.getState('editingChannel');
        const api = await import(String('/core/api.js'));
        await api.get('/session-expiry-probe').catch(() => {});
    });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    const completed = page.waitForResponse('**/api/server/resources');
    release();
    await completed;
    expect(await page.evaluate(() => (window as any).importChannelBeforeExpiry.destinationConnectors.connector.length)).toBe(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toHaveLength(0);
});
