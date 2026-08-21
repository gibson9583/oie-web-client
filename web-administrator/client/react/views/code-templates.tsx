/*
 * Code Templates view — fully declarative React. The library/template tree is
 * the controlled <TreeTable>; the editor pane branches on the selection into
 * the <LibraryEditor> (name/include-new + description + channel checkbox list)
 * or the template editor (<TemplateForm> + <CodeEditor> island + the
 * <ContextPanel> checkbox tree).
 *
 * The libraries/templates are an EDIT-SESSION MODEL: the objects are mutated in
 * place (their identity is what saveAll sends, with the engine's round-trip
 * fields preserved) and markDirty() bumps the container identity so React
 * repaints. Two documented refs bridge mount-captured contracts: dirtyRef (the
 * navGuard/tab-close guards registered once) and entriesNowRef (save/import
 * mutations act on the latest-known list, never a render-stale snapshot).
 *
 * Saving mirrors Swing's CodeTemplatePanel: the full library set (with id-only
 * template references) and every full template go out TOGETHER in one engine
 * transaction (POST /codeTemplateLibraries/_bulkUpdate). The PUT-per-template
 * sequence this replaced left the library records pointing at templates that
 * had not been written whenever it failed partway through. The
 * script-completions cache is invalidate()d on every mutation so script editors
 * refetch the new scope.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast, confirmDialog, saveFile, pickFile, contextMenu, fmtDate } from '@oie/web-ui';
import { TreeTable, TreeLabel } from '../tree-table.jsx';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { validateScript } from '../../core/serialize.js';
import { invalidate as invalidateCompletions } from '../../core/script-completions.js';
import { ViewTasks } from '../mount.jsx';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { RailPane, TaskButton, CodeEditor } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { xmlToJson, templateFromXml } from './code-template-xml.js';


const CT_COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'id', label: 'Id' },
    { key: 'description', label: 'Description' },
    { key: 'revision', label: 'Revision', align: 'right' },
    { key: 'lastModified', label: 'Last Modified' }
];
const CT_COL_WIDTHS = { name: 300, id: 280, description: 260, revision: 80, lastModified: 150 };

const PROPERTIES_CLASS = 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties';

/* CodeTemplateProperties.CodeTemplateType (XStream serializes enum names) */
const TEMPLATE_TYPES = [
    { value: 'FUNCTION', label: 'Function' },
    { value: 'DRAG_AND_DROP_CODE', label: 'Drag-and-Drop Code Block' },
    { value: 'COMPILED_CODE', label: 'Compiled Code Block' }
];

/* ContextType enum, grouped the way the Swing context tree presents it */
const CONTEXT_GROUPS = [
    { label: 'Global Scripts', types: [
        ['GLOBAL_DEPLOY', 'Deploy Script'],
        ['GLOBAL_UNDEPLOY', 'Undeploy Script'],
        ['GLOBAL_PREPROCESSOR', 'Preprocessor Script'],
        ['GLOBAL_POSTPROCESSOR', 'Postprocessor Script']
    ] },
    { label: 'Channel Scripts', types: [
        ['CHANNEL_DEPLOY', 'Deploy Script'],
        ['CHANNEL_UNDEPLOY', 'Undeploy Script'],
        ['CHANNEL_PREPROCESSOR', 'Preprocessor Script'],
        ['CHANNEL_POSTPROCESSOR', 'Postprocessor Script'],
        ['CHANNEL_ATTACHMENT', 'Attachment Script'],
        ['CHANNEL_BATCH', 'Batch Script']
    ] },
    { label: 'Source Connector', types: [
        ['SOURCE_RECEIVER', 'Receiver Script(s)'],
        ['SOURCE_FILTER_TRANSFORMER', 'Filter / Transformer Script']
    ] },
    { label: 'Destination Connector', types: [
        ['DESTINATION_FILTER_TRANSFORMER', 'Filter / Transformer Script'],
        ['DESTINATION_DISPATCHER', 'Dispatcher Script'],
        ['DESTINATION_RESPONSE_TRANSFORMER', 'Response Transformer Script']
    ] }
];

const ALL_CONTEXTS = CONTEXT_GROUPS.flatMap(g => g.types.map(t => t[0]));

// Swing's default for a NEW template is CodeTemplateContextSet.getConnectorContextSet()
// — only the Source/Destination Connector contexts, not global/channel scripts.
const CONNECTOR_CONTEXTS = CONTEXT_GROUPS
    .filter(g => g.label === 'Source Connector' || g.label === 'Destination Connector')
    .flatMap(g => g.types.map(t => t[0]));

/* CodeTemplate.DEFAULT_CODE */
const DEFAULT_CODE = '/**\n\tModify the description here. Modify the function name and parameters as needed. One function per\n\ttemplate is recommended; create a new code template for each new function.\n\n\t@param {String} arg1 - arg1 description\n\t@return {String} return description\n*/\nfunction new_function1(arg1) {\n\t// TODO: Enter code here\n}';

/* ---- XStream shape helpers (reused verbatim) --------------------------------- */

function templatesOf(library: any) {
    return api.asList(library.codeTemplates, 'codeTemplate').filter(t => t && typeof t === 'object');
}

function idSetOf(value: any) {
    return api.asList(value, 'string').map(String);
}

function toIdSet(ids: any) {
    // An empty Set serializes as an empty element; mirror that rather than null
    // (the server copy-constructor NPEs on null channel id sets).
    return ids.length ? { string: ids } : '';
}

function contextsOf(template: any) {
    return api.asList(template.contextSet && template.contextSet.delegate, 'contextType').map(String);
}

function setContexts(template: any, types: any) {
    template.contextSet = { delegate: { contextType: types } };
}

/* Swing's Code Templates table shows a Description column derived from the
   template's JSDoc block (CodeTemplate.getDescription parses the leading
   comment). Pull the first non-empty, non-@tag line out of the /** ... *\/. */
function templateDescription(template: any) {
    const code = template.properties && template.properties.code;
    if (!code) return '';
    const m = String(code).match(/\/\*\*([\s\S]*?)\*\//);
    if (!m) return '';
    for (let line of m[1].split('\n')) {
        line = line.replace(/^\s*\*?\s?/, '').trim();
        // Skip the two wrapped lines of the default-template boilerplate.
        if (line && !line.startsWith('@')
            && !/^Modify the description here/i.test(line)
            && !/^template is recommended/i.test(line)) return line;
    }
    return '';
}

/* ---- _bulkUpdate result reading -----------------------------------------------
   _bulkUpdate answers with a CodeTemplateLibrarySaveResult, not the bare "false"
   the per-object PUTs returned. overrideNeeded is that same someone-else-saved
   revision conflict; librariesSuccess and the per-template results carry an
   engine-side failure that never reaches the HTTP status. Booleans are compared
   as text because XStream-JSON and the XML fallback disagree on their type. */
function needsOverride(result: any) {
    return Boolean(result) && typeof result === 'object' && String(result.overrideNeeded) === 'true';
}

function saveFailure(result: any) {
    if (!result || typeof result !== 'object') return '';   // no body = nothing to report
    const causeOf = (cause: any) => (cause && (cause.message || cause.localizedMessage)) || '';
    const problems: string[] = [];
    if (String(result.librariesSuccess) === 'false') {
        problems.push(causeOf(result.cause) || 'the library set could not be saved');
    }
    // codeTemplateResults is a Java Map, whose XStream encoding varies with the
    // key type, so scan the subtree for a failed result rather than assume one.
    const scan = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (String(node.success) === 'false') problems.push(causeOf(node.cause) || 'a code template could not be saved');
        else Object.values(node).forEach(scan);
    };
    scan(result.codeTemplateResults);
    return problems.join('; ');
}

export function CodeTemplatesView() {
    // Maximize: grow the Code editor over the library list (top) and the
    // Name/Library/Type form, keeping the right-hand Context panel. Esc restores.
    const [editorMax, setEditorMax] = useState(false);
    useEffect(() => {
        if (!editorMax) return;
        const onKey = (e: any) => { if (e.key === 'Escape') setEditorMax(false); };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [editorMax]);

    /* Edit-session model: [{ library, templates: [...] }] working copies. The
       objects are mutated in place; markDirty() bumps the container identity so
       React repaints. entriesNowRef mirrors the state for save/import mutations
       (which must act on the latest-known list, not a render-stale snapshot);
       dirtyRef mirrors the dirty flag for the mount-captured guards. */
    const [entries, setEntries] = useState([] as any[]);
    const entriesNowRef = useRef(entries);
    entriesNowRef.current = entries;
    const [selected, setSelected] = useState<any>(null);   // { kind: 'library'|'template', id }
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    // Save-session tombstones. Swing defers both library and template deletes
    // until Save All, then sends them with the replacement library snapshot so
    // revision checking and the transaction cover the whole edit session.
    const persistedLibraryIdsRef = useRef(new Set<string>());
    const persistedTemplateIdsRef = useRef(new Set<string>());
    const removedLibraryIdsRef = useRef(new Set<string>());
    const removedTemplateIdsRef = useRef(new Set<string>());
    const [filterText, setFilterText] = useState('');
    const [focusName, setFocusName] = useState(false);   // focus the Name field after creating
    const [collapsed, setCollapsed] = useState(() => new Set());   // collapsed library keys ('library:<id>')

    function markDirty() {
        dirtyRef.current = true;
        setDirty(true);
        setEntries(prev => prev.slice());   // model mutated in place — repaint
    }
    function markClean() {
        dirtyRef.current = false;
        setDirty(false);
    }

    // Resolve a { kind, id } selection against a library list (defaults to the
    // current render's). Menus/actions pass their own resolution explicitly.
    function resolve(sel: any, list = entries) {
        if (!sel) return null;
        for (const entry of list) {
            if (sel.kind === 'library' && entry.library.id === sel.id) return { entry };
            if (sel.kind === 'template') {
                const template = entry.templates.find((t: any) => t.id === sel.id);
                if (template) return { entry, template };
            }
        }
        return null;
    }

    /* ---- data ------------------------------------------------------------------ */

    /* Reads no render state (fetch + setState only), so the mount-captured
       codeTemplates:changed listener can safely call the first render's closure. */
    async function load() {
        try {
            const list = await api.codeTemplates.libraries(true);
            const next = list.map(library => ({ library, templates: templatesOf(library) }));
            persistedLibraryIdsRef.current = new Set(next.map(entry => String(entry.library.id)));
            persistedTemplateIdsRef.current = new Set(next.flatMap(entry => entry.templates.map((template: any) => String(template.id))));
            removedLibraryIdsRef.current.clear();
            removedTemplateIdsRef.current.clear();
            setEntries(next);
            markClean();
            setSelected((prev: any) => (prev && resolve(prev, next) ? prev : null));
        } catch (e: any) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    }

    /* ---- table (Swing Code Templates tree-table) -------------------------------- */

    function templateMatches(template: any, term: any) {
        if (!term) return true;
        return (template.name || '').toLowerCase().includes(term)
            || (template.id || '').toLowerCase().includes(term)
            || templateDescription(template).toLowerCase().includes(term);
    }

    // Columns/data/filter for the JSX <TreeTable> (libraries -> code templates).
    function treeColumns() {
        return CT_COLUMNS.map((c: any) => ({
            key: c.key, label: c.label, align: c.align, tree: c.key === 'name', mono: c.key === 'id',
            render: (n: any) => {
                switch (c.key) {
                    case 'name': return n.kind === 'library'
                        ? <TreeLabel icon="folder" label={n.lib.name || '(unnamed library)'} />
                        : <TreeLabel icon="file" label={n.tpl.name || '(unnamed template)'} />;
                    case 'id': return n.kind === 'library' ? (n.lib.id || '') : (n.tpl.id || '');
                    case 'description': return n.kind === 'library' ? (n.lib.description || '') : templateDescription(n.tpl);
                    case 'revision': return String((n.kind === 'library' ? n.lib.revision : n.tpl.revision) ?? '');
                    case 'lastModified': return fmtDate(n.kind === 'library' ? n.lib.lastModified : n.tpl.lastModified);
                    default: return '';
                }
            },
            // Click-to-sort: mirror render(n)'s value extraction but return the raw
            // comparable. Sorts libraries among themselves AND templates within each
            // library (TreeTable sorts siblings at every level).
            sortValue: (n: any) => {
                switch (c.key) {
                    case 'name': return String((n.kind === 'library' ? n.lib.name : n.tpl.name) || '').toLowerCase();
                    case 'id': return String((n.kind === 'library' ? n.lib.id : n.tpl.id) || '').toLowerCase();
                    case 'description': return String((n.kind === 'library' ? n.lib.description : templateDescription(n.tpl)) || '').toLowerCase();
                    case 'revision': return Number(n.kind === 'library' ? n.lib.revision : n.tpl.revision) || 0;
                    case 'lastModified': return (n.kind === 'library' ? n.lib.lastModified : n.tpl.lastModified)?.time ?? 0;
                    default: return null;
                }
            }
        }));
    }

    // Right-click on empty space (below the rows) shows the non-contextual tasks.
    function emptyMenu(e: any) {
        if (e.target.closest('tr')) return;   // row menus are handled per-row
        e.preventDefault();
        const found = resolve(selected);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshCodeTemplates', group: 'codeTemplate', onClick: () => load() },
            '-',
            { label: 'New Code Template', icon: 'plus', task: 'doNewCodeTemplate', group: 'codeTemplate', onClick: () => newTemplate(found && found.entry) },
            { label: 'New Library', icon: 'folder', task: 'doNewLibrary', group: 'codeTemplate', onClick: () => newLibrary() },
            '-',
            { label: 'Import Code Templates', icon: 'import', task: 'doImportCodeTemplates', group: 'codeTemplate', onClick: () => importCodeTemplates(found && found.entry) },
            { label: 'Import Libraries', icon: 'import', task: 'doImportLibraries', group: 'codeTemplate', onClick: () => importLibraries() },
            { label: 'Export All Libraries', icon: 'export', task: 'doExportAllLibraries', group: 'codeTemplate', onClick: () => exportLibraries() }
        ]);
    }

    // Right-click parity with the Swing Code Templates tree (codeTemplatePopupMenu).
    // The menu resolves its target ONCE, here — every item acts on that explicit
    // resolution, never on selection state that changes underneath it.
    function nodeMenu(sel: any, e: any) {
        e.preventDefault();
        setSelected(sel);
        const isTpl = sel.kind === 'template';
        const isLib = sel.kind === 'library';
        const resolved = resolve(sel) || {};
        // Plugin-contributed per-code-template actions (registerCodeTemplateAction),
        // e.g. "View History". Shown for a single selected template unless the
        // action supplies its own isEnabled. Mirrors the Swing code-template action.
        const actionCtx = { platform, template: (resolved as any).template, library: (resolved as any).entry && (resolved as any).entry.library };
        const pluginItems = platform.codeTemplateActions()
            .filter((a: any) => (a.isEnabled ? a.isEnabled(actionCtx) : isTpl))
            .map((a: any): any => ({
                label: a.label, icon: a.icon, task: a.task, group: a.group || 'codeTemplate',
                onClick: () => a.onInvoke((resolved as any).template, actionCtx)
            }));
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshCodeTemplates', group: 'codeTemplate', onClick: () => load() },
            '-',
            { label: 'New Code Template', icon: 'plus', task: 'doNewCodeTemplate', group: 'codeTemplate', onClick: () => newTemplate((resolved as any).entry) },
            { label: 'New Library', icon: 'folder', task: 'doNewLibrary', group: 'codeTemplate', onClick: () => newLibrary() },
            '-',
            { label: 'Import Code Templates', icon: 'import', task: 'doImportCodeTemplates', group: 'codeTemplate', onClick: () => importCodeTemplates((resolved as any).entry) },
            { label: 'Import Libraries', icon: 'import', task: 'doImportLibraries', group: 'codeTemplate', onClick: () => importLibraries() },
            { label: 'Export Code Template', icon: 'export', hidden: !isTpl, task: 'doExportCodeTemplate', group: 'codeTemplate', onClick: () => exportTemplate(resolved) },
            { label: 'Export Library', icon: 'export', hidden: !isLib, task: 'doExportLibrary', group: 'codeTemplate', onClick: () => exportLibrary(resolved) },
            { label: 'Export All Libraries', icon: 'export', task: 'doExportAllLibraries', group: 'codeTemplate', onClick: () => exportLibraries() },
            '-',
            { label: 'Validate Script', icon: 'check', hidden: !isTpl, task: 'doValidateCodeTemplate', group: 'codeTemplate', onClick: () => validateScriptTask(resolved) },
            ...(pluginItems.length ? ['-', ...pluginItems] : []),
            { label: 'Delete', icon: 'trash', danger: true, task: isTpl ? 'doDeleteCodeTemplate' : 'doDeleteLibrary', group: 'codeTemplate', onClick: () => deleteSelected(sel) },
            '-',
            { label: 'Save All', icon: 'save', task: 'doSaveCodeTemplates', group: 'codeTemplate', onClick: () => saveAll() }
        ]);
    }

    /* (The library editor, template form, and context checkbox tree are the
       declarative <LibraryEditor> / <TemplateForm> / <ContextPanel> components
       at the bottom of this file.) */

    /* ---- tasks --------------------------------------------------------------------- */

    function newLibrary() {
        // No name prompt — create the library and select it with the empty Name
        // field focused (the library editor focuses it when focusNewName is set).
        const library = {
            '@version': store.getState('serverVersion') || '4.5.2',
            id: uuid(),
            name: '',
            revision: 0,
            description: '',
            includeNewChannels: false,
            enabledChannelIds: '',
            disabledChannelIds: '',
            codeTemplates: null
        };
        setEntries(prev => [...prev, { library, templates: [] }]);
        setSelected({ kind: 'library', id: library.id });
        setFocusName(true);
        dirtyRef.current = true;
        setDirty(true);
    }

    function newTemplate(entryArg: any) {
        // Re-resolve by id at execution time: the menu that offered this action
        // may have outlived a reload, leaving entryArg detached from the live
        // list (pushing onto it would silently never reach saveAll).
        const entry = entryArg && entriesNowRef.current.find(en => en.library.id === entryArg.library.id);
        if (!entry) {
            toast('Select a library first', 'warn');
            return;
        }
        const v = store.getState('serverVersion') || '4.5.2';
        const template = {
            // '@version' is required: the engine migrates every write and
            // 500s when it's absent.
            '@version': v,
            id: uuid(),
            name: 'New Code Template',
            revision: 0,
            contextSet: { delegate: { contextType: [...CONNECTOR_CONTEXTS] } },
            properties: { '@class': PROPERTIES_CLASS, '@version': v, type: 'FUNCTION', code: DEFAULT_CODE }
        };
        entry.templates.push(template);
        setSelected({ kind: 'template', id: template.id });
        setFocusName(true);
        markDirty();
    }

    /* Deletion re-resolves its target against the LATEST list both at entry and
       again after the confirm await — a reload landing while the menu or the
       dialog was open would otherwise leave a detached entry whose removal
       no-ops, letting a later Save All resurrect the engine-deleted templates. */
    async function deleteSelected(sel: any) {
        let found = resolve(sel, entriesNowRef.current);
        if (!sel || !found) { toast('Select a library or code template first', 'warn'); return; }

        if (sel.kind === 'library') {
            const count = found.entry.templates.length;
            const message = count
                ? `Delete library "${found.entry.library.name}" and its ${count} code template(s)? Save All commits the removal.`
                : `Delete library "${found.entry.library.name}"? Save All commits the removal.`;
            if (!await confirmDialog('Delete Library', message, { danger: true, okLabel: 'Delete' })) return;
            found = resolve(sel, entriesNowRef.current);
            if (!found) { toast('The library no longer exists (the list was reloaded)', 'warn'); return; }
            const entry = found.entry;
            if (persistedLibraryIdsRef.current.has(String(entry.library.id))) {
                removedLibraryIdsRef.current.add(String(entry.library.id));
            }
            for (const template of entry.templates) if (persistedTemplateIdsRef.current.has(String(template.id))) {
                removedTemplateIdsRef.current.add(String(template.id));
            }
            setEntries(prev => prev.filter(en => en !== entry));
        } else {
            if (!await confirmDialog('Delete Code Template', `Delete code template "${found.template.name}"?`, { danger: true, okLabel: 'Delete' })) return;
            found = resolve(sel, entriesNowRef.current);
            if (!found) { toast('The code template no longer exists (the list was reloaded)', 'warn'); return; }
            if (persistedTemplateIdsRef.current.has(String(found.template.id))) {
                removedTemplateIdsRef.current.add(String(found.template.id));
            }
            found.entry.templates = found.entry.templates.filter((t: any) => t !== found!.template!);
        }
        invalidateCompletions();   // deleted templates no longer autocomplete
        setSelected(null);
        markDirty();
        toast('Deleted — use Save All to commit library changes');
    }

    async function saveAll(overrideConflicts = false): Promise<any> {
        // Swing-parity conflict handling: save with override=false and the revisions AS
        // LOADED (the engine bumps them itself; sending a self-bumped revision would read
        // as a conflict on every save). An overrideNeeded result means someone else saved
        // since this view loaded — prompt once, then retry everything with override=true.
        const conflict = async (): Promise<any> => {
            const overwrite = await confirmDialog('Code Templates Modified',
                'One or more code templates or libraries have been modified since you opened them. Are you sure you want to overwrite them with your changes?',
                { danger: true, okLabel: 'Overwrite' });
            if (overwrite) return saveAll(true);
            toast('Save cancelled — Refresh to load the latest code templates', 'warn');
        };
        try {
            const v = store.getState('serverVersion') || '4.5.2';
            const current = entriesNowRef.current;
            const templates: any[] = [];
            for (const entry of current) {
                for (const template of entry.templates) {
                    // Defensive: the engine's migrator 500s without '@version'.
                    if (!template['@version']) template['@version'] = v;
                    if (template.properties && !template.properties['@version']) template.properties['@version'] = v;
                    templates.push(template);
                }
            }
            const payload = current.map(entry => ({
                '@version': entry.library['@version'] || v,
                ...entry.library,
                codeTemplates: entry.templates.length
                    // id-only refs, but '@version' is still required — the
                    // engine migrates every nested model and 500s without it.
                    ? { codeTemplate: entry.templates.map((t: any) => ({ '@version': t['@version'] || v, id: t.id })) }
                    : null
            }));
            // Libraries, templates, and deferred removals land in ONE revision-
            // checked transaction. A failed/cancelled save leaves the server
            // untouched and the tombstones available for the conflict retry.
            const result = await api.codeTemplates.bulkUpdate(
                payload,
                templates,
                [...removedLibraryIdsRef.current],
                [...removedTemplateIdsRef.current],
                overrideConflicts
            );
            if (needsOverride(result)) return conflict();
            const failure = saveFailure(result);
            if (failure) throw new Error(failure);
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast('Code templates saved');
            await load();
        } catch (e: any) {
            toast(`Save failed: ${e.message}`, 'error');
        }
    }

    /* ---- import / export (Swing-compatible XStream XML) ----------------------------- */

    async function exportLibraries() {
        try {
            await saveFile('codeTemplateLibraries.xml', 'application/xml',
                () => api.getXml('/codeTemplateLibraries', { includeCodeTemplates: true }));
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function exportLibrary(found: any) {
        if (!found || !found.entry || found.template) {
            toast('Select a library first', 'warn');
            return;
        }
        const { library } = found.entry;
        try {
            await saveFile(`${library.name || library.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/codeTemplateLibraries/${encodeURIComponent(library.id)}`, { includeCodeTemplates: true });
                if (!xml || !String(xml).trim()) throw new Error('Library not found on the server — save it first');
                return xml;
            });
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function exportTemplate(found: any) {
        if (!found || !found.template) {
            toast('Select a code template first', 'warn');
            return;
        }
        try {
            await saveFile(`${found.template.name || found.template.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/codeTemplates/${found.template.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Template not found on the server — save it first');
                return xml;
            });
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    /* Accepts a Swing/web export: a <list> of <codeTemplateLibrary> (or one
       bare <codeTemplateLibrary>). The library records only ever persist id
       references to their templates, so the embedded <codeTemplate> elements
       travel as _bulkUpdate's updatedCodeTemplates — one transaction instead of
       the PUT-per-template-then-PUT-the-list sequence, which imported half a
       file whenever it failed partway. */
    async function importLibraries() {
        const file = await pickFile('.xml');
        if (!file) return;
        if (!await confirmDialog('Import Libraries',
            `Import "${file.name}"? This replaces the entire code template library list on the server — libraries not present in the file will be removed.`,
            { danger: true, okLabel: 'Import' })) return;
        try {
            const doc = new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml');
            if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
            const root = doc.documentElement;
            if (root.tagName !== 'list' && root.tagName !== 'codeTemplateLibrary') {
                throw new Error('Expected a <list> of <codeTemplateLibrary> elements');
            }
            const libraryEls = root.tagName === 'codeTemplateLibrary'
                ? [root]   // single-library export
                : [...root.querySelectorAll(':scope > codeTemplateLibrary')];
            if (!libraryEls.length) throw new Error('No <codeTemplateLibrary> elements found in the file');

            const v = store.getState('serverVersion') || '4.5.2';
            const templates: any[] = [];
            const payload = libraryEls.map(el => {
                const library: any = xmlToJson(el);
                const refs: any[] = [];
                for (const tplEl of el.querySelectorAll(':scope > codeTemplates > codeTemplate')) {
                    // A full template (more than a bare <id> ref) is written in the
                    // same transaction and reduced to the id ref the library keeps.
                    if ([...tplEl.children].some(c => c.tagName !== 'id')) {
                        const template = templateFromXml(tplEl, v);
                        templates.push(template);
                        refs.push({ '@version': template['@version'], id: template.id });
                        continue;
                    }
                    const id = [...tplEl.children].find(c => c.tagName === 'id')?.textContent;
                    if (id) refs.push({ '@version': v, id });
                }
                return {
                    '@version': library['@version'] || v,
                    ...library,
                    codeTemplates: refs.length ? { codeTemplate: refs } : null
                };
            });
            const failure = saveFailure(await api.codeTemplates.bulkUpdate(payload, templates, [], [], true));
            if (failure) throw new Error(failure);
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast(`Imported ${file.name}`);
            setSelected(null);
            await load();
        } catch (e: any) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    /* Import individual code templates into the selected library (Swing's
       "Import Code Templates"). Also a multi-object write — the templates AND
       the rewritten library references have to land together, or the templates
       exist with nothing pointing at them — so it goes out as one _bulkUpdate.
       This commits like Import Libraries rather than editing the working copy. */
    async function importCodeTemplates(entryArg: any) {
        // Re-resolve the target by id (the offering menu may have outlived a reload).
        let target = entryArg && entriesNowRef.current.find(en => en.library.id === entryArg.library.id);
        if (!target) {
            if (entriesNowRef.current.length === 1) target = entriesNowRef.current[0];
            else { toast('Select a library to import into first', 'warn'); return; }
        }
        const targetId = target.library.id;
        if (dirtyRef.current && !await confirmDialog('Import Code Templates',
            'Discard unsaved changes and import? The imported templates are added to the selected library and saved.',
            { okLabel: 'Import' })) return;
        const file = await pickFile('.xml');
        if (!file) return;
        try {
            const doc = new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml');
            if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
            // Full <codeTemplate> elements (more than a bare <id> reference).
            const els = [...doc.querySelectorAll('codeTemplate')]
                .filter(el => [...el.children].some(c => c.tagName !== 'id'));
            if (!els.length) throw new Error('No <codeTemplate> elements found in the file');

            const v = store.getState('serverVersion') || '4.5.2';
            const imported = els.map(el => templateFromXml(el, v));
            const newIds = imported.map((t: any) => t.id);
            // Rewrite the library set with the new refs appended to the target —
            // matched by id, not object identity (the pickFile/confirm awaits
            // above may span a reload).
            const payload = entriesNowRef.current.map(en => {
                const ids = en.library.id === targetId
                    ? [...en.templates.map((t: any) => t.id), ...newIds]
                    : en.templates.map((t: any) => t.id);
                return {
                    '@version': en.library['@version'] || v,
                    ...en.library,
                    revision: (Number(en.library.revision) || 0) + 1,
                    codeTemplates: ids.length ? { codeTemplate: ids.map((id: any) => ({ '@version': v, id })) } : null
                };
            });
            const failure = saveFailure(await api.codeTemplates.bulkUpdate(payload, imported, [], [], true));
            if (failure) throw new Error(failure);
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast(`Imported ${els.length} code template${els.length === 1 ? '' : 's'} into "${target.library.name || 'library'}"`);
            await load();
        } catch (e: any) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    /* Validate Script (Swing) — real Rhino compile check of the selected
       template's code via the engine bridge. */
    async function validateScriptTask(found: any) {
        if (!found || !found.template) { toast('Select a code template first', 'warn'); return; }
        const code = found.template.properties && found.template.properties.code;
        if (typeof code !== 'string' || !code.trim()) { toast('Template has no code to validate', 'warn'); return; }
        const result = await validateScript(code);
        if (result.ok === null) { toast(result.message, 'warn'); return; }
        if (result.ok === false) { toast(`Validation error — ${result.message}`, 'error'); return; }
        toast('Code template validated successfully');
    }

    async function refreshTask() {
        if (dirtyRef.current && !await confirmDialog('Refresh', 'Discard unsaved changes and refresh?', { okLabel: 'Refresh' })) return;
        load();
    }

    /* Move a template between libraries (the Library dropdown on the template
       form). Mutates both entries' template lists, expands the target, and
       keeps the template selected. */
    function moveTemplate(entry: any, template: any, targetId: any) {
        if (targetId === entry.library.id) return;
        const target = entries.find(en => en.library.id === targetId);
        if (!target) return;
        entry.templates = entry.templates.filter((t: any) => t !== template);
        target.templates.push(template);
        setCollapsed(prev => { const next = new Set(prev); next.delete('library:' + targetId); return next; });
        setSelected({ kind: 'template', id: template.id });
        markDirty();
    }

    /* ---- mount: load ---- */

    useEffect(() => {
        load();
        // Prompt before leaving with unsaved library/template edits (Swing parity).
        store.setState('navGuard', async () => {
            if (!dirtyRef.current) return;
            // No save permission -> say the edits can't be kept (channel editor parity).
            const ok = platform.checkTask('codeTemplate', 'doSaveCodeTemplates')
                ? await confirmDialog('Unsaved Changes',
                    'You have unsaved code template changes. Leave without saving?',
                    { danger: true, okLabel: 'Leave' })
                : await confirmDialog('Unsaved Changes',
                    "You don't have permission to save code template changes. Leaving will discard them.",
                    { okLabel: 'OK' });
            return ok ? undefined : false;
        });
        // Tab-close guard: same dirty state, synchronous (see core/unsaved.js).
        const unregister = registerUnsavedCheck(() => dirtyRef.current);
        // A plugin that mutates a template out-of-band (e.g. history revert) emits
        // this so the tree reflects the change immediately (Swing doRefreshCodeTemplates).
        const off = platform.events.on('codeTemplates:changed', () => load());
        return () => { store.setState('navGuard', null); unregister(); off(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-dependent task visibility (Swing Code Template Tasks pane).
    const found = resolve(selected);

    /* Editor pane collapse: while nothing is selected the tree pane (the
       .split-handle's drag target) flexes to fill the column and the editor
       shrinks to a slim strip; selection restores the class-default or last
       dragged tree height. The handle mutates style.height directly during
       drags, so the layout effect writes styles only on open/close transitions
       (the message browser's detail-pane mechanism, inverted for this
       geometry). */
    const treePaneRef = useRef<any>(null);
    const treeHeightRef = useRef('');         // '' = the h-[288px] class default
    const prevEditorOpenRef = useRef(false);
    const editorOpen = !!found;
    useLayoutEffect(() => {
        const el = treePaneRef.current;
        if (!el) return;
        if (editorOpen) {
            if (!prevEditorOpenRef.current) {
                el.style.flex = '';
                el.style.height = treeHeightRef.current;
            }
        } else {
            if (prevEditorOpenRef.current) treeHeightRef.current = el.style.height || treeHeightRef.current;
            el.style.flex = '1 1 0%';
            el.style.height = 'auto';
        }
        prevEditorOpenRef.current = editorOpen;
    }, [editorOpen]);
    const isTemplate = !!found && selected && selected.kind === 'template';
    const isLibrary = !!found && selected && selected.kind === 'library';

    // Tree data + filter for the <TreeTable>.
    const treeData = entries.map((entry: any) => ({
        kind: 'library', id: entry.library.id, lib: entry.library,
        children: entry.templates.map((t: any) => ({ kind: 'template', id: t.id, tpl: t }))
    }));
    const term = filterText.trim().toLowerCase();
    const ctMatches = term
        ? (n: any) => (n.kind === 'library' ? (n.lib.name || '').toLowerCase().includes(term) : templateMatches(n.tpl, term))
        : undefined;
    const totalTemplates = entries.reduce((sum: any, en: any) => sum + en.templates.length, 0);
    const countsText = `${entries.length} Librar${entries.length === 1 ? 'y' : 'ies'}, ${totalTemplates} Code Template${totalTemplates === 1 ? '' : 's'}`;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Code Template Tasks" paneKey="tasks:Code Template Tasks" group="codeTemplate">
                    <div className="taskbar" data-pane-title="Code Template Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshCodeTemplates" onClick={refreshTask} />
                        {dirty && <TaskButton label="Save Changes" icon="save" primary task="doSaveCodeTemplates" onClick={() => saveAll()} />}
                        {found && <TaskButton label="New Code Template" icon="plus" task="doNewCodeTemplate" onClick={() => newTemplate(found.entry)} />}
                        <TaskButton label="New Library" icon="folder" task="doNewLibrary" onClick={newLibrary} />
                        <TaskButton label="Import Code Templates" icon="import" task="doImportCodeTemplates" onClick={() => importCodeTemplates(found && found.entry)} />
                        <TaskButton label="Import Libraries" icon="import" task="doImportLibraries" onClick={importLibraries} />
                        {isTemplate && <TaskButton label="Export Code Template" icon="export" task="doExportCodeTemplate" onClick={() => exportTemplate(found)} />}
                        {isLibrary && <TaskButton label="Export Library" icon="export" task="doExportLibrary" onClick={() => exportLibrary(found)} />}
                        {isTemplate && <TaskButton label="Delete Code Template" icon="trash" danger task="doDeleteCodeTemplate" onClick={() => deleteSelected(selected)} />}
                        {isLibrary && <TaskButton label="Delete Library" icon="trash" danger task="doDeleteLibrary" onClick={() => deleteSelected(selected)} />}
                        {isTemplate && <TaskButton label="Validate Script" icon="check" task="doValidateCodeTemplate" onClick={() => validateScriptTask(found)} />}
                        {isTemplate && platform.codeTemplateActions()
                            .filter((a: any) => (a.isEnabled ? a.isEnabled({ platform, template: found!.template, library: found!.entry.library }) : true))
                            .map((a: any) => <TaskButton key={a.id || a.label} label={a.label} icon={a.icon} task={a.task}
                                onClick={() => a.onInvoke(found!.template, { platform, template: found!.template, library: found!.entry.library })} />)}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex">
                {/* Top: libraries/templates tree-table + filter bar; bottom: editor.
                    When maximized, the top pane (data-editor-overtake) is hidden so the
                    editor fills the column; the right Context panel stays. */}
                <div className={'split vertical flex-1 min-w-0' + (editorMax ? ' is-editor-max' : '')}>
                    <div ref={treePaneRef} className="split-a h-[288px] flex-none flex flex-col min-h-0" data-editor-overtake>
                        <div className="flex-1 min-h-0 overflow-auto oie-tablecard px-[13px] pt-3">
                            <TreeTable
                                data={treeData}
                                columns={treeColumns()}
                                getChildren={(n: any) => n.children}
                                rowKey={(n: any) => `${n.kind}:${n.id}`}
                                rowClassName={(n: any) => (n.kind === 'library' ? 'group-row' : '')}
                                selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
                                onSelect={(n: any) => setSelected({ kind: n.kind, id: n.id })}
                                onRowContextMenu={(n: any, e: any) => nodeMenu({ kind: n.kind, id: n.id }, e)}
                                onEmptyContextMenu={emptyMenu}
                                matches={ctMatches}
                                collapsedKeys={collapsed}
                                onToggleCollapse={(key: any) => setCollapsed(prev => {
                                    const next = new Set(prev);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    return next;
                                })}
                                columnsKey="codetemplates"
                                columnWidths={CT_COL_WIDTHS}
                                defaultHidden={['id']}
                                pinnedKeys={['name']}
                                emptyText="No code template libraries" />
                        </div>
                        <div className="filterbar flex-none panel overflow-visible mx-[13px] my-2">
                            <span className="counts">{countsText}</span>
                            <span className="ml-auto inline-flex items-center gap-1.5">
                                <label>Filter:</label>
                                <input type="text" placeholder="Filter…" className="max-w-[234px]" value={filterText}
                                    onChange={(e: any) => setFilterText(e.target.value)} />
                            </span>
                        </div>
                    </div>
                    {found ? <>
                        <div className="split-handle mx-[13px]" data-orient="v" data-resize="prev" data-editor-overtake />
                        <div className="split-b flex flex-col min-h-0">
                            <div className="flex flex-col flex-1 min-h-0 py-3.5 px-4 overflow-auto">
                                <EditorPane found={found} kind={selected && selected.kind}
                                    entries={entries}
                                    markDirty={markDirty}
                                    focusName={focusName}
                                    onFocusConsumed={() => setFocusName(false)}
                                    onMoveTemplate={moveTemplate}
                                    maximized={editorMax}
                                    onToggleMax={() => setEditorMax((m: any) => !m)} />
                            </div>
                        </div>
                    </> : <div className="split-b flex-none text-text-faint py-[8px] px-3.5">Select a library or code template to edit it.</div>}
                </div>
            </div>
        </div>
    );
}

/* The editor pane. Branches on the current selection into the declarative
   library / template editors. Keyed on the selected id so per-selection state
   (channel filter, focus) resets when the selection changes. */
function EditorPane({ found, kind, entries, markDirty, focusName, onFocusConsumed, onMoveTemplate, maximized, onToggleMax }: any) {
    if (kind === 'library') {
        return <LibraryEditor key={'lib:' + found.entry.library.id} entry={found.entry}
            markDirty={markDirty} focusName={focusName} onFocusConsumed={onFocusConsumed} />;
    }
    return <TemplateEditor key={'tpl:' + found.template.id} entry={found.entry} template={found.template}
        entries={entries} markDirty={markDirty} focusName={focusName} onFocusConsumed={onFocusConsumed}
        onMoveTemplate={onMoveTemplate} maximized={maximized} onToggleMax={onToggleMax} />;
}

/* Focuses + selects the Name input once, when the editor opens for a
   just-created library/template. */
function useFocusName(focusName: any, onFocusConsumed: any) {
    const ref = useRef<any>(null);
    useEffect(() => {
        if (focusName) {
            onFocusConsumed();
            ref.current?.focus();
            ref.current?.select();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return ref;
}

/* The library editor: Name / Include New Channels, the type-count summary +
   Description, and the Channels checkbox list (Swing's right-hand panel). */
function LibraryEditor({ entry, markDirty, focusName, onFocusConsumed }: any) {
    const { library } = entry;
    const nameRef = useFocusName(focusName, onFocusConsumed);
    const [channels, setChannels] = useState<any>(null);   // null = loading
    const [chError, setChError] = useState<any>(null);
    const [chFilter, setChFilter] = useState('');

    useEffect(() => {
        let alive = true;
        api.channels.idsAndNames().then((map: any) => {
            if (!alive) return;
            const rows = api.asList(map && map.entry).map((en: any) => {
                const pair = api.asList(en.string);
                return { id: String(pair[0] ?? ''), name: String(pair[1] ?? pair[0] ?? '') };
            }).sort((a: any, b: any) => a.name.localeCompare(b.name));
            setChannels(rows);
        }).catch((e: any) => { if (alive) setChError(e.message); });
        return () => { alive = false; };
    }, []);

    // Summary line (Swing shows template-type counts for the library).
    const counts = { FUNCTION: 0, DRAG_AND_DROP_CODE: 0, COMPILED_CODE: 0 };
    for (const t of entry.templates) {
        const type = (t.properties && t.properties.type) || 'FUNCTION';
        if ((counts as any)[type] === undefined) (counts as any)[type] = 0;
        (counts as any)[type]++;
    }
    const summaryText = `${counts.FUNCTION} Function${counts.FUNCTION === 1 ? '' : 's'}, `
        + `${counts.DRAG_AND_DROP_CODE} Drag-and-Drop Code Block${counts.DRAG_AND_DROP_CODE === 1 ? '' : 's'}, `
        + `${counts.COMPILED_CODE} Compiled Code Block${counts.COMPILED_CODE === 1 ? '' : 's'}`;

    const enabled = new Set(idSetOf(library.enabledChannelIds));
    function setChannel(id: any, on: any) {
        const en = new Set(idSetOf(library.enabledChannelIds));
        const dis = new Set(idSetOf(library.disabledChannelIds));
        if (on) { en.add(id); dis.delete(id); } else { en.delete(id); dis.add(id); }
        library.enabledChannelIds = toIdSet([...en]);
        library.disabledChannelIds = toIdSet([...dis]);
        markDirty();
    }
    function setAllChannels(on: any) {
        const term = chFilter.trim().toLowerCase();
        for (const row of channels || []) {
            if (!term || row.name.toLowerCase().includes(term)) setChannel(row.id, on);
        }
    }

    const term = chFilter.trim().toLowerCase();
    const visible = (channels || []).filter((r: any) => !term || r.name.toLowerCase().includes(term));

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div className="form-grid mb-3">
                <div className="field">
                    <label>Name</label>
                    <input ref={nameRef} type="text" value={library.name || ''}
                        onChange={(e: any) => { library.name = e.target.value; markDirty(); }} />
                </div>
                <div className="field justify-end">
                    <label className="check">
                        <input type="checkbox" checked={!!library.includeNewChannels}
                            onChange={(e: any) => { library.includeNewChannels = e.target.checked; markDirty(); }} />
                        Include New Channels
                    </label>
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-h-0 mr-3.5">
                    <div className="mb-2.5 text-[11px] text-text-dim">
                        <span className="font-[650]">Summary: </span>{summaryText}
                    </div>
                    <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim mb-1.5">Description</label>
                    <textarea className="flex-1 min-h-[108px] resize-none" value={library.description || ''}
                        onChange={(e: any) => { library.description = e.target.value; markDirty(); }} />
                </div>
                <div className="w-[270px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5">
                    <div className="flex items-baseline justify-between mb-2">
                        <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">Channels</label>
                        <span className="text-[10px]">
                            <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAllChannels(true); }}>Select All</a>
                            <span className="text-text-faint my-0 mx-1.5">|</span>
                            <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAllChannels(false); }}>Deselect All</a>
                        </span>
                    </div>
                    <input type="text" placeholder="Filter…" className="w-full mb-1.5" value={chFilter}
                        onChange={(e: any) => setChFilter(e.target.value)} />
                    <div className="overflow-auto flex-1">
                        {chError ? <div className="text-text-faint">{`Channels unavailable: ${chError}`}</div>
                            : channels === null ? <div className="loading-block"><div className="spinner" />Loading channels…</div>
                                : visible.length === 0 ? <div className="text-text-faint">{channels.length ? 'No matches' : 'No channels'}</div>
                                    : visible.map((row: any) => (
                                        <div key={row.id}>
                                            <label className="check">
                                                <input type="checkbox" checked={enabled.has(row.id)}
                                                    onChange={(e: any) => setChannel(row.id, e.target.checked)} />
                                                {row.name}
                                            </label>
                                        </div>
                                    ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function TemplateEditor({ entry, template, entries, markDirty, focusName, onFocusConsumed, onMoveTemplate, maximized, onToggleMax }: any) {
    const nameRef = useFocusName(focusName, onFocusConsumed);
    if (!template.properties || typeof template.properties !== 'object') {
        template.properties = { '@class': PROPERTIES_CLASS, type: 'FUNCTION', code: '' };
    }
    // Maximize (state lifted to the view so it can also hide the library list above)
    // grows the Code editor over the Name/Library/Type form, which is tagged
    // data-editor-overtake, while the right-hand Context panel stays visible.
    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div data-editor-overtake style={{ flex: 'none' }}>
                <div className="form-grid mb-3">
                    <div className="field">
                        <label>Name</label>
                        <input ref={nameRef} type="text" value={template.name || ''}
                            onChange={(e: any) => { template.name = e.target.value; markDirty(); }} />
                    </div>
                    <div className="field">
                        <label>Library</label>
                        {/* Swing lets you move a template between libraries here. */}
                        <select value={entry.library.id}
                            onChange={(e: any) => onMoveTemplate(entry, template, e.target.value)}>
                            {entries.map((en: any) => (
                                <option key={en.library.id} value={en.library.id}>{en.library.name || '(unnamed library)'}</option>
                            ))}
                        </select>
                    </div>
                    <div className="field">
                        <label>Type</label>
                        <select value={template.properties.type || 'FUNCTION'}
                            onChange={(e: any) => { template.properties.type = e.target.value; markDirty(); }}>
                            {TEMPLATE_TYPES.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                    </div>
                </div>
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-h-0 mr-3.5">
                    <div className="flex items-center mb-1.5">
                        <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">Code</label>
                        <button type="button" className="icon-btn ml-auto"
                            title={maximized ? 'Restore editor (Esc)' : 'Maximize editor'}
                            onClick={onToggleMax}>
                            <Icon name={maximized ? 'minimize' : 'maximize'} size={15} />
                        </button>
                    </div>
                    <CodeEditor language="javascript"
                        defaultValue={template.properties.code || ''}
                        onChange={(v: any) => { template.properties.code = v; markDirty(); }}
                        style={{ flex: 1, minHeight: '200px' }} />
                </div>
                <ContextPanel template={template} markDirty={markDirty} />
            </div>
        </div>
    );
}

/* Group checkbox with the tri-state (indeterminate) look — `indeterminate` is a
   DOM property, not an attribute, so it is applied through a ref. */
function GroupCheck({ label, checked, indeterminate, onChange }: any) {
    const ref = useRef<any>(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
    return (
        <label className="check">
            <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
            {label}
        </label>
    );
}

/* The template's Context checkbox tree (Swing's right-hand panel). All state
   derives from the template's contextSet; toggles rewrite it via setContexts. */
function ContextPanel({ template, markDirty }: any) {
    const active = new Set(contextsOf(template));
    const apply = (next: any) => {
        setContexts(template, ALL_CONTEXTS.filter((t: any) => next.has(t)));
        markDirty();
    };
    const toggleType = (type: any, on: any) => {
        const next = new Set(active);
        on ? next.add(type) : next.delete(type);
        apply(next);
    };
    const toggleGroup = (group: any, on: any) => {
        const next = new Set(active);
        for (const [type] of group.types) { on ? next.add(type) : next.delete(type); }
        apply(next);
    };
    const setAll = (on: any) => apply(on ? new Set(ALL_CONTEXTS) : new Set());

    return (
        <div className="w-[234px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5">
            <div className="flex items-baseline justify-between mb-2">
                <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">Context</label>
                <span className="text-[10px]">
                    <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAll(true); }}>Select All</a>
                    <span className="text-text-faint my-0 mx-1.5">|</span>
                    <a href="#" className="text-accent" onClick={(e: any) => { e.preventDefault(); setAll(false); }}>Deselect All</a>
                </span>
            </div>
            <div className="overflow-auto flex-1">
                {CONTEXT_GROUPS.map((group: any) => {
                    const on = group.types.filter(([type]: any) => active.has(type)).length;
                    return (
                        <div key={group.label} className="mb-1.5">
                            <div>
                                <GroupCheck label={group.label}
                                    checked={on === group.types.length && on > 0}
                                    indeterminate={on > 0 && on < group.types.length}
                                    onChange={(e: any) => toggleGroup(group, e.target.checked)} />
                            </div>
                            {group.types.map(([type, label]: any) => (
                                <div key={type} className="pl-5">
                                    <label className="check">
                                        <input type="checkbox" checked={active.has(type)}
                                            onChange={(e: any) => toggleType(type, e.target.checked)} />
                                        {label}
                                    </label>
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
