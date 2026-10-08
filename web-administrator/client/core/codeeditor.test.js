import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DESTINATION_MAPPINGS, destinationMappingsFor } from './mappings.js';

// Exercise the shipped editor and factory with a delayed loader, without a browser/Monaco.
const source = readFileSync(new URL('./codeeditor.js', import.meta.url), 'utf8');
const factoryBody = source.slice(source.indexOf('let factory ='), source.indexOf('export function createCodeEditor'));
class Element extends EventTarget {
    selectionStart = 0;
    selectionEnd = 0;
    selectionDirection = 'none';
    assignments = 0;
    commands = [];
    commandMode = 'input';
    _value = '';
    // Match the textarea API's display normalization; keep raw templates in the caller.
    set value(value) { this.assignments++; this._value = String(value).replace(/\r\n?/g, '\n'); }
    get value() { return this._value; }
    setSelectionRange(start, end, direction = 'none') {
        this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    }
    // Boundary stub: tests verify native command routing, not browser undo itself.
    ownerDocument = { activeElement: this, execCommand: (command, _ui, text) => {
        this.commands.push([command, this.selectionStart, this.selectionEnd, text]);
        if (this.commandMode === 'throw') throw Error('unsupported');
        if (this.commandMode === 'cancel') return false;
        assert.ok(command === 'insertText' || command === 'delete');
        this._value = this.value.slice(0, this.selectionStart) + text + this.value.slice(this.selectionEnd);
        if (this.commandMode === 'input') this.dispatchEvent(new Event('input'));
        return true;
    } };
}
const editorBody = source.slice(source.indexOf('export class CodeEditor'), source.indexOf('/* Insert text')).replace('export class', 'class');
const Editor = new Function('h', `${editorBody}\nreturn CodeEditor;`)(() => new Element());

for (const [name, literalInput, events, disposed, available, expected] of [
    ['untouched template upgrades', true, [], false, true, 1],
    ['edited template keeps its textarea', true, ['insertText'], false, true, 0],
    ['deleted template keeps its textarea', true, ['deleteContentBackward'], false, true, 0],
    ['edit then undo still keeps redo history', true, ['insertText', 'historyUndo'], false, true, 0],
    ['ordinary script still upgrades after editing', false, ['insertText'], false, true, 1],
    ['disposed editor stays disposed', true, [], true, true, 0],
    ['unavailable Monaco keeps the fallback', true, [], false, false, 0]
]) {
    test(name, async () => {
        let resolve, mounts = 0;
        const loaded = new Promise(r => { resolve = r; });
        const factory = new Function('CodeEditor', 'ensureMonaco', 'mountMonaco',
            `${factoryBody}\nreturn factory;`)(Editor, () => loaded, () => { mounts++; });
        const editor = factory({ literalInput });
        for (const inputType of events) {
            const event = new Event('input');
            Object.defineProperty(event, 'inputType', { value: inputType });
            editor.area.dispatchEvent(event);
        }
        if (disposed) editor.dispose();
        resolve(available ? {} : null);
        await loaded;
        assert.equal(mounts, expected);
    });
}

for (const [name, value, shiftKey, start, end, expected, literalInput = true] of [
    ['empty template', '', true, 0, 0, ''],
    ['unindented CR template', 'MSH|APP\rPID|1', true, 0, 0, 'MSH|APP\nPID|1'],
    ['unindented CRLF template', 'MSH|APP\r\nPID|1', true, 8, 8, 'MSH|APP\nPID|1'],
    ['empty first line before a tab', '\n\tAB', true, 0, 0, '\n\tAB'],
    ['empty first line before spaces', '\n    AB', true, 0, 0, '\n    AB'],
    ['literal Tab', 'AB', false, 1, 1, 'A\tB'],
    ['Tab replacing multiple lines', 'AB\nCD', false, 1, 4, 'A\tD'],
    ['Shift+Tab removing a tab', '\tAB', true, 1, 1, 'AB'],
    ['Shift+Tab removing spaces', '    AB', true, 4, 4, 'AB'],
    ['ordinary script Tab', 'AB', false, 1, 1, 'A\tB', false],
    ['Tab replacing an identical tab', 'A\tB\rC', false, 1, 2, 'A\tB\nC']
]) {
    test(`fallback ${name} only reports actual edits and retains them before upgrade`, async () => {
        let resolve, mounts = 0, changes = 0, rawTemplate = value;
        const loaded = new Promise(r => { resolve = r; });
        const factory = new Function('CodeEditor', 'ensureMonaco', 'mountMonaco',
            `${factoryBody}\nreturn factory;`)(Editor, () => loaded, () => { mounts++; });
        const editor = factory({ value, literalInput, onChange: next => { rawTemplate = next; changes++; } });
        const changed = expected !== editor.getValue();
        editor.area.selectionStart = start;
        editor.area.selectionEnd = end;
        const key = new Event('keydown', { cancelable: true });
        Object.assign(key, { key: 'Tab', shiftKey });
        editor.area.dispatchEvent(key);
        assert.equal(key.defaultPrevented, true);
        assert.equal(editor.getValue(), expected);
        assert.equal(editor.area.assignments, !literalInput && changed ? 2 : 1,
            'literal edits must never replace textarea.value and discard native history');
        assert.equal(editor.area.commands.length, literalInput && changed ? 1 : 0);
        assert.equal(changes, changed ? 1 : 0);
        assert.equal(rawTemplate, changed ? expected : value);
        assert.equal(editor.gutter.textContent, expected.includes('\n') ? '1\n2' : '1');
        resolve({});
        await loaded;
        assert.equal(mounts, changed && literalInput ? 0 : 1);
    });
}

for (const mode of ['input', 'silent', 'cancel', 'throw', 'unfocused']) {
    for (const shiftKey of [false, true]) test(`literal ${shiftKey ? 'outdent' : 'Tab'}: ${mode} command`, () => {
        let changes = 0;
        const editor = new Editor({ value: '    AB', literalInput: true, onChange: () => { changes++; } });
        editor.area.setSelectionRange(4, 6, 'backward');
        editor.area.commandMode = mode;
        if (mode === 'unfocused') editor.area.ownerDocument.activeElement = {};
        editor.handleKey({ key: 'Tab', shiftKey, preventDefault() {} });
        const changed = mode === 'input' || mode === 'silent';
        assert.equal(editor.getValue(), changed ? (shiftKey ? 'AB' : '    \t') : '    AB');
        assert.equal(changes, changed ? 1 : 0, 'notify exactly once per actual edit');
        assert.equal(editor.area.assignments, 1, 'no programmatic replacement of text');
        assert.deepEqual(editor.area.commands, mode === 'unfocused' ? []
            : [shiftKey ? ['delete', 0, 4, ''] : ['insertText', 4, 6, '\t']]);
        assert.deepEqual([editor.area.selectionStart, editor.area.selectionEnd],
            changed ? [shiftKey ? 0 : 5, shiftKey ? 0 : 5] : [4, 6]);
        if (!changed) assert.equal(editor.area.selectionDirection, 'backward');
    });
}

for (const toggles of [1, 2]) {
    test(`delayed upgrade preserves ${toggles} explicit Tab-navigation toggles without edits`, async () => {
        let resolve, mounts = 0, changes = 0;
        const loaded = new Promise(r => { resolve = r; });
        const factory = new Function('CodeEditor', 'ensureMonaco', 'mountMonaco',
            `${factoryBody}\nreturn factory;`)(Editor, () => loaded, () => { mounts++; });
        const editor = factory({ value: 'AB', literalInput: true, onChange: () => { changes++; } });
        for (let i = 0; i < toggles; i++) editor.handleKey({ key: 'm', ctrlKey: true, preventDefault() {} });
        resolve({});
        await loaded;
        assert.equal(mounts, 0);
        assert.equal(editor._tabFocus, toggles === 1);
        assert.equal(editor.getValue(), 'AB');
        assert.equal(changes, 0);
    });
}

// Captured by executing Swing's VariableListHandler/VariableTransferable at
// OIE 3bcba0b9087ebf3780067dbbd8a29d5bfe62011d. Retain exact transferred text:
// some entries are statements or XML fragments, not standalone expressions.
// Message Hash is outside the existing web list; Swing omits Count in JS mode.
const swingJavaScriptMappings = [
    ['Channel ID', "$('Channel ID')"],
    ['Channel Name', "$('Channel Name')"],
    ['Message ID', 'connectorMessage.getMessageId()'],
    ['Raw Data', 'connectorMessage.getRawData()'],
    ['Transformed Data', 'connectorMessage.getTransformedData()'],
    ['Encoded Data', 'connectorMessage.getEncodedData()'],
    ['Message Source', "$('mirth_source')"],
    ['Message Type', "$('mirth_type')"],
    ['Message Version', "$('mirth_version')"],
    ['Date', "var date = DateUtil.getDate('pattern','date');"],
    ['Formatted Date', "var dateString = DateUtil.getCurrentDate('yyyy-M-d H.m.s');"],
    ['Timestamp', "var dateString = DateUtil.getCurrentDate('yyyyMMddHHmmss');"],
    ['Unique ID', 'var uuid = UUIDGenerator.getUUID();'],
    ['Original File Name', "$('originalFilename')"],
    ['XML Entity Encoder', "var encodedMessage = XmlUtil.encode('message');"],
    ['XML Pretty Printer', "var prettyPrintedMessage = XmlUtil.prettyPrint('message');"],
    ['Escape JSON String', "var escapedJSONString = JsonUtil.escape('message');"],
    ['JSON Pretty Printer', "var prettyPrintedMessage = JsonUtil.prettyPrint('message');"],
    ['CDATA Tag', '<![CDATA[]]>'],
    ['DICOM Message Raw Data', 'var rawData = DICOMUtil.getDICOMRawData(connectorMessage);']
];

for (const [name, className, useScript] of [
    ['JavaScript Writer', 'js.JavaScriptDispatcherProperties'],
    ['Database Writer with boolean mode', 'jdbc.DatabaseDispatcherProperties', true],
    ['Database Writer with serialized mode', 'jdbc.DatabaseDispatcherProperties', 'true']
]) {
    test(`${name} transfers the exact Swing JavaScript snippets`, () => {
        const mappings = destinationMappingsFor({
            '@class': `com.mirth.connect.connectors.${className}`,
            destinationConnectorProperties: {}, useScript
        });
        assert.deepEqual(mappings, swingJavaScriptMappings);
        assert.ok(!mappings.some(([label]) => label === 'Count'));
        assert.deepEqual(mappings.find(([label]) => label === 'CDATA Tag'), ['CDATA Tag', '<![CDATA[]]>']);
    });
}

test('SQL and template destinations retain the existing Velocity list', () => {
    for (const useScript of [false, 'false', undefined, null]) {
        assert.equal(destinationMappingsFor({
            '@class': 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties',
            destinationConnectorProperties: {}, useScript
        }), DESTINATION_MAPPINGS);
    }
    for (const className of ['http.HttpDispatcherProperties', 'file.FileDispatcherProperties', 'custom.DispatcherProperties']) {
        assert.equal(destinationMappingsFor({
            '@class': `com.mirth.connect.connectors.${className}`,
            destinationConnectorProperties: {}, useScript: true
        }), DESTINATION_MAPPINGS, 'a useScript property alone does not change the connector transfer mode');
    }
});

test('source, authentication, and incomplete properties have no destination mappings', () => {
    for (const properties of [
        undefined,
        null,
        {},
        { '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties' },
        { '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', destinationConnectorProperties: null },
        { '@class': 'com.mirth.connect.connectors.js.JavaScriptReceiverProperties', sourceConnectorProperties: {} },
        { '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', sourceConnectorProperties: {}, useScript: true },
        { '@class': 'com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties' }
    ]) {
        assert.deepEqual(destinationMappingsFor(properties), []);
    }
});

test('changing database transfer mode does not retain or mutate a previous context', () => {
    const properties = {
        '@class': 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties',
        destinationConnectorProperties: {}, useScript: false
    };
    assert.equal(destinationMappingsFor(properties), DESTINATION_MAPPINGS);
    properties.useScript = true;
    assert.deepEqual(destinationMappingsFor(properties), swingJavaScriptMappings);
    properties.useScript = false;
    assert.equal(destinationMappingsFor(properties), DESTINATION_MAPPINGS);
    assert.deepEqual(DESTINATION_MAPPINGS.find(([label]) => label === 'Count'), ['Count', '${COUNT}']);
});
