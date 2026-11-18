import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    getIteratorInfo, iteratorExpressionParts, normalizeIteratorTarget,
    removeNumberLiterals, rewriteElementIteratorVariables,
    iteratorWizardPrefixes, validIteratorIndex, preferredIterator, iteratorName
} from './iterator-substitutions.js';
import { replacementPairs, replacementsToWire } from './step-replacements.js';
import { generateElementScript } from './step-script.js';

const plugin = name => `com.mirth.connect.plugins.${name}`;
const mapping = "msg['OBX'][0]['OBX.5'].toString()";
const indexed = "msg['OBX'][i]['OBX.5'].toString()";
const detached = "msg['OBX']['OBX.5'].toString()";
const iterator = (prefix, indexVariable = 'i', children = []) => ({
    __type: 'com.mirth.connect.model.IteratorStep',
    properties: { target: prefix, indexVariable, prefixSubstitutions: { string: prefix } },
    __children: children
});
const mapper = () => ({
    __type: plugin('mapper.MapperStep'), variable: 'values', mapping,
    defaultValue: mapping, replacements: replacementsToWire([[mapping, mapping]])
});
const outer = iterator("msg['OBX']");

// Assignment fixes the observed first-repetition duplication. Repeating the
// application is idempotent; detach removes the prior index before reassign.
const element = mapper();
normalizeIteratorTarget(element);
rewriteElementIteratorVariables(element, [outer], true);
assert.equal(element.mapping, indexed);
assert.equal(element.defaultValue, indexed);
assert.deepEqual(replacementPairs(element), [[indexed, indexed]]);
const applied = JSON.stringify(element);
rewriteElementIteratorVariables(element, [outer], true);
assert.equal(JSON.stringify(element), applied);
rewriteElementIteratorVariables(element, [outer], false);
assert.equal(element.mapping, detached);
assert.equal(element.defaultValue, detached);
assert.deepEqual(replacementPairs(element), [[detached, detached]]);
const second = iterator("msg['OBX']", 'k');
normalizeIteratorTarget(element);
rewriteElementIteratorVariables(element, [second], true);
assert.equal(element.mapping, indexed.replace('[i]', '[k]'));
assert.ok(!JSON.stringify(element).includes('[i]'));

// Expression edits are restricted to matching starts and the plugin's shipped
// fields. No string contents, script text, map keys or variables are rewritten.
for (const expression of ["other['OBX'][0]", `"msg['OBX'][0]"`, `validate(${mapping})`]) {
    const el = { ...mapper(), mapping: expression };
    rewriteElementIteratorVariables(el, [outer], true);
    assert.equal(el.mapping, expression);
}
const script = { __type: plugin('javascriptstep.JavaScriptStep'), script: mapping };
rewriteElementIteratorVariables(script, [outer], true);
assert.equal(script.script, mapping);
assert.equal(element.variable, 'values');

// Every shipped type with an expression-substitution hook participates.
for (const [type, field] of [
    ['messagebuilder.MessageBuilderStep', 'messageSegment'],
    ['xsltstep.XsltStep', 'sourceXml'],
    ['rulebuilder.RuleBuilderRule', 'field'],
    ['destinationsetfilter.DestinationSetFilterStep', 'field']
]) {
    const el = { __type: plugin(type), [field]: mapping, values: { string: [mapping, '"constant"'] } };
    rewriteElementIteratorVariables(el, [outer], true);
    assert.equal(el[field], indexed, type);
    if (field === 'field') assert.deepEqual(el.values, { string: [indexed, '"constant"'] });
}
for (const values of [{ string: mapping }, [mapping]]) {
    const rule = { __type: plugin('rulebuilder.RuleBuilderRule'), field: mapping, values };
    rewriteElementIteratorVariables(rule, [outer], true);
    assert.equal(Array.isArray(rule.values) ? rule.values[0] : rule.values.string, indexed);
}

// Nested apply is parent-first and removal is child-first, using the original
// prefixes until all descendants have been detached. Keeping an outer parent
// after detaching from the inner one restores only that outer index.
const nestedMapping = "msg['OBX'][0]['OBX.5'][0]['OBX.5.1'].toString()";
const nestedIndexed = "msg['OBX'][i]['OBX.5'][j]['OBX.5.1'].toString()";
const child = { ...mapper(), mapping: nestedMapping };
const inner = iterator("msg['OBX'][0]['OBX.5']", 'j', [child]);
rewriteElementIteratorVariables(inner, [outer], true);
assert.equal(inner.properties.target, "msg['OBX'][i]['OBX.5']");
assert.equal(child.mapping, nestedIndexed);
rewriteElementIteratorVariables(inner, [outer], false);
assert.equal(inner.properties.target, "msg['OBX']['OBX.5']");
assert.equal(child.mapping, "msg['OBX']['OBX.5']['OBX.5.1'].toString()");
rewriteElementIteratorVariables(inner, [outer], true);
rewriteElementIteratorVariables(child, [outer, inner], false);
rewriteElementIteratorVariables(child, [outer], true);
assert.equal(child.mapping, "msg['OBX'][i]['OBX.5']['OBX.5.1'].toString()");
assert.ok(!child.mapping.includes('[j]'));

// Serialized singleton children and typed singleton prefixes are supported,
// while hydrated __children take precedence over stale wire copies.
const wireChild = mapper();
delete wireChild.__type;
const wire = iterator("msg['OBX']");
delete wire.__children;
wire.properties.children = { [plugin('mapper.MapperStep')]: wireChild };
rewriteElementIteratorVariables(wire, [], true);
assert.equal(wireChild.mapping, indexed);
const live = mapper();
wire.__children = [live];
wireChild.mapping = 'stale';
rewriteElementIteratorVariables(wire, [], true);
assert.equal(live.mapping, indexed);
assert.equal(wireChild.mapping, 'stale');

// Replacement import shapes retain their structure, including unfinished rows
// and typed null/empty expressions. Rewriting must never filter another row.
for (const replacements of [
    [[mapping, mapping], ['', '']],
    { entry: [{ key: mapping, value: mapping }, { key: '', value: '' }] },
    [{ first: mapping, second: mapping }, { first: '', second: '' }],
    [{ string: [mapping, mapping] }, { string: ['', ''] }]
]) {
    const el = { ...mapper(), replacements };
    rewriteElementIteratorVariables(el, [outer], true);
    assert.deepEqual(replacementPairs(el), [[indexed, indexed], ['', '']]);
}
const typed = { ...mapper(), replacements: { 'org.apache.commons.lang3.tuple.ImmutablePair': {
    left: { '@class': 'string', $: null }, right: { '@class': 'string' }
} } };
rewriteElementIteratorVariables(typed, [outer], true);
assert.deepEqual(replacementPairs(typed), [['null', '']]);

// Primary target normalization is distinct from substitution: every numeric
// repetition on that target disappears, even without a matching prefix.
assert.equal(removeNumberLiterals(nestedMapping), "msg['OBX']['OBX.5']['OBX.5.1'].toString()");
assert.equal(removeNumberLiterals("msg['key[0]'][123].name[0x2]"), "msg['key[0]'].name");
assert.equal(removeNumberLiterals("msg['OBX'][i+1]['x']"), "msg['OBX']['x']");
assert.equal(removeNumberLiterals("msg['OBX'][index.foo]['x']"), "msg['OBX'].index.foo['x']");
assert.equal(removeNumberLiterals("msg['OBX'][index['foo']]['x']"), "msg['OBX'][index]['foo']['x']");
assert.equal(removeNumberLiterals("msg['OBX'][arr[0]]['x']"), "msg['OBX'][arr]['x']");
for (const root of ['this', 'null', 'true']) {
    assert.equal(removeNumberLiterals(`msg[${root}.segment]['OBX.5']`), "msg.segment['OBX.5']", 'skip a KeywordLiteral but retain its member name');
}
assert.equal(removeNumberLiterals("this.segment['OBX.5']"), "segment['OBX.5']");
assert.equal(removeNumberLiterals("msg[this['segment']]['OBX.5']"), "msg['segment']['OBX.5']");
assert.equal(removeNumberLiterals('this'), 'this', 'an empty visitor result falls back to the whole source');
assert.equal(removeNumberLiterals("msg[(foo).bar]['OBX.5']"), "msg.bar['OBX.5']");
assert.equal(removeNumberLiterals("msg[foo[(bar).baz]]['OBX.5']"), "msg[foo].baz['OBX.5']");
assert.equal(removeNumberLiterals("(foo).bar['OBX.5']"), "bar['OBX.5']");
assert.equal(removeNumberLiterals("msg[(foo)].bar"), 'msg.bar');
for (const [key, suffix] of [["index.foo", '.index.foo'], ["index['foo']", "[index]['foo']"], ['arr[0]', '[arr]']]) {
    const el = { ...mapper(), mapping: `msg['OBX'][${key}]['x']` };
    rewriteElementIteratorVariables(el, [outer], true);
    assert.equal(el.mapping, `msg['OBX'][i]${suffix}['x']`);
}
for (const [expression, expected] of [
    [String.raw`msg['OB\u0058'][0]`, "msg['OBX']"],
    [String.raw`msg["OB\u0058"][0]`, 'msg["OBX"]'],
    ["msg['消息'][0]", String.raw`msg['\u6d88\u606f']`],
    [String.raw`msg['a\x62'][0]`, "msg['ab']"],
    [String.raw`msg['a\n'][0]`, String.raw`msg['a\n']`],
    [String.raw`msg['a\z'][0]`, "msg['az']"],
    [String.raw`msg['a\'b'][0]`, String.raw`msg['a\'b']`],
    [String.raw`msg['a\\b'][0]`, String.raw`msg['a\\b']`],
    [String.raw`msg['\101'][0]`, "msg['A']"],
    ["msg['a\\\nb'][0]", "msg['ab']"],
    [String.raw`msg["a\"b"][0]`, String.raw`msg["a\"b"]`],
    [String.raw`msg['\0'][0]`, String.raw`msg['\x00']`],
    [String.raw`msg['\u0001'][0]`, String.raw`msg['\x01']`],
    [String.raw`msg['\v'][0]`, String.raw`msg['\v']`],
    [String.raw`msg['\\u0058'][0]`, String.raw`msg['\\u0058']`],
    [String.raw`msg['\u2028'][0]`, String.raw`msg['\u2028']`]
]) assert.equal(removeNumberLiterals(expression), expected, 'match Rhino StringLiteral.toSource canonicalization');
const escapedPrefix = { ...mapper(), mapping: String.raw`msg['OB\u0058'][0]['OBX.5']` };
rewriteElementIteratorVariables(escapedPrefix, [outer], true);
assert.equal(escapedPrefix.mapping, String.raw`msg['OB\u0058'][0]['OBX.5']`, 'direct substitution still matches the original literal prefix');
assert.equal(removeNumberLiterals("msg['OBX'][-1]['x']"), "msg['OBX']['x']");
assert.equal(removeNumberLiterals("msg['OBX'][0].length"), "msg['OBX'].length");
assert.equal(removeNumberLiterals("msg..OBX[0].toString()"), "msg.OBX.toString()");
assert.equal(removeNumberLiterals("msg['OBX'][0].@id"), "msg['OBX'].@id");
assert.equal(removeNumberLiterals("msg['OBX'][0].消息[0]"), "msg['OBX'].消息");
assert.equal(removeNumberLiterals("msg['OBX'][π]['x']"), "msg['OBX'][π]['x']");
assert.equal(removeNumberLiterals("msg['OBX'][€]['x']"), "msg['OBX'][€]['x']");
assert.equal(removeNumberLiterals("msg['OBX'][0].€[0]"), "msg['OBX'].€");
assert.equal(removeNumberLiterals(String.raw`msg['OBX'][\u0069]['x']`), "msg['OBX'][i]['x']");
assert.equal(removeNumberLiterals("msg['OBX'][0].ns::field[0]"), "msg['OBX'].ns::field");
assert.equal(removeNumberLiterals("msg/*comment*/['OBX'][0]['x']"), "msg['OBX']['x']");
assert.equal(removeNumberLiterals("msg['OBX'][index /*comment*/]['x']"), "msg['OBX'][index]['x']");
assert.equal(removeNumberLiterals("msg['OBX'][0]// comment\n['x']"), "msg['OBX']['x']");
assert.equal(removeNumberLiterals("msg['/*[0]*/'][0]['x']"), "msg['/*[0]*/']['x']", 'comments inside a key remain string contents');
for (const number of ['.5', '1e2', '0xA', '010']) {
    assert.equal(removeNumberLiterals(`msg['OBX'][${number}]['x']`), "msg['OBX']['x']");
}
for (const number of ['0b10', '0o10']) {
    const expression = `msg['OBX'][${number}]['x']`;
    assert.equal(removeNumberLiterals(expression), expression, 'match default Rhino parser fallback');
}
for (const key of ['true', 'false', 'null', 'this']) {
    assert.equal(removeNumberLiterals(`msg['OBX'][${key}]['x']`), "msg['OBX']['x']", 'KeywordLiteral is not a Name');
}
const method = { ...mapper(), mapping: "msg['OBX'][0].foo()" };
rewriteElementIteratorVariables(method, [outer], true);
assert.equal(method.mapping, "msg['OBX'][i][0].foo()", 'unsupported call suffix follows the Swing fallback');
assert.equal(removeNumberLiterals(`someFunction(${mapping})`), `someFunction(${mapping})`);
assert.equal(removeNumberLiterals(`${mapping} + 'suffix'`), `${mapping} + 'suffix'`);
assert.deepEqual(iteratorExpressionParts(mapping), ['msg', "msg['OBX']", "msg['OBX']['OBX.5']"]);
assert.deepEqual(iteratorExpressionParts(''), []);
// Wizard choices retain component positions for synchronized outbound choices,
// hide boundaries immediately before ancestor indices, and prefer the next part.
const wizardTarget = "msg['OBR'][i]['OBX'][j]['OBX.5']";
const wizard = iteratorWizardPrefixes(wizardTarget, ['i', 'j']);
assert.deepEqual(wizard.choices, [
    { value: 'msg', index: 0 },
    { value: "msg['OBR'][i]", index: 2 },
    { value: "msg['OBR'][i]['OBX'][j]", index: 4 },
    { value: wizardTarget, index: 5 }
]);
assert.deepEqual(wizard.selected, { value: wizardTarget, index: 5 });
assert.equal(iteratorWizardPrefixes("msg['OBR'][i]", ['i']).selected.value, "msg['OBR'][i]");
assert.equal(iteratorWizardPrefixes("msg['OBR'][i]['OBX']", ['i']).selected.value, "msg['OBR'][i]['OBX']");
assert.equal(iteratorWizardPrefixes("msg['i']['OBX']", ['i']).choices[0].value, 'msg', 'a quoted property is not an index variable');
assert.equal(iteratorWizardPrefixes('msg.i.OBX', ['i']).choices[0].value, 'msg.i', 'match the Swing property-name check');
for (const property of ['@i', 'ns::i', '@ns::i', '*::i']) {
    assert.equal(iteratorWizardPrefixes(`msg.${property}['value']`, ['i']).choices[0].index, 1, 'E4X attributes and namespaces expose their local property name');
}
// Swing's MirthTree emits XmlElemRef paths for namespaced XML. These match
// JavaScriptSharedUtil (Rhino 1.7.13) output.
for (const [expression, expected] of [
    ["msg['OBX'][0].*::['OBX.5'][1].toString()", "msg['OBX'].*::['OBX.5'].toString()"],
    ["msg.*::['ClinicalDocument'][0].*::['component'][2]", "msg.*::['ClinicalDocument'].*::['component']"],
    ["msg..*::['x'][0]", "msg.*::['x']"],
    ["msg['a'][0].@*::['id']", "msg['a'].@*::['id']"],
    ["msg.@['id']", "msg.@['id']"],
    ["msg.ns::['x'][1]", "msg.ns::['x']"],
    ["msg.*::[i][0]", 'msg.*::[i]'],
    ["msg.*::[0]['x'][1]", "msg.*::[0]['x']"],
    ["msg.*::[true][0]", 'msg.*::[true]'],
    ["msg['x'].*::[foo.bar][0]", "msg['x'].*::[foo.bar]"],
    ["msg.*:: ['x'][0]", "msg.*::['x']"],
    ["msg.*::['a::b'][0]", "msg.*::['a::b']"],
    [String.raw`msg.*::["aé"][0]`, String.raw`msg.*::["a\xe9"]`]
]) assert.equal(removeNumberLiterals(expression), expected);
assert.equal(removeNumberLiterals("msg.*::['a'+'b'][0]"), "msg.*::['a' + 'b']", 'Rhino prints the complete computed key, then removes surrounding numeric indices');
// Actual JavaScriptSharedUtil/XmlElemRef.toSource results. A numeric index
// inside a key must survive even when the outer repetition indices disappear.
for (const [key, printed] of [
    ["'OBX.'+'5'", "'OBX.' + '5'"],
    ["fields['value']", "fields['value']"],
    ['fieldNames[0]', 'fieldNames[0]'],
    ['(field)', '(field)'],
    ['field . name', 'field.name'],
    ['getField()', 'getField()'],
    ["String('OBX.5')", "String('OBX.5')"],
    ["true?'OBX.5':'OBX.3'", "true ? 'OBX.5' : 'OBX.3'"],
    ["'x'+(i+1)", "'x' + (i + 1)"],
    ['-1', '-1'], ['+value', '+value'], ['!flag', '!flag'], ['~mask', '~mask'],
    ['typeof value', 'typeof value'], ['void 0', 'void 0'], ['delete value.key', 'delete value.key'],
    ['i++', 'i++'], ['--i', '--i'], ['a=b', 'a = b'], ['a+=b', 'a += b'],
    ['a,b', 'a , b'], ['a&&b||c', 'a && b || c'],
    ["new String('OBX.5')", "new String('OBX.5')"], ['new Foo', 'new Foo()'],
    ['[1,,2]', '[1, , 2]'], ["['a','b'][0]", "['a', 'b'][0]"],
    ["['OBX.5',][0]", "['OBX.5'][0]"], ['[,,][0]', '[, ,][0]'],
    ["({a:1,b:'x'})", "({\n  a: 1, \n  b: 'x'})"],
    ['/a[b]/gi.source', '/a[b]/gi.source'], [String.raw`/[\]]/.source`, String.raw`/[\]]/.source`],
    [String.raw`(/['"/]/).source`, String.raw`(/['"/]/).source`],
    [String.raw`\u0066ields['value']`, "fields['value']"],
    ["getField(/*note*/'x', /*more*/0)", "getField('x', 0)"],
    ['this.name', 'this.name'], ['foo(a,b)[i]', 'foo(a, b)[i]'],
    ["msg.*::['field'][0].toString()", "msg.*::['field'][0].toString()"],
    ['function(a){return a;}', 'function(a) {\n  return a;\n}'],
    ['function(){}', 'function() {\n}'],
    ["(function(){return\n'OBX.5';})()", "(function() {\n  return;\n  'OBX.5';\n})()"],
    ['/=/.source', '/=/.source'],
    ["'消息'+field", String.raw`'\u6d88\u606f' + field`]
]) {
    const expression = `msg['OBX'][0].*::[${key}][0].toString()`;
    assert.equal(removeNumberLiterals(expression), `msg['OBX'].*::[${printed}].toString()`, key);
}
for (const key of ['0b10', "getField(", "'unterminated", 'fields.', 'a +']) {
    const expression = `msg['OBX'][0].*::[${key}][0].toString()`;
    assert.equal(removeNumberLiterals(expression), expression, 'parse failures preserve the whole source');
}
const invalidThrow = "msg['OBX'][0].*::[(function(){throw\n'OBX.5';})()][0].toString()";
assert.equal(removeNumberLiterals(invalidThrow), invalidThrow, 'a line break after throw is a Rhino parse failure');
for (const reference of ['*::', 'ns::', '@', '@*::', '@ns::']) {
    assert.equal(removeNumberLiterals(`msg[0].${reference}[fields['value']][1]`), `msg.${reference}[fields['value']]`);
}
// Expected source and boundaries come from packaged OIE 4.6.0/Rhino, not
// from this reader. Exercise token boundaries, visitor state, and statements:
// rejecting a valid path or changing control flow can lose repeated values.
const swingExpressions = ['iterator-key-sources.json', 'iterator-key-comments.json', 'iterator-key-rhino-grammar.json', 'iterator-member-trivia.json'].flatMap(file =>
    JSON.parse(readFileSync(new URL(`../../../test-fixtures/${file}`, import.meta.url), 'utf8')).cases);
for (const fixture of swingExpressions) {
    const { name, input, normalized, prefixes } = fixture;
    assert.equal(removeNumberLiterals(input), normalized, name);
    assert.deepEqual(iteratorExpressionParts(input), prefixes, name);
    // Native toSource can emit an identifier that changes on a second parse.
    // Assert the oracle's result instead of assuming universal idempotence.
    assert.equal(removeNumberLiterals(normalized), fixture.renormalized ?? normalized, `${name}: second normalization`);
    const element = { ...mapper(), mapping: input };
    normalizeIteratorTarget(element);
    rewriteElementIteratorVariables(element, [outer], true);
    assert.equal(element.mapping, fixture.assigned ?? normalized.replace("msg['OBX']", "msg['OBX'][i]"), `${name}: assignment`);
    rewriteElementIteratorVariables(element, [outer], false);
    assert.equal(element.mapping, fixture.detached ?? normalized, `${name}: detachment`);
}
let evaluated = 0;
globalThis.iteratorComputedKeyProbe = () => { evaluated++; return 'OBX.5'; };
try {
    assert.equal(removeNumberLiterals("msg[0].*::[iteratorComputedKeyProbe()][1]"), 'msg.*::[iteratorComputedKeyProbe()]');
    removeNumberLiterals("msg[0].*::[(function(){if(iteratorComputedKeyProbe())return 'x';throw 'missing';})()][1]");
    removeNumberLiterals("msg[0].*::[(<field>{iteratorComputedKeyProbe()}</field>).toString()][1]");
    assert.equal(evaluated, 0, 'normalization must never execute key expressions');
} finally { delete globalThis.iteratorComputedKeyProbe; }
assert.deepEqual(iteratorExpressionParts("msg['OBX'][0].*::['OBX.5'].toString()"), ['msg', "msg['OBX']", "msg['OBX'].*::['OBX.5']"]);
assert.deepEqual(iteratorWizardPrefixes("msg.*::['OBR'].*::[i].*::['OBX']", ['i']).choices.map(choice => choice.value),
    ['msg', "msg.*::['OBR'].*::[i]", "msg.*::['OBR'].*::[i].*::['OBX']"], 'an XmlElemRef index exposes its expression as the property name');
assert.equal(iteratorWizardPrefixes("msg.*::['i']['OBX']", ['i']).choices[0].value, 'msg', 'a quoted XmlElemRef key is not an index variable');
const namespaced = { ...mapper(), mapping: "msg.*::['OBX'][1].*::['OBX.5'][0].toString()" };
const namespacedIterator = iterator("msg.*::['OBX']");
rewriteElementIteratorVariables(namespaced, [namespacedIterator], true);
assert.equal(namespaced.mapping, "msg.*::['OBX'][i].*::['OBX.5'].toString()", 'namespaced repetitions are replaced by the iterator index');
rewriteElementIteratorVariables(namespaced, [namespacedIterator], false);
assert.equal(namespaced.mapping, "msg.*::['OBX'].*::['OBX.5'].toString()");
assert.equal(iteratorWizardPrefixes('', []).selected, undefined);
assert.equal(iteratorWizardPrefixes("msg['OBX'].children()", []).root, "msg['OBX'].children()");
assert.deepEqual(iteratorWizardPrefixes("tmp['OBX'].toString()", [], 'outbound').choices,
    [{ value: "tmp['OBX'].toString()", index: 0 }], 'only the primary wizard field strips the suffix');

// FunctionCall is opaque to the visitor, but the next access is a new
// PropertyGet or ElementGet. Literal child keys keep their own node kind.
for (const [key, visited] of [
    ['getKey().value', '.value'], ["getKey()['value']", "['value']"],
    ["'a'.length", "['a'].length"], ['[1].length', '.length'], ['getKey()', '']
]) {
    assert.equal(removeNumberLiterals(`msg['OBX'][0][${key}][0]`), "msg['OBX']" + visited);
}
for (const [source, normalized] of [
    ["String(msg['OBX'][0].value).length.toString()", "String(msg['OBX'][0].value).length.toString()"],
    ["msg['OBX'][1].value.toString().length", "msg['OBX'].value.toString().length"],
    ["msg['OBX'][1].value['toString'] /*keep*/ ().slice(1).length", "msg['OBX'].value['toString'] /*keep*/ ().slice(1).length"],
    ["msg['OBX'][0].(value == 'one').value.toString().length", "msg['OBX'].(value == 'one').value.toString().length"],
    ["msg['OBX'][0]..value.toString().length", "msg['OBX']..value.toString().length"],
    ["msg['OBX'][0][keys.value].toString().length", "msg['OBX'][keys.value].toString().length"],
    ["msg['OBX'][1].value.toString().length; record();", "msg['OBX'].value.toString().length; record();"],
    ['handlers[0]().value', 'handlers[0]().value'],
    ['labels[1].toString().length', 'labels[1].toString().length'],
    ['new String(12).length', 'new String(12).length'],
    ["({x: {f: String}}).x.f('a').length", "({x: {f: String}}).x.f('a').length"]
]) {
    assert.equal(removeNumberLiterals(source), normalized, 'preserve the receiver of a call result');
    assert.equal(removeNumberLiterals(normalized), normalized);
}
assert.deepEqual(iteratorExpressionParts("msg['OBX'][1].value.toString().length"), ["msg['OBX'].value.toString().length"]);
for (const statement of ['<![CDATA[text]]>', '<?target?>', '/value/u', '1++', '++(a + b)',
    'var [a,b]', 'var {a:b}', 'for (var a,b in [1]) {}', '<x>{/*empty*/}</x>']) {
    const draft = `msg['OBX'][0].value[0]; ${statement};`;
    assert.equal(removeNumberLiterals(draft), draft, 'a rejected trailing statement preserves the entire draft');
}
for (const statement of ['<x><![CDATA[text]]></x>', '<?target?><x/>', '/value/y', '(counter)++',
    'var [a,b] = [1,2]', 'for (var [a,b] in [[1,2]]) {}', 'for (var a,b; a; b) {}',
    '<x>{}</x>', '<x>{/*comment*/ 1}</x>', 'var o = { get x(a){return a;}, set x(){}, f(){return 1;} }']) {
    assert.equal(removeNumberLiterals(`msg['OBX'][0].value[0]; ${statement};`), "msg['OBX'].value");
}
assert.equal(validIteratorIndex(['i', 'j'], ['k']), 'l');
const firstPath = "msg['OBX'][0].value[0]";
// The packaged parser rejects the entire input when a later strict function
// is invalid. Dropping that function would turn an invalid mapping into a valid one.
for (const invalid of [
    'var octal = 010;', 'with (obj) {}', 'var eval = 1;', 'try {} catch (arguments) {}',
    'function inner(x, x) {}', 'var arrow = (x, x) => x;', 'var obj = {a: 1, "a": 2};',
    'var obj = {get x(){}, set x(v){}, get x(){}};', 'var x = 1; const x = 2;'
]) {
    const source = `${firstPath}; function key(){ /* header */ 'directive'; 'use strict'; ${invalid} }`;
    assert.equal(removeNumberLiterals(source), source);
    assert.deepEqual(iteratorExpressionParts(source), [source]);
}
for (const valid of [
    "'use strict'; var n = 0x10; var obj = {get x(){}, set x(v){}};",
    "'use strict'; function inner(){ var n = 010; }",
    "var first = 1; 'use strict'; var n = 010;",
    "('use strict'); with (obj) {}"
]) {
    assert.equal(removeNumberLiterals(`${firstPath}; function key(){ ${valid} }`), "msg['OBX'].value");
}
// The release parser checks const conflicts in the containing function even
// without a strict directive. A destructured parameter binds its value name.
for (const [body, valid] of [
    ['const x = 1; { var x = 2; }', false],
    ['function f() {} const f = 1;', false],
    ['var f = ({key: x}) => { const x = 1; };', false],
    ['function f([x]) { const x = 1; }', false],
    ['const x = 1; var a = [v for (x in rows)];', false],
    ['const x = 1; function f() { var x = 2; }', true],
    ['function f({key: x}) { const key = 1; }', true],
    ['var f = function internal() {}; const internal = 1;', true],
    ['var x = 1; var x = 2;', true]
]) {
    const draft = `${firstPath}; function read() { ${body} }`;
    assert.equal(removeNumberLiterals(draft), valid ? "msg['OBX'].value" : draft);
}
for (const statement of ["'unfinished\\'", 'var s = "unfinished\\"']) {
    const draft = firstPath + '; ' + statement;
    assert.equal(removeNumberLiterals(draft), draft, 'an escaped quote at EOF leaves the whole draft intact');
}
for (const statement of ["var s = 'quoted\\''", 'var s = "quoted\\""',
    "default xml namespace = 'urn:hl7-org:v3'", 'function read() { default xml namespace = ns; return msg; }',
    'var f = () => 1', 'var f = (x, y) => x + y', 'var [a+b] = [1]',
    'for each (x; x; x) {}', 'var x = [foo for (foo of rows)]']) {
    assert.equal(removeNumberLiterals(firstPath + '; ' + statement), "msg['OBX'].value");
}
assert.equal(removeNumberLiterals(String.raw`msg['OBX']['\xQx'][0]`), "msg['OBX']['xQx']");
assert.equal(removeNumberLiterals(String.raw`msg['OBX']['\uABxZ'][0]`), "msg['OBX']['uABxZ']");
assert.equal(removeNumberLiterals(String.raw`msg['OBX']['\u{41}'][0]`), "msg['OBX']['u{41}']");
assert.equal(removeNumberLiterals(`${firstPath}.*::[(function(){var f = (x,y)=>x+y;return f('val','ue');})()][0]`),
    "msg['OBX'].value.*::[(function() {\n  var f = (x, y) => x + y;\n  return f('val', 'ue');\n})()]");
for (const statement of ['var f = (x=1) => x', 'var f = x\n=> x', 'var x = [foo for each (foo of rows)]']) {
    const draft = `${firstPath}; ${statement};`;
    assert.equal(removeNumberLiterals(draft), draft);
}
const namespaceKey = "msg['OBX'][0].*::[(function(){default xml namespace = ns; return 'value';})()][0]";
assert.equal(removeNumberLiterals(namespaceKey), namespaceKey, 'Rhino cannot print the visited default namespace statement');
assert.equal(validIteratorIndex('ijklmnopqrstuvwxyz'.split(''), ['ii']), 'jj');
assert.equal(validIteratorIndex([], []), 'i');
const preferredInner = iterator("msg['OBX'][i]['OBX.5']", 'j');
const preferredOuter = iterator("msg['OBX']", 'i', [preferredInner]);
const preferredTie = iterator("msg['OBX']", 'k');
assert.equal(preferredIterator(detached, [preferredOuter, preferredTie]), preferredInner, 'prefer deepest matching prefix');
assert.equal(preferredIterator("msg['OBX']['other']", [preferredOuter, preferredTie]), preferredOuter, 'first match wins tied depths');
assert.equal(preferredIterator(detached, [preferredOuter, preferredTie], preferredOuter), preferredTie, 'exclude selected subtree');
assert.equal(preferredIterator("msg['PID']", [preferredOuter]), null);
assert.equal(preferredIterator("msg['OBX'].toString()", [iterator("msg['OBX'].toString()")]), null, 'the wizard removes toString before finding an existing prefix');
assert.equal(iteratorName(preferredOuter), "For each msg['OBX']");
assert.equal(iteratorName({ ...preferredOuter, __type: 'com.mirth.connect.model.IteratorRule' }), "Accept message if at least one of the iterations returns true for each msg['OBX']");
assert.equal(iteratorName({ ...preferredOuter, __type: 'com.mirth.connect.model.IteratorRule', properties: { ...preferredOuter.properties, intersectIterations: true } }), "Accept message if all of the iterations return true for each msg['OBX']");
const messageBuilder = { __type: plugin('messagebuilder.MessageBuilderStep'), messageSegment: "tmp['OBX'][0]['OBX.5']", mapping };
assert.deepEqual(getIteratorInfo(messageBuilder), { target: mapping, outbound: messageBuilder.messageSegment });
normalizeIteratorTarget(messageBuilder);
assert.equal(messageBuilder.mapping, detached);
assert.equal(messageBuilder.messageSegment, "tmp['OBX']['OBX.5']");
const builderWithoutMapping = { ...messageBuilder, mapping: '' };
assert.deepEqual(getIteratorInfo(builderWithoutMapping), { target: messageBuilder.messageSegment, outbound: null });
assert.deepEqual(getIteratorInfo({ ...messageBuilder, mapping: '\u00a0' }),
    { target: '\u00a0', outbound: messageBuilder.messageSegment }, 'Swing treats a non-breaking space as a supplied mapping');
const builderWithSpace = { ...messageBuilder, mapping, messageSegment: '\u00a0' };
normalizeIteratorTarget(builderWithSpace);
assert.equal(builderWithSpace.messageSegment, '\u00a0');
assert.equal(builderWithSpace.mapping, detached);
const xslt = { __type: plugin('xsltstep.XsltStep'), sourceXml: mapping };
normalizeIteratorTarget(xslt);
assert.equal(xslt.sourceXml, mapping, 'Swing XSLT inherits the no-op iterator-info setter');

// The generated child script consumes the changed expression as source and
// produces distinct repetitions. Separate real-engine/Rhino evidence verifies
// the shipped getScript implementations, rather than this preview alone.
const repeated = mapper();
repeated.defaultValue = '';
repeated.replacements = '';
normalizeIteratorTarget(repeated);
rewriteElementIteratorVariables(repeated, [outer], true);
const scriptText = generateElementScript(repeated);
const observed = [];
const msg = { OBX: [{ 'OBX.5': 'one' }, { 'OBX.5': 'two' }] };
for (let i = 0; i < msg.OBX.length; i++) {
    new Function('msg', 'i', 'validate', 'channelMap', scriptText)(msg, i, value => value, { put: (_key, value) => observed.push(value) });
}
assert.deepEqual(observed, ['one', 'two']);

// The Generated Script tab and Validate consume the same source. Exercise the
// resulting filter decision and the number of evaluations before a break.
const scriptRule = (script, operator, enabled = true) => ({ __type: plugin('javascriptrule.JavaScriptRule'), script, operator, enabled });
const filterLoop = (all, stop, children) => ({
    __type: 'com.mirth.connect.model.IteratorRule',
    properties: { target: 'rows', indexVariable: 'i', intersectIterations: all, breakEarly: stop },
    __children: children
});
for (const all of [true, false]) {
    for (const stop of [true, false]) {
        const children = [scriptRule('return observe(rows[i]);', 'NONE'),
            scriptRule('throw Error("disabled rule");', 'OR', false), scriptRule('return true;', 'AND')];
        const run = new Function('rows', 'getArrayOrXmlLength', 'observe', generateElementScript(filterLoop(all, stop, children)));
        const visits = [];
        assert.equal(run([true, false, true], rows => rows.length, value => { visits.push(value); return value; }), !all);
        assert.deepEqual(visits, stop ? (all ? [true, false] : [true]) : [true, false, true]);
        assert.equal(run([], rows => rows.length), all);
        const empty = new Function('rows', 'getArrayOrXmlLength', generateElementScript(filterLoop(all, stop, [])));
        assert.equal(empty([true], rows => rows.length), all);
    }
}
const legacyFilter = filterLoop(false, true, [scriptRule('return true;', 'NONE')]);
delete legacyFilter.properties.breakEarly;
assert.ok(!generateElementScript(legacyFilter).includes('break;'), 'XStream loads a missing primitive breakEarly as false');
for (const [wire, source] of [[false, 'false'], [0, '0'], ['', '']]) {
    const comparison = { __type: plugin('rulebuilder.RuleBuilderRule'), field: 'rows[i]', condition: 'EQUALS', values: { string: wire } };
    assert.ok(generateElementScript(filterLoop(false, false, [comparison])).includes(`if(rows[i] == ${source})`));
}
const builder = { __type: plugin('messagebuilder.MessageBuilderStep'), messageSegment: "tmp['OBX'][i]['OBX.5']",
    mapping: 'rows[i]', defaultValue: '', replacements: '' };
const builderScript = generateElementScript(iterator('rows', 'i', [builder]));
assert.ok(builderScript.includes("createSegment('OBX', tmp, i);"), 'create the XML repetition before writing its child');
const build = new Function('tmp', 'rows', 'getArrayOrXmlLength', 'validate', builderScript);
const outbound = {};
build(outbound, ['one', 'two'], rows => rows.length, value => value);
assert.deepEqual(outbound, { OBX: [{ 'OBX.5': 'one' }, { 'OBX.5': 'two' }] });
console.log('iterator substitution assignment, removal, nested moves, plugin fields and wire shapes passed');
