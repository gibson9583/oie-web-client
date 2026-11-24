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

test('regex cleanup keeps the Swing XML sample selector through nested moves and detachment', () => {
    const model = { inboundDataType: 'HL7V2', outboundDataType: 'JSON' };
    const inner = { properties: { indexVariable: 'j', prefixSubstitutions: [prefix + "[i]['OBX.5']"] } };
    const suffix = ".toString().replace(/-/g, '')";
    const target = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: prefix + "[0]['OBX.5'][0]" + suffix };
    relocateElementIteratorVariables(target, [], [iterator, inner], model);
    assert.equal(target.mapping, prefix + "[i][0]['OBX.5'][j][0]" + suffix);
    relocateElementIteratorVariables(target, [iterator, inner], [], model);
    assert.equal(target.mapping, prefix + "[0]['OBX.5'][0]" + suffix);
    const jsonPath = "tmp['OBX']";
    const jsonLoop = { properties: { indexVariable: 'i', prefixSubstitutions: [jsonPath] } };
    assert.equal(rewriteIteratorExpression(jsonPath + '[0].value' + suffix, [jsonLoop], true, model), jsonPath + '[i].value' + suffix);
    assert.equal(rewriteIteratorExpression(jsonPath + '[i].value' + suffix, [jsonLoop], false, model), jsonPath + '[0].value' + suffix);
    const rootLoop = { properties: { indexVariable: 'i', prefixSubstitutions: ['tmp'] } };
    assert.equal(rewriteIteratorExpression('tmp[i].value' + suffix, [rootLoop], false, model), 'tmp[0].value' + suffix);
    const nestedArray = { ...target, mapping: jsonPath + '[i][0].value' + suffix };
    const other = { properties: { indexVariable: 'j', prefixSubstitutions: [jsonPath] } };
    relocateElementIteratorVariables(nestedArray, [jsonLoop], [other], model);
    assert.equal(nestedArray.mapping, jsonPath + '[j][0].value' + suffix);
    relocateElementIteratorVariables(nestedArray, [other], [], model);
    assert.equal(nestedArray.mapping, jsonPath + '[0][0].value' + suffix);
    assert.equal(rewriteIteratorExpression(prefix + '[1].value' + suffix, [iterator], true, model), prefix + '[i].value' + suffix);
});

test('regex cleanup preserves the sample under literal XML namespace selectors', () => {
    const suffix = ".toString().replace(/-/g, '')";
    const xml = { inboundDataType: 'XML' };
    const loop = (prefix, indexVariable) => ({ properties: { indexVariable, prefixSubstitutions: [prefix] } });
    const field = ".*::['value']";
    for (const prefix of ["msg.*::['row']", 'msg.v::row', "msg[new QName('urn:v', 'row')]"]) {
        const ancestors = [loop(prefix, 'i'), loop(prefix + '[i]' + field, 'j')];
        const original = prefix + '[0]' + field + '[0]' + suffix;
        const assigned = rewriteIteratorExpression(original, ancestors, true, xml);
        assert.equal(assigned, prefix + '[i][0]' + field + '[j][0]' + suffix);
        assert.equal(rewriteIteratorExpression(assigned, ancestors, false, xml), original);
    }
    // A dynamic namespace field or a computed function result can have a different shape.
    for (const custom of ["msg.*::[field]", "msg.rows()"]) {
        const source = custom + '[0]' + suffix;
        assert.equal(rewriteIteratorExpression(source, [loop(custom, 'i')], true, xml), custom + '[i]' + suffix);
    }
    const prefix = "msg.*::['row']";
    assert.equal(rewriteIteratorExpression(prefix + '[0]' + suffix, [loop(prefix, 'i')], true,
        { inboundDataType: 'JSON' }), prefix + '[i]' + suffix);
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

test('assigning and detaching an HL7 Mapper preserves its sample and fallback operand', () => {
    const model = { inboundDataType: 'HL7V2' };
    const childPrefix = prefix + "[i][0]['OBX.5']";
    const inner = { properties: { indexVariable: 'j', prefixSubstitutions: [childPrefix] } };
    for (const rhs of ["'unknown'", prefix + "[0]['default']", "'n/a' || defaults[1]", '-1', '0.5', '1e3', '(-0xF)']) {
        const tail = ".toString() || " + rhs;
        const original = prefix + "[0]['OBX.5'][0]" + tail;
        const target = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: original };
        assert.equal(preferredIterator(original, [iterator], undefined, model), iterator);
        relocateElementIteratorVariables(target, [], [iterator, inner], model);
        assert.equal(target.mapping, childPrefix + '[j][0]' + tail);
        relocateElementIteratorVariables(target, [iterator, inner], [iterator], model);
        assert.equal(target.mapping, childPrefix + '[0]' + tail);
        relocateElementIteratorVariables(target, [iterator], [], model);
        assert.equal(target.mapping, original);
    }
    for (const expression of [prefix + '[0].value || ', "other.value || " + prefix + '[0]']) {
        assert.equal(rewriteIteratorExpression(expression, [iterator], true, model), expression);
    }
    // Swing also keeps a nonzero sample after [i], even though an individual
    // E4X node only has a value at [0]. Removing the loop restores the source.
    const otherRow = prefix + "[1]['OBX.5'][2].toString() || 'unknown'";
    const assigned = rewriteIteratorExpression(otherRow, [iterator], true, model);
    assert.equal(assigned, prefix + "[i][1]['OBX.5'][2].toString() || 'unknown'");
    assert.equal(rewriteIteratorExpression(assigned, [iterator], false, model), otherRow);
    const json = prefix + "[0].value || 'missing'";
    assert.equal(rewriteIteratorExpression(json, [iterator], true, { inboundDataType: 'JSON' }), json);
});

test('new indices reserve authored selectors while allowing property names and independent loop bindings', () => {
    const mapper = mapping => ({ __type: 'com.mirth.connect.plugins.mapper.MapperStep', variable: 'value', mapping });
    const sibling = { ...iterator, __children: [mapper(prefix + '[i]')] };
    assert.equal(validIteratorIndex([], [], [sibling, mapper("msg['i'].j[k]")]), 'i');
    assert.equal(validIteratorIndex([], [], [mapper('msg[i][j]')]), 'k');
    assert.equal(validIteratorIndex([], [], [mapper('msg[`column-${i}`]')]), 'j');
    assert.equal(validIteratorIndex([], [], [mapper('msg[\\u0069]')]), 'j');
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
    const nested = "msg['env'].*::['group'][0]['value']";
    for (const env of ['.env', '["env"]', "['env']"]) {
        assert.equal(treeWritePath(nested, [loop('msg' + env + '.v::group')]), null);
    }
    for (const prefix of ['tmp.env.v::group', 'msg.other.v::group', 'msg.v::env.v::group',
        'msg..env.v::group', 'msg.@env.v::group', 'msg.env.v::other']) {
        assert.equal(treeWritePath(nested, [loop(prefix)]), nested);
    }
    const single = groups + "['value']";
    assert.equal(treeWritePath(single, [loop("msg.v::group")]), null);
    assert.equal(treeWritePath(single, [{ properties: { target: "msg.v::group" } }]), null);
    assert.equal(treeWritePath(single, [loop(groups)]), groups + "[i]['value']");
    assert.equal(treeWritePath(single, [loop("msg.v::audit")]), single);
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

test('a field below an XML sample row retains its fixed descendant selectors', () => {
    const target = prefix + "['OBX.5']";
    const source = prefix + "[0]['OBX.5']['OBX.5.1'][1].toString()";
    const loop = { ...iterator, properties: { target, indexVariable: 'i', prefixSubstitutions: [target] } };
    const transformer = { inboundDataType: 'HL7V2' };
    const wizard = iteratorWizardPrefixes(source, [], 'target', transformer);
    assert.ok(wizard.choices.some(choice => choice.value === target));
    assert.equal(preferredIterator(source, [loop], undefined, transformer), loop);
    const field = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: source };
    relocateElementIteratorVariables(field, [], [loop], transformer);
    assert.equal(field.mapping, target + "[i]['OBX.5.1'][1].toString()");
    relocateElementIteratorVariables(field, [loop], [], transformer);
    assert.equal(field.mapping, target + "['OBX.5.1'][1].toString()");
    assert.equal(rewriteIteratorExpression(source, [loop], true, { inboundDataType: 'JSON' }), source);
});

test('signed call arguments keep the XML sample and select the JSON record directly', () => {
    const tail = "['OBX.5'].toString().slice(-2)";
    const original = prefix + '[0]' + tail;
    for (const [type, binding] of [['HL7V2', '[i][0]'], ['JSON', '[i]']]) {
        const model = { inboundDataType: type };
        const assigned = rewriteIteratorExpression(original, [iterator], true, model);
        assert.equal(assigned, prefix + binding + tail);
        assert.equal(rewriteIteratorExpression(assigned, [iterator], false, model), original);
    }
});

test('a signed suffix resolves a nested XML Iterator across the preceding sample selector', () => {
    const group = "msg.*::['group']";
    const field = ".*::['value']";
    const makeLoop = (prefix, indexVariable) => ({ properties: { prefixSubstitutions: [prefix], indexVariable } });
    const loops = [makeLoop(group, 'i'), makeLoop(group + '[i]' + field, 'j')];
    const xml = { inboundDataType: 'XML' };
    for (const argument of ['-2', '-2.0', '-2e0', '-.5', '+ 0x2']) {
        const tail = '.toString().slice(' + argument + ')';
        const source = group + '[0]' + field + '[0]' + tail;
        const bound = rewriteIteratorExpression(source, loops, true, xml);
        assert.equal(bound, group + '[i][0]' + field + '[j][0]' + tail);
        assert.equal(rewriteIteratorExpression(bound, loops, false, xml), source);
    }
});

test('the new Iterator chooser offers a complete fallback and detachment restores its source', () => {
    const original = prefix + "[0]['OBX.5'].toString() || 'unknown'";
    const wizard = iteratorWizardPrefixes(original, []);
    assert.deepEqual(wizard.choices.map(choice => choice.value), [original]);
    const loop = { properties: { indexVariable: 'i', prefixSubstitutions: [wizard.selected.value] } };
    const assigned = rewriteIteratorExpression(original, [loop], true);
    assert.equal(assigned, original + '[i]');
    assert.equal(rewriteIteratorExpression(assigned, [loop], false), original);
    assert.deepEqual(iteratorWizardPrefixes(prefix + "[0].value || ", []).choices, []);
});

test('explicitly dependent prefixes apply in configured order and an extra pass leaves them bound', () => {
    const target = prefix + "[i]['OBX.5']";
    const loop = { properties: { indexVariable: 'i', prefixSubstitutions: [prefix, target] } };
    const source = prefix + "[0]['OBX.5'][0]";
    const assigned = rewriteIteratorExpression(source, [loop], true);
    assert.equal(assigned, target + '[i]');
    assert.equal(rewriteIteratorExpression(assigned, [loop], true), assigned);
    assert.equal(rewriteIteratorExpression(assigned, [loop], false), prefix + "['OBX.5'][i]");
});

test('dependent and independent substitution branches retain their own assignment, removal and rename order', () => {
    const primary = 'msg.groups';
    const nested = primary + '[i].field';
    const independent = 'tmp.item';
    const loop = { ...iterator, properties: { target: primary, indexVariable: 'i',
        prefixSubstitutions: { string: [primary, nested, 'tmp', independent] } } };
    const mapper = mapping => ({ __type: 'com.mirth.connect.plugins.mapper.MapperStep', variable: 'result', mapping });
    const first = mapper(primary + '[0].field[0]');
    const second = mapper(independent + '[0].field[1]');
    for (const child of [first, second]) relocateElementIteratorVariables(child, [], [loop]);
    assert.equal(first.mapping, nested + '[i]');
    assert.equal(second.mapping, independent + '[i].field[1]');
    assert.equal(rewriteIteratorExpression(second.mapping, [loop], false), independent + '.field[1]');
    loop.__children = [first, second];
    assert.equal(renameIteratorIndex(loop, 'j'), true);
    assert.deepEqual(loop.properties.prefixSubstitutions.string, [primary, primary + '[j].field', 'tmp', independent]);
    assert.equal(first.mapping, primary + '[j].field[j]');
    assert.equal(second.mapping, independent + '[j].field[1]');
    assert.equal(rewriteIteratorExpression(primary + '[0].field[0]', [loop], true), first.mapping);
    assert.equal(rewriteIteratorExpression(second.mapping, [loop], false), independent + '.field[1]');
});

test('an unrelated fixed target survives assignment even if it contains a QName constructor', () => {
    const loop = { ...iterator, properties: { ...iterator.properties, prefixSubstitutions: ["msg.*::['OBX']"] } };
    const qualified = "msg[new QName('urn:test', 'OBX')][1][new QName('urn:test', 'value')]";
    for (const write of [qualified, "tmp['audit'][1]['value']"]) {
        const field = { __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep', messageSegment: write, mapping: "'new'" };
        relocateElementIteratorVariables(field, [], [loop], { inboundDataType: 'XML', outboundDataType: 'XML' });
        assert.equal(field.messageSegment, write);
    }
});

test('iterator names exclude reserved words in the stock Rhino ES6 mode', () => {
    for (const index of ['await', 'class', 'enum', 'export', 'extends', 'import', 'let', 'super', 'yield', 'ex\u200dport', 'map\u200cping'])
        assert.equal(isIteratorIndexName(index), false, index);
    for (const index of ['i', 'static', 'implements']) assert.equal(isIteratorIndexName(index), true, index);
});

test('rename keeps sibling bindings and permits reuse in independent loops', () => {
    const child = { __type: 'com.mirth.connect.plugins.mapper.MapperStep', mapping: mapped };
    const loop = { ...iterator, properties: { ...iterator.properties }, __children: [child] };
    const js = script => ({ __type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', script });
    const independent = { ...iterator, properties: { ...iterator.properties, indexVariable: 'j' },
        __children: [js("channelMap.put('last', j)")] };
    for (const sibling of [js("channelMap.put('length', i)"), { ...child, mapping: 'columns[j]' },
        { __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', scriptPath: '/channel/sibling.js' }]) {
        assert.equal(renameIteratorIndex(loop, 'j', [loop, sibling]), false);
        assert.equal(loop.properties.indexVariable, 'i');
        assert.equal(child.mapping, mapped);
    }
    assert.equal(renameIteratorIndex(loop, 'j', [loop, independent]), true);
    assert.equal(child.mapping, mapped.replace('[i]', '[j]'));
});

test('an empty Iterator can release an earlier JavaScript variable after conversion or reload', () => {
    const js = script => ({ __type: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep', script });
    const createLoop = () => ({ ...iterator, properties: { ...iterator.properties }, __children: [] });
    const loop = createLoop();
    const initializer = js('var i = 7;');
    const consumer = js("channelMap.put('after', i);");
    const scope = [initializer, loop, consumer];
    assert.equal(renameIteratorIndex(loop, 'j', scope), true);
    assert.equal(initializer.script, 'var i = 7;');
    assert.equal(consumer.script, "channelMap.put('after', i);");
    assert.equal(renameIteratorIndex(loop, 'i', scope), false);

    for (const source of [
        '// Write your JavaScript here\nvar i = 7;',
        "var label = 'id'; var i = 7;",
        'var label = "column", i = 7;',
        'var label, columns = [0, 1], /* selected */ i = 7;',
        'var column = pick(0, 1),\n i = 7;',
        "var label = 'id'\n/* column */ var /* binding */ i\n= 7;",
        'if (ready) { var label = "id"; }\nvar i=7;'
    ]) {
        const saved = createLoop();
        assert.equal(renameIteratorIndex(saved, 'j', [js(source), saved, consumer]), true, source);
    }
    for (const before of [
        [], [js('var label = "column"; if (ready) var other=0, i=7;')],
        [js('var label = "column"\nchoose(), i=7;')], [js('var choices = [0, i=7];')],
        [js('if (ready) { var i = 7; }')], [js('function choose() { var i = 7; }')],
        [js('if (ready) var i=7;')], [js('if (ready) pick(); else var i=7;')],
        [js('do var i=7; while (ready);')], [js('for (var i=7; ready;) break;')],
        [js("var label='id'; if (ready) { var i=7; }")], [js('var fn = () => { var i=7; };')],
        [js('"var i = 7;"')], [js('// var i = 7;')], [js('var i;')],
        [{ ...initializer, enabled: 'false' }], [{ ...createLoop(), __children: [initializer] }]
    ]) {
        const saved = createLoop();
        assert.equal(renameIteratorIndex(saved, 'j', [...before, saved, consumer, initializer]), false);
        assert.equal(saved.properties.indexVariable, 'i');
    }
    for (const sibling of [js('var j = 8;'), { __type: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep', scriptPath: '/channel.js' }]) {
        const saved = createLoop();
        assert.equal(renameIteratorIndex(saved, 'j', [initializer, saved, sibling]), false);
    }
    const populated = { ...createLoop(), __children: [js("channelMap.put('record', msg);")] };
    assert.equal(renameIteratorIndex(populated, 'j', [initializer, populated, consumer]), false);
    const nested = createLoop();
    const parent = { ...createLoop(), properties: { ...iterator.properties, indexVariable: 'k' }, __children: [initializer, nested] };
    assert.equal(renameIteratorIndex(nested, 'j', [parent, consumer]), true);
    const ordinary = createLoop();
    assert.equal(renameIteratorIndex(ordinary, 'j', [ordinary]), true);
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
        ['xsltstep.XsltStep', 'template', 'styles[i]'],
        ['xsltstep.XsltStep', 'template', 'styles[j]'],
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
