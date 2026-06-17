/*
 * Code Templates — library/template tree editor (parity with the Swing
 * Administrator's code template panel).
 *
 * Model notes (com.mirth.connect.model.codetemplates):
 *   CodeTemplateLibrary { id, name, revision, lastModified, description,
 *       includeNewChannels, enabledChannelIds {string:[...]},
 *       disabledChannelIds {string:[...]}, codeTemplates {codeTemplate:[...]} }
 *   CodeTemplate { id, name, revision, lastModified,
 *       contextSet {delegate:{contextType:[...]}},
 *       properties { '@class', type, code } }
 *
 * Saving mirrors the Swing client: each template is PUT individually
 * (/codeTemplates/{id}?override=true), then the libraries are PUT as a full
 * set (/codeTemplateLibraries?override=true) with id-only template references
 * — the server replaces refs with ids anyway (replaceCodeTemplatesWithIds).
 */

import { h, clear, icon, toast, taskButton, confirmDialog, field, textInput, checkbox, select, loading, saveFile, pickFile, contextMenu, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';
import { uuid } from '@oie/web-api';
import { validateScript } from '../core/serialize.js';
import { invalidate as invalidateCompletions } from '../core/script-completions.js';
import { createColumnManager, decorateColumns, attachColumnMenu } from '@oie/web-ui';

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

export function register(platform) {
    // Reached via task buttons (Dashboard/Channels), matching the Swing client.
    platform.registerView('/code-templates', () => renderCodeTemplates(platform), { title: 'Code Templates' });
}

/* ---- XStream shape helpers --------------------------------------------------- */

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

function renderCodeTemplates(platform) {
    let libraries = [];          // [{ library, templates: [...] }] working copies
    let selected = null;         // { kind: 'library'|'template', id }
    let dirty = false;
    let filterText = '';
    let focusNewName = false;     // focus the Name field after creating a library/template
    const collapsed = new Set(); // collapsed library ids

    const tableHost = h('div.dt-wrap', { style: { flex: '1', minHeight: '0' } }, loading('Loading…'));
    // Swing hides Id (and Type) by default — only Name/Description/Revision/Last
    // Modified show until the user enables more via the column menu.
    const colMgr = createColumnManager('codetemplates', CT_COL_WIDTHS, ['id']);
    // Right-click on empty space (below the rows) shows the non-contextual tasks.
    tableHost.addEventListener('contextmenu', (e) => {
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
    });
    const countsLabel = h('span.counts');
    const filterInput = textInput('', {
        placeholder: 'Filter…',
        style: { maxWidth: '260px' },
        onInput: (e) => { filterText = e.target.value; renderTable(); }
    });
    const editorHost = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', padding: '14px 16px', overflow: 'auto' } });

    function markDirty() { dirty = true; updateTaskVisibility(); }

    /* ---- data ------------------------------------------------------------------ */

    async function load() {
        try {
            const list = await api.codeTemplates.libraries(true);
            libraries = list.map(library => ({ library, templates: templatesOf(library) }));
            dirty = false;
            if (selected && !findSelected()) selected = null;
            renderTable();
            renderEditor();
            updateTaskVisibility();
        } catch (e) {
            toast(`Load failed: ${e.message}`, 'error');
        }
    }

    function findSelected() {
        if (!selected) return null;
        for (const entry of libraries) {
            if (selected.kind === 'library' && entry.library.id === selected.id) return { entry };
            if (selected.kind === 'template') {
                const template = entry.templates.find(t => t.id === selected.id);
                if (template) return { entry, template };
            }
        }
        return null;
    }

    /* ---- table (Swing Code Templates tree-table) -------------------------------- */

    function selectNode(sel) {
        selected = sel; renderTable(); renderEditor(); updateTaskVisibility();
    }

    function templateMatches(template, term) {
        if (!term) return true;
        return (template.name || '').toLowerCase().includes(term)
            || (template.id || '').toLowerCase().includes(term)
            || templateDescription(template).toLowerCase().includes(term);
    }

    function renderTable() {
        clear(tableHost);
        const total = libraries.reduce((n, en) => n + en.templates.length, 0);
        countsLabel.textContent = `${libraries.length} Librar${libraries.length === 1 ? 'y' : 'ies'}, ${total} Code Template${total === 1 ? '' : 's'}`;

        if (!libraries.length) {
            tableHost.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('code', 30)),
                h('div', 'No code template libraries')));
            return;
        }

        const term = filterText.trim().toLowerCase();
        // Render only the columns the user hasn't hidden, in canonical order.
        const visibleCols = CT_COLUMNS.filter(c => !colMgr.isHidden(c.key));

        // One cell per visible column for a library or template row. `twisty` is
        // the expand/collapse control that lives in the (pinned) Name cell of a
        // library row.
        function cellFor(col, node, kind, twisty) {
            switch (col.key) {
                case 'name':
                    return kind === 'library'
                        ? h('td', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                            twisty, icon('folder', 14), h('span', node.name || '(unnamed library)')))
                        : h('td', h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', paddingLeft: '22px' } },
                            icon('file', 14), h('span', node.name || '(unnamed template)')));
                case 'id': return h('td.mono', node.id || '');
                case 'description': return h('td', kind === 'library' ? (node.description || '') : templateDescription(node));
                case 'revision': return h('td', { style: { textAlign: 'right' } }, String(node.revision ?? ''));
                case 'lastModified': return h('td', fmtDate(node.lastModified));
                default: return h('td', '');
            }
        }

        const thead = h('thead', h('tr',
            visibleCols.map(c => h('th', c.align === 'right' ? { style: { textAlign: 'right' } } : null, c.label))));
        const tbody = h('tbody');

        for (const entry of libraries) {
            const lib = entry.library;
            const matchingTemplates = entry.templates.filter(t => templateMatches(t, term));
            const libNameMatch = !term || (lib.name || '').toLowerCase().includes(term);
            if (term && !libNameMatch && !matchingTemplates.length) continue;

            const isCollapsed = collapsed.has(lib.id);
            const libSel = { kind: 'library', id: lib.id };
            const selLib = selected && selected.kind === 'library' && selected.id === lib.id;
            const twisty = h('span.twisty', { style: { cursor: 'pointer' }, onClick: (e) => {
                e.stopPropagation();
                if (collapsed.has(lib.id)) collapsed.delete(lib.id); else collapsed.add(lib.id);
                renderTable();
            } }, isCollapsed ? '▸' : '▾');
            tbody.appendChild(h(`tr.group-row${selLib ? '.selected' : ''}`, {
                onClick: () => selectNode(libSel),
                onContextMenu: (e) => nodeMenu(libSel, e)
            }, visibleCols.map(c => cellFor(c, lib, 'library', twisty))));

            if (isCollapsed) continue;
            const shown = term ? matchingTemplates : entry.templates;
            for (const template of shown) {
                const tSel = selected && selected.kind === 'template' && selected.id === template.id;
                const tplSel = { kind: 'template', id: template.id };
                tbody.appendChild(h(`tr${tSel ? '.selected' : ''}`, {
                    onClick: () => selectNode(tplSel),
                    onContextMenu: (e) => nodeMenu(tplSel, e)
                }, visibleCols.map(c => cellFor(c, template, 'template'))));
            }
        }

        const table = h('table.dt', thead, tbody);
        tableHost.appendChild(table);
        decorateColumns(table, { manager: colMgr, presentKeys: visibleCols.map(c => c.key), onChange: renderTable });
        // Name holds the tree twisty, so it can't be hidden (Swing's hierarchical column).
        attachColumnMenu(thead, { manager: colMgr, columns: CT_COLUMNS, onChange: renderTable, pinnedKeys: ['name'] });
    }

    // Right-click parity with the Swing Code Templates tree (codeTemplatePopupMenu).
    function nodeMenu(sel, e) {
        e.preventDefault();
        selectNode(sel);
        const isTemplate = sel.kind === 'template';
        const isLibrary = sel.kind === 'library';
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => load() },
            '-',
            { label: 'New Code Template', icon: 'plus', onClick: () => newTemplate() },
            { label: 'New Library', icon: 'folder', onClick: () => newLibrary() },
            '-',
            { label: 'Import Code Templates', icon: 'import', onClick: () => importCodeTemplates() },
            { label: 'Import Libraries', icon: 'import', onClick: () => importLibraries() },
            { label: 'Export Code Template', icon: 'export', hidden: !isTemplate, onClick: () => exportTemplate() },
            { label: 'Export Library', icon: 'export', hidden: !isLibrary, onClick: () => exportLibrary() },
            { label: 'Export All Libraries', icon: 'export', onClick: () => exportLibraries() },
            '-',
            { label: 'Validate Script', icon: 'check', hidden: !isTemplate, onClick: () => validateScriptTask() },
            { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteSelected() },
            '-',
            { label: 'Save All', icon: 'check', onClick: () => saveAll() }
        ]);
    }

    /* ---- editors ----------------------------------------------------------------- */

    function renderEditor() {
        clear(editorHost);
        const found = findSelected();
        if (!found) {
            editorHost.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('code', 30)),
                h('div', 'Select a library or code template')));
            return;
        }
        if (selected.kind === 'library') renderLibraryEditor(found.entry);
        else renderTemplateEditor(found.entry, found.template);
    }

    function renderLibraryEditor(entry) {
        const { library } = entry;

        const nameInput = textInput(library.name || '', {
            onInput: (e) => { library.name = e.target.value; markDirty(); renderTable(); }
        });
        // Newly created library: focus the empty Name field so the user types immediately.
        if (focusNewName) { focusNewName = false; setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0); }
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

        const descArea = h('textarea', { onInput: (e) => { library.description = e.target.value; markDirty(); }, style: { flex: '1', minHeight: '120px', resize: 'none' } });
        descArea.value = library.description || '';

        const descColumn = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', marginRight: '14px' } },
            h('div', { style: { marginBottom: '10px', fontSize: '12px', color: 'var(--text-dim)' } },
                h('span', { style: { fontWeight: '650' } }, 'Summary: '), summaryText),
            h('label', { style: { fontSize: '11px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '6px' } }, 'Description'),
            descArea);

        /* ---- Channels panel (Swing's right-hand checkbox list) ---- */
        const channelHost = h('div', { style: { overflow: 'auto', flex: '1' } }, loading('Loading channels…'));
        const channelFilter = textInput('', { placeholder: 'Filter…', style: { width: '100%', marginBottom: '6px' } });
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
            if (!rows.length) { channelHost.appendChild(h('div.faint', allRows.length ? 'No matches' : 'No channels')); return; }
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

        const channelsPanel = h('div', { style: { width: '300px', flex: 'none', display: 'flex', flexDirection: 'column', minHeight: '0', borderLeft: '1px solid var(--line)', paddingLeft: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' } },
                h('label', { style: { fontSize: '11px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' } }, 'Channels'),
                h('span', { style: { fontSize: '11px' } },
                    h('a', { href: '#', style: { color: 'var(--accent)' }, onClick: (e) => { e.preventDefault(); setAllChannels(true); } }, 'Select All'),
                    h('span', { style: { color: 'var(--text-faint)', margin: '0 6px' } }, '|'),
                    h('a', { href: '#', style: { color: 'var(--accent)' }, onClick: (e) => { e.preventDefault(); setAllChannels(false); } }, 'Deselect All'))),
            channelFilter,
            channelHost);

        editorHost.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
            h('div.form-grid', { style: { marginBottom: '12px' } },
                field('Name', nameInput),
                h('div.field', { style: { justifyContent: 'flex-end' } }, includeNew.el)),
            h('div', { style: { display: 'flex', flex: '1', minHeight: '0' } },
                descColumn,
                channelsPanel)));

        api.channels.idsAndNames().then(map => {
            const entries = api.asList(map && map.entry);
            allRows = entries.map(en => {
                const pair = api.asList(en.string);
                return { id: String(pair[0] ?? ''), name: String(pair[1] ?? pair[0] ?? '') };
            }).sort((a, b) => a.name.localeCompare(b.name));
            paintChannels();
        }).catch(e => {
            clear(channelHost).appendChild(h('div.faint', `Channels unavailable: ${e.message}`));
        });
    }

    function renderTemplateEditor(entry, template) {
        if (!template.properties || typeof template.properties !== 'object') {
            template.properties = { '@class': PROPERTIES_CLASS, type: 'FUNCTION', code: '' };
        }

        const nameInput = textInput(template.name || '', {
            onInput: (e) => { template.name = e.target.value; markDirty(); renderTable(); }
        });
        // Newly created template: focus the Name field so the user types immediately.
        if (focusNewName) { focusNewName = false; setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0); }

        // Library dropdown — Swing lets you move a template between libraries here.
        const librarySelect = select(
            libraries.map(en => ({ value: en.library.id, label: en.library.name || '(unnamed library)' })),
            entry.library.id, {
            onChange: (e) => {
                const targetId = e.target.value;
                if (targetId === entry.library.id) return;
                const target = libraries.find(en => en.library.id === targetId);
                if (!target) return;
                entry.templates = entry.templates.filter(t => t !== template);
                target.templates.push(template);
                collapsed.delete(targetId);
                markDirty();
                renderTable();
            }
        });

        const typeSelect = select(TEMPLATE_TYPES, template.properties.type || 'FUNCTION', {
            onChange: (e) => { template.properties.type = e.target.value; markDirty(); }
        });

        /* ---- Context panel (Swing's checkbox tree + Select All / Deselect All) ---- */
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
                return h('div', { style: { paddingLeft: '20px' } }, cb.el);
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
            return { el: h('div', { style: { marginBottom: '6px' } }, h('div', groupCb.el), ...items), syncGroup };
        });
        function setAll(value) {
            contextChecks.forEach(i => { i.checked = value; });
            groupNodes.forEach(g => g.syncGroup());
            applyContexts();
        }
        const contextPanel = h('div', { style: { width: '260px', flex: 'none', display: 'flex', flexDirection: 'column', minHeight: '0', borderLeft: '1px solid var(--line)', paddingLeft: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' } },
                h('label', { style: { fontSize: '11px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' } }, 'Context'),
                h('span', { style: { fontSize: '11px' } },
                    h('a', { href: '#', style: { color: 'var(--accent)' }, onClick: (e) => { e.preventDefault(); setAll(true); } }, 'Select All'),
                    h('span', { style: { color: 'var(--text-faint)', margin: '0 6px' } }, '|'),
                    h('a', { href: '#', style: { color: 'var(--accent)' }, onClick: (e) => { e.preventDefault(); setAll(false); } }, 'Deselect All'))),
            h('div', { style: { overflow: 'auto', flex: '1' } }, ...groupNodes.map(g => g.el)));

        const editor = platform.createCodeEditor({
            value: template.properties.code || '',
            language: 'javascript',
            onChange: (value) => { template.properties.code = value; markDirty(); }
        });
        editor.el.style.flex = '1';
        editor.el.style.minHeight = '200px';

        const codeColumn = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', marginRight: '14px' } },
            h('label', { style: { fontSize: '11px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: '6px' } }, 'Code'),
            editor.el);

        editorHost.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
            h('div.form-grid', { style: { marginBottom: '12px' } },
                field('Name', nameInput),
                field('Library', librarySelect),
                field('Type', typeSelect)),
            h('div', { style: { display: 'flex', flex: '1', minHeight: '0' } },
                codeColumn,
                contextPanel)));
    }

    /* ---- tasks --------------------------------------------------------------------- */

    function newLibrary() {
        // No name prompt — create the library and select it with the empty Name
        // field focused (the library editor focuses it when focusNewName is set).
        const library = {
            '@version': platform.store.getState('serverVersion') || '4.6.0',
            id: uuid(),
            name: '',
            revision: 0,
            description: '',
            includeNewChannels: false,
            enabledChannelIds: '',
            disabledChannelIds: '',
            codeTemplates: null
        };
        libraries.push({ library, templates: [] });
        selected = { kind: 'library', id: library.id };
        focusNewName = true;
        markDirty();
        renderTable();
        renderEditor();
        updateTaskVisibility();
    }

    function newTemplate() {
        const found = findSelected();
        const entry = found && found.entry;
        if (!entry) {
            toast('Select a library first', 'warn');
            return;
        }
        const v = platform.store.getState('serverVersion') || '4.6.0';
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
        selected = { kind: 'template', id: template.id };
        focusNewName = true;
        markDirty();
        renderTable();
        renderEditor();
        updateTaskVisibility();
    }

    async function deleteSelected() {
        const found = findSelected();
        if (!found) { toast('Select a library or code template first', 'warn'); return; }

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
            libraries = libraries.filter(en => en !== entry);
        } else {
            const { entry, template } = found;
            if (!await confirmDialog('Delete Code Template', `Delete code template "${template.name}"?`, { danger: true, okLabel: 'Delete' })) return;
            try { await api.codeTemplates.remove(template.id); } catch { /* not yet saved */ }
            entry.templates = entry.templates.filter(t => t !== template);
        }
        invalidateCompletions();   // deleted templates no longer autocomplete
        selected = null;
        markDirty();
        renderTable();
        renderEditor();
        updateTaskVisibility();
        toast('Deleted — use Save All to commit library changes');
    }

    async function saveAll() {
        try {
            const v = platform.store.getState('serverVersion') || '4.6.0';
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
        if (!found || selected.kind !== 'library') {
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
        if (!found || selected.kind !== 'template') {
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
            selected = null;
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
            if (libraries.length === 1) target = libraries[0];
            else { toast('Select a library to import into first', 'warn'); return; }
        }
        if (dirty && !await confirmDialog('Import Code Templates',
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

            const v = platform.store.getState('serverVersion') || '4.6.0';
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
            const payload = libraries.map(entry => {
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
        if (!found || selected.kind !== 'template') { toast('Select a code template first', 'warn'); return; }
        const code = found.template.properties && found.template.properties.code;
        if (typeof code !== 'string' || !code.trim()) { toast('Template has no code to validate', 'warn'); return; }
        const result = await validateScript(code);
        if (result.ok === null) { toast(result.message, 'warn'); return; }
        if (result.ok === false) { toast(`Validation error — ${result.message}`, 'error'); return; }
        toast('Code template validated successfully');
    }

    /* ---- layout --------------------------------------------------------------------- */

    // Selection-dependent tasks. Export Library shows for a selected library;
    // Export Code Template / Validate Script show for a selected template;
    // Delete acts on either.
    // Task pane matching the Swing Code Template Tasks (flat list): New Code
    // Template appears with any selection; Export/Delete are labelled by the
    // selected kind; Validate Script is template-only; Save All shows only when
    // there are unsaved changes.
    const newTemplateBtn = taskButton('New Code Template', 'plus', newTemplate);
    const exportLibraryBtn = taskButton('Export Library', 'export', exportLibrary);
    const exportTemplateBtn = taskButton('Export Code Template', 'export', exportTemplate);
    const deleteLibraryBtn = taskButton('Delete Library', 'trash', deleteSelected, { danger: true });
    const deleteTemplateBtn = taskButton('Delete Code Template', 'trash', deleteSelected, { danger: true });
    const validateBtn = taskButton('Validate Script', 'check', validateScriptTask);
    const saveChangesBtn = taskButton('Save Changes', 'check', saveAll, { primary: true });

    function updateTaskVisibility() {
        const found = findSelected();
        const isTemplate = found && selected.kind === 'template';
        const isLibrary = found && selected.kind === 'library';
        newTemplateBtn.classList.toggle('hidden', !found);
        exportLibraryBtn.classList.toggle('hidden', !isLibrary);
        exportTemplateBtn.classList.toggle('hidden', !isTemplate);
        deleteLibraryBtn.classList.toggle('hidden', !isLibrary);
        deleteTemplateBtn.classList.toggle('hidden', !isTemplate);
        validateBtn.classList.toggle('hidden', !isTemplate);
        saveChangesBtn.classList.toggle('hidden', !dirty);
    }

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Code Template Tasks' } },
        taskButton('Refresh', 'refresh', async () => {
            if (dirty && !await confirmDialog('Refresh', 'Discard unsaved changes and refresh?', { okLabel: 'Refresh' })) return;
            load();
        }),
        saveChangesBtn,
        newTemplateBtn,
        taskButton('New Library', 'folder', newLibrary),
        taskButton('Import Code Templates', 'import', importCodeTemplates),
        taskButton('Import Libraries', 'import', importLibraries),
        exportTemplateBtn,
        exportLibraryBtn,
        deleteTemplateBtn,
        deleteLibraryBtn,
        validateBtn);

    [newTemplateBtn, exportLibraryBtn, exportTemplateBtn, deleteLibraryBtn, deleteTemplateBtn, validateBtn, saveChangesBtn]
        .forEach(b => b.classList.add('hidden'));
    updateTaskVisibility();

    // Top: the libraries/templates table + filter bar (Swing's upper grid).
    // Bottom: the library/template editor. A horizontal handle splits the two.
    const topPane = h('div.split-a', { style: { height: '320px', flex: 'none', display: 'flex', flexDirection: 'column', minHeight: '0' } },
        tableHost,
        h('div.filterbar', { style: { flex: 'none' } },
            countsLabel,
            h('span', { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                h('label', 'Filter:'), filterInput)));
    const handle = h('div.split-handle', { dataset: { orient: 'v' } });
    const split = h('div.split.vertical', { style: { flex: '1', minWidth: '0' } },
        topPane, handle, h('div.split-b', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } }, editorHost));

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = topPane.getBoundingClientRect().height;
        const move = (ev) => { topPane.style.height = Math.max(120, startHeight + ev.clientY - startY) + 'px'; };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });

    load();

    const el = h('div.view', taskbar, h('div.view-body.flush', { style: { display: 'flex' } }, split));
    return { el };
}
