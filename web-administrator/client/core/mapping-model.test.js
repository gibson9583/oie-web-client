import assert from 'node:assert/strict';
import {
    replacementPairs, toReplacements, literalString, quoteString, indexTree, previewMapping,
    variablesSet, variablesRead, orderWarnings, MAPPER_TYPE, MSGBUILDER_TYPE, JAVASCRIPT_TYPE
} from './mapping-model.js';
import { generateElementScript } from './step-script.js';

const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';

// Engine wire shapes (ObjectJSONSerializer 4.6.0): null, one pair, many pairs, numeric `$`.
assert.deepEqual(replacementPairs(null), []);
assert.deepEqual(replacementPairs(''), []);
assert.deepEqual(replacementPairs({ [PAIR]: { left: { '@class': 'string', $: "'a0'" }, right: { '@class': 'string', $: 1 } } }),
    [["'a0'", '1']]);
assert.deepEqual(replacementPairs({ [PAIR]: [
    { left: { '@class': 'string', $: "'a'" }, right: { '@class': 'string', $: "''" } },
    { left: { '@class': 'string', $: "'b'" }, right: { '@class': 'string', $: "'c'" } }
] }), [["'a'", "''"], ["'b'", "'c'"]]);
// Round trip through the writer.
assert.deepEqual(replacementPairs(toReplacements([["'x'", "'y'"]])), [["'x'", "'y'"]]);
assert.equal(toReplacements([]), '');
assert.deepEqual(toReplacements([["'x'", "''"]])[PAIR][0].left, { '@class': 'string', $: "'x'" });

// Generated script now includes engine-shaped replacements.
const mapper = {
    __type: MAPPER_TYPE, variable: 'mrn', scope: 'CHANNEL', mapping: "msg['PID']['PID.3']['PID.3.1'].toString()",
    defaultValue: '', replacements: { [PAIR]: { left: { '@class': 'string', $: "'^MRN-'" }, right: { '@class': 'string', $: "''" } } }
};
assert.match(generateElementScript(mapper, () => []), /new Array\(new Array\('\^MRN-', ''\)\)/);

// Literals.
assert.equal(literalString("'abc'"), 'abc');
assert.equal(literalString('"a\\"b"'), 'a"b');
assert.equal(literalString("'it\\'s'"), "it's");
assert.equal(literalString("'\\\\s+'"), '\\s+');
assert.equal(literalString("'a' + 'b'"), null);
assert.equal(literalString("msg['PID']"), null);
assert.equal(literalString(quoteString("it's \\ new\nline")), "it's \\ new\nline");

// Preview against a tree.
const tree = [{ label: 'HL7Message', value: null, accessor: 'msg.toString()', children: [
    { label: 'PID', value: null, accessor: "msg['PID'].toString()", children: [
        { label: 'PID.3.1', value: 'MRN-448812 ', accessor: "msg['PID']['PID.3']['PID.3.1'].toString()", children: [] },
        { label: 'PID.19', value: '', accessor: "msg['PID']['PID.19'].toString()", children: [] }
    ] }
] }];
const index = indexTree(tree);
let p = previewMapping({ ...mapper, replacements: toReplacements([["'^MRN-'", "''"], ["'\\\\s+'", "''"]]) }, index);
assert.equal(p.status, 'ok');
assert.equal(p.value, '448812');
assert.equal(p.steps.length, 2);
// Without .toString() too.
assert.equal(previewMapping({ mapping: "msg['PID']['PID.3']['PID.3.1']" }, index).value, 'MRN-448812 ');
// Blank field takes the default; replacements still apply to it (engine order).
p = previewMapping({ mapping: "msg['PID']['PID.19'].toString()", defaultValue: "'N/A'", replacements: toReplacements([["'/'", "'-'"]]) }, index);
assert.equal(p.value, 'N-A');
assert.equal(p.usedDefault, true);
// A plain path that is not in the template reads as '' (then the default).
p = previewMapping({ mapping: "msg['PV1']['PV1.19']['PV1.19.1'].toString()", defaultValue: "'none'" }, index);
assert.equal(p.status, 'ok');
assert.equal(p.missing, true);
assert.equal(p.value, 'none');
// …unless there is no template at all.
assert.equal(previewMapping({ mapping: "msg['PV1'].toString()" }, indexTree(null)).status, 'runtime');
// Text value.
assert.equal(previewMapping({ mapping: "'ADT'" }, index).value, 'ADT');
// Blank mapping -> '' (engine defaultIfBlank).
assert.equal(previewMapping({ mapping: '' }, index).value, '');
// Runtime-only values.
assert.equal(previewMapping({ mapping: "$c('x')" }, index).status, 'runtime');
assert.equal(previewMapping({ mapping: "msg['PID'].toString()" }, index).status, 'runtime');   // complex node
assert.equal(previewMapping({ mapping: "msg['PID']['PID.19'].toString()", defaultValue: "$c('d')" }, index).status, 'runtime');
assert.equal(previewMapping({ mapping: "'a'", replacements: toReplacements([['re', "''"]]) }, index).status, 'runtime');
assert.equal(previewMapping({ mapping: "'a'", replacements: toReplacements([["'('", "''"]]) }, index).status, 'error');

// JSON tree display text must not coerce runtime nulls/numbers/booleans into
// strings. The engine's default and replacement behavior differs by type.
for (const [valueType, value] of [['null', 'null'], ['number', '123'], ['boolean', 'true'], ['object', null], ['array', null]]) {
    const jsonIndex = indexTree([{ label: 'value', accessor: "msg['value']", value, valueType, children: [] }]);
    assert.equal(previewMapping({ mapping: "msg['value']", defaultValue: "'N/A'", replacements: toReplacements([["'1'", "'9'"]]) }, jsonIndex).status, 'runtime');
}
assert.equal(previewMapping({ mapping: "msg['value']", replacements: toReplacements([["'1'", "'9'"]]) },
    indexTree([{ label: 'value', accessor: "msg['value']", value: '123', valueType: 'string', children: [] }])).value, '923');
const typedJson = [{ label: 'msg', accessor: 'msg', value: null, valueType: 'object', children: [
    { label: 'text', accessor: "msg['text']", value: 'ABC', valueType: 'string', children: [] }
] }];
assert.equal(previewMapping({ mapping: "msg['missing']['leaf']", defaultValue: "'N/A'" }, indexTree(typedJson)).status, 'runtime');
assert.equal(previewMapping({ mapping: "msg['text'][0]" }, indexTree(typedJson)).status, 'runtime');
assert.equal(previewMapping({ mapping: "msg['text']" }, indexTree(typedJson)).value, 'ABC');

// Variables set / read.
assert.deepEqual(variablesSet(mapper), ['mrn']);
assert.deepEqual(variablesSet({ ...mapper, enabled: false }), []);
assert.deepEqual(variablesSet({ __type: JAVASCRIPT_TYPE, script: "channelMap.put('a', 1); $c('b', 2); $c('c');" }).sort(), ['a', 'b']);
assert.deepEqual(variablesRead({ __type: MSGBUILDER_TYPE, messageSegment: "tmp['PID']", mapping: "$c('full')" }), ['full']);
assert.deepEqual(variablesRead({ __type: JAVASCRIPT_TYPE, script: "var x = channelMap.get('a') + $('b') + $gc('g'); $c('set', 1);" }).sort(), ['a', 'b', 'g']);

// Order: Mapper -> JavaScript -> Message Builder is fine; reading before the setter is flagged.
const js = { __type: JAVASCRIPT_TYPE, script: "channelMap.put('full', $c('mrn') + '!');" };
const builder = { __type: MSGBUILDER_TYPE, messageSegment: "tmp['PID']['PID.3']['PID.3.1']", mapping: "$c('full')" };
assert.deepEqual(orderWarnings([mapper, js, builder]), [[], [], []]);
assert.deepEqual(orderWarnings([builder, mapper, js]), [[{ name: 'full', setBy: 2 }], [], []]);
assert.deepEqual(orderWarnings([js, mapper]), [[{ name: 'mrn', setBy: 1 }], []]);
// Variables set nowhere here are not flagged.
assert.deepEqual(orderWarnings([{ __type: MSGBUILDER_TYPE, mapping: "$c('fromSource')" }]), [[]]);

console.log('mapping-model tests passed');

// Iterator context uses real ancestor metadata, not a separate Builder type.
const { iteratorExpression, iteratorTree, iteratorSampleCount, sampleExpression, rebindIteratorStep } = await import('./mapping-model.js');
assert.equal(iteratorSampleCount(typedJson, { target: "msg['text']", indexVariable: 'i', prefixSubstitutions: [] }, []), null);
const loop = { name: 'For each OBX', target: "msg['OBX']", indexVariable: 'i', prefixSubstitutions: ["msg['OBX']", "tmp['OBX']"] };
const loops = [loop];
const source = "msg['OBX'][0]['OBX.5']['OBX.5.1'].toString()";
const symbolic = "msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()";
assert.equal(iteratorExpression(source, loops), symbolic);
assert.equal(iteratorExpression(symbolic, loops), symbolic); // idempotent
assert.equal(iteratorExpression("msg['PID']['PID.3']", loops), "msg['PID']['PID.3']");
assert.equal(iteratorExpression(source, [{ ...loop, prefixSubstitutions: [] }]), source);
assert.equal(iteratorExpression("msg['OBX'][i] + '-suffix'", loops, true), "msg['OBX'][i] + '-suffix'");
assert.equal(iteratorExpression("'msg[OBX][i]'", loops, true), "'msg[OBX][i]'");
assert.equal(iteratorExpression(symbolic, loops, true), "msg['OBX']['OBX.5']['OBX.5.1'].toString()");
assert.equal(iteratorExpression("tmp['OBX'][0]['OBX.5']", [{ ...loop, prefixSubstitutions: ["msg['OBX']"] }]), "tmp['OBX'][0]['OBX.5']");
assert.equal(sampleExpression(symbolic, loops, { iteratorIndices: { i: 2 } }), "msg['OBX'][2]['OBX.5']['OBX.5.1'].toString()");
assert.equal(sampleExpression("msg['OBX'][unrelated]", loops), "msg['OBX'][unrelated]");
const repetitions = ['98', '97', '96'].map((value, i) => ({ label: 'OBX', value: null, accessor: `msg['OBX'][${i}].toString()`, children: [
    { label: 'OBX.5.1', value, accessor: `msg['OBX'][${i}]['OBX.5']['OBX.5.1'].toString()`, children: [] }
] }));
const repeatedIndex = indexTree(repetitions);
assert.equal(iteratorSampleCount(repetitions, loop, loops), 3);
for (let i = 0; i < 3; i++) {
    const options = { iteratorIndices: { i } };
    const picked = iteratorTree(repetitions, loops, options);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].children[0].accessor, symbolic);
    assert.equal(picked[0].children[0].value, ['98', '97', '96'][i]);
    const preview = previewMapping({ mapping: symbolic }, repeatedIndex, loops, options);
    assert.equal(preview.value, ['98', '97', '96'][i]);
}
assert.equal(previewMapping({ mapping: symbolic }, repeatedIndex, loops, { iteratorIndices: { i: 4 } }).status, 'runtime');
assert.equal(previewMapping({ mapping: "'constant'" }, indexTree([]), loops).status, 'runtime');
assert.equal(previewMapping({ mapping: symbolic }, repeatedIndex, [{ ...loop, target: '$c(\'runtime\')' }]).status, 'runtime');
// XML singleton trees omit [0]; its only sample still carries [i] in saved paths.
const singleton = [{ label: 'OBX', accessor: "msg['OBX'].toString()", value: null, children: [
    { label: 'value', accessor: "msg['OBX']['OBX.5']['OBX.5.1'].toString()", value: 'one', children: [] }
] }];
assert.equal(iteratorSampleCount(singleton, loop, loops), 1);
assert.equal(previewMapping({ mapping: symbolic }, indexTree(singleton), loops).value, 'one');
assert.equal(iteratorTree(singleton, loops)[0].children[0].accessor, symbolic);
// JSON arrays retain their collection node and expose the chosen item only.
const jsonLoop = { ...loop, target: "msg['items']", prefixSubstitutions: ["msg['items']"] };
const jsonTree = [{ label: 'items', accessor: "msg['items']", value: null, children: [0, 1].map(n => ({
    label: `[${n}]`, accessor: `msg['items'][${n}]`, value: String(n), children: []
})) }];
assert.equal(iteratorSampleCount(jsonTree, jsonLoop, [jsonLoop]), 2);
assert.equal(iteratorTree(jsonTree, [jsonLoop], { iteratorIndices: { i: 1 } })[0].children[0].accessor, "msg['items'][i]");
assert.equal(previewMapping({ mapping: "msg['items'][i]" }, indexTree(jsonTree), [jsonLoop], { iteratorIndices: { i: 1 } }).value, '1');
// Nested contexts preserve the outer index while substituting the inner one.
const inner = { name: 'Children', target: "msg['groups'][i]['items']", indexVariable: 'j', prefixSubstitutions: ["msg['groups'][i]['items']"] };
const outer = { ...loop, target: "msg['groups']", prefixSubstitutions: ["msg['groups']"] };
assert.equal(iteratorExpression("msg['groups'][0]['items'][1]['value']", [outer, inner]), "msg['groups'][i]['items'][j]['value']");
assert.equal(iteratorExpression("msg['groups'][i]['items'][j]['value']", [outer, inner], true), "msg['groups']['items']['value']");
const step = { __type: MSGBUILDER_TYPE, mapping: source, messageSegment: "tmp['OBX'][0]['OBX.5']", defaultValue: "'N/A'", replacements: toReplacements([["'a'", "''"]]) };
const wireBefore = JSON.stringify(step.replacements);
// Settings edits leave a fixed index alone; entering an iterator converts it.
const fixed = { __type: MSGBUILDER_TYPE, mapping: "msg['OBX'][0]['OBX.5'].toString()", messageSegment: "tmp['OBX'][0]['OBX.5']", defaultValue: '', replacements: '' };
const member = { id: 7, name: 'For each', target: "msg['OBX']", indexVariable: 'i', prefixSubstitutions: ["msg['OBX']", "tmp['OBX']"] };
rebindIteratorStep(fixed, [member], [{ ...member, indexVariable: 'k' }]);
assert.equal(fixed.mapping, "msg['OBX'][0]['OBX.5'].toString()");
rebindIteratorStep(fixed, [], [member]);
assert.equal(fixed.mapping, "msg['OBX'][i]['OBX.5'].toString()");
assert.equal(rebindIteratorStep(step, [], loops), false);
assert.equal(step.mapping, symbolic);
assert.equal(step.messageSegment, "tmp['OBX'][i]['OBX.5']");
assert.equal(JSON.stringify(step.replacements), wireBefore);
rebindIteratorStep(step, loops, []);
assert.equal(step.mapping, "msg['OBX']['OBX.5']['OBX.5.1'].toString()");
const custom = { ...step, mapping: "msg['OBX'][i] + '-suffix'" };
assert.equal(rebindIteratorStep(custom, loops, []), true);
assert.equal(custom.mapping, "msg['OBX'][i] + '-suffix'");
for (const mapping of ["msg['OBX'][ i + 1 ].toString()", "msg['PID'][i]['PID.3'].toString()"] ) {
    const manual = { ...step, mapping };
    assert.equal(rebindIteratorStep(manual, loops, [{ ...loop, indexVariable: 'k' }]), true);
    assert.equal(manual.mapping, mapping);
}
const stillInScope = { ...step, mapping: "msg['PID'][i]['PID.3'].toString()" };
assert.equal(rebindIteratorStep(stillInScope, loops, [{ ...loop, prefixSubstitutions: [] }]), false);
console.log('iterator mapping tests passed');
// Unindexed repeated XML paths aggregate at runtime; they are not missing fields.
assert.equal(previewMapping({ mapping: "msg['OBX']['OBX.5']['OBX.5.1'].toString()", defaultValue: "'missing'" }, repeatedIndex).status, 'runtime');
const nestedParent = { __type: 'com.mirth.connect.model.IteratorStep', properties: {
    target: "msg['groups'][i]['items']", prefixSubstitutions: { string: "msg['groups'][i]['items']" }
} };
const renamedOuter = { ...outer, indexVariable: 'k' };
rebindIteratorStep(nestedParent, [outer], [renamedOuter]);
assert.equal(nestedParent.properties.target, "msg['groups'][k]['items']");
assert.deepEqual(nestedParent.properties.prefixSubstitutions, { string: ["msg['groups'][k]['items']"] });
