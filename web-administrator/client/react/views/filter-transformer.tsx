import { ElementType, isElementEnabled } from '../../core/element-types.js';
import { isNewChannelDraft, loadChannelForEdit } from '../../core/channel-save.js';
import { loadErrorMessage } from '../load-error.js';
import { channelDependencyState } from '../../core/channel-dependencies.js';
import { persistChannelEdits, channelSessionActive } from '../channel-persistence.js';
import { withEditorSave } from '../save-lock.js';
import { parseFilterTransformerImport, normalizeImportTypes, alignDestinationTypes, updateImportedAttachmentHandler, normalizeImportedElementTypes } from './editor-import.js';
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

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { h, modal, detailModal, toast, loading, saveFile, pickFile, contextMenu, createCodeEditor } from '@oie/web-ui';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { generateElementScript, usesGeneratedIteratorIdentifier } from '../../core/step-script.js';
import { availableMapperKey } from './mapper-key.js';
import { isIteratorType, iteratorName } from '../../core/oie.js';
import { childrenOf, serializeEditorElements, rewriteElementIteratorVariables, getIteratorInfo, iteratorExpressionParts,
    iteratorWizardPrefixes, validIteratorIndex, preferredIterator, isIteratorIndexName, renameIteratorIndex,
    relocateElementIteratorVariables, rewriteIteratorExpression, treeWritePath } from './iterator-substitutions.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { normalizeLineEndings } from '../../core/content-highlight.js';
import * as router from '../../core/router.js';
import { routeUrl } from '../../core/deployment.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { setActiveScope, clearActiveScope, referencesFor, dropTextFor, cleanDesc, templateCompletionCode } from '../../core/script-completions.js';
import { serializeTemplate, validateScript } from '../../core/serialize.js';
import { dataTypeDef, dataTypeList, normalizeDataTypeProperties } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';
import { REFERENCE_CATALOG } from '../../core/reference-catalog.js';
import { platform } from '@oie/web-shell';
import { ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, TaskButton, SegPill, useSideCollapse, CollapsedSideStrip, SideCollapseButton } from '../ui.jsx';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';
import { usePaletteContext } from '../palette-context.js';

const KINDS = {
    filter: { title: 'Filter', noun: 'Rule', targetKey: 'filter' },
    transformer: { title: 'Transformer', noun: 'Step', targetKey: 'transformer' },
    response: { title: 'Response Transformer', noun: 'Step', targetKey: 'responseTransformer' }
};


/* ---- element tree machinery (pure, shared by grid + actions) ------------------ */

// Hydrate serialized iterator children into live __children arrays so the
// whole step tree can be edited in place and re-serialized on commit (the
// Swing client shows iterator children nested in the step list).
function hydrateChildren(list: any) {
    for (const el of list) {
        if (isIteratorType(el.__type)) {
            el.__children = oie.elementsToArray(el.properties && el.properties.children);
            hydrateChildren(el.__children);
        }
    }
}

function listAtPath(elements: any, path: any) {
    let list = elements;
    for (let k = 0; k < path.length - 1; k++) {
        const el = list[path[k]];
        if (!el || !isIteratorType(el.__type)) return null;
        list = childrenOf(el);
    }
    return list;
}
function elementAtPath(elements: any, path: any) {
    if (!path || !path.length) return null;
    const list = listAtPath(elements, path);
    return list ? list[path[path.length - 1]] : null;
}
// Find an element's path by identity (robust to index shifts after edits).
function pathOf(target: any, list: any, parent: any[] = []): any {
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
const pathEquals = (a: any, b: any) => !!a && !!b && a.length === b.length && a.every((v: any, i: any) => v === b[i]);
const isAncestorPath = (anc: any, p: any) => anc.length < p.length && anc.every((v: any, i: any) => v === p[i]);

// Flatten the tree to display rows in order, carrying each row's path/depth.
function flattenRows(list: any[], parentPath: number[] = [], parentEnabled = true, out: { el: any; path: number[]; depth: number; parentEnabled: boolean }[] = []) {
    list.forEach((el: any, i: any) => {
        const path = [...parentPath, i];
        out.push({ el, path, depth: parentPath.length, parentEnabled });
        if (isIteratorType(el.__type)) flattenRows(childrenOf(el), path, parentEnabled && isElementEnabled(el), out);
    });
    return out;
}

function allIteratorPaths(list: any, parent: any[] = [], out: any[] = []) {
    list.forEach((el: any, i: any) => {
        const path = [...parent, i];
        if (isIteratorType(el.__type)) { out.push(path); allIteratorPaths(childrenOf(el), path, out); }
    });
    return out;
}

/* ---- persistence helpers ------------------------------------------------------ */

function normalizeOperators(list: any) {
    list.forEach((el: any, i: any) => {
        if (i === 0) el.operator = 'NONE';
        else if (!el.operator || el.operator === 'NONE') el.operator = 'AND';
        if (isIteratorType(el.__type)) normalizeOperators(childrenOf(el));
    });
}

// Every step/rule is a Migratable model on the engine: without a version
// attribute the engine's MigratableConverter rejects the whole channel
// ("version: not available"), so stamp the current version on each element
// (and iterator children) that doesn't already carry one.
function stampVersions(list: any, version: any) {
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

// The code-template ContextType of this view's script editors.
const scriptContext = (connectorType: any) => connectorType === 'RESPONSE' ? 'DESTINATION_RESPONSE_TRANSFORMER'
    : connectorType === 'SOURCE' ? 'SOURCE_FILTER_TRANSFORMER' : 'DESTINATION_FILTER_TRANSFORMER';

// An Iterator's outputs are published after its loop. Include them when the
// Iterator precedes the selected row, and keep the current subtree out.
function collectStepVariables(elements: any[], selectedPath: number[] | null) {
    const vars = new Set<string>();
    const putRe = /(?:globalMap|globalChannelMap|channelMap|connectorMap|responseMap|sourceMap)\.put\s*\(\s*['"]([^'"]+)['"]|\$(?:gc|co|g|c|r|s)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
    function collect(list: any[]) {
        for (const el of list) {
            if (!isElementEnabled(el)) continue;
            if (el.__type === ElementType.Xslt && typeof el.resultVariable === 'string' && el.resultVariable.trim()) {
                vars.add(el.resultVariable);
            }
            if (typeof el.variable === 'string' && el.variable.trim()) vars.add(el.variable.trim());
            if (typeof el.script === 'string') {
                let match: RegExpExecArray | null;
                while ((match = putRe.exec(el.script))) vars.add(match[1] || match[2]);
            }
            if (isIteratorType(el.__type)) collect(childrenOf(el));
        }
    }
    collect(selectedPath ? elements.slice(0, selectedPath[0]) : elements);
    return [...vars];
}

/* ---- accessor drag-and-drop ---------------------------------------------------
   Native drags carry text/plain. Inside the editor, resolve tree fields on
   release so the receiving Iterator and the platform modifier are current. */

const ACCESSOR_FLAVOR = 'application/x-oie-accessor';
type AccessorText = (event: DragEvent) => string;
type AccessorDrag = { getText: AccessorText; addToGrid?: (event: DragEvent) => void };
type AccessorDragRef = { current: AccessorDrag | null };

function treeDragModifier(event: DragEvent) {
    return event.ctrlKey || event.altKey || (event.metaKey && /Mac/.test(navigator.platform));
}

function resolveEditorAt(target: any) {
    if (!target || !(target instanceof Element)) return null;
    const monacoHost = target.closest('.ce-monaco');
    if (monacoHost) {
        const me = (window as any).monaco && (window as any).monaco.editor;
        const editors = me && me.getEditors ? me.getEditors() : [];
        const inst = editors.find((ed: any) => {
            const node = ed.getDomNode && ed.getDomNode();
            return node && node.contains(target);
        });
        if (inst && !(inst.getRawOptions && inst.getRawOptions().readOnly)) return { monaco: inst };
        return null;
    }
    if ((target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as any).type === 'text')) &&
        !(target as any).readOnly && !(target as any).disabled) {
        return { el: target };
    }
    return null;
}

function hasAccessorDrag(dragRef: AccessorDragRef, e: any) {
    if (dragRef.current) return true;
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(ACCESSOR_FLAVOR));
}

// Allow dropping onto editors/fields anywhere in the view (the tree lives in
// the side panel; the editors are in the bottom panel — same document).
function makeAccessorDragOver(dragRef: AccessorDragRef) {
    return (e: any) => {
        if (!hasAccessorDrag(dragRef, e)) return;
        if (resolveEditorAt(e.target)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        }
    };
}

function makeAccessorDrop(dragRef: AccessorDragRef, canEdit: () => boolean) {
    return (e: any) => {
        if (!hasAccessorDrag(dragRef, e)) return;
        const editor = resolveEditorAt(e.target);
        if (!editor) return;
        e.preventDefault();
        const resolve = dragRef.current;
        dragRef.current = null;
        if (!canEdit()) return;
        const token = resolve ? resolve.getText(e) : e.dataTransfer?.getData(ACCESSOR_FLAVOR) || e.dataTransfer?.getData('text/plain');
        if (!token) return;
        if (editor.monaco) {
            const inst = editor.monaco;
            let pos = inst.getPosition();
            if (inst.getTargetAtClientPoint) {
                const tgt = inst.getTargetAtClientPoint(e.clientX, e.clientY);
                if (tgt && tgt.position) pos = tgt.position;
            }
            const Range = (window as any).monaco.Range;
            inst.executeEdits('message-tree', [{
                range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: token, forceMoveMarkers: true
            }]);
            inst.focus();
        } else if (editor.el) {
            const t = editor.el;
            const start = (t as any).selectionStart ?? (t as any).value.length;
            const end = (t as any).selectionEnd ?? start;
            const next = (t as any).value.slice(0, start) + token + (t as any).value.slice(end);
            // React-controlled fields wrap the instance `value` setter with a
            // change tracker that dedupes the dispatched event; write through
            // the native prototype setter so the tracker sees the change and
            // the field's onChange (which owns the model write) actually fires.
            const proto = t.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(t, next);
            (t as any).selectionStart = (t as any).selectionEnd = start + token.length;
            t.dispatchEvent(new Event('input', { bubbles: true }));
            (t as any).focus();
        }
    };
}

// Shared dragstart props for accessor sources (reference rows, tree nodes).
function accessorDragProps(dragRef: AccessorDragRef, getText: AccessorText, addToGrid?: AccessorDrag['addToGrid']) {
    return {
        draggable: true,
        onDragStart: (e: any) => {
            dragRef.current = { getText, addToGrid };
            const token = getText(e);
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', token);
            e.dataTransfer.setData(ACCESSOR_FLAVOR, token);
        },
        onDragEnd: () => { dragRef.current = null; }
    };
}

/* ---- message tree models (pure) ----------------------------------------------- */

function escapeKey(key: any) {
    return String(key).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/[\r\n\u2028\u2029]/g,
        ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function repeatedPositions<T>(siblings: T[], keyOf: (sibling: T) => string) {
    const groups = new Map<string, T[]>();
    for (const sibling of siblings) {
        const key = keyOf(sibling);
        const group = groups.get(key);
        if (group) group.push(sibling);
        else groups.set(key, [sibling]);
    }
    const positions = new Map<T, number>();
    for (const group of groups.values()) {
        if (group.length > 1) group.forEach((sibling, i) => positions.set(sibling, i));
    }
    return positions;
}

function position(index?: number) {
    return index === undefined ? '' : `[${index}]`;
}

function xmlElementNode(element: Element, accessor: string, suffix: string, descriptions: Record<string, string> | null,
    wildcardBranch = false) {
    const children: any[] = [];
    const attributes = [...element.attributes];
    // Stock Rhino's underlying XML DOM enumerates attributes by qualified name.
    const ordinary = attributes.filter(attr => attr.name !== 'xmlns' && attr.prefix !== 'xmlns');
    const attrPositions = repeatedPositions(ordinary.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        attr => attr.localName);
    for (const attr of attributes) {
        let part: string;
        const declaration = attr.name === 'xmlns' || attr.prefix === 'xmlns';
        if (declaration) {
            part = `.namespace('${attr.prefix ? escapeKey(attr.localName) : ''}')`;
        } else if (attr.prefix) {
            part = `.@*::['${escapeKey(attr.localName)}']` + position(attrPositions.get(attr));
        } else part = `['@${escapeKey(attr.name)}']`;
        children.push({
            label: `@${attr.name}`, name: `@${attr.name}`, desc: '', value: attr.value,
            accessor: accessor + part + suffix, declaration, wildcard: !!attr.prefix, attribute: true, children: []
        });
    }
    const childElements = [...element.children];
    const exactPositions = repeatedPositions(childElements, child => (child.namespaceURI ?? '') + '\0' + child.localName);
    const wildcardPositions = repeatedPositions(childElements, child => child.localName);
    for (const child of childElements) {
        // Swing starts wildcarding descendants at a non-root default namespace
        // declaration. A prefixed element alone does not change its descendants.
        const childBranch = wildcardBranch || child.hasAttribute('xmlns');
        const wildcard = childBranch || !!child.prefix;
        const key = `['${escapeKey(child.localName)}']`;
        const index = exactPositions.get(child);
        const part = wildcard ? '.*::' + key + position(wildcardPositions.get(child)) : key + position(index);
        const node = xmlElementNode(child, accessor + part, suffix, descriptions, childBranch);
        node.wildcard = wildcard;
        if (index !== undefined) node.index = index;
        children.push(node);
    }
    const text = childElements.length ? null : (element.textContent ?? '');
    const desc = descriptions && Object.hasOwn(descriptions, element.tagName) ? descriptions[element.tagName] : '';
    const label = desc ? `${element.tagName} (${desc})` : element.tagName;
    return { label, name: element.tagName, desc, value: text, accessor: accessor + suffix, children } as any;
}

type TreeAccessorSource = { accessor: string; declaration?: boolean; wildcard?: boolean; attribute?: boolean };

function treeMessageSegment(source: TreeAccessorSource, ancestors: any[]): string {
    if (source.declaration) {
        toast('A namespace declaration cannot be assigned by a Message Builder.', 'warn');
        return '';
    }
    // Rhino can change the namespace on wildcard element assignment. A
    // wildcard attribute assignment either throws or leaves the value intact.
    if (source.wildcard) {
        toast('To write this namespaced field, enter a namespace-qualified Message Segment in the Message Builder.', 'warn');
        return '';
    }
    const raw = source.accessor.replace(/\.toString\(\)$/, '');
    const target = treeWritePath(raw, ancestors);
    if (target === null) {
        toast('The Iterator uses a different selector for this repeating field. Enter its indexed Message Segment manually.', 'warn');
        return '';
    }
    if (source.attribute && ancestors.some(it => target.endsWith(`[${it.properties?.indexVariable ?? 'i'}]`))) {
        toast('Choose an Iterator over the parent element to write its attribute.', 'warn');
        return '';
    }
    return target;
}

function xmlTree(text: any, varName: string, meta?: any) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('not XML');
    const descriptions = (meta && meta.descriptions) || null;
    const root = xmlElementNode(doc.documentElement, varName, varName === 'msg' ? '.toString()' : '', descriptions);
    // Label the root with the message type/version/description (e.g.
    // "OML-O21 (2.5.1) (Laboratory Order)") while keeping its accessor.
    if (meta && meta.root) root.label = meta.root;
    return [root];
}

function jsonValueNode(label: any, value: any, accessor: any): any {
    if (Array.isArray(value)) {
        return {
            label, name: label, desc: '', value: null, accessor,
            children: value.map((item: any, i: number) => ({
                ...jsonValueNode(`[${i}]`, item, `${accessor}[${i}]`), arrayIndex: i
            }))
        };
    }
    if (value && typeof value === 'object') {
        return {
            label, name: label, desc: '', value: null, accessor,
            children: Object.entries(value).map(([key, val]) =>
                jsonValueNode(key, val, `${accessor}['${escapeKey(key)}']`))
        };
    }
    return { label, name: label, desc: '', value: value === null ? 'null' : String(value), accessor, children: [] };
}

function jsonTree(text: any, varName: any) {
    return [jsonValueNode(varName, JSON.parse(text), varName)];
}

/* Steps created from a tree node's accessor — the Swing TreePanel popup
   ("Map to Variable" → Mapper, "Map to Message" → Message Builder). */

type TreeNameNode = { name: string; desc?: string; index?: number; arrayIndex?: number };
type TreeNamePath = { node: TreeNameNode; parent: TreeNamePath | null };

// Swing uses the displayed node's ancestry for names, including repeated XML
// elements and JSON array positions. A folded HL7 field keeps its own name.
function treeFieldNames(path: TreeNamePath | null) {
    let variable = '', description = '', wasArrayElement = false;
    for (let part = path; part; part = part.parent) {
        const { name, desc, index, arrayIndex } = part.node;
        if (arrayIndex != null) {
            variable = String(arrayIndex) + (variable ? '_' : '') + variable;
            description = ` [${arrayIndex}]` + (wasArrayElement ? '' : ' - ') + description;
        } else {
            const vocab = desc || / \((.*)\)/.exec(name)?.[1];
            const raw = name.replace(/ \(.*\)/, '');
            const key = (vocab || raw).toLowerCase().replace(/\//g, ' or ').replace(/ - /g, '_')
                .replace(/&/g, ' and ').replace(/@/g, 'att ').replace(/[^\w \t\n\v\f\r]/g, '').trim()
                .replace(/ +([^ ]?)/g, (_, c: string) => c.toUpperCase());
            variable = (key || raw) + (index ?? '') + (variable && !wasArrayElement ? '_' : '') + variable;
            const separator = vocab ? (description ? ' - ' : ` (${raw})`) : (description && !wasArrayElement ? ' - ' : '');
            description = (vocab || name) + (index == null ? '' : ` [${index}]`) + separator + description;
        }
        wasArrayElement = arrayIndex != null;
    }
    return { variable, description };
}

/* ---- element grid (top pane, classic grid) ------------------------------------ */

// Swing compares the outgoing plugin panel with its defaults before a conversion.
const gridMetadata = new Set(['__type', '__children', 'name', 'enabled', 'sequenceNumber', 'operator']);

function matchesPanelDefaults(value: any, initial: any, ignore?: ReadonlySet<string>): boolean {
    if (Array.isArray(initial)) return Array.isArray(value) && value.length === initial.length
        && initial.every((item, i) => matchesPanelDefaults(value[i], item));
    if (initial && typeof initial === 'object') {
        if (!value || typeof value !== 'object') return false;
        const keys = new Set([...Object.keys(value), ...Object.keys(initial)]);
        return [...keys].every(key => key === '@version' || ignore?.has(key)
            || (Object.hasOwn(initial, key) && matchesPanelDefaults(value[key], initial[key])));
    }
    if (typeof initial === 'boolean') return String(value ?? false) === String(initial);
    return (value ?? '') === initial;
}

function typeDefFor(isFilter: any, type: any) {
    return isFilter ? platform.ruleType(type) : platform.stepType(type);
}

function elementNameOf(isFilter: any, el: any) {
    const def = typeDefFor(isFilter, el.__type);
    return el.name || (def ? def.label : oie.elementTypeLabel(el.__type));
}

/* One grid row. Module-scope with a stable key (the path string) so re-renders
   from per-keystroke commits never remount the inline inputs (focus survives).
   Clicks on the inline controls stay off the row handler so editing never
   changes the selection (Swing parity: select via the other cells). */
function GridRow({ el, path, depth, parentEnabled, isFilter, selected, typeOptions, onSelect, onCommit, onChangeType }: any) {
    const idx = path[path.length - 1];
    const def = typeDefFor(isFilter, el.__type);
    const readOnlyName = def?.nameEditable === false;
    const stop = (e: any) => e.stopPropagation();
    const options = typeOptions.some((o: any) => o.value === el.__type)
        ? typeOptions
        : [{ value: el.__type, label: oie.elementTypeLabel(el.__type) }, ...typeOptions];
    return (
        <tr className={'cursor-pointer' + (selected ? ' selected' : '')} data-path={path.join('.')}
            onClick={() => onSelect(path)}>
            <td className="text-center">
                <input type="checkbox" checked={isElementEnabled(el)} disabled={!parentEnabled} onClick={stop}
                    onChange={(e: any) => { el.enabled = e.target.checked; onCommit(); }} />
            </td>
            <td className="num">{path.join('-')}</td>
            {isFilter && (
                <td>
                    {idx === 0 ? '' : (
                        <select className="w-[63px]" value={el.operator === 'OR' ? 'OR' : 'AND'}
                            onClick={stop} onMouseDown={stop}
                            onChange={(e: any) => { el.operator = e.target.value; onCommit(); }}>
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                        </select>
                    )}
                </td>
            )}
            <td>
                <input className="grid-name" type="text" readOnly={readOnlyName} value={el.name || ''}
                    placeholder={def ? def.label : oie.elementTypeLabel(el.__type)}
                    style={{ marginLeft: `${depth * 18}px` }}
                    onFocus={readOnlyName ? () => onSelect(path) : undefined}
                    onClick={readOnlyName ? undefined : stop} onMouseDown={stop} onDoubleClick={stop}
                    onChange={(e: any) => { el.name = e.target.value; onCommit(); }} />
            </td>
            <td>
                <select className="w-full" value={el.__type} onClick={stop} onMouseDown={stop}
                    onChange={(e: any) => onChangeType(path, e.target.value)}>
                    {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </td>
        </tr>
    );
}

function ElementsGrid({ kind, isFilter, elements, selectedPath, typeOptions, canEdit,
    onSelect, onCommit, onChangeType, onAdd, onImport }: any) {
    if (!elements.length) {
        // Empty landing state (matches the Alerts view): icon + title + the
        // two ways in, gated like their task-pane twins (channelEdit/doSaveChannel).
        // Right-click falls through to the container's context menu.
        return (
            <div className="dt-empty">
                <div className="empty-icon"><Icon name={isFilter ? 'filter' : 'transform'} size={30} /></div>
                <div>{`No ${kind.noun}s Configured`}</div>
                {canEdit && (
                    <div className="mt-[14px] flex items-center justify-center gap-2">
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
                    <th className="w-[58px]">Enabled</th>
                    <th className="w-[32px]">#</th>
                    {isFilter && <th className="w-[81px]">Operator</th>}
                    <th>Name</th>
                    <th className="w-[162px]">Type</th>
                </tr>
            </thead>
            <tbody>
                {flattenRows(elements).map(({ el, path, depth, parentEnabled }: any) => (
                    <GridRow key={path.join('.')} el={el} path={path} depth={depth} parentEnabled={parentEnabled}
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
   remounts when the selected element or iterator context changes — never on
   ordinary rev bumps, so plugin state (Monaco etc.) survives grid edits. */
function StepEditorPanel({ kind, isFilter, element, contextRevision, headerIndex, settlingRef, onChange, onRenameIteratorIndex, onReplaceElement, destinations }: any) {
    const hostRef = useRef<any>(null);
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
        let teardown: any;
        try {
            teardown = mountReact(host,
                <SettleGuard settlingRef={settlingRef}>
                    <PluginSlot def={def} ctx={{ element, platform, onChange, onRenameIteratorIndex, destinations }} />
                </SettleGuard>);
        } catch (e: any) {
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
        // Remount on selection/type/context changes, not ordinary repaints.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [element, element && element.__type, contextRevision]);

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
function SettleGuard({ settlingRef, children }: any) {
    useLayoutEffect(() => { settlingRef.current = false; }, [settlingRef]);
    return children;
}

/* Unknown plugin type: raw JSON fallback so nothing is lost. */
function RawElementFallback({ element, onReplace }: any) {
    const [text, setText] = useState(() => JSON.stringify(element, null, 2));
    // Re-seed when the selection moves to a different element (the panel is not
    // remounted between same-shape selections).
    useEffect(() => { setText(JSON.stringify(element, null, 2)); }, [element]);
    return (
        <div className="field">
            <label>Raw element (JSON)</label>
            <textarea rows={14} spellCheck={false} value={text}
                onChange={(e: any) => setText(e.target.value)}
                onBlur={() => {
                    try {
                        const parsed = JSON.parse(text);
                        parsed.__type = element.__type;
                        onReplace(parsed);
                    } catch (e: any) {
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
function BottomTabs({ tabs, active, onActive }: any) {
    return (
        <TabsPrimitive.Root value={String(active)} onValueChange={(v: any) => onActive(Number(v))}
            className="flex flex-col flex-1 overflow-hidden min-h-0">
            <TabsPrimitive.List className="tabs" aria-label="Step editor sections">
                {tabs.map((t: any, i: any) => (
                    <TabsPrimitive.Trigger key={t.label} value={String(i)}
                        className={'tab' + (i === active ? ' active' : '')}>{t.label}</TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            <div className="tab-body">
                {/* forceMount: these panels hold code editors, which must not be torn
                    down by a tab switch. app.css hides the inactive ones by data-state. */}
                {tabs.map((t: any, i: any) => (
                    <TabsPrimitive.Content key={t.label} value={String(i)} forceMount className={t.className}>
                        {t.node}
                    </TabsPrimitive.Content>
                ))}
            </div>
        </TabsPrimitive.Root>
    );
}

/* Read-only Generated Script pane — createCodeEditor behind a host ref; the
   value is pushed by an effect whenever the selection or the tree changes
   (recompute-on-commit: unlike the legacy pane this can never go stale, which
   matches Swing's regenerate-on-every-trigger behavior). */
const iteratorPreviewUnavailable = 'The web client cannot generate the script for this Message Builder target. Use Swing to preview or validate its Iterator.';

function GeneratedScriptPane({ kind, element, rev }: any) {
    const hostRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    useEffect(() => {
        const editor = createCodeEditor({ value: '', readOnly: true, minHeight: '200px', popoutable: true, popoutTitle: 'Generated Script' });
        editor.el.style.flex = '1';
        editor.el.style.minHeight = '0';
        editorRef.current = editor;
        hostRef.current.appendChild(editor.el);
        return () => {
            try { editor.dispose && editor.dispose(); } catch { /* ignore */ }
            editorRef.current = null;
        };
    }, []);
    useEffect(() => {
        let script: any;
        if (!element) {
            script = `// Select a ${kind.noun.toLowerCase()} to preview its script`;
        } else {
            // Generate the script client-side (mirrors each element's engine
            // getScript(false)); falls back for types with no generator.
            const generated = generateElementScript(element, childrenOf);
            script = generated ?? (isIteratorType(element.__type) ? `// ${iteratorPreviewUnavailable}`
                : `// ${oie.elementTypeLabel(element.__type)} ${kind.noun.toLowerCase()} — no preview available`);
        }
        if (editorRef.current) editorRef.current.setValue(script);
    }, [kind, element, rev]);
    return <div ref={hostRef} className="flex flex-col flex-1 min-w-0 min-h-0" />;
}

/* ---- right panel: Reference --------------------------------------------------- */

function ReferenceRow({ dragRef, name, subtitle, dropText, title }: any) {
    return (
        <div className="step-item cursor-grab" title={title || undefined}
            {...accessorDragProps(dragRef, () => dropText)}>
            <div className="flex-1 min-w-0">
                <div className="truncate">{name || '(unnamed)'}</div>
                {subtitle ? <div className="step-type">{subtitle}</div> : null}
            </div>
        </div>
    );
}

function ReferenceTab({ dragRef, channelId, context, getVariables, refreshRef }: any) {
    // Only categorized references appear in the Swing reference panel;
    // null-category entries (context variables, E4X methods) are
    // autocomplete-only in the client, so they are excluded here. Plugin
    // references join the engine catalog; both filter on the editor context.
    const builtin = useMemo(() => referencesFor(REFERENCE_CATALOG, [context])
        .map(r => ({ name: r.name, category: r.category, description: r.description, code: r.code, type: r.type })), [context]);
    const [availableVars, setAvailableVars] = useState<string[]>(getVariables);
    useEffect(() => {
        refreshRef.current = () => setAvailableVars(getVariables());
        refreshRef.current();
        return () => { refreshRef.current = null; };
    }, [getVariables, refreshRef]);

    const [category, setCategory] = useState('');
    const [query, setQuery] = useState('');
    // User code-template libraries append as extra categories once loaded.
    const [userEntries, setUserEntries] = useState<any>({ entries: [], categories: [] });

    useEffect(() => {
        let stale = false;
        // A library applies to this channel if it includes new channels (and
        // isn't explicitly disabled) or this channel is explicitly enabled.
        const libraryInScope = (lib: any) => {
            const id = String(channelId);
            const enabled = new Set(api.asList(lib.enabledChannelIds, 'string').map(String));
            const disabled = new Set(api.asList(lib.disabledChannelIds, 'string').map(String));
            return enabled.has(id) || (lib.includeNewChannels && !disabled.has(id));
        };
        api.codeTemplates.libraries(true)
            .then(allLibraries => {
                if (stale) return;
                const entries: any[] = [];
                const categories: any[] = [];
                for (const library of allLibraries.filter(libraryInScope)) {
                    const name = library.name || '(unnamed library)';
                    if (!categories.includes(name)) categories.push(name);
                    for (const t of api.asList(library.codeTemplates, 'codeTemplate')) {
                        if (t && typeof t === 'object' && api.asList(t.contextSet && t.contextSet.delegate, 'contextType')
                            .map(String).includes(context)) {
                            entries.push({
                                name: t.name, category: name,
                                description: t.description,
                                code: templateCompletionCode(t),
                                // Drag behavior is driven by the template type
                                // (FUNCTION / DRAG_AND_DROP_CODE / COMPILED_CODE).
                                type: (t.properties && t.properties.type) || 'DRAG_AND_DROP_CODE'
                            });
                        }
                    }
                }
                setUserEntries({ entries, categories });
            })
            .catch((e: any) => {
                toast(`Could not load user code-template libraries; showing built-ins only.\n\n${loadErrorMessage(e, 'code template libraries', 'code templates')}`, 'warn');
            });
        return () => { stale = true; };
    }, [channelId, context]);

    const entries = [...builtin, ...userEntries.entries];
    const present = new Set(entries.map(e => e.category));
    // Plugin categories sort alphabetically after the built-in and user ones
    // (Swing's CategoryComparator).
    const pluginCategories = [...present].filter(c =>
        !REFERENCE_CATEGORY_ORDER.includes(c) && !userEntries.categories.includes(c)).sort();
    const categories = [...new Set(REFERENCE_CATEGORY_ORDER.filter(c => present.has(c))
        .concat(userEntries.categories.filter((c: any) => present.has(c)), pluginCategories))];
    const q = query.trim().toLowerCase();
    const visible = entries.filter(en =>
        (!category || en.category === category) &&
        (!q || `${en.name} ${cleanDesc(en.description)}`.toLowerCase().includes(q)));

    return (
        <div className="p-3 flex flex-col h-full min-h-0">
            <div className="field">
                <label>Category</label>
                <select value={category} onChange={(e: any) => setCategory(e.target.value)}>
                    <option value="">All</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="field">
                <input type="text" placeholder="Filter…" value={query} onChange={(e: any) => setQuery(e.target.value)} />
            </div>
            <div className="border border-line rounded overflow-auto flex-1 min-h-[108px]">
                {visible.length
                    ? visible.map((en: any, i: any) => (
                        <ReferenceRow key={`${en.category}:${en.name}:${i}`} dragRef={dragRef}
                            name={en.name} subtitle={en.category} dropText={dropTextFor(en)}
                            title={en.description ? cleanDesc(en.description) : undefined} />
                    ))
                    : <div className="text-text-faint p-2.5 text-center">No matches</div>}
            </div>
            <div className="font-semibold text-[10px] uppercase tracking-[0.04em] mt-3 mx-0 mb-1">Available Variables</div>
            <div className="border border-line rounded overflow-auto max-h-[126px]">
                {availableVars.length
                    ? availableVars.map(v => <ReferenceRow key={v} dragRef={dragRef} name={v} dropText={v} />)
                    : <div className="text-text-faint py-2 px-2.5 text-[10px]">(no variables defined by steps yet)</div>}
            </div>
        </div>
    );
}

/* ---- right panel: Message Templates ----------------------------------------- */

const subscribeToChannelEdit = (notify: () => void) => store.subscribe('editingChannel', notify);

function TemplatesSide({ side, title, templateKey, target, version, connectorType, channel, commit, canEdit }: any) {
    const dtOptions = dataTypeList().map(dt => ({ value: dt.name, label: dt.label }));

    // Fresh default properties object for a data type (one per call).
    const makeDefaultProps = (typeName: any) => {
        const def = dataTypeDef(typeName);
        return def ? def.defaults(version) : { '@version': version };
    };
    const dtLabel = (name: any) => (dataTypeDef(name) || { label: name }).label;
    const typeName = useSyncExternalStore(subscribeToChannelEdit, () => target[`${side}DataType`] || 'RAW');
    const template = useSyncExternalStore(subscribeToChannelEdit, () => String(target[templateKey] ?? ''));
    const source = channel.sourceConnector;
    const fixedInboundType = side === 'inbound' && (connectorType === 'DESTINATION' || (connectorType === 'SOURCE'
        && (source.transportName === 'Database Reader' || (source.transportName === 'HTTP Listener' && String(source.properties?.xmlBody) === 'true'))));
    const readOnly = !canEdit();
    const language = typeName === 'HL7V2' ? 'hl7v2' : typeName === 'JSON' ? 'json' : ['XML', 'HL7V3', 'DICOM'].includes(typeName) ? 'xml' : 'text';
    const editorHostRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ReturnType<typeof createCodeEditor> | null>(null);
    const commitRef = useRef(commit);
    commitRef.current = commit;
    const syncing = useRef(false);
    useEffect(() => {
        const host = editorHostRef.current!;
        const editor = createCodeEditor({
            value: String(target[templateKey] ?? ''), language, literalInput: true, readOnly,
            ariaLabel: `${title} Template`, placeholder: '(none)', minHeight: '160px',
            onChange: value => {
                if (syncing.current || !canEdit()) return;
                target[templateKey] = value === '' ? null : value;
                commitRef.current();
            }
        });
        editor.el.style.height = '200px';
        editor.el.style.resize = 'vertical';
        editorRef.current = editor;
        host.appendChild(editor.el);
        return () => { editor.dispose(); editorRef.current = null; host.replaceChildren(); };
    }, [target, templateKey, language, title, readOnly, canEdit]);
    useEffect(() => {
        // A newer keystroke may have updated the model since this render.
        if (template !== String(target[templateKey] ?? '')) return;
        const editor = editorRef.current;
        // Display normalization must not dirty an untouched CR/CRLF template.
        if (!editor || normalizeLineEndings(editor.getValue()) === normalizeLineEndings(template)) return;
        syncing.current = true;
        try { editor.setValue(normalizeLineEndings(template)); } finally { syncing.current = false; }
    }, [target, templateKey, template]);

    // Edit this side's data type properties in a modal (Swing's data type
    // properties dialog). Edits go to a draft and apply on OK; the modal is
    // imperative, so the editor mounts through its own root.
    const openPropsModal = () => {
        if (!canEdit()) return;
        const current = target[`${side}Properties`];
        let draft = current && typeof current === 'object' ? JSON.parse(JSON.stringify(current)) : makeDefaultProps(typeName);
        const editorHost = h('div');
        const validationErrors = h('div', { role: 'alert', class: 'hint whitespace-pre-line', style: { color: 'var(--err)' } });
        const root = mountReact(editorHost, <DataTypePropertiesEditor
            channelId={channel && channel.id} typeName={typeName} props={draft} version={version}
            direction={side} connectorType={connectorType}
            onChange={() => { validationErrors.textContent = ''; }}
            onReplace={(obj: any) => { draft = obj; }} />);
        modal({
            title: `${title} Data Type Properties — ${dtLabel(typeName)}`,
            size: 'wide',
            body: h('div', validationErrors, editorHost),
            onClose: () => { try { root(); } catch { /* ignore */ } },
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'OK', primary: true,
                    onClick: () => {
                        if (!canEdit()) return;
                        const errors = normalizeDataTypeProperties(typeName, draft);
                        validationErrors.textContent = errors.join('\n');
                        if (errors.length) return false;
                        target[`${side}Properties`] = draft;
                        commit();
                    }
                }
            ]
        });
    };

    const onTypeChange = (value: any) => {
        if (fixedInboundType || !canEdit()) return;
        target[`${side}DataType`] = value;
        target[`${side}Properties`] = makeDefaultProps(value);
        if (side === 'inbound' && connectorType === 'SOURCE') updateImportedAttachmentHandler(channel, value);
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
    };

    const fileLoad = useRef(0);
    const properties = useSyncExternalStore(subscribeToChannelEdit, () => target[`${side}Properties`]);
    // A changed template, type, import, or closed tab supersedes a pending file load.
    useLayoutEffect(() => () => { fileLoad.current++; }, [target, template, typeName, properties]);

    const openFile = async () => {
        if (!canEdit()) return;
        const request = ++fileLoad.current;
        const current = () => request === fileLoad.current && canEdit()
            && typeName === (target[`${side}DataType`] || 'RAW')
            && template === String(target[templateKey] ?? '') && properties === target[`${side}Properties`];
        const isDicom = typeName === 'DICOM';
        // DICOM is binary; read it as base64 so it isn't mangled, then
        // serialize to the XML template.
        const file = await pickFile(undefined, { binary: isDicom });
        if (!file || !current()) return;
        let text = String(file.content ?? '');
        if (isDicom) {
            // Serialize the binary DICOM to its XML form via the engine's
            // data-type serializer (Swing shows the serialized DICOM XML in
            // the template, not raw bytes).
            const ser = await serializeTemplate('DICOM', properties?.serializationProperties, text).catch(() => null);
            if (!current()) return;
            if (ser && ser.text) { text = ser.text; }
            else { toast('Could not serialize the DICOM file — the serialize endpoint may be unavailable.', 'warn'); return; }
        }
        target[templateKey] = text === '' ? null : text;
        commit();
    };

    return (
        <div>
            <div className="field">
                <label>{`${title} Data Type`}</label>
                <div className="flex gap-2 items-center">
                    <select value={typeName} disabled={readOnly || fixedInboundType} onChange={(e: any) => onTypeChange(e.target.value)}>
                        {dtOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button className="btn btn-sm" disabled={readOnly} onClick={openPropsModal}
                        title="Edit this data type’s serialization properties">Properties…</button>
                    <button className="btn btn-sm" disabled={readOnly} title="Load a message file into this template"
                        onClick={openFile}>Open File…</button>
                </div>
            </div>
            <div className="field">
                <label>{`${title} Template`}</label>
                <div ref={editorHostRef} />
            </div>
        </div>
    );
}

function TemplatesTab({ target, version, connectorType, channel, commit, isFilter, canEdit }: any) {
    return (
        <div className="p-3">
            <p className="hint mb-2">Tab inserts a tab. {navigator.userAgent.includes('Macintosh') ? 'Ctrl+Shift+M' : 'Ctrl+M'} toggles Tab to move focus.</p>
            <TemplatesSide side="inbound" title="Inbound" templateKey="inboundTemplate"
                target={target} version={version} connectorType={connectorType} channel={channel} commit={commit} canEdit={canEdit} />
            {!isFilter && <>
                <div className="h-3.5" />
                <TemplatesSide side="outbound" title="Outbound" templateKey="outboundTemplate"
                    target={target} version={version} connectorType={connectorType} channel={channel} commit={commit} canEdit={canEdit} />
            </>}
        </div>
    );
}

/* ---- right panel: Message Trees ----------------------------------------------
   Renders the inbound or outbound template as a tree-table: Field (indented),
   Name (the engine vocabulary description) and Sample value. Every row is
   draggable (accessor flavors) and has the tree actions (Expand/Collapse All,
   Map to Variable / Map to Message, Copy Accessor) on right-click and on its
   ⋯ button. The message root is the caption above the table. */

const NO_KEYS = new Set<string>();

function isEmptyNode(node: any): boolean {
    return (node.value == null || node.value === '') && node.children.every(isEmptyNode);
}

// The component and subcomponent separators from MSH.2 (HL7 v2).
function hl7Separators(root: any) {
    const msh = root.children.find((c: any) => c.name === 'MSH');
    const enc = String(msh?.children.find((c: any) => c.name === 'MSH.2')?.value || '^~\\&');
    return { component: enc[0] || '^', subcomponent: enc[3] || '&' };
}

// Children named after their parent (PID.5 → PID.5.1) — the non-strict HL7 v2
// layout. The strict parser names components by data type (XPN.1) instead.
function numberedChildren(node: any) {
    return node.children.length > 0 && node.children.every((c: any) => c.name.startsWith(`${node.name}.`));
}

// A field or component value joined with the message's own separators.
function joinedValue(node: any, seps: any): string | null {
    const sep = seps && numberedChildren(node) && [null, seps.component, seps.subcomponent][node.name.split('.').length - 1];
    if (!sep) return null;
    return node.children.map((c: any) => (c.value ?? (c.children.length ? joinedValue(c, seps) : null)) ?? '').join(sep);
}

// The non-strict HL7 v2 serializer stores every simple field as a lone `.1`
// component. Such a field is one row that reads, drags and maps that component.
// Segments (no dot) and strict-parser components (HD.1) keep their own rows.
function treeRow(node: any, key: string, seps: any, top: boolean, path: TreeNamePath | null): any {
    const only = seps && node.name.includes('.') && node.children.length === 1 ? node.children[0] : null;
    const source = only && !only.children.length && only.name === `${node.name}.1` ? only : node;
    const children = source === node ? node.children.map((c: any, i: number) =>
        treeRow(c, `${key}/${i}`, seps, false, { node: c, parent: path })) : [];
    const joined = source.value == null && source.children.length ? joinedValue(source, seps) : null;
    const row: any = {
        key, node, source, children, path,
        field: node.index == null ? node.name : `${node.name}[${node.index}]`,
        desc: node.desc || source.desc || '',
        value: joined ?? source.value,
        joined: joined != null,
        empty: isEmptyNode(node),
        group: top && children.length > 0
    };
    if (row.group && seps && numberedChildren(node)) row.count = { filled: children.filter((c: any) => !c.empty).length, total: children.length };
    return row;
}

function messageRows(root: any, side: string, hl7: boolean) {
    const seps = hl7 ? hl7Separators(root) : null;
    const nodes = root.children.length && root.value == null ? root.children : [root];
    return nodes.map((n: any, i: number) =>
        treeRow(n, `${side}/${i}`, seps, true, n === root ? null : { node: n, parent: null }));
}

function branchKeys(rows: any[], out = new Set<string>()) {
    for (const r of rows) {
        if (r.children.length) { out.add(r.key); branchKeys(r.children, out); }
    }
    return out;
}

function rowText(row: any) {
    return `${row.field} ${row.desc} ${row.value ?? ''}`.toLowerCase();
}

function copyAccessor(text: string) {
    if (!navigator.clipboard?.writeText) { toast('Clipboard unavailable', 'warn'); return; }
    navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'), () => toast('Clipboard unavailable', 'warn'));
}

function TreeSection({ side, varName, hidden, query, hideEmpty, target, dragRef, treeAccessor, onAddStep, isFilter }: any) {
    const [parse, setParse] = useState<any>({ status: 'idle' });   // idle | parsing | ready | failed | empty
    const [collapsed, setCollapsed] = useState<Set<string>>(NO_KEYS);
    const [filterCollapsed, setFilterCollapsed] = useState<any>({ q: '', keys: NO_KEYS });
    const [selected, setSelected] = useState<any>(null);

    // Replacement imports mutate the same target while the side panel is open.
    const template = useSyncExternalStore(subscribeToChannelEdit, () => target[`${side}Template`]);
    const dataType = useSyncExternalStore(subscribeToChannelEdit, () => target[`${side}DataType`] || 'RAW');
    const serialization = useSyncExternalStore(subscribeToChannelEdit, () => target[`${side}Properties`]?.serializationProperties);
    const dtLabel = (dataTypeDef(dataType) || { label: dataType }).label;
    const regionLabel = `${side === 'inbound' ? 'Inbound' : 'Outbound'} message tree (${varName})`;

    useLayoutEffect(() => {
        setSelected(null);
        setFilterCollapsed({ q: '', keys: NO_KEYS });
        if (template == null || String(template).trim() === '') { setParse({ status: 'empty' }); return undefined; }
        let stale = false;
        setParse({ status: 'parsing' });
        const tmpl = String(template);
        // The engine serializes the template through its own datatype serializers
        // (byte-exact, all data types, strict + non-strict); the tree is built from
        // that output. No local parsing — this depends on the connected engine.
        (async () => {
            let nodes: any = null;
            if (dataType === 'DICOM') {
                // The DICOM template is already the serialized DICOM XML (Open
                // File converted the binary), so build the tree from it directly.
                // Re-serializing would fail — the engine's DICOM serialize expects
                // raw binary, not the XML form.
                try { nodes = xmlTree(tmpl, varName); } catch { nodes = null; }
            } else {
                const ser = await serializeTemplate(dataType, serialization || {}, tmpl).catch(() => null);
                if (ser && ser.text != null) {
                    try {
                        nodes = ser.format === 'json' ? jsonTree(ser.text, varName) : xmlTree(ser.text, varName, ser.meta);
                    } catch { nodes = null; }
                }
            }
            if (stale) return;
            if (!nodes) { setParse({ status: 'failed' }); return; }
            // Like the Swing tree, only the message root starts expanded.
            const rows = messageRows(nodes[0], side, dataType === 'HL7V2');
            const keys = branchKeys(rows);
            if (rows[0]?.node === nodes[0]) keys.delete(rows[0].key);
            setCollapsed(keys);
            setParse({ status: 'ready', root: nodes[0], rows });
        })();
        return () => { stale = true; };
    }, [template, dataType, serialization, side, varName]);

    // A filter expands every match; twisties then fold that filtered view only.
    const q = query.trim().toLowerCase();
    const openKeys = q ? (filterCollapsed.q === q ? filterCollapsed.keys : NO_KEYS) : collapsed;
    const updateKeys = (change: (keys: Set<string>) => void) => {
        const next = (prev: Set<string>) => { const keys = new Set(prev); change(keys); return keys; };
        if (q) setFilterCollapsed((prev: any) => ({ q, keys: next(prev.q === q ? prev.keys : NO_KEYS) }));
        else setCollapsed(next);
    };
    const setBranches = (rows: any[], open: boolean) => updateKeys(keys => {
        for (const key of branchKeys(rows)) { if (open) keys.delete(key); else keys.add(key); }
    });

    function addFromTree(action: 'mapper' | 'builder' | 'rule', source: any, path: TreeNamePath | null, fromGrid = false) {
        const { accessor } = source;
        const { variable, description } = treeFieldNames(path);
        if (action === 'mapper') {
            const key = path ? variable : varName;
            onAddStep(ElementType.Mapper, 'Mapper', key, (el: any) => { el.mapping = accessor; el.variable = key; });
        } else if (action === 'builder') {
            const segment = treeMessageSegment(source, []);
            if (!segment) return;
            onAddStep(ElementType.MessageBuilder, 'Message Builder', `${description} (out)`,
                (el: any) => { el.messageSegment = segment; }, source);
        } else {
            onAddStep(ElementType.RuleBuilder, 'Rule Builder', fromGrid ? description : '', (el: any) => { el.field = accessor; });
        }
    }
    const dragProps = (source: any, path: TreeNamePath | null) => accessorDragProps(
        dragRef,
        event => treeAccessor(source, event),
        event => {
            const action = isFilter ? 'rule' : side === 'inbound' && !treeDragModifier(event) ? 'mapper' : 'builder';
            addFromTree(action, source, path, true);
        }
    );
    const menuItems = (source: any, path: TreeNamePath | null, rows: any[]) => {
        const items: any[] = [];
        if (branchKeys(rows).size) {
            items.push({ label: 'Expand All', onClick: () => setBranches(rows, true) },
                { label: 'Collapse All', onClick: () => setBranches(rows, false) }, '-');
        }
        if (isFilter) {
            items.push({
                label: 'Filter by Value', icon: 'filter',
                onClick: () => addFromTree('rule', source, path)
            });
        } else {
            if (side === 'inbound') {
                items.push({
                    label: 'Map to Variable', icon: 'transform',
                    onClick: () => addFromTree('mapper', source, path)
                });
            }
            items.push({
                label: 'Map to Message', icon: 'transform',
                onClick: () => addFromTree('builder', source, path)
            });
        }
        items.push('-', { label: 'Copy Accessor', icon: 'copy', onClick: () => copyAccessor(source.accessor) });
        return items;
    };
    const rowMenu = (row: any, x: number, y: number) => {
        setSelected(row);
        contextMenu(x, y, menuItems(row.source, row.path, [row]));
    };

    if (parse.status !== 'ready') {
        return (
            <section className="mt-section" style={{ display: hidden ? 'none' : undefined }} aria-label={regionLabel}>
                <div className="mt-note">
                    {parse.status === 'empty' && '(no template — set one on the Message Templates tab)'}
                    {(parse.status === 'parsing' || parse.status === 'idle') && 'Parsing…'}
                    {parse.status === 'failed' && `Could not build the message tree — the engine could not serialize this ${dtLabel} template.`}
                </div>
            </section>
        );
    }

    const { root, rows } = parse;
    const matches = (hideEmpty || q)
        ? (row: any) => (!hideEmpty || !row.empty) && (!q || rowText(row).includes(q))
        : undefined;
    const hasNames = (function anyDesc(list: any[]): boolean {
        return list.some((r: any) => r.desc || anyDesc(r.children));
    })(rows);
    const valueText = (row: any) => {
        if (row.count) {
            const noun = row.count.total === 1 ? 'field' : 'fields';
            return row.count.filled === row.count.total ? `${row.count.total} ${noun}` : `${row.count.filled} of ${row.count.total} ${noun}`;
        }
        return row.value ?? '';
    };
    const columns = [
        {
            key: 'field', label: 'Field', tree: true,
            render: (row: any) => <span className="mono" title={row.source.accessor}>{row.field}</span>
        },
        ...(hasNames ? [{ key: 'name', label: 'Name', render: (row: any) => <span title={row.desc || undefined}>{row.desc}</span> }] : []),
        {
            key: 'value', label: 'Sample value',
            render: (row: any) => (
                <span className="mt-value">
                    <span className={'mt-text' + (row.count ? ' mt-count' : row.joined ? ' mt-joined' : '')}
                        title={row.count ? undefined : (row.value || undefined)}>{valueText(row)}</span>
                    <button type="button" className="mt-more" aria-label={`Actions for ${row.field}`} title="Actions"
                        // Enter/Space press the button; the treegrid would take them as row keys.
                        onKeyDown={(e: any) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
                        onClick={(e: any) => {
                            e.stopPropagation();
                            const r = e.currentTarget.getBoundingClientRect();
                            rowMenu(row, r.left, r.bottom + 2);
                        }}>⋯</button>
                </span>
            )
        }
    ];
    const rootMenu = (e: any) => {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, menuItems(root, null, rows));
    };

    return (
        <section className="mt-section" style={{ display: hidden ? 'none' : undefined }} aria-label={regionLabel}>
            <div className="mt-root">
                <span className="mt-root-label" title={`Drag into a script editor: ${root.accessor}`}
                    {...dragProps(root, null)} onContextMenu={rootMenu}>
                    {root.label !== varName ? root.label : dtLabel}
                </span>
                <button type="button" className="icon-btn" title="Expand All" aria-label="Expand all"
                    onClick={() => setBranches(rows, true)}><Icon name="plus" size={14} /></button>
                <button type="button" className="icon-btn" title="Collapse All" aria-label="Collapse all"
                    onClick={() => setBranches(rows, false)}><Icon name="minus" size={14} /></button>
            </div>
            <div className="mt-table">
                <TreeTable
                    data={rows}
                    columns={columns}
                    getChildren={(row: any) => row.children}
                    rowKey={(row: any) => row.key}
                    rowClassName={(row: any) => [row.group ? 'group-row' : '', row.empty ? 'mt-empty' : ''].filter(Boolean).join(' ')}
                    autoGroupRow={false}
                    selectedKey={selected ? selected.key : null}
                    onSelect={(row: any) => setSelected(row)}
                    onRowContextMenu={(row: any, e: any) => { e.preventDefault(); rowMenu(row, e.clientX, e.clientY); }}
                    rowDraggable={() => true}
                    onRowDragStart={(row: any, e: any) => dragProps(row.source, row.path).onDragStart(e)}
                    onRowDragEnd={() => { dragRef.current = null; }}
                    matches={matches}
                    collapsedKeys={openKeys}
                    onToggleCollapse={(key: any) => updateKeys(keys => { if (keys.has(key)) keys.delete(key); else keys.add(key); })}
                    columnsKey="ft-message-tree"
                    columnWidths={{ field: 124, name: 150 }}
                    pinnedKeys={['field', 'value']}
                    emptyText={q ? 'No matching fields' : 'No fields'} />
            </div>
            <div className="mt-foot">
                {selected
                    ? <>
                        <code title={selected.source.accessor}>{selected.source.accessor}</code>
                        <button type="button" className="btn btn-sm" onClick={() => copyAccessor(selected.source.accessor)}>Copy</button>
                    </>
                    : 'Drag a row into a script editor or field. Right-click a row for actions.'}
            </div>
        </section>
    );
}

function TreesTab({ target, dragRef, treeAccessor, onAddStep, isFilter }: any) {
    const [side, setSide] = useState('inbound');
    const [query, setQuery] = useState('');
    const [hideEmpty, setHideEmpty] = useState(false);
    return (
        <div className="mtree">
            <div className="mt-bar">
                {!isFilter && <SegPill label="Message template" value={side} onChange={setSide} options={[
                    { value: 'inbound', label: 'Inbound', title: 'Inbound message template (msg)' },
                    { value: 'outbound', label: 'Outbound', title: 'Outbound message template (tmp)' }
                ]} />}
                <input type="text" placeholder="Filter fields…" aria-label="Filter fields" value={query}
                    onChange={(e: any) => setQuery(e.target.value)} />
                <button type="button" className="icon-btn" aria-pressed={hideEmpty}
                    title={hideEmpty ? 'Show empty fields' : 'Hide empty fields'} aria-label="Hide empty fields"
                    onClick={() => setHideEmpty(v => !v)}><Icon name={hideEmpty ? 'eyeOff' : 'eye'} size={14} /></button>
            </div>
            <TreeSection side="inbound" varName="msg" hidden={side !== 'inbound'} query={query} hideEmpty={hideEmpty}
                target={target} dragRef={dragRef} treeAccessor={treeAccessor} onAddStep={onAddStep} isFilter={isFilter} />
            {!isFilter && <TreeSection side="outbound" varName="tmp" hidden={side !== 'outbound'} query={query} hideEmpty={hideEmpty}
                target={target} dragRef={dragRef} treeAccessor={treeAccessor} onAddStep={onAddStep} />}
        </div>
    );
}

/* Side tabs mirror the Swing client: Reference, Message Trees, Message
   Templates. The active tab is KEYED so switching remounts it. The whole panel
   collapses to a strip; its fixed-width wrapper and the splitter live in the
   MAIN tree (this is a separate root), so the flag is mirrored out through
   ctx.onSideCollapsed for the wrapper to follow. */
function SidePanel({ ctx }: any) {
    const [active, setActive] = useState(0);
    const [collapsed, setCollapsed] = useSideCollapse('ft-reference');
    const { isFilter } = ctx;
    const labels = ['Reference', 'Message Trees', 'Message Templates'];

    useLayoutEffect(() => {
        if (ctx.onSideCollapsed) ctx.onSideCollapsed(collapsed);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [collapsed]);

    const label = labels[Math.min(active, labels.length - 1)];

    if (collapsed) {
        // The strip is named after the ACTIVE tab — it says what expanding
        // brings back (the tab state survives the collapse; only the body hides).
        return <CollapsedSideStrip className="flex-1" label={label} onExpand={() => setCollapsed(false)} />;
    }

    let body: any = null;
    if (label === 'Reference') {
        body = <ReferenceTab key="ref" dragRef={ctx.dragRef} channelId={ctx.channelId}
            context={scriptContext(ctx.connectorType)} getVariables={ctx.getVariables} refreshRef={ctx.referenceRefreshRef} />;
    } else if (label === 'Message Trees') {
        body = <TreesTab key="trees" target={ctx.target} dragRef={ctx.dragRef} treeAccessor={ctx.treeAccessor}
            onAddStep={ctx.onAddStep} isFilter={isFilter} />;
    } else if (label === 'Message Templates') {
        body = <TemplatesTab key="templates" target={ctx.target} version={ctx.version}
            connectorType={ctx.connectorType} channel={ctx.channel} commit={ctx.commit} isFilter={isFilter} canEdit={ctx.canEdit} />;
    }
    return (
        <TabsPrimitive.Root value={String(Math.min(active, labels.length - 1))}
            onValueChange={(v: any) => setActive(Number(v))}
            className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* The collapse chevron sits OUTSIDE the pill: the tab list hugs and
                scrolls its content, so a button inside it would scroll away. */}
            <div className="flex items-center min-w-0 pr-2">
                <TabsPrimitive.List className="tabs" aria-label="Reference panel sections">
                    {labels.map((l: any, i: any) => (
                        <TabsPrimitive.Trigger key={l} value={String(i)}
                            className={'tab' + (i === active ? ' active' : '')}>{l}</TabsPrimitive.Trigger>
                    ))}
                </TabsPrimitive.List>
                <SideCollapseButton label="the reference panel" onCollapse={() => setCollapsed(true)} />
            </div>
            <TabsPrimitive.Content value={String(Math.min(active, labels.length - 1))} className="tab-body">
                {body}
            </TabsPrimitive.Content>
        </TabsPrimitive.Root>
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
function EditorBody({ params, kindName, onTasksChange, apiRef, embedded }: any) {
    const kind = (KINDS as any)[kindName];
    const isFilter = kindName === 'filter';

    /* ---- one-time setup: resolve the working model from the store -------------
       The channel is guaranteed present (the routed view fetches it first; the
       wizard seeds it). The element tree is the session's MUTABLE working
       model: hydrated once, mutated in place by every action, serialized back
       in persist(). */
    const setupRef = useRef<any>(null);
    if (!setupRef.current) {
        const channel = store.getState('editingChannel');
        const version = channel['@version'] || store.getState('serverVersion') || '4.5.2';
        const connector = String(params.metaDataId) === '0'
            ? channel.sourceConnector
            : oie.destinationsOf(channel).find(d => Number(d.metaDataId) === Number(params.metaDataId));
        let target: any = null;
        let elements: any[] = [];
        if (connector) {
            if (!connector[kind.targetKey]) {
                connector[kind.targetKey] = isFilter ? oie.emptyFilter(version) : oie.emptyTransformer(version);
            }
            if (isFilter && !connector.transformer) connector.transformer = oie.emptyTransformer(version);
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
    const mountedRef = useRef(true);
    const importingRef = useRef(false);
    useLayoutEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const [selectedPath, setSelectedPathState] = useState(() =>
        setupRef.current.elements.length ? [0] : null);
    const selectedPathRef = useRef(selectedPath);
    const setSelected = (path: any) => { selectedPathRef.current = path; setSelectedPathState(path); };
    const [rev, bump] = useReducer((x: any) => x + 1, 0);
    // Membership edits rewrite model fields outside plugin-local React state.
    // Remount the selected plugin after those edits to display the new values.
    const [elementContextRevision, bumpElementContext] = useReducer((x: number) => x + 1, 0);
    const [bottomTab, setBottomTab] = useState(0);
    // True only while a step plugin's flushSync mount runs (see StepEditorPanel).
    const settlingRef = useRef(false);
    // Live accessor-drag token (reference rows / tree nodes → editors).
    const dragRef = useRef<AccessorDrag | null>(null);
    const referenceRefreshRef = useRef<(() => void) | null>(null);
    useLayoutEffect(() => { referenceRefreshRef.current?.(); }, [rev, selectedPath]);
    const rootRef = useRef<any>(null);
    const guardImplRef = useRef<any>(null);

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
        target.elements = serializeEditorElements(elementsRef.current);
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

    function saveChannel() { return withEditorSave(saveChannelUnlocked); }

    async function saveChannelUnlocked() {
        const isCurrent = channelSessionActive();
        if (!isCurrent()) return false;
        persist();
        const problems = oie.validateChannel(channel);
        if (problems.length) {
            modal({
                title: 'Cannot Save Channel',
                body: h('div',
                    h('p', 'Fix the following before saving — the engine would reject this channel:'),
                    h('ul', { class: 'mt-2 mx-0 mb-0 pl-[16px]' }, problems.map(p => h('li', p)))),
                buttons: [{ label: 'OK' }]
            });
            return;
        }
        try {
            const saved = await persistChannelEdits(channel);
            if (!isCurrent() || !saved) return false;
            store.setState('editingChannelDirty', false);
            toast(`Saved ${channel.name}`);
        } catch (e: any) {
            if (isCurrent()) toast(e.message, 'error');
        } finally {
            if (isCurrent() && mountedRef.current) onTasksChange();
        }
    }

    /* Leaving the channel's editing flow with unsaved step/rule edits asks
       Save / Don't Save / Cancel (same as the channel editor). Navigation that
       stays within /channels/<id>/... (back to the editor or another sub-editor)
       keeps the working copy without prompting. */
    function promptSaveChanges() {
        return new Promise((resolve: any) => {
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

    guardImplRef.current = async ({ path }: any) => {
        const isCurrent = channelSessionActive();
        if (!isCurrent()) return false;
        if (path.startsWith(`/channels/${params.channelId}/`)) return; // same editing flow
        if (channelDirty()) {
            const choice = await promptSaveChanges();
            if (!isCurrent() || choice === 'cancel') return false;
            // saveChannel() clears the dirty flag on success; if it's still dirty
            // (validation blocked or the request failed) keep the user here.
            if (choice === 'save') { await saveChannel(); if (!isCurrent() || channelDirty()) return false; }
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
        setActiveScope(params.channelId, [scriptContext(connectorType)]);
        if (!embedded) store.setState('navGuard', (info: any) => guardImplRef.current(info));
        const unregister = embedded ? () => {} : registerUnsavedCheck(channelDirty);
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
            unregister();
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

    const typeDef = (type: any) => typeDefFor(isFilter, type);
    const elementName = (el: any) => elementNameOf(isFilter, el);

    // Step/rule types offered here. Source-only types (e.g. Destination Set Filter)
    // are excluded on destination and response transformers, matching the Swing
    // TransformerPane (which drops onlySourceConnector() plugins off the source).
    function availableTypeEntries() {
        const registry = isFilter ? platform.ruleTypes() : platform.stepTypes();
        return [...registry].filter(([, def]) => isSourceConnector || !def.onlySource);
    }

    function selectElement(path: any) {
        setSelected(path);
        onTasksChange();
    }

    /* ---- actions (resolve their targets at execution time via the refs) ---- */

    function addElement() {
        if (!canEditElements()) return;
        const entries = availableTypeEntries();
        const defaultType = isFilter ? ElementType.RuleBuilder : ElementType.Mapper;
        const entry = entries.find(([type]) => type === defaultType) ?? entries[0];
        if (!entry) { toast('No element types registered', 'warn'); return; }
        const [type, def] = entry;
        const element = def.create ? def.create() : { __type: type, name: '', enabled: true };
        if (!element.__type) element.__type = type;
        const elements = elementsRef.current;
        const selected = selectedPathRef.current ?? [];
        const row = elementAtPath(elements, selected);
        const parentPath = row && isIteratorType(row.__type) ? selected : selected.slice(0, -1);
        const parent = elementAtPath(elements, parentPath);
        if (!canPlaceElement(element, parent ? [...iteratorAncestors(parentPath), parent] : [])) return;
        const siblings = parent ? childrenOf(parent) : elements;
        siblings.push(element);
        setSelected([...parentPath, siblings.length - 1]);
        commitRef.current();
    }

    function changeElementType(path: any, newType: any) {
        const old = elementAtPath(elementsRef.current, path);
        if (!old || old.__type === newType || !canEditElements()) return;
        const wasIterator = isIteratorType(old.__type);
        const toIterator = isIteratorType(newType);
        if (wasIterator && childrenOf(old).length) {
            modal({
                title: `Change ${kind.noun} Type`,
                body: h('p', 'Please remove all children before changing an Iterator to a different type.'),
                buttons: [{ label: 'OK', primary: true }]
            });
            return;
        }
        const nextType = typeDef(newType);
        if (!nextType) return;
        const editActive = captureElementEdit();
        const original = JSON.stringify(old);
        const replace = () => {
            if (!editActive() || JSON.stringify(old) !== original) return;
            const current = pathOf(old, elementsRef.current);
            if (!current) return;
            const created = nextType.create?.() ?? { name: '', enabled: true };
            created.__type = newType;
            if (toIterator) created.__children = [];
            if (!canPlaceElement(created, iteratorAncestors(current))) return;
            listAtPath(elementsRef.current, current)[current.at(-1)] = created;
            setSelected(current);
            commitRef.current();
        };
        const defaults = typeDef(old.__type)?.create?.();
        // Swing 4.6 starts both JavaScript panels empty. The web panels offer starter text.
        if (defaults && (old.script == null || old.script === '')
            && (old.__type === ElementType.JavaScriptStep
                || old.__type === ElementType.JavaScriptRule)) {
            defaults.script = '';
        }
        // The hydrated children were checked above. The wire copy can still contain a removed child.
        const unchanged = defaults && (wasIterator
            ? matchesPanelDefaults(old.properties, defaults.properties, new Set(['children']))
            : matchesPanelDefaults(old, defaults, gridMetadata));
        if (unchanged) {
            replace();
        } else {
            modal({
                title: `Change ${kind.noun} Type`,
                body: h('p', `Are you sure you would like to change this ${kind.title.toLowerCase()} ${kind.noun.toLowerCase()} and lose all of the current data?`),
                buttons: [{ label: 'No' }, { label: 'Yes', primary: true, onClick: replace }]
            });
        }
    }

    function deleteElement() {
        if (!canEditElements()) return;
        const element = elementAtPath(elementsRef.current, selectedPathRef.current);
        if (!element) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const editActive = captureElementEdit();
        const remove = () => {
            if (!editActive()) return;
            const elements = elementsRef.current;
            const rows = flattenRows(elements);
            const index = rows.findIndex(row => row.el === element);
            if (index < 0) return;
            const { path } = rows[index];
            listAtPath(elements, path).splice(path[path.length - 1], 1);
            const remaining = flattenRows(elements);
            setSelected(remaining[Math.min(index, remaining.length - 1)]?.path ?? null);
            commitRef.current();
        };
        if (isIteratorType(element.__type) && childrenOf(element).length) {
            modal({
                title: `Delete ${kind.noun}`,
                body: h('p', `All child ${kind.noun.toLowerCase()}s will be removed along with the Iterator. Are you sure you wish to continue?`),
                buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: remove }]
            });
        } else remove();
    }

    function move(delta: -1 | 1) {
        const elements = elementsRef.current;
        const path = selectedPathRef.current;
        const el = elementAtPath(elements, path);
        if (!path || !el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        if (!canEditElements()) return;
        const parent = elementAtPath(elements, path.slice(0, -1));
        const next = path[path.length - 1] + delta;
        if (next >= 0 && next < listAtPath(elements, path).length) {
            relocateElement(path, parent, { index: next });
        } else if (parent) {
            const editActive = captureElementEdit();
            modal({
                title: `Move ${kind.noun} ${delta < 0 ? 'Up' : 'Down'}`,
                body: h('p', `This will move the ${kind.noun.toLowerCase()} out of its parent Iterator. Are you sure you wish to continue?`),
                buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => {
                    if (!editActive()) return;
                    const current = pathOf(el, elementsRef.current);
                    if (!current || elementAtPath(elementsRef.current, current.slice(0, -1)) !== parent) return;
                    const boundary = delta < 0 ? 0 : childrenOf(parent).length - 1;
                    if (current.at(-1) !== boundary) return;
                    const grandparent = elementAtPath(elementsRef.current, current.slice(0, -2));
                    relocateElement(current, grandparent, { index: current.at(-2) + (delta > 0 ? 1 : 0) });
                } }]
            });
        }
    }

    async function importElements() {
        if (importingRef.current) return;
        const active = editorSessionActive();
        if (!active()) return;
        importingRef.current = true;
        try {
            const file = await pickFile('.xml,.json');
            if (!file || !active()) return;
            const imported = parseFilterTransformerImport(file.content, isFilter, version, target);
            const registry = isFilter ? platform.ruleTypes() : platform.stepTypes();
            normalizeImportedElementTypes(imported, type => registry.get(type)?.create?.());
            const cleaned = oie.elementsToArray(imported.elements);
            hydrateChildren(cleaned);
            let choice: 'append' | 'replace' | null = 'replace';
            if (elementsRef.current.length) {
                choice = await new Promise<'append' | 'replace' | null>(resolve => modal({
                    title: `Import ${kind.title}`,
                    body: h('p', `Append the imported ${kind.noun.toLowerCase()}s to the existing ${kind.title.toLowerCase()}, or replace the entire ${kind.title.toLowerCase()}?`),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: 'Cancel', onClick: () => resolve(null) },
                        { label: 'Replace', onClick: () => resolve('replace') },
                        { label: 'Append', primary: true, onClick: () => resolve('append') }
                    ]
                }));
            }
            if (!choice || !active()) return;
            if (choice === 'replace' && !isFilter) {
                for (const side of ['inbound', 'outbound']) {
                    normalizeImportTypes(imported[`${side}Properties`], dataTypeDef(imported[`${side}DataType`])?.defaults(version));
                }
                if (isSourceConnector) {
                    alignDestinationTypes(channel, imported.outboundDataType, type => dataTypeDef(type)?.defaults(version) || { '@version': version });
                    updateImportedAttachmentHandler(channel, imported.inboundDataType);
                }
            }
            if (choice === 'append') {
                elementsRef.current = [...elementsRef.current, ...cleaned];
            } else {
                // Mutate the stable target object used by the message-template panels;
                // replacement imports all transformer settings, including empty templates.
                for (const key of Object.keys(target)) delete target[key];
                Object.assign(target, imported);
                elementsRef.current = cleaned;
            }
            setSelected(elementsRef.current.length ? [0] : null);
            commitRef.current();
            toast(`Imported ${cleaned.length} ${kind.noun.toLowerCase()}${cleaned.length === 1 ? '' : 's'}`);
        } catch (error: any) {
            if (active()) toast(`Import failed: ${error.message}`, 'error');
        } finally {
            importingRef.current = false;
        }
    }

    async function exportElements() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        // Export the SERIALIZED tree (up-to-date properties.children on
        // iterators), not the raw working model — importing a raw export would
        // rebuild iterator children from their stale wire copies.
        try {
            await saveFile(`${channel.name || channel.id}-${kindName}.json`, 'application/json',
                () => JSON.stringify({ ...target, elements: oie.elementsToArray(serializeEditorElements(elementsRef.current)) }, null, 2), assertSession);
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    /* ---- validation ---- */

    // The Swing per-element error wrapper (BaseEditorPane.validateElementRecursive):
    //   Error in connector "<conn>" at [response ]<container> <element> <seq> ("<name>"):
    //   <message>
    function elementError(el: any, message: any) {
        const containerWord = isFilter ? 'filter' : 'transformer';
        const responsePrefix = kindName === 'response' ? 'response ' : '';
        const seq = pathOf(el, elementsRef.current)?.join('-') ?? '';
        return `Error in connector "${connector.name}" at `
            + `${responsePrefix}${containerWord} ${kind.noun.toLowerCase()} ${seq} `
            + `("${elementName(el)}"):\n${message}`;
    }

    // Per-element field validation — the web-admin port of Swing's
    // BaseEditorPane.validateElementRecursive: each type's validate() hook
    // (checkProperties) plus duplicate Iterator index-variable detection across
    // the ancestor stack. Recurses into Iterator children. Collects EVERY
    // offending element (Swing lists them all in one dialog), pre-wrapped.
    function collectFieldErrors(elements = elementsRef.current, idxStack: string[] = []) {
        const out: string[] = [];
        (function walk(list: any) {
            for (const el of list) {
                const def = typeDef(el.__type);
                const msg = def && typeof def.validate === 'function' ? String(def.validate(el) || '').trim() : '';
                if (msg) out.push(elementError(el, msg));
                const conflict = generatedIndexError(el, idxStack);
                if (conflict) out.push(elementError(el, conflict));
                if (isIteratorType(el.__type)) {
                    const iv = el.properties?.indexVariable ?? 'i';
                    if (iv && idxStack.includes(iv)) {
                        out.push(elementError(el, `Duplicate Iterator index variable ${iv} found.`));
                    }
                    idxStack.push(iv);
                    walk(childrenOf(el));
                    idxStack.pop();
                }
            }
        })(elements);
        return out;
    }

    // Swing's blocking "Error(s)" dialog — a modal (not a corner toast) that
    // lists every validation error, matching alertCustomError.
    function showValidationErrors(errors: any) {
        detailModal({
            title: `Error validating ${kind.title.toLowerCase()} ${kind.noun.toLowerCase()}s`,
            badge: { text: 'Error', tone: 'err' },
            sections: [{ text: errors.join('\n\n') }]
        });
    }

    // A custom Builder target can hide its generated initializer. The rest of
    // the loop still has its original control flow and can be syntax checked.
    function scriptForValidation(el: any) {
        const script = generateElementScript(el, childrenOf);
        const incomplete = script === null && isIteratorType(el.__type);
        return { script: incomplete ? generateElementScript(el, childrenOf, 'partialValidation') : script, incomplete };
    }

    // Full validation for "Validate <Kind>" and "Back to Channel". Mirrors Swing
    // BaseEditorPane.validateAll: (a) per-element field checks, then (b) a Rhino
    // syntax check of every element's generated script (engine bridge), covering
    // non-JavaScript steps/rules too.
    // `announce` controls the success/empty toasts (the manual Validate task
    // announces; Back to Channel runs it silently and only surfaces the error).
    async function runValidation(announce: boolean, active = editorSessionActive()) {
        if (!elementsRef.current.length) {
            if (announce) toast(`${kind.title} is empty — nothing to validate`, 'warn');
            return 'ok';
        }
        // (a) Field checks (blank required fields, duplicate iterator index).
        const fieldErrors = collectFieldErrors();
        if (fieldErrors.length) { showValidationErrors(fieldErrors); return 'fail'; }
        // (b) Rhino syntax check of each element's generated script. Iterator
        // children roll into the parent's generated script.
        let unavailable = false;
        for (const el of elementsRef.current) {
            const { script, incomplete } = scriptForValidation(el);
            unavailable ||= incomplete;
            if (script === null) continue;
            const result = await validateScript(script);
            if (!active()) return 'stale';
            if (result.ok === null) { toast(result.message, 'warn'); return 'unavailable'; }
            if (result.ok === false) { showValidationErrors([elementError(el, result.message)]); return 'fail'; }
        }
        if (unavailable) {
            toast(iteratorPreviewUnavailable, 'warn');
            return 'unavailable';
        }
        if (announce) toast(`All ${kind.noun.toLowerCase()}s validated successfully`);
        return 'ok';
    }

    async function validateElements() { await runValidation(true); }

    async function validateElement() {
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const indices = iteratorAncestors(selectedPathRef.current!).map(it => it.properties?.indexVariable ?? 'i');
        const errors = collectFieldErrors([el], indices);
        if (errors.length) { showValidationErrors(errors); return; }
        // (b) Rhino syntax check of its generated script.
        const { script, incomplete } = scriptForValidation(el);
        const active = editorSessionActive();
        if (script !== null) {
            const result = await validateScript(script);
            if (!active()) return;
            if (result.ok === false) { showValidationErrors([elementError(el, result.message)]); return; }
            if (result.ok === null) { toast(result.message, 'warn'); return; }
        }
        if (incomplete) toast(iteratorPreviewUnavailable, 'warn');
        else toast(`${kind.noun} "${elementName(el)}" validated successfully`);
    }

    /* ---- iterator membership (matches the Swing tree-table) ---- */

    // Swing includes the current parent and index conflicts; validation reports
    // duplicate indices after a move. Only the selected subtree is excluded.
    function eligibleIterator(path: number[], source: number[] | null) {
        return !source || (!pathEquals(path, source) && !isAncestorPath(source, path));
    }

    function iteratorAncestors(path: number[]) {
        return path.slice(0, -1).map((_, i) => elementAtPath(elementsRef.current, path.slice(0, i + 1)));
    }

    function generatedIndexError(element: any, indices: string[]) {
        const conflict = indices.find(index => usesGeneratedIteratorIdentifier(element, index));
        return conflict ? `The ${oie.elementTypeLabel(element.__type)} step uses the Iterator index name "${conflict}". Choose a different Iterator or index name.` : '';
    }

    function canPlaceElement(element: any, ancestors: any[]) {
        if (!ancestors.length) return true;
        const indices = ancestors.map(it => it.properties?.indexVariable ?? 'i');
        // Moving an Iterator also brings its children's generated scripts into this scope.
        for (const { el } of flattenRows([element])) {
            const error = generatedIndexError(el, indices);
            if (error) { toast(error, 'warn'); return false; }
        }
        return true;
    }

    function iteratorContext(ancestors: any[]) {
        return JSON.stringify(ancestors.map(({ properties }) =>
            [properties?.target, properties?.indexVariable, properties?.prefixSubstitutions]));
    }

    function canEditElements() {
        return mountedRef.current && store.getState('editingChannel') === channel
            && !store.getState('editorSave') && platform.checkTask('channelEdit', 'doSaveChannel');
    }

    function captureElementEdit() {
        const sessionActive = channelSessionActive();
        return () => sessionActive() && canEditElements();
    }

    function editorSessionActive() {
        const sessionActive = channelSessionActive();
        return () => sessionActive() && mountedRef.current && store.getState('editingChannel') === channel;
    }

    function updateIteratorIndex(iterator: any, index: string): string {
        const path = pathOf(iterator, elementsRef.current);
        if (!canEditElements() || !path || !isIteratorType(iterator.__type) || !iterator.properties) {
            return 'This Iterator can no longer be edited.';
        }
        if (index === (iterator.properties.indexVariable ?? 'i')) return '';
        // A loop's var is hoisted into the engine's enclosing doTransform function.
        if ((!isFilter && ['msg', 'tmp', 'Object', 'JSON', 'toStringResult'].includes(index))
            || (kindName === 'transformer' && ['phase', 'logger', 'Packages'].includes(index))) {
            return 'The engine uses this name in the transformer. Choose a different index name.';
        }
        if (!isIteratorIndexName(index)
            || iteratorAncestors(path).some(el => el.properties?.indexVariable === index)
            || allIteratorPaths(childrenOf(iterator)).some(childPath =>
                elementAtPath(childrenOf(iterator), childPath).properties?.indexVariable === index)) return 'Enter an unused JavaScript variable name.';
        // Transformer steps share doTransform's function scope. Filter rules run in separate functions.
        if (!renameIteratorIndex(iterator, index, isFilter ? [iterator] : elementsRef.current)) {
            return 'Review generated variables, child expressions, and scripts in the same scope. Update references the editor cannot rename or choose a different index name.';
        }
        commitRef.current();
        return '';
    }

    function relocateElement(path: number[], parent: any, { index }: { index?: number } = {}) {
        const elements = elementsRef.current;
        const el = elementAtPath(elements, path);
        const previous = iteratorAncestors(path);
        const parentPath = parent ? pathOf(parent, elements) : null;
        const current = parentPath ? [...iteratorAncestors(parentPath), parent] : [];
        relocateElementIteratorVariables(el, previous, current);
        listAtPath(elements, path).splice(path[path.length - 1], 1);
        const destination = parent ? childrenOf(parent) : elements;
        destination.splice(index ?? destination.length, 0, el);
        const newPath = pathOf(el, elements);
        setSelected(newPath);
        bumpElementContext();
        commitRef.current();
    }

    // A compact equivalent of Swing's iterator wizard: choose an existing
    // iterator or create one from a target prefix, with an optional outbound
    // prefix for Message Builder. No model changes occur before acceptance.
    function chooseIterator(el: any, parent: any, onChoose: (iterator: any, created: boolean) => void) {
        const editActive = captureElementEdit();
        const elements = elementsRef.current;
        const sourcePath = pathOf(el, elements);
        const parentPath = parent ? pathOf(parent, elements) : null;
        const ancestors = sourcePath ? iteratorAncestors(sourcePath)
            : parentPath ? [...iteratorAncestors(parentPath), parent] : [];
        const context = iteratorContext(ancestors);
        const originalInfo = getIteratorInfo(el);
        const wizardTarget = originalInfo.target;
        const ancestorIndices = ancestors.map(it => it.properties?.indexVariable);
        const targetPrefixes = iteratorWizardPrefixes(wizardTarget, ancestorIndices);
        const outboundPrefixes = iteratorWizardPrefixes(originalInfo.outbound || '', ancestorIndices, 'outbound');
        const paths = allIteratorPaths(elements).filter(path => eligibleIterator(path, sourcePath));
        const targets = paths.map(path => elementAtPath(elements, path));
        const descendantIndices = () => allIteratorPaths([el]).map(path => elementAtPath([el], path).properties?.indexVariable);
        const chooseIndex = () => {
            const scope = isFilter ? [el] : sourcePath ? elementsRef.current : [...elementsRef.current, el];
            return validIteratorIndex(ancestorIndices, descendantIndices(), scope);
        };
        const index = chooseIndex();
        const createIterator = (target = '', outbound = '') => {
            const type = isFilter ? ElementType.IteratorRule : ElementType.IteratorStep;
            const iterator = typeDef(type)?.create?.();
            if (!iterator) return false;
            iterator.__type = type;
            iterator.__children = [];
            iterator.properties.indexVariable = index;
            if (target) {
                const prefixes = [target];
                if (outbound) prefixes.push(outbound);
                else if (targetPrefixes.root === 'msg') prefixes.push(`tmp${target.slice(3)}`);
                iterator.properties.target = target;
                iterator.properties.prefixSubstitutions = { string: prefixes };
            }
            onChoose(iterator, true);
            return true;
        };
        if (!targetPrefixes.choices.length && !targets.length) {
            if (!createIterator()) toast('Iterator is not available.', 'error');
            return;
        }
        const choice = h('select', { 'aria-label': 'Iterator' },
            h('option', { value: 'new' }, 'Create New Iterator'),
            targets.map((it, i) => {
                const depth = paths[i].length - 1;
                const indent = depth ? '\u00a0'.repeat(4 + (depth - 1) * 8) + '— ' : '';
                return h('option', { value: String(i) }, indent + (it.name || `Iterator ${i + 1}`));
            })) as HTMLSelectElement;
        const preferred = parent || preferredIterator(wizardTarget, elements, sourcePath ? el : undefined);
        const preferredIndex = targets.indexOf(preferred);
        if (preferredIndex >= 0) choice.value = String(preferredIndex);
        else if (!targetPrefixes.choices.length && targets.length) choice.value = '0';
        const target = h('select', { 'aria-label': 'Iterate On' },
            targetPrefixes.choices.map(({ value }) => h('option', { value }, value))) as HTMLSelectElement;
        const outbound = h('select', { 'aria-label': 'Outbound Prefix' },
            outboundPrefixes.choices.map(({ value }) => h('option', { value }, value))) as HTMLSelectElement;
        const indexInput = h('input', { type: 'text', value: index, readOnly: true, 'aria-label': 'Index Variable' }) as HTMLInputElement;
        if (targetPrefixes.selected) target.value = targetPrefixes.selected.value;
        const substitutions = h('div.mono.break-all', { 'aria-live': 'polite' });
        function updateSubstitutions() {
            const preview = (source: string, prefix: string) => {
                const previewIterator = { properties: { indexVariable: index, prefixSubstitutions: [prefix] } };
                return h('div', source, ' → ', rewriteIteratorExpression(source, [previewIterator], true));
            };
            substitutions.replaceChildren(preview(wizardTarget, target.value));
            if (outbound.value) substitutions.appendChild(preview(originalInfo.outbound || '', outbound.value));
        }
        function syncOutbound() {
            const selected = targetPrefixes.choices.find(prefix => prefix.value === target.value);
            const matching = outboundPrefixes.choices.find(prefix => prefix.index === selected?.index);
            if (matching) outbound.value = matching.value;
            updateSubstitutions();
        }
        syncOutbound();
        target.addEventListener('change', syncOutbound);
        outbound.addEventListener('change', updateSubstitutions);
        const field = (label: string, input: HTMLElement) => h('label.field', label, input);
        const fields = targetPrefixes.choices.length
            ? h('div', field('Iterate On', target), field('Index Variable', indexInput),
                outboundPrefixes.choices.length ? field('Outbound Prefix', outbound) : null,
                h('p', 'Drag-and-drop substitutions'), substitutions)
            : h('p', 'Not enough information available to select iteration target. A new blank Iterator will be added.');
        fields.hidden = choice.value !== 'new';
        const error = h('p.text-danger', { role: 'alert' });
        choice.addEventListener('change', () => { fields.hidden = choice.value !== 'new'; error.textContent = ''; });
        modal({
            title: sourcePath ? 'Assign To Iterator' : 'Select Iterator',
            body: h('div', field('Iterator', choice), fields, error),
            buttons: [
                { label: 'Cancel' },
                { label: 'Use Iterator', primary: true, onClick: () => {
                    if (!editActive()) return;
                    const currentPath = sourcePath ? pathOf(el, elementsRef.current) : null;
                    const currentParentPath = parent ? pathOf(parent, elementsRef.current) : null;
                    const currentAncestors = currentPath ? iteratorAncestors(currentPath)
                        : currentParentPath ? [...iteratorAncestors(currentParentPath), parent] : [];
                    const currentInfo = getIteratorInfo(el);
                    if ((sourcePath && !currentPath) || (parent && !currentParentPath)
                        || currentAncestors.length !== ancestors.length
                        || currentAncestors.some((it: any, i: number) => it !== ancestors[i])
                        || iteratorContext(currentAncestors) !== context
                        || currentInfo.target !== originalInfo.target || currentInfo.outbound !== originalInfo.outbound) {
                        error.textContent = 'The iterator context changed. Close this dialog and try again.';
                        return false;
                    }
                    if (choice.value !== 'new') {
                        const iterator = targets[Number(choice.value)];
                        const destination = pathOf(iterator, elementsRef.current);
                        if (!destination || !isIteratorType(iterator.__type) || !eligibleIterator(destination, currentPath)) {
                            error.textContent = 'The iterator context changed. Close this dialog and try again.';
                            return false;
                        }
                        onChoose(iterator, false); return;
                    }
                    if (chooseIndex() !== index) {
                        error.textContent = 'The iterator context changed. Close this dialog and try again.';
                        return false;
                    }
                    if (!createIterator(target.value, outbound.value)) { error.textContent = 'Iterator is not available.'; return false; }
                } }
            ]
        });
    }

    function assignToIterator() {
        if (!canEditElements()) return;
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        if (!el) { toast(`Select a ${kind.noun.toLowerCase()} first`, 'warn'); return; }
        const path = pathOf(el, elementsRef.current);
        const parent = path.length > 1 ? elementAtPath(elementsRef.current, path.slice(0, -1)) : null;
        const assign = (iterator: any, created: boolean) => {
            if (!canEditElements()) return;
            const sourcePath = pathOf(el, elementsRef.current);
            if (!sourcePath) return;
            const scope = created ? iteratorAncestors(sourcePath) : iteratorAncestors(pathOf(iterator, elementsRef.current));
            if (!canPlaceElement(el, [...scope, iterator])) return;
            if (created) {
                listAtPath(elementsRef.current, sourcePath).splice(sourcePath.at(-1), 0, iterator);
                rewriteElementIteratorVariables(iterator, iteratorAncestors(pathOf(iterator, elementsRef.current)), true);
                iterator.name = iteratorName(iterator);
            }
            relocateElement(created ? pathOf(el, elementsRef.current) : sourcePath, iterator);
        };
        chooseIterator(el, parent, assign);
    }

    function removeFromIterator() {
        const elements = elementsRef.current;
        const selPath = selectedPathRef.current;
        const el = elementAtPath(elements, selPath);
        if (!el || !selPath || selPath.length < 2) {
            toast(`This ${kind.noun.toLowerCase()} is not inside an Iterator`, 'warn'); return;
        }
        if (!canEditElements()) return;
        relocateElement(selPath, elementAtPath(elements, selPath.slice(0, -2)));
    }

    // Elements created from a message-tree node or a tree drop on the grid.
    function addTreeStep(typeId: any, label: any, baseName: any, setup: any, writeSource?: TreeAccessorSource) {
        if (!canEditElements()) return;
        const def = typeDef(typeId);
        if (!def) { toast(`${label} is not available`, 'warn'); return; }
        const el = def.create ? def.create() : { __type: typeId };
        el.__type = typeId;
        el.name = baseName ?? label;
        el.enabled = true;
        setup(el);
        const selected = elementAtPath(elementsRef.current, selectedPathRef.current);
        const parent = selected && isIteratorType(selected.__type) ? selected
            : selectedPathRef.current && selectedPathRef.current.length > 1
                ? elementAtPath(elementsRef.current, selectedPathRef.current.slice(0, -1)) : null;
        const parentPath = parent ? pathOf(parent, elementsRef.current) : null;
        const ancestors = parentPath ? [...iteratorAncestors(parentPath), parent] : [];
        const ancestorState = iteratorContext(ancestors);
        const editActive = captureElementEdit();
        const contextCurrent = () => {
            const currentPath = parent ? pathOf(parent, elementsRef.current) : null;
            const currentAncestors = currentPath ? [...iteratorAncestors(currentPath), parent] : [];
            return editActive() && (!parent || currentPath)
                && currentAncestors.length === ancestors.length && currentAncestors.every((it, i) => it === ancestors[i])
                && iteratorContext(currentAncestors) === ancestorState;
        };
        const preview = structuredClone(el);
        if (parent) rewriteElementIteratorVariables(preview, ancestors, true);
        const insert = (iterator: any, created = false) => {
            if (!contextCurrent()) return;
            if (iterator && !created && (!pathOf(iterator, elementsRef.current) || !isIteratorType(iterator.__type))) return;
            const scope = !iterator ? [] : created ? [...ancestors, iterator]
                : [...iteratorAncestors(pathOf(iterator, elementsRef.current)), iterator];
            if (writeSource && iterator && !treeMessageSegment(writeSource, scope)) return;
            if (typeId === ElementType.Mapper) {
                el.name = el.variable = availableMapperKey(channel, el.variable, elementsRef.current, scope[0]);
            }
            if (!canPlaceElement(el, scope)) return;
            const list = parent ? childrenOf(parent) : elementsRef.current;
            if (created) {
                list.push(iterator);
                const path = pathOf(iterator, elementsRef.current);
                iterator.name = iteratorName(iterator);
                rewriteElementIteratorVariables(iterator, iteratorAncestors(path), true);
            }
            (iterator ? childrenOf(iterator) : list).push(el);
            const path = pathOf(el, elementsRef.current);
            if (path.length > 1) rewriteElementIteratorVariables(el, iteratorAncestors(path), true);
            setSelected(path);
            commitRef.current();
            toast(`Added ${label} "${el.name}"`);
        };
        if (!iteratorExpressionParts(getIteratorInfo(preview).target).length || getPref('filterTransformerShowIteratorDialog') === false) insert(parent);
        else {
            const checkbox = h('input', { type: 'checkbox' }) as HTMLInputElement;
            modal({
                title: 'Select An Option',
                body: h('div', h('p', `Would you like to create a new or choose an existing Iterator for this ${kind.title.toLowerCase()} ${kind.noun.toLowerCase()}?`),
                    h('label', checkbox, 'Do not show this dialog again (may be re-enabled in the Administrator settings)')),
                onClose: () => { if (editActive() && checkbox.checked) setPrefs({ filterTransformerShowIteratorDialog: false }); },
                buttons: [
                    { label: 'Cancel' },
                    { label: 'No', onClick: () => insert(parent) },
                    { label: 'Yes', primary: true, onClick: () => { if (contextCurrent()) chooseIterator(preview, parent, insert); } }
                ]
            });
        }
    }
    const addTreeStepRef = useRef(addTreeStep);
    addTreeStepRef.current = addTreeStep;

    async function backToChannel() {
        // Match the Swing editor: "Back to Channel" runs the same validation as the
        // Validate task and stays put on a blocking error — BaseEditorPane.accept()
        // aborts navigation when validateAll() reports errors. A non-blocking
        // 'unavailable' (engine validate endpoint down) must not trap the user.
        const active = editorSessionActive();
        const result = await runValidation(false, active);
        if ((result !== 'ok' && result !== 'unavailable') || !active()) return;
        persist();    // navigating back is not an edit — don't mark dirty
        router.navigate(`/channels/${channel.id}/edit`);
    }

    /* ---- context menu ---- */

    // With no step selected the menu shows only the container actions; once a
    // step is selected (by clicking a row, or already highlighted) it shows that
    // step's actions. Right-clicking a row selects it first.
    function showStepMenu(e: any, path: any) {
        e.preventDefault();
        if (path && !pathEquals(path, selectedPathRef.current)) selectElement(path);
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        const onStep = !!el;
        const t = kind.title, n = kind.noun;
        // Mutations ride channelEdit/doSaveChannel (same tagging as the task pane).
        const gate = { task: 'doSaveChannel', group: 'channelEdit' };
        const items: any[] = [{ label: `Add New ${n}`, icon: 'plus', ...gate, onClick: addElement }];
        if (onStep) {
            items.push({ label: `Delete ${n}`, icon: 'trash', danger: true, ...gate, onClick: deleteElement });
            items.push({ label: 'Assign To Iterator', ...gate, onClick: assignToIterator });
            if (selectedPathRef.current!.length! > 1) {
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

    function gridContextMenu(e: any) {
        const tr = e.target.closest && e.target.closest('tr[data-path]');
        showStepMenu(e, tr ? tr.dataset.path.split('.').map(Number) : null);
    }

    /* ---- task surface (read by the routed task pane / wizard toolbar) ---- */

    function taskState() {
        const el = elementAtPath(elementsRef.current, selectedPathRef.current);
        const onStep = !!el;
        return {
            onStep,
            assign: onStep,
            remove: !!(onStep && selectedPathRef.current && selectedPathRef.current.length > 1),
            dirty: channelDirty()
        };
    }

    const onAccessorDragOver = useMemo(() => makeAccessorDragOver(dragRef), []);
    const onAccessorDrop = makeAccessorDrop(dragRef, canEditElements);

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
    const sideWrapRef = useRef<any>(null);
    const sideHostRef = useRef<any>(null);
    const sidePlaceholderRef = useRef<any>(null);

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
            target: isFilter ? connector.transformer : target, version, connectorType, channel,
            dragRef,
            treeAccessor: (source: TreeAccessorSource, event: DragEvent) => {
                const segment = event.target instanceof Element && event.target.closest('[data-message-segment]');
                const raw = source.accessor.replace(/\.toString\(\)$/, '');
                const ancestors = iteratorAncestors(selectedPathRef.current || []);
                if (segment) return treeMessageSegment(source, ancestors);
                return rewriteIteratorExpression(treeDragModifier(event) ? raw : source.accessor, ancestors, true);
            },
            referenceRefreshRef,
            // Swing lists keys from the whole filter. Transformer outputs depend on the selected step.
            getVariables: () => collectStepVariables(elementsRef.current, isFilter ? null : selectedPathRef.current),
            canEdit: canEditElements,
            commit: () => commitRef.current(),
            onAddStep: (...args: Parameters<typeof addTreeStep>) => addTreeStepRef.current(...args),
            // The panel's collapse flag, mirrored onto the wrapper the MAIN tree
            // renders: .side-collapsed squeezes the fixed width down to the strip
            // (its splitter hides via CSS :has — nothing left to drag). Class
            // toggling is safe against re-renders: React never rewrites a
            // className it did not change.
            onSideCollapsed: (c: any) => {
                const wrap = sideWrapRef.current;
                if (wrap) wrap.classList.toggle('side-collapsed', c);
            }
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
       list — and move it back when the view closes. The overlay resolves
       tree/reference drags through the same callback as the main editor. */
    useEffect(() => {
        if (missingConnector) return undefined;
        const onCodeView = (e: any) => {
            const d = e.detail || {};
            const rootEl = rootRef.current;
            const host = sideHostRef.current;
            if (d.open && d.origin && rootEl && rootEl.contains(d.origin) && !sidePlaceholderRef.current && host) {
                const fallback = d.getDropText;
                d.getDropText = (event: DragEvent) => {
                    if (!canEditElements()) return '';
                    return dragRef.current ? dragRef.current.getText(event) : fallback(event);
                };
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
                    <div className="split-a element-list-pane flex-none p-[13px] pb-2" data-editor-overtake="">
                        {/* Fills the pane so right-clicking anywhere in the step
                            area (not just on a row) opens the context menu. */}
                        <div className="min-h-full panel overflow-auto" onContextMenu={gridContextMenu}
                            onDragOver={e => {
                                if (!dragRef.current?.addToGrid || !canEditElements()) return;
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = 'copy';
                            }}
                            onDrop={e => {
                                const addToGrid = dragRef.current?.addToGrid;
                                if (!addToGrid) return;
                                e.preventDefault();
                                e.stopPropagation();
                                dragRef.current = null;
                                if (canEditElements()) addToGrid(e.nativeEvent);
                            }}>
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
                                    contextRevision={elementContextRevision}
                                    headerIndex={selectedPath?.join('-')}
                                    settlingRef={settlingRef}
                                    onChange={() => commitRef.current()}
                                    onRenameIteratorIndex={updateIteratorIndex}
                                    onReplaceElement={(parsed: any) => {
                                        const selPath = selectedPathRef.current;
                                        const list = listAtPath(elementsRef.current, selPath);
                                        if (list) { list[selPath![selPath!.length! - 1]] = parsed; commitRef.current(); }
                                    }}
                                    destinations={stepDestinations} />
                            },
                            {
                                label: 'Generated Script',
                                className: 'h-full flex-col min-h-0 py-3 px-3.5',
                                node: <GeneratedScriptPane kind={kind} element={selectedElement} rev={rev} />
                            }
                        ]} />
                    </div>
                </div>
                <div className="split-handle" data-orient="h" data-resize="next" />
                {/* Wide enough to show the full tab bar (Reference / Message Trees /
                    Message Templates) without horizontal scrolling. The side panel
                    root mounts into an unmanaged child of this wrapper. */}
                <div className="split-b flex-none w-[414px] flex flex-col min-h-0 border-l border-line" ref={sideWrapRef} />
            </div>
        </div>
    );
}

/* ---- the routed view ---------------------------------------------------------- */

// One component serves all three routes; these bind the kind so the shell's route
// table can name a component per route without building wrappers of its own.
export function FilterView(props: any) { return <FilterTransformerView {...props} kindName="filter" />; }
export function TransformerView(props: any) { return <FilterTransformerView {...props} kindName="transformer" />; }
export function ResponseTransformerView(props: any) { return <FilterTransformerView {...props} kindName="response" />; }

function FilterTransformerView({ params, kindName }: any) {
    const [, forceRender] = useReducer((x: any) => x + 1, 0);
    // The channel travels through the store (seeded by the channel editor). When a
    // user deep-links straight to a sub-editor route the store is empty, so the
    // channel is fetched before the body builds. `ready` flips once the channel
    // is available; null means still loading.
    const [ready, setReady] = useState(() => {
        const c = store.getState('editingChannel');
        return c && c.id === params.channelId ? true : null;
    });
    const apiRef = useRef<any>(null);

    // The wizard publishes its own context; only routed sub-editors publish here.
    const channel = ready ? store.getState('editingChannel') : null;
    const persistedChannel = channel && channel.id === params.channelId
        && !isNewChannelDraft(channel);
    usePaletteContext({
        kind: 'channel', surface: 'connector',
        channelIds: persistedChannel ? [channel.id] : [],
        channels: persistedChannel ? [channel] : [],
        librarySelection: channel ? channelDependencyState(channel).libraries.current?.checked : undefined
    });

    // Deep-link entry (no in-store channel): fetch it, then build.
    useEffect(() => {
        if (ready) return undefined;
        let alive = true;
        loadChannelForEdit(params.channelId).then((loaded: any) => {
            if (!alive) return;
            // Same as the channel editor: an unknown id resolves with an empty body
            // rather than rejecting, so an unchecked load builds on nothing.
            if (!loaded || !loaded.id) {
                toast(`Channel ${params.channelId} was not found.`, 'error');
                setReady(false);
                return;
            }
            store.setState('editingChannel', loaded);
            store.setState('editingChannelNew', false);
            setReady(true);
        }).catch((e: any) => {
            if (!alive) return;
            toast(`Load failed: ${loadErrorMessage(e, 'channel', 'channels')}`, 'error');
            history.replaceState(null, '', routeUrl('/channels'));
            router.navigate('/channels');
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const ctx = apiRef.current;
    const kind = (KINDS as any)[kindName];
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
                            onDragOver={(e: any) => apiRef.current && apiRef.current.onAccessorDragOver(e)}
                            onDrop={(e: any) => apiRef.current && apiRef.current.onAccessorDrop(e)}>
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
export function createEmbeddedEditor(params: any, kindName: any, onTasksChange: any) {
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
    const call = (name: any) => (...args: any[]) => {
        const ctx = apiRef.current;
        return ctx && (ctx as any).handlers[name] && (ctx as any).handlers[name](...args);
    };
    return {
        el: host,
        taskState: () => (apiRef.current ? (apiRef.current as any).taskState()
            : { onStep: false, assign: false, remove: false, dirty: false }),
        handlers: {
            addElement: call('addElement'), deleteElement: call('deleteElement'),
            assignToIterator: call('assignToIterator'), removeFromIterator: call('removeFromIterator'),
            importElements: call('importElements'), exportElements: call('exportElements'),
            validateElements: call('validateElements'), validateElement: call('validateElement'),
            saveChannel: call('saveChannel'), backToChannel: call('backToChannel')
        },
        onAccessorDragOver: (e: any) => apiRef.current && (apiRef.current as any).onAccessorDragOver(e),
        onAccessorDrop: (e: any) => apiRef.current && (apiRef.current as any).onAccessorDrop(e),
        teardown: () => { try { teardownRoot(); } catch { /* ignore */ } }
    };
}
