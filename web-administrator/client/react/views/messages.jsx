/*
 * Messages — message browser, fully declarative React. The Swing-parity browser
 * is a hierarchical, sortable tree-table (source rows with expand twisties +
 * nested per-connector destination rows + a column-visibility menu), a resizable
 * bottom detail pane with content/error/mapping/attachment tabs, and a
 * lazily-counted pager.
 *
 * The results grid keeps its bespoke <table.msg-table> markup (pinned twisty
 * column with the expand-all header, "--" dash cells, unprocessed-row styling)
 * rendered from React state, with the resize/reorder/column-menu affordances
 * re-implemented in JSX against the same createColumnManager('messages') store
 * (order + widths) and the webadmin-msg-columns visibility store — nothing
 * about the persisted column state or the CSS contract changes.
 *
 * Search is an explicit command (Swing parity: nothing re-runs it implicitly),
 * so the search engine keeps its paging cursor in refs (offsetRef/limitRef/
 * lastParamsRef/totalRef) mutated by runSearch and mirrors the render-relevant
 * results into state. searchRef re-points to the current runSearch each render
 * so dialogs/menus (which outlive the render that opened them) always invoke a
 * fresh closure.
 *
 * The dialogs (Send Message, Advanced Search, Reprocessing Options, Export
 * Results) stay imperative modal() functions invoked from handlers — they are
 * self-contained and shared (openSendMessageDialog is called from the dashboard
 * and cards views). Attachment viewers render as <PluginSlot> children of the
 * React tree; the View Attachment modal mounts the same <AttachmentList> via
 * mountReact with its own teardown.
 *
 * webadmin:set-title fires 'Channel Messages - <name>' once the channel name
 * loads, dispatched inside requestAnimationFrame so it sticks past route:changed
 * (which otherwise resets the banner to the static route title).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { h, toast, modal, confirmDialog, promptDialog, checkbox, select, fmtDate, fmtNumber, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { messageStatusTag } from '@oie/web-api';
import { renderHighlighted, detectType } from '../../core/content-highlight.js';
import { formatSentProperties } from '../../core/sent-format.js';
import { mappingEntries, parseResponse, toDisplayString } from '../../core/xstream.js';
import { getPref } from '../../core/prefs.js';
import { serializeTemplate } from '../../core/serialize.js';
import { createZip } from '../../core/zip.js';
import { createCodeEditor, createColumnManager } from '@oie/web-ui';
import { platform } from '../../core/platform.js';
import { ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane, TaskButton, useTabList } from '../ui.jsx';
import { Icon } from '../bridges.jsx';


/* ---- XStream JSON normalization helpers -------------------------------------- */

// Render an XStream-encoded value the way Swing does (shared decoder).
const displayValue = (v) => toDisplayString(v);

/* XStream maps arrive as {entry:[{string:[k,v]}]} or {entry:[{string:k, <type>:v}]}
   (singleton entries as a bare object), or occasionally as a plain object. */
function mapEntries(map) {
    if (!map || typeof map !== 'object') return [];
    if (map.entry === undefined) {
        return Object.entries(map)
            .filter(([k]) => !k.startsWith('@'))
            .map(([k, v]) => [k, displayValue(v)]);
    }
    const out = [];
    for (const entry of api.asList(map.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry.string) && Object.keys(entry).length === 1) {
            out.push([displayValue(entry.string[0]), displayValue(entry.string[1])]);
            continue;
        }
        const values = [];
        for (const [k, v] of Object.entries(entry)) {
            if (k.startsWith('@')) continue;
            if (Array.isArray(v)) values.push(...v); else values.push(v);
        }
        if (values.length >= 2) out.push([displayValue(values[0]), displayValue(values[1])]);
        else if (values.length === 1) out.push([displayValue(values[0]), '']);
    }
    return out;
}

/* Map<String,String> of channel id → name from /channels/idsAndNames. */
function idNamePairs(map) {
    return mapEntries(map).map(([id, name]) => ({ id, name }));
}

/* Map<Integer,String> of metaDataId → connector name. */
function connectorEntries(map) {
    const out = [];
    const entries = map && typeof map === 'object' && map.entry !== undefined ? map.entry : map;
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        let id = null;
        let name = null;
        for (const [k, v] of Object.entries(entry)) {
            if (k.startsWith('@')) continue;
            if (typeof v === 'number') id = v;
            else if (typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'string') id = Number(v);
            else if (typeof v === 'string') name = v;
        }
        if (id !== null) out.push({ metaDataId: id, name: name ?? String(id) });
    }
    out.sort((a, b) => a.metaDataId - b.metaDataId);
    return out;
}

/* Message.connectorMessages is a Map<Integer,ConnectorMessage>:
   {entry:[{int:0, connectorMessage:{...}}, ...]} — singleton as bare object. */
function connectorMessagesOf(message) {
    const entries = message?.connectorMessages?.entry ?? message?.connectorMessages;
    const out = [];
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const cm = entry.connectorMessage ?? (entry.metaDataId !== undefined ? entry : null);
        if (cm && typeof cm === 'object') out.push(cm);
    }
    out.sort((a, b) => Number(a.metaDataId ?? 0) - Number(b.metaDataId ?? 0));
    return out;
}

function sourceOf(message) {
    const cms = connectorMessagesOf(message);
    // No fallback to cms[0]: when a filter (e.g. status=SENT) returns only
    // destination connector messages, the message has no source row — the parent
    // row then renders blank source-derived columns (Swing parity) instead of
    // borrowing a destination's connector name / status / dates / metadata.
    return cms.find(cm => Number(cm.metaDataId) === 0) ?? null;
}

function contentOf(messageContent) {
    const c = messageContent?.content;
    if (c === null || c === undefined || c === '') return null;
    return typeof c === 'object' ? displayValue(c) : String(c);
}

function connectorHasError(cm) {
    return Number(cm?.errorCode) > 0
        || contentOf(cm?.processingErrorContent) !== null
        || contentOf(cm?.postProcessorErrorContent) !== null
        || contentOf(cm?.responseErrorContent) !== null;
}

function messageHasError(message) {
    return connectorMessagesOf(message).some(connectorHasError);
}

/* Status pill (JSX twin of the imperative h('span.tag…') helper). */
function StatusTag({ status }) {
    const color = messageStatusTag(status);
    return <span className={'tag' + (color ? ' ' + color : '')}>{status || ''}</span>;
}

/* Calendar query params: yyyy-MM-dd'T'HH:mm:ss.SSSZ (RFC 822 zone, no colon). */
function toCalendarParam(datetimeLocal) {
    if (!datetimeLocal) return null;
    const d = new Date(datetimeLocal);
    if (isNaN(d.getTime())) return null;
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function toCount(value) {
    if (value && typeof value === 'object') value = value.long ?? value.int ?? value.integer ?? 0;
    return Number(value) || 0;
}

/* Content searches are separate repeatable query params per content type
   (MessageServletInterface GET /channels/{id}/messages: rawContentSearch,
   transformedContentSearch, ... responseErrorContentSearch). */
const CONTENT_SEARCH_TYPES = [
    { value: 'rawContentSearch', label: 'Raw' },
    { value: 'processedRawContentSearch', label: 'Processed Raw' },
    { value: 'transformedContentSearch', label: 'Transformed' },
    { value: 'encodedContentSearch', label: 'Encoded' },
    { value: 'sentContentSearch', label: 'Sent' },
    { value: 'responseContentSearch', label: 'Response' },
    { value: 'responseTransformedContentSearch', label: 'Response Transformed' },
    { value: 'processedResponseContentSearch', label: 'Processed Response' },
    { value: 'connectorMapContentSearch', label: 'Connector Map' },
    { value: 'channelMapContentSearch', label: 'Channel Map' },
    { value: 'sourceMapContentSearch', label: 'Source Map' },
    { value: 'responseMapContentSearch', label: 'Response Map' },
    { value: 'processingErrorContentSearch', label: 'Processing Error' },
    { value: 'postprocessorErrorContentSearch', label: 'Postprocessor Error' },
    { value: 'responseErrorContentSearch', label: 'Response Error' }
];

/* metaDataSearch / metaDataCaseInsensitiveSearch param format is
   "COLUMN_NAME <operator> value" (space-separated), parsed by
   MetaDataSearchParamConverterProvider.MetaDataSearch.valueOf. */
const META_SEARCH_OPERATORS = [
    '=', '!=', '<', '<=', '>', '>=', 'CONTAINS', 'DOES NOT CONTAIN',
    'STARTS WITH', 'DOES NOT START WITH', 'ENDS WITH', 'DOES NOT END WITH'
];

/* Advanced search criteria defaults (cleared by the dialog's Reset button). */
function defaultAdvancedCriteria() {
    return {
        minMessageId: '', maxMessageId: '',
        minOriginalId: '', maxOriginalId: '',
        minImportId: '', maxImportId: '',
        serverId: '',
        minSendAttempts: '', maxSendAttempts: '',
        error: false, attachment: false,
        includedMetaDataIds: null,  // null = all connectors; else [ids]
        excludedMetaDataIds: null,  // set instead when "Deleted Connectors" stays included
        contentSearches: [],   // [{type, text}]
        metaDataSearches: []   // [{column, operator, value, ignoreCase}]
    };
}

function advIsActive(adv) {
    const ranges = ['minMessageId', 'maxMessageId', 'minOriginalId', 'maxOriginalId',
        'minImportId', 'maxImportId', 'minSendAttempts', 'maxSendAttempts'];
    return !!(adv.includedMetaDataIds || adv.excludedMetaDataIds || adv.error
        || adv.attachment || adv.contentSearches.length || adv.metaDataSearches.length
        || adv.serverId.trim() || ranges.some(k => String(adv[k]).trim() !== ''));
}


/* Pick a file and return its bytes base64-encoded (data: URL prefix stripped),
   chunked into 76-char lines like the Swing client's Base64.encodeBase64Chunked. */
function pickBinaryFile() {
    return new Promise(resolve => {
        const input = h('input', { type: 'file', class: 'hidden' });
        input.addEventListener('change', () => {
            const file = input.files[0];
            input.remove();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = String(reader.result).replace(/^data:[^,]*,/, '');
                resolve({ name: file.name, content: b64.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '') });
            };
            reader.readAsDataURL(file);
        });
        document.body.appendChild(input);
        input.click();
    });
}

/* Shared Send Message dialog (parity with the Swing EditMessageDialog) — pops
   over whichever view invokes it. onSent() runs after a successful submit
   (e.g. to refresh a results list). */
export async function openSendMessageDialog(platform, channelId, onSent) {
    let connectors = [];
    try {
        connectors = connectorEntries(await api.channels.connectorNames(channelId));
    } catch { /* destinations unknown — dialog still works, sends to all */ }

    const editor = createCodeEditor({ value: '', minHeight: '340px', placeholder: 'Raw message payload…' });

    /* ---- file open buttons -------------------------------------------------- */

    const fileButtons = h('div', { class: 'flex gap-2 mt-2' },
        h('button.btn', {
            onClick: async () => {
                const file = await pickFile();
                if (file) editor.setValue(file.content);
            }
        }, 'Open Text File…'),
        h('button.btn', {
            onClick: async () => {
                const file = await pickBinaryFile();
                if (file) editor.setValue(file.content);
            },
            title: 'Open a binary file into the editor above. The file will be encoded and displayed as Base64.'
        }, 'Open Binary File…'),
        h('span.text-text-faint', { class: 'self-center' },
            'Binary files are Base64-encoded into the editor.'));

    /* ---- destinations table -------------------------------------------------- */

    const destRows = connectors.filter(c => c.metaDataId > 0).map(c => ({
        metaDataId: c.metaDataId,
        // Default all checked = send to all destinations, like the Swing client.
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const destTable = h('div.dt-wrap', { class: 'max-h-[140px] overflow-auto' },
        h('table.dt',
            h('thead', h('tr', h('th', 'Destination'), h('th', { class: 'w-[90px]' }, 'Included'))),
            h('tbody', destRows.map(d => {
                const c = connectors.find(x => x.metaDataId === d.metaDataId);
                return h('tr',
                    h('td', `${c.name}`),
                    h('td', { class: 'text-center' }, d.input));
            }))));

    /* ---- source map variables table ------------------------------------------ */

    const mapRows = [];          // [{key: input, value: input, tr}]
    let selectedMapRow = null;
    const mapTbody = h('tbody');

    function selectMapRow(row) {
        selectedMapRow = row;
        mapTbody.querySelectorAll('tr').forEach(tr => tr.classList.remove('selected'));
        if (row) row.tr.classList.add('selected');
    }

    function newMapKey() {
        let n = 1;
        while (mapRows.some(r => r.key.value === `key${n}`)) n++;
        return `key${n}`;
    }

    function addMapRow(key = '', value = '') {
        const row = {
            key: h('input', { type: 'text', value: key, class: 'w-full' }),
            value: h('input', { type: 'text', value: value, class: 'w-full' })
        };
        row.tr = h('tr', { onMousedown: () => selectMapRow(row) },
            h('td', row.key), h('td', row.value));
        mapRows.push(row);
        mapTbody.appendChild(row.tr);
        selectMapRow(row);
        return row;
    }

    const mapTable = h('div.dt-wrap', { class: 'max-h-[140px] overflow-auto' },
        h('table.dt',
            h('thead', h('tr', h('th', { class: 'w-[40%]' }, 'Variable'), h('th', 'Value'))),
            mapTbody));
    const mapButtons = h('div', { class: 'flex gap-2 mt-1.5' },
        h('button.btn', { onClick: () => { addMapRow(newMapKey()).key.focus(); } }, 'New'),
        h('button.btn', {
            onClick: () => {
                if (!selectedMapRow) { toast('Select a variable row first', 'warn'); return; }
                const i = mapRows.indexOf(selectedMapRow);
                selectedMapRow.tr.remove();
                mapRows.splice(i, 1);
                selectMapRow(mapRows[Math.min(i, mapRows.length - 1)] ?? null);
            }
        }, 'Delete'));

    /* ---- dialog -------------------------------------------------------------- */

    modal({
        title: 'Message',
        size: 'wide',
        onClose: () => { editor.dispose && editor.dispose(); },
        body: h('div',
            editor.el,
            fileButtons,
            destRows.length ? h('div',
                h('div.mt-[14px]', 'Send to the following destination(s):'),
                h('div', { class: 'mt-1.5' }, destTable)) : null,
            h('div.mt-[14px]', 'Include the following source map variables:'),
            h('div', { class: 'mt-1.5' }, mapTable),
            mapButtons),
        buttons: [
            {
                label: 'Process Message', primary: true,
                onClick: async () => {
                    const rawData = editor.getValue();
                    if (!rawData) { toast('Enter a message payload', 'warn'); return false; }
                    // This text/plain endpoint receives destinationMetaDataId as a
                    // JAX-RS Set<Integer>: when the param is omitted the engine sees
                    // an *empty* set (not null) and dispatches to NO destinations
                    // (Channel.java filters every destination out of an empty set).
                    // So always send the explicit list of checked destinations.
                    const metaDataIds = destRows.filter(d => d.input.checked).map(d => d.metaDataId);
                    // MessageServletInterface expects sourceMapEntry values as "key=value".
                    const sourceMapEntries = mapRows
                        .filter(r => r.key.value.trim() !== '')
                        .map(r => `${r.key.value.trim()}=${r.value.value}`);
                    try {
                        await api.messages.processNew(channelId, rawData, metaDataIds, sourceMapEntries);
                        toast('Message sent for processing');
                        onSent && onSent();
                    } catch (e) {
                        toast(`Send failed: ${e.message}`, 'error');
                        return false;
                    }
                }
            },
            { label: 'Close' }
        ]
    });
    setTimeout(() => editor.focus(), 30);
}

/* ---- results table (bespoke declarative tree-grid) -------------------------------- */

/* Custom metadata column values live in each connectorMessage.metaDataMap. */
function metaDataValue(m, name) {
    for (const cm of connectorMessagesOf(m)) {
        for (const [key, value] of mapEntries(cm.metaDataMap)) {
            if (String(key).toUpperCase() === String(name).toUpperCase() && value !== '') return value;
        }
    }
    return '';
}

const maxAttempts = (m) => Math.max(0, ...connectorMessagesOf(m).map(cm => Number(cm.sendAttempts) || 0));
const metaOfCm = (cm, name) => {
    for (const [k, v] of mapEntries(cm && cm.metaDataMap)) {
        if (String(k).toUpperCase() === String(name).toUpperCase() && v !== '') return v;
    }
    return '';
};
function errorLabel(cm) {
    const proc = contentOf(cm && cm.processingErrorContent) !== null;
    const resp = contentOf(cm && cm.responseErrorContent) !== null;
    const post = contentOf(cm && cm.postProcessorErrorContent) !== null;
    const n = (proc ? 1 : 0) + (resp ? 1 : 0) + (post ? 1 : 0);
    if (n > 1) return 'Multiple';
    if (proc) return 'Processing';
    if (resp) return 'Response';
    if (post) return 'Postprocessor';
    if (String(cm && cm.status) === 'ERROR') return 'Yes';
    return '';
}
// null (not an empty element) when there's no error, so the cell renders "--".
const errBadge = (label) => label ? <span className="text-err">{label}</span> : null;

/* Full built-in column set (mirrors the Swing MessageBrowser); `def` marks
   default-visible. parent() renders the source row, child() a destination.
   channelName is per-view state, so the set is built per render (memoized). */
function buildColumns(channelName, metaDataColumns) {
    const COLUMNS = [
        { key: 'id', label: 'Id', def: true, w: '90px', cls: 'num', sort: (m) => Number(m.messageId), parent: (m) => String(m.messageId), child: () => '' },
        { key: 'connector', label: 'Connector', def: true, sort: (m) => sourceOf(m)?.connectorName || '', parent: (m, s) => s ? (s.connectorName || 'Source') : '', child: (cm) => cm.connectorName || `Destination ${cm.metaDataId}` },
        { key: 'status', label: 'Status', def: true, w: '110px', sort: (m) => sourceOf(m)?.status || '', parent: (m, s) => s ? <StatusTag status={s.status} /> : '', child: (cm) => <StatusTag status={cm.status} /> },
        { key: 'origReceived', label: 'Orig. Received Date', cls: 'mono', sort: (m) => fmtDate(m.receivedDate), parent: (m) => fmtDate(m.receivedDate), child: () => '' },
        { key: 'received', label: 'Received Date', def: true, cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.receivedDate ?? m.receivedDate), parent: (m, s) => s ? fmtDate(s.receivedDate ?? m.receivedDate) : '', child: (cm) => fmtDate(cm.receivedDate) },
        { key: 'sendAttempts', label: 'Send Attempts', w: '100px', cls: 'num', sort: (m) => maxAttempts(m), parent: (m) => String(maxAttempts(m)), child: (cm) => String(Number(cm.sendAttempts) || 0) },
        { key: 'sendDate', label: 'Send Date', cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.sendDate), parent: (m, s) => s ? fmtDate(s.sendDate) : '', child: (cm) => fmtDate(cm.sendDate) },
        { key: 'responseDate', label: 'Response Date', def: true, cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.responseDate), parent: (m, s) => s ? fmtDate(s.responseDate) : '', child: (cm) => fmtDate(cm.responseDate) },
        { key: 'errors', label: 'Errors', def: true, w: '90px', sort: (m) => messageHasError(m) ? 0 : 1, parent: (m, s) => errBadge(errorLabel(s)), child: (cm) => errBadge(errorLabel(cm)) },
        { key: 'serverId', label: 'Server Id', cls: 'mono', sort: (m) => m.serverId || '', parent: (m) => m.serverId || '', child: (cm) => cm.serverId || '' },
        { key: 'origServerId', label: 'Original Server Id', cls: 'mono', sort: (m) => m.originalServerId || '', parent: (m) => m.originalServerId || '', child: () => '' },
        { key: 'originalId', label: 'Original Id', cls: 'num', sort: (m) => Number(m.originalId) || 0, parent: (m) => m.originalId != null ? String(m.originalId) : '', child: () => '' },
        { key: 'importId', label: 'Import Id', cls: 'num', sort: (m) => Number(m.importId) || 0, parent: (m) => m.importId != null ? String(m.importId) : '', child: () => '' },
        { key: 'importChannelId', label: 'Import Channel Id', cls: 'mono', sort: (m) => m.importChannelId || '', parent: (m) => m.importChannelId || '', child: () => '' },
        { key: 'channelName', label: 'Channel Name', sort: () => channelName, parent: () => channelName, child: () => '' }
    ];
    return [...COLUMNS, ...metaDataColumns.map(col => ({
        key: `meta:${col.name}`, label: col.name, def: true,
        sort: (m) => metaDataValue(m, col.name),
        // Parent = the source connector message's metadata only (Swing parity):
        // blank when the source row isn't in the result, even if a destination
        // carries the value (that still shows on the destination's own row).
        parent: (m, s) => s ? metaOfCm(s, col.name) : '',
        child: (cm) => metaOfCm(cm, col.name)
    }))];
}

/* Default widths for the column manager (the `w`-carrying built-in columns). */
const MSG_COL_WIDTHS = { id: 90, status: 110, sendAttempts: 100, errors: 90 };

/* A null/empty model value renders as a centered, faint "--" (Swing parity):
   e.g. connector-derived columns on a source-less parent row, or message-level
   columns on a destination child row. String/JSX values pass through as-is. */
function Cell({ value, cls, indent }) {
    const empty = value === '' || value === null || value === undefined;
    const className = [empty ? 'cell-dash' : (cls || ''), indent ? 'indent' : '']
        .filter(Boolean).join(' ') || undefined;
    return <td className={className}>{empty ? '--' : value}</td>;
}

/*
 * The hierarchical results grid: source rows with expand twisties + nested
 * per-connector destination rows, a pinned expand-all twisty column, and the
 * resize / drag-to-reorder / auto-fit header affordances of decorateColumns
 * re-implemented in JSX against the same createColumnManager store — persisted
 * order and widths carry over unchanged.
 *
 * `cols` arrives visible-and-display-ordered from the view (which owns the
 * separate visibility store); `rows` arrives pre-sorted. All interaction flows
 * out through callbacks — the table renders pure state.
 */
function ResultsTable({
    cols, mgr, rows, expandedIds, allExpanded, selKey,
    sortKey, sortDir, onSort, onToggleAll, onToggleRow, onSelect, onRowMenu,
    onColumnMenu, onColumnsChange
}) {
    const tableRef = useRef(null);
    const colRefs = useRef({});       // key -> <col> element (live resize)

    const lastKey = cols.length ? cols[cols.length - 1].key : null;
    // Min width so the table scrolls (rather than crushing columns) when the fixed
    // widths exceed the viewport; the auto last column keeps an 80px floor.
    const minWidth = 26 + cols.reduce((sum, c) => sum + (c.key === lastKey ? 80 : mgr.width(c.key)), 0);

    /* ---- resize drag (live width via the <col> ref; commit on mouseup) ---- */
    const startResize = (e, key) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const col = colRefs.current[key];
        const startW = col ? parseFloat(col.style.width) || mgr.width(key) : mgr.width(key);
        document.body.style.cursor = 'col-resize';
        const move = (ev) => { const w = Math.max(40, startW + (ev.clientX - startX)); if (col) col.style.width = w + 'px'; };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            mgr.setWidth(key, col ? parseFloat(col.style.width) : startW);
            onColumnsChange();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    // Double-click the edge → auto-fit the column to its widest content
    // (decorateColumns parity; measures the rendered cells directly).
    const autoFit = (e, key, displayIndex) => {
        e.preventDefault();
        e.stopPropagation();
        const table = tableRef.current;
        if (!table) return;
        const cellIndex = 1 + displayIndex;   // after the pinned twisty column
        const headTh = table.querySelectorAll('thead th')[cellIndex];
        let max = headTh ? headTh.scrollWidth : 0;
        for (const tr of table.querySelectorAll('tbody > tr')) {
            const c = tr.children[cellIndex];
            if (!c || c.colSpan > 1) continue;
            max = Math.max(max, c.scrollWidth);
        }
        mgr.setWidth(key, Math.max(40, max + 10));
        onColumnsChange();
    };

    /* ---- drag-to-reorder data columns (the twisty column stays pinned) ---- */
    const onColDrop = (e, toKey) => {
        e.preventDefault();
        e.currentTarget.classList.remove('col-drop');
        const from = e.dataTransfer.getData('text/plain');
        if (!from || from === toKey) return;
        const next = cols.map(c => c.key).filter(k => k !== from);
        next.splice(next.indexOf(toKey), 0, from);   // drop before the target column
        mgr.setOrder(next);
        onColumnsChange();
    };

    const thead = (
        <thead>
            <tr>
                <th className="w-6" onContextMenu={onColumnMenu}>
                    <span className="msg-twisty" title={allExpanded ? 'Collapse all' : 'Expand all'}
                        onClick={onToggleAll}>{allExpanded ? '▾' : '▸'}</span>
                </th>
                {cols.map((c, i) => (
                    <th key={c.key} data-col-key={c.key} draggable
                        onContextMenu={onColumnMenu}
                        onClick={() => onSort(c.key)}
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); e.currentTarget.classList.add('col-dragging'); }}
                        onDragEnd={(e) => e.currentTarget.classList.remove('col-dragging')}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('col-drop'); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('col-drop')}
                        onDrop={(e) => onColDrop(e, c.key)}>
                        {c.label}{sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                        {c.key !== lastKey
                            ? <div className="col-resize"
                                onClick={(e) => e.stopPropagation()}
                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                onDoubleClick={(e) => autoFit(e, c.key, i)}
                                onMouseDown={(e) => startResize(e, c.key)} />
                            : null}
                    </th>
                ))}
            </tr>
        </thead>
    );

    const colgroup = (
        <colgroup>
            <col style={{ width: '26px' }} />
            {cols.map(c => (
                <col key={c.key}
                    ref={(el) => { colRefs.current[c.key] = el; }}
                    style={c.key === lastKey ? undefined : { width: mgr.width(c.key) + 'px' }} />
            ))}
        </colgroup>
    );

    if (!rows.length) {
        // Same scroll wrapper as the populated branch (flex-none: the header
        // strip keeps its natural height) so the fixed-layout header scrolls
        // horizontally instead of clipping inside the overflow-hidden card.
        return (
            <>
                <div className="dt-wrap flex-none overflow-x-auto">
                    <table className="msg-table dt-resizable" ref={tableRef}
                        style={{ tableLayout: 'fixed', width: '100%', minWidth: minWidth + 'px' }}>
                        {colgroup}{thead}
                    </table>
                </div>
                <div className="dt-empty">No messages found</div>
            </>
        );
    }

    const bodyRows = [];
    for (const m of rows) {
        const source = sourceOf(m);
        // Not-yet-processed messages render gray italic across all columns,
        // on the parent and its children (Swing's italic cell renderer).
        const unprocessed = m.processed === false || m.processed === 'false';
        const rowCls = (key) => [key, unprocessed ? 'unprocessed' : ''].filter(Boolean).join(' ') || undefined;
        const dests = connectorMessagesOf(m).filter(cm => Number(cm.metaDataId) > 0);
        const expanded = expandedIds.has(String(m.messageId));
        bodyRows.push(
            <tr key={`m:${m.messageId}`} className={rowCls(selKey === `${m.messageId}:0` ? 'selected' : '')}
                onClick={() => onSelect(m, 0)}
                onContextMenu={(e) => onRowMenu(m, 0, e)}>
                <td>
                    <span className="msg-twisty"
                        onClick={dests.length ? (e) => { e.stopPropagation(); onToggleRow(String(m.messageId)); } : undefined}>
                        {dests.length ? (expanded ? '▾' : '▸') : ''}
                    </span>
                </td>
                {cols.map(c => <Cell key={c.key} value={c.parent(m, source)} cls={c.cls} />)}
            </tr>
        );
        if (expanded) for (const cm of dests) {
            bodyRows.push(
                <tr key={`m:${m.messageId}:${cm.metaDataId}`}
                    className={'child ' + (rowCls(selKey === `${m.messageId}:${cm.metaDataId}` ? 'selected' : '') || '')}
                    onClick={() => onSelect(m, Number(cm.metaDataId))}
                    onContextMenu={(e) => onRowMenu(m, Number(cm.metaDataId), e)}>
                    <td></td>
                    {cols.map(c => <Cell key={c.key} value={c.child(cm)} cls={c.cls} indent={c.key === 'connector'} />)}
                </tr>
            );
        }
    }

    return (
        <div className="dt-wrap flex-1 min-h-0 overflow-auto">
            <table className="msg-table dt-resizable" ref={tableRef}
                style={{ tableLayout: 'fixed', width: '100%', minWidth: minWidth + 'px' }}>
                {colgroup}{thead}
                <tbody>{bodyRows}</tbody>
            </table>
        </div>
    );
}

/* ---- detail pane ------------------------------------------------------------------ */

function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text == null ? '' : text)).then(
            () => toast('Copied to clipboard'),
            () => toast('Copy failed', 'warn'));
    } else { toast('Clipboard unavailable', 'warn'); }
}

function Loading({ text = 'Loading…' }) {
    return <div className="loading-block"><div className="spinner" />{text}</div>;
}

/* The Response (and destination Processed Response) stage stores a serialized
   Response object, not raw content. Like the Swing browser, we surface the
   status + statusMessage in a banner and show the inner <message> payload as
   the body — never the XML envelope itself. (parseResponse lives in
   core/xstream.js with the rest of the engine-value decoding.) */

/* Highlighted content viewer: syntax colors, optional pretty-print, copy,
   and (for HL7) field-name tooltips enriched from the serializer sidecar.
   renderHighlighted paints imperatively into the <pre> behind a ref — the
   same escape hatch as Monaco hosts; everything around it is state. */
function ContentView({ content, dataType, responseEnvelope }) {
    // Response stages: unwrap the Response envelope — banner shows the status,
    // body shows only the inner message payload (often empty).
    const env = useMemo(() => responseEnvelope ? parseResponse(content) : null, [content, responseEnvelope]);
    const body = env ? (env.message || '') : content;
    const kind = detectType(body, dataType);

    // Pretty-print known structured types (XML/JSON) by default — gated on the
    // "Format text in message browser" user preference (Administrator settings).
    const [formatted, setFormatted] = useState(
        () => (kind === 'xml' || kind === 'json') && getPref('formatMessages') !== false);
    const [descriptions, setDescriptions] = useState(null);
    const preRef = useRef(null);

    useEffect(() => {
        if (preRef.current) renderHighlighted(preRef.current, body, { dataType, format: formatted, descriptions });
    }, [body, dataType, formatted, descriptions]);

    // HL7: pull exact field names from the engine and re-render tooltips
    // (enhances the built-in static dictionary; no-op if the engine can't serialize).
    useEffect(() => {
        if (kind !== 'hl7v2') return;
        let stale = false;
        serializeTemplate('HL7V2', {}, body).then(res => {
            const d = res && res.meta && res.meta.descriptions;
            if (!stale && d && Object.keys(d).length) setDescriptions(d);
        }).catch(() => { /* leave the static dictionary tooltips */ });
        return () => { stale = true; };
    }, [kind, body]);

    return (
        <div className="flex flex-col min-h-0 h-full">
            <div className="content-toolbar">
                {(kind === 'xml' || kind === 'json') && (
                    <label className="check">
                        <input type="checkbox" checked={formatted} onChange={(e) => setFormatted(e.target.checked)} />
                        Format
                    </label>
                )}
                <span className="flex-1" />
                <button className="btn btn-sm" onClick={() => copyText(body)}><Icon name="copy" />Copy</button>
            </div>
            {env && (
                <div className="content-banner">
                    <StatusTag status={env.status} />
                    {env.statusMessage ? <span className="text-text-faint">{env.statusMessage}</span> : null}
                </div>
            )}
            {/* flex:1 so the box always fills the pane — a stable text area even
                when the body is empty (e.g. a Response with no payload). */}
            <pre className="content-pre flex-1 min-h-[120px] max-h-none m-2.5" ref={preRef} />
        </div>
    );
}

/* Classic mappings table: Scope | Variable | Value rows aggregated across the
   connector message's maps. The header is a sortable, sticky banner — it
   stays put (table.dt th is position:sticky) while the rows scroll in the tab
   body, and clicking a column sorts by it (toggling asc/desc). */
const MAPPING_COLS = [
    { key: 'scope', label: 'Scope' }, { key: 'variable', label: 'Variable' }, { key: 'value', label: 'Value' }];

function MappingsTable({ cm }) {
    // Scope, deserialized map content. Matches the Swing browser exactly:
    // Source / Connector / Channel / Response only — no Custom Metadata.
    const rows = useMemo(() => {
        const groups = [
            ['Source', cm.sourceMapContent],
            ['Connector', cm.connectorMapContent],
            ['Channel', cm.channelMapContent],
            ['Response', cm.responseMapContent]
        ];
        const out = [];
        for (const [scope, mc] of groups) {
            for (const [variable, value] of mappingEntries(mc)) {
                out.push({ scope, variable: String(variable), value: String(value ?? '') });
            }
        }
        return out;
    }, [cm]);

    // null sort key = original Source→Response order.
    const [sort, setSort] = useState({ key: null, dir: 1 });

    if (!rows.length) {
        return <div className="p-3.5"><div className="text-text-faint">There are no mappings present.</div></div>;
    }

    const view = sort.key
        ? [...rows].sort((a, b) => String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }) * sort.dir)
        : rows;

    // No inner overflow wrapper: the table scrolls in the tab body
    // (flex-1 min-h-0 overflow-auto), so the sticky header sticks to the pane
    // top and reads as a static banner instead of scrolling away with a nested
    // scroll container.
    return (
        <table className="dt">
            <thead>
                <tr>
                    {MAPPING_COLS.map(col => (
                        <th key={col.key} className="sortable"
                            onClick={() => setSort(s => s.key === col.key ? { key: col.key, dir: -s.dir } : { key: col.key, dir: 1 })}>
                            {col.label}
                            {sort.key === col.key ? <span className="sort-arrow">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {view.map((r, i) => (
                    <tr key={i}>
                        <td className="w-[120px]">{r.scope}</td>
                        <td className="mono w-[30%]">{r.variable}</td>
                        <td className="mono whitespace-pre-wrap break-all">{r.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/* ---- attachments ------------------------------------------------------------------ */

function isTextualAttachment(type) {
    return /^text\/|json|xml|x-www-form-urlencoded/i.test(String(type || ''));
}

function attachmentExtension(type) {
    const subtype = String(type || '').split(';')[0].split('/')[1] || '';
    if (subtype === 'plain') return '.txt';
    const cleaned = subtype.replace(/[^\w]+/g, '').slice(0, 8);
    return cleaned ? `.${cleaned}` : '.bin';
}

async function exportAttachment(channelId, message, attachment) {
    const listType = displayValue(attachment.type) || 'application/octet-stream';
    try {
        await saveFile(`attachment-${displayValue(attachment.id)}${attachmentExtension(listType)}`, listType, async () => {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            const type = displayValue(full?.type ?? attachment.type) || 'application/octet-stream';
            let content = full?.content ?? full;
            if (typeof content !== 'string') content = displayValue(content);
            try {
                // Attachment content arrives Base64-encoded; decode to bytes,
                // then to text for textual types or a binary blob otherwise.
                const binary = atob(content.replace(/\s+/g, ''));
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return isTextualAttachment(type) ? new TextDecoder().decode(bytes) : new Blob([bytes], { type });
            } catch { return content; /* not Base64 — save as-is */ }
        });
        toast('Attachment exported');
    } catch (e) {
        toast(`Failed to export attachment: ${e.message}`, 'error');
    }
}

/* Fallback block for attachments no viewer claims: Id/Type plus the classic
   Fetch Content + Export controls. */
function AttachmentFallback({ channelId, message, attachment }) {
    const [content, setContent] = useState(null);
    const fetchContent = async () => {
        try {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            let c = full?.content ?? full;
            if (typeof c === 'string') {
                try { c = atob(c); } catch { /* keep base64 */ }
            }
            setContent(displayValue(c));
        } catch (e) {
            toast(`Failed to fetch attachment: ${e.message}`, 'error');
        }
    };
    return (
        <div className="mt-[14px]">
            <dl className="kv">
                <dt>Id</dt><dd>{displayValue(attachment.id)}</dd>
                <dt>Type</dt><dd>{displayValue(attachment.type)}</dd>
            </dl>
            <div className="mt-[14px] flex gap-2">
                <button className="btn" onClick={fetchContent}><Icon name="eye" />Fetch Content</button>
                <TaskButton label="Export" icon="export" task="doExportAttachment" group="message"
                    onClick={() => exportAttachment(channelId, message, attachment)} />
            </div>
            {content != null && <pre className="content-pre mt-[14px]">{content}</pre>}
        </div>
    );
}

/* The message's attachments: fetch (reusing the message's cached list), then one
   block per attachment. A whole-message viewer (handleMultiple, e.g. DICOM — it
   reassembles the full object from the message) renders ONCE for all its
   attachments, not once per pixel-data attachment. Used by both the detail
   pane's Attachments tab and the View Attachment modal — React owns the viewer
   lifecycles in both. */
function AttachmentList({ platform, channelId, message }) {
    const [state, setState] = useState({ status: 'loading' });
    useEffect(() => {
        let stale = false;
        (async () => {
            try {
                const attachments = message.__attachments ?? await api.messages.attachments(channelId, message.messageId);
                message.__attachments = attachments;   // cache for Export Attachment et al.
                if (!stale) setState({ status: 'ready', attachments });
            } catch (e) {
                if (!stale) setState({ status: 'error', error: e.message });
            }
        })();
        return () => { stale = true; };
    }, [channelId, message]);

    if (state.status === 'loading') return <Loading text="Loading attachments…" />;
    if (state.status === 'error') return <div className="text-text-faint">{`Failed to load attachments: ${state.error}`}</div>;
    if (!state.attachments.length) return <div className="text-text-faint">No attachments</div>;

    const shownOnce = new Set();
    const blocks = [];
    for (const attachment of state.attachments) {
        const viewer = platform.attachmentViewers().find(x => { try { return x.canHandle(attachment); } catch { return false; } });
        if (viewer && viewer.handleMultiple) {
            if (shownOnce.has(viewer.id)) continue;
            shownOnce.add(viewer.id);
        }
        if (viewer && viewer.component) {
            blocks.push(
                <div className="mt-[14px]" key={`v:${displayValue(attachment.id)}`}>
                    <PluginSlot def={viewer} ctx={{ attachment, channelId, messageId: message.messageId, platform }} />
                </div>);
        } else {
            blocks.push(<AttachmentFallback key={`a:${displayValue(attachment.id)}`}
                channelId={channelId} message={message} attachment={attachment} />);
        }
    }
    return <>{blocks}</>;
}

// View Attachment (Swing MESSAGE_VIEW_IMAGE) — modal listing the message's
// attachments via the same <AttachmentList>; the modal owns the React root and
// tears it down on close, independent of the detail pane.
function viewAttachmentsModal(platform, channelId, m) {
    const host = h('div', { class: 'w-full min-w-0 max-h-[60vh] overflow-auto' });
    const teardown = mountReact(host, <AttachmentList platform={platform} channelId={channelId} message={m} />);
    modal({
        title: `Attachments — Message ${m.messageId}`, size: 'wide', body: host, buttons: [{ label: 'Close' }],
        onClose: () => { try { teardown(); } catch { /* ignore */ } }
    });
}

// Export Attachment (Swing MESSAGE_EXPORT_ATTACHMENT) — export directly when
// there's exactly one, otherwise open the viewer to pick.
async function exportAttachmentTask(platform, channelId, m) {
    const attachments = m.__attachments ?? await api.messages.attachments(channelId, m.messageId).catch(() => []);
    m.__attachments = attachments;
    if (!attachments.length) { toast('No attachments on this message', 'warn'); return; }
    if (attachments.length === 1) { exportAttachment(channelId, m, attachments[0]); return; }
    viewAttachmentsModal(platform, channelId, m);
}

/* Detail tab strip sized to the pane: fixed bar, scrolling body. Only the
   active tab's content is mounted (leaving a tab unmounts its viewers, matching
   the legacy teardown-on-switch). The body is KEYED by the active tab so
   switching between two same-type tabs (Raw → Transformed, both <ContentView>)
   remounts instead of reusing the instance — each tab re-derives its Format
   default and HL7 descriptions, and the scroll position resets (legacy parity).
   The parent keys this component by connector so switching rows resets to the
   first tab. */
function DetailTabs({ defs }) {
    const [active, setActive] = useState(0);
    const tabKeys = useTabList(defs.length, active, setActive, { label: 'Message sections' });
    if (!defs.length) return null;
    const current = defs[Math.min(active, defs.length - 1)];
    return (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="tabs flex-none" {...tabKeys.list}>
                {defs.map((def, i) => (
                    <button key={def.label} className={'tab' + (i === active ? ' active' : '')}
                        {...tabKeys.tab(i)}
                        onClick={() => setActive(i)}>{def.label}</button>
                ))}
            </div>
            <div key={current.label} className="flex-1 min-h-0 overflow-auto">{current.node}</div>
        </div>
    );
}

/* Tab set for one connector message (content stages, errors, mappings,
   attachments) — mirrors the Swing browser's per-connector tabs. */
function ConnectorTabs({ message, cm, channelId, platform }) {
    const contentDefs = [
        ['Raw', 'raw'], ['Processed Raw', 'processedRaw'], ['Transformed', 'transformed'],
        ['Encoded', 'encoded'], ['Sent', 'sent'], ['Response', 'response'],
        ['Response Transformed', 'responseTransformed'], ['Processed Response', 'processedResponse']
    ];

    const defs = [];
    for (const [label, key] of contentDefs) {
        let content = contentOf(cm[key]);
        if (content === null) continue;
        let dataType = cm[key] && cm[key].dataType;
        // Response is always a Response envelope; Processed Response is one only
        // on destinations (on the source it's plain content). Mirrors the Swing browser.
        const responseEnvelope = key === 'response' || (key === 'processedResponse' && Number(cm.metaDataId) > 0);
        // On a destination, "Sent" is a serialized ConnectorProperties object —
        // render it the way the Swing browser does (toFormattedString), as text.
        if (key === 'sent' && Number(cm.metaDataId) > 0) {
            const formatted = formatSentProperties(content);
            if (formatted != null) { content = formatted; dataType = 'TEXT'; }
        }
        defs.push({ label, node: <ContentView content={content} dataType={dataType} responseEnvelope={responseEnvelope} /> });
    }

    const errorDefs = [
        ['Processing Error', contentOf(cm.processingErrorContent)],
        ['Postprocessor Error', contentOf(cm.postProcessorErrorContent)],
        ['Response Error', contentOf(cm.responseErrorContent)]
    ].filter(([, content]) => content !== null);
    if (errorDefs.length) {
        defs.push({
            label: 'Errors',
            node: (
                <div className="p-2.5 overflow-auto">
                    {errorDefs.map(([label, content]) => (
                        <div key={label}>
                            <div className="text-text-faint mt-[14px]">{label}</div>
                            <pre className="content-pre">{content}</pre>
                        </div>
                    ))}
                </div>
            )
        });
    }

    defs.push({ label: 'Mappings', node: <MappingsTable cm={cm} /> });
    // Attachments tab only when the message actually has attachments.
    if (message.__attachments && message.__attachments.length) {
        defs.push({
            label: 'Attachments',
            node: (
                <div className="p-2.5 overflow-auto">
                    <AttachmentList platform={platform} channelId={channelId} message={message} />
                </div>
            )
        });
    }

    return <DetailTabs defs={defs} />;
}

/* Detail pane content: empty strip / loading / the selected message's header +
   connector tabs. The connector shown is chosen by selecting the source or
   destination row in the tree above, so the header is just the message label —
   no status pill or connector dropdown. */
function DetailBody({ detail, channelId, platform }) {
    if (detail.status === 'empty') {
        return <div className="text-text-faint flex-none py-[9px] px-3.5">Select a message to view its contents.</div>;
    }
    if (detail.status === 'loading') {
        return <div className="py-3 px-3.5"><Loading text="Loading message…" /></div>;
    }
    const { message, metaDataId } = detail;
    const cms = connectorMessagesOf(message);
    if (!cms.length) {
        return (
            <>
                <div className="panel-header flex-none">{`Message ${message.messageId}`}</div>
                <div className="text-text-faint py-3 px-3.5">No connector messages</div>
            </>
        );
    }
    const cm = cms.find(c => Number(c.metaDataId) === Number(metaDataId)) || cms[0];
    return (
        <>
            <div className="panel-header flex-none">{`Message ${message.messageId}`}</div>
            <ConnectorTabs key={`${message.messageId}:${cm.metaDataId}`}
                message={message} cm={cm} channelId={channelId} platform={platform} />
        </>
    );
}

/* ---- advanced search dialog ------------------------------------------------------- */

/* Imperative modal (like the other dialogs): self-contained, reads the staged
   criteria passed in and hands the resolved criteria back through onApply. */
function openAdvancedSearch({ connectors, metaDataColumns, adv, onApply }) {
    /* ---- connector inclusion table (Id | Current Connector Name | Included) --
       Mirrors the Swing MessageBrowserAdvancedFilter: all checked = no filter;
       if "Deleted Connectors" (null) stays checked, exclude the unchecked real
       connectors; otherwise include only the checked real connectors. */
    const isConnChecked = (key) => {
        if (adv.includedMetaDataIds) return adv.includedMetaDataIds.includes(key);
        if (adv.excludedMetaDataIds) return key === null ? true : !adv.excludedMetaDataIds.includes(key);
        return true;
    };
    const connRows = [];
    const connTbody = h('tbody');
    for (const c of [...connectors, { metaDataId: null, name: 'Deleted Connectors' }]) {
        const input = h('input', { type: 'checkbox', checked: isConnChecked(c.metaDataId) });
        connRows.push({ key: c.metaDataId, input });
        connTbody.appendChild(h('tr',
            h('td', { class: 'w-[50px]' }, c.metaDataId === null ? '--' : String(c.metaDataId)),
            h('td', c.name),
            h('td', { class: 'text-center w-[90px]' }, input)));
    }
    const setAllConn = (v) => connRows.forEach(r => { r.input.checked = v; });
    const connBlock = h('div',
        h('div', { class: 'flex justify-end gap-2.5 mb-1.5' },
            h('a', { class: 'link-btn', onClick: () => setAllConn(true) }, 'Select All'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAllConn(false) }, 'Deselect All')),
        h('div.dt-wrap', { class: 'max-h-[150px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', 'Id'), h('th', 'Current Connector Name'), h('th', 'Included'))),
                connTbody)));

    /* ---- id / numeric ranges (stacked "label: min – max" rows) ---- */
    const num = (value) => h('input', { type: 'number', value, class: 'flex-1 min-w-0 max-w-[150px]' });
    const inputs = {
        minMessageId: num(adv.minMessageId), maxMessageId: num(adv.maxMessageId),
        minOriginalId: num(adv.minOriginalId), maxOriginalId: num(adv.maxOriginalId),
        minImportId: num(adv.minImportId), maxImportId: num(adv.maxImportId),
        minSendAttempts: num(adv.minSendAttempts), maxSendAttempts: num(adv.maxSendAttempts),
        serverId: h('input', { type: 'text', value: adv.serverId, class: 'flex-1' })
    };
    const lbl = (text) => h('label', { class: 'w-[110px] flex-none text-right text-text-dim' }, text);
    const rangeRow = (label, a, b) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), a, h('span.text-text-faint', '–'), b);
    const singleRow = (label, el) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), el);

    const attachmentCheck = checkbox('Has Attachment', adv.attachment);
    const errorCheck = checkbox('Has Error', adv.error);

    /* ---- selectable search tables with right-side New/Delete ---- */
    function makeSelectableTable(head) {
        const tbody = h('tbody');
        const rows = [];
        let selected = null;
        const delBtn = h('button.btn', { disabled: true });
        const sel = (row) => {
            selected = row;
            tbody.querySelectorAll('tr').forEach(tr => tr.classList.remove('selected'));
            if (row) row.tr.classList.add('selected');
            delBtn.disabled = !row;
        };
        delBtn.addEventListener('click', () => {
            if (!selected) return;
            const i = rows.indexOf(selected);
            selected.tr.remove();
            rows.splice(i, 1);
            sel(rows[Math.min(i, rows.length - 1)] ?? null);
        });
        const el = (onNew) => h('div', { class: 'flex gap-2 items-start' },
            h('div.dt-wrap', { class: 'flex-1 max-h-[150px] overflow-auto' },
                h('table.dt', h('thead', h('tr', head.map(l => h('th', l)))), tbody)),
            h('div', { class: 'flex flex-col gap-1.5' },
                h('button.btn', { onClick: onNew }, 'New'), delBtn));
        delBtn.textContent = 'Delete';
        return { tbody, rows, sel, el };
    }

    /* Content Searches — one repeatable query param per content type. */
    const cs = makeSelectableTable(['Content Type', 'Contains']);
    function addContentSearchRow(type = 'rawContentSearch', text = '') {
        const row = {
            type: select(CONTENT_SEARCH_TYPES, type),
            text: h('input', { type: 'text', value: text, class: 'w-full' })
        };
        row.tr = h('tr', { onMousedown: () => cs.sel(row) }, h('td', row.type), h('td', row.text));
        cs.rows.push(row);
        cs.tbody.appendChild(row.tr);
        cs.sel(row);
        return row;
    }
    adv.contentSearches.forEach(c => addContentSearchRow(c.type, c.text));

    /* Custom Metadata searches — "COLUMN OPERATOR value" strings. */
    const ms = makeSelectableTable(['Metadata', 'Operator', 'Value', 'Ignore Case']);
    function addMetaSearchRow(column, operator = 'CONTAINS', value = '', ignoreCase = false) {
        const row = {
            column: metaDataColumns.length
                ? select(metaDataColumns.map(c => c.name), column ?? metaDataColumns[0].name)
                : h('input', { type: 'text', value: column ?? '', placeholder: 'COLUMN_NAME' }),
            operator: select(META_SEARCH_OPERATORS, operator),
            value: h('input', { type: 'text', value, class: 'w-full' }),
            ignoreCase: h('input', { type: 'checkbox', checked: ignoreCase, title: 'Ignore case' })
        };
        row.tr = h('tr', { onMousedown: () => ms.sel(row) },
            h('td', row.column), h('td', row.operator), h('td', row.value),
            h('td', { class: 'text-center w-[90px]' }, row.ignoreCase));
        ms.rows.push(row);
        ms.tbody.appendChild(row.tr);
        ms.sel(row);
        return row;
    }
    adv.metaDataSearches.forEach(m => addMetaSearchRow(m.column, m.operator, m.value, m.ignoreCase));

    const sectionLabel = (text) => h('div', { class: 'font-semibold mt-3.5 mx-0 mb-1.5' }, text);

    modal({
        title: 'Advanced Search Filter',
        size: 'wide',
        body: h('div',
            connBlock,
            h('div', { class: 'mt-3.5' },
                rangeRow('Message Id:', inputs.minMessageId, inputs.maxMessageId),
                rangeRow('Original Id:', inputs.minOriginalId, inputs.maxOriginalId),
                rangeRow('Import Id:', inputs.minImportId, inputs.maxImportId),
                singleRow('Server Id:', inputs.serverId),
                rangeRow('Send Attempts:', inputs.minSendAttempts, inputs.maxSendAttempts)),
            h('div', { class: 'flex gap-6 mt-1' },
                attachmentCheck.el, errorCheck.el),
            sectionLabel('Content Searches'),
            cs.el(() => addContentSearchRow().text.focus()),
            sectionLabel('Custom Metadata Searches'),
            ms.el(() => addMetaSearchRow().value.focus())),
        buttons: [
            {
                label: 'Reset',
                onClick: () => { onApply(defaultAdvancedCriteria()); }
            },
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: () => {
                    // Resolve the connector table into included/excluded ids.
                    let included = null, excluded = null;
                    const checked = connRows.filter(r => r.input.checked);
                    if (checked.length !== connRows.length) {
                        if (connRows.some(r => r.key === null && r.input.checked)) {
                            excluded = connRows.filter(r => !r.input.checked && r.key !== null).map(r => r.key);
                        } else {
                            included = checked.map(r => r.key).filter(k => k !== null);
                        }
                    }
                    // Stage the criteria + flag the button; the user runs the
                    // search with Search (no auto-search on apply).
                    onApply({
                        minMessageId: inputs.minMessageId.value, maxMessageId: inputs.maxMessageId.value,
                        minOriginalId: inputs.minOriginalId.value, maxOriginalId: inputs.maxOriginalId.value,
                        minImportId: inputs.minImportId.value, maxImportId: inputs.maxImportId.value,
                        serverId: inputs.serverId.value,
                        minSendAttempts: inputs.minSendAttempts.value, maxSendAttempts: inputs.maxSendAttempts.value,
                        error: errorCheck.input.checked,
                        attachment: attachmentCheck.input.checked,
                        includedMetaDataIds: included,
                        excludedMetaDataIds: excluded,
                        contentSearches: cs.rows
                            .map(r => ({ type: r.type.value, text: r.text.value.trim() }))
                            .filter(r => r.text),
                        metaDataSearches: ms.rows
                            .map(r => ({ column: String(r.column.value).trim(), operator: r.operator.value, value: r.value.value, ignoreCase: r.ignoreCase.checked }))
                            .filter(r => r.column)
                    });
                }
            }
        ]
    });
}

/* ---- reprocess dialog ------------------------------------------------------------- */

/* Shared "Reprocessing Options" dialog (Swing ReprocessMessagesDialog) — used
   for both a single message and the whole result set. Overwrite checkbox +
   a "reprocess through the following destinations" table with Select All /
   Deselect All. All checked = reprocess through all (filterDestinations off);
   a subset turns on filterDestinations with those metaDataIds. The results
   variant adds the red warning and the REPROCESSALL confirmation. */
function reprocessDialog({ channelId, connectors, total, lastParams, messageId, isResults, onDone }) {
    const destRows = connectors.filter(c => Number(c.metaDataId) > 0).map(c => ({
        metaDataId: c.metaDataId, name: c.name,
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const overwrite = checkbox('Overwrite existing messages and update statistics', false);
    const setAll = (v) => destRows.forEach(r => { r.input.checked = v; });

    const destTable = destRows.length ? h('div',
        h('div', { class: 'flex justify-end gap-2.5 my-1 mx-0' },
            h('a', { class: 'link-btn', onClick: () => setAll(true) }, 'Select All'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAll(false) }, 'Deselect All')),
        h('div.dt-wrap', { class: 'max-h-[160px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', 'Destination'), h('th', { class: 'w-[90px]' }, 'Included'))),
                h('tbody', destRows.map(d => h('tr',
                    h('td', d.name || `Destination ${d.metaDataId}`),
                    h('td', { class: 'text-center' }, d.input))))))) : null;

    modal({
        title: 'Reprocessing Options',
        size: 'wide',
        body: h('div',
            isResults ? h('div', {
                class: 'text-err mb-2.5 text-[12.5px]'
            }, h('b', 'Warning: '), `This will reprocess all ${fmtNumber(total)} result(s) for the current search criteria, including those not listed on the current page.`) : null,
            overwrite.el,
            destRows.length ? h('div.mt-[14px]', 'Reprocess through the following destinations:') : null,
            destTable),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: async () => {
                    const checked = destRows.filter(r => r.input.checked).map(r => r.metaDataId);
                    // No destinations, or all checked → reprocess through all (no filter).
                    const metaDataIds = (!destRows.length || checked.length === destRows.length) ? null : checked;
                    const filterDestinations = metaDataIds != null;
                    // The REPROCESSALL confirmation is gated on the
                    // "Reprocess/remove messages confirmation" preference.
                    if (isResults && getPref('confirmReprocessRemove') !== false) {
                        const answer = await promptDialog('Reprocess Results',
                            'This will reprocess all messages matching the current search criteria. Type REPROCESSALL to continue.');
                        if (answer === null) return false;
                        if (String(answer).trim() !== 'REPROCESSALL') {
                            toast('You must type REPROCESSALL to reprocess results.', 'warn');
                            return false;
                        }
                    }
                    try {
                        if (isResults) {
                            await api.post(`/channels/${channelId}/messages/_reprocess`, null, {
                                params: { ...lastParams, replace: overwrite.input.checked, filterDestinations, metaDataId: metaDataIds || [] }
                            });
                            toast('Reprocess task submitted');
                        } else {
                            await api.messages.reprocess(channelId, messageId, overwrite.input.checked, filterDestinations, metaDataIds || []);
                            toast('Reprocess task sent');
                        }
                        onDone();
                    } catch (e) {
                        toast(`Reprocess failed: ${e.message}`, 'error');
                        return false;
                    }
                }
            }
        ]
    });
}

/* ---- export results dialog -------------------------------------------------------- */

/* Content selectable for export, mirroring the Swing MessageExportPanel
   dropdown. 'xml' is the full serialized (re-importable) message; the rest
   extract one connector content type from the source or destination
   connector message(s). `ct` is the engine ContentType enum name used for
   the server-side _export endpoint. */
const EXPORT_CONTENT_OPTIONS = [
    { value: 'xml', label: 'XML serialized message', xml: true },
    { value: 'src:raw', label: 'Source - Raw', key: 'raw', ct: 'RAW', dest: false },
    { value: 'src:processedRaw', label: 'Source - Processed Raw', key: 'processedRaw', ct: 'PROCESSED_RAW', dest: false },
    { value: 'src:transformed', label: 'Source - Transformed', key: 'transformed', ct: 'TRANSFORMED', dest: false },
    { value: 'src:encoded', label: 'Source - Encoded', key: 'encoded', ct: 'ENCODED', dest: false },
    { value: 'src:response', label: 'Source - Response', key: 'response', ct: 'RESPONSE', dest: false },
    { value: 'dst:raw', label: 'Destination - Raw', key: 'raw', ct: 'RAW', dest: true },
    { value: 'dst:transformed', label: 'Destination - Transformed', key: 'transformed', ct: 'TRANSFORMED', dest: true },
    { value: 'dst:encoded', label: 'Destination - Encoded', key: 'encoded', ct: 'ENCODED', dest: true },
    { value: 'dst:sent', label: 'Destination - Sent', key: 'sent', ct: 'SENT', dest: true },
    { value: 'dst:response', label: 'Destination - Response', key: 'response', ct: 'RESPONSE', dest: true },
    { value: 'dst:processedResponse', label: 'Destination - Processed Response', key: 'processedResponse', ct: 'PROCESSED_RESPONSE', dest: true }
];

/* File Pattern variables (Swing MessageExportPanel variable list). */
const FILE_PATTERN_VARS = [
    ['Message ID', '${message.messageId}'],
    ['Server ID', '${message.serverId}'],
    ['Channel ID', '${message.channelId}'],
    ['Original File Name', '${message.originalFileName}'],
    ['Formatted Message Date', '${message.formattedMessageDate}'],
    ['Formatted Current Date', '${message.formattedCurrentDate}'],
    ['Timestamp', '${message.timestamp}'],
    ['Unique ID', '${message.uniqueId}'],
    ['Count', '${message.count}']
];
const DEFAULT_FILE_PATTERN = '${message.channelId}_message_${message.messageId}.xml';

/* Password-protect algorithms — display name -> { server (EncryptionType),
   strength (core/zip.js generate option) }. */
const ENCRYPTION_ALGORITHMS = [
    { value: 'AES128', label: 'AES-128', strength: 128 },
    { value: 'AES256', label: 'AES-256', strength: 256 },
    { value: 'STANDARD', label: 'Standard', strength: 'standard' }
];

const dateStamp = (millis) => (fmtDate(millis) || '').replace(/[:\s]/g, '-');

/* Resolve a Swing-style file pattern for one message (My Computer mode).
   `count` is the 1-based running export index. Illegal filename characters
   are sanitized; '/' is kept so patterns may define sub-folders. */
function applyFilePattern(pattern, m, count, channelId) {
    const now = Date.now();
    const vals = {
        'message.messageId': String(m.messageId ?? ''),
        'message.serverId': String(displayValue(m.serverId) ?? ''),
        'message.channelId': String(channelId),
        'message.originalFileName': String(displayValue(m.importId) || m.messageId || ''),
        'message.formattedMessageDate': dateStamp(m.receivedDate),
        'message.formattedCurrentDate': dateStamp(now),
        'message.timestamp': String(now),
        'message.uniqueId': (crypto.randomUUID ? crypto.randomUUID() : `${now}-${count}`),
        'message.count': String(count)
    };
    return (pattern || DEFAULT_FILE_PATTERN)
        .replace(/\$\{([^}]+)\}/g, (_, name) => {
            const k = String(name).trim();
            return Object.prototype.hasOwnProperty.call(vals, k) ? vals[k] : '';
        })
        .replace(/[\\:*?"<>|]+/g, '_');
}

/* Insert a value before the last dot of a filename (to disambiguate
   multiple destination files that share one pattern). */
function suffixName(name, suffix) {
    const dot = name.lastIndexOf('.');
    return dot > name.lastIndexOf('/') ? `${name.slice(0, dot)}_${suffix}${name.slice(dot)}` : `${name}_${suffix}`;
}

/* Full Swing-style "Export Results" dialog (MessageExportDialog /
   MessageExportPanel). Operates on the whole result set for the current
   search filter. My Computer exports run in the browser (ZIP via the Save
   dialog, or one file per message into a chosen folder); Server export
   defers the whole job to POST /messages/_export (which holds the
   encryption key, so content Encrypt is fully supported there). */
function exportResultsDialog({ channelId, total, lastParams }) {
    let aborted = false, running = false;

    const contentSel = select(EXPORT_CONTENT_OPTIONS, 'xml', { onChange: updateEnabled });
    const encryptCheck = checkbox('Encrypt', false);
    const attachCheck = checkbox('Include Attachments', false);
    const compressionSel = select([{ value: 'none', label: 'None' }, { value: 'zip', label: 'Zip' }], 'none', { onChange: updateEnabled });

    const radio = (name, checked) => h('input', { type: 'radio', name, checked: checked || null, onChange: updateEnabled });
    const radioLabel = (input, text) => h('label', { class: 'inline-flex items-center gap-1 cursor-pointer' }, input, text);
    const pwYes = radio('exp-pw'); const pwNo = radio('exp-pw', true);
    const algoSel = select(ENCRYPTION_ALGORITHMS, 'AES128');
    const pwInput = h('input', { type: 'password', placeholder: 'Password', class: 'w-full' });
    const toServer = radio('exp-to'); const toComputer = radio('exp-to', true);

    const rootInput = h('input', { type: 'text', placeholder: '/path/accessible/by/server', class: 'flex-1' });
    const patternInput = h('textarea', { rows: '3', class: 'w-full font-[family-name:var(--mono)] resize-y' });
    patternInput.value = DEFAULT_FILE_PATTERN;

    const insertToken = (token) => {
        const s = patternInput.selectionStart ?? patternInput.value.length;
        const e = patternInput.selectionEnd ?? s;
        patternInput.value = patternInput.value.slice(0, s) + token + patternInput.value.slice(e);
        const p = s + token.length;
        patternInput.focus(); patternInput.setSelectionRange(p, p);
    };
    const varList = h('div.tree', { class: 'max-h-[150px] overflow-auto border border-[var(--border)] rounded-[4px] p-1' },
        FILE_PATTERN_VARS.map(([label, token]) => h('div.tree-node', {
            title: `Insert ${token}`, draggable: 'true', class: 'cursor-grab',
            onClick: () => insertToken(token),
            onDragstart: (e) => { e.dataTransfer.setData('text/plain', token); e.dataTransfer.effectAllowed = 'copy'; }
        }, label)));

    const status = h('div.text-text-faint', `${fmtNumber(total)} message(s) match the current search.`);
    const fill = h('div.progress-fill', { class: 'w-[0%]' });
    // A progressbar, not an anonymous div: an export of tens of thousands of
    // messages is the one long operation in the app, and its state was visual only.
    const barWrap = h('div.progress', {
        style: { display: 'none' },
        role: 'progressbar', 'aria-label': 'Export progress',
        'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0'
    }, fill);

    function updateEnabled() {
        const opt = EXPORT_CONTENT_OPTIONS.find(o => o.value === contentSel.value) || EXPORT_CONTENT_OPTIONS[0];
        const server = toServer.checked;
        // My Computer always downloads a single ZIP (the browser's Save dialog
        // chooses the location); Compression only applies to Server export.
        if (!server) compressionSel.value = 'zip';
        compressionSel.disabled = !server;
        const zip = compressionSel.value === 'zip';
        attachCheck.input.disabled = !opt.xml;
        if (!opt.xml) attachCheck.input.checked = false;
        pwYes.disabled = pwNo.disabled = !zip;
        if (!zip) { pwYes.checked = false; pwNo.checked = true; }
        algoSel.disabled = pwInput.disabled = !(zip && pwYes.checked);
        rootInput.disabled = !server;
    }

    // Swing MessageExportPanel layout: a right-aligned label column with its
    // controls, and the file-pattern variable list in a side panel.
    const lbl = (t) => h('div', { class: 'text-right whitespace-nowrap self-center' }, t);
    const cell = (...c) => h('div', { class: 'flex items-center gap-2 flex-wrap' }, ...c);
    const grid = h('div', { class: 'grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-2 items-center' },
        lbl('Content:'), cell(contentSel, encryptCheck.el, attachCheck.el),
        lbl('Compression:'), cell(compressionSel),
        lbl('Password Protect:'), cell(radioLabel(pwYes, 'Yes'), radioLabel(pwNo, 'No'), algoSel),
        lbl('Password:'), cell(pwInput),
        lbl('Export To:'), cell(radioLabel(toServer, 'Server'), radioLabel(toComputer, 'My Computer')),
        lbl('Root Path:'), cell(rootInput, h('span.text-text-faint', { class: 'whitespace-nowrap' }, '/[timestamp].zip')),
        lbl('File Pattern:'), cell(patternInput));

    const dlg = modal({
        title: 'Export Results',
        size: 'wide',
        body: h('div', { class: 'flex flex-wrap gap-[18px]' },
            h('div', { class: 'flex-1 min-w-[260px] flex flex-col gap-2' }, grid, status, barWrap),
            h('div', { class: 'w-full sm:w-[200px] min-w-0 flex flex-col' },
                h('label', { class: 'block mb-0.5' }, 'Variables:'),
                varList)),
        buttons: [
            { label: 'Cancel', onClick: () => { aborted = true; } },
            { label: 'Export', primary: true, onClick: () => { if (!running) runExport(); return false; } }
        ]
    });
    updateEnabled();

    function setDisabled(v) {
        for (const c of [contentSel, encryptCheck.input, attachCheck.input, compressionSel, pwYes, pwNo, algoSel, pwInput, toServer, toComputer, rootInput, patternInput]) c.disabled = v;
        if (!v) updateEnabled();
    }
    function progress(done) {
        fill.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';
        barWrap.setAttribute('aria-valuenow', String(done));
        status.textContent = `Exporting… ${fmtNumber(done)} / ${fmtNumber(total)}`;
    }

    // Stream every export file to `sink(name, content)`; returns counts.
    async function eachFile(sink, opt, pattern, includeAttachments) {
        const BATCH = 100;
        let done = 0, files = 0, count = 0;
        for (let off = 0; off < total && !aborted; off += BATCH) {
            const rows = await api.messages.search(channelId, { ...lastParams, offset: off, limit: BATCH, includeContent: !opt.xml });
            for (const m of rows) {
                if (aborted) break;
                count++;
                const base = applyFilePattern(pattern, m, count, channelId);
                if (opt.xml) {
                    const resp = await fetch(`/api/channels/${channelId}/messages/${m.messageId}`, {
                        headers: { 'Accept': 'application/xml', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                        credentials: 'same-origin'
                    });
                    if (resp.ok) { await sink(base, await resp.text()); files++; }
                    if (includeAttachments) files += await sinkAttachments(sink, m, base);
                } else {
                    const cms = connectorMessagesOf(m).filter(cm => opt.dest ? Number(cm.metaDataId) > 0 : Number(cm.metaDataId) === 0);
                    for (const cm of cms) {
                        const c = contentOf(cm[opt.key]);
                        if (c == null) continue;
                        await sink(cms.length > 1 ? suffixName(base, cm.metaDataId) : base, c);
                        files++;
                    }
                }
                done++;
                progress(done);
            }
        }
        return { done, files };
    }

    // Best-effort: write each attachment alongside the message file (My
    // Computer mode). Server export embeds attachments natively instead.
    async function sinkAttachments(sink, m, base) {
        let n = 0;
        try {
            const resp = await fetch(`/api/channels/${channelId}/messages/${m.messageId}/attachments?includeContent=true`, {
                headers: { 'Accept': 'application/xml', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                credentials: 'same-origin'
            });
            if (!resp.ok) return 0;
            const raw = parseResponse(await resp.text());
            const noExt = base.replace(/\.[^./]+$/, '');
            for (const att of api.asList(raw?.list?.attachment ?? raw?.attachment ?? raw)) {
                const id = displayValue(att?.id); if (!id) continue;
                const type = displayValue(att?.type) || '';
                let content = att?.content ?? att;
                if (typeof content !== 'string') content = displayValue(content);
                let payload = content;
                try {
                    const bin = atob(String(content).replace(/\s+/g, ''));
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    payload = isTextualAttachment(type) ? new TextDecoder().decode(bytes) : bytes;
                } catch { /* not base64 */ }
                await sink(`${noExt}_attachment_${id}${attachmentExtension(type)}`, payload);
                n++;
            }
        } catch { /* attachments are best-effort */ }
        return n;
    }

    async function runServerExport(o) {
        running = true; setDisabled(true); barWrap.style.display = '';
        status.textContent = 'Submitting server export…';
        try {
            const params = { ...lastParams };
            delete params.offset; delete params.limit; delete params.includeContent;
            params.pageSize = 100;
            params.rootFolder = o.rootFolder;
            params.filePattern = o.pattern;
            params.encrypt = o.encryptContent;
            params.includeAttachments = o.includeAttachments;
            if (!o.opt.xml) { params.contentType = o.opt.ct; params.destinationContent = o.opt.dest; }
            if (o.compression === 'zip') {
                params.archiveFormat = 'zip';
                if (o.pwProtect && o.password) { params.password = o.password; params.encryptionType = o.algo.value; }
            }
            const count = await api.post(`/channels/${channelId}/messages/_export`, null, { params });
            toast(`Server exported ${fmtNumber(Number(count) || 0)} message(s) to ${o.rootFolder}`);
            dlg.close();
        } catch (e) {
            toast(`Server export failed: ${e.message}`, 'error');
            running = false; setDisabled(false);
        }
    }

    async function runExport() {
        const opt = EXPORT_CONTENT_OPTIONS.find(o => o.value === contentSel.value) || EXPORT_CONTENT_OPTIONS[0];
        const compression = compressionSel.value;
        const pattern = patternInput.value.trim() || DEFAULT_FILE_PATTERN;
        const encryptContent = encryptCheck.input.checked;
        const includeAttachments = attachCheck.input.checked && opt.xml;
        const pwProtect = pwYes.checked && compression === 'zip';
        const algo = ENCRYPTION_ALGORITHMS.find(a => a.value === algoSel.value) || ENCRYPTION_ALGORITHMS[0];
        const password = pwInput.value;

        if (toServer.checked) {
            if (!rootInput.value.trim()) { toast('Enter a Root Path for server export', 'warn'); return; }
            if (pwProtect && !password) { toast('Enter a password, or turn off Password protect', 'warn'); return; }
            return runServerExport({ opt, compression, pattern, encryptContent, includeAttachments, pwProtect, algo, password, rootFolder: rootInput.value.trim() });
        }

        // My Computer (browser) export.
        if (encryptContent) {
            toast('Content encryption requires "Server" export — the encryption key stays on the server. Switch Export To: Server, or uncheck Encrypt.', 'warn');
            return;
        }
        if (pwProtect && !password) { toast('Enter a password, or turn off Password protect', 'warn'); return; }

        running = true; aborted = false; setDisabled(true); barWrap.style.display = '';
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const archiveName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.zip`;
        const buildZip = async () => {
            const zip = createZip();
            const result = await eachFile((n, c) => { zip.add(n, c); }, opt, pattern, includeAttachments);
            if (aborted) throw new Error('cancelled');
            if (!result.files) throw new Error('No content of that type found in the results');
            const blob = await zip.generate(pwProtect ? { password, strength: algo.strength } : {});
            buildZip.result = result;
            return blob;
        };

        try {
            // My Computer always downloads a single ZIP; the browser's Save
            // dialog (where supported) lets the user choose the location,
            // otherwise it goes to the default download folder.
            await saveFile(archiveName, 'application/zip', buildZip);
            // buildZip.result is unset if the user cancelled the Save dialog.
            if (buildZip.result) {
                const r = buildZip.result;
                toast(`Exported ${fmtNumber(r.files)} file(s) from ${fmtNumber(r.done)} message(s)`);
                dlg.close();
            } else {
                running = false; setDisabled(false); barWrap.style.display = 'none';
            }
        } catch (e) {
            if (e && e.message === 'cancelled') { toast('Export cancelled', 'warn'); dlg.close(); }
            else { toast(`Export failed: ${e.message}`, 'error'); running = false; setDisabled(false); barWrap.style.display = 'none'; }
        }
    }
}

/* ---- the view --------------------------------------------------------------------- */

/* Multi-select status filter — the Swing browser's status checkboxes (any
   combination). A compact dropdown trigger opens a checklist; buildParams()
   emits one `status=` query param per selected status. */
const STATUS_FILTER_ORDER = ['RECEIVED', 'TRANSFORMED', 'FILTERED', 'QUEUED', 'SENT', 'ERROR', 'PENDING'];

function Field({ label, children }) {
    return <div className="field"><label>{label}</label>{children}</div>;
}

export function MessagesView({ params, query }) {
    const channelId = params.channelId;

    /* ---- search-engine state ------------------------------------------------
       Search is an explicit command, so its cursor lives in refs the commands
       mutate synchronously; the render-relevant results mirror into state.
       searchRef re-points to this render's runSearch so dialogs and context
       menus (which outlive the render that opened them) always call a fresh
       closure. */
    const offsetRef = useRef(0);
    const limitRef = useRef(Number(getPref('messagePageSize')) || 20);
    const totalRef = useRef(null);   // full match count — null until counted (lazy) or auto-resolved on the last page
    const lastParamsRef = useRef({});
    const searchRef = useRef(null);
    // Latest selection mirror: async detail loads guard against a stale row, and
    // task-pane buttons resolve their target at execution time.
    const selectedRef = useRef(null);

    // Staged advanced criteria (the dialog stages; Search runs). Deep-link from
    // the dashboard (double-click a connector row): pre-filter the search to
    // that single connector by its metaDataId.
    const advRef = useRef(null);
    if (!advRef.current) {
        advRef.current = defaultAdvancedCriteria();
        if (query.metaDataId != null && query.metaDataId !== '') {
            advRef.current.includedMetaDataIds = [Number(query.metaDataId)];
        }
    }

    /* ---- criteria state ---- */
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [statusSel, setStatusSel] = useState(() => new Set());
    const [textSearch, setTextSearch] = useState('');
    const [textRegex, setTextRegex] = useState(false);
    const [connectorVal, setConnectorVal] = useState('');
    const [pageSize, setPageSize] = useState(() => String(Number(getPref('messagePageSize')) || 20));
    const [advOn, setAdvOn] = useState(() => advIsActive(advRef.current));
    const [searchSummary, setSearchSummary] = useState('Current Search: (none — press Search)');
    const [criteriaCollapsed, setCriteriaCollapsed] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);

    /* ---- results + table state ---- */
    const [connectors, setConnectors] = useState([]);
    const [channelName, setChannelName] = useState(channelId);
    const [metaDataColumns, setMetaDataColumns] = useState([]);
    const [messages, setMessages] = useState([]);
    // shown: null = no search has completed yet (blank counts label, legacy
    // parity) — distinct from a completed search with zero rows ('No results').
    const [pager, setPager] = useState({ offset: 0, shown: null, total: null, hasNext: false });
    const [countBusy, setCountBusy] = useState(false);
    const [sort, setSort] = useState({ key: 'id', dir: -1 });   // newest first by default
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [allExpanded, setAllExpanded] = useState(false);
    const [selected, setSelected] = useState(null);             // {m, metaDataId}
    const [detail, setDetail] = useState({ status: 'empty' });

    /* Column visibility (persisted separately from the manager, matching the
       legacy webadmin-msg-columns store — `def` flags are the fallback). */
    const [columnVis, setColumnVis] = useState(() => {
        try { return JSON.parse(localStorage.getItem('webadmin-msg-columns') || '{}'); } catch { return {}; }
    });
    const saveColumnVis = (v) => { try { localStorage.setItem('webadmin-msg-columns', JSON.stringify(v)); } catch { /* private mode */ } };
    const isVisible = (c, vis) => (c.key in vis) ? !!vis[c.key] : !!c.def;

    // Column order + widths (resizable / reorderable, persisted), like the
    // dashboard. Visibility stays with columnVis above; the manager owns only
    // order + widths. columnsRev bumps after manager mutations to re-render.
    const mgrRef = useRef(null);
    if (!mgrRef.current) mgrRef.current = createColumnManager('messages', MSG_COL_WIDTHS);
    const mgr = mgrRef.current;
    const [columnsRev, setColumnsRev] = useState(0);

    const allCols = useMemo(() => buildColumns(channelName, metaDataColumns), [channelName, metaDataColumns]);
    const visibleCols = useMemo(() => {
        const present = allCols.filter(c => isVisible(c, columnVis));
        return mgr.order(present.map(c => c.key)).map(k => present.find(c => c.key === k));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCols, columnVis, columnsRev]);

    const sortedMessages = useMemo(() => {
        const col = allCols.find(c => c.key === sort.key);
        if (!col) return messages;
        return [...messages].sort((a, b) => {
            const va = col.sort(a), vb = col.sort(b);
            return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        });
    }, [messages, sort, allCols]);

    /* ---- params + summary (built from the live criteria at search time) ---- */

    function buildParams() {
        const adv = advRef.current;
        const params = {};
        const start = toCalendarParam(startDate);
        const end = toCalendarParam(endDate);
        if (start) params.startDate = start;
        if (end) params.endDate = end;
        if (statusSel.size) params.status = [...statusSel];
        const text = textSearch.trim();
        if (text) {
            params.textSearch = text;
            if (textRegex) params.textSearchRegex = true;
        }
        // Connector inclusion: the advanced filter's table wins; otherwise the
        // quick Connector dropdown narrows to a single connector.
        if (adv.includedMetaDataIds) params.includedMetaDataId = adv.includedMetaDataIds;
        else if (adv.excludedMetaDataIds) params.excludedMetaDataId = adv.excludedMetaDataIds;
        else if (connectorVal !== '') params.includedMetaDataId = connectorVal;

        /* ---- advanced criteria (same query params on GET /messages, GET
           /messages/count, DELETE /messages and POST /messages/_reprocess) ---- */
        for (const key of ['minMessageId', 'maxMessageId', 'minOriginalId', 'maxOriginalId',
            'minImportId', 'maxImportId', 'minSendAttempts', 'maxSendAttempts']) {
            const value = String(adv[key]).trim();
            if (value !== '') params[key] = value;
        }
        if (adv.serverId.trim()) params.serverId = adv.serverId.trim();
        if (adv.error) params.error = true;
        if (adv.attachment) params.attachment = true;
        for (const cs of adv.contentSearches) {
            if (!cs.text) continue;
            (params[cs.type] = params[cs.type] || []).push(cs.text);
        }
        for (const ms of adv.metaDataSearches) {
            if (!ms.column) continue;
            // "COLUMN OPERATOR value" — MetaDataSearchParamConverterProvider format.
            const key = ms.ignoreCase ? 'metaDataCaseInsensitiveSearch' : 'metaDataSearch';
            (params[key] = params[key] || []).push(`${ms.column} ${ms.operator} ${ms.value}`);
        }
        return params;
    }

    /* Connectors clause for the search summary: included names, "all except …"
       for an excluded set, the quick dropdown's single connector, or "(any)". */
    function describeConnectors() {
        const adv = advRef.current;
        const nameOf = (id) => {
            const c = connectors.find(x => String(x.metaDataId) === String(id));
            return c ? c.name : `Id ${id}`;
        };
        if (adv.includedMetaDataIds) return adv.includedMetaDataIds.length ? adv.includedMetaDataIds.map(nameOf).join(', ') : '(none)';
        if (adv.excludedMetaDataIds) return `all except ${adv.excludedMetaDataIds.map(nameOf).join(', ')}`;
        if (connectorVal !== '') return nameOf(connectorVal);
        return '(any)';
    }

    /* Human-readable "Current Search" summary (Swing's labeled box) rather than a
       raw key=value dump. Statuses / Date Range / Connectors always show (with
       "(any)"); the rest appear only when set. */
    function describeSearch() {
        const adv = advRef.current;
        const range = (lo, hi) => {
            lo = String(lo ?? '').trim(); hi = String(hi ?? '').trim();
            if (lo && hi) return `${lo}–${hi}`;
            if (lo) return `≥ ${lo}`;
            if (hi) return `≤ ${hi}`;
            return null;
        };
        const dt = (v) => v ? v.replace('T', ' ') : '(any)';
        const parts = [];
        parts.push(`Statuses: ${statusSel.size ? [...statusSel].join(', ') : '(any)'}`);
        parts.push(`Date Range: ${dt(startDate)} to ${dt(endDate)}`);
        const text = textSearch.trim();
        if (text) parts.push(`Text Search: "${text}"${textRegex ? ' (regex)' : ''}`);
        parts.push(`Connectors: ${describeConnectors()}`);
        let r;
        if ((r = range(adv.minMessageId, adv.maxMessageId))) parts.push(`Message Id: ${r}`);
        if ((r = range(adv.minOriginalId, adv.maxOriginalId))) parts.push(`Original Id: ${r}`);
        if ((r = range(adv.minImportId, adv.maxImportId))) parts.push(`Import Id: ${r}`);
        if (adv.serverId.trim()) parts.push(`Server Id: ${adv.serverId.trim()}`);
        if ((r = range(adv.minSendAttempts, adv.maxSendAttempts))) parts.push(`Send Attempts: ${r}`);
        for (const cs of adv.contentSearches) {
            if (!cs.text) continue;
            const label = (CONTENT_SEARCH_TYPES.find(t => t.value === cs.type) || {}).label || cs.type;
            parts.push(`${label} contains "${cs.text}"`);
        }
        for (const ms of adv.metaDataSearches) {
            if (!ms.column) continue;
            parts.push(`${ms.column} ${ms.operator} ${ms.value}${ms.ignoreCase ? ' (ignore case)' : ''}`);
        }
        if (adv.attachment) parts.push('Has Attachment');
        if (adv.error) parts.push('Has Error');
        return parts.join(' · ');
    }

    /* ---- search (explicit command) ---- */

    async function runSearch(resetOffset) {
        if (resetOffset) {
            offsetRef.current = 0;
            lastParamsRef.current = buildParams();
            limitRef.current = Number(pageSize) || 20;
            setSearchSummary(`Current Search: ${describeSearch()}`);
            totalRef.current = null;   // lazily counted (Count button) or auto-resolved on the last page
        }
        try {
            // Fetch one extra row to learn whether a next page exists, instead of
            // paying for a COUNT on every search (Swing's lazy-count model).
            const rows = await api.messages.search(channelId, { ...lastParamsRef.current, offset: offsetRef.current, limit: limitRef.current + 1 });
            const list = rows.filter(m => m && typeof m === 'object');
            const hasNext = list.length > limitRef.current;
            if (hasNext) list.pop();   // drop the probe row
            // Last (or empty) page → the total is known for free; no COUNT needed.
            if (!hasNext) totalRef.current = offsetRef.current + list.length;
            selectedRef.current = null;
            setSelected(null);
            setDetail({ status: 'empty' });
            // Destinations expanded by default, matching the Swing browser.
            const exp = new Set();
            for (const m of list) {
                if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) exp.add(String(m.messageId));
            }
            setExpandedIds(exp);
            setAllExpanded(true);
            setMessages(list);
            setPager({ offset: offsetRef.current, shown: list.length, total: totalRef.current, hasNext });
        } catch (e) {
            toast(`Search failed: ${e.message}`, 'error');
        }
    }
    searchRef.current = runSearch;

    /* The total match count is resolved lazily (Swing's Count button): a COUNT is
       expensive on large tables, so we don't run one on every search. */
    async function ensureTotal() {
        if (totalRef.current == null) totalRef.current = toCount(await api.messages.count(channelId, lastParamsRef.current));
        return totalRef.current;
    }
    async function doCount() {
        setCountBusy(true);
        try { await ensureTotal(); }
        catch (e) { toast(`Count failed: ${e.message}`, 'error'); return; }
        finally { setCountBusy(false); }
        setPager(p => ({ ...p, total: totalRef.current }));
    }

    /* ---- selection + detail ---- */

    function selectMessage(m, metaDataId) {
        selectedRef.current = { m, metaDataId };
        setSelected({ m, metaDataId });
        // The parent (source) row is a placeholder when the source connector
        // message isn't in the result (e.g. a destination-only status filter):
        // there's no connector in context, so show nothing rather than fetching
        // the full message and rendering its source — matching the Swing browser.
        if (Number(metaDataId) === 0 && !sourceOf(m)) setDetail({ status: 'empty' });
        else showDetail(m, metaDataId);
    }

    async function showDetail(row, metaDataId) {
        setDetail({ status: 'loading' });
        let message = row;
        try {
            const [full, attachments] = await Promise.all([
                api.messages.get(channelId, row.messageId),
                // Fetch attachments up front so the Attachments tab only appears when
                // the message actually has any (matching the Swing browser).
                api.messages.attachments(channelId, row.messageId).catch(() => [])
            ]);
            if (full && typeof full === 'object') message = full;
            message.__attachments = Array.isArray(attachments) ? attachments : [];
        } catch (e) {
            toast(`Failed to load message content: ${e.message}`, 'error');
        }
        if (selectedRef.current?.m !== row) return; // selection changed while loading
        setDetail({ status: 'ready', message, metaDataId });
    }

    /* Detail pane height: the global .split-handle mutates style.height directly
       during drags, so React never renders the height — a layout effect applies
       the 36px collapsed strip / restored expanded height only on transitions,
       preserving the user-dragged height across selections (legacy parity). */
    const detailPaneRef = useRef(null);
    const detailHeightRef = useRef('38%');   // last expanded height
    const prevExpandedRef = useRef(false);
    const detailExpanded = detail.status !== 'empty';
    useLayoutEffect(() => {
        const el = detailPaneRef.current;
        if (!el) return;
        if (detailExpanded && !prevExpandedRef.current) {
            el.style.height = detailHeightRef.current;
        } else if (!detailExpanded) {
            if (prevExpandedRef.current) detailHeightRef.current = el.style.height || detailHeightRef.current;
            el.style.height = '36px';
        }
        prevExpandedRef.current = detailExpanded;
    }, [detailExpanded]);

    /* ---- table interactions ---- */

    function toggleAll() {
        const next = !allExpanded;
        setAllExpanded(next);
        const exp = new Set();
        if (next) for (const m of messages) {
            if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) exp.add(String(m.messageId));
        }
        setExpandedIds(exp);
    }

    function openColumnMenu(e) {
        e.preventDefault();
        const items = allCols.map(c => ({
            label: (isVisible(c, columnVis) ? '✓  ' : '    ') + c.label,
            onClick: () => setColumnVis(vis => {
                const next = { ...vis, [c.key]: !isVisible(c, vis) };
                saveColumnVis(next);
                return next;
            })
        }));
        items.push('-', { label: 'Restore Default', onClick: () => { saveColumnVis({}); setColumnVis({}); } });
        contextMenu(e.clientX, e.clientY, items);
    }

    // Right-click parity with the Swing Message Browser (Frame.messagePopupMenu —
    // the full Message Tasks list). Per-message items take this row explicitly —
    // the menu outlives the render that opened it, so it never reads selection
    // state that may have moved on.
    function messageRowMenu(m, metaDataId, e) {
        e.preventDefault();
        selectMessage(m, metaDataId);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshMessages', group: 'message', onClick: () => searchRef.current(true) },
            { label: 'Send Message', icon: 'send', task: 'doSendMessage', group: 'message', onClick: () => sendMessageTask() },
            '-',
            { label: 'Import Messages', icon: 'import', task: 'doImportMessages', group: 'message', onClick: () => importMessagesTask() },
            { label: 'Export Results', icon: 'export', task: 'doExportMessages', group: 'message', onClick: () => exportResultsTask() },
            '-',
            { label: 'Reprocess Results', icon: 'transform', task: 'doReprocessFilteredMessages', group: 'message', onClick: () => reprocessResultsTask() },
            { label: 'Reprocess Message', icon: 'transform', task: 'doReprocessMessage', group: 'message', onClick: () => reprocessTask(m) },
            '-',
            { label: 'View Attachment', icon: 'eye', task: 'viewImage', group: 'message', onClick: () => viewAttachmentsModal(platform, channelId, m) },
            { label: 'Export Attachment', icon: 'export', task: 'doExportAttachment', group: 'message', onClick: () => exportAttachmentTask(platform, channelId, m) },
            '-',
            { label: 'Remove Message', icon: 'trash', danger: true, task: 'doRemoveMessage', group: 'message', onClick: () => removeMessageTask(m) },
            { label: 'Remove Results', icon: 'trash', danger: true, task: 'doRemoveFilteredMessages', group: 'message', onClick: () => removeResultsTask() },
            { label: 'Remove All Messages', icon: 'trash', danger: true, task: 'doRemoveAllMessages', group: 'message', onClick: () => removeAllTask() }
        ]);
    }

    /* ---- tasks ---- */

    function requireSelection() {
        const sel = selectedRef.current;
        if (!sel) { toast('Select a message first', 'warn'); return null; }
        return sel.m;
    }

    function sendMessageTask() {
        openSendMessageDialog(platform, channelId, () => searchRef.current(false));
    }

    function reprocessTask(row = requireSelection()) {
        if (!row) return;
        reprocessDialog({
            channelId, connectors, total: totalRef.current, lastParams: lastParamsRef.current,
            messageId: row.messageId, isResults: false, onDone: () => searchRef.current(false)
        });
    }

    async function removeMessageTask(row = requireSelection()) {
        if (!row) return;
        if (getPref('confirmReprocessRemove') !== false &&
            !await confirmDialog('Remove message', `Permanently remove message ${row.messageId}? This cannot be undone.`, { danger: true, okLabel: 'Remove' })) return;
        try {
            await api.messages.remove(channelId, row.messageId);
            toast('Message removed');
            searchRef.current(false);
        } catch (e) {
            toast(`Remove failed: ${e.message}`, 'error');
        }
    }

    async function removeAllTask() {
        if (getPref('confirmReprocessRemove') !== false &&
            !await confirmDialog('Remove all messages', `Permanently remove ALL messages from ${channelName}? This cannot be undone.`, { danger: true, okLabel: 'Remove All' })) return;
        try {
            await api.messages.removeAll(channelId);
            toast('All messages removed');
            searchRef.current(true);
        } catch (e) {
            toast(`Remove all failed: ${e.message}`, 'error');
        }
    }

    /* ---- results operations (operate on the current search filter) ---- */

    async function removeResultsTask() {
        const filter = { ...lastParamsRef.current };
        try { await ensureTotal(); }
        catch (e) { toast(`Count failed: ${e.message}`, 'error'); return; }
        if (getPref('confirmReprocessRemove') !== false) {
            const text = await promptDialog('Remove Results',
                `Permanently remove all ${fmtNumber(totalRef.current)} message(s) matching the current search from ${channelName}? ` +
                'This cannot be undone. Type REMOVE to confirm.');
            if (text === null) return;
            if (text.trim() !== 'REMOVE') {
                toast('Confirmation text did not match — nothing was removed', 'warn');
                return;
            }
        }
        try {
            // DELETE /channels/{id}/messages is the query-param twin of POST
            // _remove (which takes a MessageFilter body); it accepts the exact
            // search params already built for GET /messages.
            await api.del(`/channels/${channelId}/messages`, filter);
            toast('Messages removed');
            searchRef.current(true);
        } catch (e) {
            toast(`Remove results failed: ${e.message}`, 'error');
        }
    }

    async function reprocessResultsTask() {
        try { await ensureTotal(); }
        catch (e) { toast(`Count failed: ${e.message}`, 'error'); return; }
        reprocessDialog({
            channelId, connectors, total: totalRef.current, lastParams: lastParamsRef.current,
            isResults: true, onDone: () => searchRef.current(false)
        });
    }

    async function importMessagesTask() {
        const file = await pickFile('.xml,application/xml,text/xml');
        if (!file) return;
        // Engine-exported files hold serialized <message>...</message> blocks
        // (optionally inside <list>), exactly what the Swing MessageImporter
        // scans for. POST /messages/_import takes one Message per request; the
        // server assigns a fresh message ID and keeps the original as importId
        // (Channel.importMessage), so the XML is posted unmodified.
        const blocks = String(file.content).match(/<message>[\s\S]*?<\/message>/g) || [];
        if (!blocks.length) {
            toast('No <message> elements found — pick an XML file exported by the engine', 'warn');
            return;
        }
        let imported = 0;
        let failed = 0;
        let lastError = null;
        for (const xml of blocks) {
            try {
                await api.post(`/channels/${channelId}/messages/_import`, xml, { contentType: 'application/xml' });
                imported++;
            } catch (e) {
                failed++;
                lastError = e;
            }
        }
        if (failed) toast(`Imported ${imported} message(s); ${failed} failed: ${lastError.message}`, 'error');
        else toast(`Imported ${imported} message(s)`);
        searchRef.current(true);
    }

    async function exportResultsTask() {
        try { await ensureTotal(); }
        catch (e) { toast(`Count failed: ${e.message}`, 'error'); return; }
        if (!totalRef.current) { toast('No results to export', 'warn'); return; }
        exportResultsDialog({ channelId, total: totalRef.current, lastParams: lastParamsRef.current });
    }

    /* ---- status filter dropdown (imperative checklist over the trigger) ---- */

    const statusBtnRef = useRef(null);
    const statusMenuRef = useRef({ menu: null, dismiss: null });

    function closeStatusMenu() {
        const s = statusMenuRef.current;
        if (s.menu) {
            s.menu.remove();
            document.removeEventListener('mousedown', s.dismiss);
            statusMenuRef.current = { menu: null, dismiss: null };
        }
    }
    function toggleStatusMenu() {
        if (statusMenuRef.current.menu) { closeStatusMenu(); return; }
        const menu = h('div.ctx-menu', { class: 'min-w-[160px]' });
        for (const s of STATUS_FILTER_ORDER) {
            const cb = checkbox(s, statusSel.has(s), {
                onChange: (e) => {
                    const on = e.target.checked;
                    setStatusSel(prev => { const next = new Set(prev); on ? next.add(s) : next.delete(s); return next; });
                }
            });
            cb.el.style.padding = '5px 8px';
            cb.el.style.display = 'flex';
            menu.appendChild(cb.el);
        }
        menu.appendChild(h('div.ctx-sep'));
        menu.appendChild(h('button.ctx-item', {
            onClick: () => { setStatusSel(new Set()); closeStatusMenu(); }
        }, 'Clear (Any)'));
        document.body.appendChild(menu);
        const r = statusBtnRef.current.getBoundingClientRect();
        menu.style.left = r.left + 'px';
        menu.style.top = (r.bottom + 4) + 'px';
        const dismiss = (e) => {
            if (!menu.contains(e.target) && !statusBtnRef.current?.contains(e.target)) closeStatusMenu();
        };
        statusMenuRef.current = { menu, dismiss };
        setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
    }

    /* Reset clears every criterion (main bar + advanced) without running a search
       — matching Swing's resetSearchCriteria. The Current Search box keeps showing
       the last executed search until the next Search. */
    function resetSearch() {
        setStartDate('');
        setEndDate('');
        setStatusSel(new Set());
        closeStatusMenu();
        setTextSearch('');
        setTextRegex(false);
        setConnectorVal('');
        setPageSize(String(Number(getPref('messagePageSize')) || 20));
        advRef.current = defaultAdvancedCriteria();
        setAdvOn(false);
    }

    function openAdvanced() {
        // Close the narrow Filters popover first, so it doesn't float over the modal.
        setFiltersOpen(false);
        openAdvancedSearch({
            connectors, metaDataColumns, adv: advRef.current,
            onApply: (next) => { advRef.current = next; setAdvOn(advIsActive(next)); }
        });
    }

    /* ---- filters popover (narrow layout) ---- */

    const criteriaBodyRef = useRef(null);
    const filtersBtnRef = useRef(null);
    useEffect(() => {
        if (!filtersOpen) return;
        const onDown = (e) => {
            if (!criteriaBodyRef.current?.contains(e.target) && !filtersBtnRef.current?.contains(e.target)) {
                setFiltersOpen(false);
            }
        };
        const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
        return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
    }, [filtersOpen]);

    /* ---- bootstrap ---- */

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const names = await api.channels.connectorNames(channelId);
                if (!cancelled) setConnectors(connectorEntries(names));
            } catch (e) {
                toast(`Failed to load connectors: ${e.message}`, 'error');
            }
            try {
                const cols = (await api.channels.metaDataColumns(channelId)).filter(c => c && c.name);
                if (!cancelled && cols.length) setMetaDataColumns(cols);
            } catch { /* channel has no custom metadata columns */ }
            try {
                const map = await api.channels.idsAndNames();
                const found = idNamePairs(map).find(c => c.id === channelId);
                if (found && !cancelled) {
                    setChannelName(found.name);
                    // route:changed resets the banner to the static route title after
                    // this async handler returns; defer past it (rAF runs after that
                    // microtask, before paint) so the channel name sticks without a flash.
                    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
                        detail: { title: `Channel Messages - ${found.name}` }
                    })));
                }
            } catch { /* keep the channel id as the label */ }
            if (!cancelled) searchRef.current(true);
        })();
        if (query.send === '1') setTimeout(() => { if (!cancelled) sendMessageTask(); }, 200);
        return () => { cancelled = true; closeStatusMenu(); };
        // Build once; channelId is stable for the view's lifetime (route remount on change).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- render ---- */

    const statusLabel = statusSel.size === 0 ? 'Any'
        : statusSel.size === 1 ? [...statusSel][0]
            : `${statusSel.size} selected`;
    const totalStr = pager.total == null ? '?' : fmtNumber(pager.total);
    const hasSel = !!selected;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Message Tasks" paneKey="tasks:Message Tasks" group="message">
                    <div className="taskbar" data-pane-title="Message Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshMessages" onClick={() => runSearch(true)} />
                        <TaskButton label="Send Message" icon="send" primary task="doSendMessage" onClick={sendMessageTask} />
                        <TaskButton label="Import Messages" icon="import" task="doImportMessages" onClick={importMessagesTask} />
                        <TaskButton label="Export Results" icon="export" task="doExportMessages" onClick={exportResultsTask} />
                        <TaskButton label="Remove All Messages" icon="trash" danger task="doRemoveAllMessages" onClick={removeAllTask} />
                        <TaskButton label="Remove Results" icon="trash" danger task="doRemoveFilteredMessages" onClick={removeResultsTask} />
                        {hasSel && <TaskButton label="Remove Message" icon="trash" danger task="doRemoveMessage" onClick={() => removeMessageTask()} />}
                        <TaskButton label="Reprocess Results" icon="transform" task="doReprocessFilteredMessages" onClick={reprocessResultsTask} />
                        {hasSel && <TaskButton label="Reprocess Message" icon="transform" task="doReprocessMessage" onClick={() => reprocessTask()} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col h-full min-h-0">
                {/* Wide: click the "Search Criteria" heading to collapse the criteria
                    in place. Narrow: they collapse into a "Filters" popover. */}
                <div className="panel filter-collapse flex-none border-0 border-b border-line rounded-none">
                    <div className="panel-header flex items-center gap-2">
                        <span className="criteria-heading cursor-pointer inline-flex items-center gap-1.5"
                            onClick={() => setCriteriaCollapsed(v => !v)}>
                            <span className="cursor-pointer">{criteriaCollapsed ? '▸' : '▾'}</span>
                            Search Criteria
                        </span>
                        <button ref={filtersBtnRef} className="btn filter-toggle" type="button"
                            aria-haspopup="true" aria-expanded={String(filtersOpen)}
                            onClick={() => setFiltersOpen(o => !o)}>
                            <Icon name="filter" /><span>Filters</span><Icon name="chevD" />
                        </button>
                    </div>
                    <div ref={criteriaBodyRef}
                        className={'panel-body filter-popover' + (criteriaCollapsed ? ' collapsed' : '') + (filtersOpen ? ' open' : '')}>
                        <div className="form-row">
                            <Field label="Start Date">
                                <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                            </Field>
                            <Field label="End Date">
                                <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </Field>
                            <Field label="Status">
                                <button ref={statusBtnRef} type="button" className="btn justify-between min-w-[132px] font-normal"
                                    onClick={(e) => { e.stopPropagation(); toggleStatusMenu(); }}>
                                    <span className="truncate">{statusLabel}</span>
                                    <span className="text-text-faint ml-2">▾</span>
                                </button>
                            </Field>
                            {/* The Regex checkbox rides on the label line (top-right of the
                                field) so it costs no slot in the criteria row. */}
                            <div className="field relative">
                                <label>Text Search</label>
                                <label className="check absolute right-0 top-0 gap-1 text-[11px] text-text-dim cursor-pointer"
                                    title="Treat the text search as a regular expression">
                                    <input type="checkbox" checked={textRegex} onChange={(e) => setTextRegex(e.target.checked)} />
                                    Regex
                                </label>
                                <input type="text" placeholder="Search message content…" className="w-[220px]"
                                    value={textSearch} onChange={(e) => setTextSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') runSearch(true); }} />
                            </div>
                            <Field label="Connector">
                                <select value={connectorVal} onChange={(e) => setConnectorVal(e.target.value)}>
                                    <option value="">Any</option>
                                    {connectors.map(c => (
                                        <option key={c.metaDataId} value={String(c.metaDataId)}>{`${c.name} (${c.metaDataId})`}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Page Size">
                                <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                                    {[20, 50, 100].map(n => <option key={n} value={String(n)}>{n}</option>)}
                                </select>
                            </Field>
                            <button className="btn btn-primary" onClick={() => runSearch(true)}><Icon name="search" />Search</button>
                            <button className="btn" onClick={resetSearch}>Reset</button>
                            {/* The Advanced… button carries a dot whenever any advanced
                                criterion is staged. Applying advanced criteria does NOT
                                auto-search — the user runs it with Search (Swing parity). */}
                            <button className="btn" onClick={openAdvanced}
                                title={advOn ? 'Advanced filter applied — press Search to run it' : undefined}>
                                <Icon name="filter" />Advanced…
                                {advOn && <span className="inline-block w-[7px] h-[7px] ml-[7px] rounded-full bg-accent" />}
                            </button>
                        </div>
                        <div className="text-text-faint mt-1.5">{searchSummary}</div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 flex flex-col overflow-hidden oie-tablecard px-[14px] pt-3 pb-3">
                    <ResultsTable
                        cols={visibleCols} mgr={mgr} rows={sortedMessages}
                        expandedIds={expandedIds} allExpanded={allExpanded}
                        selKey={selected ? `${selected.m.messageId}:${selected.metaDataId}` : null}
                        sortKey={sort.key} sortDir={sort.dir}
                        onSort={(key) => setSort(s => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 })}
                        onToggleAll={toggleAll}
                        onToggleRow={(id) => setExpandedIds(prev => {
                            const next = new Set(prev);
                            next.has(id) ? next.delete(id) : next.add(id);
                            return next;
                        })}
                        onSelect={selectMessage}
                        onRowMenu={messageRowMenu}
                        onColumnMenu={openColumnMenu}
                        onColumnsChange={() => setColumnsRev(r => r + 1)} />
                </div>

                <div className="filterbar flex-none panel overflow-visible mx-[14px]">
                    <button className="btn" disabled={pager.offset <= 0}
                        onClick={() => { offsetRef.current = 0; runSearch(false); }}>« First</button>
                    <button className="btn" disabled={pager.offset <= 0}
                        onClick={() => { offsetRef.current = Math.max(0, offsetRef.current - limitRef.current); runSearch(false); }}>‹ Prev</button>
                    <button className="btn" disabled={!pager.hasNext}
                        onClick={() => { offsetRef.current += limitRef.current; runSearch(false); }}>Next ›</button>
                    {/* Can't jump to the last page without a total. */}
                    <button className="btn" disabled={pager.total == null}
                        onClick={() => {
                            offsetRef.current = Math.max(0, Math.floor(Math.max(0, totalRef.current - 1) / limitRef.current) * limitRef.current);
                            runSearch(false);
                        }}>Last »</button>
                    <span className="counts">
                        {pager.shown == null ? ''
                            : pager.shown === 0 ? 'No results'
                                : `${fmtNumber(pager.offset + 1)}–${fmtNumber(pager.offset + pager.shown)} of ${totalStr}`}
                    </span>
                    {/* Nothing left to count once the total is known. */}
                    <button className="btn" disabled={pager.total != null || countBusy} onClick={doCount}>Count</button>
                </div>

                <div className="split-handle mx-[14px]" data-orient="v" data-resize="next" />
                <div ref={detailPaneRef} className="flex-none h-[36px] overflow-hidden flex flex-col panel mx-[14px] mb-3">
                    <DetailBody detail={detail} channelId={channelId} platform={platform} />
                </div>
            </div>
        </div>
    );
}
