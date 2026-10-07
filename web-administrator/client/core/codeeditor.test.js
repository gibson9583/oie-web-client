import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Exercise the shipped editor and factory with a delayed loader, without a browser/Monaco.
const source = readFileSync(new URL('./codeeditor.js', import.meta.url), 'utf8');
const factoryBody = source.slice(source.indexOf('let factory ='), source.indexOf('export function createCodeEditor'));
class Element extends EventTarget {
    selectionStart = 0;
    selectionEnd = 0;
    _value = '';
    // Match the textarea API's display normalization; keep raw templates in the caller.
    set value(value) { this._value = String(value).replace(/\r\n?/g, '\n'); }
    get value() { return this._value; }
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
    ['literal Tab', 'AB', false, 1, 1, 'A\tB'],
    ['Tab replacing multiple lines', 'AB\nCD', false, 1, 4, 'A\tD'],
    ['Shift+Tab removing a tab', '\tAB', true, 1, 1, 'AB'],
    ['Shift+Tab removing spaces', '    AB', true, 4, 4, 'AB'],
    ['ordinary script Tab', 'AB', false, 1, 1, 'A\tB', false]
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
        assert.equal(changes, changed ? 1 : 0);
        assert.equal(rawTemplate, changed ? expected : value);
        assert.equal(editor.gutter.textContent, expected.includes('\n') ? '1\n2' : '1');
        resolve({});
        await loaded;
        assert.equal(mounts, changed && literalInput ? 0 : 1);
    });
}
