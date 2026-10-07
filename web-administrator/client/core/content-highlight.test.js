import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hl7Encoding, tokenizeHl7Line, hl7Tooltip } from './content-highlight.js';

const fields = (line, encoding) => tokenizeHl7Line(line, encoding).flatMap((token, i, tokens) => token.field
    ? [[line.slice(token.startIndex, tokens[i + 1]?.startIndex), hl7Tooltip(token.field)]] : []);

test('MSH encoding characters are one field, including the optional truncation character', () => {
    assert.deepEqual(fields('MSH|^~\\&#|SENDER|FAC'), [['^~\\&#', 'MSH-2'], ['SENDER', 'MSH-3'], ['FAC', 'MSH-4']]);
    assert.deepEqual(fields('MSH|^~\\&||FAC|'), [['^~\\&', 'MSH-2'], ['FAC', 'MSH-4']]);
});

test('empty fields, repetitions, components, subcomponents and escapes retain field positions', () => {
    assert.deepEqual(fields('PID|1||123||Doe&Family^Jane~Smith^John'), [
        ['1', 'PID-1'], ['123', 'PID-3'], ['Doe', 'PID-5'], ['Family', 'PID-5'],
        ['Jane', 'PID-5.2'], ['Smith', 'PID-5'], ['John', 'PID-5.2']
    ]);
    assert.deepEqual(fields('OBX|1|TX|ID||a\\Z^&~|literal\\b^c'), [
        ['1', 'OBX-1'], ['TX', 'OBX-2'], ['ID', 'OBX-3'], ['a\\Z^&~|literal\\b', 'OBX-5'], ['c', 'OBX-5.2']
    ]);
    assert.deepEqual(fields('PID|unclosed\\|next'), [['unclosed\\', 'PID-1'], ['next', 'PID-2']]);
});

test('custom batch/message delimiters and incomplete text are safe to tokenize', () => {
    let encoding = hl7Encoding('BHS*$%!@');
    assert.equal(encoding, '*$%!@');
    assert.deepEqual(fields('PID*1**123**Doe$Jane%Smith$John', encoding), [
        ['1', 'PID-1'], ['123', 'PID-3'], ['Doe', 'PID-5'], ['Jane', 'PID-5.2'], ['Smith', 'PID-5'], ['John', 'PID-5.2']
    ]);
    encoding = hl7Encoding('MSH|^~\\&|APP', encoding);
    assert.deepEqual(fields('PID|患者^Å', encoding), [['患者', 'PID-1'], ['Å', 'PID-1.2']]);
    for (const line of ['', '   ', 'M', 'MSH', 'MSH|', 'PID', '<script>alert(1)</script>', 'PIDnot a segment']) {
        const tokens = tokenizeHl7Line(line, hl7Encoding(line));
        assert.equal(tokens.map((token, i) => line.slice(token.startIndex, tokens[i + 1]?.startIndex)).join(''), line);
        assert.ok(tokens.every((token, i) => i === 0 || token.startIndex > tokens[i - 1].startIndex));
    }
});

test('field names fall back from component vocabulary to the field and then its path', () => {
    const descriptions = { 'PID.5': 'Patient Name', 'PID.5.2': 'Given Name' };
    assert.equal(hl7Tooltip('PID.5.1', descriptions), 'PID-5 · Patient Name');
    assert.equal(hl7Tooltip('PID.5.2', descriptions), 'PID-5.2 · Given Name');
    assert.equal(hl7Tooltip('PID.9.1', descriptions), 'PID-9');
});
