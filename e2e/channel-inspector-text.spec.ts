import { test, expect } from './base.js';
import { mockEngine, fixtureXml as xml } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const ID = 'inspector-text';
const PKG = 'com.mirth.connect.plugins.datatypes.hl7v2';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';
const XSLT = 'com.mirth.connect.plugins.xsltstep.XsltStep';

// OIE 4.6.0 ObjectJSONSerializer uses Staxon's autoPrimitive mode. These
// representations were verified against the shipped serializer, including
// typed ImmutablePair values and the attachment handler's string map.
const primitive = (value: string): unknown => value === '' ? null : JSON.parse(value);
const transformers = (channel: any): any[] => [channel.sourceConnector.transformer,
    ([] as any[]).concat(channel.destinationConnectors.connector)[0].transformer,
    ([] as any[]).concat(channel.destinationConnectors.connector)[0].responseTransformer];

function textChannel(value: string) {
    const channel = makeChannel(ID);
    channel.name = 'Exact Inspector text';
    channel.exportData = { metadata: { enabled: true, lastModified: { time: 1700000000000, timezone: 'UTC' } } };
    channel.sourceConnector.properties.sourceConnectorProperties.processBatch = true;
    for (const transformer of transformers(channel)) {
        for (const side of ['inbound', 'outbound']) {
            transformer[`${side}Properties`] = {
                '@class': `${PKG}.HL7v2DataTypeProperties`, '@version': '4.6.0',
                serializationProperties: { '@class': `${PKG}.HL7v2SerializationProperties`, handleRepetitions: false },
                batchProperties: { '@class': `${PKG}.HL7v2BatchProperties`, splitType: 'JavaScript', batchScript: value, extensionFlag: false },
                responseGenerationProperties: { '@class': `${PKG}.HL7v2ResponseGenerationProperties`, successfulACKMessage: value, msh15ACKAccept: true },
                extensionProperties: { '@class': 'example.UnknownProperties', batchScript: null, enabled: false }
            };
        }
    }
    const wire = structuredClone(channel);
    for (const transformer of transformers(wire)) {
        for (const side of ['inbound', 'outbound']) {
            transformer[`${side}Properties`].batchProperties.batchScript = primitive(value);
            transformer[`${side}Properties`].responseGenerationProperties.successfulACKMessage = primitive(value);
        }
    }
    return { channel, wire };
}

for (const value of ['false', 'true', 'null', '-0', '1e2', '']) {
    test(`Inspector preserves datatype source ${JSON.stringify(value)} across reads, print and writes`, async ({ page }) => {
        const { channel, wire } = textChannel(value);
        let xmlReads = 0;
        let written: any;
        await mockEngine(page, {
            'GET /channels': { list: { channel: wire } },
            [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml')
                ? (xmlReads++, xml('channel', channel)) : { channel: wire },
            [`PUT /channels/${ID}`]: (request: any) => { written = request.postDataJSON().channel; return true; }
        });
        await page.goto('/channels');
        await expect(page.getByText(channel.name, { exact: true })).toBeVisible();
        expect(xmlReads).toBe(0);
        const restored = await page.evaluate(async id => {
            const api = await import(String('/core/api.js'));
            const channel = await api.channels.get(id);
            await api.channels.update(id, channel);
            return channel;
        }, ID);
        expect(xmlReads).toBe(1);
        for (const result of [restored, written]) {
            for (const transformer of transformers(result)) {
                for (const side of ['inbound', 'outbound']) {
                    expect(transformer[`${side}Properties`]).toEqual(channel.sourceConnector.transformer.inboundProperties);
                }
            }
        }

        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.locator('#ci-receive details.ci-more > summary').click();
        const receive = page.locator('#ci-receive');
        const factValues = (scope: any, label: string) => scope.locator('.ci-fact').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
        await expect(factValues(receive, 'Batch · JavaScript')).toHaveText(value ? [value, value] : []);
        await expect(factValues(receive, 'Response Generation · Successful ACK Message')).toHaveText(value ? [value, value] : []);
        await expect(factValues(receive, 'Serialization · Parse Field Repetitions')).toHaveText(['No', 'No']);
        await expect(factValues(receive, 'Response Generation · MSH-15 ACK Accept')).toHaveText(['Yes', 'Yes']);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const printed = page.getByRole('dialog', { name: 'Print preview', exact: true }).locator('section[aria-labelledby="print-ci-receive"]');
        await expect(factValues(printed, 'Batch · JavaScript')).toHaveText(value ? [value, value] : []);
        await expect(factValues(printed, 'Response Generation · Successful ACK Message')).toHaveText(value ? [value, value] : []);
        await expect(factValues(printed, 'Serialization · Parse Field Repetitions')).toHaveText(['No', 'No']);
    });
}

test('recovers batch source for every shipped batch datatype class', async ({ page }) => {
    const types = [
        ['HL7V2', 'hl7v2.HL7v2'], ['HL7V3', 'hl7v3.HL7V3'], ['XML', 'xml.XML'], ['JSON', 'json.JSON'],
        ['EDI', 'edi.EDI'], ['NCPDP', 'ncpdp.NCPDP'], ['DELIMITED', 'delimited.Delimited'], ['RAW', 'raw.Raw']
    ];
    const channels = types.map(([name, type], index) => {
        const channel = makeChannel(`batch-type-${index}`);
        channel.sourceConnector.transformer.inboundDataType = name;
        channel.sourceConnector.transformer.inboundProperties = {
            '@class': `com.mirth.connect.plugins.datatypes.${type}DataTypeProperties`,
            batchProperties: { '@class': `com.mirth.connect.plugins.datatypes.${type}BatchProperties`, batchScript: 'null' }
        };
        return channel;
    });
    let xmlReads = 0;
    await mockEngine(page, {
        'GET /channels': { list: { channel: [] } },
        'GET /channels/batch-type-*': (request: any) => {
            const channel = channels.find(channel => new URL(request.url()).pathname.endsWith('/' + channel.id));
            if (request.headers().accept?.includes('application/xml')) { xmlReads++; return xml('channel', channel); }
            const wire = structuredClone(channel);
            wire.sourceConnector.transformer.inboundProperties.batchProperties.batchScript = null;
            return { channel: wire };
        }
    });
    await page.goto('/channels');
    const values = await page.evaluate(async ids => {
        const api = await import(String('/core/api.js'));
        return Promise.all(ids.map(async id => (await api.channels.get(id)).sourceConnector.transformer.inboundProperties.batchProperties.batchScript));
    }, channels.map(channel => channel.id));
    expect(values).toEqual(types.map(() => 'null'));
    expect(xmlReads).toBe(types.length);
});

test('restores all bundled datatype text fields and string lists without coercing typed settings', async ({ page }) => {
    const snapshots = new Map<string, { channel: any; wire: any }>();
    await mockEngine(page, {
        'GET /channels/text-schema-*': (request: any) => {
            const id = new URL(request.url()).pathname.split('/').at(-1)!;
            const { channel, wire } = snapshots.get(id)!;
            return request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire };
        }
    });
    await page.goto('/channels');
    await expect(page.getByRole('button', { name: 'Import Channel', exact: true })).toBeVisible();
    const definitions = await page.evaluate(async () => {
        const { platform } = await import(String('@oie/web-shell'));
        return [...platform.dataTypes().values()].map((def: any) => ({
            name: def.name, propertiesClass: def.propertiesClass, groups: def.groups
        }));
    });
    for (const [index, def] of definitions.entries()) {
        const channel = makeChannel(`text-schema-${index}`);
        const props: any = { '@class': def.propertiesClass };
        for (const group of def.groups) {
            const values: any = { '@class': group.class };
            for (const field of group.fields) {
                values[field.key] = field.type === 'text' || field.type === 'code' ? 'null'
                    : field.type === 'list' ? (field.item === 'string' ? { string: ['false', 'null', '-0'] } : { int: [0, 12] })
                    : field.default;
            }
            props[group.key] = values;
        }
        channel.sourceConnector.transformer.inboundDataType = def.name;
        channel.sourceConnector.transformer.inboundProperties = props;
        const wire = structuredClone(channel);
        for (const group of def.groups) {
            const values = wire.sourceConnector.transformer.inboundProperties[group.key];
            for (const field of group.fields) {
                if (field.type === 'text' || field.type === 'code') values[field.key] = null;
                else if (field.type === 'list' && field.item === 'string') values[field.key].string = [false, null, 0];
            }
        }
        snapshots.set(channel.id, { channel, wire });
    }
    const restored = await page.evaluate(async ids => {
        const api = await import(String('/core/api.js'));
        return Promise.all(ids.map(async id => (await api.channels.get(id)).sourceConnector.transformer.inboundProperties));
    }, [...snapshots.keys()]);
    expect(restored).toEqual([...snapshots.values()].map(({ channel }) => channel.sourceConnector.transformer.inboundProperties));
});

test('preserves typed replacement source and only the JavaScript attachment map entry', async ({ page }) => {
    const channel = makeChannel(ID);
    const pair = (left: string, right: string) => ({ left: { '@class': 'string', $: left }, right: { '@class': 'string', $: right } });
    channel.sourceConnector.transformer.elements = {
        [MAPPER]: { name: 'Map with replacements', enabled: true, variable: 'key', mapping: "'value'", replacements: { [PAIR]: [pair('false', 'null'), pair('-0', 'true')] } },
        [BUILDER]: { name: 'Build with replacement', enabled: true, messageSegment: "msg['field']", mapping: "'value'", replacements: { [PAIR]: pair('1e2', '') } },
        [XSLT]: { name: 'Transform XML', enabled: true, sourceXml: "'<root/>'", resultVariable: 'result', template: "'<stylesheet/>'", useCustomFactory: false, customFactory: 'null' }
    };
    channel.properties.attachmentProperties = {
        className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider', type: 'JavaScript',
        properties: { entry: [{ string: ['javascript.script', 'null'] }, { string: ['other.property', false] }] }
    };
    channel.properties.unknownPlugin = { replacements: { [PAIR]: pair('false', 'null') } };
    const wire = structuredClone(channel);
    for (const type of [MAPPER, BUILDER]) {
        const pairs = wire.sourceConnector.transformer.elements[type].replacements[PAIR];
        for (const item of Array.isArray(pairs) ? pairs : [pairs]) {
            for (const side of ['left', 'right']) {
                const value = item[side].$;
                if (value === '') delete item[side].$; // An empty typed XML String has only the class attribute in JSON.
                else item[side].$ = primitive(value);
            }
        }
    }
    wire.sourceConnector.transformer.elements[XSLT].customFactory = null;
    wire.properties.attachmentProperties.properties.entry[0].string[1] = null;
    wire.properties.unknownPlugin.replacements[PAIR].left.$ = false;
    wire.properties.unknownPlugin.replacements[PAIR].right.$ = null;
    let written: any;
    await mockEngine(page, {
        [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire },
        [`PUT /channels/${ID}`]: (request: any) => { written = request.postDataJSON().channel; return true; }
    });
    await page.goto('/channels');
    const restored = await page.evaluate(async id => {
        const api = await import(String('/core/api.js'));
        const channel = await api.channels.get(id);
        await api.channels.update(id, channel);
        return channel;
    }, ID);
    for (const result of [restored, written]) {
        expect(result.sourceConnector.transformer.elements).toEqual(channel.sourceConnector.transformer.elements);
        expect(result.properties.attachmentProperties).toEqual(channel.properties.attachmentProperties);
        expect(result.properties.unknownPlugin).toEqual(wire.properties.unknownPlugin);
    }
    channel.properties.attachmentProperties.properties.entry = channel.properties.attachmentProperties.properties.entry[0];
    wire.properties.attachmentProperties.properties.entry = wire.properties.attachmentProperties.properties.entry[0];
    const singleton = await page.evaluate(async id => (await (await import(String('/core/api.js'))).channels.get(id)).properties.attachmentProperties, ID);
    expect(singleton).toEqual(channel.properties.attachmentProperties);
});

test('datatype text uses one authoritative snapshot and rejects unavailable or wrong-channel XML', async ({ page }) => {
    const { channel, wire } = textChannel('null');
    let mode = 'success';
    await mockEngine(page, {
        [`GET /channels/${ID}`]: (request: any) => {
            if (!request.headers().accept?.includes('application/xml')) return { channel: wire };
            if (mode === 'unavailable') return { __status: 503, body: 'Text XML unavailable' };
            const snapshot = structuredClone(channel);
            if (mode === 'id') snapshot.id = 'different-channel';
            if (mode === 'revision') snapshot.revision++;
            if (mode === 'timestamp') snapshot.exportData.metadata.lastModified.time++;
            return xml('channel', snapshot);
        }
    });
    await page.goto('/channels');
    for (mode of ['id', 'unavailable']) {
        const error = await page.evaluate(async id => {
            try { await (await import(String('/core/api.js'))).channels.get(id); return ''; }
            catch (error: any) { return error.message; }
        }, ID);
        expect(error).toMatch(mode === 'unavailable' ? /Text XML unavailable/ : /invalid channel XML/);
    }
    for (mode of ['revision', 'timestamp']) {
        const result = await page.evaluate(async id => (await import(String('/core/api.js'))).channels.get(id), ID);
        expect(result.revision).toBe(channel.revision + (mode === 'revision' ? 1 : 0));
        expect(result.exportData.metadata.lastModified.time).toBe(channel.exportData.metadata.lastModified.time + (mode === 'timestamp' ? 1 : 0));
        expect(result.sourceConnector.transformer.inboundProperties.batchProperties.batchScript).toBe('null');
    }
});
