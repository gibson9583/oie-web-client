import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { elementsToArray } from '../web-administrator/client/core/oie.js';

const entry = new URL('../web-administrator/client/react/views/iterator-substitutions.ts', import.meta.url);
const bundle = await build({ entryPoints: [fileURLToPath(entry)], bundle: true, write: false, platform: 'node', format: 'esm' });
const { serializeEditorElements, rewriteElementIteratorVariables, relocateElementIteratorVariables, rewriteIteratorExpression,
    rewriteTreeIteratorExpression, renameIteratorIndex, isIteratorIndexName, iteratorWizardPrefixes, preferredIterator, validIteratorIndex } =
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

test('an unambiguous legacy wildcard ancestor can bind a qualified tree field', () => {
    const exact = "msg[new QName('urn:a', 'OBX')]";
    const wildcard = "msg.*::['OBX']";
    const descendant = "[new QName('urn:a', 'value')].toString()";
    const loop = { properties: { indexVariable: 'i', prefixSubstitutions: [wildcard] } };
    const source = exact + '[1]' + descendant;
    const suffix = "[new QName('urn:a', 'OBX')]" + descendant;
    const bound = rewriteTreeIteratorExpression(source, wildcard + "[1].*::['value'].toString()", [loop]);
    assert.equal(bound, `(<r>{${wildcard}[i]}</r>)${suffix}`);
    assert.equal(rewriteIteratorExpression(bound, [loop], false), `(<r>{${wildcard}}</r>)${suffix}`);
    assert.equal(rewriteTreeIteratorExpression(source, exact + "[1].*::['value'].toString()", [loop]), source);
});

test('an Iterator over a legacy wildcard leaf reads the selected namespace at each index', () => {
    const wildcard = "msg.*::['value']";
    const selector = "[new QName('urn:a', 'value')]";
    const iterator = { __type: 'com.mirth.connect.model.IteratorStep',
        properties: { target: wildcard, indexVariable: 'i', prefixSubstitutions: [wildcard] } };
    const expression = index => `(<r>{${wildcard}${index}}</r>)${selector}.toString()`;
    const mapping = rewriteTreeIteratorExpression(`msg${selector}[1].toString()`, wildcard + '[1].toString()', [iterator]);
    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping };
    assert.equal(mapping, expression('[i]'));
    assert.equal(renameIteratorIndex({ ...iterator, __children: [child] }, 'j'), true);
    assert.equal(child.mapping, expression('[j]'));
    assert.equal(rewriteIteratorExpression(child.mapping, [iterator], false), expression(''));
});

test('nested wildcard bindings check the selected leaf and every widened ancestor', () => {
    const groups = "msg.*::['group']";
    const branches = ".*::['branch']";
    const values = ".*::['value']";
    const group = "[new QName('urn:groups', 'group')]";
    const branch = "[new QName('urn:branches', 'branch')]";
    const value = "[new QName('urn:leaves', 'value')]";
    const outer = { ...iterator, properties: { indexVariable: 'i', prefixSubstitutions: [groups] } };
    const innerPrefix = groups + '[i]' + branches + values;
    const inner = { ...iterator, properties: { indexVariable: 'j', prefixSubstitutions: [innerPrefix] } };
    outer.__children = [inner];
    const exact = 'msg' + group + '[0]' + branch + value + '[1].toString()';
    const legacy = groups + '[0]' + branches + values + '[1].toString()';
    const mapping = rewriteTreeIteratorExpression(exact, legacy, [outer, inner]);
    assert.match(mapping, /\[i\]\.\*::\['branch'\]\.\*::\['value'\]\[j\]/);
    assert.ok(mapping.includes("row.parent().name() == new QName('urn:branches', 'branch')"));
    assert.ok(mapping.includes("row.parent().parent().name() == new QName('urn:groups', 'group')"));
    assert.ok(mapping.endsWith(`</r>)${value}.toString()`));
    assert.equal(preferredIterator(exact, [outer], undefined, true), inner);

    const outerMapping = rewriteTreeIteratorExpression(exact, legacy, [outer]);
    const moved = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: outerMapping };
    relocateElementIteratorVariables(moved, [outer], [outer, inner]);
    assert.equal(moved.mapping, mapping);
    const qualifiedPrefix = 'msg' + group + '[i]' + branch + value;
    const qualifiedLoop = { ...inner, properties: { ...inner.properties, prefixSubstitutions: [qualifiedPrefix] } };
    const movedToQualified = { ...moved, mapping: outerMapping };
    relocateElementIteratorVariables(movedToQualified, [outer], [outer, qualifiedLoop]);
    assert.equal(movedToQualified.mapping, qualifiedPrefix + '[j].toString()');

    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping };
    inner.__children = [child];
    assert.equal(renameIteratorIndex(outer, 'k'), true);
    assert.equal(child.mapping, mapping.replace('[i]', '[k]'));
    const destination = { ...inner, properties: { ...inner.properties, indexVariable: 'n' } };
    relocateElementIteratorVariables(child, [outer, inner], [outer, destination]);
    assert.equal(child.mapping, mapping.replace('[i]', '[k]').replace('[j]', '[n]'));
    relocateElementIteratorVariables(child, [outer, destination], []);
    assert.equal(child.mapping, mapping.replace('[i]', '').replace('[j]', ''));

    const newPrefix = groups + '[k]' + branches;
    const newScope = { ...inner, properties: { indexVariable: 'l', prefixSubstitutions: [newPrefix] } };
    const movedToBranch = { ...child, mapping: mapping.replace('[i]', '[k]') };
    relocateElementIteratorVariables(movedToBranch, [outer, inner], [outer, newScope]);
    assert.ok(movedToBranch.mapping.includes(newPrefix + '[l]'));
    assert.ok(movedToBranch.mapping.includes("row.parent().name() == new QName('urn:groups', 'group')"));
    assert.ok(movedToBranch.mapping.endsWith(`</r>)${branch}${value}.toString()`));
});

test('a nested wildcard binding retains a fixed ancestor index within its exact namespace', () => {
    const exact = "msg[new QName('urn:v', 'group')][1][new QName('urn:v', 'value')][1].toString()";
    const wildcard = "msg.*::['group'][1].*::['value']";
    const loop = { properties: { indexVariable: 'i', prefixSubstitutions: [wildcard] } };
    const mapping = rewriteTreeIteratorExpression(exact, undefined, [loop]);
    assert.ok(mapping.includes(wildcard + '[i]'));
    assert.ok(mapping.includes("row.parent().parent()[new QName('urn:v', 'group')][1].childIndex() === row.parent().childIndex()"));
});

test('renaming a guarded Mapper Iterator protects its XML and QName references', () => {
    const wildcard = "msg.*::['group'].*::['value']";
    const loop = { ...iterator, properties: { ...iterator.properties, prefixSubstitutions: [wildcard] } };
    const mapping = rewriteTreeIteratorExpression("msg[new QName('urn:v', 'group')]['value'][1].toString()", undefined, [loop]);
    loop.__children = [{ __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping }];
    for (const name of ['XML', 'QName']) {
        assert.equal(renameIteratorIndex(loop, name), false, name);
        assert.equal(loop.__children[0].mapping, mapping);
    }
    assert.equal(renameIteratorIndex(loop, 'XMLList'), true);
    assert.equal(loop.__children[0].mapping, mapping.replace('[i]', '[XMLList]'));
});

test('saved canonical Mapper reads bind without transient tree metadata', () => {
    const wildcard = "msg.*::['group']";
    const loop = { ...iterator, properties: { indexVariable: 'i', prefixSubstitutions: [wildcard] } };
    for (const selector of ["[new QName('urn:v', 'group')]", "['group']"]) {
        for (const suffix of ['.toString()', ".@[new QName('urn:v', 'code')].toString()"]) {
            const mapping = 'msg' + selector + '[1]' + suffix;
            const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping, defaultValue: mapping };
            relocateElementIteratorVariables(child, [], [loop]);
            assert.equal(child.mapping, `(<r>{${wildcard}[i]}</r>)${selector}${suffix}`);
            assert.equal(child.defaultValue, mapping);
        }
    }
    const computed = "msg[new QName('urn:v', 'group')][1][fields[n]].toString()";
    for (const child of [
        { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: computed },
        { __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', mapping: "msg['group'][1].toString()", messageSegment: "msg['group'][1]" }
    ]) {
        const original = structuredClone(child);
        relocateElementIteratorVariables(child, [], [loop]);
        assert.deepEqual(child, original);
    }
});

test('iterator names exclude reserved words in the stock Rhino ES6 mode', () => {
    for (const index of ['await', 'class', 'enum', 'export', 'extends', 'import', 'let', 'super', 'yield', 'ex\u200dport', 'map\u200cping'])
        assert.equal(isIteratorIndexName(index), false, index);
    for (const index of ['i', 'static', 'implements']) assert.equal(isIteratorIndexName(index), true, index);
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
