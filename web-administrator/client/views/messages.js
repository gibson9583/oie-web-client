/*
 * Messages — message browser (parity with the Swing Administrator's message
 * browser). Channel picker at /messages, per-channel browser at
 * /messages/:channelId with search criteria, paginated results and a detail
 * panel showing per-connector content, errors, mappings and attachments.
 *
 * Query parameter names mirror MessageServletInterface (GET
 * /channels/{id}/messages): startDate/endDate (Calendar, formatted
 * yyyy-MM-dd'T'HH:mm:ss.SSSZ per CalendarParamConverterProvider, e.g.
 * 2015-10-21T07:28:00.000-0700), status, includedMetaDataId, textSearch,
 * textSearchRegex, min/maxMessageId, min/maxOriginalId, min/maxImportId,
 * serverId, min/maxSendAttempts, error, attachment, per-content-type
 * *ContentSearch params, metaDataSearch ("COLUMN OPERATOR value"), offset,
 * limit. The same params drive DELETE /messages (Remove Results) and POST
 * /messages/_reprocess (Reprocess Results).
 */

import { h, clear, icon, toast, taskButton, modal, confirmDialog, promptDialog, checkbox, select, field, loading, fmtDate, fmtNumber, saveFile, pickFile, contextMenu, DataTable } from '@oie/web-ui';
import api from '@oie/web-api';
import { MESSAGE_STATUSES, messageStatusTag } from '@oie/web-api';
import { renderHighlighted, detectType } from '../core/content-highlight.js';
import { formatSentProperties } from '../core/sent-format.js';
import { mappingEntries, parseResponse, toDisplayString } from '../core/xstream.js';
import { getPref } from '../core/prefs.js';
import { serializeTemplate } from '../core/serialize.js';
import { createZip } from '../core/zip.js';
import { createCodeEditor } from '@oie/web-ui';

export function register(platform) {
    // Reached via task buttons (Dashboard/Channels), matching the Swing client.
    platform.registerView('/messages', () => renderChannelPicker(platform), { title: 'Messages' });
    platform.registerView('/messages/:channelId', ({ params, query }) =>
        renderBrowser(platform, params.channelId, { send: query.send === '1' }), { title: 'Messages' });
}

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
    return cms.find(cm => Number(cm.metaDataId) === 0) ?? cms[0] ?? null;
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

function statusTag(status) {
    const color = messageStatusTag(status);
    return h('span.tag' + (color ? '.' + color : ''), status || '');
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
        error: false, attachment: false, textSearchRegex: false,
        includedMetaDataIds: null,  // null = all connectors; else [ids]
        excludedMetaDataIds: null,  // set instead when "Deleted Connectors" stays included
        contentSearches: [],   // [{type, text}]
        metaDataSearches: []   // [{column, operator, value, ignoreCase}]
    };
}


/* Pick a file and return its bytes base64-encoded (data: URL prefix stripped),
   chunked into 76-char lines like the Swing client's Base64.encodeBase64Chunked. */
function pickBinaryFile() {
    return new Promise(resolve => {
        const input = h('input', { type: 'file', style: { display: 'none' } });
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

    const fileButtons = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
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
        h('span.faint', { style: { alignSelf: 'center' } },
            'Binary files are Base64-encoded into the editor.'));

    /* ---- destinations table -------------------------------------------------- */

    const destRows = connectors.filter(c => c.metaDataId > 0).map(c => ({
        metaDataId: c.metaDataId,
        // Default all checked = send to all destinations, like the Swing client.
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const destTable = h('div.dt-wrap', { style: { maxHeight: '140px', overflow: 'auto' } },
        h('table.dt',
            h('thead', h('tr', h('th', 'Destination'), h('th', { style: { width: '90px' } }, 'Included'))),
            h('tbody', destRows.map(d => {
                const c = connectors.find(x => x.metaDataId === d.metaDataId);
                return h('tr',
                    h('td', `${c.name}`),
                    h('td', { style: { textAlign: 'center' } }, d.input));
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
            key: h('input', { type: 'text', value: key, style: { width: '100%' } }),
            value: h('input', { type: 'text', value: value, style: { width: '100%' } })
        };
        row.tr = h('tr', { onMousedown: () => selectMapRow(row) },
            h('td', row.key), h('td', row.value));
        mapRows.push(row);
        mapTbody.appendChild(row.tr);
        selectMapRow(row);
        return row;
    }

    const mapTable = h('div.dt-wrap', { style: { maxHeight: '140px', overflow: 'auto' } },
        h('table.dt',
            h('thead', h('tr', h('th', { style: { width: '40%' } }, 'Variable'), h('th', 'Value'))),
            mapTbody));
    const mapButtons = h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
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
        body: h('div',
            editor.el,
            fileButtons,
            destRows.length ? h('div',
                h('div.mt', 'Send to the following destination(s):'),
                h('div', { style: { marginTop: '6px' } }, destTable)) : null,
            h('div.mt', 'Include the following source map variables:'),
            h('div', { style: { marginTop: '6px' } }, mapTable),
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

/* ---- channel picker ------------------------------------------------------------ */

function renderChannelPicker(platform) {
    const table = new DataTable([
        { key: 'name', label: 'Channel Name' },
        { key: 'id', label: 'Id', className: 'mono', render: (r) => h('span', { style: { color: 'var(--text-faint)' } }, r.id) }
    ], {
        selectable: 'single',
        rowKey: (r) => r.id,
        emptyText: 'No channels found',
        onSelect: (rows) => { if (rows.length) platform.router.navigate(`/messages/${rows[0].id}`); }
    });

    async function refresh() {
        try {
            const map = await api.channels.idsAndNames();
            const rows = idNamePairs(map).sort((a, b) => String(a.name).localeCompare(String(b.name)));
            table.setRows(rows);
        } catch (e) {
            toast(`Failed to load channels: ${e.message}`, 'error');
        }
    }

    refresh();

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Message Tasks' } },
        taskButton('Refresh', 'refresh', refresh),
        h('span.taskbar-spacer'),
        h('span.faint', 'Select a channel to browse its messages'));

    // Fill the viewport: the panel stretches and the DataTable wrapper is the
    // scroller (sticky headers), so the page itself never scrolls.
    table.el.style.flex = '1';
    table.el.style.minHeight = '0';

    const el = h('div.view',
        taskbar,
        h('div.view-body', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', overflow: 'hidden' } },
            h('div.panel', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } },
                h('div.panel-header', { style: { flex: 'none' } }, 'Channels'),
                h('div.panel-body.flush', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } }, table.el))));

    return { el };
}

/* ---- message browser ------------------------------------------------------------- */

function renderBrowser(platform, channelId, options = {}) {
    let connectors = [];          // [{metaDataId, name}]
    let channelName = channelId;
    let offset = 0;
    let limit = Number(getPref('messagePageSize')) || 20;
    let total = 0;
    let selectedRow = null;       // search-result Message
    let lastParams = {};
    let metaDataColumns = [];     // [{name, type, mappingName}] from /channels/{id}/metaDataColumns
    let adv = defaultAdvancedCriteria();

    /* ---- search criteria ------------------------------------------------- */

    const startInput = h('input', { type: 'datetime-local' });
    const endInput = h('input', { type: 'datetime-local' });
    const statusSel = select([{ value: '', label: 'Any' }, ...MESSAGE_STATUSES], '');
    const textSearchInput = h('input', {
        type: 'text', placeholder: 'Search message content…',
        style: { width: '220px' },
        onKeydown: (e) => { if (e.key === 'Enter') search(true); }
    });
    const connectorSel = select([{ value: '', label: 'Any' }], '');
    const pageSizeSel = select([20, 50, 100], limit);

    const searchSummary = h('div.faint', { style: { marginTop: '6px' } }, 'Current Search: (none — press Search)');

    const criteriaBody = h('div.panel-body',
        h('div.form-row',
            field('Start Date', startInput),
            field('End Date', endInput),
            field('Status', statusSel),
            field('Text Search', textSearchInput),
            field('Connector', connectorSel),
            field('Page Size', pageSizeSel),
            taskButton('Search', 'search', () => search(true), { primary: true }),
            taskButton('Advanced…', 'filter', () => openAdvancedSearch())),
        searchSummary);

    const criteriaChevron = h('span', { style: { cursor: 'pointer' } }, '▾');
    const criteriaPanel = h('div.panel',
        { style: { flex: 'none', border: '0', borderBottom: '1px solid var(--line)', borderRadius: '0' } },
        h('div.panel-header', { style: { cursor: 'pointer' }, onClick: () => {
            const hidden = criteriaBody.style.display === 'none';
            criteriaBody.style.display = hidden ? '' : 'none';
            criteriaChevron.textContent = hidden ? '▾' : '▸';
        } }, criteriaChevron, 'Search Criteria'),
        criteriaBody);

    function buildParams() {
        const params = {};
        const start = toCalendarParam(startInput.value);
        const end = toCalendarParam(endInput.value);
        if (start) params.startDate = start;
        if (end) params.endDate = end;
        if (statusSel.value) params.status = statusSel.value;
        const text = textSearchInput.value.trim();
        if (text) {
            params.textSearch = text;
            if (adv.textSearchRegex) params.textSearchRegex = true;
        }
        // Connector inclusion: the advanced filter's table wins; otherwise the
        // quick Connector dropdown narrows to a single connector.
        if (adv.includedMetaDataIds) params.includedMetaDataId = adv.includedMetaDataIds;
        else if (adv.excludedMetaDataIds) params.excludedMetaDataId = adv.excludedMetaDataIds;
        else if (connectorSel.value !== '') params.includedMetaDataId = connectorSel.value;

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

    function describeParams(params) {
        const parts = [];
        for (const [key, value] of Object.entries(params)) {
            for (const item of Array.isArray(value) ? value : [value]) parts.push(`${key}=${item}`);
        }
        return parts.length ? parts.join(', ') : 'All messages';
    }

    /* ---- advanced search dialog ------------------------------------------- */

    function openAdvancedSearch() {
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
                h('td', { style: { width: '50px' } }, c.metaDataId === null ? '--' : String(c.metaDataId)),
                h('td', c.name),
                h('td', { style: { textAlign: 'center', width: '90px' } }, input)));
        }
        const setAllConn = (v) => connRows.forEach(r => { r.input.checked = v; });
        const connBlock = h('div',
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '6px' } },
                h('a', { class: 'link-btn', onClick: () => setAllConn(true) }, 'Select All'),
                h('span.faint', '|'),
                h('a', { class: 'link-btn', onClick: () => setAllConn(false) }, 'Deselect All')),
            h('div.dt-wrap', { style: { maxHeight: '150px', overflow: 'auto' } },
                h('table.dt',
                    h('thead', h('tr', h('th', 'Id'), h('th', 'Current Connector Name'), h('th', 'Included'))),
                    connTbody)));

        /* ---- id / numeric ranges (stacked "label: min – max" rows) ---- */
        const num = (value) => h('input', { type: 'number', value, style: { width: '150px' } });
        const inputs = {
            minMessageId: num(adv.minMessageId), maxMessageId: num(adv.maxMessageId),
            minOriginalId: num(adv.minOriginalId), maxOriginalId: num(adv.maxOriginalId),
            minImportId: num(adv.minImportId), maxImportId: num(adv.maxImportId),
            minSendAttempts: num(adv.minSendAttempts), maxSendAttempts: num(adv.maxSendAttempts),
            serverId: h('input', { type: 'text', value: adv.serverId, style: { flex: '1' } })
        };
        const lbl = (text) => h('label', { style: { width: '110px', flex: 'none', textAlign: 'right', color: 'var(--text-dim)' } }, text);
        const rangeRow = (label, a, b) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
            lbl(label), a, h('span.faint', '–'), b);
        const singleRow = (label, el) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
            lbl(label), el);

        const attachmentCheck = checkbox('Has Attachment', adv.attachment);
        const errorCheck = checkbox('Has Error', adv.error);
        const regexCheck = checkbox('Text search is a regular expression (PostgreSQL/MySQL/Oracle only)', adv.textSearchRegex);

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
            const el = (onNew) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } },
                h('div.dt-wrap', { style: { flex: '1', maxHeight: '150px', overflow: 'auto' } },
                    h('table.dt', h('thead', h('tr', head.map(l => h('th', l)))), tbody)),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    h('button.btn', { onClick: onNew }, 'New'), delBtn));
            delBtn.textContent = 'Delete';
            return { tbody, rows, sel, el };
        }

        /* Content Searches — one repeatable query param per content type. */
        const cs = makeSelectableTable(['Content Type', 'Contains']);
        function addContentSearchRow(type = 'rawContentSearch', text = '') {
            const row = {
                type: select(CONTENT_SEARCH_TYPES, type),
                text: h('input', { type: 'text', value: text, style: { width: '100%' } })
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
                value: h('input', { type: 'text', value, style: { width: '100%' } }),
                ignoreCase: h('input', { type: 'checkbox', checked: ignoreCase, title: 'Ignore case' })
            };
            row.tr = h('tr', { onMousedown: () => ms.sel(row) },
                h('td', row.column), h('td', row.operator), h('td', row.value),
                h('td', { style: { textAlign: 'center', width: '90px' } }, row.ignoreCase));
            ms.rows.push(row);
            ms.tbody.appendChild(row.tr);
            ms.sel(row);
            return row;
        }
        adv.metaDataSearches.forEach(m => addMetaSearchRow(m.column, m.operator, m.value, m.ignoreCase));

        const sectionLabel = (text) => h('div', { style: { fontWeight: '600', margin: '14px 0 6px' } }, text);

        modal({
            title: 'Advanced Search Filter',
            size: 'wide',
            body: h('div',
                connBlock,
                h('div', { style: { marginTop: '14px' } },
                    rangeRow('Message Id:', inputs.minMessageId, inputs.maxMessageId),
                    rangeRow('Original Id:', inputs.minOriginalId, inputs.maxOriginalId),
                    rangeRow('Import Id:', inputs.minImportId, inputs.maxImportId),
                    singleRow('Server Id:', inputs.serverId),
                    rangeRow('Send Attempts:', inputs.minSendAttempts, inputs.maxSendAttempts)),
                h('div', { style: { display: 'flex', gap: '24px', marginTop: '4px' } },
                    attachmentCheck.el, errorCheck.el),
                h('div.mt', regexCheck.el),
                sectionLabel('Content Searches'),
                cs.el(() => addContentSearchRow().text.focus()),
                sectionLabel('Custom Metadata Searches'),
                ms.el(() => addMetaSearchRow().value.focus())),
            buttons: [
                {
                    label: 'Reset',
                    onClick: () => { adv = defaultAdvancedCriteria(); search(true); }
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
                        adv = {
                            minMessageId: inputs.minMessageId.value, maxMessageId: inputs.maxMessageId.value,
                            minOriginalId: inputs.minOriginalId.value, maxOriginalId: inputs.maxOriginalId.value,
                            minImportId: inputs.minImportId.value, maxImportId: inputs.maxImportId.value,
                            serverId: inputs.serverId.value,
                            minSendAttempts: inputs.minSendAttempts.value, maxSendAttempts: inputs.maxSendAttempts.value,
                            error: errorCheck.input.checked,
                            attachment: attachmentCheck.input.checked,
                            textSearchRegex: regexCheck.input.checked,
                            includedMetaDataIds: included,
                            excludedMetaDataIds: excluded,
                            contentSearches: cs.rows
                                .map(r => ({ type: r.type.value, text: r.text.value.trim() }))
                                .filter(r => r.text),
                            metaDataSearches: ms.rows
                                .map(r => ({ column: String(r.column.value).trim(), operator: r.operator.value, value: r.value.value, ignoreCase: r.ignoreCase.checked }))
                                .filter(r => r.column)
                        };
                        search(true);
                    }
                }
            ]
        });
    }

    /* ---- results table -------------------------------------------------------- */

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
    const errBadge = (label) => label ? h('span', { style: { color: 'var(--err)' } }, label) : '';

    /* Full built-in column set (mirrors the Swing MessageBrowser); `def` marks
       default-visible. parent() renders the source row, child() a destination. */
    const COLUMNS = [
        { key: 'id', label: 'Id', def: true, w: '90px', cls: 'num', sort: (m) => Number(m.messageId), parent: (m) => String(m.messageId), child: () => '' },
        { key: 'connector', label: 'Connector', def: true, sort: (m) => sourceOf(m)?.connectorName || '', parent: (m) => sourceOf(m)?.connectorName || 'Source', child: (cm) => cm.connectorName || `Destination ${cm.metaDataId}` },
        { key: 'status', label: 'Status', def: true, w: '110px', sort: (m) => sourceOf(m)?.status || '', parent: (m, s) => statusTag(s && s.status), child: (cm) => statusTag(cm.status) },
        { key: 'origReceived', label: 'Orig. Received Date', cls: 'mono', sort: (m) => fmtDate(m.receivedDate), parent: (m) => fmtDate(m.receivedDate), child: () => '' },
        { key: 'received', label: 'Received Date', def: true, cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.receivedDate ?? m.receivedDate), parent: (m, s) => fmtDate((s && s.receivedDate) ?? m.receivedDate), child: (cm) => fmtDate(cm.receivedDate) },
        { key: 'sendAttempts', label: 'Send Attempts', w: '100px', cls: 'num', sort: (m) => maxAttempts(m), parent: (m) => String(maxAttempts(m)), child: (cm) => String(Number(cm.sendAttempts) || 0) },
        { key: 'sendDate', label: 'Send Date', cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.sendDate), parent: (m, s) => fmtDate(s && s.sendDate), child: (cm) => fmtDate(cm.sendDate) },
        { key: 'responseDate', label: 'Response Date', def: true, cls: 'mono', sort: (m) => fmtDate(sourceOf(m)?.responseDate), parent: (m, s) => fmtDate(s && s.responseDate), child: (cm) => fmtDate(cm.responseDate) },
        { key: 'errors', label: 'Errors', def: true, w: '90px', sort: (m) => messageHasError(m) ? 0 : 1, parent: (m, s) => errBadge(errorLabel(s)), child: (cm) => errBadge(errorLabel(cm)) },
        { key: 'serverId', label: 'Server Id', cls: 'mono', sort: (m) => m.serverId || '', parent: (m) => m.serverId || '', child: (cm) => cm.serverId || '' },
        { key: 'origServerId', label: 'Original Server Id', cls: 'mono', sort: (m) => m.originalServerId || '', parent: (m) => m.originalServerId || '', child: () => '' },
        { key: 'originalId', label: 'Original Id', cls: 'num', sort: (m) => Number(m.originalId) || 0, parent: (m) => m.originalId != null ? String(m.originalId) : '', child: () => '' },
        { key: 'importId', label: 'Import Id', cls: 'num', sort: (m) => Number(m.importId) || 0, parent: (m) => m.importId != null ? String(m.importId) : '', child: () => '' },
        { key: 'importChannelId', label: 'Import Channel Id', cls: 'mono', sort: (m) => m.importChannelId || '', parent: (m) => m.importChannelId || '', child: () => '' },
        { key: 'channelName', label: 'Channel Name', sort: () => channelName, parent: () => channelName, child: () => '' }
    ];
    const allColumns = () => [...COLUMNS, ...metaDataColumns.map(col => ({
        key: `meta:${col.name}`, label: col.name, def: true,
        sort: (m) => metaDataValue(m, col.name),
        parent: (m) => metaDataValue(m, col.name),
        child: (cm) => metaOfCm(cm, col.name)
    }))];

    /* Column visibility (persisted) */
    let columnVis = {};
    try { columnVis = JSON.parse(localStorage.getItem('webadmin-msg-columns') || '{}'); } catch { columnVis = {}; }
    const isVisible = (c) => (c.key in columnVis) ? !!columnVis[c.key] : !!c.def;
    const saveColumnVis = () => { try { localStorage.setItem('webadmin-msg-columns', JSON.stringify(columnVis)); } catch { /* private mode */ } };

    /* Table state */
    let messages = [];
    let sortKey = 'id';
    let sortDir = -1;          // newest first by default
    let selectedMetaDataId = 0;
    const expandedIds = new Set();
    let allExpanded = false;

    const tableHost = h('div.grow', { style: { minHeight: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' } });
    const selKey = () => selectedRow ? `${selectedRow.messageId}:${selectedMetaDataId}` : null;

    function openColumnMenu(e) {
        e.preventDefault();
        const items = allColumns().map(c => ({
            label: (isVisible(c) ? '✓  ' : '    ') + c.label,
            onClick: () => { columnVis[c.key] = !isVisible(c); saveColumnVis(); renderTable(); }
        }));
        items.push('-', { label: 'Restore Default', onClick: () => { columnVis = {}; saveColumnVis(); renderTable(); } });
        contextMenu(e.clientX, e.clientY, items);
    }

    function setSort(key) {
        if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
        renderTable();
    }
    function sortedMessages() {
        const col = allColumns().find(c => c.key === sortKey);
        if (!col) return messages;
        return [...messages].sort((a, b) => {
            const va = col.sort(a), vb = col.sort(b);
            return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
        });
    }

    function toggleAll() {
        allExpanded = !allExpanded;
        expandedIds.clear();
        if (allExpanded) for (const m of messages) {
            if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) expandedIds.add(String(m.messageId));
        }
        renderTable();
    }

    function selectMessage(m, metaDataId) {
        selectedRow = m;
        selectedMetaDataId = metaDataId;
        updateTaskVisibility();
        showDetail(m, metaDataId);
        renderTable();
    }

    // View Attachment (Swing MESSAGE_VIEW_IMAGE) — modal listing the message's
    // attachments, each with the existing Fetch Content + Export controls.
    function viewAttachmentsModal(m) {
        const host = h('div', { style: { minWidth: '480px', maxHeight: '60vh', overflow: 'auto' } }, loading('Loading attachments…'));
        modal({ title: `Attachments — Message ${m.messageId}`, size: 'wide', body: host, buttons: [{ label: 'Close' }] });
        (async () => {
            try {
                const attachments = m.__attachments ?? await api.messages.attachments(channelId, m.messageId);
                m.__attachments = attachments;
                clear(host);
                if (!attachments.length) { host.appendChild(h('div.faint', 'No attachments')); return; }
                for (const a of attachments) host.appendChild(attachmentBlock(m, a));
            } catch (e) { clear(host).appendChild(h('div.faint', `Failed to load attachments: ${e.message}`)); }
        })();
    }

    // Export Attachment (Swing MESSAGE_EXPORT_ATTACHMENT) — export directly when
    // there's exactly one, otherwise open the viewer to pick.
    async function exportAttachmentTask(m) {
        const attachments = m.__attachments ?? await api.messages.attachments(channelId, m.messageId).catch(() => []);
        m.__attachments = attachments;
        if (!attachments.length) { toast('No attachments on this message', 'warn'); return; }
        if (attachments.length === 1) { exportAttachment(m, attachments[0]); return; }
        viewAttachmentsModal(m);
    }

    // Right-click parity with the Swing Message Browser (Frame.messagePopupMenu —
    // the full Message Tasks list; selection-dependent items act on this row).
    function messageRowMenu(m, metaDataId, e) {
        e.preventDefault();
        selectMessage(m, metaDataId);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', onClick: () => search(true) },
            { label: 'Send Message', icon: 'send', onClick: () => sendMessageTask() },
            '-',
            { label: 'Import Messages', icon: 'import', onClick: () => importMessagesTask() },
            { label: 'Export Results', icon: 'export', onClick: () => exportResultsTask() },
            '-',
            { label: 'Reprocess Results', icon: 'transform', onClick: () => reprocessResultsTask() },
            { label: 'Reprocess Message', icon: 'transform', onClick: () => reprocessTask() },
            '-',
            { label: 'View Attachment', icon: 'eye', onClick: () => viewAttachmentsModal(m) },
            { label: 'Export Attachment', icon: 'export', onClick: () => exportAttachmentTask(m) },
            '-',
            { label: 'Remove Message', icon: 'trash', danger: true, onClick: () => removeMessageTask() },
            { label: 'Remove Results', icon: 'trash', danger: true, onClick: () => removeResultsTask() },
            { label: 'Remove All Messages', icon: 'trash', danger: true, onClick: () => removeAllTask() }
        ]);
    }

    function renderTable() {
        clear(tableHost);
        const cols = allColumns().filter(isVisible);
        const headTwisty = h('span.msg-twisty', { title: allExpanded ? 'Collapse all' : 'Expand all' }, allExpanded ? '▾' : '▸');
        headTwisty.addEventListener('click', toggleAll);
        const headTh = h('th', { style: { width: '24px' }, onContextMenu: openColumnMenu }, headTwisty);
        const thead = h('thead', h('tr', headTh, ...cols.map(c => {
            const th = h('th', { style: c.w ? { width: c.w } : null, onContextMenu: openColumnMenu },
                c.label, sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : '');
            th.addEventListener('click', () => setSort(c.key));
            return th;
        })));

        if (!messages.length) {
            tableHost.appendChild(h('table.msg-table', thead));
            tableHost.appendChild(h('div.dt-empty', 'No messages found'));
            return;
        }

        const sel = selKey();
        const tbody = h('tbody');
        for (const m of sortedMessages()) {
            const source = sourceOf(m);
            const dests = connectorMessagesOf(m).filter(cm => Number(cm.metaDataId) > 0);
            const expanded = expandedIds.has(String(m.messageId));
            const tw = h('span.msg-twisty', dests.length ? (expanded ? '▾' : '▸') : '');
            if (dests.length) tw.addEventListener('click', (e) => {
                e.stopPropagation();
                expanded ? expandedIds.delete(String(m.messageId)) : expandedIds.add(String(m.messageId));
                renderTable();
            });
            const ptr = h('tr', { class: sel === `${m.messageId}:0` ? 'selected' : null },
                h('td', tw), ...cols.map(c => h('td' + (c.cls ? '.' + c.cls : ''), c.parent(m, source))));
            ptr.addEventListener('click', () => selectMessage(m, 0));
            ptr.addEventListener('contextmenu', (e) => messageRowMenu(m, 0, e));
            tbody.appendChild(ptr);

            if (expanded) for (const cm of dests) {
                const ctr = h('tr.child', { class: sel === `${m.messageId}:${cm.metaDataId}` ? 'selected' : null },
                    h('td', ''), ...cols.map(c => h('td' + (c.cls ? '.' + c.cls : '') + (c.key === 'connector' ? '.indent' : ''), c.child(cm))));
                ctr.addEventListener('click', () => selectMessage(m, Number(cm.metaDataId)));
                ctr.addEventListener('contextmenu', (e) => messageRowMenu(m, Number(cm.metaDataId), e));
                tbody.appendChild(ctr);
            }
        }
        tableHost.appendChild(h('div.dt-wrap', { style: { flex: '1', minHeight: '0', overflow: 'auto' } },
            h('table.msg-table', thead, tbody)));
    }
    renderTable();
    const rebuildTable = renderTable;   // metadata columns appear on next render

    const pagerLabel = h('span.counts', '');
    const firstBtn = taskButton('« First', null, () => { offset = 0; search(false); });
    const prevBtn = taskButton('‹ Prev', null, () => { offset = Math.max(0, offset - limit); search(false); });
    const nextBtn = taskButton('Next ›', null, () => { offset += limit; search(false); });
    const lastBtn = taskButton('Last »', null, () => { offset = Math.max(0, Math.floor(Math.max(0, total - 1) / limit) * limit); search(false); });
    const pagerBar = h('div.filterbar', { style: { flex: 'none' } }, firstBtn, prevBtn, nextBtn, lastBtn, pagerLabel);

    function updatePager() {
        const from = total === 0 ? 0 : offset + 1;
        const to = Math.min(offset + limit, total);
        pagerLabel.textContent = total ? `${fmtNumber(from)}–${fmtNumber(to)} of ${fmtNumber(total)}` : 'No results';
        firstBtn.disabled = prevBtn.disabled = offset <= 0;
        nextBtn.disabled = lastBtn.disabled = offset + limit >= total;
    }

    async function search(resetOffset) {
        if (resetOffset) {
            offset = 0;
            lastParams = buildParams();
            limit = Number(pageSizeSel.value) || 20;
            searchSummary.textContent = `Current Search: ${describeParams(lastParams)}`;
        }
        try {
            const [rows, count] = await Promise.all([
                api.messages.search(channelId, { ...lastParams, offset, limit }),
                api.messages.count(channelId, lastParams)
            ]);
            total = toCount(count);
            selectedRow = null;
            selectedMetaDataId = 0;
            updateTaskVisibility();
            collapseDetail();
            messages = rows.filter(m => m && typeof m === 'object');
            // Destinations expanded by default, matching the Swing browser.
            expandedIds.clear();
            for (const m of messages) {
                if (connectorMessagesOf(m).some(cm => Number(cm.metaDataId) > 0)) expandedIds.add(String(m.messageId));
            }
            allExpanded = true;
            renderTable();
            updatePager();
        } catch (e) {
            toast(`Search failed: ${e.message}`, 'error');
        }
    }

    /* ---- detail panel (resizable bottom pane via the global .split-handle) -------- */

    const detailHandle = h('div.split-handle', { dataset: { orient: 'v', resize: 'next' } });
    const detailPane = h('div', {
        style: {
            flex: 'none', height: '36px', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', background: 'var(--bg1)'
        }
    });
    let detailHeight = '38%'; // last expanded height (preserved across selections)
    let detailExpanded = false;

    // Slim empty-state strip instead of a dead pane when nothing is selected.
    function collapseDetail() {
        if (detailExpanded) detailHeight = detailPane.style.height || detailHeight;
        detailExpanded = false;
        detailPane.style.height = '36px';
        clear(detailPane).appendChild(h('div.faint', {
            style: { flex: 'none', padding: '9px 14px' }
        }, 'Select a message to view its contents.'));
    }

    function expandDetail() {
        if (!detailExpanded) detailPane.style.height = detailHeight;
        detailExpanded = true;
    }

    async function showDetail(row, metaDataId = 0) {
        expandDetail();
        clear(detailPane).appendChild(h('div', { style: { padding: '12px 14px' } }, loading('Loading message…')));
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
        if (selectedRow !== row) return; // selection changed while loading
        renderDetail(message, metaDataId);
    }

    function renderDetail(message, metaDataId = 0) {
        const cms = connectorMessagesOf(message);
        if (!cms.length) {
            clear(detailPane);
            detailPane.appendChild(h('div.panel-header', { style: { flex: 'none' } }, `Message ${message.messageId}`));
            detailPane.appendChild(h('div.faint', { style: { padding: '12px 14px' } }, 'No connector messages'));
            return;
        }

        const initial = cms.find(c => Number(c.metaDataId) === Number(metaDataId)) || cms[0];
        const tabsHost = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' } });
        const connectorOptions = cms.map(cm => ({
            value: String(cm.metaDataId),
            label: `${Number(cm.metaDataId) === 0 ? 'Source' : 'Destination'} ${cm.metaDataId}: ${cm.connectorName || ''}`
        }));
        const cmSel = select(connectorOptions, String(initial.metaDataId), {
            onChange: () => {
                const cm = cms.find(c => String(c.metaDataId) === cmSel.value) ?? cms[0];
                renderConnectorTabs(cm);
            }
        });

        function renderConnectorTabs(cm) {
            clear(tabsHost);
            tabsHost.appendChild(connectorTabs(message, cm).el);
        }

        clear(detailPane);
        detailPane.appendChild(h('div.panel-header', { style: { flex: 'none' } },
            `Message ${message.messageId}`,
            h('div.panel-tools', statusTag(sourceOf(message)?.status), cmSel)));
        detailPane.appendChild(tabsHost);
        renderConnectorTabs(initial);
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(String(text == null ? '' : text)).then(
                () => toast('Copied to clipboard'),
                () => toast('Copy failed', 'warn'));
        } else { toast('Clipboard unavailable', 'warn'); }
    }

    /* The Response (and destination Processed Response) stage stores a serialized
       Response object, not raw content. Like the Swing browser, we surface the
       status + statusMessage in a banner and show the inner <message> payload as
       the body — never the XML envelope itself. (parseResponse lives in
       core/xstream.js with the rest of the engine-value decoding.) */

    /* Highlighted content viewer: syntax colors, optional pretty-print, copy,
       and (for HL7) field-name tooltips enriched from the serializer sidecar. */
    function contentView(content, dataType, opts = {}) {
        // Response stages: unwrap the Response envelope — banner shows the status,
        // body shows only the inner message payload (often empty).
        const env = opts.responseEnvelope ? parseResponse(content) : null;
        const body = env ? (env.message || '') : content;

        // flex:1 so the box always fills the pane — a stable text area even when
        // the body is empty (e.g. a Response with no payload).
        const pre = h('pre.content-pre', { style: { flex: '1', minHeight: '120px', maxHeight: 'none', margin: '10px' } });
        const kind = detectType(body, dataType);
        // Pretty-print known structured types (XML/JSON) by default — gated on the
        // "Format text in message browser" user preference (Administrator settings).
        let formatted = (kind === 'xml' || kind === 'json') && getPref('formatMessages') !== false;
        let descriptions = null;
        const draw = () => renderHighlighted(pre, body, { dataType, format: formatted, descriptions });
        draw();

        const tools = h('div.content-toolbar');
        if (kind === 'xml' || kind === 'json') {
            tools.appendChild(checkbox('Format', formatted, {
                onChange: (e) => { formatted = e.target.checked; draw(); }
            }).el);
        }
        tools.appendChild(h('span', { style: { flex: '1' } }));
        tools.appendChild(h('button.btn.btn-sm', { onClick: () => copyText(body) }, icon('copy'), 'Copy'));

        // HL7: pull exact field names from the engine and re-render tooltips.
        if (kind === 'hl7v2') {
            serializeTemplate('HL7V2', {}, body).then(res => {
                const d = res && res.meta && res.meta.descriptions;
                if (d && Object.keys(d).length) { descriptions = d; draw(); }
            }).catch(() => { /* sidecar offline → static dictionary tooltips */ });
        }

        const banner = env
            ? h('div.content-banner', statusTag(env.status),
                env.statusMessage ? h('span.faint', env.statusMessage) : null)
            : null;

        return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: '0', height: '100%' } },
            tools, banner, pre);
    }

    function connectorTabs(message, cm) {
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
            defs.push({ label, render: () => contentView(content, dataType, { responseEnvelope }) });
        }

        const errorDefs = [
            ['Processing Error', contentOf(cm.processingErrorContent)],
            ['Postprocessor Error', contentOf(cm.postProcessorErrorContent)],
            ['Response Error', contentOf(cm.responseErrorContent)]
        ].filter(([, content]) => content !== null);
        if (errorDefs.length) {
            defs.push({
                label: 'Errors',
                render: () => h('div', { style: { padding: '10px', overflow: 'auto' } },
                    errorDefs.map(([label, content]) => [
                        h('div.faint.mt', label),
                        h('pre.content-pre', content)
                    ]))
            });
        }

        defs.push({ label: 'Mappings', render: () => renderMappings(cm) });
        // Attachments tab only when the message actually has attachments.
        if (message.__attachments && message.__attachments.length) {
            defs.push({ label: 'Attachments', render: () => renderAttachments(message) });
        }

        return tabsBlock(defs);
    }

    /* Local tab strip sized to the detail pane: fixed bar, scrolling body. */
    function tabsBlock(defs) {
        const bar = h('div.tabs', { style: { flex: 'none' } });
        const body = h('div', { style: { flex: '1', minHeight: '0', overflow: 'auto' } });
        defs.forEach((def, i) => {
            bar.appendChild(h('button.tab', {
                class: i === 0 ? 'active' : null,
                onClick: (e) => {
                    bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    clear(body).appendChild(def.render());
                }
            }, def.label));
        });
        if (defs.length) body.appendChild(defs[0].render());
        return { el: h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } }, bar, body) };
    }

    /* Classic mappings table: Scope | Variable | Value rows aggregated across
       the connector message's maps. */
    function renderMappings(cm) {
        // Scope, deserialized map content. Matches the Swing browser exactly:
        // Source / Connector / Channel / Response only — no Custom Metadata.
        const groups = [
            ['Source', cm.sourceMapContent],
            ['Connector', cm.connectorMapContent],
            ['Channel', cm.channelMapContent],
            ['Response', cm.responseMapContent]
        ];
        const tbody = h('tbody');
        let any = false;
        for (const [scope, mc] of groups) {
            for (const [variable, value] of mappingEntries(mc)) {
                any = true;
                tbody.appendChild(h('tr',
                    h('td', { style: { width: '120px' } }, scope),
                    h('td.mono', { style: { width: '30%' } }, String(variable)),
                    h('td.mono', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, String(value ?? ''))));
            }
        }
        if (!any) {
            return h('div', { style: { padding: '14px' } }, h('div.faint', 'There are no mappings present.'));
        }
        return h('div.dt-wrap', { style: { overflow: 'auto' } },
            h('table.dt',
                h('thead', h('tr', h('th', 'Scope'), h('th', 'Variable'), h('th', 'Value'))),
                tbody));
    }

    function renderAttachments(message) {
        const host = h('div', { style: { padding: '10px', overflow: 'auto' } });
        host.appendChild(loading('Loading attachments…'));
        (async () => {
            try {
                // Reuse the list fetched when the message was opened, if present.
                const attachments = message.__attachments
                    ?? await api.messages.attachments(channelId, message.messageId);
                clear(host);
                if (!attachments.length) {
                    host.appendChild(h('div.faint', 'No attachments'));
                    return;
                }
                for (const attachment of attachments) {
                    host.appendChild(attachmentBlock(message, attachment));
                }
            } catch (e) {
                clear(host);
                host.appendChild(h('div.faint', `Failed to load attachments: ${e.message}`));
            }
        })();
        return host;
    }

    function attachmentBlock(message, attachment) {
        const viewer = platform.attachmentViewers().find(v => {
            try { return v.canHandle(attachment); } catch { return false; }
        });
        if (viewer) {
            const body = h('div.mt');
            const result = viewer.render(body, { attachment, channelId, messageId: message.messageId, platform });
            if (result instanceof Node) body.appendChild(result);
            return body;
        }

        const contentHost = h('div');
        return h('div.mt',
            h('dl.kv',
                h('dt', 'Id'), h('dd', displayValue(attachment.id)),
                h('dt', 'Type'), h('dd', displayValue(attachment.type))),
            h('div.mt', { style: { display: 'flex', gap: '8px' } },
                taskButton('Fetch Content', 'eye', async () => {
                    try {
                        const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
                        let content = full?.content ?? full;
                        if (typeof content === 'string') {
                            try { content = atob(content); } catch { /* keep base64 */ }
                        }
                        clear(contentHost).appendChild(h('pre.content-pre.mt', displayValue(content)));
                    } catch (e) {
                        toast(`Failed to fetch attachment: ${e.message}`, 'error');
                    }
                }),
                taskButton('Export', 'export', () => exportAttachment(message, attachment))),
            contentHost);
    }

    function isTextualAttachment(type) {
        return /^text\/|json|xml|x-www-form-urlencoded/i.test(String(type || ''));
    }

    function attachmentExtension(type) {
        const subtype = String(type || '').split(';')[0].split('/')[1] || '';
        if (subtype === 'plain') return '.txt';
        const cleaned = subtype.replace(/[^\w]+/g, '').slice(0, 8);
        return cleaned ? `.${cleaned}` : '.bin';
    }

    async function exportAttachment(message, attachment) {
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

    /* ---- tasks ---------------------------------------------------------------------- */

    function requireSelection() {
        if (!selectedRow) { toast('Select a message first', 'warn'); return null; }
        return selectedRow;
    }

    function sendMessageTask() {
        openSendMessageDialog(platform, channelId, () => search(false));
    }

    /* Shared "Reprocessing Options" dialog (Swing ReprocessMessagesDialog) — used
       for both a single message and the whole result set. Overwrite checkbox +
       a "reprocess through the following destinations" table with Select All /
       Deselect All. All checked = reprocess through all (filterDestinations off);
       a subset turns on filterDestinations with those metaDataIds. The results
       variant adds the red warning and the REPROCESSALL confirmation. */
    function reprocessDialog({ messageId, isResults }) {
        const destRows = connectors.filter(c => Number(c.metaDataId) > 0).map(c => ({
            metaDataId: c.metaDataId, name: c.name,
            input: h('input', { type: 'checkbox', checked: true })
        }));
        const overwrite = checkbox('Overwrite existing messages and update statistics', false);
        const setAll = (v) => destRows.forEach(r => { r.input.checked = v; });

        const destTable = destRows.length ? h('div',
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', margin: '4px 0' } },
                h('a', { class: 'link-btn', onClick: () => setAll(true) }, 'Select All'),
                h('span.faint', '|'),
                h('a', { class: 'link-btn', onClick: () => setAll(false) }, 'Deselect All')),
            h('div.dt-wrap', { style: { maxHeight: '160px', overflow: 'auto' } },
                h('table.dt',
                    h('thead', h('tr', h('th', 'Destination'), h('th', { style: { width: '90px' } }, 'Included'))),
                    h('tbody', destRows.map(d => h('tr',
                        h('td', d.name || `Destination ${d.metaDataId}`),
                        h('td', { style: { textAlign: 'center' } }, d.input))))))) : null;

        modal({
            title: 'Reprocessing Options',
            size: 'wide',
            body: h('div',
                isResults ? h('div', {
                    style: { color: 'var(--err)', marginBottom: '10px', fontSize: '12.5px' }
                }, h('b', 'Warning: '), `This will reprocess all ${fmtNumber(total)} result(s) for the current search criteria, including those not listed on the current page.`) : null,
                overwrite.el,
                destRows.length ? h('div.mt', 'Reprocess through the following destinations:') : null,
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
                            search(false);
                        } catch (e) {
                            toast(`Reprocess failed: ${e.message}`, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    function reprocessTask() {
        const row = requireSelection();
        if (!row) return;
        reprocessDialog({ messageId: row.messageId, isResults: false });
    }

    async function removeMessageTask() {
        const row = requireSelection();
        if (!row) return;
        if (getPref('confirmReprocessRemove') !== false &&
            !await confirmDialog('Remove message', `Permanently remove message ${row.messageId}? This cannot be undone.`, { danger: true, okLabel: 'Remove' })) return;
        try {
            await api.messages.remove(channelId, row.messageId);
            toast('Message removed');
            search(false);
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
            search(true);
        } catch (e) {
            toast(`Remove all failed: ${e.message}`, 'error');
        }
    }

    /* ---- results operations (operate on the current search filter) ---------- */

    async function removeResultsTask() {
        const filter = { ...lastParams };
        if (getPref('confirmReprocessRemove') !== false) {
            const text = await promptDialog('Remove Results',
                `Permanently remove all ${fmtNumber(total)} message(s) matching the current search from ${channelName}? ` +
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
            search(true);
        } catch (e) {
            toast(`Remove results failed: ${e.message}`, 'error');
        }
    }

    function reprocessResultsTask() {
        reprocessDialog({ isResults: true });
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
        search(true);
    }

    function exportResultsTask() {
        if (!total) { toast('No results to export', 'warn'); return; }
        exportResultsDialog();
    }

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
    function applyFilePattern(pattern, m, count) {
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
    function exportResultsDialog() {
        let aborted = false, running = false;

        const contentSel = select(EXPORT_CONTENT_OPTIONS, 'xml', { onChange: updateEnabled });
        const encryptCheck = checkbox('Encrypt', false);
        const attachCheck = checkbox('Include Attachments', false);
        const compressionSel = select([{ value: 'none', label: 'None' }, { value: 'zip', label: 'Zip' }], 'none', { onChange: updateEnabled });

        const radio = (name, checked) => h('input', { type: 'radio', name, checked: checked || null, onChange: updateEnabled });
        const radioLabel = (input, text) => h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' } }, input, text);
        const pwYes = radio('exp-pw'); const pwNo = radio('exp-pw', true);
        const algoSel = select(ENCRYPTION_ALGORITHMS, 'AES128');
        const pwInput = h('input', { type: 'password', placeholder: 'Password', style: { width: '100%' } });
        const toServer = radio('exp-to'); const toComputer = radio('exp-to', true);

        const rootInput = h('input', { type: 'text', placeholder: '/path/accessible/by/server', style: { flex: '1' } });
        const patternInput = h('textarea', { rows: '3', style: { width: '100%', fontFamily: 'var(--mono)', resize: 'vertical' } });
        patternInput.value = DEFAULT_FILE_PATTERN;

        const insertToken = (token) => {
            const s = patternInput.selectionStart ?? patternInput.value.length;
            const e = patternInput.selectionEnd ?? s;
            patternInput.value = patternInput.value.slice(0, s) + token + patternInput.value.slice(e);
            const p = s + token.length;
            patternInput.focus(); patternInput.setSelectionRange(p, p);
        };
        const varList = h('div.tree', { style: { maxHeight: '150px', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px' } },
            FILE_PATTERN_VARS.map(([label, token]) => h('div.tree-node', {
                title: `Insert ${token}`, draggable: 'true', style: { cursor: 'grab' },
                onClick: () => insertToken(token),
                onDragstart: (e) => { e.dataTransfer.setData('text/plain', token); e.dataTransfer.effectAllowed = 'copy'; }
            }, label)));

        const status = h('div.faint', `${fmtNumber(total)} message(s) match the current search.`);
        const fill = h('div.progress-fill', { style: { width: '0%' } });
        const barWrap = h('div.progress', { style: { display: 'none' } }, fill);

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
        const lbl = (t) => h('div', { style: { textAlign: 'right', whiteSpace: 'nowrap', alignSelf: 'center' } }, t);
        const cell = (...c) => h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, ...c);
        const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '10px', rowGap: '8px', alignItems: 'center' } },
            lbl('Content:'), cell(contentSel, encryptCheck.el, attachCheck.el),
            lbl('Compression:'), cell(compressionSel),
            lbl('Password Protect:'), cell(radioLabel(pwYes, 'Yes'), radioLabel(pwNo, 'No'), algoSel),
            lbl('Password:'), cell(pwInput),
            lbl('Export To:'), cell(radioLabel(toServer, 'Server'), radioLabel(toComputer, 'My Computer')),
            lbl('Root Path:'), cell(rootInput, h('span.faint', { style: { whiteSpace: 'nowrap' } }, '/[timestamp].zip')),
            lbl('File Pattern:'), cell(patternInput));

        const dlg = modal({
            title: 'Export Results',
            size: 'wide',
            body: h('div', { style: { display: 'flex', gap: '18px', minWidth: '680px' } },
                h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px' } }, grid, status, barWrap),
                h('div', { style: { width: '200px', display: 'flex', flexDirection: 'column' } },
                    h('label', { style: { display: 'block', marginBottom: '2px' } }, 'Variables:'),
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
                    const base = applyFilePattern(pattern, m, count);
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

    async function exportTask() {
        const row = requireSelection();
        if (!row) return;
        await saveFile(`message-${row.messageId}.json`, 'application/json', async () => {
            let message = row;
            try {
                const full = await api.messages.get(channelId, row.messageId);
                if (full && typeof full === 'object') message = full;
            } catch { /* export the search result row instead */ }
            return JSON.stringify({ message }, null, 2);
        });
    }

    // Selection-dependent tasks live in a context group that only shows when
    // a message is selected (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        h('span.sep'),
        taskButton('Reprocess', 'transform', reprocessTask),
        taskButton('Export Selected', 'export', exportTask),
        taskButton('Remove Message', 'trash', removeMessageTask, { danger: true }));

    function updateTaskVisibility() {
        ctxTasks.classList.toggle('hidden', !selectedRow);
    }

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Message Tasks' } },
        taskButton('Channels', 'channels', () => platform.router.navigate('/messages')),
        h('span.sep'),
        taskButton('Search', 'refresh', () => search(true)),
        taskButton('Send Message', 'send', sendMessageTask, { primary: true }),
        h('span.sep'),
        taskButton('Import Messages', 'import', importMessagesTask),
        taskButton('Export Results', 'export', exportResultsTask),
        taskButton('Reprocess Results', 'transform', reprocessResultsTask),
        taskButton('Remove Results', 'trash', removeResultsTask, { danger: true }),
        ctxTasks,
        h('span.sep'),
        taskButton('Remove All Messages', 'trash', removeAllTask, { danger: true }),
        h('span.taskbar-spacer'),
        h('span.faint#msg-channel-name', channelId));

    /* ---- bootstrap ----------------------------------------------------------------- */

    (async () => {
        try {
            const names = await api.channels.connectorNames(channelId);
            connectors = connectorEntries(names);
            clear(connectorSel);
            connectorSel.appendChild(h('option', { value: '' }, 'Any'));
            for (const c of connectors) {
                connectorSel.appendChild(h('option', { value: String(c.metaDataId) }, `${c.name} (${c.metaDataId})`));
            }
        } catch (e) {
            toast(`Failed to load connectors: ${e.message}`, 'error');
        }
        try {
            metaDataColumns = (await api.channels.metaDataColumns(channelId)).filter(c => c && c.name);
            if (metaDataColumns.length) rebuildTable();
        } catch { /* channel has no custom metadata columns */ }
        try {
            const map = await api.channels.idsAndNames();
            const found = idNamePairs(map).find(c => c.id === channelId);
            if (found) {
                channelName = found.name;
                const label = taskbar.querySelector('#msg-channel-name');
                if (label) label.textContent = found.name;
                window.dispatchEvent(new CustomEvent('webadmin:set-title', {
                    detail: { title: `Channel Messages - ${found.name}` }
                }));
            }
        } catch { /* keep the channel id as the label */ }
        search(true);
    })();

    collapseDetail();

    const el = h('div.view',
        taskbar,
        h('div.view-body.flush', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } },
            criteriaPanel, tableHost, pagerBar, detailHandle, detailPane));

    if (options.send) setTimeout(() => sendMessageTask(), 200);

    return { el };
}
