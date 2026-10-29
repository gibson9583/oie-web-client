import assert from 'node:assert/strict';
import { replacementPairs, REPLACEMENT_PAIR } from './step-replacements.js';
import { generateElementScript } from './step-script.js';
import { inspectChannel } from './channel-inspector.js';

// Native OIE 4.6.0 XStream List<Pair<String,String>> and supported JSON imports.
const rows = [[String.raw`"^s3://bucket/(.*)$"`, '"/SharedData/$1"'], ['"/SharedData/"', '"/final/"']];
const pairs = rows.map(([left, right]) => ({ left: { '@class': 'string', $: left }, right: { '@class': 'string', $: right } }));
const native = { [REPLACEMENT_PAIR]: pairs };
for (const replacements of [native, rows, rows.map(([left, right]) => ({ left, right })),
    { entry: rows.map(([key, value]) => ({ key, value })) },
    rows.map(([first, second]) => ({ first, second })), rows.map(string => ({ string }))]) {
    assert.deepEqual(replacementPairs({ replacements }), rows);
}
assert.deepEqual(replacementPairs({ replacements: { [REPLACEMENT_PAIR]: pairs[0] } }), [rows[0]]);
for (const replacements of ['', null, undefined, {}, [null, false, 'unsupported']]) {
    assert.deepEqual(replacementPairs({ replacements }), []);
}
assert.deepEqual(replacementPairs({ replacements: { [REPLACEMENT_PAIR]: [
    { left: { '@class': 'string', $: 'false' }, right: { '@class': 'string' } },
    { left: '', right: '  ' }, { left: 0, right: false }
] } }), [['false', ''], ['', '  '], ['0', 'false']], 'decoding preserves blank expressions and typed scalar text');

for (const type of ['mapper.MapperStep', 'messagebuilder.MessageBuilderStep']) {
    const element = { __type: `com.mirth.connect.plugins.${type}`, variable: 'folder', messageSegment: "tmp['folder']", mapping: "'s3://bucket/sample'", replacements: native };
    const before = JSON.stringify(element);
    const script = generateElementScript(element);
    assert.ok(script.includes('new Array(new Array(' + rows[0].join(', ') + '),new Array(' + rows[1].join(', ') + '))'));
    const channel = { sourceConnector: { transformer: { elements: { [element.__type]: element } } } };
    const detail = inspectChannel(channel).sourceTransformer[0].detail;
    for (const [left, right] of rows) assert.ok(detail.includes(`${left} → ${right}`), 'Inspector and Generated Script consume the same ordered expressions');
    const calls = [];
    const validate = (mapping, fallback, replacements) => {
        calls.push(replacements);
        return replacements.reduce((value, [regex, replacement]) => value.replace(new RegExp(regex, 'g'), replacement), mapping || fallback);
    };
    const values = {};
    new Function('validate', 'channelMap', 'tmp', script)(validate, { put: (key, value) => { values[key] = value; } }, values);
    assert.equal(values.folder, '/final/sample');
    assert.deepEqual(calls, [rows.map(row => row.map(value => JSON.parse(value)))]);
    const nested = generateElementScript({ __type: 'com.mirth.connect.model.IteratorStep', properties: { target: 'items', indexVariable: 'i' } }, () => [element]);
    assert.ok(nested.includes(rows[0].join(', ')), 'iterator preview retains replacements');
    assert.equal(JSON.stringify(element), before, 'inspection and preview never mutate the model');
}
console.log('shared replacement decoding, inspection and executable script previews passed');
