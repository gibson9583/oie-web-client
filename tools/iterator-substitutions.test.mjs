import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { elementsToArray } from '../web-administrator/client/core/oie.js';

const entry = new URL('../web-administrator/client/react/views/iterator-substitutions.ts', import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, platform: 'node', format: 'esm' });
const { serializeEditorElements, rewriteElementIteratorVariables, relocateElementIteratorVariables, rewriteIteratorExpression,
    treeWritePath, renameIteratorIndex, isIteratorIndexName, iteratorWizardPrefixes, preferredIterator, validIteratorIndex } =
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

const prefix = "msg['OBX']";
const path = prefix + "[0]['OBX.5'][1].toString()";
const mapped = prefix + "[i]['OBX.5'][1].toString()";
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
        assert.equal(el[key], prefix + "['OBX.5'][1].toString()");
    }
});

test('assignment replaces the direct index only and preserves the source of every later selector', () => {
    for (const [source, expected] of [
        [path, mapped],
        [prefix + "[0]['value'].trim()", prefix + "[i]['value'].trim()"],
        [prefix + '[0][fields[n]]', prefix + '[i][fields[n]]'],
        [prefix + '[1][`value`].toString()', prefix + '[i][`value`].toString()'],
        [prefix + "[0][new QName('urn:example', 'id')]", prefix + "[i][new QName('urn:example', 'id')]"],
        [prefix + '[0].*::[fields[0]][1]', prefix + '[i].*::[fields[0]][1]'],
        [prefix + '[1].value.toString().length', prefix + '[i].value.toString().length'],
        [prefix + '[1][2]', prefix + '[i][2]'],
        ["msg['constant'][1].toString()", "msg['constant'][1].toString()"]
    ]) assert.equal(rewriteIteratorExpression(source, [iterator], true), expected);
    const dot = { properties: { indexVariable: 'i', prefixSubstitutions: ['msg.rows'] } };
    for (const source of ['msg.rowsExtra[0].value', 'msg.rows().value', 'msg.rows[0][']) {
        assert.equal(rewriteIteratorExpression(source, [dot], true), source);
    }
});

test('a nested move rewrites the Iterator target, substitution prefixes and descendants in order', () => {
    const innerPrefix = prefix + "['OBX.5']";
    const inner = { __type: iterator.__type, properties: { target: innerPrefix, indexVariable: 'j', prefixSubstitutions: { string: innerPrefix } },
        __children: [{ __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: innerPrefix + '[j][1].toString()' }] };
    rewriteElementIteratorVariables(inner, [iterator], true);
    const nestedPrefix = prefix + "[i]['OBX.5']";
    assert.equal(inner.properties.target, nestedPrefix);
    assert.equal(inner.properties.prefixSubstitutions.string, nestedPrefix);
    assert.equal(inner.__children[0].mapping, nestedPrefix + '[j][1].toString()');
    rewriteElementIteratorVariables(inner, [iterator], false);
    assert.equal(inner.properties.target, innerPrefix);
    assert.equal(inner.__children[0].mapping, innerPrefix + '[j][1].toString()');
    const wizard = iteratorWizardPrefixes(nestedPrefix + '[0].toString()', ['i']);
    assert.equal(wizard.selected.value, nestedPrefix);
    assert.ok(!wizard.choices.some(choice => choice.value === prefix));
    assert.equal(validIteratorIndex(['i'], ['j']), 'k');
});

test('reassigning an indexed child preserves the fixed index behind its old iterator index', () => {
    const destination = { ...iterator, properties: { ...iterator.properties, indexVariable: 'j' } };
    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: prefix + '[i][1].toString()' };
    relocateElementIteratorVariables(child, [iterator], [destination]);
    assert.equal(child.mapping, prefix + '[j][1].toString()');
    relocateElementIteratorVariables(child, [destination], [destination]);
    assert.equal(child.mapping, prefix + '[j][1].toString()');
});

test('the wizard retains fixed selectors and treats a call receiver and arguments as a single target', () => {
    for (const [source, selected] of [
        ['msg.rows()[0][fields[n]]', 'msg.rows()'],
        ['msg.rows[1].group[2].value', 'msg.rows']
    ]) {
        const wizard = iteratorWizardPrefixes(source, []);
        assert.equal(wizard.selected.value, selected);
        assert.equal(wizard.choices.at(-1).value, source);
    }
});

test('canonical wildcard Mapper reads round-trip across nested and sibling Iterator scopes', () => {
    const groups = "msg.*::['group']";
    const values = ".*::['value']";
    const outer = { ...iterator, properties: { indexVariable: 'i', prefixSubstitutions: [groups] } };
    const inner = { ...iterator, properties: { indexVariable: 'j', prefixSubstitutions: [groups + '[i]' + values] } };
    outer.__children = [inner];
    for (const suffix of ['.toString()', ".@*::['code'].toString()", ".namespace('v').toString()"]) {
        const mapping = groups + '[2]' + values + '[1]' + suffix;
        const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping };
        assert.equal(preferredIterator(mapping, [outer]), inner);
        relocateElementIteratorVariables(child, [], [outer, inner]);
        assert.equal(child.mapping, groups + '[i]' + values + '[j]' + suffix);
        inner.__children = [child];
        assert.equal(renameIteratorIndex(outer, 'n'), true);
        assert.equal(child.mapping, groups + '[n]' + values + '[j]' + suffix);
        const sibling = { ...inner, properties: { ...inner.properties, indexVariable: 'k' } };
        relocateElementIteratorVariables(child, [outer, inner], [outer, sibling]);
        assert.equal(child.mapping, groups + '[n]' + values + '[k]' + suffix);
        relocateElementIteratorVariables(child, [outer, sibling], []);
        assert.equal(child.mapping, groups + values + suffix);
        assert.equal(renameIteratorIndex(outer, 'i'), true);
    }
});

test('a tree write under a qualified parent only picks up its configured row index', () => {
    const groups = "msg.*::['group']";
    const path = groups + "[1]['value']";
    const loop = prefix => ({ properties: { indexVariable: 'i', prefixSubstitutions: [prefix] } });
    assert.equal(treeWritePath(path, [loop(groups)]), groups + "[i]['value']");
    for (const prefix of ["msg[new QName('urn:v', 'group')]", "msg.v::group", "msg.v::['group']", "msg['group']",
        "msg [ new QName ( 'urn:v', 'group' ) ]", "msg . v :: group", "msg . v :: [ 'group' ]"]) {
        assert.equal(treeWritePath(path, [loop(prefix)]), null);
        const audit = "msg.*::['audit'][1]['status']";
        assert.equal(treeWritePath(audit, [loop(prefix)]), audit);
    }
    for (const prefix of ["tmp[new QName('urn:v', 'group')]", "msg['QName']", "msg['other'].v::group", "msg[key]", "msg.v::[key]"]) {
        assert.equal(treeWritePath(path, [loop(prefix)]), path);
    }
    const single = groups + "['value']";
    assert.equal(treeWritePath(single, [loop("msg.v::group")]), single);
});

test('assigning an authored QName read or write only rewrites a configured literal prefix', () => {
    const wildcard = "msg.*::['group']";
    const exact = "msg[new QName('urn:v', 'group')]";
    const loop = { ...iterator, properties: { indexVariable: 'i', prefixSubstitutions: [wildcard] } };
    const child = { __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
        mapping: exact + '[1].toString()', messageSegment: exact + '[1]' };
    const before = structuredClone(child);
    relocateElementIteratorVariables(child, [], [loop]);
    assert.deepEqual(child, before);
    assert.equal(preferredIterator(child.mapping, [loop]), null);
    loop.properties.prefixSubstitutions = [exact];
    relocateElementIteratorVariables(child, [], [loop]);
    assert.equal(child.mapping, exact + '[i].toString()');
    assert.equal(child.messageSegment, exact + '[i]');
});

test('iterator names exclude reserved words in the stock Rhino ES6 mode', () => {
    for (const index of ['await', 'class', 'enum', 'export', 'extends', 'import', 'let', 'super', 'yield', 'ex\u200dport', 'map\u200cping'])
        assert.equal(isIteratorIndexName(index), false, index);
    for (const index of ['i', 'static', 'implements']) assert.equal(isIteratorIndexName(index), true, index);
});

test('a filter Iterator index cannot shadow its generated result flag after a move', () => {
    const rule = { ...iterator, __type: 'com.mirth.connect.model.IteratorRule', properties: { ...iterator.properties } };
    for (const index of ['_iterator_flag_0', '_iterator_flag_1']) {
        assert.equal(renameIteratorIndex(rule, index), false);
        assert.equal(rule.properties.indexVariable, 'i');
    }
});

test('renaming an outer index updates nested iterator paths and structured fields', () => {
    const nested = prefix + "[i]['OBX.5']";
    const outer = { ...iterator, properties: { ...iterator.properties },
        __children: [{ ...iterator, properties: { indexVariable: 'j', target: nested, prefixSubstitutions: { string: nested } },
            __children: [{ __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: nested + '[j][1]', defaultValue: "'i'" }] }] };
    assert.equal(renameIteratorIndex(outer, 'k'), true);
    const inner = outer.__children[0];
    assert.equal(outer.properties.indexVariable, 'k');
    assert.deepEqual(inner.properties, { indexVariable: 'j', target: prefix + "[k]['OBX.5']", prefixSubstitutions: { string: prefix + "[k]['OBX.5']" } });
    assert.equal(inner.__children[0].mapping, prefix + "[k]['OBX.5'][j][1]");
    assert.equal(inner.__children[0].defaultValue, "'i'");
});

test('an Iterator without prefix substitutions can rename a child reference to its target', () => {
    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: prefix + '[i].value.toString()' };
    const parent = { ...iterator, properties: { target: prefix, indexVariable: 'i' }, __children: [child] };
    assert.equal(renameIteratorIndex(parent, 'j'), true);
    assert.equal(child.mapping, prefix + '[j].value.toString()');
});

test('rename refuses nested generated variables even when a step or its Iterator is disabled', () => {
    for (const [plugin, fields, indices] of [
        ['mapper.MapperStep', { variable: 'patient-id', mapping: prefix + '[i].value.toString()' }, ['mapping', '_patientid']],
        ['xsltstep.XsltStep', { resultVariable: 'xml-output', sourceXml: prefix + '[i]' }, ['sourceVar', '_xmloutput']]
    ]) {
        for (const [nestedEnabled, childEnabled] of [[true, true], [true, false], [false, true], ['false', 'false']]) {
            const child = { __type: 'com.mirth.connect.plugins.' + plugin, enabled: childEnabled, ...fields };
            const nested = { ...iterator, enabled: nestedEnabled,
                properties: { indexVariable: 'j', target: prefix + '[i].items' }, __children: [child] };
            const parent = { ...iterator, properties: { ...iterator.properties }, __children: [nested] };
            const original = structuredClone(parent);
            for (const index of indices) {
                assert.equal(renameIteratorIndex(parent, index), false, `${index}, Iterator ${nestedEnabled}, step ${childEnabled}`);
                assert.deepEqual(parent, original);
            }
            assert.equal(renameIteratorIndex(parent, 'e'), true);
            assert.equal(parent.properties.indexVariable, 'e');
            assert.equal(renameIteratorIndex(parent, 'i'), true);
            assert.deepEqual(parent, original);
        }
    }
});

test('rename refuses unresolved or captured index references without changing children', () => {
    for (const [type, field, source] of [
        ['mapper.MapperStep', 'mapping', prefix + '[i][fields[i]]'],
        ['mapper.MapperStep', 'mapping', prefix + '[i][fields[j]]'],
        ['javascriptstep.JavaScriptStep', 'script', "channelMap.put('x', i);"],
        ['javascriptstep.JavaScriptStep', 'script', 'channelMap.put("x", `hello ${i}`);'],
        ['scriptfilestep.ExternalScriptStep', 'scriptPath', '/example/iterator.js']
    ]) {
        const child = { __type: 'com.mirth.connect.plugins.' + type, [field]: source };
        const parent = { ...iterator, properties: { ...iterator.properties }, __children: [child] };
        const original = structuredClone(parent);
        assert.equal(renameIteratorIndex(parent, 'j'), false);
        assert.deepEqual(parent, original);
    }
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

test('an empty or ambiguous imported prefix never matches an unrelated mapping', () => {
    const parent = { ...iterator, properties: { ...iterator.properties, prefixSubstitutions: { string: [prefix, null, ''] } } };
    const unrelated = "channelMap.get('label')";
    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: path, defaultValue: unrelated };
    rewriteElementIteratorVariables(child, [parent], true);
    assert.equal(child.mapping, mapped);
    assert.equal(child.defaultValue, unrelated);
});
