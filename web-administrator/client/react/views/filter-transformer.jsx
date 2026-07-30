/*
 * Filter / Transformer / Response Transformer editor — parity with the Swing
 * Administrator's filter and transformer panes, fully declarative React. Edits
 * the polymorphic element list (rules/steps) of one connector, using the
 * step/rule editors registered through the platform (TransformerStepPlugin /
 * FilterRulePlugin equivalent).
 *
 * Classic layout: steps/rules grid on top, Step + Generated Script tabs below,
 * and a right-hand Reference / Message Trees / Message Templates panel. The
 * grid, tabs, side panel and trees all render from React state. Three
 * imperative islands remain, each behind a documented ref bridge:
 *   - the step/rule plugin editor mounts via mountReact so its flushSync render
 *     can be bracketed with `settling` (plugins onChange() defaults during
 *     mount, which must not mark the channel dirty);
 *   - the read-only Generated Script pane is a createCodeEditor behind a host;
 *   - the side panel renders into an UNMANAGED host div (its own React root),
 *     because the code view (oie:code-view) physically reparents that element
 *     into the overlay and back — DOM the main tree must not reconcile.
 *
 * The edit model is the session's mutable working model: `elements` (and the
 * iterator __children arrays) are mutated in place — object identity IS the
 * save payload — and a `rev` bump repaints. Selection is an index path;
 * elementsRef/selectedPathRef mirrors let menus and dialogs (which outlive the
 * render that opened them) resolve their target at execution time.
 *
 * The channel travels through the store ('editingChannel') so unsaved edits
 * survive navigation between the channel editor and this view. Dirty is the
 * explicit editingChannelDirty store flag; persist() (teardown) never sets it,
 * only commit() does.
 *
 * createEmbeddedEditor keeps the imperative embedding contract the channel
 * wizard captures once: a synchronous { el, teardown, handlers, taskState,
 * onAccessorDragOver, onAccessorDrop } built over a flushSync mountReact.
 * Embedded mounts skip the webadmin:set-title dispatch (the wizard owns its
 * banner) but keep the code-template completion scope in both modes.
 */

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { h, modal, detailModal, toast, loading, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { createCodeEditor } from '@oie/web-ui';
import * as store from '../../core/store.js';
import { generateElementScript } from '../../core/step-script.js';
import * as router from '../../core/router.js';
import { setActiveScope, clearActiveScope } from '../../core/script-completions.js';
import { serializeTemplate, validateScript } from '../../core/serialize.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';
import { REFERENCE_CATALOG } from '../../core/reference-catalog.js';
import { platform } from '@oie/web-shell';
import { ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane, TaskButton, useTabList } from '../ui.jsx';
import { Icon } from '../bridges.jsx';

const KINDS = {
    filter: { title: 'Filter', noun: 'Rule', targetKey: 'filter' },
    transformer: { title: 'Transformer', noun: 'Step', targetKey: 'transformer' },
    response: { title: 'Response Transformer', noun: 'Step', targetKey: 'responseTransformer' }
};


/* ---- element tree machinery (pure, shared by grid + actions) ------------------ */

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

function listAtPath(elements, path) {
    let list = elements;
    for (let k = 0; k < path.length - 1; k++) {
        const el = list[path[k]];
        if (!el || !isIteratorType(el.__type)) return null;
        list = childrenOf(el);
    }
    return list;
}
function elementAtPath(elements, path) {
    if (!path || !path.length) return null;
    const list = listAtPath(elements, path);
    return list ? list[path[path.length - 1]] : null;
}
// Find an element's path by identity (robust to index shifts after edits).
function pathOf(target, list, parent = []) {
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

// Flatten the tree to display rows in order, carrying each row's path/depth.
function flattenRows(list, parentPath, depth, out) {
    list.forEach((el, i) => {
        const path = [...parentPath, i];
        out.push({ el, path, depth });
        if (isIteratorType(el.__type)) flattenRows(childrenOf(el), path, depth + 1, out);
    });
    return out;
}

function allIteratorPaths(list, parent = [], out = []) {
    list.forEach((el, i) => {
        const path = [...parent, i];
        if (isIteratorType(el.__type)) { out.push(path); allIteratorPaths(childrenOf(el), path, out); }
    });
    return out;
}

/* ---- persistence helpers ------------------------------------------------------ */

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
function stampVersions(list, version) {
    for (const el of list) {
        if (!el['@version']) el['@version'] = version;
        if (isIteratorType(el.__type)) {
            if (el.properties && typeof el.properties === 'object' && !el.properties['@version']) {
                el.properties['@version'] = version;
            }
            stampVersions(childrenOf(el), version);
        }
    }
}

/* ---- reference-tab helpers (pure) --------------------------------------------- */

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
function collectStepVariables(elements) {
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

/* ---- accessor drag-and-drop ---------------------------------------------------
   Tree nodes and reference rows are dragged and dropped directly into a script
   editor or template field. The accessor is carried in a custom data flavor
   (plus text/plain, which the popped-out code view's own drop handlers rely
   on) so we can drop it at the exact cursor position the user releases over —
   Monaco via getTargetAtClientPoint, plain fields via caret. `dragRef` is the
   per-editor-instance live token (a ref, since the drag outlives renders). */

const ACCESSOR_FLAVOR = 'application/x-oie-accessor';

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

function hasAccessorDrag(dragRef, e) {
    if (dragRef.current) return true;
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(ACCESSOR_FLAVOR));
}

// Allow dropping onto editors/fields anywhere in the view (the tree lives in
// the side panel; the editors are in the bottom panel — same document).
function makeAccessorDragOver(dragRef) {
    return (e) => {
        if (!hasAccessorDrag(dragRef, e)) return;
        if (resolveEditorAt(e.target)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    };
}

function makeAccessorDrop(dragRef) {
    return (e) => {
        if (!hasAccessorDrag(dragRef, e)) return;
        const editor = resolveEditorAt(e.target);
        if (!editor) return;
        const token = dragRef.current ||
            (e.dataTransfer && (e.dataTransfer.getData(ACCESSOR_FLAVOR) || e.dataTransfer.getData('text/plain')));
        dragRef.current = null;
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
            const next = t.value.slice(0, start) + token + t.value.slice(end);
            // React-controlled fields wrap the instance `value` setter with a
            // change tracker that dedupes the dispatched event; write through
            // the native prototype setter so the tracker sees the change and
            // the field's onChange (which owns the model write) actually fires.
            const proto = t.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, next);
            t.selectionStart = t.selectionEnd = start + token.length;
            t.dispatchEvent(new Event('input', { bubbles: true }));
            t.focus();
        }
    };
}

// Shared dragstart props for accessor sources (reference rows, tree nodes).
function accessorDragProps(dragRef, token) {
    return {
        draggable: true,
        onDragStart: (e) => {
            dragRef.current = token;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', token);
            e.dataTransfer.setData(ACCESSOR_FLAVOR, token);
        },
        onDragEnd: () => { dragRef.current = null; }
    };
}

/* ---- message tree models (pure) ----------------------------------------------- */

function escapeKey(key) {
    return String(key).replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
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

/* Steps created from a tree node's accessor — the Swing TreePanel popup
   ("Map to Variable" → Mapper, "Map to Message" → Message Builder). */
const MAPPER_TYPE = 'com.mirth.connect.plugins.mapper.MapperStep';
const MSGBUILDER_TYPE = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';

/* ---- element grid (top pane, classic grid) ------------------------------------ */

function typeDefFor(isFilter, type) {
    return isFilter ? platform.ruleType(type) : platform.stepType(type);
}

function elementNameOf(isFilter, el) {
    const def = typeDefFor(isFilter, el.__type);
    return el.name || (def ? def.label : oie.elementTypeLabel(el.__type));
}

/* One grid row. Module-scope with a stable key (the path string) so re-renders
   from per-keystroke commits never remount the inline inputs (focus survives).
   Clicks on the inline controls stay off the row handler so editing never
   changes the selection (Swing parity: select via the other cells). */
function GridRow({ el, path, depth, isFilter, selected, typeOptions, onSelect, onCommit, onChangeType }) {
    const idx = path[path.length - 1];
    const def = typeDefFor(isFilter, el.__type);
    const stop = (e) => e.stopPropagation();
    const options = typeOptions.some(o => o.value === el.__type)
        ? typeOptions
        : [{ value: el.__type, label: oie.elementTypeLabel(el.__type) }, ...typeOptions];
    return (
        <tr className={'cursor-pointer' + (selected ? ' selected' : '')} data-path={path.join('.')}
            onClick={() => onSelect(path)}>
            <td className="text-center">
                <input type="checkbox" checked={el.enabled !== false} onClick={stop}
                    onChange={(e) => { el.enabled = e.target.checked; onCommit(); }} />
            </td>
            <td className="num">{String(idx + 1)}</td>
            {isFilter && (
                <td>
                    {idx === 0 ? '' : (
                        <select className="w-[70px]" value={el.operator === 'OR' ? 'OR' : 'AND'}
                            onClick={stop} onMouseDown={stop}
                            onChange={(e) => { el.operator = e.target.value; onCommit(); }}>
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                        </select>
                    )}
                </td>
            )}
            <td>
                <input className="grid-name" type="text" value={el.name || ''}
                    placeholder={def ? def.label : oie.elementTypeLabel(el.__type)}
                    style={{ marginLeft: `${depth * 18}px` }}
                    onClick={stop} onMouseDown={stop} onDoubleClick={stop}
                    onChange={(e) => { el.name = e.target.value; onCommit(); }} />
            </td>
            <td>
                <select className="w-full" value={el.__type} onClick={stop} onMouseDown={stop}
                    onChange={(e) => onChangeType(path, e.target.value)}>
                    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </td>
        </tr>
    );
}

function ElementsGrid({ kind, isFilter, elements, selectedPath, typeOptions, canEdit,
    onSelect, onCommit, onChangeType, onAdd, onImport }) {
    if (!elements.length) {
        // Empty landing state (matches the Alerts view): icon + title + the
        // two ways in, gated like their task-pane twins (channelEdit/doSaveChannel).
        // Right-click falls through to the container's context menu.
        return (
            <div className="dt-empty">
                <div className="empty-icon"><Icon name={isFilter ? 'filter' : 'transform'} size={30} /></div>
                <div>{`No ${kind.noun}s Configured`}</div>
                {canEdit && (
                    <div className="mt-[16px] flex items-center justify-center gap-2">
                        <button className="btn btn-primary" type="button" onClick={onAdd}>
                            <Icon name="plus" size={14} />{`Add New ${kind.noun}`}
                        </button>
                        <button className="btn" type="button" onClick={onImport}>
                            <Icon name="import" size={14} />{`Import ${kind.title}`}
                        </button>
                    </div>
                )}
            </div>
        );
    }
    return (
        <table className="dt">
            <thead>
                <tr>
                    <th className="w-[64px]">Enabled</th>
                    <th className="w-[36px]">#</th>
                    {isFilter && <th className="w-[90px]">Operator</th>}
                    <th>Name</th>
                    <th className="w-[180px]">Type</th>
                </tr>
            </thead>
            <tbody>
                {flattenRows(elements, [], 0, []).map(({ el, path, depth }) => (
                    <GridRow key={path.join('.')} el={el} path={path} depth={depth}
                        isFilter={isFilter} selected={pathEquals(path, selectedPath)}
                        typeOptions={typeOptions}
                        onSelect={onSelect} onCommit={onCommit} onChangeType={onChangeType} />
                ))}
            </tbody>
        </table>
    );
}

/* ---- step/rule editor panel (bottom "Step" tab) -------------------------------
   The plugin editor is an imperative island: mountReact's flushSync render is
   bracketed with the `settling` flag (via settlingRef) so plugins that
   onChange() defaults during mount don't mark the channel dirty. The island
   remounts only when the selected ELEMENT (identity or type) changes — never
   on rev bumps, so plugin editor state (Monaco etc.) survives grid edits. */
function StepEditorPanel({ kind, isFilter, element, headerIndex, settlingRef, onChange, onReplaceElement, destinations }) {
    const hostRef = useRef(null);
    const def = element ? typeDefFor(isFilter, element.__type) : null;
    const hasComponent = !!(def && typeof def.component === 'function');

    useEffect(() => {
        if (!element || !hasComponent) return undefined;
        const host = hostRef.current;
        if (!host) return undefined;
        // Plugins may onChange() while mounting to persist defaults — suppress
        // dirty-marking so opening/selecting a step doesn't flag the channel
        // unsaved. React defers the island's flushSync render when this effect
        // runs inside effect processing, so the flag can't be cleared here in a
        // finally: SettleGuard (a parent of the plugin in the island tree)
        // clears it in its layout effect, which runs after the plugin's own
        // mount render + layout effects wherever the render actually flushes.
        settlingRef.current = true;
        let teardown;
        try {
            teardown = mountReact(host,
                <SettleGuard settlingRef={settlingRef}>
                    <PluginSlot def={def} ctx={{ element, platform, onChange, destinations }} />
                </SettleGuard>);
        } catch (e) {
            settlingRef.current = false;
            throw e;
        }
        // No host.replaceChildren() here: the unmount is deferred past this
        // cleanup (same flushSync deferral), and stripping the DOM first makes
        // the late unmount throw NotFoundError on every plugin remount.
        // root.unmount() empties the container itself.
        return () => {
            settlingRef.current = false;   // unmounted before the render flushed
            try { teardown(); } catch { /* ignore */ }
        };
        // Remount on the element itself (selection/type change), not on repaints.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [element, element && element.__type]);

    if (!element) {
        return (
            <div className="dt-empty panel overflow-visible min-h-full">
                <div>{`Select a ${kind.noun.toLowerCase()} to edit`}</div>
            </div>
        );
    }
    return (
        <div className="panel">
            <div className="panel-header">{`${kind.noun} ${headerIndex} — ${oie.elementTypeLabel(element.__type)}`}</div>
            {hasComponent
                ? <div className="panel-body" ref={hostRef} />
                : <div className="panel-body">
                    <RawElementFallback element={element} onReplace={onReplaceElement} />
                </div>}
        </div>
    );
}

/* Clears the settling flag AFTER the plugin editor's mount work: a parent's
   layout effect runs after all of its children's, so this covers onChange()
   calls from the plugin's first render and layout effects regardless of when
   React flushes the island's deferred render. */
function SettleGuard({ settlingRef, children }) {
    useLayoutEffect(() => { settlingRef.current = false; }, [settlingRef]);
    return children;
}

/* Unknown plugin type: raw JSON fallback so nothing is lost. */
function RawElementFallback({ element, onReplace }) {
    const [text, setText] = useState(() => JSON.stringify(element, null, 2));
    // Re-seed when the selection moves to a different element (the panel is not
    // remounted between same-shape selections).
    useEffect(() => { setText(JSON.stringify(element, null, 2)); }, [element]);
    return (
        <div className="field">
            <label>Raw element (JSON)</label>
            <textarea rows={14} spellCheck={false} value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => {
                    try {
                        const parsed = JSON.parse(text);
                        parsed.__type = element.__type;
                        onReplace(parsed);
                    } catch (e) {
                        toast(`Invalid JSON: ${e.message}`, 'error');
                    }
                }} />
            <div className="hint">{`No editor registered for ${element.__type}`}</div>
        </div>
    );
}

/* ---- bottom tabs (Step / Generated Script) ------------------------------------
   Both panels stay MOUNTED (inactive hidden) — the legacy tabs() reattached the
   same persistent hosts, so plugin editor state and the read-only Monaco
   survive tab switches; hidden-not-detached also keeps the Monaco host in the
   document, out of the route-change detached-editor sweep. */
function BottomTabs({ tabs, active, onActive }) {
    const tabKeys = useTabList(tabs.length, active, onActive, { label: 'Step editor sections' });
    return (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="tabs" {...tabKeys.list}>
                {tabs.map((t, i) => (
                    <button key={t.label} className={'tab' + (i === active ? ' active' : '')}
                        {...tabKeys.tab(i)}
                        onClick={() => onActive(i)}>{t.label}</button>
                ))}
            </div>
            <div className="tab-body">
                {tabs.map((t, i) => (
                    <div key={t.label} className={t.className}
                        style={{ display: i === active ? undefined : 'none' }}>
                        {t.node}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* Read-only Generated Script pane — createCodeEditor behind a host ref; the
   value is pushed by an effect whenever the selection or the tree changes
   (recompute-on-commit: unlike the legacy pane this can never go stale, which
   matches Swing's regenerate-on-every-trigger behavior). */
function GeneratedScriptPane({ kind, element, rev }) {
    const hostRef = useRef(null);
    const editorRef = useRef(null);
    useEffect(() => {
        const editor = createCodeEditor({ value: '', readOnly: true, minHeight: '200px', popoutable: true, popoutTitle: 'Generated Script' });
        editorRef.current = editor;
        hostRef.current.appendChild(editor.el);
        return () => {
            try { editor.dispose && editor.dispose(); } catch { /* ignore */ }
            editorRef.current = null;
        };
    }, []);
    useEffect(() => {
        let script;
        if (!element) {
            script = `// Select a ${kind.noun.toLowerCase()} to preview its script`;
        } else {
            // Generate the script client-side (mirrors each element's engine
            // getScript(false)); falls back for types with no generator.
            const generated = generateElementScript(element, childrenOf);
            script = generated != null ? generated
                : `// ${oie.elementTypeLabel(element.__type)} ${kind.noun.toLowerCase()} — no preview available`;
        }
        if (editorRef.current) editorRef.current.setValue(script);
    }, [kind, element, rev]);
    return <div ref={hostRef} />;
}

/* ---- right panel: Reference --------------------------------------------------- */

function ReferenceRow({ dragRef, name, subtitle, dropText, title }) {
    return (
        <div className="step-item cursor-grab" title={title || undefined}
            {...accessorDragProps(dragRef, dropText)}>
            <div className="flex-1 min-w-0">
                <div className="truncate">{name || '(unnamed)'}</div>
                {subtitle ? <div className="step-type">{subtitle}</div> : null}
            </div>
        </div>
    );
}

function ReferenceTab({ dragRef, channelId, getElements }) {
    // Only categorized references appear in the Swing reference panel;
    // null-category entries (context variables, E4X methods) are
    // autocomplete-only in the client, so they are excluded here.
    const builtin = useMemo(() => REFERENCE_CATALOG
        .filter(r => r.category)
        .map(r => ({ name: r.name, category: r.category, description: r.description, code: r.code, type: r.type })), []);
    // Variables defined by this transformer's steps, computed when the tab
    // mounts (the panel remounts per tab switch, matching the legacy rebuild).
    const availableVars = useMemo(() => collectStepVariables(getElements()), [getElements]);

    const [category, setCategory] = useState('');
    const [query, setQuery] = useState('');
    // User code-template libraries append as extra categories once loaded.
    const [userEntries, setUserEntries] = useState({ entries: [], categories: [] });

    useEffect(() => {
        let stale = false;
        // A library applies to this channel if it includes new channels (and
        // isn't explicitly disabled) or this channel is explicitly enabled.
        const libraryInScope = (lib) => {
            const id = String(channelId);
            const enabled = new Set(api.asList(lib.enabledChannelIds, 'string').map(String));
            const disabled = new Set(api.asList(lib.disabledChannelIds, 'string').map(String));
            return enabled.has(id) || (lib.includeNewChannels && !disabled.has(id));
        };
        api.codeTemplates.libraries(true)
            .then(allLibraries => {
                if (stale) return;
                const entries = [];
                const categories = [];
                for (const library of allLibraries.filter(libraryInScope)) {
                    const name = library.name || '(unnamed library)';
                    if (!categories.includes(name)) categories.push(name);
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
                setUserEntries({ entries, categories });
            })
            .catch(() => { toast('Could not load user code-template libraries; showing built-ins only', 'warn'); });
        return () => { stale = true; };
    }, [channelId]);

    const entries = [...builtin, ...userEntries.entries];
    const present = new Set(entries.map(e => e.category));
    const categories = REFERENCE_CATEGORY_ORDER.filter(c => present.has(c))
        .concat(userEntries.categories.filter(c => present.has(c)));
    const q = query.trim().toLowerCase();
    const visible = entries.filter(en =>
        (!category || en.category === category) &&
        (!q || `${en.name} ${cleanDesc(en.description)}`.toLowerCase().includes(q)));

    return (
        <div className="p-3 flex flex-col h-full min-h-0">
            <div className="field">
                <label>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="field">
                <input type="text" placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="border border-line rounded overflow-auto flex-1 min-h-[120px]">
                {visible.length
                    ? visible.map((en, i) => (
                        <ReferenceRow key={`${en.category}:${en.name}:${i}`} dragRef={dragRef}
                            name={en.name} subtitle={en.category} dropText={dropTextFor(en)}
                            title={en.description ? cleanDesc(en.description) : undefined} />
                    ))
                    : <div className="text-text-faint p-2.5 text-center">No matches</div>}
            </div>
            <div className="font-semibold text-[11px] uppercase tracking-[0.04em] mt-3 mx-0 mb-1">Available Variables</div>
            <div className="border border-line rounded overflow-auto max-h-[140px]">
                {availableVars.length
                    ? availableVars.map(v => <ReferenceRow key={v} dragRef={dragRef} name={v} dropText={v} />)
                    : <div className="text-text-faint py-2 px-2.5 text-[11px]">(no variables defined by steps yet)</div>}
            </div>
        </div>
    );
}

/* ---- right panel: Message Templates (transformer routes only) ------------------ */

function TemplatesSide({ side, title, templateKey, target, version, connectorType, channel, commit }) {
    // The section renders from the mutable target; bump repaints after each
    // model write (type change / template edit / file load).
    const [, bump] = useReducer((x) => x + 1, 0);
    const dtOptions = dataTypeList().map(dt => ({ value: dt.name, label: dt.label }));

    // Fresh default properties object for a data type (one per call).
    const makeDefaultProps = (typeName) => {
        const def = dataTypeDef(typeName);
        return def ? def.defaults(version) : { '@version': version };
    };
    // Seed a properties object for a side, matching the engine's structure.
    const ensureProps = () => {
        let props = target[`${side}Properties`];
        if (!props || typeof props !== 'object') {
            props = makeDefaultProps(target[`${side}DataType`]);
            target[`${side}Properties`] = props;
        }
        return props;
    };
    const dtLabel = (name) => (dataTypeDef(name) || { label: name }).label;
    const typeName = target[`${side}DataType`] || 'RAW';
    ensureProps();

    // Edit this side's data type properties in a modal (Swing's data type
    // properties dialog). Edits go to a draft and apply on OK; the modal is
    // imperative, so the editor mounts through its own root.
    const openPropsModal = () => {
        let draft = JSON.parse(JSON.stringify(ensureProps()));
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
    };

    const onTypeChange = (value) => {
        target[`${side}DataType`] = value;
        target[`${side}Properties`] = makeDefaultProps(value);
        // Swing parity (DataTypesDialog.updateSingleDataType): a destination's
        // inbound data type is the source's outbound, so changing the SOURCE
        // outbound type also sets every destination's inbound type + default props.
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
        bump();
    };

    const openFile = async () => {
        const isDicom = typeName === 'DICOM';
        // DICOM is binary; read it as base64 so it isn't mangled, then
        // serialize to the XML template.
        const file = await pickFile(undefined, { binary: isDicom });
        if (!file) return;
        let text = String(file.content ?? '');
        if (isDicom) {
            // Serialize the binary DICOM to its XML form via the engine's
            // data-type serializer (Swing shows the serialized DICOM XML in
            // the template, not raw bytes).
            const ser = await serializeTemplate('DICOM', target[`${side}Properties`], text).catch(() => null);
            if (ser && ser.text) { text = ser.text; }
            else { toast('Could not serialize the DICOM file — the serialize endpoint may be unavailable.', 'warn'); return; }
        }
        target[templateKey] = text === '' ? null : text;
        commit();
        bump();
    };

    return (
        <div>
            <div className="field">
                <label>{`${title} Data Type`}</label>
                <div className="flex gap-2 items-center">
                    <select value={typeName} onChange={(e) => onTypeChange(e.target.value)}>
                        {dtOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button className="btn btn-sm" onClick={openPropsModal}
                        title="Edit this data type’s serialization properties">Properties…</button>
                    <button className="btn btn-sm" title="Load a message file into this template"
                        onClick={openFile}>Open File…</button>
                </div>
            </div>
            <div className="field">
                <label>{`${title} Template`}</label>
                <textarea rows={6} spellCheck={false} placeholder="(none)"
                    value={target[templateKey] == null ? '' : String(target[templateKey])}
                    onChange={(e) => { target[templateKey] = e.target.value === '' ? null : e.target.value; commit(); bump(); }} />
            </div>
        </div>
    );
}

function TemplatesTab({ target, version, connectorType, channel, commit }) {
    return (
        <div className="p-3">
            <TemplatesSide side="inbound" title="Inbound" templateKey="inboundTemplate"
                target={target} version={version} connectorType={connectorType} channel={channel} commit={commit} />
            <div className="h-3.5" />
            <TemplatesSide side="outbound" title="Outbound" templateKey="outboundTemplate"
                target={target} version={version} connectorType={connectorType} channel={channel} commit={commit} />
        </div>
    );
}

/* ---- right panel: Message Trees (transformer routes only) ---------------------
   Renders the inbound/outbound templates as expandable parse trees. Every node
   is draggable (accessor flavors) and right-clickable (Expand/Collapse All,
   Map to Variable / Map to Message). Expand/Collapse All cascades through a
   {version, open} force signal each node syncs to. */

// Monotonic sequence for expand/collapse-all cascades, so a descendant can
// tell which of two force signals (an ancestor's vs its own) is newest.
let treeForceSeq = 0;

function TreeNode({ node, depth, side, isFilter, dragRef, force, onAddStep }) {
    const hasKids = node.children.length > 0;
    // Match the Swing client: only the message root is expanded by default;
    // segments and deeper nodes start collapsed.
    const [open, setOpen] = useState(depth === 0);
    const [localForce, setLocalForce] = useState(null);   // cascades to descendants
    useEffect(() => {
        if (force && force.version) setOpen(force.open);
    }, [force]);

    const menu = (e) => {
        const items = [];
        if (hasKids) {
            items.push({ label: 'Expand All', onClick: () => { setOpen(true); setLocalForce({ version: ++treeForceSeq, open: true }); } });
            items.push({ label: 'Collapse All', onClick: () => { setOpen(false); setLocalForce({ version: ++treeForceSeq, open: false }); } });
        }
        // Map actions are transformer-only (filter editors have no message tree).
        if (!isFilter) {
            const name = String(node.label || 'value');
            if (side === 'inbound') {
                if (items.length) items.push('-');
                items.push({
                    label: 'Map to Variable', icon: 'transform',
                    onClick: () => onAddStep(MAPPER_TYPE, 'Mapper', name, el => { el.mapping = node.accessor; el.variable = name; })
                });
            } else if (side === 'outbound') {
                if (items.length) items.push('-');
                const lval = node.accessor.replace(/\.toString\(\)\s*$/, '');   // assignment target, not a read
                items.push({
                    label: 'Map to Message', icon: 'transform',
                    onClick: () => onAddStep(MSGBUILDER_TYPE, 'Message Builder', name, el => { el.messageSegment = lval; })
                });
            }
        }
        if (!items.length) return;
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, items);
    };

    // Descendant force: parent cascade wins over this node's own cascade.
    const childForce = force && localForce
        ? (force.version >= localForce.version ? force : localForce)
        : (force || localForce);

    return (
        <div>
            <div className="tree-node cursor-grab" title={`Drag into a script editor: ${node.accessor}`}
                {...accessorDragProps(dragRef, node.accessor)}
                onContextMenu={menu}>
                <span className={'twisty' + (hasKids && open ? ' open' : '')}
                    onClick={hasKids ? (e) => { e.stopPropagation(); setOpen(o => !o); } : undefined}>
                    {hasKids ? '▸' : ''}
                </span>
                <span className="mono text-[11.5px] text-accent">{node.label}</span>
                {node.value !== null && node.value !== ''
                    ? <span className="text-text-faint truncate text-[11.5px] min-w-0">{node.value}</span>
                    : null}
            </div>
            {hasKids && (
                <div className="tree-children" style={{ display: open ? undefined : 'none' }}>
                    {node.children.map((child, i) => (
                        <TreeNode key={i} node={child} depth={depth + 1} side={side} isFilter={isFilter}
                            dragRef={dragRef} force={childForce} onAddStep={onAddStep} />
                    ))}
                </div>
            )}
        </div>
    );
}

function TreeSection({ title, side, varName, openByDefault, target, isFilter, dragRef, onAddStep }) {
    const [open, setOpen] = useState(openByDefault);
    const [parse, setParse] = useState({ status: 'idle' });   // idle | parsing | ready | failed | empty

    const template = target[`${side}Template`];
    const dataType = target[`${side}DataType`] || 'RAW';
    const props = target[`${side}Properties`] || {};
    const dtLabel = (dataTypeDef(dataType) || { label: dataType }).label;

    useEffect(() => {
        if (template == null || String(template).trim() === '') { setParse({ status: 'empty' }); return undefined; }
        let stale = false;
        setParse({ status: 'parsing' });
        const tmpl = String(template);
        // The engine serializes the template through its own datatype serializers
        // (byte-exact, all data types, strict + non-strict); the tree is built from
        // that output. No local parsing — this depends on the connected engine.
        (async () => {
            let nodes = null;
            if (dataType === 'DICOM') {
                // The DICOM template is already the serialized DICOM XML (Open
                // File converted the binary), so build the tree from it directly.
                // Re-serializing would fail — the engine's DICOM serialize expects
                // raw binary, not the XML form.
                try { nodes = xmlTree(tmpl, varName); } catch { nodes = null; }
            } else {
                const ser = await serializeTemplate(dataType, props.serializationProperties || {}, tmpl).catch(() => null);
                if (ser && ser.text != null) {
                    try {
                        nodes = ser.format === 'json' ? jsonTree(ser.text, varName) : xmlTree(ser.text, varName, ser.meta);
                    } catch { nodes = null; }
                }
            }
            if (stale) return;
            setParse(nodes ? { status: 'ready', nodes } : { status: 'failed' });
        })();
        return () => { stale = true; };
        // The template/type/props live on the mutable target; the section mounts
        // fresh per side-tab activation, which is when the tree re-reads them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div>
            <div className="tree-node font-semibold" onClick={() => setOpen(o => !o)}>
                <span className={'twisty' + (open ? ' open' : '')}>▸</span>
                {`${title} (${varName})`}
            </div>
            <div className="tree py-1 px-0" style={{ display: open ? undefined : 'none' }}>
                {parse.status === 'empty' && (
                    <div className="text-text-faint py-1 px-3 text-[12px]">(no template — set one on the Message Templates tab)</div>
                )}
                {parse.status === 'parsing' && (
                    <div className="text-text-faint py-1 px-3 text-[12px]">Parsing…</div>
                )}
                {parse.status === 'failed' && (
                    <div className="text-text-faint py-1 px-3 text-[12px]">
                        {`Could not build the message tree — the engine could not serialize this ${dtLabel} template.`}
                    </div>
                )}
                {parse.status === 'ready' && parse.nodes.map((node, i) => (
                    <TreeNode key={i} node={node} depth={0} side={side} isFilter={isFilter}
                        dragRef={dragRef} force={null} onAddStep={onAddStep} />
                ))}
            </div>
        </div>
    );
}

function TreesTab({ target, isFilter, dragRef, onAddStep }) {
    return (
        <div className="py-2 px-1 overflow-auto">
            <TreeSection title="Inbound Message Template" side="inbound" varName="msg" openByDefault
                target={target} isFilter={isFilter} dragRef={dragRef} onAddStep={onAddStep} />
            <TreeSection title="Outbound Message Template" side="outbound" varName="tmp" openByDefault={false}
                target={target} isFilter={isFilter} dragRef={dragRef} onAddStep={onAddStep} />
            <div className="text-text-faint py-2 px-3 text-[11px]">
                Drag a node into a script editor or template field to insert its accessor at the drop point.
            </div>
        </div>
    );
}

/* Side tabs mirror the Swing client: Reference, Message Trees, Message
   Templates. The active tab is KEYED so switching remounts it — each tab
   re-reads the current steps (Reference's Available Variables) and template
   edits on activation, matching the legacy rebuild-on-switch. */
function SidePanel({ ctx }) {
    const [active, setActive] = useState(0);
    const { isFilter } = ctx;
    const labels = isFilter ? ['Reference'] : ['Reference', 'Message Trees', 'Message Templates'];
    const tabKeys = useTabList(labels.length, Math.min(active, labels.length - 1), setActive,
        { label: 'Reference panel sections' });
    const label = labels[Math.min(active, labels.length - 1)];
    let body = null;
    if (label === 'Reference') {
        body = <ReferenceTab key="ref" dragRef={ctx.dragRef} channelId={ctx.channelId} getElements={ctx.getElements} />;
    } else if (label === 'Message Trees') {
        body = <TreesTab key="trees" target={ctx.target} isFilter={isFilter} dragRef={ctx.dragRef} onAddStep={ctx.onAddStep} />;
    } else if (label === 'Message Templates') {
        body = <TemplatesTab key="templates" target={ctx.target} version={ctx.version}
            connectorType={ctx.connectorType} channel={ctx.channel} commit={ctx.commit} />;
    }
    return (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="tabs" {...tabKeys.list}>
                {labels.map((l, i) => (
                    <button key={l} className={'tab' + (i === active ? ' active' : '')}
                        {...tabKeys.tab(i)}
                        onClick={() => setActive(i)}>{l}</button>
                ))}
            </div>
            <div className="tab-body">{body}</div>
        </div>
    );
}

/* ---- the editor body ---------------------------------------------------------- */

/*
 * The full editor (grid + bottom tabs + side panel). Renders for two callers:
 * the routed FilterTransformerView (in-tree child) and the channel wizard's
 * createEmbeddedEditor (own root via mountReact). `apiRef` receives the live
 * { taskState, handlers, onAccessorDragOver, onAccessorDrop } the task pane /
 * wizard toolbar read; it is re-pointed every render so callers always invoke
 * fresh closures. `embedded` skips the webadmin:set-title dispatch (the wizard
 * owns its banner); the code-template completion scope is set in both modes.
 */
function EditorBody({ params, kindName, onTasksChange, apiRef, embedded }) {
    const kind = KINDS[kindName];
    const isFilter = kindName === 'filter';

    /* ---- one-time setup: resolve the working model from the store -------------
       The channel is guaranteed present (the routed view fetches it first; the
       wizard seeds it). The element tree is the session's MUTABLE working
       model: hydrated once, mutated in place by every action, serialized back
       in persist(). */
    const setupRef = useRef(null);
    if (!setupRef.current) {
        const channel = store.getState('editingChannel');
        const version = channel['@version'] || store.getState('serverVersion') || '4.5.2';
        const connector = String(params.metaDataId) === '0'
            ? channel.sourceConnector
            : oie.destinationsOf(channel).find(d => Number(d.metaDataId) === Number(params.metaDataId));
        let target = null;
        let elements = [];
        if (connector) {
            if (!connector[kind.targetKey]) {
                connector[kind.targetKey] = isFilter ? oie.emptyFilter(version) : oie.emptyTransformer(version);
            }
            target = connector[kind.targetKey];
            elements = oie.elementsToArray(target.elements);
            hydrateChildren(elements);
        }
        setupRef.current = { channel, version, connector, target, elements };
    }
    const { channel, version, connector, target } = setupRef.current;
    // The channel's destinations (metaDataId + name) — threaded to step editors
    // that need them (e.g. Destination Set Filter's selectable destination list).
    const stepDestinations = useMemo(() => oie.destinationsOf(channel)
        .map(d => ({ metaDataId: d.metaDataId, name: d.name })), [channel]);
    // Connector type drives which data type property groups apply (see props-editor).
    const connectorType = kindName === 'response' ? 'RESPONSE'
        : (String(params.metaDataId) === '0' ? 'SOURCE' : 'DESTINATION');
    const isSourceConnector = connectorType === 'SOURCE';

    /* ---- state + execution-time mirrors ---- */
    const elementsRef = useRef(setupRef.current.elements);
    const [selectedPath, setSelectedPathState] = useState(() =>
        setupRef.current.elements.length ? [0] : null);
    const selectedPathRef = useRef(selectedPath);
    const setSelected = (path) => { selectedPathRef.current = path; setSelectedPathState(path); };
    const [rev, bump] = useReducer((x) => x + 1, 0);
    const [bottomTab, setBottomTab] = useState(0);
    // True only while a step plugin's flushSync mount runs (see StepEditorPanel).
    const settlingRef = useRef(false);
    // Live accessor-drag token (reference rows / tree nodes → editors).
    const dragRef = useRef(null);
    const rootRef = useRef(null);
    const guardImplRef = useRef(null);

    const missingConnector = !connector;

    /* ---- dirty tracking + persistence ---- */

    const channelDirty = () =>
        store.getState('editingChannelNew') === true ||
        store.getState('editingChannelDirty') === true;

    // Serialize the working step list back onto the channel in the store. Used
    // on teardown too, so it must NOT touch the dirty flag (otherwise leaving the
    // editor after a save would re-mark the channel dirty).
    function persist() {
        if (!target) return;
        // The first rule in each list has no boolean operator; the rest do.
        if (isFilter) normalizeOperators(elementsRef.current);
        stampVersions(elementsRef.current, version);
        target.elements = oie.arrayToElements(serializeList(elementsRef.current));
        // Refresh the store's working copy only while we're still in the editing
        // flow. If the nav guard cleared it (left the editor with Don't Save), the
        // teardown persist() must not resurrect the discarded copy.
        if (store.getState('editingChannel')) store.setState('editingChannel', channel);
    }
    const persistRef = useRef(persist);
    persistRef.current = persist;

    // Called by the edit handlers: persist AND mark the shared dirty flag the
    // channel editor reads, so unsaved step edits prompt on exit. The rev bump
    // repaints the grid and regenerates the script preview.
    function commit() {
        persist();
        if (settlingRef.current) return;            // plugin initialization, not a user edit
        store.setState('editingChannelDirty', true);
        onTasksChange();
        bump();
    }
    const commitRef = useRef(commit);
    commitRef.current = commit;

    async function saveChannel() {
        persist();
        const problems = oie.validateChannel(channel);
        if (problems.length) {
            modal({
                title: 'Cannot Save Channel',
                body: h('div',
                    h('p', 'Fix the following before saving — the engine would reject this channel:'),
                    h('ul', { class: 'mt-2 mx-0 mb-0 pl-[18px]' }, problems.map(p => h('li', p)))),
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
            onTasksChange();
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
            // No save permission -> OK-only notice (channel editor parity).
            if (!platform.checkTask('channelEdit', 'doSaveChannel')) {
                modal({
                    title: 'Unsaved Changes',
                    body: h('div', `You don't have permission to save changes to "${channel.name || 'this channel'}". Your changes will be discarded.`),
                    onClose: () => resolve('cancel'),
                    buttons: [{ label: 'OK', primary: true, onClick: () => resolve('discard') }]
                });
                return;
            }
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

    guardImplRef.current = async ({ path }) => {
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
    };

    /* Mount-scoped side effects. Teardown persists the working copy without
       dirtying, then clears the guard and the editor's code-template scope.
       EMBEDDED mounts never touch the navGuard: the wizard owns navigation
       (and React defers this component's mount past createEmbeddedEditor's
       return, so a guard installed here would land AFTER the wizard restored
       its own and silently clobber it). */
    useLayoutEffect(() => {
        if (missingConnector) return undefined;
        // Scope code-template completions to this connector's editor context.
        // This view is a single context, so set it once (covers every step/rule
        // editor, including the plugin-rendered JavaScript ones).
        setActiveScope(params.channelId, [connectorType === 'RESPONSE' ? 'DESTINATION_RESPONSE_TRANSFORMER'
            : connectorType === 'SOURCE' ? 'SOURCE_FILTER_TRANSFORMER' : 'DESTINATION_FILTER_TRANSFORMER']);
        if (!embedded) store.setState('navGuard', (info) => guardImplRef.current(info));
        if (!embedded) {
            // Banner: "Edit Channel - <name> - <connector> <Filter/Transformer>"
            // (Swing parity). Deferred past the route:changed title reset (see
            // channel-editor) with rAF so it sticks without a flash. Embedded
            // mounts skip this — the wizard owns its banner.
            const connectorLabel = String(params.metaDataId) === '0' ? 'Source' : (connector.name || `Destination ${params.metaDataId}`);
            const bannerTitle = (channel.name ? `Edit Channel - ${channel.name} - ` : '') + `${connectorLabel} ${kind.title}`;
            window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
                detail: { title: bannerTitle }
            })));
        }
        onTasksChange();   // first paint of the (now-populated) task pane
        return () => {
            persistRef.current();
            if (!embedded) store.setState('navGuard', null);
            clearActiveScope();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Missing connector (stale deep link): bail back to the channel editor.
    useEffect(() => {
        if (!missingConnector) return;
        toast(`Connector ${params.metaDataId} not found`, 'error');
        router.navigate(`/channels/${params.channelId}/edit`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [missingConnector]);

    /* ---- element helpers bound to this instance ---- */

    const typeDef = (type) => typeDefFor(isFilter, type);
    const elementName = (el) => elementNameOf(isFilter, el);

    // Step/rule types offered here. Source-only types (e.g. Destination Set Filter)
    // are excluded on destination and response transformers, matching the Swing
    // TransformerPane (which drops onlySourceConnector() plugins off the source).
    function availableTypeEntries() {
        const registry = isFilter ? platform.ruleTypes() : platform.stepTypes();
        return [...registry].filter(([, def]) => isSourceConnector || !def.onlySource);
    }

    function selectElement(path) {
        setSelected(path);
        onTasksChange();
    }

    /* ---- actions (resolve their targets at execution time via the refs) ---- */

    function addElement() {
        const entries = availableTypeEntries();
        const items = h('div.step-list');
        const m = modal({
            title: `Add ${kind.noun}`,
            body: entries.length ? items : h('div.text-text-faint', 'No element types registered'),
            buttons: [{ label: 'Cancel' }]
        });
        for (const [type, def] of entries) {
            const item = h('div.step-item',
                h('div', { class: 'flex-1' },
                    h('div', def.label || oie.elementTypeLabel(type))));
            item.addEventListener('click', () => {
                m.close();
                const element = def.create ? def.create() : { __type: type, name: '', enabled: true };
                if (!element.__type) element.__type = type;
                // Match the Swing client: if an Iterator is selected, add the
                // new element as its child; otherwise insert as a sibling right
                // after the selection (or append to the top level if none).
                const elements = elementsRef.current;
                const selPath = selectedPathRef.current;
                const sel = elementAtPath(elements, selPath);
                if (sel && isIteratorType(sel.__type)) {
                    childrenOf(sel).push(element);
                    setSelected([...selPath, childrenOf(sel).length - 1]);
                } else if (selPath && selPath.length) {
                    const list = listAtPath(elements, selPath);
                    const idx = selPath[selPath.length - 1];
                    list.splice(idx + 1, 0, element);
                    setSelected([...selPath.slice(0, -1), idx + 1]);
                } else {
                    elements.push(element);
                    setSelected([elements.length - 1]);
                }
                commitRef.current();
            });
            items.appendChild(item);
        }
    }

    // Convert a step/rule to another type in place, preserving its name, enabled
    // state and (for filters) boolean operator — like the Swing grid's Type column.
    function changeElementType(path, newType) {
        const list = listAtPath(elementsRef.current, path);
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
        setSelected(path);
        commitRef.current();
    }

    function deleteElement() {
        const elements = elementsRef.current;
        const selPath = selectedPathRef.current;
        if (!elementAtPath(elements, selPath)) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const list = listAtPath(elements, selPath);
        const idx = selPath[selPath.length - 1];
        const parent = selPath.slice(0, -1);
        list.splice(idx, 1);
        setSelected(list.length ? [...parent, Math.min(idx, list.length - 1)]
            : (parent.length ? parent : (elements.length ? [0] : null)));
        commitRef.current();
    }

    function move(delta) {
        const elements = elementsRef.current;
        const selPath = selectedPathRef.current;
        if (!elementAtPath(elements, selPath)) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const list = listAtPath(elements, selPath);
        const idx = selPath[selPath.length - 1];
        const next = idx + delta;
        if (next < 0 || next >= list.length) return;
        const [el] = list.splice(idx, 1);
        list.splice(next, 0, el);
        setSelected([...selPath.slice(0, -1), next]);
        commitRef.current();
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
            elementsRef.current = cleaned;
            hydrateChildren(cleaned);
            setSelected(cleaned.length ? [0] : null);
            commitRef.current();
            toast(`Imported ${cleaned.length} ${kind.noun.toLowerCase()}${cleaned.length === 1 ? '' : 's'}`);
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    function exportElements() {
        // Export the SERIALIZED tree (up-to-date properties.children on
        // iterators), not the raw working model — importing a raw export would
        // rebuild iterator children from their stale wire copies.
        saveFile(`${channel.name || channel.id}-${kindName}.json`, 'application/json',
            () => JSON.stringify({ elements: serializeList(elementsRef.current) }, null, 2));
    }

    /* ---- validation ---- */

    // The Swing per-element error wrapper (BaseEditorPane.validateElementRecursive):
    //   Error in connector "<conn>" at [response ]<container> <element> <seq> ("<name>"):
    //   <message>
    function elementError(el, message) {
        const containerWord = isFilter ? 'filter' : 'transformer';
        const responsePrefix = kindName === 'response' ? 'response ' : '';
        const seq = el.sequenceNumber != null ? el.sequenceNumber : '';
        return `Error in connector "${connector.name}" at `
            + `${responsePrefix}${containerWord} ${kind.noun.toLowerCase()} ${seq} `
            + `("${elementName(el)}"):\n${message}`;
    }

    // Per-element field validation — the web-admin port of Swing's
    // BaseEditorPane.validateElementRecursive: each type's validate() hook
    // (checkProperties) plus duplicate Iterator index-variable detection across
    // the ancestor stack. Recurses into Iterator children. Collects EVERY
    // offending element (Swing lists them all in one dialog), pre-wrapped.
    function collectFieldErrors() {
        const out = [];
        const idxStack = [];
        (function walk(list) {
            for (const el of list) {
                const def = typeDef(el.__type);
                const msg = def && typeof def.validate === 'function' ? String(def.validate(el) || '').trim() : '';
                if (msg) out.push(elementError(el, msg));
                if (isIteratorType(el.__type)) {
                    const iv = (el.properties && el.properties.indexVariable) || '';
                    if (iv && idxStack.includes(iv)) {
                        out.push(elementError(el, `Duplicate Iterator index variable ${iv} found.`));
                    }
                    idxStack.push(iv);
                    walk(childrenOf(el));
                    idxStack.pop();
                }
            }
        })(elementsRef.current);
        return out;
    }

    // Swing's blocking "Error(s)" dialog — a modal (not a corner toast) that
    // lists every validation error, matching alertCustomError.
    function showValidationErrors(errors) {
        detailModal({
            title: `Error validating ${kind.title.toLowerCase()} ${kind.noun.toLowerCase()}s`,
            badge: { text: 'Error', tone: 'err' },
            sections: [{ text: errors.join('\n\n') }]
        });
    }

    // Full validation for "Validate <Kind>" and "Back to Channel". Mirrors Swing
    // BaseEditorPane.validateAll: (a) per-element field checks, then (b) a Rhino
    // syntax check of every element's generated script (engine bridge), covering
    // non-JavaScript steps/rules too. Returns 'ok' | 'fail' | 'unavailable'.
    // `announce` controls the success/empty toasts (the manual Validate task
    // announces; Back to Channel runs it silently and only surfaces the error).
    async function runValidation(announce) {
        if (!elementsRef.current.length) {
            if (announce) toast(`${kind.title} is empty — nothing to validate`, 'warn');
            return 'ok';
        }
        // (a) Field checks (blank required fields, duplicate iterator index).
        const fieldErrors = collectFieldErrors();
        if (fieldErrors.length) { showValidationErrors(fieldErrors); return 'fail'; }
        // (b) Rhino syntax check of each element's generated script. Iterator
        // children roll into the parent's generated script.
        for (const el of elementsRef.current) {
            const src = generateElementScript(el, childrenOf);
            if (src == null) continue;
            const result = await validateScript(src);
            if (result.ok === null) { toast(result.message, 'warn'); return 'unavailable'; }
            if (result.ok === false) { showValidationErrors([elementError(el, result.message)]); return 'fail'; }
        }
        if (announce) toast(`All ${kind.noun.toLowerCase()}s validated successfully`);
        return 'ok';
    }

    async function validateElements() { await runValidation(true); }

    async function validateElement() {
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        // (a) Field check for this element (Swing plugin.checkProperties).
        const def = typeDef(el.__type);
        const fieldMsg = def && typeof def.validate === 'function' ? String(def.validate(el) || '').trim() : '';
        if (fieldMsg) { showValidationErrors([elementError(el, fieldMsg)]); return; }
        // (b) Rhino syntax check of its generated script.
        const src = generateElementScript(el, childrenOf);
        if (src != null) {
            const result = await validateScript(src);
            if (result.ok === false) { showValidationErrors([elementError(el, result.message)]); return; }
            if (result.ok === null) { toast(result.message, 'warn'); return; }
        }
        toast(`${kind.noun} "${elementName(el)}" validated successfully`);
    }

    /* ---- iterator membership (matches the Swing tree-table) ---- */

    // Iterators the element at `path` could move into: not itself, not a
    // descendant of it, and not its current parent.
    function iteratorTargets(path) {
        return allIteratorPaths(elementsRef.current)
            .filter(ip => !pathEquals(ip, path) && !isAncestorPath(path, ip) && !pathEquals(ip, path.slice(0, -1)))
            .map(ip => elementAtPath(elementsRef.current, ip))
            .filter(Boolean);
    }

    function moveIntoIterator(el, iterator) {
        const selPath = selectedPathRef.current;
        listAtPath(elementsRef.current, selPath).splice(selPath[selPath.length - 1], 1);
        childrenOf(iterator).push(isFilter ? { ...el, operator: 'AND' } : el);
        setSelected(pathOf(iterator.__children[iterator.__children.length - 1], elementsRef.current));
        commitRef.current();
    }

    function assignToIterator() {
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const targets = iteratorTargets(selectedPathRef.current);
        if (!targets.length) { toast(`No Iterator available — add an Iterator ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        if (targets.length === 1) { moveIntoIterator(el, targets[0]); return; }
        // Multiple iterators: let the user pick one.
        const list = h('div.step-list');
        const m = modal({ title: 'Assign To Iterator', body: list, buttons: [{ label: 'Cancel' }] });
        targets.forEach((it, i) => {
            const row = h('div.step-item', h('div', { class: 'flex-1' }, it.name || `Iterator ${i + 1}`));
            row.addEventListener('click', () => { m.close(); moveIntoIterator(el, it); });
            list.appendChild(row);
        });
    }

    function removeFromIterator() {
        const elements = elementsRef.current;
        const selPath = selectedPathRef.current;
        const el = elementAtPath(elements, selPath);
        if (!el || !selPath || selPath.length < 2) {
            toast(`This ${kind.noun.toLowerCase()} is not inside an Iterator`, 'warn'); return;
        }
        const iterator = elementAtPath(elements, selPath.slice(0, -1));
        listAtPath(elements, selPath).splice(selPath[selPath.length - 1], 1);
        const grandList = listAtPath(elements, selPath.slice(0, -1));
        grandList.splice(grandList.indexOf(iterator) + 1, 0, el);
        setSelected(pathOf(el, elements));
        commitRef.current();
    }

    // Steps created from a message-tree node (Map to Variable / Map to Message).
    function addTreeStep(typeId, label, baseName, setup) {
        const def = platform.stepTypes().get(typeId);
        if (!def) { toast(`${label} is not available`, 'warn'); return; }
        const el = def.create ? def.create() : { __type: typeId };
        el.__type = typeId;
        el.name = baseName || label;
        el.enabled = true;
        setup(el);
        elementsRef.current.push(el);
        setSelected([elementsRef.current.length - 1]);
        commitRef.current();
        toast(`Added ${label} "${el.name}"`);
    }
    const addTreeStepRef = useRef(addTreeStep);
    addTreeStepRef.current = addTreeStep;

    async function backToChannel() {
        // Match the Swing editor: "Back to Channel" runs the same validation as the
        // Validate task and stays put on a blocking error — BaseEditorPane.accept()
        // aborts navigation when validateAll() reports errors. A non-blocking
        // 'unavailable' (engine validate endpoint down) must not trap the user.
        if (await runValidation(false) === 'fail') return;
        persist();    // navigating back is not an edit — don't mark dirty
        router.navigate(`/channels/${channel.id}/edit`);
    }

    /* ---- context menu ---- */

    // With no step selected the menu shows only the container actions; once a
    // step is selected (by clicking a row, or already highlighted) it shows that
    // step's actions. Right-clicking a row selects it first.
    function showStepMenu(e, path) {
        e.preventDefault();
        if (path && !pathEquals(path, selectedPathRef.current)) selectElement(path);
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        const onStep = !!el;
        const t = kind.title, n = kind.noun;
        // Mutations ride channelEdit/doSaveChannel (same tagging as the task pane).
        const gate = { task: 'doSaveChannel', group: 'channelEdit' };
        const items = [{ label: `Add New ${n}`, icon: 'plus', ...gate, onClick: addElement }];
        if (onStep) {
            items.push({ label: `Delete ${n}`, icon: 'trash', danger: true, ...gate, onClick: deleteElement });
            if (!isIteratorType(el.__type) && iteratorTargets(selectedPathRef.current).length) {
                items.push({ label: 'Assign To Iterator', ...gate, onClick: assignToIterator });
            }
            if (selectedPathRef.current.length > 1) {
                items.push({ label: 'Remove From Iterator', ...gate, onClick: removeFromIterator });
            }
            items.push('-',
                { label: `Move ${n} Up`, icon: 'arrowUp', ...gate, onClick: () => move(-1) },
                { label: `Move ${n} Down`, icon: 'arrowDown', ...gate, onClick: () => move(1) });
        }
        items.push('-',
            { label: `Import ${t}`, icon: 'import', ...gate, onClick: importElements },
            { label: `Export ${t}`, icon: 'export', onClick: exportElements },
            '-',
            { label: `Validate ${t}`, icon: 'check', onClick: validateElements });
        if (onStep) items.push({ label: `Validate ${n}`, icon: 'check', onClick: validateElement });
        contextMenu(e.clientX, e.clientY, items);
    }

    function gridContextMenu(e) {
        const tr = e.target.closest && e.target.closest('tr[data-path]');
        showStepMenu(e, tr ? tr.dataset.path.split('.').map(Number) : null);
    }

    /* ---- task surface (read by the routed task pane / wizard toolbar) ---- */

    function taskState() {
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        const onStep = !!el;
        return {
            onStep,
            assign: !!(onStep && !isIteratorType(el.__type)),
            remove: !!(onStep && selectedPathRef.current && selectedPathRef.current.length > 1),
            dirty: channelDirty()
        };
    }

    const onAccessorDragOver = useMemo(() => makeAccessorDragOver(dragRef), []);
    const onAccessorDrop = useMemo(() => makeAccessorDrop(dragRef), []);

    apiRef.current = {
        taskState,
        handlers: {
            addElement, deleteElement, assignToIterator, removeFromIterator,
            importElements, exportElements, validateElements, validateElement,
            saveChannel, backToChannel
        },
        onAccessorDragOver, onAccessorDrop
    };

    /* ---- side panel: its own root on an UNMANAGED host --------------------------
       The code view (oie:code-view) physically moves the panel element into the
       overlay and back (placeholder bookmark), so the element must live outside
       the main tree's reconciliation: a plain div appended behind a ref, with
       the panel mounted into it as a separate React root. The panel reads live
       editor state through stable ctx getters. */
    const sideWrapRef = useRef(null);
    const sideHostRef = useRef(null);
    const sidePlaceholderRef = useRef(null);

    function restoreSidePanel() {
        const ph = sidePlaceholderRef.current;
        const host = sideHostRef.current;
        if (ph && host) {
            if (ph.parentNode) ph.parentNode.insertBefore(host, ph);
            ph.remove();
        }
        sidePlaceholderRef.current = null;
    }

    useEffect(() => {
        if (missingConnector) return undefined;
        const host = h('div', { class: 'flex flex-col flex-1 min-h-0 overflow-hidden' });
        sideHostRef.current = host;
        sideWrapRef.current.appendChild(host);
        const sideCtx = {
            isFilter,
            channelId: params.channelId,
            target, version, connectorType, channel,
            dragRef,
            getElements: () => elementsRef.current,
            commit: () => commitRef.current(),
            onAddStep: (typeId, label, baseName, setup) => addTreeStepRef.current(typeId, label, baseName, setup)
        };
        const teardown = mountReact(host, <SidePanel ctx={sideCtx} />);
        return () => {
            restoreSidePanel();
            try { teardown(); } catch { /* ignore */ }
            host.remove();
            sideHostRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- code view integration --------------------------------------------------
       When a code view opens for an editor that lives inside THIS editor (a step
       script or the generated-script preview), move the real side panel into the
       overlay — the full-fidelity reference, in place of the generic variables
       list — and move it back when the view closes. Tree/reference drags keep
       working there because every dragstart also sets text/plain, which the
       overlay's own capture-phase drop handlers understand. */
    useEffect(() => {
        if (missingConnector) return undefined;
        const onCodeView = (e) => {
            const d = e.detail || {};
            const rootEl = rootRef.current;
            const host = sideHostRef.current;
            if (d.open && d.origin && rootEl && rootEl.contains(d.origin) && !sidePlaceholderRef.current && host) {
                const flat = d.body.querySelector('.ce-popout-vars');
                if (flat) flat.remove();
                sidePlaceholderRef.current = document.createComment('ft-side-panel');
                host.parentNode.insertBefore(sidePlaceholderRef.current, host);
                d.body.appendChild(h('div.ce-popout-sidepanel', host));
            } else if (!d.open && sidePlaceholderRef.current) {
                restoreSidePanel();
            }
        };
        document.addEventListener('oie:code-view', onCodeView);
        return () => document.removeEventListener('oie:code-view', onCodeView);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- render ---- */

    if (missingConnector) {
        return <div className="loading-block"><div className="spinner" />Loading…</div>;
    }

    const elements = elementsRef.current;
    const selectedElement = elementAtPath(elements, selectedPath);
    const typeOptions = availableTypeEntries()
        .map(([type, def]) => ({ value: type, label: def.label || oie.elementTypeLabel(type) }));
    const canEdit = platform.checkTask('channelEdit', 'doSaveChannel');

    return (
        <div className="view-body flush flex flex-1 min-h-0" ref={rootRef}>
            {/* split-reflow: below the tablet breakpoint the CSS stacks this outer
                split vertically so the fixed-width reference panel doesn't
                overflow (app.css). */}
            <div className="split split-reflow flex-1 min-w-0">
                {/* The editor column (steps grid on top, the Step/Generated-Script
                    tabs below); its top pane is tagged data-editor-overtake so the
                    code view can hide it and let the editor fill the column while
                    the right reference panel stays put. */}
                <div className="split-a split vertical flex-1 min-w-0">
                    <div className="split-a h-[40%] flex-none p-[14px] pb-2" data-editor-overtake="">
                        {/* Fills the pane so right-clicking anywhere in the step
                            area (not just on a row) opens the context menu. */}
                        <div className="min-h-full panel overflow-auto" onContextMenu={gridContextMenu}>
                            <ElementsGrid kind={kind} isFilter={isFilter} elements={elements}
                                selectedPath={selectedPath} typeOptions={typeOptions} canEdit={canEdit}
                                onSelect={selectElement}
                                onCommit={() => commitRef.current()}
                                onChangeType={changeElementType}
                                onAdd={addElement} onImport={importElements}
                                onMenu={showStepMenu} />
                        </div>
                    </div>
                    <div className="split-handle" data-editor-overtake="" />
                    <div className="split-b flex flex-col min-h-0">
                        <BottomTabs active={bottomTab} onActive={setBottomTab} tabs={[
                            {
                                label: kind.noun,
                                className: 'step-editor-fill py-3 px-3.5',
                                node: <StepEditorPanel kind={kind} isFilter={isFilter}
                                    element={selectedElement}
                                    headerIndex={selectedPath ? selectedPath[selectedPath.length - 1] + 1 : 0}
                                    settlingRef={settlingRef}
                                    onChange={() => commitRef.current()}
                                    onReplaceElement={(parsed) => {
                                        const selPath = selectedPathRef.current;
                                        const list = listAtPath(elementsRef.current, selPath);
                                        if (list) { list[selPath[selPath.length - 1]] = parsed; commitRef.current(); }
                                    }}
                                    destinations={stepDestinations} />
                            },
                            {
                                label: 'Generated Script',
                                className: 'py-3 px-3.5',
                                node: <GeneratedScriptPane kind={kind} element={selectedElement} rev={rev} />
                            }
                        ]} />
                    </div>
                </div>
                <div className="split-handle" data-orient="h" data-resize="next" />
                {/* Wide enough to show the full tab bar (Reference / Message Trees /
                    Message Templates) without horizontal scrolling. The side panel
                    root mounts into an unmanaged child of this wrapper. */}
                <div className="split-b flex-none w-[460px] flex flex-col min-h-0 border-l border-line" ref={sideWrapRef} />
            </div>
        </div>
    );
}

/* ---- the routed view ---------------------------------------------------------- */

// One component serves all three routes; these bind the kind so the shell's route
// table can name a component per route without building wrappers of its own.
export function FilterView(props) { return <FilterTransformerView {...props} kindName="filter" />; }
export function TransformerView(props) { return <FilterTransformerView {...props} kindName="transformer" />; }
export function ResponseTransformerView(props) { return <FilterTransformerView {...props} kindName="response" />; }

function FilterTransformerView({ params, kindName }) {
    const [, forceRender] = useReducer((x) => x + 1, 0);
    // The channel travels through the store (seeded by the channel editor). When a
    // user deep-links straight to a sub-editor route the store is empty, so the
    // channel is fetched before the body builds. `ready` flips once the channel
    // is available; null means still loading.
    const [ready, setReady] = useState(() => {
        const c = store.getState('editingChannel');
        return c && c.id === params.channelId ? true : null;
    });
    const apiRef = useRef(null);

    // Deep-link entry (no in-store channel): fetch it, then build.
    useEffect(() => {
        if (ready) return undefined;
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

    const ctx = apiRef.current;
    const kind = KINDS[kindName];
    const ts = (ctx && ctx.taskState()) || { onStep: false, assign: false, remove: false, dirty: false };
    const t = ctx && ctx.handlers;

    return (
        <div className="view flex flex-col flex-1 min-h-0">
            <ViewTasks>
                {/* Mutation tasks ride channelEdit/doSaveChannel: there are no Swing
                    constants for the individual step actions, and editing steps is
                    meaningless without channel-save rights (RBAC.md §4). Export /
                    Validate / Back stay untagged — view affordances. */}
                <RailPane title={`${kind.title} Tasks`} paneKey={`tasks:${kind.title} Tasks`} group="channelEdit">
                    <div className="taskbar" data-pane-title={`${kind.title} Tasks`}>
                        {t && <TaskButton label={`Add New ${kind.noun}`} icon="plus" task="doSaveChannel" onClick={t.addElement} />}
                        {t && ts.onStep && <TaskButton label={`Delete ${kind.noun}`} icon="trash" danger task="doSaveChannel" onClick={t.deleteElement} />}
                        {t && ts.assign && <TaskButton label="Assign To Iterator" icon="plus" task="doSaveChannel" onClick={t.assignToIterator} />}
                        {t && ts.remove && <TaskButton label="Remove From Iterator" icon="minus" task="doSaveChannel" onClick={t.removeFromIterator} />}
                        {t && <TaskButton label={`Import ${kind.title}`} icon="import" task="doSaveChannel" onClick={t.importElements} />}
                        {t && <TaskButton label={`Export ${kind.title}`} icon="export" onClick={t.exportElements} />}
                        {t && <TaskButton label={`Validate ${kind.title}`} icon="check" onClick={t.validateElements} />}
                        {t && ts.onStep && <TaskButton label={`Validate ${kind.noun}`} icon="check" onClick={t.validateElement} />}
                        {t && ts.dirty && <TaskButton label="Save Channel" icon="save" primary task="doSaveChannel" onClick={t.saveChannel} />}
                        {t && <TaskButton label="Back to Channel" icon="chevR" onClick={t.backToChannel} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {ready === null
                ? <div className="view-body"><div className="dt-empty">Loading channel…</div></div>
                : ready === false
                    ? <div className="view-body"><div className="dt-empty">Channel not loaded</div></div>
                    : (
                        // Drop accessors anywhere they land on an editor/field within the view.
                        <div className="flex flex-col flex-1 min-h-0"
                            onDragOver={(e) => apiRef.current && apiRef.current.onAccessorDragOver(e)}
                            onDrop={(e) => apiRef.current && apiRef.current.onAccessorDrop(e)}>
                            <EditorBody params={params} kindName={kindName}
                                onTasksChange={forceRender} apiRef={apiRef} embedded={false} />
                        </div>
                    )}
        </div>
    );
}

/* ---- embedded editor (channel wizard) ------------------------------------------ */

/* Embed the Filter / Transformer / Response editor body outside its own route
 * (used by the guided channel wizard) — the full editor: step/rule grid, plugin
 * step editors (Monaco), data types, message templates & trees, accessor drag-drop,
 * generated-script preview, import/export/validate. The target channel must already
 * be in store.editingChannel; `params` = { channelId, metaDataId } (metaDataId 0 =
 * source). Returns the same synchronous { el, teardown, handlers, taskState,
 * onAccessorDragOver, onAccessorDrop } contract as before — handlers are stable
 * proxies into the live component (whose mount React may defer past this
 * return). Embedded mounts never install a store navGuard: the caller owns
 * navigation (the wizard's guard capture/restore stays a harmless no-op). */
export function createEmbeddedEditor(params, kindName, onTasksChange) {
    const channel = store.getState('editingChannel');
    const connector = String(params.metaDataId) === '0'
        ? channel && channel.sourceConnector
        : channel && oie.destinationsOf(channel).find(d => Number(d.metaDataId) === Number(params.metaDataId));
    if (!connector) {
        toast(`Connector ${params.metaDataId} not found`, 'error');
        router.navigate(`/channels/${params.channelId}/edit`);
        return { el: loading() };
    }
    const host = h('div', { class: 'flex flex-col flex-1 min-h-0' });
    const apiRef = { current: null };
    const teardownRoot = mountReact(host,
        <EditorBody params={params} kindName={kindName} onTasksChange={onTasksChange} apiRef={apiRef} embedded />);
    const call = (name) => (...args) => {
        const ctx = apiRef.current;
        return ctx && ctx.handlers[name] && ctx.handlers[name](...args);
    };
    return {
        el: host,
        taskState: () => (apiRef.current ? apiRef.current.taskState()
            : { onStep: false, assign: false, remove: false, dirty: false }),
        handlers: {
            addElement: call('addElement'), deleteElement: call('deleteElement'),
            assignToIterator: call('assignToIterator'), removeFromIterator: call('removeFromIterator'),
            importElements: call('importElements'), exportElements: call('exportElements'),
            validateElements: call('validateElements'), validateElement: call('validateElement'),
            saveChannel: call('saveChannel'), backToChannel: call('backToChannel')
        },
        onAccessorDragOver: (e) => apiRef.current && apiRef.current.onAccessorDragOver(e),
        onAccessorDrop: (e) => apiRef.current && apiRef.current.onAccessorDrop(e),
        teardown: () => { try { teardownRoot(); } catch { /* ignore */ } }
    };
}
