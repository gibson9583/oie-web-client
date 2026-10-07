import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Exercise the shipped factory with a delayed loader, without a browser/Monaco.
const source = readFileSync(new URL('./codeeditor.js', import.meta.url), 'utf8');
const factoryBody = source.slice(source.indexOf('let factory ='), source.indexOf('export function createCodeEditor'));
class Editor {
    area = new EventTarget();
    dispose() {}
}

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
