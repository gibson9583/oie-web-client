import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { elementsToArray } from '../web-administrator/client/core/oie.js';

const entry = new URL('../web-administrator/client/react/views/iterator-substitutions.ts', import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, platform: 'node', format: 'esm' });
const { serializeEditorElements, rewriteElementIteratorVariables, removeNumberLiterals, iteratorWizardPrefixes, validIteratorIndex } =
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const prefix = "msg['OBX']";
const path = prefix + "[0]['OBX.5'][1].toString()";
const mapped = prefix + "[i]['OBX.5'].toString()";
const iterator = { __type: 'com.mirth.connect.model.IteratorStep', properties: { target: prefix, indexVariable: 'i', prefixSubstitutions: { string: prefix } } };

test('assignment rewrites shipped plugin fields and leaves unrelated script and literals intact', () => {
    for (const [plugin, key] of [['mapper.MapperStep', 'mapping'], ['messagebuilder.MessageBuilderStep', 'messageSegment'],
        ['destinationsetfilter.DestinationSetFilterStep', 'field'], ['rulebuilder.RuleBuilderRule', 'field'], ['xsltstep.XsltStep', 'sourceXml']]) {
        const el = { __type: 'com.mirth.connect.plugins.' + plugin, [key]: path, values: { string: path }, defaultValue: "'[0]'", script: path };
        rewriteElementIteratorVariables(el, [iterator], true);
        assert.equal(el[key], mapped);
        assert.equal(el.values.string, key === 'field' ? mapped : path);
        assert.equal(el.defaultValue, "'[0]'");
        assert.equal(el.script, path);
        rewriteElementIteratorVariables(el, [iterator], true);
        assert.equal(el[key], mapped);
        rewriteElementIteratorVariables(el, [iterator], false);
        assert.equal(el[key], prefix + "['OBX.5'].toString()");
    }
});

test('normalization distinguishes repeated fields, computed XML names, method results and invalid drafts', () => {
    const invalid = prefix + "[0].value[0]; function key(){ 'use strict'; with (obj) {} }";
    for (const [input, expected] of [
        [path, prefix + "['OBX.5'].toString()"],
        ["msg.*::['OBX'][0].*::[fields[0]][1].toString()", "msg.*::['OBX'].*::[fields[0]].toString()"],
        ["msg['0'][1].toString()", "msg['0'].toString()"],
        [prefix + '[1].value.toString().length', prefix + '.value.toString().length'],
        ['String(' + prefix + '[0].value).length.toString()', 'String(' + prefix + '[0].value).length.toString()'],
        [invalid, invalid]
    ]) assert.equal(removeNumberLiterals(input), expected);
});

test('a nested move rewrites the Iterator target, substitution prefixes and descendants in order', () => {
    const innerPrefix = prefix + "['OBX.5']";
    const inner = { __type: iterator.__type, properties: { target: innerPrefix, indexVariable: 'j', prefixSubstitutions: { string: innerPrefix } },
        __children: [{ __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: path }] };
    rewriteElementIteratorVariables(inner, [iterator], true);
    const nestedPrefix = prefix + "[i]['OBX.5']";
    assert.equal(inner.properties.target, nestedPrefix);
    assert.equal(inner.properties.prefixSubstitutions.string, nestedPrefix);
    assert.equal(inner.__children[0].mapping, nestedPrefix + '[j].toString()');
    rewriteElementIteratorVariables(inner, [iterator], false);
    assert.equal(inner.properties.target, innerPrefix);
    assert.equal(inner.__children[0].mapping, innerPrefix + '.toString()');
    const wizard = iteratorWizardPrefixes(nestedPrefix + '[0].toString()', ['i']);
    assert.equal(wizard.selected.value, nestedPrefix);
    assert.ok(!wizard.choices.some(choice => choice.value === prefix));
    assert.equal(validIteratorIndex(['i'], ['j']), 'k');
});

test('Swing-authored children of different types retain execution order after saving an Iterator', () => {
    const types = ['com.mirth.connect.plugins.mapper.MapperStep', 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep'];
    const entry = position => ({ sequenceNumber: position });
    const children = elementsToArray({ [types[0]]: [entry('0-0'), entry('0-2')], [types[1]]: entry('0-1') });
    assert.deepEqual(children.map(child => child.__type), [types[0], types[1], types[0]]);
    const saved = serializeEditorElements([{ ...iterator, __children: children }]);
    const reloaded = elementsToArray(saved[iterator.__type][0].properties.children);
    assert.deepEqual(reloaded.map(child => [child.__type, child.sequenceNumber]), children.map(child => [child.__type, child.sequenceNumber]));
});
