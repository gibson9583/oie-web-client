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

/* Scope variables and helper classes available to Rhino scripts in the engine. */
const RHINO_GLOBALS = [
    ['msg', 'The inbound message (E4X XML / JSON object depending on data type)'],
    ['tmp', 'The outbound template message'],
    ['message', 'Raw message string (preprocessor) / ImmutableMessage (postprocessor)'],
    ['connectorMessage', 'The current ImmutableConnectorMessage'],
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
    ['ChannelUtil', 'Channel control/lookup utilities'],
    ['DateUtil', 'Date parsing/formatting utilities'],
    ['SerializerFactory', 'Data type serializers (HL7 ↔ XML, ...)'],
    ['AttachmentUtil', 'Message attachment utilities'],
    ['XmlUtil', 'XML escaping/pretty-print utilities'],
    ['JsonUtil', 'JSON escaping/pretty-print utilities'],
    ['DICOMUtil', 'DICOM helper utilities'],
    ['FileUtil', 'File read/write utilities'],
    ['importPackage', 'Rhino: import a Java package, e.g. importPackage(java.util)'],
    ['validate', 'Transformer helper: validate(mapping, defaultValue, replacements)'],
    ['$', "Shorthand lookup across all maps: $('variable')"],
    ['$co', 'Connector map accessor'], ['$c', 'Channel map accessor'],
    ['$s', 'Source map accessor'], ['$gc', 'Global channel map accessor'],
    ['$g', 'Global map accessor'], ['$cfg', 'Configuration map accessor'],
    ['$r', 'Response map accessor']
];

function setup(monaco) {
    // Rhino is ES5-era with engine-injected globals — keep syntax checking,
    // drop semantic validation.
    try {
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: true,
            noSyntaxValidation: false
        });
    } catch { /* typescript service unavailable — highlighting still works */ }

    monaco.languages.registerCompletionItemProvider('javascript', {
        provideCompletionItems(model, position) {
            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn: word.startColumn, endColumn: word.endColumn
            };
            return {
                suggestions: RHINO_GLOBALS.map(([name, doc]) => ({
                    label: name,
                    kind: monaco.languages.CompletionItemKind.Variable,
                    documentation: doc,
                    insertText: name,
                    range
                }))
            };
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

    instance.onDidChangeModelContent(() => {
        opts.onChange && opts.onChange(instance.getValue());
    });

    editor.monaco = instance;
    editor.getValue = () => instance.getValue();
    editor.setValue = (v) => instance.setValue(v ?? '');
    editor.focus = () => instance.focus();
}
