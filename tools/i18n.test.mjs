import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage } from './i18n-check.mjs';
import { parse } from '@babel/parser';
import { candidates } from './i18n-literals.mjs';
import { astOf, sourceFiles, visit, extract } from './i18n-source.mjs';

test('catalog validation permits Chinese plurals and rejects lost or changed contracts', () => {
    validateMessage('{n, plural, one {# item} other {# items}}', '{n, plural, other {# 项}}');
    validateMessage('Read <b>{name}</b>', '阅读 <b>{name}</b>');
    validateMessage('Expected <map>', '需要 <map>', false);
    for (const [source, target] of [
        ['Hello {name}', '你好'],
        ['{n, number}', '{n}'],
        ['{n, plural, =0 {None} other {# items}}', '{n, plural, other {# 项}}'],
        ['{x, select, yes {Yes} other {No}}', '{x, select, other {否}}'],
        ['Read <b>{name}</b>', '阅读 <a>{name}</a>'],
        ['Hello', 'bad {'],
    ]) assert.throws(() => validateMessage(source, target));
});

test('the literal ratchet inspects exported functions and excludes wrapped messages', () => {
    const ast = parse('export function example() { return t("Wrapped {name}", {name:"Nested words"}) + "Unwrapped words"; }', {sourceType:'module'});
    assert.deepEqual(candidates(ast).map(c=>c.key), ['ObjectProperty:Nested words', 'BinaryExpression:Unwrapped words']);
});

test('translation calls cannot replace XML selector names or wire-property literals', () => {
    for (const file of sourceFiles()) visit(astOf(file), (node, parent) => {
        if (node.type === 'VariableDeclarator' && node.id?.name === 'LANGUAGES') visit(node.init, child => {
            if (child.type === 'CallExpression' && ['t','translate'].includes(child.callee?.name)) assert.fail(file + ': Monaco language IDs must remain literal');
        });
        if (node.type !== 'CallExpression' || !['t','tc','tx','translate','richText'].includes(node.callee?.name)) return;
        const where = file + ':' + node.loc.start.line;
        if(parent?.type==='CallExpression' && ['querySelector','querySelectorAll','getAttribute','getElementsByTagName','setAttribute'].includes(parent.callee?.property?.name))
            assert.notEqual(parent.arguments[0],node,where+' translates a structural selector');
        if(file.endsWith('/views/messages.tsx') && parent?.type==='CallExpression' && parent.callee?.name==='text')
            assert.notEqual(parent.arguments[1],node,where+' translates an XML element name');
        if(parent?.type==='ObjectProperty' && ['id','key','transportName','responseVariable','default','@class','@version'].includes(parent.key?.name ?? parent.key?.value))
            assert.fail(where+' translates a wire value');
    });
});

// Both messages occur inside another translated message's values.
test('extraction follows nested translations in value objects', () => {
    const { messages } = extract();
    assert.ok(messages[' — retrying in {seconds}s']?.some(file => file.includes('/react/shell.tsx:')));
    assert.ok(messages['this channel']?.some(file => file.includes('/views/filter-transformer.tsx:')));
});
