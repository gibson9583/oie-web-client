import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateElementScript } from './step-script.js';
import { readMessageBuilderParts, readMemberBoundaries, referencesIteratorIdentifier } from './iterator-expression.js';

test('only outer selectors form wizard and substitution boundaries', () => {
    const segments = [
        'msg', ".*::[(function() {\n  return 'OBX';\n})()]", '[0]', '.rows',
        "(fields[n], ')]')", ".@[new QName('urn:a', 'code')]", '[ i ]', '[2]'
    ];
    const path = segments.join('');
    const members = readMemberBoundaries(path);
    assert.deepEqual(members.map((member, i) => path.slice(members[i - 1]?.end ?? 0, member.end)), segments);
    assert.deepEqual(segments.filter((_, i) => members[i].numeric), ['[0]', '[2]']);
    assert.deepEqual(members.filter(part => part.call).map(part => part.end), [path.indexOf('.@')]);
    assert.deepEqual(members.flatMap(part => part.key ?? []), ['i']);
});

test('unsupported or malformed input exposes no editable prefix', () => {
    for (const suffix of [
        ' + other', '; other', ' +', '[', '[key other]', '[]', '[field + ]', '[key()',
        ".find('x',)", '(/x[)]/)', '(`value ${i}`)', '(<r>{i}</r>)', '.@default', '.ns::default',
        ' /* [i] */ [0]', '[\\u0069]', '.(flag)', '.'
    ]) {
        const path = 'msg.rows[0]' + suffix;
        assert.deepEqual(readMemberBoundaries(path), [], path);
        assert.equal(readMessageBuilderParts(path), null, path);
    }
});

test('Message Builder guards use the 4.6 XML field names and numeric indices', () => {
    const parts = readMessageBuilderParts("tmp..*::['row'][0].@ns::[fields[n]][i].val");
    assert.deepEqual(parts.map(part => part.propertyName), ['tmp', "'row'", '0', 'fields[n]', 'i', 'val']);
    assert.deepEqual(parts.map(part => part.value), ['tmp', ".*::['row']", '[0]', '.@ns::[fields[n]]', '[i]', '.val']);
    assert.deepEqual(parts.filter(part => part.numberLiteral).map(part => part.value), ['[0]']);
    // The shipped visitor omits a constructor in a regular bracket selector.
    const qualified = readMessageBuilderParts("tmp[new QName('urn:a', 'row')][i].val");
    assert.deepEqual(qualified.map(part => part.value), ['tmp', '[i]', '.val']);
});

test('rename recognizes index and namespace bindings and vetoes ambiguous lexical syntax', () => {
    for (const text of ['fields[i]', 'msg.i::row', 'msg.@i::value', 'f(...i)', '`hello ${i}`', "eval('i')",
        String.raw`msg[\u0069]`, 'field\u200dname', "/['\"]/g.test(s) && i", '<r attr="text">{i}</r>']) {
        assert.equal(referencesIteratorIdentifier(text, 'i'), true, text);
    }
    for (const text of [`msg['i']["i"].i.@i`, "msg.*::['i']", "channelMap.put('i', msg.i);",
        "tmp[new QName('urn:i', 'i')]", "'i'"]) {
        assert.equal(referencesIteratorIdentifier(text, 'i'), false, text);
    }
});

test('Message Builder visits nested member keys and skips binary keys in initializer guards', () => {
    for (const [target, values] of [
        ['tmp.items[i].part[keys[n]]', ['tmp', '.items', '[i]', '.part', '[keys]', '[n]']],
        ['tmp.items[i].segment[order + 1]', ['tmp', '.items', '[i]', '.segment']],
        ['tmp.items[i][fn().prop].value', ['tmp', '.items', '[i]', '.prop', '.value']]
    ]) assert.deepEqual(readMessageBuilderParts(target).map(part => part.value), values);
    assert.deepEqual(readMemberBoundaries('tmp.items[i].segment[order + 1]'), []);
});

test('an opaque enabled builder target makes the whole nested preview unavailable', () => {
    const builder = { __type: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
        mapping: "channelMap.put('assigned', 1)", messageSegment: 'tmp.items[i][(function() { return custom(); })()]' };
    const iterator = (indexVariable, ...children) => ({ __type: 'com.mirth.connect.model.IteratorStep',
        properties: { target: 'rows', indexVariable }, __children: children });
    const outer = iterator('i', iterator('j', builder), { script: "channelMap.put('sibling', 2)" });
    assert.equal(generateElementScript(outer), null);
    const scan = generateElementScript(outer, undefined, 'mapDiscovery');
    assert.ok(scan.includes(builder.mapping));
    assert.ok(scan.includes("channelMap.put('sibling', 2)"));
    builder.enabled = false;
    assert.ok(generateElementScript(outer).includes("channelMap.put('sibling', 2)"));
});
