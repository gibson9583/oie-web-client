/*
 * Fixtures for core/xstream.js — runnable with `node client/core/xstream.test.js`.
 * Each case is a real XStream-JSON shape the engine REST API returns, asserted
 * against the string the Swing client's StringUtil.valueOf would produce. When a
 * new XStream quirk surfaces, add a fixture here and fix it in xstream.js once.
 */

import { toDisplayString, mappingEntries, messageIdString, sourceMessageReferences } from './xstream.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL  ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

/* ---- toDisplayString: scalars / collections / Response ---- */
eq('plain string', toDisplayString('FACILITYX'), 'FACILITYX');
eq('boxed int', toDisplayString({ int: 8 }), '8');
eq('linked-hash-set single', toDisplayString({ 'linked-hash-set': { int: 1 } }), '[1]');
eq('list multi', toDisplayString({ list: { string: ['a', 'b'] } }), '[a, b]');
eq('Response with message', toDisplayString({ status: 'SENT', message: null, statusMessage: 'Message routed successfully to channel id: none' }),
    'SENT: Message routed successfully to channel id: none');
eq('Response status only', toDisplayString({ status: 'ERROR' }), 'ERROR');

/* ---- toDisplayString: nested + custom-serialized maps ---- */
eq('nested linked-hash-map', toDisplayString({ 'linked-hash-map': { entry: { string: ['k', 'v'] } } }), '{k=v}');

/* ---- toDisplayString: global-map values (root element re-attached by the caller) ---- */
// A script's Maps.map() stores a com.mirth.connect.userutil.MapBuilder: XStream
// writes the class as the root and its `delegate` field holds the map. Swing
// shows MapBuilder.toString() == delegate.toString() == "{k=v, …}".
eq('MapBuilder wrapper descends to its delegate map',
    toDisplayString({ 'com.mirth.connect.userutil.MapBuilder': { delegate: { entry: [{ string: ['a', 1] }, { string: ['b', 'two'] }] } } }),
    '{a=1, b=two}');
eq('MapBuilder with a nested map value',
    toDisplayString({ 'com.mirth.connect.userutil.MapBuilder': { delegate: { entry: { string: 'inner', map: { entry: { string: ['k', 'v'] } } } } } }),
    '{inner={k=v}}');
eq('plain HashMap root', toDisplayString({ map: { entry: { string: 'x', int: 5 } } }), '{x=5}');
eq('string root is the payload', toDisplayString({ string: 'THIS' }), 'THIS');
eq('list root', toDisplayString({ list: { string: ['a', 'b'] } }), '[a, b]');

const headerMap = {
    '@class': 'org.apache.commons.collections4.map.CaseInsensitiveMap',
    '@serialization': 'custom',
    'unserializable-parents': null,
    'org.apache.commons.collections4.map.CaseInsensitiveMap': {
        default: null, float: 0.75, int: [16, 3],
        string: ['content-length', 'content-type', 'date'],
        list: [{ string: 0 }, { string: 'text/plain;charset=utf-8' }, { string: 'Sun, 14 Jun 2026 21:38:04 GMT' }]
    }
};
eq('custom CaseInsensitiveMap (Map<String,List>)', toDisplayString(headerMap),
    '{content-length=[0], content-type=[text/plain;charset=utf-8], date=[Sun, 14 Jun 2026 21:38:04 GMT]}');

const stringMap = {
    '@class': 'java.util.HashMap', '@serialization': 'custom',
    'java.util.HashMap': { default: null, float: 0.75, int: [16, 2], string: ['a', '1', 'b', '2'] }
};
eq('custom HashMap (Map<String,String> interleaved)', toDisplayString(stringMap), '{a=1, b=2}');

/* ---- empty wire shapes: XStream renders an empty collection/map as '' ---- */
eq('empty string', toDisplayString(''), '');
eq('null', toDisplayString(null), '');
eq('undefined', toDisplayString(undefined), '');
eq('empty list', toDisplayString({ list: '' }), '[]');
eq('empty linked-hash-set', toDisplayString({ 'linked-hash-set': '' }), '[]');
eq('empty linked-hash-map', toDisplayString({ 'linked-hash-map': '' }), '{}');
eq('mappingEntries empty content', JSON.stringify(mappingEntries({ content: '' })), '[]');
eq('mappingEntries null map', JSON.stringify(mappingEntries(null)), '[]');
eq('mappingEntries empty entry list', JSON.stringify(mappingEntries({ content: { entry: '' } })), '[]');
eq('mappingEntries empty m wrapper', JSON.stringify(mappingEntries({ content: { m: '' } })), '[]');

/* ---- mappingEntries: source/connector/response map content ---- */
const sourceMap = { content: { m: { entry: { string: 'destinationSet', 'linked-hash-set': { int: 1 } } } } };
eq('mappingEntries destinationSet', JSON.stringify(mappingEntries(sourceMap)), JSON.stringify([['destinationSet', '[1]']]));

const connectorMap = { content: { entry: [{ string: ['mirth_source', 'FACILITYX'] }, { string: ['mirth_version', '2.5.1'] }] } };
eq('mappingEntries connector string-pairs', JSON.stringify(mappingEntries(connectorMap)),
    JSON.stringify([['mirth_source', 'FACILITYX'], ['mirth_version', '2.5.1']]));

const responseMap = { content: { entry: { string: 'd1', response: { status: 'SENT', statusMessage: 'Message routed successfully to channel id: none' } } } };
eq('mappingEntries response value', JSON.stringify(mappingEntries(responseMap)),
    JSON.stringify([['d1', 'SENT: Message routed successfully to channel id: none']]));

/* ---- Source-map navigation: preserve the stored index and exact message ID ---- */
const parentEntries = [
    { string: ['sourceChannelId', 'channel-b'] },
    { string: 'sourceMessageId', long: '9223372036854775807' }
];
const parent = { channelId: 'channel-b', messageId: '9223372036854775807' };
function references(label, entries, want) {
    eq(label, JSON.stringify(sourceMessageReferences({ content: { m: { entry: entries } } })), JSON.stringify(want));
}
references('singular String/Long pair', parentEntries, { parent, ancestors: [] });
references('string message ID', [{ string: ['sourceChannelId', 'channel-a'] }, { string: ['sourceMessageId', '42'] }],
    { parent: { channelId: 'channel-a', messageId: '42' }, ancestors: [] });
references('pair lists by index, preserving repeated channels and large IDs', [
    ...parentEntries,
    { string: 'sourceChannelIds', list: { string: ['channel-a', 'channel-a', 'channel-b'] } },
    { string: 'sourceMessageIds', list: { long: [1, 2, '9223372036854775807'] } }
], { parent, ancestors: [
    { channelId: 'channel-a', messageId: '1' },
    { channelId: 'channel-a', messageId: '2' },
    parent
] });
for (const [channels, messages] of [
    [{ list: { string: 'channel-a' } }, { list: { long: 1 } }],
    [{ 'array-list': { string: 'channel-a' } }, { 'linked-list': { long: 1 } }],
    [{ 'string-array': { string: 'channel-a' } }, { 'long-array': { long: 1 } }],
    [{ 'object-array': { string: 'channel-a' } }, { 'object-array': { long: 1 } }]
]) references('typed singleton collections', [
    { string: 'sourceChannelIds', ...channels }, { string: 'sourceMessageIds', ...messages }
], { parent: null, ancestors: [{ channelId: 'channel-a', messageId: '1' }] });

for (const [channels, messages] of [
    [{ list: '' }, { list: '' }],
    [{ list: { string: ['channel-a', 'channel-b'] } }, { list: { long: 1 } }],
    [{ list: { string: ['channel-a', null, 'channel-b'] } }, { list: { long: [1, 2, 3] } }],
    [{ list: { string: ['channel-a', 'channel-b'] } }, { list: { long: [1, null] } }],
    [{ list: { string: ['channel-a', 'channel-b'] } }, { list: { long: 1, string: '2' } }],
    [{ list: { string: 'channel-a', null: '' } }, { list: { long: [1, 2] } }],
    [{ list: { string: 'channel-a' } }, { list: { double: 1 } }],
    [{ list: { string: 'channel-a' } }, { list: { long: Number.MAX_SAFE_INTEGER + 1 } }],
    [{ list: { string: 'channel-a' } }, { list: { long: '9223372036854775808' } }],
    [{ list: { string: 'channel-a' } }, { list: null }],
    [{ set: { string: 'channel-a' } }, { list: { long: 1 } }],
    [{ list: { string: 'channel-a' } }, { list: { '@reference': '../other' } }]
]) references('malformed or empty arrays keep valid parent only', [
    ...parentEntries, { string: 'sourceChannelIds', ...channels }, { string: 'sourceMessageIds', ...messages }
], { parent, ancestors: [] });
references('formatted list strings are not references', [
    { string: ['sourceChannelIds', '[channel-a, channel-b]'] },
    { string: ['sourceMessageIds', '[1, 2]'] }
], { parent: null, ancestors: [] });
references('no partial singular pair', [parentEntries[0]], { parent: null, ancestors: [] });
references('duplicate fields are ambiguous', [...parentEntries, parentEntries[0]], { parent: null, ancestors: [] });
references('blank channel is not a reference', [{ string: ['sourceChannelId', ' '] }, parentEntries[1]],
    { parent: null, ancestors: [] });
eq('missing source map', JSON.stringify(sourceMessageReferences(null)), JSON.stringify({ parent: null, ancestors: [] }));
for (const id of [1, Number.MAX_SAFE_INTEGER, '9007199254740992', '9223372036854775807']) {
    eq('valid message ID stays exact', messageIdString(id), String(id));
}
for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null, true, {}, '', '01', '+1', ' 1', '1 ', '1e2', '1.0', '9223372036854775808']) {
    eq('invalid or unsafe message ID', messageIdString(id), null);
}

console.log(`\nxstream.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
