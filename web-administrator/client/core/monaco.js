/*
 * Monaco editor integration (lazy, CDN-loaded, optional).
 *
 * The built-in textarea editor (codeeditor.js) is the guaranteed baseline —
 * it works air-gapped. When the Monaco CDN is reachable, every code editor
 * upgrades in place to a full Monaco instance with syntax highlighting tuned
 * for the engine's Rhino JavaScript:
 *   - syntax-only validation (Rhino/E4X idioms like importPackage() would
 *     trip semantic checks)
 *   - completion entries for the Mirth/OIE scope variables (msg, tmp,
 *     channelMap, logger, ...)
 *   - themes matching the app's light/dark palette, switched live
 */

import { getState, subscribe } from './store.js';
import { USER_API_DTS } from './userapi.generated.js';
import { formatScript } from './serialize.js';
import { getActiveCompletions, setActiveScope } from './script-completions.js';

const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
const LOAD_TIMEOUT_MS = 10000;

let loadPromise = null;

export function ensureMonaco() {
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS);
        const script = document.createElement('script');
        script.src = `${BASE}/vs/loader.js`;
        script.onerror = () => { clearTimeout(timeout); resolve(null); };
        script.onload = () => {
            try {
                window.require.config({ paths: { vs: `${BASE}/vs` } });
                // Cross-origin worker shim (standard Monaco CDN pattern).
                window.MonacoEnvironment = {
                    getWorkerUrl: () => URL.createObjectURL(new Blob([
                        `self.MonacoEnvironment={baseUrl:'${BASE}/'};importScripts('${BASE}/vs/base/worker/workerMain.js');`
                    ], { type: 'text/javascript' }))
                };
                window.require(['vs/editor/editor.main'],
                    () => { clearTimeout(timeout); setup(window.monaco); resolve(window.monaco); },
                    () => { clearTimeout(timeout); resolve(null); });
            } catch {
                clearTimeout(timeout);
                resolve(null);
            }
        };
        document.head.appendChild(script);
    });
    return loadPromise;
}

/* Reserved scope variables Rhino injects into every channel script. Offered as
   an always-available completion list (the util classes — ChannelUtil, DateUtil,
   … — come from the generated User API .d.ts instead, with full member info). */
const RHINO_GLOBALS = [
    ['msg', 'The inbound message (E4X XML / JSON object depending on data type)'],
    ['tmp', 'The outbound template message'],
    ['template', 'The raw template string'],
    ['message', 'Raw message string (preprocessor) / ImmutableMessage (postprocessor)'],
    ['connectorMessage', 'The current ImmutableConnectorMessage'],
    ['response', 'The Response (response transformer / postprocessor)'],
    ['sourceMap', 'Source map (read-only variable map)'],
    ['connectorMap', 'Connector-scoped variable map'],
    ['channelMap', 'Channel-scoped variable map'],
    ['globalChannelMap', 'Channel-scoped map persisted across messages'],
    ['globalMap', 'Server-wide variable map'],
    ['configurationMap', 'Configuration map (Settings → Configuration Map)'],
    ['responseMap', 'Response variable map'],
    ['logger', 'Log4j logger (logger.info/warn/error)'],
    ['router', 'VMRouter — router.routeMessage(channelName, message)'],
    ['alerts', 'AlertSender — alerts.sendAlert(message)'],
    ['replacer', 'TemplateValueReplacer'],
    ['destinationSet', 'DestinationSet — control which destinations process the message'],
    ['channelId', 'Current channel id'],
    ['channelName', 'Current channel name'],
    ['importPackage', 'Rhino: import a Java package, e.g. importPackage(java.util)'],
    ['validate', 'Transformer helper: validate(mapping, defaultValue, replacements)'],
    ['$', "Shorthand lookup across all maps: $('variable')"],
    ['$co', 'Connector map accessor'], ['$c', 'Channel map accessor'],
    ['$s', 'Source map accessor'], ['$gc', 'Global channel map accessor'],
    ['$g', 'Global map accessor'], ['$cfg', 'Configuration map accessor'],
    ['$r', 'Response map accessor']
];

/* Reserved scope variables get keyword-style coloring (like the Swing editor),
   applied as editor decorations since Monaco's JS tokenizer would otherwise
   treat them as plain identifiers. Custom boundaries ([\w$]) so the $-accessors
   ($, $co, $gc, …) match exactly. Longest-first so $co wins over $. */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RESERVED_NAMES = RHINO_GLOBALS.map(([n]) => n).sort((a, b) => b.length - a.length);
const RESERVED_RE = new RegExp(`(?<![\\w$])(?:${RESERVED_NAMES.map(escapeRe).join('|')})(?![\\w$])`, 'g');
// Don't color a match that falls inside a string/comment/regexp literal.
const TOKEN_SKIP = /string|comment|regexp/;

function tokenTypeAt(tokens, column) {
    let type = '';
    for (const t of tokens) { if (t.offset <= column) type = t.type; else break; }
    return type;
}

/* Recolor reserved-variable occurrences in a javascript model. Only the lines in
   [fromLine, toLine] are re-scanned and re-decorated (defaults to the whole model
   on the initial paint); on a keystroke that range is just the edited lines, so
   typing stays cheap on large scripts. Tokenization still runs from the document
   start through `toLine` so multi-line comment / template-literal state is correct
   for the scanned lines (monaco.editor.tokenize carries state line to line). */
function highlightReservedVars(monaco, instance, fromLine, toLine) {
    const model = instance.getModel();
    if (!model || model.getLanguageId() !== 'javascript') return;
    const total = model.getLineCount();
    const a = Math.max(1, fromLine || 1);
    const b = Math.min(total, toLine || total);
    if (a > b) return;

    const head = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: b, endColumn: model.getLineMaxColumn(b) });
    const lineTokens = monaco.editor.tokenize(head, 'javascript');
    const decorations = [];
    for (let ln = a; ln <= b; ln++) {
        const text = model.getLineContent(ln);
        if (!text) continue;
        const tokens = lineTokens[ln - 1] || [];
        RESERVED_RE.lastIndex = 0;
        let m;
        while ((m = RESERVED_RE.exec(text)) !== null) {
            if (TOKEN_SKIP.test(tokenTypeAt(tokens, m.index))) continue;
            decorations.push({
                range: new monaco.Range(ln, m.index + 1, ln, m.index + 1 + m[0].length),
                options: { inlineClassName: 'rhino-global' }
            });
        }
    }
    // Replace only this range's existing reserved-var decorations; the rest (and
    // their auto-shifted positions on insert/delete) are left untouched.
    const oldIds = model.getLinesDecorations(a, b)
        .filter((d) => d.options && d.options.inlineClassName === 'rhino-global')
        .map((d) => d.id);
    instance.deltaDecorations(oldIds, decorations);
}

function setup(monaco) {
    // Mirth scripts run in Rhino (E4X XML literals, Java interop) — Monaco's TS
    // parser would false-flag valid Rhino syntax, so disable its diagnostics and
    // let the engine's Rhino compile (core/serialize.js validateScript) be the
    // authoritative linter. The generated User API declarations still drive
    // completion / signature help / hover docs (the language service provides
    // those regardless of the diagnostic flags).
    try {
        const jsDefaults = monaco.languages.typescript.javascriptDefaults;
        jsDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
        jsDefaults.addExtraLib(USER_API_DTS, 'ts:mirth-userapi.d.ts');
        // The TS formatter reflows E4X XML literals as if they were JSX
        // (e.g. <p/> → <p />), corrupting valid Rhino code — and the engine
        // doesn't auto-format scripts anyway. Turn the formatter off (Format
        // Document becomes a no-op) while keeping completion/hover/signature.
        jsDefaults.setModeConfiguration({
            completionItems: true, hovers: true, documentSymbols: true, definitions: true,
            references: true, documentHighlights: true, rename: true, diagnostics: true,
            signatureHelp: true, codeActions: true, inlayHints: true,
            documentFormattingEdits: false, documentRangeFormattingEdits: false, onTypeFormattingEdits: false,
        });
    } catch { /* typescript service unavailable — highlighting still works */ }

    // Reserved-variable coloring — keyword-blue per theme (vs / vs-dark are the
    // base classes Monaco puts on the editor for our oie-light / oie-dark themes).
    if (!document.getElementById('oie-rhino-global-style')) {
        const style = document.createElement('style');
        style.id = 'oie-rhino-global-style';
        style.textContent =
            '.monaco-editor.vs .rhino-global{color:#0000ff !important}' +
            '.monaco-editor.vs-dark .rhino-global{color:#569cd6 !important}';
        document.head.appendChild(style);
    }

    // Format Document → the engine's own Rhino/E4X-safe pretty-printer
    // (JavaScriptSharedUtil.prettyPrint via the serializer bridge), the same one
    // Swing's Format Code uses. No-op when the bridge (OIE_HOME) isn't configured.
    monaco.languages.registerDocumentFormattingEditProvider('javascript', {
        async provideDocumentFormattingEdits(model) {
            const formatted = await formatScript(model.getValue());
            if (formatted == null || formatted === model.getValue()) return [];
            return [{ range: model.getFullModelRange(), text: formatted }];
        }
    });

    // Reserved scope variables — always offered (the curated list authors expect).
    monaco.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems(model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn: word.startColumn, endColumn: word.endColumn
            };
            const suggestions = RHINO_GLOBALS.map(([name, doc]) => ({
                label: name,
                kind: monaco.languages.CompletionItemKind.Variable,
                documentation: doc,
                insertText: name,
                range
            }));
            // Channel + context scoped code-template functions (the user's own).
            for (const t of getActiveCompletions()) {
                const args = t.params.map((p, i) => `\${${i + 1}:${p}}`).join(', ');
                suggestions.push({
                    label: t.params.length ? `${t.name}(${t.params.join(', ')})` : `${t.name}()`,
                    filterText: t.name,
                    kind: monaco.languages.CompletionItemKind.Function,
                    detail: t.library ? `Code template · ${t.library}` : 'Code template',
                    documentation: t.doc || undefined,
                    insertText: `${t.name}(${args})`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range
                });
            }
            return { suggestions };
        }
    });

    monaco.editor.defineTheme('oie-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#0c1116',
            'editorGutter.background': '#111922',
            'editorLineNumber.foreground': '#5c6b7a',
            'editor.lineHighlightBackground': '#16212c',
            'editor.selectionBackground': '#2f425466'
        }
    });
    monaco.editor.defineTheme('oie-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
            'editor.background': '#ffffff',
            'editorGutter.background': '#f3f6f9',
            'editorLineNumber.foreground': '#7d8fa0',
            'editor.lineHighlightBackground': '#eef3f8'
        }
    });

    const applyTheme = (theme) => monaco.editor.setTheme(theme === 'light' ? 'oie-light' : 'oie-dark');
    applyTheme(getState('theme'));
    subscribe('theme', applyTheme);
}

const LANGUAGES = {
    javascript: 'javascript', js: 'javascript', rhino: 'javascript',
    xml: 'xml', html: 'html', json: 'json', sql: 'sql', text: 'plaintext'
};

/* Monaco editors hold a model, listeners, layout observer and a debounce timer
   that DOM removal alone doesn't free. We track live instances and, on each
   route change, dispose any whose host element has left the document — i.e. the
   editors of the view being navigated away from. (Only route changes are safe:
   a view may legitimately detach/re-attach a live editor between tabs, so we
   never sweep mid-view.) */
const liveMonaco = new Set();   // { el, dispose }

function disposeDetachedMonaco() {
    for (const rec of [...liveMonaco]) {
        if (!document.contains(rec.el)) rec.dispose();
    }
}

let routeSweepHooked = false;
function hookRouteSweep() {
    if (routeSweepHooked || typeof window === 'undefined') return;
    routeSweepHooked = true;
    window.addEventListener('route:changed', disposeDetachedMonaco);
}

/*
 * Upgrade a built-in CodeEditor instance to Monaco in place: same root
 * element, same {getValue, setValue, focus} contract, same onChange.
 */
export function mountMonaco(monaco, editor, opts = {}) {
    if (!editor.el || !editor.el.classList || editor.monaco) return;
    const value = editor.getValue();

    const host = document.createElement('div');
    host.className = 'monaco-host';
    editor.el.classList.add('ce-monaco');
    editor.el.textContent = '';
    editor.el.appendChild(host);

    const instance = monaco.editor.create(host, {
        value,
        language: LANGUAGES[opts.language || 'javascript'] || 'plaintext',
        readOnly: !!opts.readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: "'IBM Plex Mono', 'SF Mono', 'Consolas', monospace",
        tabSize: 4,
        insertSpaces: false,
        folding: true,
        renderLineHighlight: 'line',
        fixedOverflowWidgets: true,
        // Monaco's native drop-into-editor inserts dropped text as a *snippet*
        // (escaping ${...} to \${...\} and appending a $0 tab stop). We insert
        // velocity/accessor tokens as plain text ourselves, so disable it.
        dropIntoEditor: { enabled: false },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    });

    // Re-highlight only the lines an edit touched (debounced), not the whole doc.
    let hlTimer = null, hlFrom = Infinity, hlTo = 0;
    const scheduleHighlight = (changes) => {
        for (const c of (changes || [])) {
            const start = c.range.startLineNumber;
            const added = (c.text.match(/\n/g) || []).length;   // lines the new text spans
            if (start < hlFrom) hlFrom = start;
            if (start + added > hlTo) hlTo = start + added;
        }
        if (hlTimer) clearTimeout(hlTimer);
        hlTimer = setTimeout(() => {
            highlightReservedVars(monaco, instance, hlFrom, hlTo);
            hlFrom = Infinity; hlTo = 0;
        }, 120);
    };

    const changeSub = instance.onDidChangeModelContent((e) => {
        opts.onChange && opts.onChange(instance.getValue());
        scheduleHighlight(e.changes);
    });
    highlightReservedVars(monaco, instance);   // initial paint (whole document)

    // Code-template completions are channel + context scoped: when this editor
    // gains focus, make its scope active so the completion provider offers the
    // right templates. opts.scriptScope = { channelId, contexts: [contextType] }.
    let focusSub = null;
    if (opts.scriptScope && opts.scriptScope.channelId) {
        focusSub = instance.onDidFocusEditorText(() => {
            setActiveScope(opts.scriptScope.channelId, opts.scriptScope.contexts || []);
        });
    }

    // Release the model, listeners, layout observer and timer. Idempotent. Called
    // explicitly from a view teardown, or automatically by the detached-sweep.
    let disposed = false;
    const record = { el: editor.el, dispose: () => {} };
    record.dispose = () => {
        if (disposed) return;
        disposed = true;
        if (hlTimer) clearTimeout(hlTimer);
        changeSub.dispose();
        if (focusSub) focusSub.dispose();
        const model = instance.getModel();
        instance.dispose();
        if (model) model.dispose();
        liveMonaco.delete(record);
    };
    liveMonaco.add(record);
    hookRouteSweep();

    editor.monaco = instance;
    editor.getValue = () => instance.getValue();
    editor.setValue = (v) => instance.setValue(v ?? '');
    editor.focus = () => instance.focus();
    editor.dispose = record.dispose;
}
