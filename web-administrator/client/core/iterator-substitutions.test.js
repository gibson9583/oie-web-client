import assert from 'node:assert/strict';
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
assert.equal(removeNumberLiterals("msg.*::['a'+'b'][0]"), "msg.*::['a'+'b'][0]", 'Rhino reprints computed keys; keep the whole expression');
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
assert.equal(validIteratorIndex(['i', 'j'], ['k']), 'l');
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
console.log('iterator substitution assignment, removal, nested moves, plugin fields and wire shapes passed');
