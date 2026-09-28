import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Page } from '@playwright/test';

function legacyChannel() {
    const channel = makeChannel('copy-delimited');
    channel.name = 'Legacy Delimited';
    channel.exportData = { metadata: { enabled: true } };
    for (const connector of [channel.sourceConnector, channel.destinationConnectors.connector[0]]) {
        for (const transformer of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
            for (const side of ['inbound', 'outbound']) {
                transformer[`${side}DataType`] = 'DELIMITED';
                transformer[`${side}Properties`] = {
                    '@class': 'com.mirth.connect.plugins.datatypes.delimited.DelimitedDataTypeProperties',
                    '@version': '4.6.0', future: { keep: true },
                    serializationProperties: { columnWidths: null, columnNames: '', unknown: 42 },
                    deserializationProperties: { columnWidths: { int: [] }, optional: null },
                };
            }
        }
    }
    channel.sourceConnector.transformer.outboundProperties.serializationProperties.columnWidths = '5,3';
    channel.sourceConnector.transformer.outboundProperties.serializationProperties.columnNames = 'first,second';
    channel.destinationConnectors.connector[0].transformer.inboundProperties.serializationProperties.columnWidths = { int: 7, '@class': 'int-array', '@future': 'keep' };
    return channel;
}

function expectNormalized(channel: any) {
    const destination = Array.isArray(channel.destinationConnectors.connector)
        ? channel.destinationConnectors.connector[0] : channel.destinationConnectors.connector;
    for (const connector of [channel.sourceConnector, destination]) {
        for (const transformer of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
            for (const side of ['inbound', 'outbound']) {
                const props = transformer[`${side}Properties`];
                expect(props.future).toEqual({ keep: true });
                expect(props.serializationProperties.unknown).toBe(42);
                expect(props.deserializationProperties).toEqual({ optional: null });
                if (transformer === channel.sourceConnector.transformer && side === 'outbound') {
                    expect(props.serializationProperties.columnWidths).toEqual({ int: [5, 3] });
                    expect(props.serializationProperties.columnNames).toEqual({ string: ['first', 'second'] });
                } else {
                    expect(props.serializationProperties).not.toHaveProperty('columnNames');
                    if (transformer === destination.transformer && side === 'inbound') {
                        expect(props.serializationProperties.columnWidths).toEqual({ int: 7, '@class': 'int-array', '@future': 'keep' });
                    } else expect(props.serializationProperties).not.toHaveProperty('columnWidths');
                }
            }
        }
    }
}

const bundledLibrary = {
    id: 'bundled-delimited', name: 'Bundled Delimited', revision: 0, includeNewChannels: false,
    enabledChannelIds: { string: ['copy-delimited'] }, disabledChannelIds: null, codeTemplates: null,
};

async function importFile(page: Page, channel: any, wrapped = true) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Channel', exact: true }).click();
    await (await chooser).setFiles({ name: 'delimited.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(wrapped ? { channel } : channel)) });
}

async function setup(page: Page, channels: any[] = [], overrides: Record<string, any> = {}) {
    const writes: any[] = [];
    const events: string[] = [];
    await mockEngine(page, {
        'GET /channels': () => ({ list: { channel: channels } }),
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [] } },
        'POST /codeTemplateLibraries/_bulkUpdate': () => {
            events.push('library');
            return { codeTemplateLibrarySaveResult: { librariesSuccess: true, overrideNeeded: false, codeTemplateResults: {} } };
        },
        'PUT /channels/*': (request: any) => { events.push('import'); writes.push(request.postDataJSON().channel); return true; },
        'POST /channels': (request: any) => { events.push('clone'); writes.push(request.postDataJSON().channel); return true; },
        ...overrides,
    });
    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'Import Channel', exact: true })).toBeVisible();
    return { writes, events };
}

for (const wrapped of [false, true]) {
    test(`JSON channel import normalizes all Delimited sides before PUT (${wrapped ? 'wrapped' : 'bare'})`, async ({ page }) => {
        const { writes } = await setup(page);
        const channel = legacyChannel();
        if (!wrapped) channel.destinationConnectors.connector = channel.destinationConnectors.connector[0];
        await importFile(page, channel, wrapped);
        await expect(page.getByText('Imported delimited.json', { exact: true })).toBeVisible();
        expect(writes).toHaveLength(1);
        expect(Array.isArray(writes[0].destinationConnectors.connector)).toBe(wrapped);
        expectNormalized(writes[0]);
    });
}

test('invalid JSON response arrays prevent library writes; corrected import can retry', async ({ page }) => {
    const { writes, events } = await setup(page);
    const channel = legacyChannel();
    channel.exportData.codeTemplateLibraries = { codeTemplateLibrary: [bundledLibrary] };
    channel.destinationConnectors.connector[0].responseTransformer.outboundProperties.deserializationProperties.columnWidths = '0';
    await importFile(page, channel);
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('responseTransformer outbound');
    expect(events).toEqual([]);
    expect(writes).toEqual([]);
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    channel.destinationConnectors.connector[0].responseTransformer.outboundProperties.deserializationProperties.columnWidths = null;
    await importFile(page, channel);
    await page.getByRole('dialog', { name: 'Import Channel', exact: true }).getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Imported delimited.json', { exact: true })).toBeVisible();
    expect(events).toEqual(['library', 'import']);
    expectNormalized(writes[0]);
    expect(writes[0].exportData).not.toHaveProperty('codeTemplateLibraries');
});

test('JSON import remains session-bound while awaiting bundled-library choice', async ({ page }) => {
    const { writes, events } = await setup(page, [], { 'GET /session-expiry-probe': { __status: 401 } });
    const channel = legacyChannel();
    channel.exportData.codeTemplateLibraries = { codeTemplateLibrary: [bundledLibrary] };
    await importFile(page, channel);
    await expect(page.getByRole('dialog', { name: 'Import Channel', exact: true })).toBeVisible();
    await page.evaluate(async () => {
        const api = await import(String('/core/api.js'));
        await api.get('/session-expiry-probe').catch(() => {});
    });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(events).toEqual([]);
    expect(writes).toEqual([]);
});

test('failed JSON channel write retries with the same normalized payload', async ({ page }) => {
    const attempts: any[] = [];
    await setup(page, [], { 'PUT /channels/*': (request: any) => {
        attempts.push(request.postDataJSON().channel);
        return attempts.length === 1 ? { __status: 500, body: 'channel write failed' } : true;
    } });
    const channel = legacyChannel();
    await importFile(page, channel);
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('channel write failed');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await importFile(page, channel);
    await expect(page.getByText('Imported delimited.json', { exact: true })).toBeVisible();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expectNormalized(attempts[1]);
});

test('Clone normalizes its isolated model and preserves the source channel', async ({ page }) => {
    await page.addInitScript(() => {
        const original = window.structuredClone;
        window.structuredClone = (value: any, options?: StructuredSerializeOptions) => {
            if (value?.id === 'copy-delimited') (window as any).__cloneSource = { value, before: JSON.stringify(value) };
            return original(value, options);
        };
    });
    const source = legacyChannel();
    const { writes } = await setup(page, [source]);
    await page.getByText(source.name, { exact: true }).click();
    await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
    await expect(page.getByText(`Cloned ${source.name}`, { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].id).not.toBe(source.id);
    expect(writes[0].name).toBe(`${source.name} copy`);
    expect(writes[0].revision).toBe(0);
    expectNormalized(writes[0]);
    expect(await page.evaluate(() => {
        const captured = (window as any).__cloneSource;
        return captured && JSON.stringify(captured.value) === captured.before;
    })).toBe(true);
});

test('Clone refuses invalid hidden response arrays without a POST', async ({ page }) => {
    const source = legacyChannel();
    source.destinationConnectors.connector[0].responseTransformer.inboundProperties.serializationProperties.columnWidths = '2147483648';
    const { writes, events } = await setup(page, [source]);
    await page.getByText(source.name, { exact: true }).click();
    await page.getByRole('button', { name: 'Clone Channel', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('responseTransformer inbound');
    expect(writes).toEqual([]);
    expect(events).toEqual([]);
});
