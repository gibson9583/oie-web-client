/*
 * Lightweight code editor: textarea + synced line-number gutter, tab/indent
 * handling. Dependency-free so the administrator works air-gapped; views and
 * plugins can swap in a richer editor through the platform registry.
 */

import { h } from './ui.js';
import { icon } from './icons.js';
import type * as MonacoNs from 'monaco-editor';

export interface CodeEditorOptions {
    value?: string;
    /** 'javascript' | 'xml' | 'sql' | 'text' | ... */
    language?: string;
    readOnly?: boolean;
    minHeight?: string;
    placeholder?: string;
    onChange?(value: string): void;
    /** Corner toggle opening the full-screen code view. */
    maximizable?: boolean;
    popoutable?: boolean;
    popoutTitle?: string;
    /** [[label, insertText]] variables rail in the code view. */
    popoutVars?: Array<[string, string]>;
    [extra: string]: any;
}

export class CodeEditor {
    opts: CodeEditorOptions;
    gutter: HTMLElement;
    area: HTMLTextAreaElement;
    el: HTMLElement;
    /** Set by mountMonaco when the in-place upgrade lands. */
    monaco?: MonacoNs.editor.IStandaloneCodeEditor;
    __maxCleanup?: () => void;
    _lines?: number;
    constructor(opts: CodeEditorOptions = {}) {
        this.opts = opts;
        this.gutter = h('div.ce-gutter', '1');
        this.area = h('textarea.ce-area', {
            spellcheck: 'false',
            readOnly: !!opts.readOnly,
            placeholder: opts.placeholder || ''
        }) as HTMLTextAreaElement;
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
        this.area.addEventListener('keydown', (e: KeyboardEvent) => this.handleKey(e));
        this.syncGutter();
    }

    handleKey(e: KeyboardEvent): void {
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

    syncGutter(): void {
        const lines = this.area.value.split('\n').length;
        if (this._lines === lines) return;
        this._lines = lines;
        const parts: number[] = [];
        for (let i = 1; i <= lines; i++) parts.push(i);
        this.gutter.textContent = parts.join('\n');
    }

    getValue(): string { return this.area.value; }

    setValue(value: string | null | undefined): void {
        this.area.value = value ?? '';
        this.syncGutter();
    }

    focus(): void { this.area.focus(); }

    // No-op for the baseline (its listeners are GC'd with the DOM); Monaco
    // overrides editor.dispose to release its model/listeners/timer.
    dispose(): void {}
}

/* Insert text into an editor at the cursor — Monaco when upgraded, else the
 * baseline textarea. Used by the code-view variables rail. */
function insertAtCursor(editor: { monaco?: MonacoNs.editor.IStandaloneCodeEditor; area?: HTMLTextAreaElement }, text: string): void {
    if (editor.monaco) {
        const inst = editor.monaco;
        const pos = inst.getPosition()!;
        const Range = (window as any).monaco.Range;
        inst.executeEdits('code-view-var', [{
            range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text, forceMoveMarkers: true
        }]);
        inst.focus();
        return;
    }
    const area = editor.area;
    if (!area) return;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    area.value = area.value.slice(0, start) + text + area.value.slice(end);
    area.selectionStart = area.selectionEnd = start + text.length;
    area.dispatchEvent(new Event('input', { bubbles: true }));
    area.focus();
}

/* Optional code-view toggle (opts.maximizable or opts.popoutable), top-right of
 * the editor: a dedicated full-screen writing surface appended to document.body.
 * It covers the whole viewport with a header (obvious "Back" button + title,
 * opts.popoutTitle) and, when opts.popoutVars ([[label, insertText]]) is provided
 * and the editor is editable, a variables reference rail on the right — click
 * inserts at the cursor; drag inserts at the drop point (Monaco's native drop is
 * bypassed, since it snippet-escapes ${...}). The editor element itself is
 * REPARENTED into the overlay and restored on close, so Monaco state (undo stack,
 * cursor, unsaved text) survives. Esc or Back returns to the form.
 *
 * The corner button is a child of editor.el; mountMonaco re-appends it after
 * wiping the shell for the Monaco host, so it survives the in-place upgrade. */
function attachCodeView(editor: CodeEditor, opts: CodeEditorOptions): void {
    const el = editor.el;
    let open = false;
    let overlay: HTMLElement | null = null;
    let placeholder: Comment | null = null;
    let dragToken: string | null = null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); set(false); } };

    const popBtn = h('button.ce-max-btn.ce-pop-btn', { type: 'button', title: 'Open code view' }, icon('popout'));

    function insertAtDrop(e: DragEvent, token: string): void {
        if (editor.monaco) {
            const inst = editor.monaco;
            let pos = inst.getPosition()!;
            if (inst.getTargetAtClientPoint) {
                const tgt = inst.getTargetAtClientPoint(e.clientX, e.clientY);
                if (tgt && tgt.position) pos = tgt.position;
            }
            const Range = (window as any).monaco.Range;
            inst.executeEdits('code-view-var', [{
                range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: token, forceMoveMarkers: true
            }]);
            inst.focus();
            return;
        }
        insertAtCursor(editor, token);
    }

    function buildVarsRail(): HTMLElement | null {
        const vars = opts.popoutVars;
        if (!Array.isArray(vars) || vars.length === 0 || opts.readOnly) return null;
        const list = h('div.ce-popout-vars-list');
        for (const [label, token] of vars) {
            list.appendChild(h('div.ce-popout-var', {
                title: token,
                draggable: 'true',
                onClick: () => insertAtCursor(editor, token),
                onDragstart: (e: DragEvent) => {
                    dragToken = token;
                    e.dataTransfer!.effectAllowed = 'copy';
                    e.dataTransfer!.setData('text/plain', token);
                },
                onDragend: () => { dragToken = null; }
            }, label));
        }
        return h('div.ce-popout-vars',
            h('div.ce-popout-vars-head', 'Variables'),
            list,
            h('div.ce-popout-vars-hint', 'Click or drag to insert.'));
    }

    // Drag insertion. Monaco swallows/escapes native text drops, so the overlay
    // intercepts the drop over the editor and inserts the token itself.
    function onOverlayDragOver(e: DragEvent): void {
        const carrying = dragToken
            || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/plain'));
        if (!carrying) return;
        if (el.contains(e.target as Node)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }
    }
    function onOverlayDrop(e: DragEvent): void {
        const token = dragToken || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
        dragToken = null;
        if (!token || !el.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopPropagation();
        insertAtDrop(e, token);
    }

    function openCodeView(): void {
        const origin = el.parentNode;
        placeholder = document.createComment('ce-code-view');
        el.parentNode!.insertBefore(placeholder, el);
        const slot = h('div.ce-popout-slot');
        slot.appendChild(el);
        el.classList.add('ce-popout');
        const body = h('div.ce-popout-body', slot);
        const rail = buildVarsRail();
        if (rail) body.appendChild(rail);
        overlay = h('div.ce-popout-overlay',
            h('div.ce-popout-head',
                h('button.btn', { type: 'button', onClick: () => set(false) }, icon('chevL'), 'Back'),
                h('div.ce-popout-title', String(opts.popoutTitle || 'Code editor')),
                h('div.ce-popout-esc', 'Esc closes')),
            body);
        // Capture-phase so the insert wins over Monaco's own dnd handling.
        overlay.addEventListener('dragover', onOverlayDragOver, true);
        overlay.addEventListener('drop', onOverlayDrop, true);
        document.body.appendChild(overlay);
        // Host views can react (e.g. the transformer editor moves its full
        // Reference / Message Templates / Message Trees panel into the view).
        // `origin` is where the editor came from, since el itself has moved.
        document.dispatchEvent(new CustomEvent('oie:code-view', {
            detail: { open: true, overlay, body, editorEl: el, origin }
        }));
        if (editor.monaco) editor.monaco.layout();
        editor.focus && editor.focus();
    }

    function closeCodeView(): void {
        document.dispatchEvent(new CustomEvent('oie:code-view', { detail: { open: false, editorEl: el } }));
        el.classList.remove('ce-popout');
        if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(el, placeholder);
            placeholder.remove();
        }
        placeholder = null;
        if (overlay) overlay.remove();
        overlay = null;
        if (editor.monaco) editor.monaco.layout();
    }

    function set(next: boolean): void {
        if (next === open) return;
        open = next;
        popBtn.replaceChildren(icon(open ? 'minimize' : 'popout'));
        popBtn.title = open ? 'Close code view (Esc)' : 'Open code view';
        if (open) {
            openCodeView();
            document.addEventListener('keydown', onKey, true);
        } else {
            closeCodeView();
            document.removeEventListener('keydown', onKey, true);
        }
        if (editor.monaco) editor.monaco.layout();   // automaticLayout also catches it
    }
    popBtn.addEventListener('click', () => set(!open));
    el.appendChild(popBtn);
    editor.__maxCleanup = () => {
        document.removeEventListener('keydown', onKey, true);
        if (open) { open = false; closeCodeView(); }
    };
    // Cover the air-gapped (no-Monaco) path; the Monaco path cleans up in its own
    // dispose record (which replaces editor.dispose on upgrade).
    const baseDispose = editor.dispose.bind(editor);
    editor.dispose = () => { editor.__maxCleanup!(); baseDispose(); };
}

/**
 * Factory used across the app. The default creates the dependency-free
 * editor immediately and upgrades it in place to Monaco (locally served, with
 * Rhino-aware highlighting) when available — air-gapped installs simply keep
 * the baseline editor. Plugins may replace the factory entirely via
 * platform.setCodeEditorFactory().
 */
import { ensureMonaco, mountMonaco } from './monaco.js';

let factory: (opts?: CodeEditorOptions) => CodeEditor = (opts = {}) => {
    const editor = new CodeEditor(opts);
    if (opts.maximizable || opts.popoutable) attachCodeView(editor, opts);
    ensureMonaco().then((monaco) => {
        if (!monaco) return;
        try { mountMonaco(monaco, editor, opts); }
        catch (e) { console.warn('[codeeditor] Monaco upgrade failed:', e); }
    });
    return editor;
};

export function createCodeEditor(opts?: CodeEditorOptions): CodeEditor { return factory(opts); }
export function setCodeEditorFactory(fn: (opts?: CodeEditorOptions) => CodeEditor): void { factory = fn; }
