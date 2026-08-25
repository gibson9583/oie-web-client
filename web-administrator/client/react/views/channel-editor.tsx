/*
 * Channel editor — parity with the Swing Administrator's channel setup pane,
 * declarative React. One mutable channel object is shared by every tab; all
 * edits mutate it in place so the XStream round-trip (GET → mutate → PUT)
 * preserves '@class', '@version' and any properties contributed by server-side
 * plugins. The model object stays a mutable ref (NOT cloned into immutable
 * React state) — @class/@version/pluginProperties and the filter/transformer
 * sub-editor handoff depend on it. A `rev` bump repaints; actions resolve
 * their targets at execution time through ref mirrors.
 *
 * The channel travels through the store ('editingChannel') when navigating to
 * the filter/transformer editors so unsaved edits survive the round trip.
 * Dirty is the explicit 'editingChannelDirty' store flag, NOT object identity.
 * The navGuard blocks navigation when a Save fails (validation, name check,
 * declined overwrite) — the working copy is cleared only on allow.
 *
 * Tabs render one-at-a-time, keyed by activation, matching the legacy
 * rebuild-per-switch (destination selection and the Scripts script choice
 * reset on switch — Swing parity). Imperative islands behind documented ref
 * bridges: the connector settings panels + connector-properties plugin panels
 * (mountReact per connector/transport), the destinations DataTable, and the
 * Scripts-tab code editor. The sub-modals (Set Data Types, Set Dependencies,
 * Advanced Queue Settings, Attachment Handler, Debug Deploy) stay imperative
 * modal() functions — they depend on the await/false-keeps-open button
 * contract and (Set Data Types) on mutate-in-place drafts with dirty-marking
 * deferred to OK.
 *
 * register(platform) also registers the filter/transformer/response sub-editor
 * routes (registerFilterTransformer), since they share the in-store editingChannel.
 */

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { h, clear, field, textInput, numberInput, select, checkbox, taskButton, toast, confirmDialog, promptDialog, modal, errorModal, DataTable, saveFile, pickFile, fmtDate, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { createCodeEditor } from '@oie/web-ui';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { validateScript } from '../../core/serialize.js';
import { setActiveScope, clearActiveScope } from '../../core/script-completions.js';
import { getPref } from '../../core/prefs.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';
import { saveLibraryAssociations } from './code-template-xml.js';
import { platform } from '@oie/web-shell';
import { ViewTasks, mountReact } from '../mount.jsx';
import { DomTabs } from '../dom-tabs.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, TaskButton, useSideCollapse, CollapsedSideStrip, SideCollapseButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { readChannelDependencies, saveChannelDependencyEdits, submitDeployment, withDependencies } from './channel-lifecycle.js';

const INITIAL_STATES = ['STARTED', 'PAUSED', 'STOPPED'];

/* New channel tags get a random pleasant color, like the Swing client. */
function randomTagColor() {
    const hue = Math.floor(Math.random() * 360), s = 0.55, l = 0.6;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { red: Math.round((r + m) * 255), green: Math.round((g + m) * 255), blue: Math.round((b + m) * 255), alpha: 255 };
}

/* ChannelTag backgroundColor → a chip background rgba, matching channels.js. */
function tagChipBg(color: any) {
    return (color && color.red !== undefined)
        ? `rgba(${color.red}, ${color.green}, ${color.blue}, 0.26)` : 'var(--bg3)';
}

/* AttachmentHandlerType strings/classes from com.mirth.connect.model.attachments */
const ATTACHMENT_TYPES = [
    { value: 'None', label: 'None', className: null },
    { value: 'Entire Message', label: 'Entire Message', className: 'com.mirth.connect.server.attachments.identity.IdentityAttachmentHandlerProvider' },
    { value: 'Regex', label: 'Regex', className: 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider' },
    { value: 'DICOM', label: 'DICOM', className: 'com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider' },
    { value: 'JavaScript', label: 'JavaScript', className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider' }
];

const META_COLUMN_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'];

const DEFAULT_ATTACHMENT_SCRIPT = '// Modify the message variable below to create attachments\nreturn message;';

/* Classic Administrator "Destination Mappings" velocity variables — canonical list
   lives in core/mappings.js (shared with the wizard rail and the code-view vars). */
export { DESTINATION_MAPPINGS } from '../../core/mappings.js';
import { DESTINATION_MAPPINGS, SCRIPT_REFERENCE } from '../../core/mappings.js';

/* Summary text shown next to the Advanced Queue Settings button, replicating
   the Swing DestinationSettingsPanel.updateAdvancedSettingsLabel(). */
function advancedQueueSummary(dcp: any) {
    const parts: any[] = [];
    const queueEnabled = !!dcp.queueEnabled;
    const sendFirst = queueEnabled && !!dcp.sendFirst;
    const retryCount = Number(dcp.retryCount) || 0;
    const interval = Number(dcp.retryIntervalMillis) || 0;
    const threads = Number(dcp.threadCount) || 1;
    const retries = `${retryCount} ${retryCount === 1 ? 'Retry' : 'Retries'}`;
    if (!queueEnabled) {
        parts.push(retries);
        if (retryCount > 0) parts.push(`Interval ${interval} ms`);
    } else {
        if (dcp.regenerateTemplate) parts.push('Regenerate');
        if (dcp.rotate) parts.push('Rotate');
        if (dcp.includeFilterTransformer) parts.push('Including Transformer');
        if (sendFirst) parts.push(retries);
        parts.push(`Interval ${interval} ms`);
        if (threads > 1) {
            parts.push(`${threads} Threads`);
            if (dcp.threadAssignmentVariable) parts.push(`Group By ${dcp.threadAssignmentVariable}`);
        }
    }
    return parts.join(' / ');
}

/* ---- XStream Properties map: { entry: [{ string: [key, value] }] } ----------- */

function entriesToObj(map: any) {
    const obj: any = {};
    if (!map || typeof map !== 'object') return obj;
    for (const entry of api.asList(map.entry)) {
        const pair = api.asList(entry && entry.string);
        if (!pair.length) continue;
        obj[String(pair[0])] = pair.length > 1 ? pair[1] : '';
    }
    return obj;
}

function objToEntries(obj: any) {
    const entries = Object.entries(obj).map(([key, value]) => ({ string: [key, String(value ?? '')] }));
    return entries.length ? { entry: entries } : null;
}


// Count the filter rules / transformer steps on a connector so the task
// buttons can show a "(n)" indicator (Swing shows none; this surfaces that a
// connector has steps without opening it). Returns 0 for a missing connector.
function stepCount(connector: any, key: any) {
    const el = connector && connector[key];
    return el ? oie.elementsToArray(el.elements).length : 0;
}
const withCount = (label: any, n: any) => n > 0 ? `${label} (${n})` : label;

/* Leaving the editor with unsaved changes asks Save / Don't Save / Cancel
   (classic behavior). Every dismissal path (Esc/backdrop/X) resolves 'cancel'
   and blocks navigation. Users whose role can't save (channelEdit/doSaveChannel
   denied) must not be offered a Save that the server would reject — they get an
   OK-only notice instead. */
function promptSaveChanges(channel: any) {
    return new Promise((resolve: any) => {
        if (!platform.checkTask('channelEdit', 'doSaveChannel')) {
            modal({
                title: 'Unsaved Changes',
                body: h('div', `You don't have permission to save changes to "${channel.name || 'this channel'}". Your changes will be discarded.`),
                onClose: () => resolve('cancel'),
                buttons: [{ label: 'OK', primary: true, onClick: () => { resolve('discard'); } }]
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

/* ---- attachment handler properties modal (imperative, per handler type) ------- */

function openAttachmentPropsModal(ap: any, markDirty: any) {
    /* Two-column key-indexed table (regex patterns / replacements). Rows are
       re-indexed on every commit, mirroring the Swing RegexAttachmentDialog
       which clears the map and rewrites keyA0/keyB0, keyA1/keyB1, ... */
    function pairTable(title: any, rows: any, colA: any, colB: any, commit: any, hint: any) {
        const host = h('div');
        function renderRows() {
            clear(host);
            const grid = h('div', { class: 'grid grid-cols-[minmax(160px,2fr)_minmax(120px,1fr)_70px] gap-y-1 gap-x-1.5 items-center' },
                h('label', colA), h('label', colB), h('span'));
            for (const row of rows) {
                grid.appendChild(textInput(row.a, {
                    spellcheck: 'false',
                    onInput: (e: any) => { row.a = e.target.value; commit(); }
                }));
                grid.appendChild(textInput(row.b, {
                    spellcheck: 'false',
                    onInput: (e: any) => { row.b = e.target.value; commit(); }
                }));
                grid.appendChild(h('button.btn.btn-sm', {
                    title: 'Remove row',
                    onClick: () => { rows.splice(rows.indexOf(row), 1); commit(); renderRows(); }
                }, 'Delete'));
            }
            if (!rows.length) grid.appendChild(h('div.text-text-faint', { class: 'col-[1/-1]' }, 'No entries'));
            host.appendChild(grid);
        }
        renderRows();
        const addBtn = h('button.btn.btn-sm', {
            onClick: () => { rows.push({ a: '', b: '' }); commit(); renderRows(); }
        }, 'New');
        return h('div.field',
            h('div', { class: 'flex items-center justify-between gap-2.5' },
                h('label', { class: 'm-0' }, title), addBtn),
            host,
            hint ? h('div.hint', hint) : null);
    }

    /* Classic RegexAttachmentDialog: patterns (regex.pattern0/regex.mimetype0,
       regex.pattern1/...; the legacy non-indexed regex.pattern/regex.mimetype
       pair is also honored) plus inbound (regex.replaceKey0/regex.replaceValue0)
       and outbound (outbound.regex.replaceKey0/outbound.regex.replaceValue0)
       replacement tables — key schemes verified against
       RegexAttachmentHandlerProvider.setProperties(). */
    function renderRegexEditor() {
        const map = entriesToObj(ap.properties);
        const consumed = new Set();
        const take = (key: any) => { consumed.add(key); return String(map[key] ?? ''); };
        const collect = (keyA: any, keyB: any) => {
            const rows: any[] = [];
            for (let i = 0; map[`${keyA}${i}`] !== undefined; i++) {
                rows.push({ a: take(`${keyA}${i}`), b: take(`${keyB}${i}`) });
            }
            return rows;
        };
        const patterns: any[] = [];
        if (map['regex.pattern'] !== undefined) {
            patterns.push({ a: take('regex.pattern'), b: take('regex.mimetype') });
        }
        patterns.push(...collect('regex.pattern', 'regex.mimetype'));
        const inbound = collect('regex.replaceKey', 'regex.replaceValue');
        const outbound = collect('outbound.regex.replaceKey', 'outbound.regex.replaceValue');
        // Keys outside the regex schemes survive the rewrite untouched.
        const extras: any = {};
        for (const [k, v] of Object.entries(map)) if (!consumed.has(k)) extras[k] = v;

        function commit() {
            const next = { ...extras };
            patterns.forEach((r: any, i: any) => { next[`regex.pattern${i}`] = r.a; next[`regex.mimetype${i}`] = r.b; });
            inbound.forEach((r: any, i: any) => { next[`regex.replaceKey${i}`] = r.a; next[`regex.replaceValue${i}`] = r.b; });
            outbound.forEach((r: any, i: any) => { next[`outbound.regex.replaceKey${i}`] = r.a; next[`outbound.regex.replaceValue${i}`] = r.b; });
            ap.properties = objToEntries(next);
            markDirty();
        }

        return h('div',
            pairTable('Regular Expressions', patterns, 'Regular Expression', 'MIME Type', commit,
                'Capturing group 1 of each expression is extracted as an attachment; a blank MIME type defaults to text/plain.'),
            pairTable('Inbound Replacements', inbound, 'Replace All', 'Replace With', commit,
                'Applied to attachment content as it is extracted. Java string escape sequences (\\n, \\t, …) are unescaped by the server.'),
            pairTable('Outbound Replacements', outbound, 'Replace All', 'Replace With', commit,
                'Applied when attachments are re-attached to outbound messages.'));
    }

    /* IdentityAttachmentHandlerProvider reads a single identity.mimetype key. */
    function renderIdentityEditor() {
        const map = entriesToObj(ap.properties);
        return field('Attachment MIME Type', textInput(String(map['identity.mimetype'] ?? ''), {
            class: 'max-w-[234px]',
            placeholder: 'text/plain',
            onInput: (e: any) => {
                map['identity.mimetype'] = e.target.value;
                ap.properties = objToEntries(map);
                markDirty();
            }
        }), 'The entire message is stored as a single attachment with this MIME type.');
    }

    /* Unknown plugin handler types: raw key/value map editor (classic
       CustomAttachmentDialog behavior). */
    function renderCustomEditor() {
        const map = entriesToObj(ap.properties);
        const rows = Object.entries(map).map(([k, v]) => ({ a: k, b: String(v ?? '') }));
        function commit() {
            const next: any = {};
            for (const row of rows) if (row.a !== '') next[row.a] = row.b;
            ap.properties = objToEntries(next);
            markDirty();
        }
        return pairTable('Attachment Handler Properties', rows, 'Property', 'Value', commit,
            `Raw property map for the "${ap.type}" attachment handler.`);
    }

    // Editor body per handler type. Returns { body, editor } so the modal can
    // dispose a code editor on close.
    function attachmentEditor() {
        if (ap.type === 'JavaScript') {
            const map = entriesToObj(ap.properties);
            if (map['javascript.script'] === undefined) map['javascript.script'] = DEFAULT_ATTACHMENT_SCRIPT;
            const editor = createCodeEditor({
                value: String(map['javascript.script'] ?? ''),
                minHeight: '240px',
                onChange: (value: any) => {
                    map['javascript.script'] = value;      // unknown keys in `map` survive
                    ap.properties = objToEntries(map);
                    markDirty();
                }
            });
            return { body: field('Attachment Script', editor.el), editor };
        }
        if (ap.type === 'Regex') return { body: renderRegexEditor() };
        if (ap.type === 'Entire Message') return { body: renderIdentityEditor() };
        if (ap.type && ap.type !== 'None' && ap.type !== 'DICOM' &&
            !ATTACHMENT_TYPES.some(t => t.value === ap.type)) return { body: renderCustomEditor() };
        return { body: h('div.text-text-faint', 'This attachment handler has no configurable properties.') };
    }

    const { body, editor } = attachmentEditor();
    modal({
        title: 'Set Attachment Handler',
        body,
        buttons: [{ label: 'Close', primary: true }],
        // Dispose the code editor (when present) on any close path; guarded
        // because the plain-textarea baseline has no dispose().
        onClose: () => { try { editor && editor.dispose && editor.dispose(); } catch { /* baseline no-op */ } }
    });
}

/* ---- Set Data Types modal ----------------------------------------------------
 * Mirror of the Swing DataTypesDialog: a connector table (source + each
 * destination) with inbound/outbound type selects, and grouped property
 * panels for the selected row. All edits go to deep-copied drafts and are
 * committed back onto the transformers on OK; Cancel/Escape discards. The
 * registered data-type editors MUTATE the shared draft objects in place (no
 * onChange wired — dirty-marking is deferred to the OK commit).
 */

function openDataTypesModal(channel: any, version: any, markDirty: any) {
    const clone = (obj: any) => obj == null ? null : JSON.parse(JSON.stringify(obj));
    const dtOptions = dataTypeList().map(dt => ({ value: dt.name, label: dt.label }));

    channel.sourceConnector.transformer =
        channel.sourceConnector.transformer || oie.emptyTransformer(version);
    const rows = [{ label: 'Source Connector', transformer: channel.sourceConnector.transformer }];
    for (const dest of oie.destinationsOf(channel)) {
        dest.transformer = dest.transformer || oie.emptyTransformer(version);
        rows.push({ label: dest.name || `Destination ${dest.metaDataId}`, transformer: dest.transformer });
    }
    for (const row of rows) {
        (row as any).draft = {
            inboundDataType: row.transformer.inboundDataType || 'RAW',
            outboundDataType: row.transformer.outboundDataType || 'RAW',
            inboundProperties: clone(row.transformer.inboundProperties),
            outboundProperties: clone(row.transformer.outboundProperties)
        };
    }

    let selected = rows[0];
    const dtLabelOf = (name: any) => (dtOptions.find(o => o.value === name) || { label: name }).label;

    // Bulk Edit (Swing DataTypesDialog "Bulk Edit" radio): check connectors,
    // pick one inbound/outbound data type in the shared panels, and apply to
    // all checked connectors at once. `bulkRow` is the shared draft the panels
    // edit; `bulkSel` is the set of target rows.
    let bulkMode = false;
    const bulkSel = new Set(rows);
    const applySides = { inbound: true, outbound: true };
    const bulkRow = {
        label: 'Selected connectors',
        draft: {
            inboundDataType: (rows[0] as any).draft.inboundDataType,
            outboundDataType: (rows[0] as any).draft.outboundDataType,
            inboundProperties: clone((rows[0] as any).draft.inboundProperties),
            outboundProperties: clone((rows[0] as any).draft.outboundProperties)
        }
    };

    const tableHost = h('div');
    const panelsHost = h('div', {
        class: 'grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-3.5 mt-3.5 items-start'
    });
    // Teardowns for the mounted <DataTypePropertiesEditor> React roots;
    // unmounted on each rebuild (renderPanels) and on dialog close.
    const dtEditorRoots: any[] = [];
    const clearDtEditors = () => { dtEditorRoots.forEach(t => { try { t(); } catch { /* ignore */ } }); dtEditorRoots.length = 0; };

    function setType(row: any, side: any, name: any) {
        if (row.draft[`${side}DataType`] === name) return;
        const def = dataTypeDef(name);
        const freshProps = () => def ? def.defaults(version) : { '@version': version };
        row.draft[`${side}DataType`] = name;
        row.draft[`${side}Properties`] = freshProps();
        // Swing DataTypesDialog.updateSingleDataType: a destination's inbound
        // data type IS the source's outbound, so changing the SOURCE outbound
        // type also sets every destination's inbound type + default properties.
        if (side === 'outbound' && row === rows[0]) {
            for (let i = 1; i < rows.length; i++) {
                (rows[i] as any).draft.inboundDataType = name;
                (rows[i] as any).draft.inboundProperties = freshProps();
            }
        }
        renderAll();
    }

    /* ---- connector table ---- */

    function typeCell(row: any, side: any) {
        const sel = select(dtOptions, row.draft[`${side}DataType`], {
            onChange: (e: any) => { selected = row; setType(row, side, e.target.value); }
        });
        sel.addEventListener('click', (e: any) => e.stopPropagation());
        return sel;
    }

    function renderTable() {
        clear(tableHost);
        const tbody = h('tbody');
        for (const row of rows) {
            if (bulkMode) {
                // Checkbox to include this connector; type columns are read-only here.
                const cb = checkbox('', bulkSel.has(row), {
                    onChange: (e: any) => { e.target.checked ? bulkSel.add(row) : bulkSel.delete(row); }
                });
                tbody.appendChild(h('tr',
                    h('td', { class: 'w-[32px]' }, cb.el),
                    h('td', row.label),
                    h('td.text-text-faint', dtLabelOf((row as any).draft.inboundDataType)),
                    h('td.text-text-faint', dtLabelOf((row as any).draft.outboundDataType))));
            } else {
                const tr = h('tr', { class: row === selected ? 'selected cursor-pointer' : 'cursor-pointer' },
                    h('td', row.label),
                    h('td', typeCell(row, 'inbound')),
                    h('td', typeCell(row, 'outbound')));
                tr.addEventListener('click', () => {
                    if (selected !== row) { selected = row; renderAll(); }
                });
                tbody.appendChild(tr);
            }
        }
        const headCells = [
            h('th', { class: 'w-[40%]' }, 'Connector'),
            h('th', 'Inbound'), h('th', 'Outbound')
        ];
        if (bulkMode) headCells.unshift(h('th', ''));
        tableHost.appendChild(h('table.dt', h('thead', h('tr', headCells)), tbody));
    }

    function buildPanel(side: any, title: any, row = selected) {
        const typeName = (row as any).draft[`${side}DataType`];
        const def = dataTypeDef(typeName);
        if (def && (!(row as any).draft[`${side}Properties`] || typeof (row as any).draft[`${side}Properties`] !== 'object')) {
            (row as any).draft[`${side}Properties`] = def.defaults(version);
        }

        const restoreBtn = h('button.btn.btn-sm', {
            disabled: !def,
            title: 'Reset every property of this data type to its default value',
            onClick: () => {
                (row as any).draft[`${side}Properties`] = def!.defaults!(version);
                renderAll();
            }
        }, 'Restore Defaults');

        const head = h('div', { class: 'flex items-end gap-2.5 mb-1' },
            field('Data Type', select(dtOptions, typeName, {
                onChange: (e: any) => setType(row, side, e.target.value)
            })),
            h('div', { class: 'pb-3' }, restoreBtn));

        const editorHost = h('div');
        dtEditorRoots.push(mountReact(editorHost, <DataTypePropertiesEditor
            typeName={typeName}
            props={(row as any).draft[`${side}Properties`]}
            version={version}
            direction={side}
            connectorType={row.label === 'Source Connector' ? 'SOURCE' : 'DESTINATION'}
            onReplace={(obj: any) => { (row as any).draft[`${side}Properties`] = obj; }} />));
        return h('div.panel', { class: 'mt-0' },
            h('div.panel-header', `${title} — ${row.label}`),
            h('div.panel-body', head, editorHost));
    }

    function renderPanels() {
        clearDtEditors();
        clear(panelsHost);
        if (bulkMode) {
            // Side toggles + an explicit apply button operating on the bulk draft.
            const sideToggle = (side: any, lbl: any) => checkbox(lbl, (applySides as any)[side], {
                onChange: (e: any) => { (applySides as any)[side] = e.target.checked; }
            }).el;
            const applyBtn = h('button.btn.btn-primary', {
                onClick: () => {
                    const targets = rows.filter(r => bulkSel.has(r));
                    if (!targets.length) { toast('Select at least one connector', 'warn'); return; }
                    if (!applySides.inbound && !applySides.outbound) { toast('Choose Inbound and/or Outbound to apply', 'warn'); return; }
                    for (const r of targets) {
                        if (applySides.inbound) {
                            (r as any).draft.inboundDataType = bulkRow.draft.inboundDataType;
                            (r as any).draft.inboundProperties = clone(bulkRow.draft.inboundProperties);
                        }
                        if (applySides.outbound) {
                            (r as any).draft.outboundDataType = bulkRow.draft.outboundDataType;
                            (r as any).draft.outboundProperties = clone(bulkRow.draft.outboundProperties);
                        }
                    }
                    toast(`Applied to ${targets.length} connector${targets.length === 1 ? '' : 's'}`);
                    renderAll();
                }
            }, 'Apply to Selected Connectors');
            panelsHost.appendChild(h('div', { class: 'col-[1/-1] flex gap-4 items-center' },
                h('span.text-text-faint', { class: 'text-[10px] uppercase tracking-[0.08em]' }, 'Apply:'),
                sideToggle('inbound', 'Inbound'), sideToggle('outbound', 'Outbound'), applyBtn));
            panelsHost.appendChild(buildPanel('inbound', 'Inbound Properties', bulkRow as any));
            panelsHost.appendChild(buildPanel('outbound', 'Outbound Properties', bulkRow as any));
        } else {
            panelsHost.appendChild(buildPanel('inbound', 'Inbound Properties'));
            panelsHost.appendChild(buildPanel('outbound', 'Outbound Properties'));
        }
    }

    const editModeName = 'dt-edit-mode';
    function modeRadio(label: any, isBulk: any) {
        const input = h('input', { type: 'radio', name: editModeName, checked: bulkMode === isBulk,
            onChange: () => { if ((input as any).checked) { bulkMode = isBulk; renderAll(); } } });
        return h('label.check', input, label);
    }
    const modeBar = h('div', { class: 'flex gap-[16px] items-center mb-2.5' },
        h('span.text-text-faint', { class: 'text-[10px] uppercase tracking-[0.08em]' }, 'Editing:'),
        modeRadio('Single Edit', false),
        modeRadio('Bulk Edit', true));

    function renderAll() { renderTable(); renderPanels(); }
    renderAll();

    modal({
        title: 'Set Data Types',
        size: 'xwide',
        onClose: clearDtEditors,
        body: h('div',
            modeBar,
            h('div.panel', { class: 'mt-0' }, h('div.panel-body.flush', tableHost)),
            panelsHost,
            h('div.hint', { class: 'mt-2.5' },
                'All property groups are shown for each data type; the engine ignores groups that do not apply to a side (e.g. response generation on an outbound type).')),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: () => {
                    for (const row of rows) Object.assign(row.transformer, (row as any).draft);
                    markDirty();
                }
            }
        ]
    });
}

/* ---- Set Dependencies modal ---------------------------------------------------
 * Mirror of the Swing ChannelDependenciesDialog (Channel Dependencies):
 * three tabs — Code Template Libraries, Library Resources, Deploy/Start
 * Dependencies. Apply semantics match the classic dialog: on OK the
 * dependency set and any code template library changes are PUT to the
 * server immediately, while the resource selection only mutates the
 * in-memory channel (channel.properties.resourceIds) and is persisted by
 * Save Changes.
 *
 * ChannelDependency (com.mirth.connect.model.ChannelDependency) holds
 * { dependentId, dependencyId }: the dependent channel deploys/starts
 * after the dependency channel.
 */

async function openDependenciesModal(channel: any, version: any, markDirty: any) {
    const idSet = (value: any) => api.asList(value, 'string').map(String);
    const props = channel.properties = channel.properties || {};

    let idsAndNames: any, deps: any, libraries: any, resourcesRaw: any;
    try {
        [idsAndNames, deps, libraries, resourcesRaw] = await Promise.all([
            api.channels.idsAndNames(),
            readChannelDependencies(),
            api.codeTemplates.libraries(true),
            api.server.resources()
        ]);
    } catch (e: any) {
        toast(`Could not load dependencies: ${e.message}`, 'error');
        return;
    }

    /* ---- shared link/tree helpers ---- */

    const link = (label: any, onClick: any) => {
        const a = h('a', { href: '#', class: 'text-accent underline cursor-pointer text-[11px] whitespace-nowrap' }, label);
        a.addEventListener('click', (e: any) => { e.preventDefault(); onClick(); });
        return a;
    };
    const linkSep = () => h('span.text-text-faint', { class: 'text-[11px]' }, '|');
    const treeBox = () => h('div', { class: 'flex-1 min-h-[99px] overflow-auto border border-line rounded-[4px] bg-bg1' });
    const SEL_BG = 'color-mix(in srgb, var(--accent) 16%, transparent)';

    /* ===== Tab 1: Code Template Libraries (CodeTemplateLibrariesPanel) ===== */

    const libChecked = new Map(libraries.map((lib: any) => [lib.id,
        idSet(lib.enabledChannelIds).includes(channel.id) ||
        (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(channel.id))]));
    const libInitial = new Map(libChecked);
    const libExpanded = new Set();

    function renderLibrariesTab() {
        const tree = treeBox();
        const desc = h('div', { class: 'h-[79px] overflow-auto border border-line rounded-[4px] py-1.5 px-2 text-[10.5px] text-text-dim bg-bg1' });
        const setDesc = (t: any) => { clear(desc); desc.appendChild(h('span', { class: 'italic' }, t && String(t).trim() ? String(t) : 'No description.')); };
        setDesc('');
        function draw() {
            clear(tree);
            if (!libraries.length) { tree.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'No code template libraries')); return; }
            for (const lib of libraries) {
                const templates = api.asList(lib.codeTemplates, 'codeTemplate').filter(t => t && typeof t === 'object');
                const open = libExpanded.has(lib.id);
                const tw = h('span', { class: 'w-[13px] text-center text-text-dim select-none', style: { cursor: templates.length ? 'pointer' : 'default' } }, templates.length ? (open ? '▾' : '▸') : '');
                if (templates.length) tw.addEventListener('click', () => { open ? libExpanded.delete(lib.id) : libExpanded.add(lib.id); draw(); });
                const box = h('input', { type: 'checkbox' });
                (box as any).checked = !!libChecked.get(lib.id);
                box.addEventListener('change', () => libChecked.set(lib.id, (box as any).checked));
                const name = h('span', { class: 'cursor-pointer' }, lib.name || '(unnamed library)');
                name.addEventListener('click', () => setDesc(lib.description));
                tree.appendChild(h('div', { class: 'flex items-center gap-1 py-0.5 px-2' }, tw, box, name));
                if (open) for (const t of templates) {
                    const row = h('div', { class: 'pt-0.5 pr-2 pb-0.5 pl-[40px] cursor-pointer text-[11px]' }, t.name || '(unnamed)');
                    row.addEventListener('click', () => setDesc((t.properties && t.properties.description) || t.description));
                    tree.appendChild(row);
                }
            }
        }
        draw();
        const bar = h('div', { class: 'flex justify-between mb-1.5' },
            h('div', { class: 'flex gap-1.5 items-center' },
                link('Select All', () => { libraries.forEach((l: any) => libChecked.set(l.id, true)); draw(); }), linkSep(),
                link('Deselect All', () => { libraries.forEach((l: any) => libChecked.set(l.id, false)); draw(); })),
            h('div', { class: 'flex gap-1.5 items-center' },
                link('Expand All', () => { libraries.forEach((l: any) => libExpanded.add(l.id)); draw(); }), linkSep(),
                link('Collapse All', () => { libExpanded.clear(); draw(); })));
        return h('div', { class: 'flex flex-col h-full' }, bar, tree, h('div', { class: 'h-1.5' }), desc);
    }

    /* ===== Tab 2: Library Resources (LibraryResourcesPanel) ===== */

    const resources: any[] = [];   // listed library resources { id, name, type } (Default Resource not listed)
    {
        const seen = new Set();
        const listObj = resourcesRaw && typeof resourcesRaw === 'object'
            ? (typeof resourcesRaw.list === 'object' ? resourcesRaw.list : resourcesRaw) : null;
        if (listObj) for (const [k, v] of Object.entries(listObj)) {
            if (k.startsWith('@')) continue;
            for (const item of api.asList(v)) {
                if (item && typeof item === 'object' && item.id && item.name &&
                    String(item.id) !== 'Default Resource' && !seen.has(String(item.id))) {
                    seen.add(String(item.id));
                    resources.push({ id: String(item.id), name: String(item.name), type: String(item.type ?? '') });
                }
            }
        }
        resources.sort((a: any, b: any) => a.name.localeCompare(b.name));
    }

    // Contexts: Channel Scripts (channel props), Source (0), each destination.
    const src = channel.sourceConnector || {};
    const srcProps = (src.properties && src.properties.sourceConnectorProperties) || null;
    const resourceTargets = [
        { key: 'null', label: 'Channel Scripts', leaves: ['Deploy Script', 'Undeploy Script', 'Preprocessor Script', 'Postprocessor Script', 'Attachment Script', 'Batch Script'], holder: () => props },
        { key: '0', label: 'Source Connector' + (src.transportName ? ` (${src.transportName})` : ''), leaves: ['Receiver', 'Filter / Transformer Script'], holder: () => srcProps }
    ];
    for (const d of oie.destinationsOf(channel)) {
        const dp = (d.properties && (d.properties as any).destinationConnectorProperties) || null;
        resourceTargets.push({ key: String(d.metaDataId), label: (d.name || `Destination ${d.metaDataId}`) + (d.transportName ? ` (${d.transportName})` : ''), leaves: ['Filter / Transformer Script', 'Dispatcher', 'Response Transformer Script'], holder: () => dp });
    }
    const ctxMaps = new Map();   // key -> { resourceId: resourceName } (full map, incl. Default Resource)
    for (const t of resourceTargets) { const hd = t.holder(); ctxMaps.set(t.key, entriesToObj(hd && hd.resourceIds)); }

    function renderResourcesTab() {
        let selectedKey = 'channel';   // 'channel' root = aggregate; or a context key; or a leaf key
        const ctxExpanded = new Set();
        const ctxTree = treeBox();
        const resTable = h('div', { class: 'flex-1 overflow-auto border border-line rounded-[4px] bg-bg1' });
        const isCtxKey = (k: any) => k === 'channel' || resourceTargets.some(t => t.key === k);
        const aggState = (id: any) => {
            let all = true, none = true;
            for (const t of resourceTargets) { if (ctxMaps.get(t.key)[id]) none = false; else all = false; }
            return all ? true : none ? false : null;
        };
        function drawTable() {
            clear(resTable);
            const isRoot = selectedKey === 'channel';
            const enabled = isCtxKey(selectedKey);
            resTable.appendChild(h('div', { class: 'grid grid-cols-[24px_1fr_120px] gap-1 py-1 px-2 font-semibold text-[10px] border-b border-line sticky top-0 bg-bg1' }, h('span'), h('span', 'Name'), h('span', 'Type')));
            if (!resources.length) { resTable.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'No library resources')); return; }
            for (const r of resources) {
                const box = h('input', { type: 'checkbox', disabled: !enabled });
                if (isRoot) { const st = aggState(r.id); (box as any).checked = st === true; (box as any).indeterminate = st === null; }
                else if (enabled) (box as any).checked = !!ctxMaps.get(selectedKey)[r.id];
                box.addEventListener('change', () => {
                    const apply = (key: any) => { if ((box as any).checked) ctxMaps.get(key)[r.id] = r.name; else delete ctxMaps.get(key)[r.id]; };
                    if (isRoot) resourceTargets.forEach(t => apply(t.key)); else apply(selectedKey);
                    drawTable();
                });
                resTable.appendChild(h('div', { class: 'grid grid-cols-[24px_1fr_120px] gap-1 py-[3px] px-2 items-center' }, box, h('span.truncate', r.name), h('span.text-text-faint', { class: 'text-[10px]' }, r.type)));
            }
        }
        function drawTree() {
            clear(ctxTree);
            const node = (label: any, key: any, depth: any, opts = {}) => {
                const row = h('div', { class: 'flex items-center gap-1 text-[11px] cursor-pointer', style: { padding: `3px 8px 3px ${8 + depth * 16}px`, color: (opts as any).grey ? 'var(--text-dim)' : 'inherit', background: key === selectedKey ? SEL_BG : 'transparent' } }, (opts as any).twisty || h('span', { class: 'w-[11px]' }), h('span', label));
                row.addEventListener('click', () => { selectedKey = key; drawTree(); drawTable(); });
                ctxTree.appendChild(row);
            };
            node('Channel', 'channel', 0);
            for (const t of resourceTargets) {
                const open = ctxExpanded.has(t.key);
                const tw = h('span', { class: 'w-[11px] cursor-pointer text-text-dim select-none' }, t.leaves.length ? (open ? '▾' : '▸') : '');
                tw.addEventListener('click', (e: any) => { e.stopPropagation(); open ? ctxExpanded.delete(t.key) : ctxExpanded.add(t.key); drawTree(); });
                node(t.label, t.key, 1, { twisty: tw });
                if (open) for (const leaf of t.leaves) node(leaf, `${t.key}::${leaf}`, 2, { grey: true });
            }
        }
        drawTree();
        drawTable();
        return h('div', { class: 'flex flex-col h-full gap-1.5' },
            h('div', { class: 'flex-[1.1] flex flex-col min-h-0' }, ctxTree),
            h('div', { class: 'flex-1 flex flex-col min-h-0' }, resTable));
    }

    /* ===== Tab 3: Deploy/Start Dependencies (ChannelDependenciesPanel) ===== */

    const channelNames = new Map();
    for (const en of api.asList(idsAndNames && idsAndNames.entry)) {
        const pair = api.asList(en && en.string);
        if (pair.length) channelNames.set(String(pair[0]), String(pair[1] ?? pair[0]));
    }
    channelNames.set(channel.id, channel.name || channel.id);
    const channelNameOf = (id: any) => channelNames.get(id) || id;
    const otherChannelsAll = [...channelNames.entries()].filter(([id]) => id !== channel.id)
        .map(([id, name]) => ({ id, name })).sort((a: any, b: any) => a.name.localeCompare(b.name));

    let dependencies = deps.map((d: any) => ({ dependentId: String(d.dependentId), dependencyId: String(d.dependencyId) }));
    const initialDependencies = structuredClone(dependencies);
    const depKey = (d: any) => `${d.dependentId}|${d.dependencyId}`;
    const initialDepKeys = new Set(dependencies.map(depKey));
    const directDeps = (id: any) => dependencies.filter((d: any) => d.dependentId === id).map((d: any) => d.dependencyId);
    const directDependents = (id: any) => dependencies.filter((d: any) => d.dependencyId === id).map((d: any) => d.dependentId);
    function dependsOn(a: any, b: any, seen = new Set()): any {   // does a transitively depend on b?
        if (seen.has(a)) return false; seen.add(a);
        return directDeps(a).some((dep: any) => dep === b || dependsOn(dep, b, seen));
    }

    function openAddDialog(kind: any, allowed: any, onAdd: any) {
        const checks = new Map();
        const listEl = h('div', { class: 'max-h-[198px] overflow-auto border border-line rounded-[4px] py-1.5 px-2' });
        function drawList() {
            clear(listEl);
            if (!allowed.length) { listEl.appendChild(h('div.text-text-faint', 'No channels available')); return; }
            for (const c of allowed) {
                const box = h('input', { type: 'checkbox' }); (box as any).checked = !!checks.get(c.id);
                box.addEventListener('change', () => checks.set(c.id, (box as any).checked));
                listEl.appendChild(h('label.check', { class: 'flex gap-1.5 py-0.5 px-0 items-center' }, box, c.name));
            }
        }
        drawList();
        modal({
            title: kind === 'dependency' ? 'Add Dependency' : 'Add Dependent',
            body: h('div',
                h('div', { class: 'mb-1.5' }, kind === 'dependency' ? 'Select the dependency channel(s) to add.' : 'Select the dependent channel(s) to add.'),
                h('div', { class: 'flex gap-1.5 justify-end mb-1' },
                    link('Select All', () => { allowed.forEach((c: any) => checks.set(c.id, true)); drawList(); }), linkSep(),
                    link('Deselect All', () => { checks.clear(); drawList(); })),
                listEl),
            buttons: [
                { label: 'Cancel' },
                { label: 'OK', primary: true, onClick: () => {
                    const sel = allowed.filter((c: any) => checks.get(c.id)).map((c: any) => c.id);
                    if (!sel.length) { toast(kind === 'dependency' ? 'You must select at least one dependency channel.' : 'You must select at least one dependent channel.', 'warn'); return false; }
                    onAdd(sel);
                } }
            ]
        });
    }

    function depSection(title: any, kind: any) {
        let selected: any = null;
        const expanded = new Set();
        const tree = treeBox();
        const childrenOf = (id: any) => kind === 'dependency' ? directDeps(id) : directDependents(id);
        const allowed = () => otherChannelsAll.filter(c => kind === 'dependency'
            ? !directDeps(channel.id).includes(c.id) && !dependsOn(c.id, channel.id)
            : !directDependents(channel.id).includes(c.id) && !dependsOn(channel.id, c.id));
        const removeBtn = taskButton('Remove', 'trash', doRemove, { danger: true });
        const addBtn = taskButton('Add', 'plus', () => openAddDialog(kind, allowed(), (ids: any) => {
            for (const id of ids) dependencies.push(kind === 'dependency'
                ? { dependentId: channel.id, dependencyId: id }
                : { dependentId: id, dependencyId: channel.id });
            draw();
        }));
        function drawNode(id: any, depth: any, path: any) {
            const kids = childrenOf(id);
            const key = path + id;
            const isTop = depth === 0;
            const open = expanded.has(key);
            const tw = h('span', { class: 'w-[11px] text-text-dim select-none', style: { cursor: kids.length ? 'pointer' : 'default' } }, kids.length ? (open ? '▾' : '▸') : '');
            if (kids.length) tw.addEventListener('click', (e: any) => { e.stopPropagation(); open ? expanded.delete(key) : expanded.add(key); draw(); });
            const row = h('div', { class: 'flex items-center gap-1 text-[11px]', style: { padding: `3px 8px 3px ${8 + depth * 16}px`, cursor: isTop ? 'pointer' : 'default', color: isTop ? 'inherit' : 'var(--text-dim)', background: (isTop && selected === id) ? SEL_BG : 'transparent' } }, tw, h('span', channelNameOf(id)));
            if (isTop) row.addEventListener('click', () => { selected = id; draw(); });
            tree.appendChild(row);
            if (open && !path.includes('>' + id + '>')) for (const k of kids) drawNode(k, depth + 1, key + '>');
        }
        function draw() {
            clear(tree);
            const top = childrenOf(channel.id).slice().sort((a: any, b: any) => channelNameOf(a).localeCompare(channelNameOf(b)));
            if (!top.length) tree.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'None'));
            else for (const id of top) drawNode(id, 0, '>');
            if (!top.includes(selected)) selected = null;
            (removeBtn as any).disabled = !selected;
            (addBtn as any).disabled = !allowed().length;
        }
        function doRemove() {
            if (!selected) return;
            dependencies = dependencies.filter((d: any) => kind === 'dependency'
                ? !(d.dependentId === channel.id && d.dependencyId === selected)
                : !(d.dependencyId === channel.id && d.dependentId === selected));
            selected = null; draw();
        }
        function collectPaths() {
            const out: any[] = [];
            const walk = (id: any, path: any) => { const key = path + id; if (childrenOf(id).length && !path.includes('>' + id + '>')) { out.push(key); for (const k of childrenOf(id)) walk(k, key + '>'); } };
            for (const id of childrenOf(channel.id)) walk(id, '>');
            return out;
        }
        draw();
        return h('div', { class: 'flex flex-col min-h-0 flex-1' },
            h('div', { class: 'flex justify-between items-center mb-1' },
                h('label', { class: 'font-semibold text-[11px]' }, title),
                h('div', { class: 'flex gap-1.5 items-center' },
                    link('Expand All', () => { collectPaths().forEach(p => expanded.add(p)); draw(); }), linkSep(),
                    link('Collapse All', () => { expanded.clear(); draw(); }))),
            h('div', { class: 'flex gap-1.5 min-h-0 flex-1' },
                tree, h('div', { class: 'flex flex-col gap-1' }, addBtn, removeBtn)));
    }

    function renderDependenciesTab() {
        return h('div', { class: 'flex flex-col gap-3 h-full' },
            depSection('This channel depends upon:', 'dependency'),
            depSection('This channel is depended upon by:', 'dependent'));
    }

    /* The three panels are still built with h(); DomTabs takes the strip from
       Radix while keeping tabs()' render-on-activation, which they rely on. */
    const tabHost = h('div', { class: 'flex flex-col flex-1 overflow-hidden min-h-0' });
    tabHost.style.height = '380px';
    const unmountTabs = mountReact(tabHost, <DomTabs label="Channel dependency sections"
        bodyStyle={{ padding: '12px 4px' }}
        defs={[
            { label: 'Code Template Libraries', render: renderLibrariesTab },
            { label: 'Library Resources', render: renderResourcesTab },
            { label: 'Deploy/Start Dependencies', render: renderDependenciesTab }
        ]} />);

    modal({
        title: 'Channel Dependencies',
        body: tabHost,
        // Wide enough for the three tab labels on one row, and no second
        // scrollbar — the tabs manage their own inner scrolling (.modal-deps).
        size: 'modal-deps',
        // Out of the closing render pass: React will not unmount a root from
        // inside one.
        onClose: () => setTimeout(unmountTabs, 0),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: async () => {
                    try {
                        // 1. Deploy/start dependencies — saved to the server
                        //    immediately, with a confirmation (matches Swing).
                        const curKeys = new Set(dependencies.map(depKey));
                        const depChanged = curKeys.size !== initialDepKeys.size
                            || [...curKeys].some(k => !initialDepKeys.has(k));
                        if (depChanged) {
                            const ok = await confirmDialog('Save Dependencies',
                                "You've made changes to deploy/start dependencies, which will be saved now. Are you sure you wish to continue?");
                            if (!ok) return false;
                            await saveChannelDependencyEdits(initialDependencies, dependencies);
                            toast('Channel dependencies saved');
                        }

                        // 2. Code template libraries — this channel's membership
                        //    toggles, applied to the server's CURRENT list (not
                        //    the dialog's snapshot) with the same override=false
                        //    conflict handshake as every other library write.
                        //    Changing a library's channel set edits the SHARED
                        //    libraries, so confirm first (matches Swing).
                        const changedLibs = libraries.filter((lib: any) => libChecked.get(lib.id) !== libInitial.get(lib.id));
                        if (changedLibs.length) {
                            const ok = await confirmDialog('Save Code Template Libraries',
                                "You've made changes to code template libraries, which will be saved now. Are you sure you wish to continue?");
                            if (!ok) return false;
                            const wanted = new Map<any, boolean>(changedLibs.map((lib: any) => [lib.id, !!libChecked.get(lib.id)]));
                            await saveLibraryAssociations(channel.id, wanted, version);
                            toast('Code template libraries saved');
                        }

                        // 3. Library resources — write each context's resourceIds
                        //    onto the channel and its connectors (persisted by
                        //    Save Changes). Existing entries (Default Resource)
                        //    are preserved; only listed resources toggle.
                        let resChanged = false;
                        for (const t of resourceTargets) {
                            const hd = t.holder();
                            if (!hd) continue;
                            const after = Object.keys(ctxMaps.get(t.key)).sort();
                            const before = Object.keys(entriesToObj(hd.resourceIds)).sort();
                            const prevClass = (hd.resourceIds && hd.resourceIds['@class']) || 'linked-hash-map';
                            hd.resourceIds = {
                                '@class': prevClass,
                                entry: Object.entries(ctxMaps.get(t.key)).map(([id, name]) => ({ string: [id, String(name)] }))
                            };
                            if (JSON.stringify(before) !== JSON.stringify(after)) resChanged = true;
                        }
                        if (resChanged) markDirty();
                    } catch (e: any) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* Modal mirror of the Swing advanced queue settings dialog; edits a draft
   and commits on OK so Cancel discards. Enablement rules follow
   DestinationSettingsPanel.updateComponentsEnabled(). */
function openAdvancedQueueSettings(dcp: any, markDirty: any, onDone: any) {
    const queueEnabled = !!dcp.queueEnabled;
    const sendFirst = queueEnabled && !!dcp.sendFirst;
    const draft = {
        retryCount: Number(dcp.retryCount) || 0,
        retryIntervalMillis: Number(dcp.retryIntervalMillis) || 10000,
        regenerateTemplate: !!dcp.regenerateTemplate,
        rotate: !!dcp.rotate,
        includeFilterTransformer: !!dcp.includeFilterTransformer,
        threadCount: Number(dcp.threadCount) || 1,
        threadAssignmentVariable: String(dcp.threadAssignmentVariable ?? ''),
        queueBufferSize: Number(dcp.queueBufferSize) || 1000
    };

    function ynGroup(name: any, value: any, onChange: any) {
        const inputs: any[] = [];
        const radio = (val: any, label: any) => {
            const input = h('input', {
                type: 'radio', name, checked: value === val,
                onChange: () => onChange(val)
            });
            inputs.push(input);
            return h('label.check', input, label);
        };
        const el = h('div.radio-group.inline-row', radio(true, 'Yes'), radio(false, 'No'));
        return { el, setEnabled(on: any) { inputs.forEach(i => { i.disabled = !on; }); } };
    }

    const retryCountInput = numberInput(draft.retryCount, {
        min: 0,
        onInput: (e: any) => { draft.retryCount = Math.max(0, Number(e.target.value) || 0); sync(); }
    });
    const retryIntervalInput = numberInput(draft.retryIntervalMillis, {
        min: 1,
        onInput: (e: any) => { draft.retryIntervalMillis = Math.max(1, Number(e.target.value) || 1); }
    });
    const regenerate = ynGroup('adv-regenerate-template', draft.regenerateTemplate,
        (v: any) => { draft.regenerateTemplate = v; sync(); });
    const includeFT = ynGroup('adv-include-filter-transformer', draft.includeFilterTransformer,
        (v: any) => { draft.includeFilterTransformer = v; });
    const rotate = ynGroup('adv-rotate-queue', draft.rotate, (v: any) => { draft.rotate = v; });
    const threadCountInput = numberInput(draft.threadCount, {
        min: 1,
        onInput: (e: any) => { draft.threadCount = Math.max(1, Number(e.target.value) || 1); sync(); }
    });
    const threadVarInput = textInput(draft.threadAssignmentVariable, {
        onInput: (e: any) => { draft.threadAssignmentVariable = e.target.value; }
    });
    const bufferInput = numberInput(draft.queueBufferSize, {
        min: 1,
        onInput: (e: any) => { draft.queueBufferSize = Math.max(1, Number(e.target.value) || 1); }
    });

    function sync() {
        retryCountInput.disabled = !(!queueEnabled || sendFirst);
        retryIntervalInput.disabled = !(queueEnabled || draft.retryCount > 0);
        regenerate.setEnabled(queueEnabled);
        includeFT.setEnabled(queueEnabled && draft.regenerateTemplate);
        rotate.setEnabled(queueEnabled);
        threadCountInput.disabled = !queueEnabled;
        threadVarInput.disabled = !(queueEnabled && draft.threadCount > 1);
        bufferInput.disabled = !queueEnabled;
    }
    sync();

    modal({
        title: 'Settings',
        body: h('div.form-grid',
            field('Retry Count Before Queue/Error', retryCountInput),
            field('Retry Interval (ms)', retryIntervalInput),
            field('Regenerate Template', regenerate.el),
            field('Include Filter/Transformer', includeFT.el),
            field('Rotate Queue', rotate.el),
            field('Queue Threads', threadCountInput),
            field('Thread Assignment Variable', threadVarInput),
            field('Queue Buffer Size', bufferInput)),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: () => {
                    dcp.retryCount = draft.retryCount;
                    dcp.retryIntervalMillis = draft.retryIntervalMillis;
                    dcp.regenerateTemplate = draft.regenerateTemplate;
                    dcp.rotate = draft.rotate;
                    dcp.includeFilterTransformer = draft.includeFilterTransformer;
                    dcp.threadCount = draft.threadCount;
                    dcp.threadAssignmentVariable = draft.threadAssignmentVariable.trim() || null;
                    dcp.queueBufferSize = draft.queueBufferSize;
                    markDirty();
                    onDone();
                }
            }
        ]
    });
}

/* Debug deploy (classic DeployInDebugModeDialog). The REST endpoint
   POST /channels/{id}/_deploy accepts a debugOptions query param: seven
   comma-separated t/f flags in DebugOptions constructor order —
   deploy/undeploy/pre/postprocessor, attachment/batch, source connector,
   source filter/transformer, destination filter/transformer, destination
   connector, destination response transformer
   (DebuggerUtil.parseDebugOptions). */
function openDebugDeployModal(channel: any, save: any) {
    const options = [
        { label: 'Deploy/Undeploy/Preprocessor/Postprocessor scripts' },
        { label: 'Attachment/Batch scripts' },
        { label: 'Source connector scripts' },
        { label: 'Source filter/transformer' },
        { label: 'Destination filter/transformer' },
        { label: 'Destination connector scripts' },
        { label: 'Destination response transformer' }
    ];
    const state = options.map(() => false);
    modal({
        title: 'Debug Channel Deploy Options',
        body: h('div',
            h('div.hint', { class: 'mb-2.5' },
                'Select the scripts to debug. The channel is saved, then deployed in debug mode with these options.'),
            h('div', { class: 'flex flex-col gap-1.5' },
                options.map((opt: any, i: any) => checkbox(opt.label, false, {
                    onChange: (e: any) => { state[i] = e.target.checked; }
                }).el))),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'Debug Deploy', primary: true,
                onClick: async () => {
                    if (!await save()) return false;
                    const debugOptions = state.map(on => on ? 't' : 'f').join(',');
                    try {
                        await api.post(`/channels/${channel.id}/_deploy`, null,
                            { params: { returnErrors: true, debugOptions } });
                        toast(`Deployed ${channel.name} in debug mode`);
                    } catch (e: any) {
                        toast(e.message, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* ---- channel tags (state shared with save() via tagStateRef) ------------------ */

/* Channel tags: global ChannelTags that include this channel. Loaded lazily by
   the Summary "Tags" field and persisted on save if membership changed. */
async function ensureTags(tagState: any, channel: any) {
    if (tagState.loaded) return tagState;
    try {
        const tags = await api.server.channelTags();
        tagState.all = tags.map(t => ({
            id: t.id, name: t.name, backgroundColor: t.backgroundColor,
            channelIds: api.asList(t.channelIds, 'string').map(String)
        }));
        for (const t of tagState.all) if (t.channelIds.includes(channel.id)) tagState.assigned.add(t.name);
        tagState.available = true;
    } catch { /* tags unavailable; can still create tags locally */ }
    // Restore any unsaved tag selection already written onto the channel, so
    // it survives an editor re-render (e.g. after editing a connector) before
    // the first save — the channel object itself lives on in the store.
    for (const ct of api.asList(channel.exportData && channel.exportData.channelTags, 'channelTag')) {
        if (!ct || !ct.name) continue;
        if (!tagState.all.some((t: any) => t.name === ct.name)) {
            tagState.all.push({
                id: ct.id || oie.uuid(), name: ct.name,
                channelIds: api.asList(ct.channelIds, 'string').map(String),
                backgroundColor: ct.backgroundColor
            });
        }
        tagState.assigned.add(String(ct.name));
    }
    tagState.initial = new Set(tagState.assigned);
    tagState.loaded = true;
    return tagState;
}

/* Write the assigned tags into the channel's exportData.channelTags. The
   engine's updateChannel() treats this list as the authoritative membership
   (DefaultChannelController.updateChannelTags): tags present get this channel
   added/created, tags absent get it removed. Doing it here — rather than a
   separate setChannelTags call — keeps every save idempotent, so a second
   save (e.g. Save then Deploy) can't detach the tag. */
function applyTagsToChannel(tagState: any, channel: any, version: any) {
    if (!tagState.available) return;   // membership unknown — don't disturb
    const channelTags = tagState.all
        .filter((t: any) => tagState.assigned.has(t.name))
        .map((t: any) => {
            const ids = new Set(t.channelIds);
            ids.add(channel.id);
            // '@version' first (array-nested; the engine's JSON→XML reorder
            // fallback doesn't descend into arrays).
            return { '@version': version, id: t.id, name: t.name, channelIds: { string: [...ids] }, backgroundColor: t.backgroundColor };
        });
    channel.exportData = channel.exportData || {};
    // List<ChannelTag>: {channelTag:[...]}; empty string = empty list (detach all).
    channel.exportData.channelTags = channelTags.length ? { channelTag: channelTags } : '';
    // Keep the local cache in sync so re-saves stay consistent.
    for (const t of tagState.all) {
        const ids = new Set(t.channelIds);
        if (tagState.assigned.has(t.name)) ids.add(channel.id); else ids.delete(channel.id);
        t.channelIds = [...ids];
    }
    tagState.initial = new Set(tagState.assigned);
}

function TagsField({ tagState, channel, version, markDirty }: any) {
    const [loaded, setLoaded] = useState(tagState.loaded);
    const [, bump] = useReducer((x: any) => x + 1, 0);
    useEffect(() => {
        let stale = false;
        // Only render the chips once tags have loaded, so a tag added during
        // the load window can't be lost when ensureTags() populates tagState.
        ensureTags(tagState, channel).then(() => { if (!stale) setLoaded(true); });
        return () => { stale = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    if (!loaded) return <span className="text-text-faint text-[10.5px]">Loading tags…</span>;

    const dlId = 'channel-tags-list';
    // Commit on the NATIVE 'change' event only (Enter / blur / datalist pick) —
    // React's onChange is the per-keystroke input event, which would mint a
    // junk tag for every character typed.
    const addRef = (el: any) => {
        if (!el || el.__tagCommit) return;
        el.__tagCommit = true;
        el.addEventListener('change', () => {
            const name = fixTagName(el.value);
            el.value = '';
            if (!name || tagState.assigned.has(name)) return;
            if (!tagState.all.some((t: any) => t.name === name)) {
                tagState.all.push({ id: oie.uuid(), name, channelIds: [], backgroundColor: randomTagColor() });
            }
            tagState.assigned.add(name);
            applyTagsToChannel(tagState, channel, version);
            markDirty();
            bump();
        });
    };
    return (
        <div className="flex flex-wrap gap-[4px] items-center">
            {[...tagState.assigned].sort((a: any, b: any) => a.localeCompare(b)).map(name => {
                const tag = tagState.all.find((t: any) => t.name === name);
                return (
                    <span key={name}
                        className="inline-flex items-center gap-1 py-px px-1.5 rounded-[9px] border border-line text-[10.5px]"
                        style={{ background: tagChipBg(tag && tag.backgroundColor) }}>
                        {name}
                        <span className="cursor-pointer text-text-dim" title="Remove tag"
                            onClick={() => { tagState.assigned.delete(name); applyTagsToChannel(tagState, channel, version); markDirty(); bump(); }}>✕</span>
                    </span>
                );
            })}
            <input ref={addRef} list={dlId} placeholder="Add tag…" className="w-[117px]" />
            <datalist id={dlId}>
                {tagState.all.filter((t: any) => !tagState.assigned.has(t.name)).map((t: any) => <option key={t.name} value={t.name} />)}
            </datalist>
        </div>
    );
}

// Mirror ChannelTag.fixName: strip disallowed chars, cap at 24.
const fixTagName = (n: any) => String(n).replace(/[^a-zA-Z_0-9\-\s]/g, '').slice(0, 24).trim();

/* ---- Summary tab -------------------------------------------------------------- */

function ChannelPropertiesPanel({ channel, version, isNewRef, tagState, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const props = channel.properties = channel.properties || {};
    channel.exportData = channel.exportData || {};
    const metadata = channel.exportData.metadata = channel.exportData.metadata || { enabled: true };
    const ap = props.attachmentProperties = props.attachmentProperties ||
        { '@version': version, type: 'None', properties: null };

    const nameRef = useRef<any>(null);
    useEffect(() => {
        // New channel: focus the empty Name field so the user can type immediately.
        if (isNewRef.current && nameRef.current) { nameRef.current.focus(); nameRef.current.select(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A plugin-contributed type already on the channel stays selectable.
    const typeOptions = ATTACHMENT_TYPES.slice();
    if (ap.type && !typeOptions.some(t => t.value === ap.type)) {
        typeOptions.unshift({ value: ap.type, label: `${ap.type} (custom)`, className: ap.className });
    }
    const attachWarn = (ap.type !== 'None' && !props.storeAttachments)
        ? 'Attachments will be extracted but not stored or reattached.' : '';

    return (
        <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-header">Channel Properties</div>
            <div className="panel-body">
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-y-0 gap-x-7 items-start">
                    <div>
                        <div className="field">
                            <label>Name</label>
                            <input ref={nameRef} type="text" className="max-w-[324px]" value={channel.name ?? ''}
                                onChange={(e: any) => { channel.name = e.target.value; markDirty(); }} />
                        </div>
                        <div className="form-row mb-3">
                            <div className="field">
                                <label>Initial State</label>
                                <select className="w-[153px]" value={props.initialState || 'STARTED'}
                                    onChange={(e: any) => { props.initialState = e.target.value; markDirty(); }}>
                                    {INITIAL_STATES.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}
                                </select>
                            </div>
                            <div className="field">
                                <label>Attachment</label>
                                <div className="flex gap-1.5 items-center">
                                    <select className="w-[162px]" value={ap.type || 'None'}
                                        onChange={(e: any) => {
                                            const def = typeOptions.find(t => t.value === e.target.value);
                                            ap.type = def!.value!;
                                            if (def!.className!) ap.className = def!.className!;
                                            else delete ap.className;
                                            if (def!.value! === 'Regex') {
                                                ap.properties = objToEntries({ 'regex.pattern0': '', 'regex.mimetype0': '' });
                                            } else if (def!.value! === 'JavaScript') {
                                                ap.properties = objToEntries({ 'javascript.script': DEFAULT_ATTACHMENT_SCRIPT });
                                            } else if (def!.value! === 'Entire Message') {
                                                ap.properties = objToEntries({ 'identity.mimetype': '' });
                                            } else {
                                                ap.properties = null;
                                            }
                                            markDirty(); bump();
                                        }}>
                                        {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                    {/* "Properties" opens the handler editor modal (enabled only
                                        when a handler other than None/DICOM is selected). */}
                                    <button className="btn btn-sm" disabled={ap.type === 'None' || ap.type === 'DICOM'}
                                        onClick={() => openAttachmentPropsModal(ap, markDirty)}>Properties</button>
                                </div>
                            </div>
                        </div>
                        <div className="field">
                            <label>Tags</label>
                            <TagsField tagState={tagState} channel={channel} version={version} markDirty={markDirty} />
                        </div>
                        <div className="flex flex-wrap gap-y-1.5 gap-x-[16px] mt-0 mx-0 mb-1">
                            <label className="check">
                                <input type="checkbox" checked={metadata.enabled !== false}
                                    onChange={(e: any) => { metadata.enabled = e.target.checked; markDirty(); }} />
                                Enabled
                            </label>
                            <label className="check">
                                <input type="checkbox" checked={!!props.clearGlobalChannelMap}
                                    onChange={(e: any) => { props.clearGlobalChannelMap = e.target.checked; markDirty(); }} />
                                Clear global channel map on deploy
                            </label>
                            <label className="check">
                                <input type="checkbox" checked={!!props.storeAttachments}
                                    onChange={(e: any) => { props.storeAttachments = e.target.checked; markDirty(); bump(); }} />
                                Store Attachments
                            </label>
                        </div>
                        <div className="text-[#d00] text-[10px] mt-0.5 mx-0 mb-0">{attachWarn}</div>
                        <div className="flex flex-wrap gap-2 mt-3">
                            <button className="btn" onClick={() => openDataTypesModal(channel, version, markDirty)}>
                                <Icon name="transform" />Set Data Types
                            </button>
                            <button className="btn" onClick={() => openDependenciesModal(channel, version, markDirty)}>
                                <Icon name="link" />Set Dependencies
                            </button>
                        </div>
                    </div>
                    <div>
                        <dl className="kv">
                            <dt>Id</dt><dd>{channel.id ?? ''}</dd>
                            <dt>Revision</dt><dd>{String(channel.revision ?? 0)}</dd>
                            <dt>Last Modified</dt><dd>{fmtDate(metadata.lastModified) || '—'}</dd>
                        </dl>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---- message storage ---------------------------------------------------------- */

// Slider value 1..5 → storage mode (MessageStorageMode.fromInt); top = 5.
const STORAGE_SLIDER = ['DISABLED', 'METADATA', 'RAW', 'PRODUCTION', 'DEVELOPMENT'];
const STORAGE_INFO = {
    DEVELOPMENT: { label: 'Development', content: 'Content: All', meta: 'Metadata: All', durable: 'On', dc: '#008200', perf: 20 },
    PRODUCTION:  { label: 'Production', content: 'Content: Raw, Encoded, Sent, Response, Maps', meta: 'Metadata: All', durable: 'On', dc: '#008200', perf: 25 },
    RAW:         { label: 'Raw', content: 'Content: Raw', meta: 'Metadata: All', durable: 'Reprocess only', dc: '#ff6600', perf: 60 },
    METADATA:    { label: 'Metadata', content: 'Content: None', meta: 'Metadata: All', durable: 'Off', dc: '#820000', perf: 65 },
    DISABLED:    { label: 'Disabled', content: 'Content: None', meta: 'Metadata: None', durable: 'Off', dc: '#820000', perf: 100 }
};
const STORAGE_CHECKS = [
    { key: 'encryptData', label: 'Encrypt message content' },
    { key: 'encryptAttachments', label: 'Attachments' },
    { key: 'encryptCustomMetaData', label: 'Custom metadata' },
    { key: 'removeContentOnCompletion', label: 'Remove content on completion' },
    { key: 'removeOnlyFilteredOnCompletion', label: 'Filtered only' },
    { key: 'removeAttachmentsOnCompletion', label: 'Remove attachments on completion' }
];

function MessageStoragePanel({ channel, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const props = channel.properties;
    const mode = props.messageStorageMode || 'DEVELOPMENT';
    const info = (STORAGE_INFO as any)[mode];
    const meta = mode === 'METADATA', dis = mode === 'DISABLED';
    const disabled = {
        encryptData: meta || dis,
        encryptAttachments: meta || dis,
        encryptCustomMetaData: dis,
        removeContentOnCompletion: meta || dis,
        removeOnlyFilteredOnCompletion: meta || dis || !props.removeContentOnCompletion,
        removeAttachmentsOnCompletion: meta || dis
    };
    let perf = info.perf;
    for (const k of ['encryptData', 'encryptAttachments', 'removeContentOnCompletion', 'removeAttachmentsOnCompletion']) {
        if (!(disabled as any)[k] && props[k]) perf -= 3;
    }
    const queued = (mode === 'RAW' || mode === 'METADATA' || mode === 'DISABLED') &&
        oie.destinationsOf(channel).some(d => d.properties && (d.properties as any).destinationConnectorProperties && (d.properties as any).destinationConnectorProperties.queueEnabled);

    const box = (def: any) => (
        <label className="check" key={def.key}>
            <input type="checkbox" checked={!!props[def.key]} disabled={!!(disabled as any)[def.key]}
                onChange={(e: any) => { props[def.key] = e.target.checked; markDirty(); bump(); }} />
            {def.label}
        </label>
    );

    return (
        <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-header">Message Storage</div>
            <div className="panel-body">
                <div className="flex gap-4">
                    <div className="flex gap-1.5">
                        <input type="range" min="1" max="5" step="1"
                            className="[writing-mode:vertical-lr] [direction:rtl] h-[135px] w-[20px] p-0"
                            value={String(STORAGE_SLIDER.indexOf(mode) + 1)}
                            onChange={(e: any) => {
                                props.messageStorageMode = STORAGE_SLIDER[Number(e.target.value) - 1];
                                markDirty(); bump();
                            }} />
                        <div className="flex flex-col justify-between h-[135px] text-[10px] text-text-dim">
                            <div>Development</div><div>Production</div><div>Raw</div><div>Metadata</div><div>Disabled</div>
                        </div>
                    </div>
                    <div className="flex flex-col gap-[4px] flex-1 min-w-0">
                        <div className="font-bold text-[12.5px]">{info.label}</div>
                        <div className="text-[11px]">{info.content}</div>
                        <div className="text-[11px]">{info.meta}</div>
                        <div className="text-[11px]">Durable Message Delivery: <span className="font-semibold" style={{ color: info.dc }}>{info.durable}</span></div>
                        <div className="flex items-center gap-2 text-[11px]">
                            <span>Performance:</span>
                            <div className="h-2 w-[162px] bg-bg3 border border-line rounded-[3px] overflow-hidden">
                                <div className="h-full bg-accent opacity-75 [transition:width_0.2s_ease]"
                                    style={{ width: Math.max(0, Math.min(100, perf)) + '%' }} />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-y-1 gap-x-3.5 mt-1">{[box(STORAGE_CHECKS[0]), box(STORAGE_CHECKS[1]), box(STORAGE_CHECKS[2])]}</div>
                        <div className="flex flex-wrap gap-y-1 gap-x-3.5">{[box(STORAGE_CHECKS[3]), box(STORAGE_CHECKS[4])]}</div>
                        {box(STORAGE_CHECKS[5])}
                        <div className="text-[#d00] text-[10px] min-h-3.5">{queued ? 'Disable destination queueing before using this mode' : ''}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ---- message pruning ---------------------------------------------------------- */

function PruningPanel({ channel, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const metadata = channel.exportData.metadata;
    const pruning = metadata.pruningSettings = metadata.pruningSettings || { archiveEnabled: true };
    const nothingPruned = pruning.pruneMetaDataDays == null && pruning.pruneContentDays == null;

    // Uncontrolled + keyed on the enabled state: re-seeds from the model when
    // the radio toggles, and the clamp never overwrites the text mid-edit.
    const daysInput = (key: any) => (
        <input key={`${key}:${pruning[key] == null}`} type="number" min={1} className="w-[81px]"
            disabled={pruning[key] == null}
            defaultValue={pruning[key] ?? ''}
            onChange={(e: any) => { pruning[key] = Math.max(1, Number(e.target.value) || 1); markDirty(); }} />
    );
    const radio = (name: any, checked: any, onChange: any, label: any) => (
        <label className="check">
            <input type="radio" name={name} checked={checked} onChange={onChange} />
            {label}
        </label>
    );

    return (
        <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-header">Message Pruning</div>
            <div className="panel-body">
                <div className="form-grid">
                    <div className="field">
                        <label>Metadata</label>
                        <div className="radio-group">
                            {radio('prune-metadata', pruning.pruneMetaDataDays == null, () => {
                                delete pruning.pruneMetaDataDays; markDirty(); bump();
                            }, 'Store indefinitely')}
                            <div className="flex items-center gap-2">
                                {radio('prune-metadata', pruning.pruneMetaDataDays != null, () => {
                                    pruning.pruneMetaDataDays = pruning.pruneMetaDataDays || 30; markDirty(); bump();
                                }, 'Prune metadata older than')}
                                {daysInput('pruneMetaDataDays')}
                                <span className="text-text-dim">days</span>
                            </div>
                        </div>
                    </div>
                    <div className="field">
                        <label>Content</label>
                        <div className="radio-group">
                            {radio('prune-content', pruning.pruneContentDays == null, () => {
                                delete pruning.pruneContentDays; markDirty(); bump();
                            }, 'Prune when message metadata is removed')}
                            <div className="flex items-center gap-2">
                                {radio('prune-content', pruning.pruneContentDays != null, () => {
                                    pruning.pruneContentDays = pruning.pruneContentDays || 30; markDirty(); bump();
                                }, 'Prune content older than')}
                                {daysInput('pruneContentDays')}
                                <span className="text-text-dim">days</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col gap-1 mt-1.5">
                    <label className="check">
                        <input type="checkbox" checked={pruning.archiveEnabled !== false} disabled={nothingPruned}
                            onChange={(e: any) => { pruning.archiveEnabled = e.target.checked; markDirty(); }} />
                        Allow message archiving
                    </label>
                    <label className="check">
                        <input type="checkbox" checked={!!pruning.pruneErroredMessages} disabled={nothingPruned}
                            onChange={(e: any) => { pruning.pruneErroredMessages = e.target.checked; markDirty(); bump(); }} />
                        Prune Errored Messages
                    </label>
                </div>
                <div className="hint mt-2">
                    {pruning.pruneErroredMessages
                        ? '(incomplete and queued messages will not be pruned)'
                        : '(incomplete, errored, and queued messages will not be pruned)'}
                </div>
            </div>
        </div>
    );
}

/* ---- custom metadata columns -------------------------------------------------- */

function MetaDataColumnsPanel({ channel, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const props = channel.properties;
    // The live array is normalized once per tab activation; Revert restores the
    // snapshot taken at that activation (legacy renderSummary parity).
    const columnsRef = useRef<any>(null);
    const snapshotRef = useRef<any>(null);
    if (!columnsRef.current) {
        columnsRef.current = api.asList(props.metaDataColumns, 'metaDataColumn');
        snapshotRef.current = JSON.parse(JSON.stringify(columnsRef.current));
    }
    const columns = columnsRef.current;

    const commit = () => {
        props.metaDataColumns = columns.length ? { metaDataColumn: columns } : null;
        markDirty();
        bump();
    };

    return (
        <div className="panel" style={{ marginTop: 0 }}>
            <div className="panel-header">
                Custom Metadata
                <div className="panel-tools">
                    <button className="btn btn-sm" onClick={() => { columns.push({ name: '', type: 'STRING', mappingName: '' }); commit(); }}>
                        <Icon name="plus" />Add
                    </button>
                    <button className="btn btn-sm" title="Revert the custom metadata settings to the last save."
                        onClick={() => {
                            columns.length = 0;
                            for (const c of JSON.parse(JSON.stringify(snapshotRef.current))) columns.push(c);
                            commit();
                        }}>Revert</button>
                </div>
            </div>
            <div className="panel-body">
                {!columns.length
                    ? <div className="text-text-faint">No custom metadata columns</div>
                    : (
                        <div className="grid grid-cols-[minmax(160px,1fr)_130px_minmax(160px,1fr)_70px] gap-y-1 gap-x-1.5 items-center max-w-[684px]">
                            <label>Column Name</label><label>Type</label><label>Variable Mapping</label><span />
                            {columns.map((col: any, i: any) => (
                                <FragmentRow key={i} col={col} commit={commit}
                                    onDelete={() => { columns.splice(columns.indexOf(col), 1); commit(); }} />
                            ))}
                        </div>
                    )}
            </div>
        </div>
    );
}

/* One metadata-column row (module scope so re-renders never remount inputs). */
function FragmentRow({ col, commit, onDelete }: any) {
    return (
        <>
            <input type="text" value={col.name ?? ''} onChange={(e: any) => { col.name = e.target.value; commit(); }} />
            <select value={col.type || 'STRING'} onChange={(e: any) => { col.type = e.target.value; commit(); }}>
                {META_COLUMN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="text" value={col.mappingName ?? ''} onChange={(e: any) => { col.mappingName = e.target.value; commit(); }} />
            <button className="btn w-full justify-center self-stretch" title="Remove column" onClick={onDelete}>Delete</button>
        </>
    );
}

function SummaryTab({ channel, version, isNewRef, tagState, markDirty }: any) {
    return (
        <div className="flex flex-col gap-3.5">
            <ChannelPropertiesPanel channel={channel} version={version} isNewRef={isNewRef} tagState={tagState} markDirty={markDirty} />
            {/* Storage and pruning side by side; wraps to one column when narrow. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] gap-3.5 items-stretch">
                <MessageStoragePanel channel={channel} markDirty={markDirty} />
                <PruningPanel channel={channel} markDirty={markDirty} />
            </div>
            <MetaDataColumnsPanel channel={channel} markDirty={markDirty} />
            <div className="panel" style={{ marginTop: 0 }}>
                <div className="panel-header">Channel Description</div>
                <div className="panel-body">
                    <textarea rows={4} placeholder="Describe what this channel does…"
                        value={channel.description ?? ''}
                        onChange={(e: any) => { channel.description = e.target.value; markDirty(); }} />
                </div>
            </div>
        </div>
    );
}

/* ---- connector helpers (shared by Source / Destinations) ---------------------- */

function transportNamesFor(mode: any, current: any) {
    const names: any[] = [];
    for (const key of platform.connectorPanels().keys()) {
        const [keyMode, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
        if (keyMode === mode && name !== '*') names.push(name);
    }
    if (current && !names.includes(current)) names.unshift(current);
    return names;
}

/* Connector type dropdown. Engine-installed types with no web panel merge in
   asynchronously, labeled so the gap is visible; switching resets properties
   to the panel's defaults after a confirm (filter/transformer are kept). */
function ConnectorTypeSelect({ connector, mode, engineTypes, version, markDirty, onChanged, width }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const [engineList, setEngineList] = useState([] as any[]);
    const names = transportNamesFor(mode, connector.transportName);
    useEffect(() => {
        let stale = false;
        engineTypes().then((types: any) => { if (!stale) setEngineList(types); });
        return () => { stale = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Derived per render against the CURRENT names, so a selected engine-only
    // type never appears twice (plain + '(no web editor)').
    const extra = engineList.filter(t => t.type === mode && !names.includes(t.name)).map(t => t.name);
    return (
        <select style={width ? { width } : undefined} value={connector.transportName}
            onChange={async (e: any) => {
                const name = e.target.value;
                if (name === connector.transportName) return;
                const def = platform.connectorPanel(name, mode);
                if (!def || typeof def.defaults !== 'function') {
                    // Engine-only type: we cannot synthesize its '@class'
                    // properties object, so block the switch. (Existing
                    // channels already using such a type still render via the
                    // generic JSON fallback panel.)
                    bump();   // snap the select back to the model value
                    toast(`"${name}" cannot be configured in the web administrator — install a web admin plugin that registers a connector panel for it.`, 'warn');
                    return;
                }
                const ok = await confirmDialog('Change Connector Type',
                    `Switch this connector to ${name}? Connector settings will reset to defaults (the filter and transformer are kept).`);
                if (!ok) { bump(); return; }
                connector.transportName = name;
                connector.properties = def.defaults(version);
                markDirty();
                onChanged();
            }}>
            {names.map(n => <option key={n} value={n}>{n}</option>)}
            {extra.map(n => <option key={n} value={n}>{`${n} (no web editor)`}</option>)}
        </select>
    );
}

/* Connector settings island: the registered panel (and any connector-properties
   plugin sections, e.g. httpauth/SSL) mount via mountReact behind a host so
   their lifecycles match the legacy rebuild-per-connector behavior; the
   raw-JSON fallback for unregistered types renders declaratively. Remounts on
   connector identity or transport change — never on unrelated repaints. */
function ConnectorPanelHost({ connector, mode, channel, markDirty, panelRev }: any) {
    const hostRef = useRef<any>(null);
    const def = platform.connectorPanel(connector.transportName, mode) || platform.connectorPanel('*', mode);
    const hasPanel = def && typeof def.component === 'function';

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const roots: any[] = [];
        // Plugin-contributed sections (web equivalent of Swing's
        // ConnectorPropertiesPlugin). Each edits its own entry in
        // connector.properties.pluginProperties, JSON-keyed by the entry's Java
        // class name. They render BEFORE the connector's own settings panel —
        // matching Swing.
        for (const ppDef of platform.connectorPropertiesPanels()) {
            try {
                if (!ppDef.isSupported || !ppDef.isSupported(connector.transportName, mode, connector)) continue;
                const fqcn = typeof ppDef.propertiesClass === 'function'
                    ? ppDef.propertiesClass(connector.transportName, mode, connector)
                    : ppDef.propertiesClass;
                if (!fqcn) continue;
                const getEntry = () => {
                    const pp = connector.properties && connector.properties.pluginProperties;
                    return (pp && typeof pp === 'object' && pp[fqcn]) || null;
                };
                const setEntry = (entry: any) => {
                    if (!connector.properties) return;
                    let pp = connector.properties.pluginProperties;
                    if (entry === null || entry === undefined) {
                        if (pp && typeof pp === 'object') {
                            delete pp[fqcn];
                            if (!Object.keys(pp).filter(k => !k.startsWith('@')).length) {
                                connector.properties.pluginProperties = null;
                            }
                        }
                    } else {
                        if (!pp || typeof pp !== 'object') {
                            pp = connector.properties.pluginProperties = {};
                        }
                        pp[fqcn] = entry;
                    }
                    markDirty();
                };
                const inner = h('div');
                roots.push(mountReact(inner, <PluginSlot def={ppDef}
                    ctx={{ getEntry, setEntry, propertiesClass: fqcn, connector, channel, platform, onChange: markDirty }} />));
                host.appendChild(h('div.panel',
                    h('div.panel-header', ppDef.title || ppDef.id),
                    h('div.panel-body', inner)));
            } catch (e: any) {
                console.error(`[connector-properties-panel] ${ppDef.id || '?'} failed:`, e);
            }
        }
        // The connector's own settings panel. A registered panel renders its own
        // section title(s), so no wrapper header (Swing parity).
        if (hasPanel) {
            const inner = h('div');
            roots.push(mountReact(inner, <PluginSlot def={def}
                ctx={{ properties: connector.properties, connector, channel, platform, onChange: markDirty }} />));
            host.appendChild(h('div.panel', h('div.panel-body', inner)));
        }
        return () => {
            roots.forEach(t => { try { t(); } catch { /* ignore */ } });
            host.replaceChildren();
        };
        // Remount per connector identity / transport change (panelRev bumps on
        // type switch) AND per properties-object replacement (same-transport
        // Import Connector) — otherwise the panel stays bound to the detached
        // pre-import object and edits are silently lost on save.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connector, connector.transportName, connector.properties, panelRev]);

    return (
        <div className="mt-3.5">
            <div ref={hostRef} />
            {!hasPanel && (
                <div className="panel">
                    <div className="panel-header">{`${connector.transportName} Settings`}</div>
                    <div className="panel-body">
                        <RawConnectorProps connector={connector} markDirty={markDirty} />
                    </div>
                </div>
            )}
        </div>
    );
}

/* Unregistered type: raw JSON editor preserving '@class' (never let the
   connector be saved without it). */
function RawConnectorProps({ connector, markDirty }: any) {
    const [text, setText] = useState(() => JSON.stringify(connector.properties, null, 2));
    // Resync when the properties OBJECT is replaced too (Import Connector) —
    // stale text would write the pre-import values back on blur.
    useEffect(() => { setText(JSON.stringify(connector.properties, null, 2)); }, [connector, connector.properties]);
    return (
        <div className="field">
            <label>Connector Properties (JSON)</label>
            <textarea rows={16} spellCheck={false} value={text}
                onChange={(e: any) => setText(e.target.value)}
                onBlur={() => {
                    let parsed: any;
                    try {
                        parsed = JSON.parse(text);
                    } catch (e: any) {
                        toast(`Invalid JSON: ${e.message}`, 'error');
                        return;
                    }
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed['@class']) {
                        toast('Connector properties must be an object with an "@class" field', 'error');
                        setText(JSON.stringify(connector.properties, null, 2));
                        return;
                    }
                    connector.properties = parsed;
                    markDirty();
                }} />
            <div className="hint">{`No settings panel registered for "${connector.transportName}" — edit the raw properties`}</div>
        </div>
    );
}

/* ---- Source tab --------------------------------------------------------------- */

/* Source Settings — parity with the Swing SourceSettingsPanel. */
function SourceSettings({ channel, scp, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    const respondAfter = scp.respondAfterProcessing !== false;   // queue OFF when true

    // Response: static auto-generate options (fewer when queued), plus
    // "respond from" each destination (stored as the "d<id>" response key).
    const respOpts = (respondAfter
        ? ['None', 'Auto-generate (Before processing)', 'Auto-generate (After source transformer)', 'Auto-generate (Destinations completed)', 'Postprocessor']
        : ['None', 'Auto-generate (Before processing)']).map(v => ({ value: v, label: v }));
    if (respondAfter) {
        for (const d of oie.destinationsOf(channel)) {
            respOpts.push({ value: 'd' + d.metaDataId, label: d.name || `Destination ${d.metaDataId}` });
        }
    }
    const currentResp = scp.responseVariable ?? 'None';
    if (!respOpts.some(o => o.value === currentResp)) respOpts.push({ value: currentResp, label: currentResp });

    return (
        <div className="form-grid">
            <div className="field">
                <label>Source Queue</label>
                {/* OFF = respond after processing (can use destination responses);
                    ON = queue + respond before processing. */}
                <select value={respondAfter ? 'off' : 'on'}
                    onChange={(e: any) => {
                        scp.respondAfterProcessing = e.target.value === 'off';
                        // ON can't respond from destinations; clamp to a valid choice.
                        if (!scp.respondAfterProcessing &&
                            !['None', 'Auto-generate (Before processing)'].includes(scp.responseVariable)) {
                            scp.responseVariable = 'None';
                        }
                        markDirty(); bump();
                    }}>
                    <option value="off">OFF (Respond after processing)</option>
                    <option value="on">ON (Respond before processing)</option>
                </select>
            </div>
            <div className="field">
                <label>Queue Buffer Size</label>
                {/* Only meaningful (editable) when queue is ON. Uncontrolled: the
                    clamped model must never overwrite the text mid-edit. */}
                <input key={respondAfter ? 'q-off' : 'q-on'} type="number" min={0} disabled={respondAfter}
                    defaultValue={scp.queueBufferSize || 1000}
                    onChange={(e: any) => { scp.queueBufferSize = Number(e.target.value) || 0; markDirty(); }} />
            </div>
            <div className="field">
                <label>Response</label>
                <select value={currentResp}
                    onChange={(e: any) => { scp.responseVariable = e.target.value; markDirty(); bump(); }}>
                    {respOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>
            <div className="field">
                <label>Process Batch</label>
                <select value={scp.processBatch ? 'yes' : 'no'}
                    onChange={(e: any) => { scp.processBatch = e.target.value === 'yes'; markDirty(); bump(); }}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                </select>
            </div>
            <div className="field">
                <label>Batch Response</label>
                {/* Only applies when batching is on. */}
                <select disabled={!scp.processBatch} value={scp.firstResponse ? 'first' : 'last'}
                    onChange={(e: any) => { scp.firstResponse = e.target.value === 'first'; markDirty(); bump(); }}>
                    <option value="first">First</option>
                    <option value="last">Last</option>
                </select>
            </div>
            <div className="field">
                <label>Max Processing Threads</label>
                <input type="number" min={1} defaultValue={scp.processingThreads ?? 1}
                    onChange={(e: any) => { scp.processingThreads = Number(e.target.value) || 1; markDirty(); }} />
            </div>
        </div>
    );
}

function SourceTab({ channel, version, engineTypes, markDirty }: any) {
    // Type switches rebuild the settings + panel below (legacy rebuild()).
    const [panelRev, setPanelRev] = useState(0);
    const connector = channel.sourceConnector;
    const scp = connector.properties && connector.properties.sourceConnectorProperties;
    return (
        <div>
            <div className="panel" style={{ marginTop: 0 }}>
                <div className="panel-header">Connector Type</div>
                <div className="panel-body">
                    <div className="field">
                        <label>Source Connector</label>
                        <ConnectorTypeSelect connector={connector} mode="SOURCE" engineTypes={engineTypes}
                            version={version} markDirty={markDirty} onChanged={() => setPanelRev(r => r + 1)} />
                    </div>
                </div>
            </div>
            {scp && (
                <div className="panel">
                    <div className="panel-header">Source Settings</div>
                    <div className="panel-body">
                        <SourceSettings key={panelRev} channel={channel} scp={scp} markDirty={markDirty} />
                    </div>
                </div>
            )}
            <ConnectorPanelHost connector={connector} mode="SOURCE" channel={channel}
                markDirty={markDirty} panelRev={panelRev} />
        </div>
    );
}

/* ---- Destinations tab --------------------------------------------------------- */

/* Programmatic inserts must write through the native prototype setter: plugin
   connector panels are React components whose controlled inputs dedupe the
   dispatched input event against React's value tracker otherwise. */
function insertIntoField(t: any, token: any) {
    const start = t.selectionStart ?? t.value.length;
    const end = t.selectionEnd ?? start;
    const next = t.value.slice(0, start) + token + t.value.slice(end);
    const proto = t.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(t, next);
    t.selectionStart = t.selectionEnd = start + token.length;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.focus();
}

const MAPPING_FLAVOR = 'application/x-oie-mapping';

function mappingResolveEditorAt(node: any) {
    if (!node || !node.closest) return null;
    const monacoEl = node.closest('.ce-monaco');
    if (monacoEl) {
        const me = (window as any).monaco && (window as any).monaco.editor;
        const editors = me && me.getEditors ? me.getEditors() : [];
        const inst = editors.find((ed: any) => { const n = ed.getDomNode && ed.getDomNode(); return n && n.contains(node); });
        if (inst) return { monaco: inst };
    }
    const ta = node.closest('textarea, input[type=text]');
    if (ta && !ta.readOnly && !ta.disabled) return { el: ta };
    return null;
}

/* Destination Settings (classic Queue Messages / Validate Response). */
function DestinationSettings({ dcp, markDirty }: any) {
    const [, bump] = useReducer((x: any) => x + 1, 0);
    // Classic Swing mapping (DestinationSettingsPanel.fillProperties):
    //   Never      → queueEnabled=false, sendFirst=false
    //   On Failure → queueEnabled=true,  sendFirst=true
    //   Always     → queueEnabled=true,  sendFirst=false
    const mode = !dcp.queueEnabled ? 'never' : (dcp.sendFirst ? 'failure' : 'always');
    const queueRadio = (value: any, label: any) => (
        <label className="check" key={value}>
            <input type="radio" name="dest-queue-mode" checked={mode === value}
                onChange={() => {
                    dcp.queueEnabled = value !== 'never';
                    dcp.sendFirst = value === 'failure';
                    markDirty(); bump();
                }} />
            {label}
        </label>
    );
    const ynRadios = (name: any, checked: any, onChange: any) => (
        <div className="radio-group inline-row">
            <label className="check"><input type="radio" name={name} checked={checked === true} onChange={() => onChange(true)} />Yes</label>
            <label className="check"><input type="radio" name={name} checked={checked === false} onChange={() => onChange(false)} />No</label>
        </div>
    );
    return (
        <div className="panel">
            <div className="panel-header">Destination Settings</div>
            <div className="panel-body">
                <div className="form-grid">
                    <div className="field">
                        <label>Queue Messages</label>
                        <div className="radio-group inline-row">
                            {queueRadio('never', 'Never')}
                            {queueRadio('failure', 'On Failure')}
                            {queueRadio('always', 'Always')}
                        </div>
                    </div>
                    <div className="field">
                        <label>Advanced Queue Settings</label>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <button className="btn" onClick={() => openAdvancedQueueSettings(dcp, markDirty, () => bump())}>
                                Advanced Queue Settings
                            </button>
                            <span className="text-text-faint">{advancedQueueSummary(dcp)}</span>
                        </div>
                    </div>
                    <div className="field">
                        <label>Validate Response</label>
                        {ynRadios('dest-validate-response', !!dcp.validateResponse,
                            (v: any) => { dcp.validateResponse = v; markDirty(); bump(); })}
                    </div>
                    <div className="field">
                        <label>Reattach Attachments</label>
                        {ynRadios('dest-reattach-attachments', dcp.reattachAttachments !== false,
                            (v: any) => { dcp.reattachAttachments = v; markDirty(); bump(); })}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* The per-destination editor below the grid: sticky identity header + type
   row, then destination settings and the connector panel island. */
function DestEditor({ dest, channel, version, engineTypes, markDirty, syncRows }: any) {
    const [panelRev, setPanelRev] = useState(0);
    if (!dest) {
        return <div className="text-text-faint py-2.5 px-0.5">Select a destination to edit its settings</div>;
    }
    const dcp = dest.properties && dest.properties.destinationConnectorProperties;
    return (
        <>
            {/* Static header: connector type + wait-for on ONE compact line (Swing
                parity) — always visible above the scrollable connector panel below. */}
            <div className="panel m-0 sticky top-0 z-[1]">
                <div className="panel-header">{`Destination ${dest.metaDataId} — ${dest.name}`}</div>
                <div className="panel-body py-1.5 px-3">
                    <div className="dest-type-row flex items-center gap-2 flex-wrap">
                        <label className="font-semibold whitespace-nowrap">Connector Type:</label>
                        <ConnectorTypeSelect connector={dest} mode="DESTINATION" engineTypes={engineTypes}
                            version={version} markDirty={markDirty} onChanged={() => setPanelRev(r => r + 1)}
                            width="200px" />
                        {/* Pushed right on a wide row; a container query on .dest-type-row
                            drops the auto margin when narrow (see app.css). */}
                        <label className="check dest-wait-push">
                            <input type="checkbox" checked={dest.waitForPrevious !== false}
                                onChange={(e: any) => { dest.waitForPrevious = e.target.checked; markDirty(); syncRows(); }} />
                            Wait for previous destination
                        </label>
                    </div>
                </div>
            </div>
            {dcp && <DestinationSettings key={`${dest.metaDataId}:${panelRev}`} dcp={dcp} markDirty={markDirty} />}
            <ConnectorPanelHost connector={dest} mode="DESTINATION" channel={channel}
                markDirty={markDirty} panelRev={panelRev} />
        </>
    );
}

function MappingsRail({ onInsert, dragRef }: any) {
    // Shares its collapse flag with the wizard's rail — same rail, same choice.
    const [collapsed, setCollapsed] = useSideCollapse('dest-mappings');
    if (collapsed) {
        return <CollapsedSideStrip className="panel-strip" label="Destination Mappings"
            onExpand={() => setCollapsed(false)} />;
    }
    return (
        <div className="panel dest-mappings w-[216px] flex-[0_0_240px] flex flex-col self-stretch mt-0">
            <div className="panel-header">
                Destination Mappings
                <div className="panel-tools">
                    <SideCollapseButton label="Destination Mappings" onCollapse={() => setCollapsed(true)} />
                </div>
            </div>
            <div className="overflow-auto flex-1 py-1 px-0">
                {DESTINATION_MAPPINGS.map(([label, token]) => (
                    <div key={token} draggable title={token}
                        className="py-[3px] px-3 cursor-pointer text-[11px] truncate hover:bg-bg3"
                        onClick={() => onInsert(token)}
                        onDragStart={(e: any) => {
                            dragRef.current = token;
                            e.dataTransfer.effectAllowed = 'copy';
                            e.dataTransfer.setData('text/plain', token);
                            e.dataTransfer.setData(MAPPING_FLAVOR, token);
                        }}
                        onDragEnd={() => { dragRef.current = null; }}>
                        {label}
                    </div>
                ))}
            </div>
        </div>
    );
}

function DestinationsTab({ channel, version, engineTypes, markDirty, actionsRef, destTasksRef, onTasksChange, gotoElements }: any) {
    // Selection lives in the ref (execution-time reads); the state twin only
    // drives re-renders.
    const [, setSelectedIdState] = useState<any>(null);
    const selectedIdRef = useRef<any>(null);
    const setSelectedId = (id: any) => { selectedIdRef.current = id; setSelectedIdState(id); };
    const tableHostRef = useRef<any>(null);
    const tableRef = useRef<any>(null);

    const dests = () => oie.destinationsOf(channel);
    const selectedDest = () => dests().find(d => String(d.metaDataId) === String(selectedIdRef.current));

    // Last focused insertable control (may be {monaco} or {el}); tracked so a
    // mapping click can insert after focus moved to the mapping list.
    const insertTargetRef = useRef<any>(null);
    const dragRef = useRef<any>(null);

    function refresh() {
        // Always keep a destination selected (classic behavior): fall back to
        // the first one so its connector panel and the connector tasks apply.
        const list = dests();
        if (!list.some(d => String(d.metaDataId) === String(selectedIdRef.current))) {
            setSelectedId(list.length ? list[0].metaDataId : null);
        }
        const table = tableRef.current;
        if (table) {
            table.selected = new Set(selectedIdRef.current == null ? [] : [String(selectedIdRef.current)]);
            table.setRows(list);
        }
        onTasksChange();
    }

    function needSelection() {
        const dest = selectedDest();
        if (!dest) toast('Select a destination first', 'warn');
        return dest;
    }

    async function newDestination() {
        const name = await promptDialog('New Destination', 'Destination name', `Destination ${dests().length + 1}`);
        if (name === null || !name.trim()) return;
        const metaDataId = Number(channel.nextMetaDataId) || (dests().length + 1);
        const dest = oie.defaultDestinationConnector(version, metaDataId, name.trim());
        channel.nextMetaDataId = metaDataId + 1;
        const list = dests().slice();
        list.push(dest);
        oie.setDestinations(channel, list);
        setSelectedId(metaDataId);
        markDirty();
        refresh();
    }

    async function deleteDestination() {
        const dest = needSelection();
        if (!dest) return;
        if (dests().length <= 1) { toast('A channel must have at least one destination', 'warn'); return; }
        if (!await confirmDialog('Delete Destination', `Delete destination "${dest.name}"?`, { danger: true, okLabel: 'Delete' })) return;
        oie.setDestinations(channel, dests().filter(d => d !== dest));
        setSelectedId(null);
        markDirty();
        refresh();
    }

    function move(delta: any) {
        const dest = needSelection();
        if (!dest) return;
        const list = dests().slice();
        const index = list.indexOf(dest);
        const next = index + delta;
        if (next < 0 || next >= list.length) return;
        list.splice(index, 1);
        list.splice(next, 0, dest);
        oie.setDestinations(channel, list);
        markDirty();
        refresh();
    }

    /* Classic connector import/export: replace the selected destination's
       content but keep its identity (metaDataId + name). */
    async function importConnector() {
        const dest = needSelection();
        if (!dest) return;
        const file = await pickFile('.json');
        if (!file) return;
        let imported: any;
        try {
            imported = JSON.parse(String(file.content || ''));
        } catch (e: any) {
            toast(`Invalid JSON: ${e.message}`, 'error');
            return;
        }
        if (imported && typeof imported === 'object' && imported.connector) imported = imported.connector;
        if (!imported || typeof imported !== 'object' || !imported.transportName) {
            toast('File is not a connector export', 'error');
            return;
        }
        if (imported.mode && imported.mode !== 'DESTINATION') {
            toast('Not a destination connector export', 'error');
            return;
        }
        if (!await confirmDialog('Import Connector',
            `Replace the settings of "${dest.name}" with the imported ${imported.transportName} connector? The destination keeps its id and name.`)) return;
        dest.transportName = imported.transportName;
        dest.properties = imported.properties;
        dest.filter = imported.filter || oie.emptyFilter(version);
        dest.transformer = imported.transformer || oie.emptyTransformer(version);
        dest.responseTransformer = imported.responseTransformer || dest.responseTransformer || oie.emptyTransformer(version);
        markDirty();
        refresh();
    }

    function exportConnector() {
        const dest = needSelection();
        if (!dest) return;
        saveFile(`${dest.name || 'destination'}.json`, 'application/json', () => JSON.stringify({ connector: dest }, null, 2));
    }

    function cloneDestination() {
        const dest = needSelection();
        if (!dest) return;
        const copy = JSON.parse(JSON.stringify(dest));
        const metaDataId = Number(channel.nextMetaDataId) || (dests().length + 1);
        copy.metaDataId = metaDataId;
        copy.name = `${dest.name || 'Destination'} (copy)`;
        channel.nextMetaDataId = metaDataId + 1;
        const list = dests().slice();
        list.push(copy);
        oie.setDestinations(channel, list);
        setSelectedId(metaDataId);
        markDirty();
        refresh();
    }
    function setEnabled(value: any) {
        const dest = needSelection();
        if (!dest) return;
        dest.enabled = value;
        markDirty();
        refresh();
    }

    // The React task rail + context menu drive these (classic ctx-tasks bridge).
    destTasksRef.current = {
        newDestination, deleteDestination, move, importConnector, exportConnector,
        cloneDestination, setEnabled, selected: selectedDest,
        stepCountOf: (key: any) => stepCount(selectedDest(), key),
        editElements(kind: any) {
            const dest = needSelection();
            if (dest) gotoElements(kind, dest.metaDataId);
        }
    };

    /* The destinations grid is an imperative DataTable island (columns are
       mount-captured; all callbacks route through refs re-pointed each render). */
    useEffect(() => {
        const host = tableHostRef.current;
        if (!host) return undefined;
        const table = new DataTable([
            { key: 'metaDataId', label: 'Id', width: '46px', className: 'num' },
            {
                key: 'enabled', label: 'Status', width: '100px',
                sortValue: (d: any) => d.enabled !== false ? 0 : 1,
                render: (d: any) => d.enabled !== false
                    ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
                    : h('span.status-cell', h('span.pip'), h('span.text-text-dim', 'Disabled'))
            },
            {
                key: 'name', label: 'Name',
                // Inline-editable name cell (matches the Swing Destinations grid).
                // Clicks are kept off the row handler so the table never re-renders
                // mid-edit and steals focus. markDirty repaints the React header.
                render: (d: any) => {
                    const input = h('input.grid-name', {
                        type: 'text', value: d.name || '',
                        onInput: (e: any) => { d.name = e.target.value; markDirty(); }
                    });
                    ['click', 'mousedown', 'dblclick'].forEach(ev => input.addEventListener(ev, (e: any) => e.stopPropagation()));
                    return input;
                }
            },
            { key: 'transportName', label: 'Type' },
            {
                key: 'waitForPrevious', label: 'Chain', sortable: false,
                render: (d: any) => d.waitForPrevious !== false ? 'Wait for previous' : 'Don\'t wait'
            }
        ], {
            selectable: 'single',
            rowKey: (d: any) => String(d.metaDataId),
            emptyText: 'No destinations',
            columnsMenu: true,
            columnsMenuKey: 'webadmin-cols-destinations',
            onSelect: (rows: any) => {
                setSelectedId(rows.length ? rows[0].metaDataId : null);
                onTasksChange();
            },
            // Right-click parity with the Swing channel editor's Destinations table.
            // Everything routes through refs so the menu always acts on live state.
            onContextMenu: (d: any, e: any) => {
                setSelectedId(d.metaDataId);
                onTasksChange();
                const a = actionsRef.current;
                const dt = destTasksRef.current;
                contextMenu(e.clientX, e.clientY, [
                    { label: 'Save Changes', icon: 'save', task: 'doSaveChannel', group: 'channelEdit', onClick: () => a.save() },
                    { label: 'Validate Connector', icon: 'check', task: 'doValidate', group: 'channelEdit', onClick: () => a.validateConnector() },
                    '-',
                    { label: 'New Destination', icon: 'plus', task: 'doNewDestination', group: 'channelEdit', onClick: () => dt.newDestination() },
                    { label: 'Delete Destination', icon: 'trash', danger: true, task: 'doDeleteDestination', group: 'channelEdit', onClick: () => dt.deleteDestination() },
                    { label: 'Clone Destination', icon: 'copy', task: 'doCloneDestination', group: 'channelEdit', onClick: () => dt.cloneDestination() },
                    d.enabled !== false
                        ? { label: 'Disable Destination', icon: 'x', task: 'doDisableDestination', group: 'channelEdit', onClick: () => dt.setEnabled(false) }
                        : { label: 'Enable Destination', icon: 'check', task: 'doEnableDestination', group: 'channelEdit', onClick: () => dt.setEnabled(true) },
                    '-',
                    { label: 'Move Dest. Up', icon: 'arrowUp', task: 'doMoveDestinationUp', group: 'channelEdit', onClick: () => dt.move(-1) },
                    { label: 'Move Dest. Down', icon: 'arrowDown', task: 'doMoveDestinationDown', group: 'channelEdit', onClick: () => dt.move(1) },
                    '-',
                    { label: 'Edit Filter', icon: 'filter', task: 'doEditFilter', group: 'channelEdit', onClick: () => dt.editElements('filter') },
                    { label: 'Edit Transformer', icon: 'transform', task: 'doEditTransformer', group: 'channelEdit', onClick: () => dt.editElements('transformer') },
                    { label: 'Edit Response', icon: 'transform', task: 'doEditResponseTransformer', group: 'channelEdit', onClick: () => dt.editElements('response') },
                    '-',
                    { label: 'Import Connector', icon: 'import', task: 'doImportConnector', group: 'channelEdit', onClick: () => dt.importConnector() },
                    { label: 'Export Connector', icon: 'export', task: 'doExportConnector', group: 'channelEdit', onClick: () => dt.exportConnector() },
                    { label: 'Export Channel', icon: 'export', task: 'doExportChannel', group: 'channelEdit', onClick: () => a.exportChannel() },
                    { label: 'Validate Script', icon: 'check', task: 'doValidateChannelScripts', group: 'channelEdit', onClick: () => a.validateChannelScripts() },
                    '-',
                    { label: 'Debug Channel', icon: 'deploy', task: 'doDebugDeployFromChannelView', group: 'channelEdit', onClick: () => a.openDebugDeployModal() },
                    { label: 'Deploy Channel', icon: 'deploy', task: 'doDeployFromChannelView', group: 'channelEdit', onClick: () => a.deploy() }
                ]);
            }
        });
        tableRef.current = table;
        host.appendChild(table.el);
        refresh();
        return () => {
            tableRef.current = null;
            host.replaceChildren();
            destTasksRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* Mapping token insertion (click) — into the last focused field/editor. */
    function insertToken(token: any) {
        const target = insertTargetRef.current;
        if (target && target.monaco) {
            const inst = target.monaco;
            const node = inst.getDomNode && inst.getDomNode();
            if (node && node.isConnected) {
                inst.executeEdits('destination-mapping', [{
                    range: inst.getSelection(), text: token, forceMoveMarkers: true
                }]);
                inst.focus();
                return;
            }
        }
        if (target && target.el && target.el.isConnected) {
            insertIntoField(target.el, token);
            return;
        }
        // No known target — fall back to the clipboard.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(
                () => toast(`Copied ${token}`),
                () => toast('Focus a text field first', 'warn'));
        } else {
            toast('Focus a text field first', 'warn');
        }
    }

    function trackFocus(e: any) {
        const t = e.target;
        if (!t || !(t instanceof Element)) return;
        if (t.closest('.ce-monaco')) {
            const me = (window as any).monaco && (window as any).monaco.editor;
            const editors = me && me.getEditors ? me.getEditors() : [];
            const inst = editors.find((ed: any) => {
                const node = ed.getDomNode && ed.getDomNode();
                return node && node.contains(t);
            });
            if (inst) insertTargetRef.current = { monaco: inst };
        } else if ((t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as any).type === 'text')) &&
                   !(t as any).readOnly && !(t as any).disabled) {
            insertTargetRef.current = { el: t };
        }
    }

    // Drag-and-drop insertion. Monaco's native drop is disabled (it snippet-
    // escapes ${...}), so we insert the token as plain text at the drop point.
    function onMappingDragOver(e: any) {
        if (!dragRef.current && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(MAPPING_FLAVOR))) return;
        if (mappingResolveEditorAt(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    }
    function onMappingDrop(e: any) {
        const token = dragRef.current ||
            (e.dataTransfer && (e.dataTransfer.getData(MAPPING_FLAVOR) || e.dataTransfer.getData('text/plain')));
        const editor = token ? mappingResolveEditorAt(e.target) : null;
        dragRef.current = null;
        if (!editor) return;
        e.preventDefault();
        if (editor.monaco) {
            const inst = editor.monaco;
            let pos = inst.getPosition();
            if (inst.getTargetAtClientPoint) {
                const tgt = inst.getTargetAtClientPoint(e.clientX, e.clientY);
                if (tgt && tgt.position) pos = tgt.position;
            }
            const Range = (window as any).monaco.Range;
            inst.executeEdits('destination-mapping', [{
                range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                text: token, forceMoveMarkers: true
            }]);
            inst.focus();
        } else {
            insertIntoField(editor.el, token);
        }
    }

    return (
        <div className="flex-1 min-h-0 dest-layout flex gap-3.5 items-stretch"
            onDragOver={onMappingDragOver} onDrop={onMappingDrop}>
            <div className="flex-auto min-w-0 flex flex-col min-h-0" onFocus={trackFocus}>
                {/* The editor area below reserves a scrollbar gutter; reserve the
                    identical gutter here (overflow-y creates the scroll container
                    the property needs) so the grid's right edge lines up with the
                    settings panels. */}
                <div className="flex-none overflow-y-hidden [scrollbar-gutter:stable]">
                    <div className="panel"><div className="panel-body flush" ref={tableHostRef} /></div>
                </div>
                <div className="mt-[13px] flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]">
                    <DestEditor dest={selectedDest()} channel={channel} version={version}
                        engineTypes={engineTypes} markDirty={markDirty}
                        syncRows={() => tableRef.current && tableRef.current.setRows(dests())} />
                </div>
            </div>
            <MappingsRail onInsert={insertToken} dragRef={dragRef} />
        </div>
    );
}

/* ---- Scripts tab -------------------------------------------------------------- */

const CHANNEL_SCRIPTS = [
    { key: 'deployScript', label: 'Deploy', hint: 'Runs once when the channel is deployed', context: 'CHANNEL_DEPLOY' },
    { key: 'undeployScript', label: 'Undeploy', hint: 'Runs once when the channel is undeployed', context: 'CHANNEL_UNDEPLOY' },
    { key: 'preprocessingScript', label: 'Preprocessor', hint: 'Runs before every message is processed', context: 'CHANNEL_PREPROCESSOR' },
    { key: 'postprocessingScript', label: 'Postprocessor', hint: 'Runs after every message is processed', context: 'CHANNEL_POSTPROCESSOR' }
];

function ScriptsTab({ channel, markDirty }: any) {
    const [current, setCurrent] = useState(CHANNEL_SCRIPTS[0]);
    const currentRef = useRef(current);
    const hostRef = useRef<any>(null);
    const editorRef = useRef<any>(null);
    const switchingRef = useRef(false);   // suppress markDirty while loading a script

    // One editor switches between the four channel scripts, so scope the
    // code-template completions to whichever script is showing.
    useEffect(() => { setActiveScope(channel.id, [current.context]); }, [channel.id, current]);

    useEffect(() => {
        const editor = createCodeEditor({
            value: channel[currentRef.current.key] ?? '',
            language: 'javascript',
            minHeight: '260px',
            maximizable: true,   // channel scripts (Deploy/Undeploy/Pre/Postprocessor) can go full-screen
            popoutTitle: `${currentRef.current.label} script`,
            popoutVars: SCRIPT_REFERENCE,
            onChange: (value: any) => {
                if (switchingRef.current) return;
                channel[currentRef.current.key] = value;
                markDirty();
            }
        });
        editor.el.style.flex = '1';
        editor.el.style.minHeight = '0';
        editorRef.current = editor;
        hostRef.current.appendChild(editor.el);
        return () => {
            try { editor.dispose && editor.dispose(); } catch { /* baseline no-op */ }
            editorRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="flex flex-col flex-1 min-h-0 gap-2.5">
            <div className="form-row items-center">
                <label className="m-0">Script:</label>
                <select className="w-[162px]" value={current.key}
                    onChange={(e: any) => {
                        const editor = editorRef.current;
                        if (editor) channel[currentRef.current.key] = editor.getValue();
                        const next = CHANNEL_SCRIPTS.find(s => s.key === e.target.value) || currentRef.current;
                        currentRef.current = next;
                        setCurrent(next);
                        if (editor) {
                            switchingRef.current = true;
                            editor.setValue(channel[next.key] ?? '');
                            switchingRef.current = false;
                        }
                    }}>
                    {CHANNEL_SCRIPTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <span className="text-text-faint">{current.hint}</span>
            </div>
            <div ref={hostRef} className="flex flex-col flex-1 min-h-0" />
        </div>
    );
}

/* ---- the editor body ---------------------------------------------------------- */

function EditorBody({ params, query, onTasksChange, apiRef, returning }: any) {
    /* ---- one-time setup: working model + save baseline ---- */
    const setupRef = useRef<any>(null);
    if (!setupRef.current) {
        const channel = store.getState('editingChannel');
        // Baseline for the concurrent-edit check (override=false): the channel's
        // OWN last-modified AS LOADED — NOT wall-clock time (immune to clock
        // skew). Round UP to the whole second (the engine parses startEdit at
        // second precision). A channel with NO stored last-modified can't be
        // guarded: its first save skips the check (override=true) and stamps a
        // real last-modified, healing it for later saves.
        const loadedLM = channel && channel.exportData && channel.exportData.metadata
            && channel.exportData.metadata.lastModified;
        const loadedLMms = loadedLM ? Number(loadedLM.time != null ? loadedLM.time : loadedLM) : NaN;
        setupRef.current = {
            channel,
            version: channel['@version'] || store.getState('serverVersion') || '4.5.2',
            startEdit: Number.isFinite(loadedLMms) ? new Date(Math.ceil(loadedLMms / 1000) * 1000) : new Date(),
            guardable: Number.isFinite(loadedLMms),
            isNew: query.new === '1' || store.getState('editingChannelNew') === true,
            // Tags cache shared by the Summary field and save().
            tagState: { loaded: false, available: false, all: [], assigned: new Set(), initial: new Set() }
        };
        store.setState('editingChannelNew', setupRef.current.isNew);
        // Unsaved state is tracked in the shared 'editingChannelDirty' store flag
        // so it survives navigation to the filter/transformer sub-editors and
        // back. A freshly loaded existing channel starts clean; a returning
        // channel keeps its dirty flag.
        if (!returning) store.setState('editingChannelDirty', false);
    }
    const setup = setupRef.current;
    const { channel, version, tagState } = setup;
    const isNewRef = { get current() { return setup.isNew; } };

    const [, bumpRev] = useReducer((x: any) => x + 1, 0);
    const [activeTab, setActiveTabState] = useState('Summary');
    const activeTabRef = useRef('Summary');
    const setActiveTab = (label: any) => { activeTabRef.current = label; setActiveTabState(label); onTasksChange(); };
    const destTasksRef = useRef<any>(null);
    const actionsRef = useRef<any>(null);
    const guardImplRef = useRef<any>(null);

    // The shared flag is the single source of truth (it stays live while the
    // filter/transformer sub-editors edit the same channel).
    const isDirty = () => setup.isNew || store.getState('editingChannelDirty') === true;
    const markDirtyImplRef = useRef<any>(null);
    markDirtyImplRef.current = () => {
        store.setState('editingChannelDirty', true);
        onTasksChange();
        bumpRev();
    };
    const markDirty = useMemo(() => () => markDirtyImplRef.current(), []);

    /* Connector types installed on the engine (GET /extensions/connectors).
       Cached for the lifetime of this editor; failure degrades silently to the
       web-registered panels only. */
    const engineTypesPromiseRef = useRef<any>(null);
    const engineTypes = useMemo(() => () => {
        if (!engineTypesPromiseRef.current) {
            engineTypesPromiseRef.current = api.extensions.connectors().then((raw: any) => {
                const types: any[] = [];
                if (!raw || typeof raw !== 'object') return types;
                const push = (meta: any) => {
                    if (meta && typeof meta === 'object' && meta.name && meta.type) {
                        types.push({ name: String(meta.name), type: String(meta.type) });
                    }
                };
                if (raw.entry !== undefined) {
                    for (const e of api.asList(raw.entry)) {
                        if (!e || typeof e !== 'object') continue;
                        let meta = e.connectorMetaData;
                        if (!meta || typeof meta !== 'object') {
                            for (const [k, v] of Object.entries(e)) {
                                if (k !== 'string' && v && typeof v === 'object') { meta = v; break; }
                            }
                        }
                        push(meta);
                    }
                } else {
                    for (const [k, meta] of Object.entries(raw)) {
                        if (!k.startsWith('@')) push(meta);
                    }
                }
                return types;
            }).catch(() => []);
        }
        return engineTypesPromiseRef.current;
    }, []);

    /* ---- validation + save flow ---- */

    // Swing Frame.checkChannelName: name length (≤40), allowed characters
    // (alphanumeric + hyphen/underscore/space), and case-insensitive uniqueness
    // against every OTHER channel. Returns a warning string, or null when valid.
    async function checkChannelName() {
        const name = String(channel.name ?? '');
        if (name.length > 40) return 'Channel name cannot be longer than 40 characters.';
        if (!/^[A-Za-z0-9_\s-]*$/.test(name)) {
            return 'Channel name cannot have special characters besides hyphen, underscore, and space.';
        }
        try {
            const res = await api.channels.idsAndNames();
            for (const en of api.asList(res && res.entry)) {
                const pair = api.asList(en && en.string);   // [id, name]
                if (pair.length >= 2 && String(pair[0]) !== channel.id
                    && String(pair[1]).toLowerCase() === name.toLowerCase()) {
                    return `Channel "${name}" already exists.`;
                }
            }
        } catch { /* names unavailable — don't block the save on a lookup failure */ }
        return null;
    }

    // Per-connector required-field validation (Swing's per-panel checkProperties).
    function validateConnectors() {
        const out: any[] = [];
        const run = (connector: any, mode: any, label: any) => {
            if (!connector || !connector.transportName) return;
            const def = platform.connectorPanel(connector.transportName as string, mode as any);
            if (!def || typeof def.validate !== 'function') return;
            for (const err of (def.validate(connector.properties) || [])) out.push(`${label}: ${err.label} is required.`);
        };
        run(channel.sourceConnector, 'SOURCE', `Source (${channel.sourceConnector?.transportName || 'Source'})`);
        for (const d of oie.destinationsOf(channel)) {
            if (d && (d.enabled === false || (d.enabled as any) === 'false')) continue;
            const label = d.name ? `${d.name} (${d.transportName})` : (d.transportName || 'Destination');
            run(d, 'DESTINATION', label);
        }
        return out;
    }

    function clearFieldHighlights() {
        for (const el of document.querySelectorAll('.cform-invalid')) el.classList.remove('cform-invalid');
    }

    // Swing checkProperties(highlight=true): red-fill the blank required fields
    // of the connector currently ON SCREEN. Only the active tab's connector
    // panel is mounted, so a document query hits the visible one; each control
    // carries data-fkey === its property key.
    function highlightInvalidFields() {
        clearFieldHighlights();
        let connector = null, mode = null;
        if (activeTabRef.current === 'Source') { connector = channel.sourceConnector; mode = 'SOURCE'; }
        else if (activeTabRef.current === 'Destinations') {
            connector = destTasksRef.current && destTasksRef.current.selected();
            mode = 'DESTINATION';
        }
        if (!connector || !connector.transportName) return;
        const def = platform.connectorPanel(connector.transportName as string, mode as any);
        if (!def || typeof def.validate !== 'function') return;
        const esc = (window.CSS && CSS.escape) ? (s: any) => CSS.escape(s) : (s: any) => String(s).replace(/["\\]/g, '\\$&');
        for (const err of (def.validate(connector.properties) || [])) {
            for (const el of document.querySelectorAll(`[data-fkey="${esc(err.key)}"]`)) el.classList.add('cform-invalid');
        }
    }

    async function save() {
        const problems = [...oie.validateChannel(channel), ...validateConnectors()];
        if (problems.length) {
            highlightInvalidFields();
            modal({
                title: 'Cannot Save Channel',
                body: h('div',
                    h('p', 'Please fix the following before saving:'),
                    h('ul', { class: 'mt-2 mx-0 mb-0 pl-[16px]' }, problems.map(p => h('li', p)))),
                buttons: [{ label: 'OK' }]
            });
            return false;
        }
        // Swing parity (Frame.checkChannelName, run from saveChanges): block the
        // save on a too-long / illegal / duplicate channel name.
        const nameError = await checkChannelName();
        if (nameError) {
            modal({ title: 'Cannot Save Channel', body: h('div', nameError), buttons: [{ label: 'OK' }] });
            return false;
        }
        try {
            // Reconcile tag membership into the channel itself so the PUT attaches
            // them (idempotent — survives a follow-up Deploy that re-saves).
            await ensureTags(tagState, channel);
            applyTagsToChannel(tagState, channel, version);
            // Swing parity (ChannelSetup.setLastModified): stamp the metadata's
            // last-modified at save time — the engine stores whatever we send,
            // and an absent value makes every later concurrent-edit check
            // falsely prompt "Channel Modified".
            const savedMeta = (channel.exportData = channel.exportData || {}).metadata
                = channel.exportData.metadata || { enabled: true };
            const saveStamp = Date.now();
            savedMeta.lastModified = {
                time: saveStamp,
                timezone: (savedMeta.lastModified && savedMeta.lastModified.timezone)
                    || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            };
            // Rebase the edit window onto the stamp we are storing, rounded UP to
            // the whole second (the engine parses startEdit at second precision).
            const rebase = () => { setup.startEdit = new Date(Math.ceil(saveStamp / 1000) * 1000); };
            if (setup.isNew) {
                await api.channels.create(channel);
                setup.isNew = false;
                store.setState('editingChannel', null);
                store.setState('editingChannelNew', false);
            } else {
                channel.revision = (Number(channel.revision) || 0) + 1;
                // An unguardable channel saves with override=true — the check
                // would false-positive unconditionally. The stamp above heals
                // it, so the guard is live from the next save on.
                const ok = await api.channels.update(channel.id, channel, !setup.guardable, setup.guardable ? setup.startEdit : undefined);
                if (String(ok) === 'false') {
                    const overwrite = await confirmDialog('Channel Modified',
                        'This channel has been modified since you first opened it. Are you sure you want to overwrite it?',
                        { danger: true, okLabel: 'Overwrite' });
                    if (!overwrite) {
                        channel.revision = (Number(channel.revision) || 0) - 1;
                        return false;
                    }
                    await api.channels.update(channel.id, channel, true);
                }
            }
            setup.guardable = true;   // the save stored our stamp — the guard is live now
            rebase();
            store.setState('editingChannelDirty', false);
            onTasksChange();
            bumpRev();
            toast(`Saved ${channel.name}`);
            return true;
        } catch (e: any) {
            toast(e.message, 'error');
            return false;
        }
    }

    async function deploy() {
        // Match the Swing channel-view deploy (Frame.doDeployFromChannelView):
        // unsaved changes prompt to save-and-deploy; otherwise a plain confirm.
        if (isDirty()) {
            if (!await confirmDialog('Deploy Channel',
                'This channel will be saved before it is deployed. Are you sure you want to save and deploy this channel?',
                { okLabel: 'Save and Deploy' })) return;
            if (!await save()) return;
        } else if (!await confirmDialog('Deploy Channel', 'Are you sure you want to deploy this channel?', { okLabel: 'Deploy' })) {
            return;
        }
        try {
            const targets = await withDependencies([channel.id], 'deploy', 'Deploy');
            if (targets === null) return;
            await submitDeployment('deploy', targets);
            // Switch to the Dashboard to watch deployment (matches Swing).
            toast(`Deploying ${channel.name}`);
            router.navigate('/dashboard');
        } catch (e: any) {
            // A deploy failure returns the engine's full exception — far too
            // long for a corner toast; show the detail modal and stay here.
            errorModal('Channel Deployment Failed', e, channel.name);
        }
    }

    // Validate Connector (Swing channelEditPopupMenu) — structural checks plus
    // each connector's required-field checks (same checks applied on save).
    function validateConnector() {
        const problems = [...oie.validateChannel(channel), ...validateConnectors()];
        if (!problems.length) { clearFieldHighlights(); toast('Connector configuration is valid'); return; }
        highlightInvalidFields();
        modal({
            title: 'Validation Errors',
            body: h('div',
                h('p', 'Please fix the following:'),
                h('ul', { class: 'mt-2 mx-0 mb-0 pl-[16px]' }, problems.map(p => h('li', p)))),
            buttons: [{ label: 'OK' }]
        });
    }

    // Validate Script (Swing) — real Rhino compile check of the four channel
    // scripts via the engine bridge.
    async function validateChannelScripts() {
        const list = [
            ['Deploy', channel.deployScript],
            ['Undeploy', channel.undeployScript],
            ['Preprocessor', channel.preprocessingScript],
            ['Postprocessor', channel.postprocessingScript]
        ];
        for (const [label, code] of list) {
            if (typeof code !== 'string' || !code.trim()) continue;
            const result = await validateScript(code);
            if (result.ok === null) { toast(result.message, 'warn'); return; }
            if (result.ok === false) { toast(`${label} script — ${result.message}`, 'error'); return; }
        }
        toast('Channel scripts validated successfully');
    }

    function exportChannel() {
        saveFile(`${channel.name || channel.id}.json`, 'application/json', () => JSON.stringify({ channel }, null, 2));
    }

    function backToChannels() { router.navigate('/channels'); }

    function gotoElements(kind: any, metaDataId: any) {
        store.setState('editingChannel', channel);
        store.setState('editingChannelNew', setup.isNew);
        router.navigate(`/channels/${channel.id}/${kind}/${metaDataId}`);
    }

    /* Leaving the editor with unsaved changes prompts; a FAILED save blocks
       navigation and must not drop the working copy — state clears only on
       allow (Don't Save, or a successful Save). */
    guardImplRef.current = async ({ path }: any) => {
        if (path.startsWith(`/channels/${params.channelId}/`)) return; // same editing flow
        if (isDirty()) {
            const choice = await promptSaveChanges(channel);
            if (choice === 'cancel') return false;
            if (choice === 'save' && !await save()) return false;
        }
        // Leaving the editor: drop the working copy AND this guard — it must
        // never prompt again for navigation outside the editor.
        store.setState('editingChannel', null);
        store.setState('editingChannelNew', false);
        store.setState('editingChannelDirty', false);
        store.setState('navGuard', null);
    };

    useEffect(() => {
        store.setState('navGuard', (info: any) => guardImplRef.current(info));
        // route:changed resets the banner to the static route title ("Edit
        // Channel") after the route handler returns; defer past it with rAF so
        // the channel name sticks without a flash.
        const bannerTitle = channel.name ? `Edit Channel - ${channel.name}` : 'Edit Channel';
        window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
            detail: { title: bannerTitle }
        })));
        onTasksChange();
        return () => {
            // In-flow hops (filter/transformer) re-register on return; anything
            // else must not inherit a stale guard. Drop the channel's completion
            // scope so it can't leak into the next channel's editors.
            store.setState('navGuard', null);
            clearActiveScope();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- task surface ---- */

    actionsRef.current = { save, validateConnector, validateChannelScripts, deploy, openDebugDeployModal: () => openDebugDeployModal(channel, save), exportChannel };
    apiRef.current = {
        taskState: () => ({
            dirty: isDirty(),
            tab: activeTabRef.current,
            destSelected: !!(destTasksRef.current && destTasksRef.current.selected())
        }),
        handlers: {
            save, validateConnector, deploy,
            openDebugDeployModal: () => openDebugDeployModal(channel, save),
            exportChannel, backToChannels,
            gotoElements, withCount,
            sourceStepCount: (key: any) => stepCount(channel.sourceConnector, key),
            destStepCount: (key: any) => (destTasksRef.current ? destTasksRef.current.stepCountOf(key) : 0),
            destNew: () => destTasksRef.current && destTasksRef.current.newDestination(),
            destDelete: () => destTasksRef.current && destTasksRef.current.deleteDestination(),
            destMove: (delta: any) => destTasksRef.current && destTasksRef.current.move(delta),
            destEdit: (kind: any) => destTasksRef.current && destTasksRef.current.editElements(kind),
            destImport: () => destTasksRef.current && destTasksRef.current.importConnector(),
            destExport: () => destTasksRef.current && destTasksRef.current.exportConnector()
        }
    };

    /* ---- tabs ---- */

    const pluginTabs = platform.channelTabs();
    const tabLabels = ['Summary', 'Source', 'Destinations', 'Scripts', ...pluginTabs.map(d => d.label)];
    const fill = activeTab === 'Destinations' || activeTab === 'Scripts';


    let body: any = null;
    if (activeTab === 'Summary') {
        body = <SummaryTab key="Summary" channel={channel} version={version} isNewRef={isNewRef}
            tagState={tagState} markDirty={markDirty} />;
    } else if (activeTab === 'Source') {
        body = <SourceTab key="Source" channel={channel} version={version} engineTypes={engineTypes} markDirty={markDirty} />;
    } else if (activeTab === 'Destinations') {
        body = <DestinationsTab key="Destinations" channel={channel} version={version} engineTypes={engineTypes}
            markDirty={markDirty} actionsRef={actionsRef} destTasksRef={destTasksRef}
            onTasksChange={onTasksChange} gotoElements={gotoElements} />;
    } else if (activeTab === 'Scripts') {
        body = <ScriptsTab key="Scripts" channel={channel} markDirty={markDirty} />;
    } else {
        const def = pluginTabs.find(d => d.label === activeTab);
        // Plugin channel tabs are React components — rendered in-tree, keyed by
        // activation so switching remounts them (legacy rebuild-per-switch).
        body = def && typeof def.component === 'function'
            ? <PluginSlot key={activeTab} def={def} ctx={{ channel, platform, onChange: markDirty }} />
            : null;
    }

    return (
        <div className="view-body flex flex-col flex-1 min-h-0">
            <TabsPrimitive.Root value={activeTab} onValueChange={setActiveTab}
                className="flex flex-col flex-1 overflow-hidden min-h-0">
                {/* mx-0/max-w-full: .tabs carries 13px side margins for flush-body
                    views (Settings), but THIS view-body is padded (16px) and the
                    section cards below sit flush against that padding — the strip
                    must too, or it floats 13px right of every card edge. */}
                <TabsPrimitive.List className="tabs mx-0 max-w-full" aria-label="Channel sections">
                    {tabLabels.map((label: any) => (
                        <TabsPrimitive.Trigger key={label} value={label}
                            className={'tab' + (label === activeTab ? ' active' : '')}>{label}</TabsPrimitive.Trigger>
                    ))}
                </TabsPrimitive.List>
                <TabsPrimitive.Content value={activeTab} className="tab-body">
                    {/* 'fill' tabs (Destinations/Scripts) get a flex column the full
                        height of the tab body; others scroll naturally. */}
                    <div key={activeTab} className={fill
                        ? 'py-3.5 px-0 h-full box-border flex flex-col overflow-hidden min-h-0'
                        : 'py-3.5 px-0 overflow-auto'}>
                        {body}
                    </div>
                </TabsPrimitive.Content>
            </TabsPrimitive.Root>
        </div>
    );
}

export function ChannelEditorView({ params, query }: any) {
    const [, forceRender] = useReducer((x: any) => x + 1, 0);
    // Whether the channel was already in the store at mount (returning from a
    // sub-editor / opened from the list with edits) vs. fetched fresh here. A
    // fresh load starts clean; a returning channel keeps its dirty flag.
    const returningRef = useRef<any>(null);
    if (returningRef.current === null) {
        const c = store.getState('editingChannel');
        returningRef.current = !!(c && c.id === params.channelId);
    }
    const [ready, setReady] = useState(() => returningRef.current ? true : null);
    const apiRef = useRef<any>(null);

    // No in-store channel: fetch it, then build.
    useEffect(() => {
        if (ready) return undefined;
        let alive = true;
        api.channels.get(params.channelId).then((loaded: any) => {
            if (!alive) return;
            /* An id the engine doesn't know is NOT an error response: it answers 200
               with an empty body, so this resolves with nothing. Without this check
               the view proceeded to build an editor around null and threw on the
               first field read — a stale bookmark or a deleted channel took out the
               whole view instead of reporting it. */
            if (!loaded || !loaded.id) {
                toast(`Channel ${params.channelId} was not found.`, 'error');
                setReady(false);
                return;
            }
            store.setState('editingChannel', loaded);
            setReady(true);
        }).catch((e: any) => { if (alive) { toast(e.message, 'error'); setReady(false); } });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const ctx = apiRef.current;
    const ts = (ctx && ctx.taskState()) || { dirty: false, tab: 'Summary', destSelected: false };
    const t = ctx && ctx.handlers;

    return (
        <div className="view flex flex-col flex-1 min-h-0">
            <ViewTasks>
                <RailPane title="Channel Tasks" paneKey="tasks:Channel Tasks" group="channelEdit">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        {t && ts.dirty && <TaskButton label="Save Changes" icon="save" primary task="doSaveChannel" onClick={t.save} />}
                        {/* Validate Connector (Swing CHANNEL_EDIT_VALIDATE) — shown
                            whenever a connector is visible, not gated on changes. */}
                        {t && (ts.tab === 'Source' || ts.tab === 'Destinations') && <TaskButton label="Validate Connector" icon="check" task="doValidate" onClick={t.validateConnector} />}
                        {t && <TaskButton label="Deploy Channel" icon="deploy" task="doDeployFromChannelView" onClick={t.deploy} />}
                        {t && <TaskButton label="Debug Channel" icon="deploy" task="doDebugDeployFromChannelView" onClick={t.openDebugDeployModal} />}
                        {t && <TaskButton label="Export Channel" icon="export" task="doExportChannel" onClick={t.exportChannel} />}
                        {t && <TaskButton label="Back to Channels" icon="channels" onClick={t.backToChannels} />}

                        {/* Contextual connector tasks (Swing ctx-tasks), gated by active tab. */}
                        {t && ts.tab === 'Source' && <TaskButton label={t.withCount('Edit Filter', t.sourceStepCount('filter'))} icon="filter" task="doEditFilter" onClick={() => t.gotoElements('filter', 0)} />}
                        {t && ts.tab === 'Source' && <TaskButton label={t.withCount('Edit Transformer', t.sourceStepCount('transformer'))} icon="transform" task="doEditTransformer" onClick={() => t.gotoElements('transformer', 0)} />}

                        {t && ts.tab === 'Destinations' && <TaskButton label="New Destination" icon="plus" task="doNewDestination" onClick={t.destNew} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Delete Destination" icon="trash" danger task="doDeleteDestination" onClick={t.destDelete} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Move Dest. Up" icon="arrowUp" task="doMoveDestinationUp" onClick={() => t.destMove(-1)} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Move Dest. Down" icon="arrowDown" task="doMoveDestinationDown" onClick={() => t.destMove(1)} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Filter', t.destStepCount('filter'))} icon="filter" task="doEditFilter" onClick={() => t.destEdit('filter')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Transformer', t.destStepCount('transformer'))} icon="transform" task="doEditTransformer" onClick={() => t.destEdit('transformer')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Response', t.destStepCount('responseTransformer'))} icon="transform" task="doEditResponseTransformer" onClick={() => t.destEdit('response')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Import Connector" icon="import" task="doImportConnector" onClick={t.destImport} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Export Connector" icon="export" task="doExportConnector" onClick={t.destExport} />}

                        {/* Open in Wizard — always pinned to the bottom of the task list.
                            Switches to the wizard carrying the (possibly unsaved) channel
                            (read from the store); clear the nav guard first so it neither
                            prompts nor drops the working copy on the way out. */}
                        {t && getPref('showViewSwitch') !== false && <TaskButton label="Open in Wizard" icon="wand" onClick={() => {
                            const ch = store.getState('editingChannel');
                            const wasNew = store.getState('editingChannelNew') === true;
                            store.setState('navGuard', null);
                            router.navigate(wasNew || !ch ? '/channels/new/guided' : `/channels/${ch.id}/guided`);
                        }} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {ready === null
                ? <div className="view-body"><div className="dt-empty">Loading channel…</div></div>
                : ready === false
                    ? <div className="view-body"><div className="dt-empty">Channel not loaded</div></div>
                    : <EditorBody params={params} query={query} onTasksChange={forceRender}
                        apiRef={apiRef} returning={returningRef.current} />}
        </div>
    );
}
