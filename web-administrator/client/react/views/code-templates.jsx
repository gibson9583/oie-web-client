/*
 * Code Templates view (React port of views/code-templates.js). The Swing-parity
 * library/template tree-table is the hand-built `table.dt` grid driven by
 * createColumnManager/decorateColumns/attachColumnMenu — it is hierarchical
 * (libraries with expand twisties + nested templates + per-row context menus),
 * so it is NOT a DataTable; it is kept mounted via a ref and repainted
 * imperatively, reusing the legacy renderTable/nodeMenu logic verbatim.
 *
 * The editor pane is React: it branches on the selection. The library editor and
 * the template's context/channel checkbox trees are heavy legacy DOM, reused
 * VERBATIM via <ImperativeMount>; the selected template's code uses the React
 * <CodeEditor> island. State the table callbacks (captured at mount) must read —
 * the working library list, current selection, filter text, dirty flag,
 * collapsed set — lives in refs; a useReducer force-update refreshes the React
 * tree (editor pane + gated task buttons).
 *
 * Saving mirrors the Swing client: each template is PUT individually
 * (/codeTemplates/{id}?override=true), then the libraries are PUT as a full set
 * (/codeTemplateLibraries?override=true) with id-only template references. The
 * script-completions cache is invalidate()d on every mutation so script editors
 * refetch the new scope.
 */

import { useEffect, useRef, useReducer, useState } from 'react';
import { h, clear, toast, confirmDialog, field, textInput, checkbox, select, loading, saveFile, pickFile, contextMenu, fmtDate } from '@oie/web-ui';
import { TreeTable, TreeLabel } from '../tree-table.jsx';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { validateScript } from '../../core/serialize.js';
import { invalidate as invalidateCompletions } from '../../core/script-completions.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, CodeEditor } from '../ui.jsx';
import { Icon } from '../bridges.jsx';

export function register(platform) {
    // Reached via task buttons (Dashboard/Channels), matching the Swing client.
    platform.registerView('/code-templates', reactView(CodeTemplatesView), { title: 'Code Templates' });
}

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

/* CodeTemplate.DEFAULT_CODE */
const DEFAULT_CODE = '/**\n\tModify the description here. Modify the function name and parameters as needed. One function per\n\ttemplate is recommended; create a new code template for each new function.\n\n\t@param {String} arg1 - arg1 description\n\t@return {String} return description\n*/\nfunction new_function1(arg1) {\n\t// TODO: Enter code here\n}';

/* ---- XStream shape helpers (reused verbatim) --------------------------------- */

function templatesOf(library) {
    return api.asList(library.codeTemplates, 'codeTemplate').filter(t => t && typeof t === 'object');
}

function idSetOf(value) {
    return api.asList(value, 'string').map(String);
}

function toIdSet(ids) {
    // An empty Set serializes as an empty element; mirror that rather than null
    // (the server copy-constructor NPEs on null channel id sets).
    return ids.length ? { string: ids } : '';
}

function contextsOf(template) {
    return api.asList(template.contextSet && template.contextSet.delegate, 'contextType').map(String);
}

function setContexts(template, types) {
    template.contextSet = { delegate: { contextType: types } };
}

/* Swing's Code Templates table shows a Description column derived from the
   template's JSDoc block (CodeTemplate.getDescription parses the leading
   comment). Pull the first non-empty, non-@tag line out of the /** ... *\/. */
function templateDescription(template) {
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

/* Mounts imperative DOM (built by `build()`) into a div, rebuilding on `deps`
   change. Reused for the legacy library editor + channel/context checkbox-tree
   builders (heavy DOM kept verbatim). */
function ImperativeMount({ build, deps = [], style }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        const node = build();
        if (node) host.appendChild(node);
        return () => host.replaceChildren();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return <div ref={ref} className="flex flex-col flex-1 min-h-0" style={style} />;
}

function CodeTemplatesView() {
    const [, forceRender] = useReducer((x) => x + 1, 0);
    // Maximize: grow the Code editor over the library list (top) and the
    // Name/Library/Type form, keeping the right-hand Context panel. Esc restores.
    const [editorMax, setEditorMax] = useState(false);
    useEffect(() => {
        if (!editorMax) return;
        const onKey = (e) => { if (e.key === 'Escape') setEditorMax(false); };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [editorMax]);

    // Working state read by callbacks captured at mount — kept in refs.
    const librariesRef = useRef([]);     // [{ library, templates: [...] }] working copies
    const selectedRef = useRef(null);    // { kind: 'library'|'template', id }
    const dirtyRef = useRef(false);
    const filterRef = useRef('');
    const focusNewNameRef = useRef(false);  // focus the Name field after creating a library/template
    const collapsedRef = useRef(new Set());  // collapsed library keys ('library:<id>')

    function markDirty() { dirtyRef.current = true; forceRender(); }

    function findSelected() {
        const selected = selectedRef.current;
        if (!selected) return null;
        for (const entry of librariesRef.current) {
            if (selected.kind === 'library' && entry.library.id === selected.id) return { entry };
            if (selected.kind === 'template') {
                const template = entry.templates.find(t => t.id === selected.id);
                if (template) return { entry, template };
            }
        }
        return null;
    }

    /* ---- data ------------------------------------------------------------------ */

    async function load() {
        try {
            const list = await api.codeTemplates.libraries(true);
            librariesRef.current = list.map(library => ({ library, templates: templatesOf(library) }));
            dirtyRef.current = false;
            if (selectedRef.current && !findSelected()) selectedRef.current = null;
            renderTable();
            forceRender();
        } catch (e) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    }

    /* ---- table (Swing Code Templates tree-table) -------------------------------- */

    function selectNode(sel) {
        selectedRef.current = sel; renderTable(); forceRender();
    }

    function templateMatches(template, term) {
        if (!term) return true;
        return (template.name || '').toLowerCase().includes(term)
            || (template.id || '').toLowerCase().includes(term)
            || templateDescription(template).toLowerCase().includes(term);
    }

    // The tree is now the declarative <TreeTable> in the render below; renderTable()
    // just triggers a React re-render (call sites are unchanged).
    function renderTable() { forceRender(); }

    // Columns/data/filter for the JSX <TreeTable> (libraries -> code templates).
    function treeColumns() {
        return CT_COLUMNS.map((c) => ({
            key: c.key, label: c.label, align: c.align, tree: c.key === 'name', mono: c.key === 'id',
            render: (n) => {
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
            }
        }));
    }

    // Right-click on empty space (below the rows) shows the non-contextual tasks.
    function emptyMenu(e) {
        if (e.target.closest('tr')) return;   // row menus are handled per-row
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => load() },
            '-',
            { label: 'New Code Template', icon: 'plus', onClick: () => newTemplate() },
            { label: 'New Library', icon: 'folder', onClick: () => newLibrary() },
            '-',
            { label: 'Import Code Templates', icon: 'import', onClick: () => importCodeTemplates() },
            { label: 'Import Libraries', icon: 'import', onClick: () => importLibraries() },
            { label: 'Export All Libraries', icon: 'export', onClick: () => exportLibraries() }
        ]);
    }

    // Right-click parity with the Swing Code Templates tree (codeTemplatePopupMenu).
    function nodeMenu(sel, e) {
        e.preventDefault();
        selectNode(sel);
        const isTpl = sel.kind === 'template';
        const isLib = sel.kind === 'library';
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => load() },
            '-',
            { label: 'New Code Template', icon: 'plus', onClick: () => newTemplate() },
            { label: 'New Library', icon: 'folder', onClick: () => newLibrary() },
            '-',
            { label: 'Import Code Templates', icon: 'import', onClick: () => importCodeTemplates() },
            { label: 'Import Libraries', icon: 'import', onClick: () => importLibraries() },
            { label: 'Export Code Template', icon: 'export', hidden: !isTpl, onClick: () => exportTemplate() },
            { label: 'Export Library', icon: 'export', hidden: !isLib, onClick: () => exportLibrary() },
            { label: 'Export All Libraries', icon: 'export', onClick: () => exportLibraries() },
            '-',
            { label: 'Validate Script', icon: 'check', hidden: !isTpl, onClick: () => validateScriptTask() },
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteSelected() },
            '-',
            { label: 'Save All', icon: 'save', onClick: () => saveAll() }
        ]);
    }

    /* ---- imperative editor sub-builders (heavy legacy DOM, reused verbatim) ---- */

    // The library editor (name/include-new + summary/description + channels list).
    function buildLibraryEditor(entry) {
        const { library } = entry;

        const nameInput = textInput(library.name || '', {
            onInput: (e) => { library.name = e.target.value; markDirty(); renderTable(); }
        });
        // Newly created library: focus the empty Name field so the user types immediately.
        if (focusNewNameRef.current) { focusNewNameRef.current = false; setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0); }
        const includeNew = checkbox('Include New Channels', !!library.includeNewChannels, {
            onChange: (e) => { library.includeNewChannels = e.target.checked; markDirty(); }
        });

        // Summary line (Swing shows template-type counts for the library).
        const counts = { FUNCTION: 0, DRAG_AND_DROP_CODE: 0, COMPILED_CODE: 0 };
        for (const t of entry.templates) {
            const type = (t.properties && t.properties.type) || 'FUNCTION';
            if (counts[type] === undefined) counts[type] = 0;
            counts[type]++;
        }
        const summaryText = `${counts.FUNCTION} Function${counts.FUNCTION === 1 ? '' : 's'}, `
            + `${counts.DRAG_AND_DROP_CODE} Drag-and-Drop Code Block${counts.DRAG_AND_DROP_CODE === 1 ? '' : 's'}, `
            + `${counts.COMPILED_CODE} Compiled Code Block${counts.COMPILED_CODE === 1 ? '' : 's'}`;

        const descArea = h('textarea', { onInput: (e) => { library.description = e.target.value; markDirty(); }, class: 'flex-1 min-h-[120px] resize-none' });
        descArea.value = library.description || '';

        const descColumn = h('div', { class: 'flex flex-col flex-1 min-h-0 mr-3.5' },
            h('div', { class: 'mb-2.5 text-[12px] text-text-dim' },
                h('span', { class: 'font-[650]' }, 'Summary: '), summaryText),
            h('label', { class: 'text-[11px] font-[650] tracking-[0.08em] uppercase text-text-dim mb-1.5' }, 'Description'),
            descArea);

        /* ---- Channels panel (Swing's right-hand checkbox list) ---- */
        const channelHost = h('div', { class: 'overflow-auto flex-1' }, loading('Loading channels…'));
        const channelFilter = textInput('', { placeholder: 'Filter…', class: 'w-full mb-1.5' });
        let allRows = [];
        function channelChecked(id) { return idSetOf(library.enabledChannelIds).includes(id); }
        function setChannel(id, on) {
            const enabled = new Set(idSetOf(library.enabledChannelIds));
            const disabled = new Set(idSetOf(library.disabledChannelIds));
            if (on) { enabled.add(id); disabled.delete(id); } else { enabled.delete(id); disabled.add(id); }
            library.enabledChannelIds = toIdSet([...enabled]);
            library.disabledChannelIds = toIdSet([...disabled]);
            markDirty();
        }
        function paintChannels() {
            clear(channelHost);
            const term = channelFilter.value.trim().toLowerCase();
            const rows = allRows.filter(r => !term || r.name.toLowerCase().includes(term));
            if (!rows.length) { channelHost.appendChild(h('div.text-text-faint', allRows.length ? 'No matches' : 'No channels')); return; }
            for (const row of rows) {
                const cb = checkbox(row.name, channelChecked(row.id), { onChange: (e) => setChannel(row.id, e.target.checked) });
                channelHost.appendChild(h('div', cb.el));
            }
        }
        function setAllChannels(on) {
            const term = channelFilter.value.trim().toLowerCase();
            for (const row of allRows) { if (!term || row.name.toLowerCase().includes(term)) setChannel(row.id, on); }
            paintChannels();
        }
        channelFilter.addEventListener('input', paintChannels);

        const channelsPanel = h('div', { class: 'w-[300px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5' },
            h('div', { class: 'flex items-baseline justify-between mb-2' },
                h('label', { class: 'text-[11px] font-[650] tracking-[0.08em] uppercase text-text-dim' }, 'Channels'),
                h('span', { class: 'text-[11px]' },
                    h('a', { href: '#', class: 'text-accent', onClick: (e) => { e.preventDefault(); setAllChannels(true); } }, 'Select All'),
                    h('span', { class: 'text-text-faint my-0 mx-1.5' }, '|'),
                    h('a', { href: '#', class: 'text-accent', onClick: (e) => { e.preventDefault(); setAllChannels(false); } }, 'Deselect All'))),
            channelFilter,
            channelHost);

        api.channels.idsAndNames().then(map => {
            const entries = api.asList(map && map.entry);
            allRows = entries.map(en => {
                const pair = api.asList(en.string);
                return { id: String(pair[0] ?? ''), name: String(pair[1] ?? pair[0] ?? '') };
            }).sort((a, b) => a.name.localeCompare(b.name));
            paintChannels();
        }).catch(e => {
            clear(channelHost).appendChild(h('div.text-text-faint', `Channels unavailable: ${e.message}`));
        });

        return h('div', { class: 'flex flex-col flex-1 min-h-0' },
            h('div.form-grid', { class: 'mb-3' },
                field('Name', nameInput),
                h('div.field', { class: 'justify-end' }, includeNew.el)),
            h('div', { class: 'flex flex-1 min-h-0' },
                descColumn,
                channelsPanel));
    }

    // The template's Name / Library / Type form row.
    function buildTemplateForm(entry, template) {
        if (!template.properties || typeof template.properties !== 'object') {
            template.properties = { '@class': PROPERTIES_CLASS, type: 'FUNCTION', code: '' };
        }
        const nameInput = textInput(template.name || '', {
            onInput: (e) => { template.name = e.target.value; markDirty(); renderTable(); }
        });
        // Newly created template: focus the Name field so the user types immediately.
        if (focusNewNameRef.current) { focusNewNameRef.current = false; setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0); }

        // Library dropdown — Swing lets you move a template between libraries here.
        const librarySelect = select(
            librariesRef.current.map(en => ({ value: en.library.id, label: en.library.name || '(unnamed library)' })),
            entry.library.id, {
            onChange: (e) => {
                const targetId = e.target.value;
                if (targetId === entry.library.id) return;
                const target = librariesRef.current.find(en => en.library.id === targetId);
                if (!target) return;
                entry.templates = entry.templates.filter(t => t !== template);
                target.templates.push(template);
                collapsedRef.current.delete('library:' + targetId);
                selectedRef.current = { kind: 'template', id: template.id };
                markDirty();
                renderTable();
                forceRender();
            }
        });

        const typeSelect = select(TEMPLATE_TYPES, template.properties.type || 'FUNCTION', {
            onChange: (e) => { template.properties.type = e.target.value; markDirty(); }
        });

        return h('div.form-grid', { class: 'mb-3' },
            field('Name', nameInput),
            field('Library', librarySelect),
            field('Type', typeSelect));
    }

    // The template's Context checkbox tree (Swing's right-hand panel).
    function buildContextPanel(template) {
        const contextChecks = new Map();   // type -> input
        function applyContexts() {
            const types = ALL_CONTEXTS.filter(t => contextChecks.get(t).checked);
            setContexts(template, types);
            markDirty();
        }
        const groupNodes = CONTEXT_GROUPS.map(group => {
            const itemChecks = [];
            const items = group.types.map(([type, label]) => {
                const cb = checkbox(label, contextsOf(template).includes(type), { onChange: () => { applyContexts(); syncGroup(); } });
                contextChecks.set(type, cb.input);
                itemChecks.push(cb.input);
                return h('div', { class: 'pl-5' }, cb.el);
            });
            const groupCb = checkbox(group.label, false, {
                onChange: (e) => { itemChecks.forEach(i => { i.checked = e.target.checked; }); applyContexts(); }
            });
            function syncGroup() {
                const on = itemChecks.filter(i => i.checked).length;
                groupCb.input.checked = on === itemChecks.length && on > 0;
                groupCb.input.indeterminate = on > 0 && on < itemChecks.length;
            }
            syncGroup();
            return { el: h('div', { class: 'mb-1.5' }, h('div', groupCb.el), ...items), syncGroup };
        });
        function setAll(value) {
            contextChecks.forEach(i => { i.checked = value; });
            groupNodes.forEach(g => g.syncGroup());
            applyContexts();
        }
        return h('div', { class: 'w-[260px] flex-none flex flex-col min-h-0 border-l border-line pl-3.5' },
            h('div', { class: 'flex items-baseline justify-between mb-2' },
                h('label', { class: 'text-[11px] font-[650] tracking-[0.08em] uppercase text-text-dim' }, 'Context'),
                h('span', { class: 'text-[11px]' },
                    h('a', { href: '#', class: 'text-accent', onClick: (e) => { e.preventDefault(); setAll(true); } }, 'Select All'),
                    h('span', { class: 'text-text-faint my-0 mx-1.5' }, '|'),
                    h('a', { href: '#', class: 'text-accent', onClick: (e) => { e.preventDefault(); setAll(false); } }, 'Deselect All'))),
            h('div', { class: 'overflow-auto flex-1' }, ...groupNodes.map(g => g.el)));
    }

    /* ---- tasks --------------------------------------------------------------------- */

    function newLibrary() {
        // No name prompt — create the library and select it with the empty Name
        // field focused (the library editor focuses it when focusNewName is set).
        const library = {
            '@version': store.getState('serverVersion') || '4.6.0',
            id: uuid(),
            name: '',
            revision: 0,
            description: '',
            includeNewChannels: false,
            enabledChannelIds: '',
            disabledChannelIds: '',
            codeTemplates: null
        };
        librariesRef.current.push({ library, templates: [] });
        selectedRef.current = { kind: 'library', id: library.id };
        focusNewNameRef.current = true;
        markDirty();
        renderTable();
        forceRender();
    }

    function newTemplate() {
        const found = findSelected();
        const entry = found && found.entry;
        if (!entry) {
            toast('Select a library first', 'warn');
            return;
        }
        const v = store.getState('serverVersion') || '4.6.0';
        const template = {
            // '@version' is required: the engine migrates every write and
            // 500s when it's absent.
            '@version': v,
            id: uuid(),
            name: 'New Code Template',
            revision: 0,
            contextSet: { delegate: { contextType: [...ALL_CONTEXTS] } },
            properties: { '@class': PROPERTIES_CLASS, '@version': v, type: 'FUNCTION', code: DEFAULT_CODE }
        };
        entry.templates.push(template);
        selectedRef.current = { kind: 'template', id: template.id };
        focusNewNameRef.current = true;
        markDirty();
        renderTable();
        forceRender();
    }

    async function deleteSelected() {
        const found = findSelected();
        if (!found) { toast('Select a library or code template first', 'warn'); return; }
        const selected = selectedRef.current;

        if (selected.kind === 'library') {
            const { entry } = found;
            const count = entry.templates.length;
            const message = count
                ? `Delete library "${entry.library.name}" and its ${count} code template(s)? Save All commits the removal.`
                : `Delete library "${entry.library.name}"? Save All commits the removal.`;
            if (!await confirmDialog('Delete Library', message, { danger: true, okLabel: 'Delete' })) return;
            for (const template of entry.templates) {
                try { await api.codeTemplates.remove(template.id); } catch { /* not yet saved */ }
            }
            librariesRef.current = librariesRef.current.filter(en => en !== entry);
        } else {
            const { entry, template } = found;
            if (!await confirmDialog('Delete Code Template', `Delete code template "${template.name}"?`, { danger: true, okLabel: 'Delete' })) return;
            try { await api.codeTemplates.remove(template.id); } catch { /* not yet saved */ }
            entry.templates = entry.templates.filter(t => t !== template);
        }
        invalidateCompletions();   // deleted templates no longer autocomplete
        selectedRef.current = null;
        markDirty();
        renderTable();
        forceRender();
        toast('Deleted — use Save All to commit library changes');
    }

    async function saveAll() {
        try {
            const v = store.getState('serverVersion') || '4.6.0';
            const libraries = librariesRef.current;
            // 1. PUT each template individually (the Swing client's update path).
            for (const entry of libraries) {
                for (const template of entry.templates) {
                    // Defensive: the engine's migrator 500s without '@version'.
                    if (!template['@version']) template['@version'] = v;
                    if (template.properties && !template.properties['@version']) template.properties['@version'] = v;
                    template.revision = (Number(template.revision) || 0) + 1;
                    await api.codeTemplates.update(template.id, template);
                }
            }
            // 2. PUT the full library set with id-only template references.
            const payload = libraries.map(entry => ({
                '@version': entry.library['@version'] || v,
                ...entry.library,
                revision: (Number(entry.library.revision) || 0) + 1,
                codeTemplates: entry.templates.length
                    // id-only refs, but '@version' is still required — the
                    // engine migrates every nested model and 500s without it.
                    ? { codeTemplate: entry.templates.map(t => ({ '@version': t['@version'] || v, id: t.id })) }
                    : null
            }));
            await api.codeTemplates.updateLibraries(payload);
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast('Code templates saved');
            await load();
        } catch (e) {
            toast(`Save failed: ${e.message}`, 'error');
        }
    }

    /* ---- import / export (Swing-compatible XStream XML) ----------------------------- */

    async function exportLibraries() {
        try {
            await saveFile('codeTemplateLibraries.xml', 'application/xml',
                () => api.getXml('/codeTemplateLibraries', { includeCodeTemplates: true }));
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function exportLibrary() {
        const found = findSelected();
        if (!found || selectedRef.current.kind !== 'library') {
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
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function exportTemplate() {
        const found = findSelected();
        if (!found || selectedRef.current.kind !== 'template') {
            toast('Select a code template first', 'warn');
            return;
        }
        try {
            await saveFile(`${found.template.name || found.template.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/codeTemplates/${found.template.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Template not found on the server — save it first');
                return xml;
            });
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    /* Accepts a Swing/web export: a <list> of <codeTemplateLibrary> (or one
       bare <codeTemplateLibrary>). PUT /codeTemplateLibraries persists only the
       library records — embedded templates are reduced to id references by the
       server — so each embedded <codeTemplate> element is PUT individually
       first (the same order the Swing client saves in). */
    async function importLibraries() {
        const file = await pickFile('.xml');
        if (!file) return;
        if (!await confirmDialog('Import Libraries',
            `Import "${file.name}"? This replaces the entire code template library list on the server — libraries not present in the file will be removed.`,
            { danger: true, okLabel: 'Import' })) return;
        try {
            let xml = String(file.content || '').trim();
            const doc = new DOMParser().parseFromString(xml, 'text/xml');
            if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
            const root = doc.documentElement;
            if (root.tagName === 'codeTemplateLibrary') {
                // Single-library export: wrap into the <list> the PUT expects.
                xml = `<list>${new XMLSerializer().serializeToString(root)}</list>`;
            } else if (root.tagName !== 'list') {
                throw new Error('Expected a <list> of <codeTemplateLibrary> elements');
            }
            // Full templates (more than an <id> ref) are saved individually.
            const fullTemplates = [...doc.querySelectorAll('codeTemplates > codeTemplate')]
                .filter(el => [...el.children].some(c => c.tagName !== 'id'));
            for (const el of fullTemplates) {
                const id = [...el.children].find(c => c.tagName === 'id')?.textContent;
                if (!id) continue;
                await api.putXml(`/codeTemplates/${encodeURIComponent(id)}`,
                    new XMLSerializer().serializeToString(el), { override: true });
            }
            await api.putXml('/codeTemplateLibraries', xml, { override: true });
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast(`Imported ${file.name}`);
            selectedRef.current = null;
            await load();
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    /* Import individual code templates into the selected library (Swing's
       "Import Code Templates"). Each <codeTemplate> is PUT to the server, then
       the target library's references are rewritten — so this commits like
       Import Libraries rather than editing the working copy. */
    async function importCodeTemplates() {
        const found = findSelected();
        let target = found && found.entry;
        if (!target) {
            if (librariesRef.current.length === 1) target = librariesRef.current[0];
            else { toast('Select a library to import into first', 'warn'); return; }
        }
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

            const v = store.getState('serverVersion') || '4.6.0';
            const newIds = [];
            for (const el of els) {
                let id = [...el.children].find(c => c.tagName === 'id')?.textContent;
                if (!id) {
                    id = uuid();
                    const idEl = doc.createElement('id');
                    idEl.textContent = id;
                    el.insertBefore(idEl, el.firstChild);
                }
                await api.putXml(`/codeTemplates/${encodeURIComponent(id)}`,
                    new XMLSerializer().serializeToString(el), { override: true });
                newIds.push(id);
            }
            // Rewrite the library set with the new refs appended to the target.
            const payload = librariesRef.current.map(entry => {
                const ids = entry === target
                    ? [...entry.templates.map(t => t.id), ...newIds]
                    : entry.templates.map(t => t.id);
                return {
                    '@version': entry.library['@version'] || v,
                    ...entry.library,
                    revision: (Number(entry.library.revision) || 0) + 1,
                    codeTemplates: ids.length ? { codeTemplate: ids.map(id => ({ '@version': v, id })) } : null
                };
            });
            await api.codeTemplates.updateLibraries(payload);
            invalidateCompletions();   // script editors refetch the new scope on next focus
            toast(`Imported ${els.length} code template${els.length === 1 ? '' : 's'} into "${target.library.name || 'library'}"`);
            await load();
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    /* Validate Script (Swing) — real Rhino compile check of the selected
       template's code via the engine bridge. */
    async function validateScriptTask() {
        const found = findSelected();
        if (!found || selectedRef.current.kind !== 'template') { toast('Select a code template first', 'warn'); return; }
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

    /* ---- mount: load ---- */

    useEffect(() => {
        load();
        // Prompt before leaving with unsaved library/template edits (Swing parity).
        store.setState('navGuard', async () => {
            if (!dirtyRef.current) return;
            const ok = await confirmDialog('Unsaved Changes',
                'You have unsaved code template changes. Leave without saving?',
                { danger: true, okLabel: 'Leave' });
            return ok ? undefined : false;
        });
        return () => store.setState('navGuard', null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Selection-dependent task visibility (Swing Code Template Tasks pane).
    const found = findSelected();
    const selected = selectedRef.current;
    const isTemplate = !!found && selected && selected.kind === 'template';
    const isLibrary = !!found && selected && selected.kind === 'library';
    const dirty = dirtyRef.current;

    // Tree data + filter for the <TreeTable>.
    const treeData = librariesRef.current.map((entry) => ({
        kind: 'library', id: entry.library.id, lib: entry.library,
        children: entry.templates.map((t) => ({ kind: 'template', id: t.id, tpl: t }))
    }));
    const term = filterRef.current.trim().toLowerCase();
    const ctMatches = term
        ? (n) => (n.kind === 'library' ? (n.lib.name || '').toLowerCase().includes(term) : templateMatches(n.tpl, term))
        : undefined;
    const totalTemplates = librariesRef.current.reduce((sum, en) => sum + en.templates.length, 0);
    const countsText = `${librariesRef.current.length} Librar${librariesRef.current.length === 1 ? 'y' : 'ies'}, ${totalTemplates} Code Template${totalTemplates === 1 ? '' : 's'}`;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Code Template Tasks" paneKey="tasks:Code Template Tasks">
                    <div className="taskbar" data-pane-title="Code Template Tasks">
                        <TaskButton label="Refresh" icon="refresh" onClick={refreshTask} />
                        {dirty && <TaskButton label="Save Changes" icon="save" primary onClick={saveAll} />}
                        {found && <TaskButton label="New Code Template" icon="plus" onClick={newTemplate} />}
                        <TaskButton label="New Library" icon="folder" onClick={newLibrary} />
                        <TaskButton label="Import Code Templates" icon="import" onClick={importCodeTemplates} />
                        <TaskButton label="Import Libraries" icon="import" onClick={importLibraries} />
                        {isTemplate && <TaskButton label="Export Code Template" icon="export" onClick={exportTemplate} />}
                        {isLibrary && <TaskButton label="Export Library" icon="export" onClick={exportLibrary} />}
                        {isTemplate && <TaskButton label="Delete Code Template" icon="trash" danger onClick={deleteSelected} />}
                        {isLibrary && <TaskButton label="Delete Library" icon="trash" danger onClick={deleteSelected} />}
                        {isTemplate && <TaskButton label="Validate Script" icon="check" onClick={validateScriptTask} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex">
                {/* Top: libraries/templates tree-table + filter bar; bottom: editor.
                    When maximized, the top pane (data-editor-overtake) is hidden so the
                    editor fills the column; the right Context panel stays. */}
                <div className={'split vertical flex-1 min-w-0' + (editorMax ? ' is-editor-max' : '')}>
                    <div className="split-a h-[320px] flex-none flex flex-col min-h-0" data-editor-overtake>
                        <div className="flex-1 min-h-0 overflow-auto">
                            <TreeTable
                                data={treeData}
                                columns={treeColumns()}
                                getChildren={(n) => n.children}
                                rowKey={(n) => `${n.kind}:${n.id}`}
                                rowClassName={(n) => (n.kind === 'library' ? 'group-row' : '')}
                                selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
                                onSelect={(n) => selectNode({ kind: n.kind, id: n.id })}
                                onRowContextMenu={(n, e) => nodeMenu({ kind: n.kind, id: n.id }, e)}
                                onEmptyContextMenu={emptyMenu}
                                matches={ctMatches}
                                collapsedKeys={collapsedRef.current}
                                onToggleCollapse={(key) => { const s = collapsedRef.current; if (s.has(key)) s.delete(key); else s.add(key); forceRender(); }}
                                columnsKey="codetemplates"
                                columnWidths={CT_COL_WIDTHS}
                                defaultHidden={['id']}
                                pinnedKeys={['name']}
                                emptyText="No code template libraries" />
                        </div>
                        <div className="filterbar flex-none">
                            <span className="counts">{countsText}</span>
                            <span className="ml-auto inline-flex items-center gap-1.5">
                                <label>Filter:</label>
                                <input type="text" placeholder="Filter…" className="max-w-[260px]"
                                    onInput={(e) => { filterRef.current = e.target.value; renderTable(); }} />
                            </span>
                        </div>
                    </div>
                    <div className="split-handle" data-orient="v" data-resize="prev" data-editor-overtake />
                    <div className="split-b flex flex-col min-h-0">
                        <div className="flex flex-col flex-1 min-h-0 py-3.5 px-4 overflow-auto">
                            <EditorPane found={found} kind={selected && selected.kind}
                                buildLibraryEditor={buildLibraryEditor}
                                buildTemplateForm={buildTemplateForm}
                                buildContextPanel={buildContextPanel}
                                markDirty={markDirty}
                                maximized={editorMax}
                                onToggleMax={() => setEditorMax((m) => !m)} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* The editor pane. Branches on the current selection. The library editor and the
   template's Name/Library/Type form + Context checkbox tree are heavy legacy DOM
   reused verbatim via <ImperativeMount>; the template's code uses the React
   <CodeEditor> island. Keyed on the selected id so it rebuilds per selection. */
function EditorPane({ found, kind, buildLibraryEditor, buildTemplateForm, buildContextPanel, markDirty, maximized, onToggleMax }) {
    if (!found) {
        return (
            <div className="dt-empty">
                <div className="empty-icon"><Icon name="code" size={30} /></div>
                <div>Select a library or code template</div>
            </div>
        );
    }
    if (kind === 'library') {
        return <ImperativeMount key={'lib:' + found.entry.library.id} build={() => buildLibraryEditor(found.entry)} />;
    }
    return <TemplateEditor key={'tpl:' + found.template.id} entry={found.entry} template={found.template}
        buildTemplateForm={buildTemplateForm} buildContextPanel={buildContextPanel} markDirty={markDirty}
        maximized={maximized} onToggleMax={onToggleMax} />;
}

function TemplateEditor({ entry, template, buildTemplateForm, buildContextPanel, markDirty, maximized, onToggleMax }) {
    // Maximize (state lifted to the view so it can also hide the library list above)
    // grows the Code editor over the Name/Library/Type form, which is tagged
    // data-editor-overtake, while the right-hand Context panel stays visible.
    return (
        <div className="flex flex-col flex-1 min-h-0">
            <div data-editor-overtake style={{ flex: 'none' }}>
                <ImperativeMount build={() => buildTemplateForm(entry, template)} />
            </div>
            <div className="flex flex-1 min-h-0">
                <div className="flex flex-col flex-1 min-h-0 mr-3.5">
                    <div className="flex items-center mb-1.5">
                        <label className="text-[11px] font-[650] tracking-[0.08em] uppercase text-text-dim">Code</label>
                        <button type="button" className="icon-btn ml-auto"
                            title={maximized ? 'Restore editor (Esc)' : 'Maximize editor'}
                            onClick={onToggleMax}>
                            <Icon name={maximized ? 'minimize' : 'maximize'} size={15} />
                        </button>
                    </div>
                    <CodeEditor language="javascript"
                        defaultValue={template.properties.code || ''}
                        onChange={(v) => { template.properties.code = v; markDirty(); }}
                        style={{ flex: 1, minHeight: '200px' }} />
                </div>
                <ImperativeMount build={() => buildContextPanel(template)} style={{ width: '260px', flex: 'none' }} />
            </div>
        </div>
    );
}
