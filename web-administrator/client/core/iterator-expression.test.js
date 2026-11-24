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
        ".find('x',)", '(/x[)]/gg)', '(`value ${i}`)', '(<r>{i}</r>)', '.@default', '.ns::default',
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
    for (const text of ['fields[i]', 'msg.i::row', 'msg.@i::value', 'f(...i)', '/* i */ fields[i]', '// skip this\nfields[i]', '/* unfinished', '`hello ${i}`', "eval('i')",
        String.raw`msg[\u0069]`, 'field\u200dname', "/['\"]/g.test(s) && i", '<r attr="text">{i}</r>']) {
        assert.equal(referencesIteratorIdentifier(text, 'i'), true, text);
    }
    for (const text of ['// i is only a comment', '/* i */ msg.i', `msg['i']["i"].i.@i`, "msg.*::['i']", "channelMap.put('i', msg.i);",
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

test('a regex argument is opaque to membership edits and preview generation', () => {
    for (const literal of ["/-/g", String.raw`/[,()[\]\/]+/im`, String.raw`/a\\/g`]) {
        const path = `msg.rows[0].value.toString().replace(${literal}, '')`;
        const parts = readMemberBoundaries(path);
        assert.ok(parts.some(part => part.end === 'msg.rows'.length));
        assert.equal(parts.at(-1)?.end, path.length);
        assert.equal(readMessageBuilderParts(path), null);
    }
    for (const literal of ['/unfinished', '/(/g', '/a/gg', '/a/q', '/[a/']) {
        assert.deepEqual(readMemberBoundaries(`msg.rows[0].replace(${literal}, '')`), []);
    }
});

test('Iterator fallback expressions expose only the first operand as a path', () => {
    const lhs = "msg['OBX'][0]['OBX.5'].toString()";
    for (const rhs of ["'unknown'", '0', 'false', 'defaults[0].value', "'a || b' || fallback()"]) {
        const expression = lhs + ' || ' + rhs;
        assert.deepEqual(readMemberBoundaries(expression, true), readMemberBoundaries(lhs));
        assert.deepEqual(readMemberBoundaries(expression), []);
        assert.equal(readMessageBuilderParts(expression), null);
    }
    for (const tail of [' || ', ' | | value', ' || defaults[', ' || fallback(,)', ' || msg.value; next()', ' || 1 +']) {
        assert.deepEqual(readMemberBoundaries(lhs + tail, true), [], tail);
    }
});

test('numeric fallback literals use Rhino syntax without changing member selectors or Builder previews', () => {
    const lhs = 'msg.rows[0].value';
    for (const rhs of ['-1', '+1', '-.5', '0.5', '1.', '1e3', '1.E-3', '0xFA', '-(0B10)', '0o17',
        '077', '09.5', '((-.5e+2))', '( -(-1) )', '1 || (-2)', '(false)', '((null))']) {
        const expression = lhs + ' || ' + rhs;
        assert.deepEqual(readMemberBoundaries(expression, true), readMemberBoundaries(lhs), rhs);
        assert.deepEqual(readMemberBoundaries(expression), [], rhs);
        assert.equal(readMessageBuilderParts(expression), null, rhs);
    }
    for (const rhs of ['1e', '1e+', '1 e3', '1.2.3', '0x', '0o8', '0b102', '01.5', '077e2', '1_000', '1n',
        '++1', '--1', '1 2', '(1', '1)', '(-)', '1 + 2']) {
        assert.deepEqual(readMemberBoundaries(lhs + ' || ' + rhs, true), [], rhs);
    }
    for (const key of ['-1', '0.5', '1e3']) {
        assert.deepEqual(readMemberBoundaries('msg.rows[' + key + ']'), [], key);
    }
});
