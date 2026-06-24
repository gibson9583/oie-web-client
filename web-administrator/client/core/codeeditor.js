/*
 * Lightweight code editor: textarea + synced line-number gutter, tab/indent
 * handling. Dependency-free so the administrator works air-gapped; views and
 * plugins can swap in a richer editor through the platform registry.
 */

import { h } from './ui.js';
import { icon } from './icons.js';

export class CodeEditor {
    /**
     * @param {object} opts { value, language ('javascript'|'xml'|'sql'|'text'),
     *                        readOnly, minHeight, onChange }
     */
    constructor(opts = {}) {
        this.opts = opts;
        this.gutter = h('div.ce-gutter', '1');
        this.area = h('textarea.ce-area', {
            spellcheck: 'false',
            readOnly: !!opts.readOnly,
            placeholder: opts.placeholder || ''
        });
        this.area.value = opts.value ?? '';
        this.el = h('div.ce', { style: opts.minHeight ? { minHeight: opts.minHeight } : null },
            this.gutter, this.area);

        this.area.addEventListener('input', () => {
            this.syncGutter();
            opts.onChange && opts.onChange(this.getValue());
        });
        this.area.addEventListener('scroll', () => {
            this.gutter.scrollTop = this.area.scrollTop;
        });
        this.area.addEventListener('keydown', (e) => this.handleKey(e));
        this.syncGutter();
    }

    handleKey(e) {
        if (e.key === 'Tab' && !this.opts.readOnly) {
            e.preventDefault();
            const { selectionStart: start, selectionEnd: end, value } = this.area;
            if (e.shiftKey) {
                // Outdent the current line.
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                if (value.startsWith('\t', lineStart)) {
                    this.area.value = value.slice(0, lineStart) + value.slice(lineStart + 1);
                    this.area.selectionStart = this.area.selectionEnd = Math.max(lineStart, start - 1);
                } else if (value.startsWith('    ', lineStart)) {
                    this.area.value = value.slice(0, lineStart) + value.slice(lineStart + 4);
                    this.area.selectionStart = this.area.selectionEnd = Math.max(lineStart, start - 4);
                }
            } else {
                this.area.value = value.slice(0, start) + '\t' + value.slice(end);
                this.area.selectionStart = this.area.selectionEnd = start + 1;
            }
            this.syncGutter();
            this.opts.onChange && this.opts.onChange(this.getValue());
        } else if (e.key === 'Enter' && !this.opts.readOnly) {
            // Keep the indentation of the previous line.
            const { selectionStart: start, value } = this.area;
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const indent = (value.slice(lineStart).match(/^[\t ]*/) || [''])[0];
            if (indent) {
                e.preventDefault();
                const end = this.area.selectionEnd;
                this.area.value = value.slice(0, start) + '\n' + indent + value.slice(end);
                this.area.selectionStart = this.area.selectionEnd = start + 1 + indent.length;
                this.syncGutter();
                this.opts.onChange && this.opts.onChange(this.getValue());
            }
        }
    }

    syncGutter() {
        const lines = this.area.value.split('\n').length;
        if (this._lines === lines) return;
        this._lines = lines;
        const parts = [];
        for (let i = 1; i <= lines; i++) parts.push(i);
        this.gutter.textContent = parts.join('\n');
    }

    getValue() { return this.area.value; }

    setValue(value) {
        this.area.value = value ?? '';
        this.syncGutter();
    }

    focus() { this.area.focus(); }

    // No-op for the baseline (its listeners are GC'd with the DOM); Monaco
    // overrides editor.dispose to release its model/listeners/timer.
    dispose() {}
}

/* Optional maximize toggle (opts.maximizable): a top-right button that expands the
 * editor to a fixed overlay over the shell content area (the nav rail + top bar
 * stay visible). Esc restores. Used where the editor IS the panel — connector code
 * fields (incl. JavaScript Writer) and the channel Scripts tab. Views that must
 * keep a side panel beside the editor (transformer/filter, code templates) instead
 * grow it via the .is-editor-max layout toggle, not this overlay.
 *
 * The button is a child of editor.el; mountMonaco re-appends it after wiping the
 * shell for the Monaco host, so it survives the in-place upgrade. */
function attachMaximize(editor) {
    const el = editor.el;
    const btn = h('button.ce-max-btn', { type: 'button', title: 'Maximize editor' }, icon('maximize'));
    let max = false;
    const onKey = (e) => { if (e.key === 'Escape' && max) { e.preventDefault(); e.stopPropagation(); set(false); } };
    function set(next) {
        if (next === max) return;
        max = next;
        el.classList.toggle('ce-maximized', max);
        btn.replaceChildren(icon(max ? 'minimize' : 'maximize'));
        btn.title = max ? 'Restore editor (Esc)' : 'Maximize editor';
        if (max) document.addEventListener('keydown', onKey, true);
        else document.removeEventListener('keydown', onKey, true);
        if (editor.monaco) editor.monaco.layout();   // automaticLayout also catches it
    }
    btn.addEventListener('click', () => set(!max));
    el.appendChild(btn);
    editor.__maxCleanup = () => document.removeEventListener('keydown', onKey, true);
    // Cover the air-gapped (no-Monaco) path; the Monaco path cleans up in its own
    // dispose record (which replaces editor.dispose on upgrade).
    const baseDispose = editor.dispose.bind(editor);
    editor.dispose = () => { editor.__maxCleanup(); baseDispose(); };
}

/**
 * Factory used across the app. The default creates the dependency-free
 * editor immediately and upgrades it in place to Monaco (locally served, with
 * Rhino-aware highlighting) when available — air-gapped installs simply keep
 * the baseline editor. Plugins may replace the factory entirely via
 * platform.setCodeEditorFactory().
 */
import { ensureMonaco, mountMonaco } from './monaco.js';

let factory = (opts = {}) => {
    const editor = new CodeEditor(opts);
    if (opts.maximizable) attachMaximize(editor);
    ensureMonaco().then((monaco) => {
        if (!monaco) return;
        try { mountMonaco(monaco, editor, opts); }
        catch (e) { console.warn('[codeeditor] Monaco upgrade failed:', e); }
    });
    return editor;
};

export function createCodeEditor(opts) { return factory(opts); }
export function setCodeEditorFactory(fn) { factory = fn; }
