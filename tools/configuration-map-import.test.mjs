import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({
    entryPoints: ['web-administrator/client/react/views/configuration-map-import.ts'],
    bundle: true, write: false, format: 'esm', platform: 'node'
});
const { parseConfigurationMap, loadConfigurationMapImport, serializeConfigurationMap } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const values = input => Object.fromEntries(parseConfigurationMap(input).map(row => [row.key, row.value]));

test('Swing property separators, escaped keys, continuation, Unicode and first duplicate value', () => {
    assert.deepEqual(values(String.raw`colon:value
space value
escaped\=key=the\nvalue
continued=one\
    two
unicode=\u0041
duplicate=first
duplicate=second`), {
        colon: 'value', space: 'value', 'escaped=key': 'the\nvalue', continued: 'onetwo', unicode: 'A', duplicate: 'first'
    });
});

test('Commons values preserve unknown escapes, Windows paths, commas and octal literals', () => {
    assert.deepEqual(values(String.raw`path=C:\docs\other
value=escaped\ space\q\,comma\101
punctuation=\:\=\!\#\'\"\\
list=a,b,c`), {
        path: 'C:\\docs\\other', value: 'escaped\\ space\\q\\,comma\\101', punctuation: ':=!#\'"\\', list: 'a,b,c'
    });
});

test('keys use Java unescaping including octal and repeated-u Unicode', () => {
    assert.deepEqual(values(String.raw`escaped\ key=one
\101=two
\uu0042=three`), { 'escaped key': 'one', A: 'two', B: 'three' });
});

test('Commons strips leading/trailing physical whitespace, supports bare keys and empty keys', () => {
    assert.deepEqual(values('  a :  value  \r\nbare\r=first\n:second\n'), { a: 'value', bare: '', '': 'first' });
});

test('canonical comments preserve line breaks, aggregate duplicate comments and exclude header/footer', () => {
    assert.deepEqual(parseConfigurationMap('# header\n\n# first  \n! second\na=one\n# again\na=two\n# footer\n'), [
        { key: 'a', value: 'one', comment: 'first  \nsecond\nagain' }
    ]);
});

test('continuations skip comments/blank lines and an unterminated final continuation is dropped', () => {
    assert.deepEqual(values('x=before\\\n# a comment\n\n  after  \ny=unfinished\\'), { x: 'beforeafter' });
});

test('invalid Unicode rejects the entire import; truncated value Unicode follows Commons', () => {
    assert.throws(() => parseConfigurationMap('ok=1\nbad=\\u00zz'), /Invalid Unicode/);
    assert.throws(() => parseConfigurationMap('\\u00=x'), /Invalid Unicode/);
    assert.deepEqual(values('x=before\\u00'), { x: 'before' });
});

test('getString resolves forward property references and defaults without splitting comma lists', () => {
    assert.deepEqual(values('b=${a}/suffix\na=value\nc=${missing:-fallback}\nd=${unknown}\ne=$${a}'), {
        a: 'value', b: 'value/suffix', c: 'fallback', d: '${unknown}', e: 'value'
    });
    assert.throws(() => parseConfigurationMap('a=${b}\nb=${a}'), /Cyclic property reference/);
});

test('empty files and comment-only files are valid empty maps', () => {
    assert.deepEqual(parseConfigurationMap(''), []);
    assert.deepEqual(parseConfigurationMap('# header\n\n! footer\n'), []);
});

test('unresolved include files request selection rather than becoming configuration properties', () => {
    assert.throws(() => parseConfigurationMap('include=other.properties'), /Select the included/);
    assert.deepEqual(parseConfigurationMap('includeoptional=missing.properties', { includes: new Map([['missing.properties', null]]) }), []);
});

test('includes expand in place, resolve nested relative paths and use first duplicate value', async () => {
    const selected = [];
    const files = new Map([
        ['sub/one.properties', 'middle=from first\ninclude=../two.properties\n'],
        ['two.properties', 'middle=from second\nlast=value\n']
    ]);
    const rows = await loadConfigurationMapImport('first=value\ninclude=sub/one.properties\nmiddle=from root\n', 'root.properties', async include => {
        selected.push(include.path);
        return files.get(include.path);
    });
    assert.deepEqual(selected, ['sub/one.properties', 'two.properties']);
    assert.deepEqual(rows, [
        { key: 'first', value: 'value', comment: '' },
        { key: 'last', value: 'value', comment: '' },
        { key: 'middle', value: 'from first', comment: '' }
    ]);
});

test('include cancellation is transactional, optional includes can be skipped and cycles fail', async () => {
    assert.equal(await loadConfigurationMapImport('first=value\ninclude=missing.properties', 'root.properties', async () => undefined), null);
    assert.deepEqual(await loadConfigurationMapImport('includeoptional=missing.properties\na=1', 'root.properties', async () => null), [
        { key: 'a', value: '1', comment: '' }
    ]);
    await assert.rejects(loadConfigurationMapImport('include=child.properties', 'root.properties', async () => 'include=root.properties'), /Cyclic properties include/);
});

test('Commons interpolation escapes and nested defaults retain their exact getString behavior', () => {
    assert.deepEqual(values('a=$${missing}\nb=$$${present}\nc=${${key}}\nd=${missing:-${present}}\nkey=present\npresent=value'), {
        a: '${missing}', b: '${present}', c: '${${key}}', d: 'value', key: 'present', present: 'value'
    });
    assert.deepEqual(values('key=value\na=$$${missing:-$$${key}}\nb=${missing:-$${key}}'), {
        key: 'value', a: '${missing:-${key}}', b: '${key}'
    });
});

test('export escapes separator keys, boundary whitespace, newlines, backslashes and Unicode for Swing', () => {
    assert.equal(serializeConfigurationMap([
        { key: ' leading=key ', value: ' path\\directory\nnext é ', comment: 'first\nsecond' }
    ]), '# first\n# second\n\\u0020leading\\=key\\u0020=\\u0020path\\\\directory\\u000anext\\u0020\\u00e9\\u0020\n');
    assert.equal(serializeConfigurationMap([{ key: 'literal', value: '${key} $${key} ${missing:-${key}}', comment: '' }]),
        'literal=$$${key}\\u0020$$$${key}\\u0020$$${missing:-$$${key}}\n');
});
