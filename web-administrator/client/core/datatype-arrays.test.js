import assert from 'node:assert/strict';
import { dataTypeListText, normalizeDataTypeList, normalizeDelimitedProperties, normalizeChannelDataTypeArrays } from './datatype-arrays.js';

for (const value of [undefined, null, '', '  ', [], {}, { int: [] }, { int: null }]) {
    assert.deepEqual(normalizeDataTypeList(value, 'int'), {}, `empty ${JSON.stringify(value)}`);
}
for (const value of ['0', '-1', '1.5', '1e3', '2147483648', '999999999999999999999', '5,', ',3', '5,,3', { int: 0 }, { int: [5, -3] }, true]) {
    assert.ok(normalizeDataTypeList(value, 'int').error, `reject ${JSON.stringify(value)}`);
}
assert.deepEqual(normalizeDataTypeList('5, 3', 'int').value, { int: [5, 3] });
assert.deepEqual(normalizeDataTypeList('2147483647', 'int').value, { int: [2147483647] });
for (const wire of [{ int: 5 }, { int: '5' }, { int: [5, 3], '@class': 'int-array' }]) {
    assert.equal(normalizeDataTypeList(wire, 'int').value, wire, 'valid wire shape preserved');
}
assert.equal(dataTypeListText({ int: 5 }, 'int'), '5');
assert.equal(dataTypeListText({ int: [5, 3] }, 'int'), '5,3');
assert.equal(dataTypeListText('5,', 'int'), '5,', 'invalid text remains editable');
assert.deepEqual(normalizeDataTypeList('first,second', 'string', true).value, { string: ['first', 'second'] });
assert.deepEqual(normalizeDataTypeList('名字,_other,a:b', 'string', true).value, { string: ['名字', '_other', 'a:b'] });
for (const name of ['e\u0301', 'a\u00B7b', '\u{10000}field', 'a\u203F', '\u200Cname']) {
    const wire = { string: name };
    assert.equal(normalizeDataTypeList(wire, 'string', true).value, wire, `preserve XML name ${name}`);
}
for (const [wire, names] of [[{ string: true }, 'true'], [{ string: false }, 'false'], [{ string: null }, 'null'],
    [{ string: [true, false, null, 'normal'], '@class': 'string-array' }, ['true', 'false', 'null', 'normal']]]) {
    const copy = structuredClone(wire);
    const result = normalizeDataTypeList(wire, 'string', true);
    assert.deepEqual(result.value, { ...wire, string: names }, `engine literal names ${JSON.stringify(wire)}`);
    assert.deepEqual(wire, copy, 'engine literal recovery does not mutate the loaded value');
    assert.equal(normalizeDataTypeList(result.value, 'string', true).value, result.value, 'recovered names are stable');
    assert.equal(dataTypeListText(wire, 'string'), [names].flat().join(','));
}
assert.deepEqual(normalizeDataTypeList({ int: null }, 'int'), {}, 'null int wire remains empty');
for (const value of ['first,', '1first', 'a b', { string: ['good', ''] }, { string: 1 }]) {
    assert.ok(normalizeDataTypeList(value, 'string', true).error, `invalid names ${JSON.stringify(value)}`);
}
const unknownArray = { int: [5], future: 'retain' };
assert.ok(normalizeDataTypeList(unknownArray, 'int').error);
assert.deepEqual(unknownArray, { int: [5], future: 'retain' });
assert.equal(dataTypeListText(unknownArray, 'int'), JSON.stringify(unknownArray), 'unknown shape remains inspectable');
assert.equal(dataTypeListText({ int: { invalid: 5 } }, 'int'), '{"invalid":5}');
for (const unknown of [{ '@reference': '../columnWidths' }, { int: [], '@future': 'keep' }]) {
    const copy = structuredClone(unknown);
    assert.ok(normalizeDataTypeList(unknown, 'int').error, 'ambiguous metadata-only array must not disappear');
    assert.deepEqual(unknown, copy);
}
const properties = () => ({ '@class': 'Delimited', '@version': '4.6.0', future: { secret: 'keep' },
    serializationProperties: { '@class': 'Serialization', columnWidths: null, columnNames: { string: [] }, future: 42 },
    deserializationProperties: { columnWidths: '5,3', future: false } });
const props = properties();
assert.deepEqual(normalizeDelimitedProperties(props), []);
assert.deepEqual(props, { '@class': 'Delimited', '@version': '4.6.0', future: { secret: 'keep' },
    serializationProperties: { '@class': 'Serialization', future: 42 },
    deserializationProperties: { columnWidths: { int: [5, 3] }, future: false } });
const before = JSON.stringify(props);
normalizeDelimitedProperties(props);
assert.equal(JSON.stringify(props), before, 'normalization is idempotent');
const transformer = () => ({ inboundDataType: 'DELIMITED', outboundDataType: 'DELIMITED', inboundProperties: properties(), outboundProperties: properties() });
const connector = () => ({ name: 'Connector', transformer: transformer(), responseTransformer: transformer() });
for (const wrap of [value => value, value => [value]]) {
    const channel = { sourceConnector: connector(), destinationConnectors: { connector: wrap(connector()) } };
    normalizeChannelDataTypeArrays(channel);
    assert.equal(JSON.stringify(channel).includes('"columnWidths":null'), false, 'all sides and responses repaired');
    channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths = '0';
    assert.throws(() => normalizeChannelDataTypeArrays(channel), /Invalid Delimited Text properties/);
    assert.equal(channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths, '0', 'invalid value not silently replaced');
}
const readback = { sourceConnector: { transformer: { inboundDataType: 'DELIMITED',
    inboundProperties: { serializationProperties: { columnNames: { string: [true, 'normal'] } } } } } };
normalizeChannelDataTypeArrays(readback);
assert.deepEqual(readback.sourceConnector.transformer.inboundProperties.serializationProperties.columnNames, { string: ['true', 'normal'] });
const nonDelimited = { sourceConnector: { transformer: { inboundDataType: 'OTHER', inboundProperties: properties() } } };
const original = JSON.stringify(nonDelimited);
normalizeChannelDataTypeArrays(nonDelimited);
assert.equal(JSON.stringify(nonDelimited), original, 'unrelated types untouched');
console.log('datatype array tests passed');
