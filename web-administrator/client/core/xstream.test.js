/*
 * Fixtures for core/xstream.js — runnable with `node client/core/xstream.test.js`.
 * Each case is a real XStream-JSON shape the engine REST API returns, asserted
 * against the string the Swing client's StringUtil.valueOf would produce. When a
 * new XStream quirk surfaces, add a fixture here and fix it in xstream.js once.
 */

import { toDisplayString, mappingEntries } from './xstream.js';

let pass = 0, fail = 0;
function eq(label, got, want) {
    if (got === want) { pass++; return; }
    fail++;
    console.error(`FAIL  ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

/* ---- toDisplayString: scalars / collections / Response ---- */
eq('plain string', toDisplayString('LA.OCHSNER'), 'LA.OCHSNER');
eq('boxed int', toDisplayString({ int: 8 }), '8');
eq('linked-hash-set single', toDisplayString({ 'linked-hash-set': { int: 1 } }), '[1]');
eq('list multi', toDisplayString({ list: { string: ['a', 'b'] } }), '[a, b]');
eq('Response with message', toDisplayString({ status: 'SENT', message: null, statusMessage: 'Message routed successfully to channel id: none' }),
    'SENT: Message routed successfully to channel id: none');
eq('Response status only', toDisplayString({ status: 'ERROR' }), 'ERROR');

/* ---- toDisplayString: nested + custom-serialized maps ---- */
eq('nested linked-hash-map', toDisplayString({ 'linked-hash-map': { entry: { string: ['k', 'v'] } } }), '{k=v}');

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

/* ---- mappingEntries: source/connector/response map content ---- */
const sourceMap = { content: { m: { entry: { string: 'destinationSet', 'linked-hash-set': { int: 1 } } } } };
eq('mappingEntries destinationSet', JSON.stringify(mappingEntries(sourceMap)), JSON.stringify([['destinationSet', '[1]']]));

const connectorMap = { content: { entry: [{ string: ['mirth_source', 'LA.OCHSNER'] }, { string: ['mirth_version', '2.5.1'] }] } };
eq('mappingEntries connector string-pairs', JSON.stringify(mappingEntries(connectorMap)),
    JSON.stringify([['mirth_source', 'LA.OCHSNER'], ['mirth_version', '2.5.1']]));

const responseMap = { content: { entry: { string: 'd1', response: { status: 'SENT', statusMessage: 'Message routed successfully to channel id: none' } } } };
eq('mappingEntries response value', JSON.stringify(mappingEntries(responseMap)),
    JSON.stringify([['d1', 'SENT: Message routed successfully to channel id: none']]));

console.log(`\nxstream.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
