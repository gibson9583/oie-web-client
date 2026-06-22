/*
 * Filter / Transformer / Response Transformer editor (React port of
 * views/filter-transformer.js) — parity with the Swing Administrator's filter
 * and transformer panes. Edits the polymorphic element list (rules/steps) of one
 * connector, using the step/rule editors registered through the platform
 * (TransformerStepPlugin / FilterRulePlugin equivalent).
 *
 * Classic layout: steps/rules table on top, Step + Generated Script tabs below,
 * and a right-hand Reference / Message Templates / Message Trees panel. All of
 * that is heavy imperative DOM — a hand-built tree-table, plugin-rendered step
 * editors, the imperative <CodeEditor>/createCodeEditor islands, accessor
 * drag-and-drop, and the message-tree parser. So (like code-templates.jsx) the
 * whole body is kept mounted via a ref and built ONCE by the legacy renderBody()
 * logic reused VERBATIM; only the task pane (Swing "<Kind> Tasks") becomes React
 * <TaskButton>s, gated on a force-update the body drives through onTasksChange.
 *
 * The channel being edited travels through the store ('editingChannel') so
 * unsaved edits survive navigation between the channel editor and this view.
 * Dirty is the explicit editingChannelDirty store flag; persist() (teardown)
 * never sets it, only commit() does.
 */

import { useEffect, useRef, useReducer, useState } from 'react';
import { h, clear, field, textInput, select, tabs, modal, toast, loading, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { createCodeEditor } from '@oie/web-ui';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { setActiveScope, clearActiveScope } from '../../core/script-completions.js';
import { serializeTemplate, validateScript } from '../../core/serialize.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';
import { REFERENCE_CATALOG } from '../../core/reference-catalog.js';
import { platform } from '@oie/web-shell';
import { reactView, ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane, TaskButton } from '../ui.jsx';

const KINDS = {
    filter: { title: 'Filter', noun: 'Rule', targetKey: 'filter' },
    transformer: { title: 'Transformer', noun: 'Step', targetKey: 'transformer' },
    response: { title: 'Response Transformer', noun: 'Step', targetKey: 'responseTransformer' }
};

export function register(platform) {
    platform.registerView('/channels/:channelId/filter/:metaDataId',
        reactView((props) => <FilterTransformerView {...props} kindName="filter" />), { title: 'Filter' });
    platform.registerView('/channels/:channelId/transformer/:metaDataId',
        reactView((props) => <FilterTransformerView {...props} kindName="transformer" />), { title: 'Transformer' });
    platform.registerView('/channels/:channelId/response/:metaDataId',
        reactView((props) => <FilterTransformerView {...props} kindName="response" />), { title: 'Response Transformer' });
}

function FilterTransformerView({ params, kindName }) {
    const [, forceRender] = useReducer((x) => x + 1, 0);
    // The channel travels through the store (seeded by the channel editor). When a
    // user deep-links straight to a sub-editor route the store is empty, so the
    // channel is fetched (matching the async legacy renderEditor) before the body
    // builds. `ready` flips once the channel is available; null means still loading.
    const [ready, setReady] = useState(() => {
        const c = store.getState('editingChannel');
        return c && c.id === params.channelId ? true : null;
    });
    const bodyHostRef = useRef(null);
    // The imperative body exposes its current task state + handlers here, read by
    // the React task pane. Captured once at mount.
    const ctxRef = useRef(null);

    // Deep-link entry (no in-store channel): fetch it, then build.
    useEffect(() => {
        if (ready) return;
        let alive = true;
        api.channels.get(params.channelId).then((loaded) => {
            if (!alive) return;
            store.setState('editingChannel', loaded);
            store.setState('editingChannelNew', false);
            setReady(true);
        }).catch((e) => { if (alive) { toast(e.message, 'error'); setReady(false); } });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!ready) return;
        const host = bodyHostRef.current;
        if (!host) return;
        const ctx = buildBody(params, kindName, forceRender);
        ctxRef.current = ctx;
        if (ctx.el) host.appendChild(ctx.el);
        // Drop accessors anywhere they land on an editor/field within the view.
        if (ctx.onAccessorDragOver) host.addEventListener('dragover', ctx.onAccessorDragOver);
        if (ctx.onAccessorDrop) host.addEventListener('drop', ctx.onAccessorDrop);
        forceRender();   // first paint of the (now-populated) task pane
        return () => {
            if (ctx.onAccessorDragOver) host.removeEventListener('dragover', ctx.onAccessorDragOver);
            if (ctx.onAccessorDrop) host.removeEventListener('drop', ctx.onAccessorDrop);
            ctxRef.current = null;
            if (ctx.teardown) ctx.teardown();
            host.replaceChildren();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    const ctx = ctxRef.current;
    const kind = KINDS[kindName];
    const ts = (ctx && ctx.taskState && ctx.taskState()) || { onStep: false, assign: false, remove: false, dirty: false };
    const t = ctx && ctx.handlers;

    return (
        <div className="view" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ViewTasks>
                <RailPane title={`${kind.title} Tasks`} paneKey={`tasks:${kind.title} Tasks`}>
                    <div className="taskbar" data-pane-title={`${kind.title} Tasks`}>
                        {t && <TaskButton label={`Add New ${kind.noun}`} icon="plus" onClick={t.addElement} />}
                        {t && ts.onStep && <TaskButton label={`Delete ${kind.noun}`} icon="trash" danger onClick={t.deleteElement} />}
                        {t && ts.assign && <TaskButton label="Assign To Iterator" icon="plus" onClick={t.assignToIterator} />}
                        {t && ts.remove && <TaskButton label="Remove From Iterator" icon="minus" onClick={t.removeFromIterator} />}
                        {t && <TaskButton label={`Import ${kind.title}`} icon="import" onClick={t.importElements} />}
                        {t && <TaskButton label={`Export ${kind.title}`} icon="export" onClick={t.exportElements} />}
                        {t && <TaskButton label={`Validate ${kind.title}`} icon="check" onClick={t.validateElements} />}
                        {t && ts.onStep && <TaskButton label={`Validate ${kind.noun}`} icon="check" onClick={t.validateElement} />}
                        {t && ts.dirty && <TaskButton label="Save Channel" icon="save" primary onClick={t.saveChannel} />}
                        {t && <TaskButton label="Back to Channel" icon="chevR" onClick={t.backToChannel} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {ready === null
                ? <div className="view-body"><div className="dt-empty">Loading channel…</div></div>
                : ready === false
                    ? <div className="view-body"><div className="dt-empty">Channel not loaded</div></div>
                    : <div ref={bodyHostRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} />}
        </div>
    );
}

/* Build the imperative editor body (DOM tree-table + bottom tabs + side panel),
   returning { el, teardown, handlers, taskState, onAccessorDragOver,
   onAccessorDrop }. The body logic is reused VERBATIM from the legacy view; only
   the task buttons are lifted into React (the legacy taskbar element is dropped
   and replaced by the gated task-state the React pane reads). `onTasksChange` is
   called whenever the selection/dirty state changes so the React pane re-renders. */
function buildBody(params, kindName, onTasksChange) {
    const kind = KINDS[kindName];
    const isFilter = kindName === 'filter';

    /* ---- load channel (prefer in-flight edits from the store) ----------------
       The channel is guaranteed present here: the React component fetches it (if
       not already seeded by the channel editor) and gates this build on it. */

    const channel = store.getState('editingChannel');
    const version = channel['@version'] || store.getState('serverVersion') || '4.5.2';

    const connector = String(params.metaDataId) === '0'
        ? channel.sourceConnector
        : oie.destinationsOf(channel).find(d => Number(d.metaDataId) === Number(params.metaDataId));

    if (!connector) {
        toast(`Connector ${params.metaDataId} not found`, 'error');
        router.navigate(`/channels/${params.channelId}/edit`);
        return { el: loading() };
    }

    if (!connector[kind.targetKey]) {
        connector[kind.targetKey] = isFilter ? oie.emptyFilter(version) : oie.emptyTransformer(version);
    }
    const target = connector[kind.targetKey];
    // Connector type drives which data type property groups apply (see props-editor).
    const connectorType = kindName === 'response' ? 'RESPONSE'
        : (String(params.metaDataId) === '0' ? 'SOURCE' : 'DESTINATION');

    // Banner: "Edit Channel - <name> - <connector> <Filter/Transformer>" (Swing
    // parity). Deferred past the route:changed title reset (see channel-editor)
    // with rAF so it sticks without a flash.
    const connectorLabel = String(params.metaDataId) === '0' ? 'Source' : (connector.name || `Destination ${params.metaDataId}`);
    const bannerTitle = (channel.name ? `Edit Channel - ${channel.name} - ` : '') + `${connectorLabel} ${kind.title}`;
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
        detail: { title: bannerTitle }
    })));

    // Scope code-template completions to this connector's editor context. This
    // view is a single context, so set it once (covers every step/rule editor,
    // including the plugin-rendered JavaScript ones) rather than per editor.
    setActiveScope(params.channelId, [connectorType === 'RESPONSE' ? 'DESTINATION_RESPONSE_TRANSFORMER'
        : connectorType === 'SOURCE' ? 'SOURCE_FILTER_TRANSFORMER' : 'DESTINATION_FILTER_TRANSFORMER']);

    // Step/rule types offered here. Source-only types (e.g. Destination Set Filter)
    // are excluded on destination and response transformers, matching the Swing
    // TransformerPane (which drops onlySourceConnector() plugins off the source).
    const isSourceConnector = connectorType === 'SOURCE';
    function availableTypeEntries() {
        const registry = isFilter ? platform.ruleTypes() : platform.stepTypes();
        return [...registry].filter(([, def]) => isSourceConnector || !def.onlySource);
    }

    const isIteratorType = (t) => t === 'com.mirth.connect.model.IteratorStep'
        || t === 'com.mirth.connect.model.IteratorRule';
    const childrenOf = (el) => (el.__children || (el.__children = []));

    // Hydrate serialized iterator children into live __children arrays so the
    // whole step tree can be edited in place and re-serialized on commit (the
    // Swing client shows iterator children nested in the step list).
    function hydrateChildren(list) {
        for (const el of list) {
            if (isIteratorType(el.__type)) {
                el.__children = oie.elementsToArray(el.properties && el.properties.children);
                hydrateChildren(el.__children);
            }
        }
    }
    let elements = oie.elementsToArray(target.elements);
    hydrateChildren(elements);

    // Selection is a path of indices from the root ([2] or [2,0]); null = none.
    let selectedPath = elements.length ? [0] : null;

    function listAtPath(path) {
        let list = elements;
        for (let k = 0; k < path.length - 1; k++) {
            const el = list[path[k]];
            if (!el || !isIteratorType(el.__type)) return null;
            list = childrenOf(el);
        }
        return list;
    }
    function elementAtPath(path) {
        if (!path || !path.length) return null;
        const list = listAtPath(path);
        return list ? list[path[path.length - 1]] : null;
    }
    // Find an element's path by identity (robust to index shifts after edits).
    function pathOf(target, list = elements, parent = []) {
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            const path = [...parent, i];
            if (el === target) return path;
            if (isIteratorType(el.__type)) {
                const found = pathOf(target, childrenOf(el), path);
                if (found) return found;
            }
        }
        return null;
    }
    const pathEquals = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
    const isAncestorPath = (anc, p) => anc.length < p.length && anc.every((v, i) => v === p[i]);

    /* ---- persistence ---------------------------------------------------------- */

    // Re-serialize the live tree; iterator children come from their __children.
    function serializeList(list) {
        return list.map(el => {
            if (!isIteratorType(el.__type)) return el;
            const { __children, ...rest } = el;
            const properties = { ...(rest.properties || {}) };
            properties.children = oie.arrayToElements(serializeList(__children || [])) || '';
            return { ...rest, properties };
        });
    }

    function normalizeOperators(list) {
        list.forEach((el, i) => {
            if (i === 0) el.operator = 'NONE';
            else if (!el.operator || el.operator === 'NONE') el.operator = 'AND';
            if (isIteratorType(el.__type)) normalizeOperators(childrenOf(el));
        });
    }

    // Every step/rule is a Migratable model on the engine: without a version
    // attribute the engine's MigratableConverter rejects the whole channel
    // ("version: not available"), so stamp the current version on each element
    // (and iterator children) that doesn't already carry one.
    function stampVersions(list) {
        for (const el of list) {
            if (!el['@version']) el['@version'] = version;
            if (isIteratorType(el.__type)) {
                if (el.properties && typeof el.properties === 'object' && !el.properties['@version']) {
                    el.properties['@version'] = version;
                }
                stampVersions(childrenOf(el));
            }
        }
    }

    // While a step editor renders, some step plugins call onChange() to persist
    // default-filled fields — that must NOT mark the channel dirty (opening or
    // selecting a step would otherwise look like an unsaved edit). Set during the
    // plugin's render only; real user edits happen with this false.
    let settling = false;
    const channelDirty = () =>
        store.getState('editingChannelNew') === true ||
        store.getState('editingChannelDirty') === true;
    // Save Channel shows only when there are unsaved changes (matches the channel editor).
    function refreshSave() { onTasksChange(); }

    // Serialize the working step list back onto the channel in the store. Used
    // on teardown too, so it must NOT touch the dirty flag (otherwise leaving the
    // editor after a save would re-mark the channel dirty).
    function persist() {
        // The first rule in each list has no boolean operator; the rest do.
        if (isFilter) normalizeOperators(elements);
        stampVersions(elements);
        target.elements = oie.arrayToElements(serializeList(elements));
        // Refresh the store's working copy only while we're still in the editing
        // flow. If the nav guard cleared it (left the editor with Don't Save), the
        // teardown persist() must not resurrect the discarded copy.
        if (store.getState('editingChannel')) store.setState('editingChannel', channel);
    }

    // Called by the edit handlers: persist AND mark the shared dirty flag the
    // channel editor reads, so unsaved step edits prompt on exit.
    function commit() {
        persist();
        if (settling) return;            // plugin initialization, not a user edit
        store.setState('editingChannelDirty', true);
        refreshSave();
    }

    async function saveChannel() {
        persist();
        const problems = oie.validateChannel(channel);
        if (problems.length) {
            modal({
                title: 'Cannot Save Channel',
                body: h('div',
                    h('p', 'Fix the following before saving — the engine would reject this channel:'),
                    h('ul', { style: { margin: '8px 0 0', paddingLeft: '18px' } }, problems.map(p => h('li', p)))),
                buttons: [{ label: 'OK' }]
            });
            return;
        }
        try {
            if (store.getState('editingChannelNew')) {
                await api.channels.create(channel);
                store.setState('editingChannelNew', false);
            } else {
                channel.revision = (Number(channel.revision) || 0) + 1;
                await api.channels.update(channel.id, channel);
            }
            store.setState('editingChannelDirty', false);
            refreshSave();
            toast(`Saved ${channel.name}`);
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* Leaving the channel's editing flow with unsaved step/rule edits asks
       Save / Don't Save / Cancel (same as the channel editor). Navigation that
       stays within /channels/<id>/... (back to the editor or another sub-editor)
       keeps the working copy without prompting. */
    function promptSaveChanges() {
        return new Promise((resolve) => {
            modal({
                title: 'Unsaved Changes',
                body: h('div', `Would you like to save the changes made to "${channel.name || 'this channel'}"?`),
                onClose: () => resolve('cancel'),
                buttons: [
                    { label: 'Cancel', onClick: () => { resolve('cancel'); } },
                    { label: "Don't Save", danger: true, onClick: () => { resolve('discard'); } },
                    { label: 'Save Changes', primary: true, onClick: () => { resolve('save'); } }
                ]
            });
        });
    }

    store.setState('navGuard', async ({ path }) => {
        if (path.startsWith(`/channels/${params.channelId}/`)) return; // same editing flow
        if (channelDirty()) {
            const choice = await promptSaveChanges();
            if (choice === 'cancel') return false;
            // saveChannel() clears the dirty flag on success; if it's still dirty
            // (validation blocked or the request failed) keep the user here.
            if (choice === 'save') { await saveChannel(); if (channelDirty()) return false; }
        }
        // Left the editor entirely: drop the working copy AND this guard so it can
        // never prompt again for navigation outside the editing flow.
        store.setState('editingChannel', null);
        store.setState('editingChannelNew', false);
        store.setState('editingChannelDirty', false);
        store.setState('navGuard', null);
    });

    /* ---- element table (top pane, classic grid) -------------------------------- */

    // Fills the pane so right-clicking anywhere in the step area (not just on a
    // row) opens the context menu.
    const tableHost = h('div', { style: { minHeight: '100%' } });

    function typeDef(type) {
        return isFilter ? platform.ruleType(type) : platform.stepType(type);
    }

    function elementName(el) {
        return el.name || (typeDef(el.__type) ? typeDef(el.__type).label : oie.elementTypeLabel(el.__type));
    }

    function operatorSelect(el) {
        const sel = select(['AND', 'OR'], el.operator === 'OR' ? 'OR' : 'AND', {
            style: { width: '70px' },
            onChange: (e) => { el.operator = e.target.value; commit(); }
        });
        sel.addEventListener('click', (e) => e.stopPropagation());
        return sel;
    }

    // Flatten the tree to display rows in order, carrying each row's path/depth.
    function flattenRows(list, parentPath, depth, out) {
        list.forEach((el, i) => {
            const path = [...parentPath, i];
            out.push({ el, path, depth });
            if (isIteratorType(el.__type)) flattenRows(childrenOf(el), path, depth + 1, out);
        });
        return out;
    }

    function renderTable() {
        clear(tableHost);
        if (!elements.length) {
            tableHost.appendChild(h('div.dt-empty',
                `No ${kind.noun.toLowerCase()}s — use Add New ${kind.noun}`));
            return;
        }
        const thead = h('thead', h('tr',
            h('th', { style: { width: '64px' } }, 'Enabled'),
            h('th', { style: { width: '36px' } }, '#'),
            isFilter ? h('th', { style: { width: '90px' } }, 'Operator') : null,
            h('th', 'Name'),
            h('th', { style: { width: '180px' } }, 'Type')));
        const baseTypeOptions = availableTypeEntries().map(([type, def]) => ({ value: type, label: def.label || oie.elementTypeLabel(type) }));
        const tbody = h('tbody');
        for (const { el, path, depth } of flattenRows(elements, [], 0, [])) {
            const idx = path[path.length - 1];
            const enabledBox = h('input', {
                type: 'checkbox',
                checked: el.enabled !== false,
                onChange: (e) => { el.enabled = e.target.checked; commit(); }
            });
            enabledBox.addEventListener('click', (e) => e.stopPropagation());
            // Inline-editable Name cell (matches the Swing step/rule grid). Clicks
            // are kept off the row handler so editing never rebuilds the table and
            // steals focus; select the row via the other cells.
            const nameField = h('input.grid-name', {
                type: 'text', value: el.name || '',
                placeholder: typeDef(el.__type) ? typeDef(el.__type).label : oie.elementTypeLabel(el.__type),
                style: { marginLeft: `${depth * 18}px` },
                onInput: (e) => { el.name = e.target.value; commit(); }
            });
            ['click', 'mousedown', 'dblclick'].forEach(ev => nameField.addEventListener(ev, (e) => e.stopPropagation()));
            // Inline Type dropdown (matches the Swing grid). Converting changes the
            // element to the chosen type, keeping its name/enabled/operator.
            const typeOptions = baseTypeOptions.some(o => o.value === el.__type)
                ? baseTypeOptions
                : [{ value: el.__type, label: oie.elementTypeLabel(el.__type) }, ...baseTypeOptions];
            const typeSel = select(typeOptions, el.__type, {
                style: { width: '100%' },
                onChange: (e) => changeElementType(path, e.target.value)
            });
            ['click', 'mousedown'].forEach(ev => typeSel.addEventListener(ev, (e) => e.stopPropagation()));
            const tr = h('tr', {
                class: pathEquals(path, selectedPath) ? 'selected' : null,
                'data-path': path.join('.'), style: { cursor: 'pointer' }
            },
                h('td', { style: { textAlign: 'center' } }, enabledBox),
                h('td.num', String(idx + 1)),
                isFilter ? h('td', idx === 0 ? '' : operatorSelect(el)) : null,
                h('td', nameField),
                h('td', typeSel));
            tr.addEventListener('click', () => selectElement(path));
            tbody.appendChild(tr);
        }
        tableHost.appendChild(h('table.dt', thead, tbody));
    }

    function selectElement(path) {
        selectedPath = path;
        renderTable();
        renderElementEditor();
        updateGenerated();
        updateTaskVisibility();
    }

    /* ---- element editor + generated script (bottom tabs) ------------------------ */

    const editorHost = h('div.step-editor-fill', { style: { padding: '12px 14px' } });
    let elementEditorRoot = null;   // teardown for the mounted step/rule React editor
    const generatedHost = h('div', { style: { padding: '12px 14px' } });
    const generatedEditor = createCodeEditor({ value: '', readOnly: true, minHeight: '200px' });
    generatedHost.appendChild(generatedEditor.el);

    function updateGenerated() {
        const element = elementAtPath(selectedPath);
        let script;
        if (!element) {
            script = `// Select a ${kind.noun.toLowerCase()} to preview its script`;
        } else if (typeof element.script === 'string') {
            script = element.script;
        } else {
            script = `// ${oie.elementTypeLabel(element.__type)} ${kind.noun.toLowerCase()} — script is generated by the server`;
        }
        generatedEditor.setValue(script);
    }

    function renderElementEditor() {
        if (elementEditorRoot) { elementEditorRoot(); elementEditorRoot = null; }
        clear(editorHost);
        const element = elementAtPath(selectedPath);
        if (!element) {
            editorHost.appendChild(h('div.dt-empty',
                h('div', `Select a ${kind.noun.toLowerCase()} to edit`)));
            return;
        }
        const onChange = () => { commit(); updateGenerated(); };

        // Name is edited inline in the step/rule grid above (Swing parity).
        const panel = h('div.panel',
            h('div.panel-header', `${kind.noun} ${selectedPath[selectedPath.length - 1] + 1} — ${oie.elementTypeLabel(element.__type)}`),
            h('div.panel-body'));
        const body = panel.querySelector('.panel-body');

        const def = typeDef(element.__type);
        if (def && typeof def.component === 'function') {
            // Plugins may onChange() during the synchronous (flushSync) mount to
            // persist defaults — suppress dirty-marking so opening/selecting a
            // step doesn't flag the channel unsaved.
            settling = true;
            try { elementEditorRoot = mountReact(body, <PluginSlot def={def} ctx={{ element, platform, onChange }} />); }
            finally { settling = false; }
        } else {
            // Unknown plugin type: raw JSON fallback so nothing is lost.
            const area = h('textarea', { rows: 14, spellcheck: 'false' },
                JSON.stringify(element, null, 2));
            area.addEventListener('blur', () => {
                try {
                    const parsed = JSON.parse(area.value);
                    parsed.__type = element.__type;
                    listAtPath(selectedPath)[selectedPath[selectedPath.length - 1]] = parsed;
                    commit();
                    updateGenerated();
                } catch (e) {
                    toast(`Invalid JSON: ${e.message}`, 'error');
                }
            });
            body.appendChild(field('Raw element (JSON)', area, `No editor registered for ${element.__type}`));
        }
        editorHost.appendChild(panel);
    }

    const bottomTabs = tabs([
        { label: kind.noun, render: () => editorHost },
        { label: 'Generated Script', render: () => generatedHost }
    ]);

    /* ---- tasks ------------------------------------------------------------------- */

    function renderAll() {
        renderTable();
        renderElementEditor();
        updateGenerated();
        updateTaskVisibility();
    }

    function addElement() {
        const entries = availableTypeEntries();
        const items = h('div.step-list');
        const m = modal({
            title: `Add ${kind.noun}`,
            body: entries.length ? items : h('div.faint', 'No element types registered'),
            buttons: [{ label: 'Cancel' }]
        });
        for (const [type, def] of entries) {
            const item = h('div.step-item',
                h('div', { style: { flex: '1' } },
                    h('div', def.label || oie.elementTypeLabel(type))));
            item.addEventListener('click', () => {
                m.close();
                const element = def.create ? def.create() : { __type: type, name: '', enabled: true };
                if (!element.__type) element.__type = type;
                // Match the Swing client: if an Iterator is selected, add the
                // new element as its child; otherwise insert as a sibling right
                // after the selection (or append to the top level if none).
                const sel = elementAtPath(selectedPath);
                if (sel && isIteratorType(sel.__type)) {
                    childrenOf(sel).push(element);
                    selectedPath = [...selectedPath, childrenOf(sel).length - 1];
                } else if (selectedPath && selectedPath.length) {
                    const list = listAtPath(selectedPath);
                    const idx = selectedPath[selectedPath.length - 1];
                    list.splice(idx + 1, 0, element);
                    selectedPath = [...selectedPath.slice(0, -1), idx + 1];
                } else {
                    elements.push(element);
                    selectedPath = [elements.length - 1];
                }
                commit();
                renderAll();
            });
            items.appendChild(item);
        }
    }

    // Convert a step/rule to another type in place, preserving its name, enabled
    // state and (for filters) boolean operator — like the Swing grid's Type column.
    function changeElementType(path, newType) {
        const list = listAtPath(path);
        if (!list) return;
        const idx = path[path.length - 1];
        const old = list[idx];
        if (!old || old.__type === newType) return;
        const registry = isFilter ? platform.ruleTypes() : platform.stepTypes();
        const def = registry.get(newType);
        const created = def && def.create ? def.create() : { __type: newType, name: '', enabled: true };
        created.__type = newType;
        created.name = old.name ?? '';
        created.enabled = old.enabled !== false;
        if (isFilter && old.operator !== undefined) created.operator = old.operator;
        if (isIteratorType(newType)) created.__children = [];
        list[idx] = created;
        selectedPath = path;
        commit();
        renderAll();
    }

    function deleteElement() {
        if (!elementAtPath(selectedPath)) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const list = listAtPath(selectedPath);
        const idx = selectedPath[selectedPath.length - 1];
        const parent = selectedPath.slice(0, -1);
        list.splice(idx, 1);
        selectedPath = list.length ? [...parent, Math.min(idx, list.length - 1)]
            : (parent.length ? parent : (elements.length ? [0] : null));
        commit();
        renderAll();
    }

    function move(delta) {
        if (!elementAtPath(selectedPath)) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const list = listAtPath(selectedPath);
        const idx = selectedPath[selectedPath.length - 1];
        const next = idx + delta;
        if (next < 0 || next >= list.length) return;
        const [el] = list.splice(idx, 1);
        list.splice(next, 0, el);
        selectedPath = [...selectedPath.slice(0, -1), next];
        commit();
        renderAll();
    }

    async function importElements() {
        const file = await pickFile('.json');
        if (!file) return;
        try {
            const parsed = JSON.parse(file.content);
            let source = null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                source = parsed.elements ?? parsed.steps ?? parsed.rules ??
                    (parsed[kind.targetKey] && parsed[kind.targetKey].elements) ?? null;
            } else if (Array.isArray(parsed)) {
                source = parsed;
            }
            let imported = null;
            if (Array.isArray(source)) imported = source;
            else if (source && typeof source === 'object') imported = oie.elementsToArray(source);
            if (!imported) throw new Error('no steps/rules/elements found in the file');
            const cleaned = imported.filter(item =>
                item && typeof item === 'object' && typeof item.__type === 'string');
            if (!cleaned.length) throw new Error(`the file does not contain any valid ${kind.noun.toLowerCase()}s`);
            elements = cleaned;
            hydrateChildren(elements);
            selectedPath = elements.length ? [0] : null;
            commit();
            renderAll();
            toast(`Imported ${cleaned.length} ${kind.noun.toLowerCase()}${cleaned.length === 1 ? '' : 's'}`);
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    function exportElements() {
        saveFile(`${channel.name || channel.id}-${kindName}.json`, 'application/json',
            () => JSON.stringify({ elements }, null, 2));
    }

    // Real Rhino validation (engine bridge) of every script-bearing element.
    async function validateElements() {
        const all = flattenRows(elements, [], 0, []).map(r => r.el);
        if (!all.length) { toast(`${kind.title} is empty — nothing to validate`, 'warn'); return; }
        for (const el of all) {
            if (typeof el.script !== 'string') continue;
            const result = await validateScript(el.script);
            if (result.ok === null) { toast(result.message, 'warn'); return; }
            if (result.ok === false) { toast(`${kind.noun} "${elementName(el)}" — ${result.message}`, 'error'); return; }
        }
        toast(`All ${kind.noun.toLowerCase()}s validated successfully`);
    }

    async function validateElement() {
        const el = elementAtPath(selectedPath);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        if (typeof el.script === 'string') {
            const result = await validateScript(el.script);
            if (result.ok === false) { toast(`${kind.noun} "${elementName(el)}" — ${result.message}`, 'error'); return; }
            if (result.ok === null) { toast(result.message, 'warn'); return; }
        }
        toast(`${kind.noun} "${elementName(el)}" validated successfully`);
    }

    /* ---- iterator membership (matches the Swing tree-table) ------------------- */

    function allIteratorPaths(list = elements, parent = [], out = []) {
        list.forEach((el, i) => {
            const path = [...parent, i];
            if (isIteratorType(el.__type)) { out.push(path); allIteratorPaths(childrenOf(el), path, out); }
        });
        return out;
    }

    // Iterators the element at `path` could move into: not itself, not a
    // descendant of it, and not its current parent.
    function iteratorTargets(path) {
        return allIteratorPaths()
            .filter(ip => !pathEquals(ip, path) && !isAncestorPath(path, ip) && !pathEquals(ip, path.slice(0, -1)))
            .map(ip => elementAtPath(ip))
            .filter(Boolean);
    }

    function moveIntoIterator(el, iterator) {
        listAtPath(selectedPath).splice(selectedPath[selectedPath.length - 1], 1);
        childrenOf(iterator).push(isFilter ? { ...el, operator: 'AND' } : el);
        selectedPath = pathOf(iterator.__children[iterator.__children.length - 1]);
        commit();
        renderAll();
    }

    function assignToIterator() {
        const el = elementAtPath(selectedPath);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const targets = iteratorTargets(selectedPath);
        if (!targets.length) { toast(`No Iterator available — add an Iterator ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        if (targets.length === 1) { moveIntoIterator(el, targets[0]); return; }
        // Multiple iterators: let the user pick one.
        const list = h('div.step-list');
        const m = modal({ title: 'Assign To Iterator', body: list, buttons: [{ label: 'Cancel' }] });
        targets.forEach((it, i) => {
            const row = h('div.step-item', h('div', { style: { flex: '1' } }, it.name || `Iterator ${i + 1}`));
            row.addEventListener('click', () => { m.close(); moveIntoIterator(el, it); });
            list.appendChild(row);
        });
    }

    function removeFromIterator() {
        const el = elementAtPath(selectedPath);
        if (!el || !selectedPath || selectedPath.length < 2) {
            toast(`This ${kind.noun.toLowerCase()} is not inside an Iterator`, 'warn'); return;
        }
        const iterator = elementAtPath(selectedPath.slice(0, -1));
        listAtPath(selectedPath).splice(selectedPath[selectedPath.length - 1], 1);
        const grandList = listAtPath(selectedPath.slice(0, -1));
        grandList.splice(grandList.indexOf(iterator) + 1, 0, el);
        selectedPath = pathOf(el);
        commit();
        renderAll();
    }

    // With no step selected the menu shows only the container actions; once a
    // step is selected (by clicking a row, or already highlighted) it shows that
    // step's actions. Right-clicking a row selects it first.
    function showStepMenu(e, path) {
        e.preventDefault();
        if (path && !pathEquals(path, selectedPath)) selectElement(path);
        const el = elementAtPath(selectedPath);
        const onStep = !!el;
        const t = kind.title, n = kind.noun;
        const items = [{ label: `Add New ${n}`, icon: 'plus', onClick: addElement }];
        if (onStep) {
            items.push({ label: `Delete ${n}`, icon: 'trash', danger: true, onClick: deleteElement });
            if (!isIteratorType(el.__type) && iteratorTargets(selectedPath).length) {
                items.push({ label: 'Assign To Iterator', onClick: assignToIterator });
            }
            if (selectedPath.length > 1) {
                items.push({ label: 'Remove From Iterator', onClick: removeFromIterator });
            }
            items.push('-',
                { label: `Move ${n} Up`, icon: 'arrowUp', onClick: () => move(-1) },
                { label: `Move ${n} Down`, icon: 'arrowDown', onClick: () => move(1) });
        }
        items.push('-',
            { label: `Import ${t}`, icon: 'import', onClick: importElements },
            { label: `Export ${t}`, icon: 'export', onClick: exportElements },
            '-',
            { label: `Validate ${t}`, icon: 'check', onClick: validateElements });
        if (onStep) items.push({ label: `Validate ${n}`, icon: 'check', onClick: validateElement });
        contextMenu(e.clientX, e.clientY, items);
    }

    tableHost.addEventListener('contextmenu', (e) => {
        const tr = e.target.closest && e.target.closest('tr[data-path]');
        showStepMenu(e, tr ? tr.dataset.path.split('.').map(Number) : null);
    });

    // Selection-dependent tasks only show when a step/rule row is selected
    // (the editor auto-selects the first row when the list is non-empty). Matches
    // the Swing Transformer/Filter Tasks pane: Delete + Assign/Remove Iterator +
    // the single-step Validate appear with a selection; Move Up/Down stay in the
    // right-click menu (reorder is via drag in Swing). The button visibility now
    // lives in the React task pane, which reads taskState() below.
    function updateTaskVisibility() {
        onTasksChange();
    }

    function taskState() {
        const el = elementAtPath(selectedPath);
        const onStep = !!el;
        return {
            onStep,
            assign: !!(onStep && !isIteratorType(el.__type)),
            remove: !!(onStep && selectedPath && selectedPath.length > 1),
            dirty: channelDirty()
        };
    }

    function backToChannel() {
        persist();    // navigating back is not an edit — don't mark dirty
        router.navigate(`/channels/${channel.id}/edit`);
    }

    /* ---- right panel: Reference ----------------------------------------------------- */

    // Built-in reference category order (mirrors the engine's Category enum).
    const REFERENCE_CATEGORY_ORDER = [
        'Conversion Functions', 'Logging and Alerts', 'Database Functions',
        'Utility Functions', 'Date Functions', 'Message Functions',
        'Response Transformer', 'Map Functions', 'Channel Functions',
        'Postprocessor Functions', 'Miscellaneous'
    ];

    // ${name} placeholders are prompts in the Swing client; insert plain code.
    const cleanTemplate = (code) => String(code == null ? '' : code).replace(/\$\{([^}]*)\}/g, '$1');

    // Strip a leading /** ... */ JSDoc block (CodeTemplateUtil.stripDocumentation).
    const stripDocumentation = (code) => String(code == null ? '' : code).trim().replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').trim();

    // Build a function's call from its definition (CodeTemplateFunctionDefinition
    // .getTransferData): "function name(a, b) {...}" -> "name(a, b)".
    function functionTransferData(code) {
        const m = /function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(String(code == null ? '' : code));
        if (!m) return null;
        const params = m[2].split(',').map(s => s.trim()).filter(Boolean).join(', ');
        return `${m[1]}(${params})`;
    }

    // What a reference inserts on drop, driven by its template type — matches the
    // Swing ReferenceListHandler: FUNCTION drops the call signature, code blocks
    // drop the (documentation-stripped) code, compiled code is not draggable.
    function dropTextFor(entry) {
        // Accept both the enum name and its display value, since the engine may
        // serialize either ("FUNCTION" / "Function", etc.).
        const t = String(entry.type || '');
        if (t === 'FUNCTION' || t === 'Function') {
            const call = functionTransferData(entry.code);
            if (call) return call;
        }
        if (t === 'COMPILED_CODE' || t === 'Compiled Code Block') return '';
        return cleanTemplate(stripDocumentation(entry.code));
    }
    const cleanDesc = (d) => String(d == null ? '' : d)
        .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();

    // Variables made available by this transformer's enabled steps — Mapper
    // output variables and map puts in JavaScript steps. Mirrors the engine's
    // VariableListUtil (which regex-scans each step's generated script).
    function collectStepVariables() {
        const vars = new Set();
        const putRe = /(?:globalMap|globalChannelMap|channelMap|connectorMap|responseMap|sourceMap)\.put\s*\(\s*['"]([^'"]+)['"]|\$(?:gc|co|g|c|r|s)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
        for (const el of elements) {
            if (el.enabled === false) continue;
            if (typeof el.variable === 'string' && el.variable.trim()) vars.add(el.variable.trim());
            if (typeof el.script === 'string') {
                let m;
                while ((m = putRe.exec(el.script))) vars.add(m[1] || m[2]);
            }
        }
        return [...vars];
    }

    function buildReferenceTab() {
        // Only categorized references appear in the Swing reference panel;
        // null-category entries (context variables, E4X methods) are
        // autocomplete-only in the client, so they are excluded here.
        const builtin = [];
        for (const r of REFERENCE_CATALOG) {
            if (!r.category) continue;
            builtin.push({ name: r.name, category: r.category, description: r.description, code: r.code, type: r.type });
        }
        const availableVars = collectStepVariables();

        const categorySelect = h('select', { onChange: () => renderItems() }, h('option', { value: '' }, 'All'));
        const filterInput = textInput('', { placeholder: 'Filter…' });
        filterInput.addEventListener('input', () => renderItems());
        const listEl = h('div', {
            style: {
                border: '1px solid var(--line)', borderRadius: 'var(--radius)',
                overflow: 'auto', flex: '1', minHeight: '120px'
            }
        }, loading('Loading…'));
        let entries = builtin.slice();        // built-ins + user code templates
        const userCategories = [];

        function rebuildCategoryOptions() {
            clear(categorySelect);
            categorySelect.appendChild(h('option', { value: '' }, 'All'));
            const present = new Set(entries.map(e => e.category));
            const ordered = REFERENCE_CATEGORY_ORDER.filter(c => present.has(c))
                .concat(userCategories.filter(c => present.has(c)));
            for (const c of ordered) categorySelect.appendChild(h('option', { value: c }, c));
        }

        // Drag-to-insert only (no source-code preview), like the Swing reference
        // panel — reuses the tree's accessor drop handler. `dropText` is the
        // exact text inserted on drop (already type-resolved).
        function makeRow(name, subtitle, dropText) {
            return h('div.step-item', {
                draggable: 'true',
                style: { cursor: 'grab' },
                onDragstart: (e) => {
                    draggingAccessor = dropText;
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', draggingAccessor);
                    e.dataTransfer.setData(ACCESSOR_FLAVOR, draggingAccessor);
                },
                onDragend: () => { draggingAccessor = null; }
            },
                h('div', { style: { flex: '1', minWidth: '0' } },
                    h('div.ellipsis', name || '(unnamed)'),
                    subtitle ? h('div.step-type', subtitle) : null));
        }

        function renderItems() {
            clear(listEl);
            const category = categorySelect.value;
            const query = filterInput.value.trim().toLowerCase();
            const visible = entries.filter(en =>
                (!category || en.category === category) &&
                (!query || `${en.name} ${cleanDesc(en.description)}`.toLowerCase().includes(query)));
            if (!visible.length) {
                listEl.appendChild(h('div.faint', { style: { padding: '10px', textAlign: 'center' } }, 'No matches'));
                return;
            }
            for (const en of visible) {
                const row = makeRow(en.name, en.category, dropTextFor(en));
                if (en.description) row.title = cleanDesc(en.description);
                listEl.appendChild(row);
            }
        }

        rebuildCategoryOptions();
        renderItems();

        // A library applies to this channel if it includes new channels (and
        // isn't explicitly disabled) or this channel is explicitly enabled.
        const libraryInScope = (lib) => {
            const id = String(channel.id);
            const enabled = new Set(api.asList(lib.enabledChannelIds, 'string').map(String));
            const disabled = new Set(api.asList(lib.disabledChannelIds, 'string').map(String));
            return enabled.has(id) || (lib.includeNewChannels && !disabled.has(id));
        };

        // Append the channel-scoped user code-template libraries as categories.
        api.codeTemplates.libraries(true)
            .then(allLibraries => {
                const libraries = allLibraries.filter(libraryInScope);
                for (const library of libraries) {
                    const name = library.name || '(unnamed library)';
                    if (!userCategories.includes(name)) userCategories.push(name);
                    for (const t of api.asList(library.codeTemplates, 'codeTemplate')) {
                        if (t && typeof t === 'object') {
                            entries.push({
                                name: t.name, category: name,
                                description: t.description,
                                code: (t.properties && t.properties.code) || '',
                                // Drag behavior is driven by the template type
                                // (FUNCTION / DRAG_AND_DROP_CODE / COMPILED_CODE).
                                type: (t.properties && t.properties.type) || 'DRAG_AND_DROP_CODE'
                            });
                        }
                    }
                }
                rebuildCategoryOptions();
                renderItems();
            })
            .catch(() => { toast('Could not load user code-template libraries; showing built-ins only', 'warn'); });

        // Available Variables box (the bottom panel in the Swing reference tab):
        // variables defined by this transformer's steps. Empty when there are none.
        const varsEl = h('div', {
            style: { border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: '140px' }
        });
        if (!availableVars.length) {
            varsEl.appendChild(h('div.faint', { style: { padding: '8px 10px', fontSize: '11px' } },
                '(no variables defined by steps yet)'));
        } else {
            for (const v of availableVars) varsEl.appendChild(makeRow(v, null, v));
        }

        return h('div', { style: { padding: '12px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } },
            h('div.field', h('label', 'Category'), categorySelect),
            h('div.field', filterInput),
            listEl,
            h('div', { style: { fontWeight: '600', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '12px 0 4px' } }, 'Available Variables'),
            varsEl);
    }

    /* ---- right panel: Message Templates (transformer routes only) -------------------- */

    function buildTemplatesTab() {
        const dtOptions = dataTypeList().map(dt => ({ value: dt.name, label: dt.label }));

        // Fresh default properties object for a data type (one per call).
        function makeDefaultProps(typeName) {
            const def = dataTypeDef(typeName);
            return def ? def.defaults(version) : { '@version': version };
        }

        // Seed a properties object for a side, matching the engine's structure.
        function ensureProps(side) {
            let props = target[`${side}Properties`];
            if (!props || typeof props !== 'object') {
                props = makeDefaultProps(target[`${side}DataType`]);
                target[`${side}Properties`] = props;
            }
            return props;
        }

        function templateArea(key) {
            const area = h('textarea', { rows: 6, spellcheck: 'false', placeholder: '(none)' },
                target[key] == null ? '' : String(target[key]));
            area.addEventListener('input', () => {
                target[key] = area.value === '' ? null : area.value;
                commit();
            });
            return area;
        }

        const dtLabel = (name) => (dataTypeDef(name) || { label: name }).label;

        // Edit a side's data type properties in a modal (Swing's data type
        // properties dialog). Edits go to a draft and apply on OK.
        function openPropsModal(side, title) {
            const typeName = target[`${side}DataType`] || 'RAW';
            let draft = JSON.parse(JSON.stringify(ensureProps(side)));
            const editorHost = h('div');
            const root = mountReact(editorHost, <DataTypePropertiesEditor
                typeName={typeName} props={draft} version={version}
                direction={side} connectorType={connectorType}
                onReplace={(obj) => { draft = obj; }} />);
            modal({
                title: `${title} Data Type Properties — ${dtLabel(typeName)}`,
                size: 'wide',
                body: editorHost,
                onClose: () => { try { root(); } catch { /* ignore */ } },
                buttons: [
                    { label: 'Cancel' },
                    {
                        label: 'OK', primary: true,
                        onClick: () => { target[`${side}Properties`] = draft; commit(); }
                    }
                ]
            });
        }

        // One section per side: data type select + a Properties button (modal)
        // and the template text. Changing the data type resets properties to
        // defaults and re-renders the section in place.
        function sideSection(side, title, templateKey) {
            const host = h('div');
            function render() {
                clear(host);
                const typeName = target[`${side}DataType`] || 'RAW';
                ensureProps(side);
                host.appendChild(field(`${title} Data Type`,
                    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                        select(dtOptions, typeName, {
                            onChange: (e) => {
                                const value = e.target.value;
                                target[`${side}DataType`] = value;
                                target[`${side}Properties`] = makeDefaultProps(value);
                                // Swing parity (DataTypesDialog.updateSingleDataType):
                                // a destination's inbound data type is the source's
                                // outbound, so changing the SOURCE outbound type also
                                // sets every destination's inbound type + default props.
                                if (side === 'outbound' && connectorType === 'SOURCE') {
                                    for (const dest of oie.destinationsOf(channel)) {
                                        if (!dest.transformer) dest.transformer = oie.emptyTransformer(version);
                                        dest.transformer.inboundDataType = value;
                                        dest.transformer.inboundProperties = makeDefaultProps(value);
                                    }
                                    toast(`Destination inbound data types set to ${dtLabel(value)}`);
                                } else {
                                    toast(`${title} data type properties reset to defaults`, 'warn');
                                }
                                commit();
                                render();
                            }
                        }),
                        h('button.btn.btn-sm', {
                            onClick: () => openPropsModal(side, title),
                            title: 'Edit this data type’s serialization properties'
                        }, 'Properties…'))));
                host.appendChild(field(`${title} Template`, templateArea(templateKey)));
            }
            render();
            return host;
        }

        return h('div', { style: { padding: '12px' } },
            sideSection('inbound', 'Inbound', 'inboundTemplate'),
            h('div', { style: { height: '14px' } }),
            sideSection('outbound', 'Outbound', 'outboundTemplate'));
    }

    /* ---- right panel: Message Trees (transformer routes only) -------------------------
     * Renders the inbound/outbound templates as expandable parse trees. Every
     * node is clickable (inserts the engine accessor into the last-focused
     * editor) and draggable (text/plain accessor for dropping into scripts).
     */

    // Drag-and-drop: tree nodes are dragged and dropped directly into a script
    // editor or template field (no click-to-copy). The accessor is carried in a
    // custom data flavor so we can drop it at the exact cursor position the user
    // releases over — Monaco via getTargetAtClientPoint, plain fields via caret.
    const ACCESSOR_FLAVOR = 'application/x-oie-accessor';
    let draggingAccessor = null;

    function resolveEditorAt(target) {
        if (!target || !(target instanceof Element)) return null;
        const monacoHost = target.closest('.ce-monaco');
        if (monacoHost) {
            const me = window.monaco && window.monaco.editor;
            const editors = me && me.getEditors ? me.getEditors() : [];
            const inst = editors.find(ed => {
                const node = ed.getDomNode && ed.getDomNode();
                return node && node.contains(target);
            });
            if (inst && !(inst.getRawOptions && inst.getRawOptions().readOnly)) return { monaco: inst };
            return null;
        }
        if ((target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && target.type === 'text')) &&
            !target.readOnly && !target.disabled) {
            return { el: target };
        }
        return null;
    }

    function hasAccessorDrag(e) {
        if (draggingAccessor) return true;
        return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(ACCESSOR_FLAVOR));
    }

    // Allow dropping onto editors/fields anywhere in the view (the tree lives in
    // the side panel; the editors are in the bottom panel — same document).
    function onAccessorDragOver(e) {
        if (!hasAccessorDrag(e)) return;
        if (resolveEditorAt(e.target)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    }

    function onAccessorDrop(e) {
        if (!hasAccessorDrag(e)) return;
        const editor = resolveEditorAt(e.target);
        if (!editor) return;
        const token = draggingAccessor ||
            (e.dataTransfer && (e.dataTransfer.getData(ACCESSOR_FLAVOR) || e.dataTransfer.getData('text/plain')));
        draggingAccessor = null;
        if (!token) return;
        e.preventDefault();
        if (editor.monaco) {
            const inst = editor.monaco;
            let pos = inst.getPosition();
            if (inst.getTargetAtClientPoint) {
                const tgt = inst.getTargetAtClientPoint(e.clientX, e.clientY);
                if (tgt && tgt.position) pos = tgt.position;
            }
            const Range = window.monaco.Range;
            inst.executeEdits('message-tree', [{
                range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: token, forceMoveMarkers: true
            }]);
            inst.focus();
        } else if (editor.el) {
            const t = editor.el;
            const start = t.selectionStart ?? t.value.length;
            const end = t.selectionEnd ?? start;
            t.value = t.value.slice(0, start) + token + t.value.slice(end);
            t.selectionStart = t.selectionEnd = start + token.length;
            t.dispatchEvent(new Event('input', { bubbles: true }));
            t.focus();
        }
    }

    /* Tree node model: { label, value (leaf text | null), accessor, children: [] } */

    function escapeKey(key) {
        return String(key).replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
    }

    function looksLikeEr7(text) {
        return /^[A-Z][A-Z0-9]{2}([|\r\n]|$)/.test(text);
    }

    /*
     * Faithful ER7 → tree, mirroring the engine's ER7Reader/XMLEncodedHL7Handler
     * so node labels and accessors match the serialized XML the runtime `msg`
     * is built from:
     *   - element names are dotted (SEG, SEG.n, SEG.n.m, SEG.n.m.s)
     *   - a field WITH a component separator nests SEG.n.1, SEG.n.2, …
     *     (a field WITHOUT one keeps its value directly on SEG.n — no .1 wrap)
     *   - subcomponents ('&') nest one level deeper (default handleSubcomponents)
     *   - repetitions ('~') are sibling field elements indexed [0], [1], …
     *   - empty fields are preserved positionally
     *   - MSH.1 is the field separator, MSH.2 the encoding characters
     */

    // One component (SEG.n.m): splits subcomponents on '&' when present.
    function hl7CompNode(compDot, compAcc, comp) {
        if (comp.indexOf('&') > -1) {
            const subs = comp.split('&');
            return {
                label: compDot, value: null, accessor: `${compAcc}.toString()`,
                children: subs.map((sub, si) => {
                    const subDot = `${compDot}.${si + 1}`;
                    return { label: subDot, value: sub, accessor: `${compAcc}['${subDot}'].toString()`, children: [] };
                })
            };
        }
        return { label: compDot, value: comp, accessor: `${compAcc}.toString()`, children: [] };
    }

    // One field instance (a single repetition). dotName e.g. "PID.5"; acc the
    // accessor for this instance (already carrying any repetition index).
    function hl7ValueNode(dotName, acc, raw, labelSuffix) {
        const label = dotName + (labelSuffix || '');
        if (raw.indexOf('^') > -1) {
            const comps = raw.split('^');
            return {
                label, value: null, accessor: `${acc}.toString()`,
                children: comps.map((comp, ci) => {
                    const compDot = `${dotName}.${ci + 1}`;
                    return hl7CompNode(compDot, `${acc}['${compDot}']`, comp);
                })
            };
        }
        if (raw.indexOf('&') > -1) {
            // Subcomponents without components → a single implicit component .1.
            const compDot = `${dotName}.1`;
            return {
                label, value: null, accessor: `${acc}.toString()`,
                children: [hl7CompNode(compDot, `${acc}['${compDot}']`, raw)]
            };
        }
        // A non-empty field is serialized down to a single .1 component
        // (matches the engine: <PID.7><PID.7.1>…); empty fields stay bare.
        if (raw !== '') {
            const compDot = `${dotName}.1`;
            return {
                label, value: null, accessor: `${acc}.toString()`,
                children: [{ label: compDot, value: raw, accessor: `${acc}['${compDot}'].toString()`, children: [] }]
            };
        }
        return { label, value: raw, accessor: `${acc}.toString()`, children: [] };
    }

    // A field → one node, or several sibling nodes for '~' repetitions.
    function hl7FieldNodes(dotName, fieldAcc, raw) {
        const reps = raw.split('~');
        if (reps.length > 1) {
            return reps.map((rep, r) => hl7ValueNode(dotName, `${fieldAcc}[${r}]`, rep, ` [${r}]`));
        }
        return [hl7ValueNode(dotName, fieldAcc, raw)];
    }

    function hl7Tree(text, varName) {
        const lines = text.split(/\r\n|\r|\n/).map(s => s.trim()).filter(Boolean);
        if (!lines.length || !looksLikeEr7(lines[0])) throw new Error('not ER7');
        const counts = {};
        for (const line of lines) {
            const id = line.split('|')[0];
            counts[id] = (counts[id] || 0) + 1;
        }
        const seen = {};
        return lines.map(line => {
            const fields = line.split('|');
            const segName = fields[0];
            const index = seen[segName] || 0;
            seen[segName] = index + 1;
            // Repeated segments (e.g. multiple OBX) are indexed siblings.
            let segAcc = `${varName}['${segName}']`;
            if (counts[segName] > 1) segAcc += `[${index}]`;
            const children = [];
            if (segName === 'MSH') {
                children.push({ label: 'MSH.1', value: '|', accessor: `${segAcc}['MSH.1'].toString()`, children: [] });
                if (fields.length > 1) {
                    children.push({ label: 'MSH.2', value: fields[1], accessor: `${segAcc}['MSH.2'].toString()`, children: [] });
                }
                // After the encoding-chars field, MSH.(i+1) maps to fields[i].
                for (let i = 2; i < fields.length; i++) {
                    const dot = `MSH.${i + 1}`;
                    children.push(...hl7FieldNodes(dot, `${segAcc}['${dot}']`, fields[i]));
                }
            } else {
                for (let i = 1; i < fields.length; i++) {
                    const dot = `${segName}.${i}`;
                    children.push(...hl7FieldNodes(dot, `${segAcc}['${dot}']`, fields[i]));
                }
            }
            return { label: segName, value: null, accessor: `${segAcc}.toString()`, children };
        });
    }

    function xmlElementNode(element, accessor, descriptions) {
        const children = [];
        for (const attr of element.attributes) {
            children.push({
                label: `@${attr.name}`, value: attr.value,
                accessor: `${accessor}['@${escapeKey(attr.name)}'].toString()`, children: []
            });
        }
        const childElements = [...element.children];
        const counts = {};
        for (const child of childElements) counts[child.tagName] = (counts[child.tagName] || 0) + 1;
        const seen = {};
        for (const child of childElements) {
            const index = seen[child.tagName] || 0;
            seen[child.tagName] = index + 1;
            let childAcc = `${accessor}['${escapeKey(child.tagName)}']`;
            if (counts[child.tagName] > 1) childAcc += `[${index}]`;
            children.push(xmlElementNode(child, childAcc, descriptions));
        }
        const text = childElements.length ? null : (element.textContent ?? '');
        // Overlay the engine vocabulary description on the display label only;
        // the accessor stays the raw node name (matches the Swing tree).
        const desc = descriptions && descriptions[element.tagName];
        const label = desc ? `${element.tagName} (${desc})` : element.tagName;
        return { label, value: text, accessor: `${accessor}.toString()`, children };
    }

    function xmlTree(text, varName, meta) {
        const doc = new DOMParser().parseFromString(text, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('not XML');
        // The E4X root element is the msg/tmp variable itself.
        const descriptions = (meta && meta.descriptions) || null;
        const root = xmlElementNode(doc.documentElement, varName, descriptions);
        // Label the root with the message type/version/description (e.g.
        // "OML-O21 (2.5.1) (Laboratory Order)") while keeping its accessor.
        if (meta && meta.root) root.label = meta.root;
        return [root];
    }

    function jsonValueNode(label, value, accessor) {
        if (Array.isArray(value)) {
            return {
                label, value: null, accessor,
                children: value.map((item, i) => jsonValueNode(`[${i}]`, item, `${accessor}[${i}]`))
            };
        }
        if (value && typeof value === 'object') {
            return {
                label, value: null, accessor,
                children: Object.entries(value).map(([key, val]) =>
                    jsonValueNode(key, val, `${accessor}['${escapeKey(key)}']`))
            };
        }
        return { label, value: value === null ? 'null' : String(value), accessor, children: [] };
    }

    function jsonTree(text, varName) {
        return [jsonValueNode(varName, JSON.parse(text), varName)];
    }

    function parseTemplateTree(text, dataType, varName) {
        const trimmed = text.trim();
        if (dataType === 'HL7V2') {
            if (looksLikeEr7(trimmed)) return hl7Tree(trimmed, varName);
            return xmlTree(trimmed, varName);   // HL7 v2 in its XML representation
        }
        if (dataType === 'XML' || dataType === 'HL7V3') return xmlTree(trimmed, varName);
        if (dataType === 'JSON') return jsonTree(trimmed, varName);
        // RAW and other types: best-effort detection.
        if (trimmed.startsWith('<')) return xmlTree(trimmed, varName);
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) return jsonTree(trimmed, varName);
        if (looksLikeEr7(trimmed)) return hl7Tree(trimmed, varName);
        throw new Error('unrecognized');
    }

    /* Steps created from a tree node's accessor — the Swing TreePanel popup
       ("Map to Variable" → Mapper, "Map to Message" → Message Builder). */
    const MAPPER_TYPE = 'com.mirth.connect.plugins.mapper.MapperStep';
    const MSGBUILDER_TYPE = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';

    function addTreeStep(typeId, label, baseName, setup) {
        const def = platform.stepTypes().get(typeId);
        if (!def) { toast(`${label} is not available`, 'warn'); return; }
        const el = def.create ? def.create() : { __type: typeId };
        el.__type = typeId;
        el.name = baseName || label;
        el.enabled = true;
        setup(el);
        elements.push(el);
        selectedPath = [elements.length - 1];
        commit();
        renderAll();
        toast(`Added ${label} "${el.name}"`);
    }

    function nodeMenuItems(node, side, hasKids, expandAll) {
        const items = [];
        if (hasKids) {
            items.push({ label: 'Expand All', onClick: () => expandAll(true) });
            items.push({ label: 'Collapse All', onClick: () => expandAll(false) });
        }
        // Map actions are transformer-only (filter editors have no message tree).
        if (!isFilter) {
            const name = String(node.label || 'value');
            if (side === 'inbound') {
                if (items.length) items.push('-');
                items.push({
                    label: 'Map to Variable', icon: 'transform',
                    onClick: () => addTreeStep(MAPPER_TYPE, 'Mapper', name, el => { el.mapping = node.accessor; el.variable = name; })
                });
            } else if (side === 'outbound') {
                if (items.length) items.push('-');
                const lval = node.accessor.replace(/\.toString\(\)\s*$/, '');   // assignment target, not a read
                items.push({
                    label: 'Map to Message', icon: 'transform',
                    onClick: () => addTreeStep(MSGBUILDER_TYPE, 'Message Builder', name, el => { el.messageSegment = lval; })
                });
            }
        }
        return items;
    }

    function renderTreeNode(node, depth, defaultOpen, side) {
        const hasKids = node.children.length > 0;
        const wrap = h('div');
        let open = defaultOpen(depth);
        const twisty = hasKids
            ? h('span.twisty' + (open ? '.open' : ''), '▸')
            : h('span.twisty');
        let childrenEl = null;
        const childWraps = [];
        function setOpen(state) {
            if (!hasKids) return;
            open = state;
            twisty.classList.toggle('open', open);
            childrenEl.style.display = open ? '' : 'none';
        }
        function expandAll(state) {
            setOpen(state);
            for (const w of childWraps) if (w._expandAll) w._expandAll(state);
        }
        wrap._expandAll = expandAll;
        const row = h('div.tree-node', {
            draggable: 'true',
            title: `Drag into a script editor: ${node.accessor}`,
            style: { cursor: 'grab' },
            onDragstart: (e) => {
                draggingAccessor = node.accessor;
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', node.accessor);
                e.dataTransfer.setData(ACCESSOR_FLAVOR, node.accessor);
            },
            onDragend: () => { draggingAccessor = null; },
            onContextmenu: (e) => {
                const items = nodeMenuItems(node, side, hasKids, expandAll);
                if (!items.length) return;
                e.preventDefault();
                contextMenu(e.clientX, e.clientY, items);
            }
        },
            twisty,
            h('span.mono', { style: { fontSize: '11.5px', color: 'var(--accent)' } }, node.label),
            node.value !== null && node.value !== ''
                ? h('span.faint.ellipsis', { style: { fontSize: '11.5px', minWidth: '0' } }, node.value)
                : null);
        wrap.appendChild(row);
        if (hasKids) {
            childrenEl = h('div.tree-children',
                node.children.map(child => {
                    const w = renderTreeNode(child, depth + 1, defaultOpen, side);
                    childWraps.push(w);
                    return w;
                }));
            childrenEl.style.display = open ? '' : 'none';
            twisty.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
            wrap.appendChild(childrenEl);
        }
        return wrap;
    }

    function renderNodes(body, nodes, side) {
        clear(body);
        // Match the Swing client: only the message root is expanded by default;
        // segments and deeper nodes start collapsed. Child rows are always in the
        // DOM regardless, so this only toggles visibility — no extra cost.
        const defaultOpen = (depth) => depth === 0;
        for (const node of nodes) body.appendChild(renderTreeNode(node, 0, defaultOpen, side));
    }

    function buildTreeSection(title, side, varName, openByDefault) {
        const body = h('div.tree', { style: { padding: '4px 0' } });
        const template = target[`${side}Template`];
        const dataType = target[`${side}DataType`] || 'RAW';
        const props = target[`${side}Properties`] || {};
        const serProps = props.serializationProperties || {};
        const sourceBadge = h('span.faint', { style: { fontSize: '10px', marginLeft: '6px' } });

        const dtLabel = () => (dataTypeDef(dataType) || { label: dataType }).label;

        if (template == null || String(template).trim() === '') {
            body.appendChild(h('div.faint', { style: { padding: '4px 12px', fontSize: '12px' } },
                '(no template — set one on the Message Templates tab)'));
        } else {
            const tmpl = String(template);
            body.appendChild(h('div.faint', { style: { padding: '4px 12px', fontSize: '12px' } }, 'Parsing…'));
            // Prefer the engine serializer bridge (byte-exact, all data types,
            // strict + non-strict); fall back to built-in JS parsing offline.
            (async () => {
                let nodes = null;
                const ser = await serializeTemplate(dataType, serProps, tmpl).catch(() => null);
                if (ser && ser.text != null) {
                    try {
                        nodes = ser.format === 'json' ? jsonTree(ser.text, varName) : xmlTree(ser.text, varName, ser.meta);
                        sourceBadge.textContent = '· exact (engine)';
                    } catch { nodes = null; }
                }
                if (!nodes) {
                    try {
                        nodes = parseTemplateTree(tmpl, dataType, varName);
                        sourceBadge.textContent = ser === null ? '· approximate (offline)' : '';
                    } catch {
                        clear(body);
                        body.appendChild(h('div.faint', { style: { padding: '4px 12px', fontSize: '12px' } },
                            `Template could not be parsed as ${dtLabel()}`));
                        return;
                    }
                }
                renderNodes(body, nodes, side);
            })();
        }
        body.style.display = openByDefault ? '' : 'none';
        const twisty = h('span.twisty' + (openByDefault ? '.open' : ''), '▸');
        let open = openByDefault;
        const header = h('div.tree-node', {
            style: { fontWeight: '600' },
            onClick: () => {
                open = !open;
                twisty.classList.toggle('open', open);
                body.style.display = open ? '' : 'none';
            }
        }, twisty, `${title} (${varName})`, sourceBadge);
        return h('div', header, body);
    }

    function buildTreesTab() {
        return h('div', { style: { padding: '8px 4px', overflow: 'auto' } },
            buildTreeSection('Inbound Message Template', 'inbound', 'msg', true),
            buildTreeSection('Outbound Message Template', 'outbound', 'tmp', false),
            h('div.faint', { style: { padding: '8px 12px', fontSize: '11px' } },
                'Drag a node into a script editor or template field to insert its accessor at the drop point.'));
    }

    // Side tabs mirror the Swing client: Reference, Message Templates, Message
    // Trees. Each is rebuilt on tab switch so it reflects the current steps
    // (Reference's Available Variables) and template edits.
    const sideDefs = [{ label: 'Reference', render: () => buildReferenceTab() }];
    if (!isFilter) {
        sideDefs.push({ label: 'Message Templates', render: () => buildTemplatesTab() });
        sideDefs.push({ label: 'Message Trees', render: () => buildTreesTab() });
    }
    const sideTabs = tabs(sideDefs);

    /* ---- layout ------------------------------------------------------------------------ */

    renderAll();

    // The task pane is React; the body is just the split layout (no .taskbar here).
    const el = h('div.view-body.flush', { style: { display: 'flex', flex: '1', minHeight: '0' } },
        h('div.split', { style: { flex: '1', minWidth: '0' } },
            h('div.split-a.split.vertical', { style: { flex: '1', minWidth: '0' } },
                h('div.split-a', { style: { height: '40%', flex: 'none' } }, tableHost),
                h('div.split-handle'),
                h('div.split-b', { style: { display: 'flex', flexDirection: 'column', minHeight: '0' } },
                    bottomTabs.el)),
            h('div.split-handle', { 'data-orient': 'h', 'data-resize': 'next' }),
            h('div.split-b', {
                style: {
                    // Wide enough to show the full tab bar (Reference / Message
                    // Templates / Message Trees) without horizontal scrolling.
                    flex: 'none', width: '460px',
                    display: 'flex', flexDirection: 'column', minHeight: '0',
                    borderLeft: '1px solid var(--line)'
                }
            }, sideTabs.el)));

    return {
        el,
        onAccessorDragOver,
        onAccessorDrop,
        taskState,
        handlers: {
            addElement, deleteElement, assignToIterator, removeFromIterator,
            importElements, exportElements, validateElements, validateElement,
            saveChannel, backToChannel
        },
        // Teardown persists the working copy but must not mark dirty (see persist()),
        // then clears the editor's code-template scope so it can't leak to the next view.
        teardown: () => { if (elementEditorRoot) elementEditorRoot(); generatedEditor.dispose && generatedEditor.dispose(); persist(); store.setState('navGuard', null); clearActiveScope(); }
    };
}
