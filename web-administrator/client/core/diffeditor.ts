/*
 * Read-only side-by-side diff viewer, backed by the host's SINGLE Monaco
 * instance — the same one the code editor upgrades to (core/monaco.ts). Exposed
 * to plugins as `platform.createDiffEditor` so a plugin can show a rich diff
 * (side-by-side, inline word-level highlighting, syntax colors) without bundling
 * its own copy of Monaco.
 *
 * The factory returns immediately with a detached container element; Monaco
 * mounts into it asynchronously once loaded. If Monaco is unavailable (e.g. an
 * air-gapped load failure — ensureMonaco resolves null), it degrades to a plain
 * two-column read-only text view instead of crashing, so callers never have to
 * branch on Monaco's presence.
 *
 *   const diff = createDiffEditor({ original, modified, language: 'xml' });
 *   container.appendChild(diff.el);
 *   diff.setModels({ original, modified, language });   // swap content later
 *   diff.layout();                                      // after a resize
 *   diff.dispose();                                     // frees Monaco models
 */

import type * as MonacoNs from 'monaco-editor';
import { ensureMonaco, monacoFontFamily } from './monaco.js';

export interface DiffEditorOptions {
    original?: string;
    modified?: string;
    language?: string;
    /** Per-side overrides — the two panes need not be the same language (an HL7
        message against the XML it was transformed into). Default: `language`. */
    originalLanguage?: string;
    modifiedLanguage?: string;
    /** false = unified/inline view; default side-by-side. */
    renderSideBySide?: boolean;
}

export interface DiffEditorHandle {
    el: HTMLDivElement;
    setModels(next?: {
        original?: string | null;
        modified?: string | null;
        language?: string | null;
        originalLanguage?: string | null;
        modifiedLanguage?: string | null;
    }): void;
    layout(): void;
    dispose(): void;
}

export function createDiffEditor(opts: DiffEditorOptions = {}): DiffEditorHandle {
    const el = document.createElement('div');
    el.className = 'diff-editor';
    el.style.cssText = 'width:100%; height:100%; min-height:0; position:relative';

    let monacoRef: typeof MonacoNs | null = null;
    let editor: MonacoNs.editor.IStandaloneDiffEditor | null = null;   // the Monaco diff editor, once mounted
    let models: { original: MonacoNs.editor.ITextModel; modified: MonacoNs.editor.ITextModel } | null = null;
    let fallbackEl: HTMLDivElement | null = null;     // plain two-pane view when Monaco is absent
    let disposed = false;
    // Latest requested content; applied when Monaco finishes loading.
    let current = {
        original: opts.original || '',
        modified: opts.modified || '',
        language: opts.language || 'xml',
        originalLanguage: opts.originalLanguage || opts.language || 'xml',
        modifiedLanguage: opts.modifiedLanguage || opts.language || 'xml'
    };
    const renderSideBySide = opts.renderSideBySide !== false;

    function disposeModels(): void {
        if (models) {
            try { models.original.dispose(); } catch { /* already gone */ }
            try { models.modified.dispose(); } catch { /* already gone */ }
            models = null;
        }
    }

    function applyMonaco(): void {
        if (disposed || !monacoRef || !editor) return;
        disposeModels();
        const original = monacoRef.editor.createModel(current.original, current.originalLanguage);
        const modified = monacoRef.editor.createModel(current.modified, current.modifiedLanguage);
        models = { original, modified };
        editor.setModel({ original, modified });
    }

    function renderFallback(): void {
        if (disposed) return;
        if (!fallbackEl) {
            fallbackEl = document.createElement('div');
            fallbackEl.style.cssText = 'display:flex; gap:1px; width:100%; height:100%; background:var(--line)';
            el.appendChild(fallbackEl);
        }
        const pane = (text: string) => {
            const pre = document.createElement('pre');
            pre.className = 'mono';
            pre.style.cssText = 'flex:1 1 50%; min-width:0; margin:0; padding:8px; overflow:auto; '
                + 'white-space:pre; background:var(--bg); font-size:12px; line-height:1.4';
            pre.textContent = text;
            return pre;
        };
        fallbackEl.replaceChildren(pane(current.original), pane(current.modified));
    }

    ensureMonaco().then((monaco) => {
        if (disposed) return;
        if (!monaco) { renderFallback(); return; }
        monacoRef = monaco;
        editor = monaco.editor.createDiffEditor(el, {
            readOnly: true,
            originalEditable: false,
            automaticLayout: true,
            renderSideBySide,
            // Keep the two panes side-by-side even in a narrow container — Monaco
            // otherwise collapses to a single inline/unified view below ~900px
            // (renderSideBySideInlineBreakpoint) or when space is limited, which is
            // NOT the Swing look (Old | New panels). Force true side-by-side.
            renderSideBySideInlineBreakpoint: 0,
            useInlineViewWhenSpaceIsLimited: false,
            enableSplitViewResizing: true,
            ignoreTrimWhitespace: false,
            renderOverviewRuler: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 12,
            fontFamily: monacoFontFamily(),
            fontLigatures: false,   // literal ->, != in payload diffs, as everywhere
            lineNumbers: 'on'
        });
        applyMonaco();
    }).catch(() => renderFallback());

    return {
        el,
        setModels(next = {}) {
            const language = next.language || current.language;
            current = {
                original: next.original != null ? next.original : current.original,
                modified: next.modified != null ? next.modified : current.modified,
                language,
                // A new `language` re-bases both sides unless the caller overrode
                // one; without that, swapping the panes would leave the old
                // per-side languages behind.
                originalLanguage: next.originalLanguage || (next.language ? language : current.originalLanguage),
                modifiedLanguage: next.modifiedLanguage || (next.language ? language : current.modifiedLanguage)
            };
            if (monacoRef) applyMonaco();
            else if (fallbackEl) renderFallback();
        },
        layout() { if (editor) { try { editor.layout(); } catch { /* detached */ } } },
        dispose() {
            disposed = true;
            disposeModels();
            if (editor) { try { editor.dispose(); } catch { /* already gone */ } editor = null; }
        }
    };
}
