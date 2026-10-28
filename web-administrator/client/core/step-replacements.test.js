import assert from 'node:assert/strict';
import { replacementPairs, replacementsToWire, REPLACEMENT_PAIR } from './step-replacements.js';
import { generateElementScript } from './step-script.js';

const rows = [[String.raw`"^s3://bucket/(.*)$"`, '"/SharedData/$1"'], ['"/SharedData/"', '"/final/"']];
const wire = replacementsToWire(rows);
assert.deepEqual(replacementPairs({ replacements: wire }), rows);
assert.deepEqual(replacementPairs({ replacements: { [REPLACEMENT_PAIR]: wire[REPLACEMENT_PAIR][0] } }), [rows[0]]);
assert.deepEqual(replacementPairs({ replacements: { [REPLACEMENT_PAIR]: { left: { '@class': 'string', $: 'false' }, right: { '@class': 'string' } } } }), [['false', '']]);
for (const replacements of ['', null, undefined, {}]) assert.deepEqual(replacementPairs({ replacements }), []);
assert.equal(replacementsToWire([[' ', "''"]]), '');
assert.equal(replacementsToWire([['\t\n\u001c\u2000', '"ignored"']]), '');
for (const value of ['\u00a0', '\u2007', '\u202f', '\ufeff']) {
    assert.deepEqual(replacementPairs({ replacements: replacementsToWire([[value, '']]) }), [[value, '']], 'Java non-blank characters must not be dropped by JS trim');
}
assert.deepEqual(replacementsToWire([['', "''"], ...rows]), wire);
for (const replacements of [rows, rows.map(([left, right]) => ({ left, right })),
    { entry: rows.map(([key, value]) => ({ key, value })) },
    rows.map(([first, second]) => ({ first, second })), rows.map(string => ({ string }))]) {
    assert.deepEqual(replacementPairs({ replacements }), rows);
}
const snapshot = JSON.stringify(wire);
for (const type of ['mapper.MapperStep', 'messagebuilder.MessageBuilderStep']) {
    const element = { __type: `com.mirth.connect.plugins.${type}`, variable: 'folder', messageSegment: "tmp['folder']", mapping: "'s3://bucket/sample'", replacements: wire };
    const script = generateElementScript(element);
    assert.ok(script.includes('new Array(new Array(' + rows[0].join(', ') + '),new Array(' + rows[1].join(', ') + '))'));
    assert.ok(!script.includes('[object Object]'));
    const calls = [];
    // Execute the generated expressions with an engine-shaped validate helper;
    // the server source defines these as raw JS, never auto-quoted strings.
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
}
assert.equal(JSON.stringify(wire), snapshot, 'reading and previewing never mutate the model');
console.log('step replacement wire formats and generated scripts passed');
