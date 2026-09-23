import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../web-administrator/client/react/views/editor-import.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'node',
    plugins: [{ name: 'pure-model-api', setup(builder) {
        builder.onResolve({ filter: /^@oie\/web-api$/ }, () => ({ path: fileURLToPath(new URL('../web-administrator/client/core/oie.ts', import.meta.url)) }));
    } }]
});
const { appendImportedDestination, normalizeImportTypes, remapImportedResources, parseFilterTransformerImport, alignDestinationTypes } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('destination identity allocation handles stale next ID, case-insensitive names and repeated imports', () => {
    const existing = { metaDataId: 12, name: 'DESTINATION 1', transformer: { inboundDataType: 'XML' } };
    const channel = { nextMetaDataId: 2, sourceConnector: { transformer: { outboundDataType: 'XML' } }, destinationConnectors: { connector: [existing] } };
    const make = () => ({ name: 'destination 1', metaDataId: 12, transformer: { inboundDataType: 'RAW', inboundProperties: { old: true } } });
    const first = make(), second = make();
    assert.equal(appendImportedDestination(channel, first, () => ({ xml: true })), 13);
    assert.equal(appendImportedDestination(channel, second, () => ({ xml: true })), 14);
    assert.equal(first.name, 'Destination 2');
    assert.equal(second.name, 'Destination 3');
    assert.equal(channel.destinationConnectors.connector[0], existing);
    assert.deepEqual(first.transformer, { inboundDataType: 'XML', inboundProperties: { xml: true } });
});

test('default-directed primitive conversion preserves text resembling numbers and booleans', () => {
    const value = { name: '001', script: 'false', enabled: 'false', port: '001', count: '5', nested: { flags: { boolean: ['false', 'true'] } } };
    normalizeImportTypes(value, { name: '', script: '', enabled: true, port: '', count: 0, nested: { flags: { boolean: [true, true] } } });
    assert.deepEqual(value, { name: '001', script: 'false', enabled: false, port: '001', count: 5, nested: { flags: { boolean: [false, true] } } });
});

test('resource imports refresh names by ID and remap missing IDs by name without duplicate IDs', () => {
    const connector = { properties: { resourceIds: { '@class': 'linked-hash-map', entry: [
        { string: ['id-a', 'Old name'] }, { string: ['old-b', 'Resource B'] }, { string: ['missing', 'Resource B'] }
    ] } } };
    remapImportedResources(connector, { list: [{ id: 'id-a', name: 'New name' }, { id: 'id-b', name: 'Resource B' }] });
    assert.deepEqual(connector.properties.resourceIds.entry.map(entry => entry.string), [['id-a', 'New name'], ['id-b', 'Resource B'], ['missing', 'Resource B']]);
});

test('response JSON full object retains templates/types and malformed elements fail instead of clearing', () => {
    const parsed = parseFilterTransformerImport(JSON.stringify({ responseTransformer: { elements: null, inboundDataType: 'XML', outboundDataType: 'RAW', inboundTemplate: { '@encoding': 'base64', $: Buffer.from('MSH|1\rPID|2\r').toString('base64') } } }), false, '4.6.0');
    assert.equal(parsed.inboundDataType, 'XML');
    assert.equal(parsed.inboundTemplate, 'MSH|1\rPID|2\r');
    assert.equal(parsed.elements, null);
    assert.throws(() => parseFilterTransformerImport('{"elements":"bad"}', true, '4.6.0'), /Invalid elements/);
    assert.throws(() => parseFilterTransformerImport('{"elements":{"broken":"bad"}}', true, '4.6.0'), /Invalid filter rule/);
    assert.throws(() => parseFilterTransformerImport('{"elements":null,"inboundTemplate":{"@encoding":"base64","$":"!"}}', false, '4.6.0'));
});

test('destination type alignment prepares all defaults before mutating any draft', () => {
    const channel = { destinationConnectors: { connector: [{ transformer: { inboundDataType: 'RAW' } }, { transformer: { inboundDataType: 'RAW' } }] } };
    const before = structuredClone(channel);
    let calls = 0;
    assert.throws(() => alignDestinationTypes(channel, 'XML', () => { if (++calls === 2) throw new Error('plugin failure'); return {}; }));
    assert.deepEqual(channel, before);
});


test('legacy element-only JSON replaces elements without clearing settings the file never exported', () => {
    const current = { elements: { old: [{ name: 'Old' }] }, inboundDataType: 'HL7V2', outboundDataType: 'XML', inboundTemplate: 'MSH|1\r', outboundProperties: { custom: true } };
    const parsed = parseFilterTransformerImport('{"elements":[]}', false, '4.6.0', current);
    assert.equal(parsed.elements, null);
    assert.equal(parsed.inboundDataType, 'HL7V2');
    assert.equal(parsed.inboundTemplate, 'MSH|1\r');
    assert.deepEqual(parsed.outboundProperties, { custom: true });
    assert.equal(current.elements.old[0].name, 'Old');
});

test('Swing destination naming searches from one even when existing destinations have custom names', () => {
    const channel = { sourceConnector: { transformer: { outboundDataType: 'RAW' } }, nextMetaDataId: 3, destinationConnectors: { connector: [
        { name: 'Custom A', metaDataId: 1 }, { name: 'Custom B', metaDataId: 2 }
    ] } };
    const imported = { name: 'CUSTOM A', transformer: { inboundDataType: 'RAW' } };
    appendImportedDestination(channel, imported, () => ({}));
    assert.equal(imported.name, 'Destination 1');
});
