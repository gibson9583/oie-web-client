import assert from 'node:assert/strict';
import { responseVariablesIn } from './response-variables.js';

for (const script of [undefined, null, false, 7, {}, '']) assert.deepEqual(responseVariablesIn(script), []);

assert.deepEqual(responseVariablesIn(`
    responseMap . put ( 'full', response);
    $r("short", response);
    $r('getter');
    responseMap.get('anotherGetter');
    responseMap.put('full', response);
`), ['full', 'short'], 'find both put forms, ignore getters, and deduplicate');

const cases = [
    [String.raw`unicode\u0041`, 'unicodeA'],
    [String.raw`pair\uD83D\uDE00`, 'pair😀'],
    // Rhino 1.7.13 drops the backslash for unsupported Unicode/hex escapes.
    [String.raw`point\u{1F600}`, 'pointu{1F600}'],
    [String.raw`\u{41}`, 'u{41}'],
    [String.raw`bad\u12`, 'badu12'],
    [String.raw`bad\uZZZZ`, 'baduZZZZ'],
    [String.raw`bad\xZ1`, 'badxZ1'],
    [String.raw`bad\x1`, 'badx1'],
    [String.raw`bad\u{}`, 'badu{}'],
    [String.raw`bad\u{110000}`, 'badu{110000}'],
    [String.raw`\u\x`, 'ux'],
    [String.raw`hex\x41`, 'hexA'],
    [String.raw`control\b\f\n\r\t\v`, 'control\b\f\n\r\t\v'],
    [String.raw`null\0`, 'null\0'],
    [String.raw`octal\101\377`, 'octalAÿ'],
    [String.raw`limits\400\777\08`, 'limits 0?7\x008'],
    [String.raw`quote\'and\"`, 'quote\'and"'],
    [String.raw`slash\\path\/end`, 'slash\\path/end'],
    [String.raw`literal\\u0041`, String.raw`literal\u0041`],
    [String.raw`other\q\8\9`, 'otherq89'],
    ['', ''],
];
for (const [literal, expected] of cases) {
    for (const prefix of ['responseMap.put', '$r']) {
        assert.deepEqual(responseVariablesIn(`${prefix}('${literal}', response);`), [expected], `${prefix}: ${literal}`);
    }
}

assert.deepEqual(responseVariablesIn(String.raw`responseMap.put('ack', response); $r('\u0061ck', response);`), ['ack'], 'deduplicate decoded keys');
assert.deepEqual(responseVariablesIn(String.raw`responseMap.put('\u{41}', response); $r('u{41}', response); $r('valid', response);`), ['u{41}', 'valid'], 'deduplicate Rhino keys and keep scanning subsequent writes');
assert.deepEqual(responseVariablesIn("responseMap.put('safe', (globalThis.__responseScanExecuted = true));"), ['safe']);
assert.equal(globalThis.__responseScanExecuted, undefined, 'channel JavaScript is never executed');
assert.deepEqual(responseVariablesIn("$r('again', response);"), ['again']);
assert.deepEqual(responseVariablesIn("$r('again', response);"), ['again'], 'global regex does not retain scan position');

console.log('response-variables: Rhino literal decoding, put/get distinction, deduplication and non-execution passed');

for (const prefix of ['responseMap.put', '$r']) {
    assert.deepEqual(responseVariablesIn(String.raw`${prefix}('trail\\', response);`), ['trail\\']);
    assert.deepEqual(responseVariablesIn(`${prefix}('prefix' + suffix, response); ${prefix}('get');`), [], 'computed keys and one-argument calls are not literal writes');
    for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
        assert.deepEqual(responseVariablesIn(`${prefix}('line\\${newline}continued', response);`), ['linecontinued'], 'line continuation has no character in the key');
    }
}

for (const prefix of ['responseMap.put', '$r']) {
    for (const comment of ['/* selected ACK */', '// selected ACK\n', '/* first */ /* second */']) {
        assert.deepEqual(responseVariablesIn(`${prefix}('ack' ${comment}, response);`), ['ack'], 'comments before the next argument remain valid');
    }
    assert.deepEqual(responseVariablesIn(`${prefix}('prefix' /* first */ + suffix /* second */, response);`), [], 'a comment cannot consume a computed argument');
}

assert.deepEqual(responseVariablesIn("$r('getter' // note, read only\n);"), [], 'comma inside a comment is not a write argument');
assert.deepEqual(responseVariablesIn("responseMap.put('prefix' // note, computed key\n + suffix, response);"), [], 'line comments cannot backtrack into a computed key');

for (const format of ['\u00ad', '\u200b', '\u200c', '\u202e']) {
    const cases = [
        [`a\\${format}z`, 'az'], [`a\\${format}n`, 'a\n'],
        [`a\\${format}'z`, "a'z"], [`a\\${format}\\z`, 'a\\z'],
        [`\\u0${format}04${format}1${format}`, `A${format}`],
        [`\\x${format}4${format}1${format}`, `A${format}`],
        [`\\u0${format}0${format}z`, 'u00z'], [`\\x4${format}z`, 'x4z'],
        [`\\1${format}0${format}1${format}z`, 'Az'],
        [`\\4${format}0${format}0${format}`, ` 0${format}`],
        [`a${format}z`, `a${format}z`], [`\\n${format}z`, `\n${format}z`],
        [`\\\\${format}z`, `\\${format}z`],
        ...['\n', '\r', '\r\n', '\u2028', '\u2029'].map(newline => [`a\\${format}${newline}${format}z`, 'az']),
    ];
    for (const [literal, expected] of cases) {
        assert.deepEqual(responseVariablesIn(`$r('${literal}', response);`), [expected], `Rhino raw format handling: ${JSON.stringify(literal)}`);
    }
}
for (const format of ['\ufeff', '\u{e0001}']) {
    assert.deepEqual(responseVariablesIn(`$r('a\\${format}z', response);`), [`a${format}z`], 'Rhino preserves BOM and supplementary format characters');
}
