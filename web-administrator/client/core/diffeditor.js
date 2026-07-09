/*
 * Read-only side-by-side diff viewer, backed by the host's SINGLE Monaco
 * instance — the same one the code editor upgrades to (core/monaco.js). Exposed
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

import { ensureMonaco } from './monaco.js';

export function createDiffEditor(opts = {}) {
    const el = document.createElement('div');
    el.className = 'diff-editor';
    el.style.cssText = 'width:100%; height:100%; min-height:0; position:relative';

    let monacoRef = null;
    let editor = null;         // the Monaco diff editor, once mounted
    let models = null;         // { original, modified } Monaco models to dispose
    let fallbackEl = null;     // plain two-pane view when Monaco is absent
    let disposed = false;
    // Latest requested content; applied when Monaco finishes loading.
    let current = {
        original: opts.original || '',
        modified: opts.modified || '',
        language: opts.language || 'xml'
    };
    const renderSideBySide = opts.renderSideBySide !== false;

    function disposeModels() {
        if (models) {
            try { models.original.dispose(); } catch { /* already gone */ }
            try { models.modified.dispose(); } catch { /* already gone */ }
            models = null;
        }
    }

    function applyMonaco() {
        if (disposed || !monacoRef) return;
        disposeModels();
        const original = monacoRef.editor.createModel(current.original, current.language);
        const modified = monacoRef.editor.createModel(current.modified, current.language);
        models = { original, modified };
        editor.setModel({ original, modified });
    }

    function renderFallback() {
        if (disposed) return;
        if (!fallbackEl) {
            fallbackEl = document.createElement('div');
            fallbackEl.style.cssText = 'display:flex; gap:1px; width:100%; height:100%; background:var(--line)';
            el.appendChild(fallbackEl);
        }
        const pane = (text) => {
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
            lineNumbers: 'on'
        });
        applyMonaco();
    }).catch(() => renderFallback());

    return {
        el,
        setModels(next = {}) {
            current = {
                original: next.original != null ? next.original : current.original,
                modified: next.modified != null ? next.modified : current.modified,
                language: next.language || current.language
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
