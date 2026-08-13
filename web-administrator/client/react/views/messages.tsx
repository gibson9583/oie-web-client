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
 * Free-typed Text Search is intercepted by the message-search DLM
 * (core/dlm.ts). Scopes can be picked with the inline typeahead; if the user
 * hits Search with a phrase and no scope yet, the Focus-search-scope prompt
 * opens. Either path builds an isolated query — never the engine `textSearch`
 * wildcard unless Legacy is chosen explicitly.
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
import { createPortal } from 'react-dom';
import * as Popover from '@radix-ui/react-popover';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Collapsible from '@radix-ui/react-collapsible';
import { h, toast, modal, confirmDialog, promptDialog, checkbox, select, fmtDate, fmtNumber, saveFile, pickFile, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { messageStatusTag } from '@oie/web-api';
import { renderHighlighted, detectType } from '../../core/content-highlight.js';
import { formatSentProperties } from '../../core/sent-format.js';
import { mappingEntries, parseResponse, toDisplayString } from '../../core/xstream.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import {
    DLM_SCOPES, dlmBuildDecision, dlmFilterScopes, promptDlmSearchScope
} from '../../core/dlm.js';
import type { DlmDecision, DlmScope } from '../../core/dlm.js';
import { serializeTemplate } from '../../core/serialize.js';
import { createZip } from '../../core/zip.js';
import { createCodeEditor, createColumnManager } from '@oie/web-ui';
import { platform } from '../../core/platform.js';
import { ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, TaskButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import * as router from '../../core/router.js';
import { DateTimeField } from '../date-time-field.jsx';

/* Criteria-panel width below which the criteria fold into the Filters popover. */
const CRITERIA_INLINE_MIN = 760;

/** Inline scope typeahead for Text Search — chips + filtered catalog. */
function DlmScopeField({
    scopes, onScopes, metaColumns, selectedMeta, onMeta, disabledMeta
}: {
    scopes: string[];
    onScopes: (ids: string[]) => void;
    metaColumns: string[];
    selectedMeta: string[];
    onMeta: (cols: string[]) => void;
    disabledMeta?: boolean;
}) {
    const [needle, setNeedle] = useState('');
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef<HTMLDivElement | null>(null);
    const byId = useMemo(() => new Map(DLM_SCOPES.map((s) => [s.id, s])), []);
    const available = useMemo(
        () => DLM_SCOPES.filter((s) => !(s.kind === 'metadata' && (disabledMeta || !metaColumns.length))),
        [disabledMeta, metaColumns.length]
    );
    const filtered = useMemo(
        () => dlmFilterScopes(needle, available.filter((s) => !scopes.includes(s.id))),
        [needle, available, scopes]
    );

    useLayoutEffect(() => {
        const el = listRef.current, input = inputRef.current;
        if (!open || !filtered.length || !el || !input) return;
        const r = input.getBoundingClientRect();
        el.style.minWidth = `${Math.max(220, r.width)}px`;
        el.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - el.offsetWidth - 4))}px`;
        el.style.top = `${r.bottom + 2}px`;
        el.style.bottom = 'auto';
        if (el.getBoundingClientRect().bottom > window.innerHeight - 4) {
            el.style.top = 'auto';
            el.style.bottom = `${window.innerHeight - r.top + 2}px`;
        }
    }, [open, filtered]);

    const addScope = (id: string) => {
        if (!byId.has(id) || scopes.includes(id)) return;
        const next = [...scopes, id];
        onScopes(next);
        if (id === 'metadata' && !selectedMeta.length && metaColumns.length) {
            onMeta(metaColumns.slice());
        }
        setNeedle('');
        setActive(0);
        setOpen(false);
        inputRef.current?.focus();
    };
    const removeScope = (id: string) => {
        onScopes(scopes.filter((s) => s !== id));
        if (id === 'metadata') onMeta([]);
        inputRef.current?.focus();
    };

    const onKeyDown = (e: any) => {
        const listOpen = open && filtered.length > 0;
        if (e.key === 'Backspace' && !needle && scopes.length) {
            e.preventDefault();
            removeScope(scopes[scopes.length - 1]);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!listOpen) { setOpen(true); return; }
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + delta + filtered.length) % filtered.length);
        } else if (e.key === 'Enter' && listOpen) {
            e.preventDefault();
            addScope(filtered[active >= 0 ? active : 0].id);
        } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
        }
    };

    return (
        <div className="field relative min-w-[198px]">
            <label>Scope</label>
            <div className="flex flex-wrap items-center gap-1 min-h-[28px]">
                {scopes.map((id) => {
                    const scope = byId.get(id);
                    if (!scope) return null;
                    return (
                        <span key={id} className="tag inline-flex items-center gap-1 py-px pr-1 pl-[6px]"
                            style={{ background: 'var(--bg3)' }}>
                            <span>{scope.label}</span>
                            <button type="button" title="Remove"
                                className="appearance-none border-none cursor-pointer text-inherit text-[12.5px] leading-none py-0 px-px"
                                style={{ background: 'none', fontFamily: 'inherit' }}
                                onClick={() => removeScope(id)}>×</button>
                        </span>
                    );
                })}
                <input ref={inputRef} type="search" className="flex-1 min-w-[120px]"
                    placeholder={scopes.length ? 'Add scope…' : 'Type scope…'}
                    autoComplete="off" value={needle}
                    role="combobox" aria-autocomplete="list"
                    aria-expanded={open && filtered.length > 0}
                    aria-controls="msg-dlm-scope-list"
                    onChange={(e) => { setNeedle(e.target.value); setOpen(true); setActive(0); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onKeyDown={onKeyDown} />
            </div>
            {open && filtered.length > 0 && createPortal(
                <div ref={listRef} id="msg-dlm-scope-list" role="listbox"
                    className="fixed z-[80] max-h-[220px] overflow-auto border border-[var(--line)] rounded bg-[var(--bg)] shadow-lg">
                    {filtered.map((scope: DlmScope, i) => (
                        <div key={scope.id} role="option" aria-selected={i === active}
                            className={`px-2 py-1.5 cursor-pointer ${i === active ? 'bg-[var(--bg3)]' : ''}`}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={(e) => { e.preventDefault(); addScope(scope.id); }}>
                            <div>{scope.label}</div>
                            <div className="text-text-faint text-[10px]">{scope.group}</div>
                        </div>
                    ))}
                </div>,
                document.body
            )}
            {scopes.includes('metadata') && metaColumns.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {metaColumns.map((name) => {
                        const on = selectedMeta.includes(name);
                        return (
                            <button key={name} type="button" className="btn"
                                aria-pressed={on}
                                onClick={() => onMeta(on
                                    ? selectedMeta.filter((c) => c !== name)
                                    : [...selectedMeta, name])}>
                                {name}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}


/* ---- XStream JSON normalization helpers -------------------------------------- */

// Render an XStream-encoded value the way Swing does (shared decoder).
const displayValue = (v: any) => toDisplayString(v);

/* XStream maps arrive as {entry:[{string:[k,v]}]} or {entry:[{string:k, <type>:v}]}
   (singleton entries as a bare object), or occasionally as a plain object. */
function mapEntries(map: any) {
    if (!map || typeof map !== 'object') return [];
    if (map.entry === undefined) {
        return Object.entries(map)
            .filter(([k]) => !k.startsWith('@'))
            .map(([k, v]) => [k, displayValue(v)]);
    }
    const out: any[] = [];
    for (const entry of api.asList(map.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry.string) && Object.keys(entry).length === 1) {
            out.push([displayValue(entry.string[0]), displayValue(entry.string[1])]);
            continue;
        }
        const values: any[] = [];
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
function idNamePairs(map: any) {
    return mapEntries(map).map(([id, name]) => ({ id, name }));
}

/* Map<Integer,String> of metaDataId → connector name. */
function connectorEntries(map: any) {
    const out: any[] = [];
    const entries = map && typeof map === 'object' && map.entry !== undefined ? map.entry : map;
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        let id: any = null;
        let name: any = null;
        for (const [k, v] of Object.entries(entry)) {
            if (k.startsWith('@')) continue;
            if (typeof v === 'number') id = v;
            else if (typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'string') id = Number(v);
            else if (typeof v === 'string') name = v;
        }
        if (id !== null) out.push({ metaDataId: id, name: name ?? String(id) });
    }
    out.sort((a: any, b: any) => a.metaDataId - b.metaDataId);
    return out;
}

/* Message.connectorMessages is a Map<Integer,ConnectorMessage>:
   {entry:[{int:0, connectorMessage:{...}}, ...]} — singleton as bare object. */
function connectorMessagesOf(message: any) {
    const entries = message?.connectorMessages?.entry ?? message?.connectorMessages;
    const out: any[] = [];
    for (const entry of api.asList(entries)) {
        if (!entry || typeof entry !== 'object') continue;
        const cm = entry.connectorMessage ?? (entry.metaDataId !== undefined ? entry : null);
        if (cm && typeof cm === 'object') out.push(cm);
    }
    out.sort((a: any, b: any) => Number(a.metaDataId ?? 0) - Number(b.metaDataId ?? 0));
    return out;
}

function sourceOf(message: any) {
    const cms = connectorMessagesOf(message);
    // No fallback to cms[0]: when a filter (e.g. status=SENT) returns only
    // destination connector messages, the message has no source row — the parent
    // row then renders blank source-derived columns (Swing parity) instead of
    // borrowing a destination's connector name / status / dates / metadata.
    return cms.find(cm => Number(cm.metaDataId) === 0) ?? null;
}

function contentOf(messageContent: any) {
    const c = messageContent?.content;
    if (c === null || c === undefined || c === '') return null;
    return typeof c === 'object' ? displayValue(c) : String(c);
}

function connectorHasError(cm: any) {
    return Number(cm?.errorCode) > 0
        || contentOf(cm?.processingErrorContent) !== null
        || contentOf(cm?.postProcessorErrorContent) !== null
        || contentOf(cm?.responseErrorContent) !== null;
}

function messageHasError(message: any) {
    return connectorMessagesOf(message).some(connectorHasError);
}

/* Status pill (JSX twin of the imperative h('span.tag…') helper). */
function StatusTag({ status }: any) {
    const color = messageStatusTag(status);
    return <span className={'tag' + (color ? ' ' + color : '')}>{status || ''}</span>;
}

/* Calendar query params: yyyy-MM-dd'T'HH:mm:ss.SSSZ (RFC 822 zone, no colon). */
function toCalendarParam(datetimeLocal: any) {
    if (!datetimeLocal) return null;
    const d = new Date(datetimeLocal);
    if (isNaN(d.getTime())) return null;
    const pad = (n: any, w = 2) => String(n).padStart(w, '0');
    const offsetMinutes = -d.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function toCount(value: any) {
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

function advIsActive(adv: any) {
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
            const file = (input as any).files[0];
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
export async function openSendMessageDialog(platform: any, channelId: any, onSent: any) {
    let connectors: any[] = [];
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
                if (file) editor.setValue((file as any).content);
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
    const destTable = h('div.dt-wrap', { class: 'max-h-[126px] overflow-auto' },
        h('table.dt',
            h('thead', h('tr', h('th', 'Destination'), h('th', { class: 'w-[81px]' }, 'Included'))),
            h('tbody', destRows.map(d => {
                const c = connectors.find(x => x.metaDataId === d.metaDataId);
                return h('tr',
                    h('td', `${c.name}`),
                    h('td', { class: 'text-center' }, d.input));
            }))));

    /* ---- source map variables table ------------------------------------------ */

    const mapRows: any[] = [];          // [{key: input, value: input, tr}]
    let selectedMapRow: any = null;
    const mapTbody = h('tbody');

    function selectMapRow(row: any) {
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
        (row as any).tr = h('tr', { onMousedown: () => selectMapRow(row) },
            h('td', row.key), h('td', row.value));
        mapRows.push(row);
        mapTbody.appendChild((row as any).tr);
        selectMapRow(row);
        return row;
    }

    const mapTable = h('div.dt-wrap', { class: 'max-h-[126px] overflow-auto' },
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
                h('div.mt-[13px]', 'Send to the following destination(s):'),
                h('div', { class: 'mt-1.5' }, destTable)) : null,
            h('div.mt-[13px]', 'Include the following source map variables:'),
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
                    const metaDataIds = destRows.filter(d => (d.input as any).checked).map(d => d.metaDataId);
                    // MessageServletInterface expects sourceMapEntry values as "key=value".
                    const sourceMapEntries = mapRows
                        .filter(r => r.key.value.trim() !== '')
                        .map(r => `${r.key.value.trim()}=${r.value.value}`);
                    try {
                        await api.messages.processNew(channelId, rawData, metaDataIds, sourceMapEntries);
                        toast('Message sent for processing');
                        onSent && onSent();
                    } catch (e: any) {
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
function metaDataValue(m: any, name: any) {
    for (const cm of connectorMessagesOf(m)) {
        for (const [key, value] of mapEntries(cm.metaDataMap)) {
            if (String(key).toUpperCase() === String(name).toUpperCase() && value !== '') return value;
        }
    }
    return '';
}

const maxAttempts = (m: any) => Math.max(0, ...connectorMessagesOf(m).map(cm => Number(cm.sendAttempts) || 0));
const metaOfCm = (cm: any, name: any) => {
    for (const [k, v] of mapEntries(cm && cm.metaDataMap)) {
        if (String(k).toUpperCase() === String(name).toUpperCase() && v !== '') return v;
    }
    return '';
};
function errorLabel(cm: any) {
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
const errBadge = (label: any) => label ? <span className="text-err">{label}</span> : null;

/* Full built-in column set (mirrors the Swing MessageBrowser); `def` marks
   default-visible. parent() renders the source row, child() a destination.
   channelName is per-view state, so the set is built per render (memoized). */
function buildColumns(channelName: any, metaDataColumns: any) {
    const COLUMNS = [
        { key: 'id', label: 'Id', def: true, w: '90px', cls: 'num', sort: (m: any) => Number(m.messageId), parent: (m: any) => String(m.messageId), child: () => '' },
        { key: 'connector', label: 'Connector', def: true, sort: (m: any) => sourceOf(m)?.connectorName || '', parent: (m: any, s: any) => s ? (s.connectorName || 'Source') : '', child: (cm: any) => cm.connectorName || `Destination ${cm.metaDataId}` },
        { key: 'status', label: 'Status', def: true, w: '110px', sort: (m: any) => sourceOf(m)?.status || '', parent: (m: any, s: any) => s ? <StatusTag status={s.status} /> : '', child: (cm: any) => <StatusTag status={cm.status} /> },
        { key: 'origReceived', label: 'Orig. Received Date', cls: 'mono', sort: (m: any) => fmtDate(m.receivedDate), parent: (m: any) => fmtDate(m.receivedDate), child: () => '' },
        { key: 'received', label: 'Received Date', def: true, cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.receivedDate ?? m.receivedDate), parent: (m: any, s: any) => s ? fmtDate(s.receivedDate ?? m.receivedDate) : '', child: (cm: any) => fmtDate(cm.receivedDate) },
        { key: 'sendAttempts', label: 'Send Attempts', w: '100px', cls: 'num', sort: (m: any) => maxAttempts(m), parent: (m: any) => String(maxAttempts(m)), child: (cm: any) => String(Number(cm.sendAttempts) || 0) },
        { key: 'sendDate', label: 'Send Date', cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.sendDate), parent: (m: any, s: any) => s ? fmtDate(s.sendDate) : '', child: (cm: any) => fmtDate(cm.sendDate) },
        { key: 'responseDate', label: 'Response Date', def: true, cls: 'mono', sort: (m: any) => fmtDate(sourceOf(m)?.responseDate), parent: (m: any, s: any) => s ? fmtDate(s.responseDate) : '', child: (cm: any) => fmtDate(cm.responseDate) },
        { key: 'errors', label: 'Errors', def: true, w: '90px', sort: (m: any) => messageHasError(m) ? 0 : 1, parent: (m: any, s: any) => errBadge(errorLabel(s)), child: (cm: any) => errBadge(errorLabel(cm)) },
        { key: 'serverId', label: 'Server Id', cls: 'mono', sort: (m: any) => m.serverId || '', parent: (m: any) => m.serverId || '', child: (cm: any) => cm.serverId || '' },
        { key: 'origServerId', label: 'Original Server Id', cls: 'mono', sort: (m: any) => m.originalServerId || '', parent: (m: any) => m.originalServerId || '', child: () => '' },
        { key: 'originalId', label: 'Original Id', cls: 'num', sort: (m: any) => Number(m.originalId) || 0, parent: (m: any) => m.originalId != null ? String(m.originalId) : '', child: () => '' },
        { key: 'importId', label: 'Import Id', cls: 'num', sort: (m: any) => Number(m.importId) || 0, parent: (m: any) => m.importId != null ? String(m.importId) : '', child: () => '' },
        { key: 'importChannelId', label: 'Import Channel Id', cls: 'mono', sort: (m: any) => m.importChannelId || '', parent: (m: any) => m.importChannelId || '', child: () => '' },
        { key: 'channelName', label: 'Channel Name', sort: () => channelName, parent: () => channelName, child: () => '' }
    ];
    return [...COLUMNS, ...metaDataColumns.map((col: any) => ({
        key: `meta:${col.name}`, label: col.name, def: true,
        sort: (m: any) => metaDataValue(m, col.name),
        // Parent = the source connector message's metadata only (Swing parity):
        // blank when the source row isn't in the result, even if a destination
        // carries the value (that still shows on the destination's own row).
        parent: (m: any, s: any) => s ? metaOfCm(s, col.name) : '',
        child: (cm: any) => metaOfCm(cm, col.name)
    }))];
}

/* Default widths for the column manager (the `w`-carrying built-in columns). */
const MSG_COL_WIDTHS = { id: 90, status: 110, sendAttempts: 100, errors: 90 };

/* A null/empty model value renders as a centered, faint "--" (Swing parity):
   e.g. connector-derived columns on a source-less parent row, or message-level
   columns on a destination child row. String/JSX values pass through as-is. */
function Cell({ value, cls, indent }: any) {
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
}: any) {
    const tableRef = useRef<any>(null);
    const colRefs = useRef<any>({});       // key -> <col> element (live resize)

    const lastKey = cols.length ? cols[cols.length - 1].key : null;
    // Min width so the table scrolls (rather than crushing columns) when the fixed
    // widths exceed the viewport; the auto last column keeps an 80px floor.
    const minWidth = 26 + cols.reduce((sum: any, c: any) => sum + (c.key === lastKey ? 80 : mgr.width(c.key)), 0);

    /* ---- resize drag (live width via the <col> ref; commit on mouseup) ---- */
    const startResize = (e: any, key: any) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const col = colRefs.current[key];
        const startW = col ? parseFloat(col.style.width) || mgr.width(key) : mgr.width(key);
        document.body.style.cursor = 'col-resize';
        const move = (ev: any) => { const w = Math.max(40, startW + (ev.clientX - startX)); if (col) col.style.width = w + 'px'; };
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
    const autoFit = (e: any, key: any, displayIndex: any) => {
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
    const onColDrop = (e: any, toKey: any) => {
        e.preventDefault();
        e.currentTarget.classList.remove('col-drop');
        const from = e.dataTransfer.getData('text/plain');
        if (!from || from === toKey) return;
        const next = cols.map((c: any) => c.key).filter((k: any) => k !== from);
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
                {cols.map((c: any, i: any) => (
                    <th key={c.key} data-col-key={c.key} draggable
                        onContextMenu={onColumnMenu}
                        onClick={() => onSort(c.key)}
                        onDragStart={(e: any) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.key); e.currentTarget.classList.add('col-dragging'); }}
                        onDragEnd={(e: any) => e.currentTarget.classList.remove('col-dragging')}
                        onDragOver={(e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('col-drop'); }}
                        onDragLeave={(e: any) => e.currentTarget.classList.remove('col-drop')}
                        onDrop={(e: any) => onColDrop(e, c.key)}>
                        {c.label}{sortKey === c.key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
                        {c.key !== lastKey
                            ? <div className="col-resize"
                                onClick={(e: any) => e.stopPropagation()}
                                onDragStart={(e: any) => { e.preventDefault(); e.stopPropagation(); }}
                                onDoubleClick={(e: any) => autoFit(e, c.key, i)}
                                onMouseDown={(e: any) => startResize(e, c.key)} />
                            : null}
                    </th>
                ))}
            </tr>
        </thead>
    );

    const colgroup = (
        <colgroup>
            <col style={{ width: '26px' }} />
            {cols.map((c: any) => (
                <col key={c.key}
                    ref={(el: any) => { colRefs.current[c.key] = el; }}
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

    const bodyRows: any[] = [];
    for (const m of rows) {
        const source = sourceOf(m);
        // Not-yet-processed messages render gray italic across all columns,
        // on the parent and its children (Swing's italic cell renderer).
        const unprocessed = m.processed === false || m.processed === 'false';
        const rowCls = (key: any) => [key, unprocessed ? 'unprocessed' : ''].filter(Boolean).join(' ') || undefined;
        const dests = connectorMessagesOf(m).filter(cm => Number(cm.metaDataId) > 0);
        const expanded = expandedIds.has(String(m.messageId));
        bodyRows.push(
            <tr key={`m:${m.messageId}`} className={rowCls(selKey === `${m.messageId}:0` ? 'selected' : '')}
                onClick={() => onSelect(m, 0)}
                onContextMenu={(e: any) => onRowMenu(m, 0, e)}>
                <td>
                    <span className="msg-twisty"
                        onClick={dests.length ? (e: any) => { e.stopPropagation(); onToggleRow(String(m.messageId)); } : undefined}>
                        {dests.length ? (expanded ? '▾' : '▸') : ''}
                    </span>
                </td>
                {cols.map((c: any) => <Cell key={c.key} value={c.parent(m, source)} cls={c.cls} />)}
            </tr>
        );
        if (expanded) for (const cm of dests) {
            bodyRows.push(
                <tr key={`m:${m.messageId}:${cm.metaDataId}`}
                    className={'child ' + (rowCls(selKey === `${m.messageId}:${cm.metaDataId}` ? 'selected' : '') || '')}
                    onClick={() => onSelect(m, Number(cm.metaDataId))}
                    onContextMenu={(e: any) => onRowMenu(m, Number(cm.metaDataId), e)}>
                    <td></td>
                    {cols.map((c: any) => <Cell key={c.key} value={c.child(cm)} cls={c.cls} indent={c.key === 'connector'} />)}
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

function copyText(text: any) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(String(text == null ? '' : text)).then(
            () => toast('Copied to clipboard'),
            () => toast('Copy failed', 'warn'));
    } else { toast('Clipboard unavailable', 'warn'); }
}

function Loading({ text = 'Loading…' }: any) {
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
function ContentView({ content, dataType, responseEnvelope }: any) {
    // Response stages: unwrap the Response envelope — banner shows the status,
    // body shows only the inner message payload (often empty).
    const env = useMemo(() => responseEnvelope ? parseResponse(content) : null, [content, responseEnvelope]);
    const body = env ? (env.message || '') : content;
    const kind = detectType(body, dataType);

    // Pretty-print known structured types (XML/JSON) by default — gated on the
    // "Format text in message browser" user preference (Administrator settings).
    const [formatted, setFormatted] = useState(
        () => (kind === 'xml' || kind === 'json') && getPref('formatMessages') !== false);
    const [descriptions, setDescriptions] = useState<any>(null);
    const preRef = useRef<any>(null);

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
                        <input type="checkbox" checked={formatted} onChange={(e: any) => setFormatted(e.target.checked)} />
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
            <pre className="content-pre flex-1 min-h-[108px] max-h-none m-2.5" ref={preRef} />
        </div>
    );
}

/* Classic mappings table: Scope | Variable | Value rows aggregated across the
   connector message's maps. The header is a sortable, sticky banner — it
   stays put (table.dt th is position:sticky) while the rows scroll in the tab
   body, and clicking a column sorts by it (toggling asc/desc). */
const MAPPING_COLS = [
    { key: 'scope', label: 'Scope' }, { key: 'variable', label: 'Variable' }, { key: 'value', label: 'Value' }];

function MappingsTable({ cm }: any) {
    // Scope, deserialized map content. Matches the Swing browser exactly:
    // Source / Connector / Channel / Response only — no Custom Metadata.
    const rows = useMemo(() => {
        const groups = [
            ['Source', cm.sourceMapContent],
            ['Connector', cm.connectorMapContent],
            ['Channel', cm.channelMapContent],
            ['Response', cm.responseMapContent]
        ];
        const out: any[] = [];
        for (const [scope, mc] of groups) {
            for (const [variable, value] of mappingEntries(mc)) {
                out.push({ scope, variable: String(variable), value: String(value ?? '') });
            }
        }
        return out;
    }, [cm]);

    // null sort key = original Source→Response order.
    const [sort, setSort] = useState<any>({ key: null, dir: 1 });

    if (!rows.length) {
        return <div className="p-3.5"><div className="text-text-faint">There are no mappings present.</div></div>;
    }

    const view = sort.key
        ? [...rows].sort((a: any, b: any) => String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, { numeric: true }) * sort.dir)
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
                            onClick={() => setSort((s: any) => s.key === col.key ? { key: col.key, dir: -s.dir } : { key: col.key, dir: 1 })}>
                            {col.label}
                            {sort.key === col.key ? <span className="sort-arrow">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {view.map((r: any, i: any) => (
                    <tr key={i}>
                        <td className="w-[108px]">{r.scope}</td>
                        <td className="mono w-[30%]">{r.variable}</td>
                        <td className="mono whitespace-pre-wrap break-all">{r.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/* ---- attachments ------------------------------------------------------------------ */

function isTextualAttachment(type: any) {
    return /^text\/|json|xml|x-www-form-urlencoded/i.test(String(type || ''));
}

function attachmentExtension(type: any) {
    const subtype = String(type || '').split(';')[0].split('/')[1] || '';
    if (subtype === 'plain') return '.txt';
    const cleaned = subtype.replace(/[^\w]+/g, '').slice(0, 8);
    return cleaned ? `.${cleaned}` : '.bin';
}

async function exportAttachment(channelId: any, message: any, attachment: any) {
    const listType = displayValue(attachment.type) || 'application/octet-stream';
    try {
        await saveFile(`attachment-${displayValue(attachment.id)}${attachmentExtension(listType)}`, listType, async () => {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            const type = displayValue(full?.type ?? attachment.type) || 'application/octet-stream';
            let content: any = full?.content ?? full;
            if (typeof content !== 'string') content = displayValue(content);
            try {
                // Attachment content arrives Base64-encoded; decode to bytes,
                // then to text for textual types or a binary blob otherwise.
                const binary = atob((content as any).replace(/\s+/g, ''));
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                return isTextualAttachment(type) ? new TextDecoder().decode(bytes) : new Blob([bytes], { type });
            } catch { return content; /* not Base64 — save as-is */ }
        });
        toast('Attachment exported');
    } catch (e: any) {
        toast(`Failed to export attachment: ${e.message}`, 'error');
    }
}

/* Fallback block for attachments no viewer claims: Id/Type plus the classic
   Fetch Content + Export controls. */
function AttachmentFallback({ channelId, message, attachment }: any) {
    const [content, setContent] = useState<any>(null);
    const fetchContent = async () => {
        try {
            const full = await api.messages.attachment(channelId, message.messageId, attachment.id);
            let c: any = full?.content ?? full;
            if (typeof c === 'string') {
                try { c = atob(c); } catch { /* keep base64 */ }
            }
            setContent(displayValue(c));
        } catch (e: any) {
            toast(`Failed to fetch attachment: ${e.message}`, 'error');
        }
    };
    return (
        <div className="mt-[13px]">
            <dl className="kv">
                <dt>Id</dt><dd>{displayValue(attachment.id)}</dd>
                <dt>Type</dt><dd>{displayValue(attachment.type)}</dd>
            </dl>
            <div className="mt-[13px] flex gap-2">
                <button className="btn" onClick={fetchContent}><Icon name="eye" />Fetch Content</button>
                <TaskButton label="Export" icon="export" task="doExportAttachment" group="message"
                    onClick={() => exportAttachment(channelId, message, attachment)} />
            </div>
            {content != null && <pre className="content-pre mt-[13px]">{content}</pre>}
        </div>
    );
}

/* The message's attachments: fetch (reusing the message's cached list), then one
   block per attachment. A whole-message viewer (handleMultiple, e.g. DICOM — it
   reassembles the full object from the message) renders ONCE for all its
   attachments, not once per pixel-data attachment. Used by both the detail
   pane's Attachments tab and the View Attachment modal — React owns the viewer
   lifecycles in both. */
function AttachmentList({ platform, channelId, message }: any) {
    const [state, setState] = useState<any>({ status: 'loading' });
    useEffect(() => {
        let stale = false;
        (async () => {
            try {
                const attachments = message.__attachments ?? await api.messages.attachments(channelId, message.messageId);
                message.__attachments = attachments;   // cache for Export Attachment et al.
                if (!stale) setState({ status: 'ready', attachments });
            } catch (e: any) {
                if (!stale) setState({ status: 'error', error: e.message });
            }
        })();
        return () => { stale = true; };
    }, [channelId, message]);

    if (state.status === 'loading') return <Loading text="Loading attachments…" />;
    if (state.status === 'error') return <div className="text-text-faint">{`Failed to load attachments: ${(state as any).error}`}</div>;
    if (!(state as any).attachments.length) return <div className="text-text-faint">No attachments</div>;

    const shownOnce = new Set();
    const blocks: any[] = [];
    for (const attachment of (state as any).attachments) {
        const viewer = platform.attachmentViewers().find((x: any) => { try { return x.canHandle(attachment); } catch { return false; } });
        if (viewer && viewer.handleMultiple) {
            if (shownOnce.has(viewer.id)) continue;
            shownOnce.add(viewer.id);
        }
        if (viewer && viewer.component) {
            blocks.push(
                <div className="mt-[13px]" key={`v:${displayValue(attachment.id)}`}>
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
function viewAttachmentsModal(platform: any, channelId: any, m: any) {
    const host = h('div', { class: 'w-full min-w-0 max-h-[60vh] overflow-auto' });
    const teardown = mountReact(host, <AttachmentList platform={platform} channelId={channelId} message={m} />);
    modal({
        title: `Attachments — Message ${m.messageId}`, size: 'wide', body: host, buttons: [{ label: 'Close' }],
        onClose: () => { try { teardown(); } catch { /* ignore */ } }
    });
}

// Export Attachment (Swing MESSAGE_EXPORT_ATTACHMENT) — export directly when
// there's exactly one, otherwise open the viewer to pick.
async function exportAttachmentTask(platform: any, channelId: any, m: any) {
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
function DetailTabs({ defs }: any) {
    const [active, setActive] = useState(0);
    if (!defs.length) return null;
    const current = defs[Math.min(active, defs.length - 1)];
    return (
        <TabsPrimitive.Root value={String(active)} onValueChange={(v: any) => setActive(Number(v))}
            className="flex-1 min-h-0 flex flex-col">
            <TabsPrimitive.List className="tabs flex-none" aria-label="Message sections">
                {defs.map((def: any, i: any) => (
                    <TabsPrimitive.Trigger key={def.label} value={String(i)}
                        className={'tab' + (i === active ? ' active' : '')}>{def.label}</TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            <TabsPrimitive.Content key={current.label} value={String(active)}
                className="flex-1 min-h-0 overflow-auto">{current.node}</TabsPrimitive.Content>
        </TabsPrimitive.Root>
    );
}

/* Tab set for one connector message (content stages, errors, mappings,
   attachments) — mirrors the Swing browser's per-connector tabs. */
function ConnectorTabs({ message, cm, channelId, platform }: any) {
    const contentDefs = [
        ['Raw', 'raw'], ['Processed Raw', 'processedRaw'], ['Transformed', 'transformed'],
        ['Encoded', 'encoded'], ['Sent', 'sent'], ['Response', 'response'],
        ['Response Transformed', 'responseTransformed'], ['Processed Response', 'processedResponse']
    ];

    const defs: any[] = [];
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
                            <div className="text-text-faint mt-[13px]">{label}</div>
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
function DetailBody({ detail, channelId, platform }: any) {
    if (detail.status === 'empty') {
        return <div className="text-text-faint flex-none py-[8px] px-3.5">Select a message to view its contents.</div>;
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
function openAdvancedSearch({ connectors, metaDataColumns, adv, onApply }: any) {
    /* ---- connector inclusion table (Id | Current Connector Name | Included) --
       Mirrors the Swing MessageBrowserAdvancedFilter: all checked = no filter;
       if "Deleted Connectors" (null) stays checked, exclude the unchecked real
       connectors; otherwise include only the checked real connectors. */
    const isConnChecked = (key: any) => {
        if (adv.includedMetaDataIds) return adv.includedMetaDataIds.includes(key);
        if (adv.excludedMetaDataIds) return key === null ? true : !adv.excludedMetaDataIds.includes(key);
        return true;
    };
    const connRows: any[] = [];
    const connTbody = h('tbody');
    for (const c of [...connectors, { metaDataId: null, name: 'Deleted Connectors' }]) {
        const input = h('input', { type: 'checkbox', checked: isConnChecked(c.metaDataId) });
        connRows.push({ key: c.metaDataId, input });
        connTbody.appendChild(h('tr',
            h('td', { class: 'w-[45px]' }, c.metaDataId === null ? '--' : String(c.metaDataId)),
            h('td', c.name),
            h('td', { class: 'text-center w-[81px]' }, input)));
    }
    const setAllConn = (v: any) => connRows.forEach(r => { r.input.checked = v; });
    const connBlock = h('div',
        h('div', { class: 'flex justify-end gap-2.5 mb-1.5' },
            h('a', { class: 'link-btn', onClick: () => setAllConn(true) }, 'Select All'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAllConn(false) }, 'Deselect All')),
        h('div.dt-wrap', { class: 'max-h-[135px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', 'Id'), h('th', 'Current Connector Name'), h('th', 'Included'))),
                connTbody)));

    /* ---- id / numeric ranges (stacked "label: min – max" rows) ---- */
    const num = (value: any) => h('input', { type: 'number', value, class: 'flex-1 min-w-0 max-w-[135px]' });
    const inputs = {
        minMessageId: num(adv.minMessageId), maxMessageId: num(adv.maxMessageId),
        minOriginalId: num(adv.minOriginalId), maxOriginalId: num(adv.maxOriginalId),
        minImportId: num(adv.minImportId), maxImportId: num(adv.maxImportId),
        minSendAttempts: num(adv.minSendAttempts), maxSendAttempts: num(adv.maxSendAttempts),
        serverId: h('input', { type: 'text', value: adv.serverId, class: 'flex-1' })
    };
    const lbl = (text: any) => h('label', { class: 'w-[99px] flex-none text-right text-text-dim' }, text);
    const rangeRow = (label: any, a: any, b: any) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), a, h('span.text-text-faint', '–'), b);
    const singleRow = (label: any, el: any) => h('div', { class: 'flex items-center gap-2 mb-2' },
        lbl(label), el);

    const attachmentCheck = checkbox('Has Attachment', adv.attachment);
    const errorCheck = checkbox('Has Error', adv.error);

    /* ---- selectable search tables with right-side New/Delete ---- */
    function makeSelectableTable(head: any) {
        const tbody = h('tbody');
        const rows: any[] = [];
        let selected: any = null;
        const delBtn = h('button.btn', { disabled: true });
        const sel = (row: any) => {
            selected = row;
            tbody.querySelectorAll('tr').forEach(tr => tr.classList.remove('selected'));
            if (row) row.tr.classList.add('selected');
            (delBtn as any).disabled = !row;
        };
        delBtn.addEventListener('click', () => {
            if (!selected) return;
            const i = rows.indexOf(selected);
            selected.tr.remove();
            rows.splice(i, 1);
            sel(rows[Math.min(i, rows.length - 1)] ?? null);
        });
        const el = (onNew: any) => h('div', { class: 'flex gap-2 items-start' },
            h('div.dt-wrap', { class: 'flex-1 max-h-[135px] overflow-auto' },
                h('table.dt', h('thead', h('tr', head.map((l: any) => h('th', l)))), tbody)),
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
        (row as any).tr = h('tr', { onMousedown: () => cs.sel(row) }, h('td', row.type), h('td', row.text));
        cs.rows.push(row);
        cs.tbody.appendChild((row as any).tr);
        cs.sel(row);
        return row;
    }
    adv.contentSearches.forEach((c: any) => addContentSearchRow(c.type, c.text));

    /* Custom Metadata searches — "COLUMN OPERATOR value" strings. */
    const ms = makeSelectableTable(['Metadata', 'Operator', 'Value', 'Ignore Case']);
    function addMetaSearchRow(column?: any, operator = 'CONTAINS', value = '', ignoreCase = false) {
        const row = {
            column: metaDataColumns.length
                ? select(metaDataColumns.map((c: any) => c.name), column ?? metaDataColumns[0].name)
                : h('input', { type: 'text', value: column ?? '', placeholder: 'COLUMN_NAME' }),
            operator: select(META_SEARCH_OPERATORS, operator),
            value: h('input', { type: 'text', value, class: 'w-full' }),
            ignoreCase: h('input', { type: 'checkbox', checked: ignoreCase, title: 'Ignore case' })
        };
        (row as any).tr = h('tr', { onMousedown: () => ms.sel(row) },
            h('td', row.column), h('td', row.operator), h('td', row.value),
            h('td', { class: 'text-center w-[81px]' }, row.ignoreCase));
        ms.rows.push(row);
        ms.tbody.appendChild((row as any).tr);
        ms.sel(row);
        return row;
    }
    adv.metaDataSearches.forEach((m: any) => addMetaSearchRow(m.column, m.operator, m.value, m.ignoreCase));

    const sectionLabel = (text: any) => h('div', { class: 'font-semibold mt-3.5 mx-0 mb-1.5' }, text);

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
                        minMessageId: (inputs.minMessageId as any).value, maxMessageId: (inputs.maxMessageId as any).value,
                        minOriginalId: (inputs.minOriginalId as any).value, maxOriginalId: (inputs.maxOriginalId as any).value,
                        minImportId: (inputs.minImportId as any).value, maxImportId: (inputs.maxImportId as any).value,
                        serverId: (inputs.serverId as any).value,
                        minSendAttempts: (inputs.minSendAttempts as any).value, maxSendAttempts: (inputs.maxSendAttempts as any).value,
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
function reprocessDialog({ channelId, connectors, total, lastParams, messageId, isResults, onDone }: any) {
    const destRows = connectors.filter((c: any) => Number(c.metaDataId) > 0).map((c: any) => ({
        metaDataId: c.metaDataId, name: c.name,
        input: h('input', { type: 'checkbox', checked: true })
    }));
    const overwrite = checkbox('Overwrite existing messages and update statistics', false);
    const setAll = (v: any) => destRows.forEach((r: any) => { r.input.checked = v; });

    const destTable = destRows.length ? h('div',
        h('div', { class: 'flex justify-end gap-2.5 my-1 mx-0' },
            h('a', { class: 'link-btn', onClick: () => setAll(true) }, 'Select All'),
            h('span.text-text-faint', '|'),
            h('a', { class: 'link-btn', onClick: () => setAll(false) }, 'Deselect All')),
        h('div.dt-wrap', { class: 'max-h-[144px] overflow-auto' },
            h('table.dt',
                h('thead', h('tr', h('th', 'Destination'), h('th', { class: 'w-[81px]' }, 'Included'))),
                h('tbody', destRows.map((d: any) => h('tr',
                    h('td', d.name || `Destination ${d.metaDataId}`),
                    h('td', { class: 'text-center' }, d.input))))))) : null;

    modal({
        title: 'Reprocessing Options',
        size: 'wide',
        body: h('div',
            isResults ? h('div', {
                class: 'text-err mb-2.5 text-[11px]'
            }, h('b', 'Warning: '), `This will reprocess all ${fmtNumber(total)} result(s) for the current search criteria, including those not listed on the current page.`) : null,
            overwrite.el,
            destRows.length ? h('div.mt-[13px]', 'Reprocess through the following destinations:') : null,
            destTable),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: async () => {
                    const checked = destRows.filter((r: any) => r.input.checked).map((r: any) => r.metaDataId);
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
                            // Reprocessing a whole result set runs as long as the
                            // engine needs — no client ceiling (timeoutMs: null).
                            await api.post(`/channels/${channelId}/messages/_reprocess`, null, {
                                params: { ...lastParams, replace: overwrite.input.checked, filterDestinations, metaDataId: metaDataIds || [] },
                                timeoutMs: null
                            });
                            toast('Reprocess task submitted');
                        } else {
                            await api.messages.reprocess(channelId, messageId, overwrite.input.checked, filterDestinations, metaDataIds || []);
                            toast('Reprocess task sent');
                        }
                        onDone();
                    } catch (e: any) {
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

const dateStamp = (millis: any) => (fmtDate(millis) || '').replace(/[:\s]/g, '-');

/* Resolve a Swing-style file pattern for one message (My Computer mode).
   `count` is the 1-based running export index. Illegal filename characters
   are sanitized; '/' is kept so patterns may define sub-folders. */
function applyFilePattern(pattern: any, m: any, count: any, channelId: any) {
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
        .replace(/\$\{([^}]+)\}/g, (_: any, name: any) => {
            const k = String(name).trim();
            return Object.prototype.hasOwnProperty.call(vals, k) ? (vals as any)[k] : '';
        })
        .replace(/[\\:*?"<>|]+/g, '_');
}

/* Insert a value before the last dot of a filename (to disambiguate
   multiple destination files that share one pattern). */
function suffixName(name: any, suffix: any) {
    const dot = name.lastIndexOf('.');
    return dot > name.lastIndexOf('/') ? `${name.slice(0, dot)}_${suffix}${name.slice(dot)}` : `${name}_${suffix}`;
}

/* Full Swing-style "Export Results" dialog (MessageExportDialog /
   MessageExportPanel). Operates on the whole result set for the current
   search filter. My Computer exports run in the browser (ZIP via the Save
   dialog, or one file per message into a chosen folder); Server export
   defers the whole job to POST /messages/_export (which holds the
   encryption key, so content Encrypt is fully supported there). */
function exportResultsDialog({ channelId, total, lastParams }: any) {
    let aborted = false, running = false;

    const contentSel = select(EXPORT_CONTENT_OPTIONS, 'xml', { onChange: updateEnabled });
    const encryptCheck = checkbox('Encrypt', false);
    const attachCheck = checkbox('Include Attachments', false);
    const compressionSel = select([{ value: 'none', label: 'None' }, { value: 'zip', label: 'Zip' }], 'none', { onChange: updateEnabled });

    const radio = (name: any, checked?: any) => h('input', { type: 'radio', name, checked: checked || null, onChange: updateEnabled });
    const radioLabel = (input: any, text: any) => h('label', { class: 'inline-flex items-center gap-1 cursor-pointer' }, input, text);
    const pwYes = radio('exp-pw'); const pwNo = radio('exp-pw', true);
    const algoSel = select(ENCRYPTION_ALGORITHMS, 'AES128');
    const pwInput = h('input', { type: 'password', placeholder: 'Password', class: 'w-full' });
    const toServer = radio('exp-to'); const toComputer = radio('exp-to', true);

    const rootInput = h('input', { type: 'text', placeholder: '/path/accessible/by/server', class: 'flex-1' });
    const patternInput = h('textarea', { rows: '3', class: 'w-full font-[family-name:var(--mono)] resize-y' });
    (patternInput as any).value = DEFAULT_FILE_PATTERN;

    const insertToken = (token: any) => {
        const s = (patternInput as any).selectionStart ?? (patternInput as any).value.length;
        const e = (patternInput as any).selectionEnd ?? s;
        (patternInput as any).value = (patternInput as any).value.slice(0, s) + token + (patternInput as any).value.slice(e);
        const p = s + token.length;
        patternInput.focus(); (patternInput as any).setSelectionRange(p, p);
    };
    const varList = h('div.tree', { class: 'max-h-[135px] overflow-auto border border-[var(--border)] rounded-[4px] p-1' },
        FILE_PATTERN_VARS.map(([label, token]) => h('div.tree-node', {
            title: `Insert ${token}`, draggable: 'true', class: 'cursor-grab',
            onClick: () => insertToken(token),
            onDragstart: (e: any) => { e.dataTransfer.setData('text/plain', token); e.dataTransfer.effectAllowed = 'copy'; }
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
        const server = (toServer as any).checked;
        // My Computer always downloads a single ZIP (the browser's Save dialog
        // chooses the location); Compression only applies to Server export.
        if (!server) compressionSel.value = 'zip';
        compressionSel.disabled = !server;
        const zip = compressionSel.value === 'zip';
        attachCheck.input.disabled = !opt.xml;
        if (!opt.xml) attachCheck.input.checked = false;
        (pwYes as any).disabled = (pwNo as any).disabled = !zip;
        if (!zip) { (pwYes as any).checked = false; (pwNo as any).checked = true; }
        algoSel.disabled = (pwInput as any).disabled = !(zip && (pwYes as any).checked);
        (rootInput as any).disabled = !server;
    }

    // Swing MessageExportPanel layout: a right-aligned label column with its
    // controls, and the file-pattern variable list in a side panel.
    const lbl = (t: any) => h('div', { class: 'text-right whitespace-nowrap self-center' }, t);
    const cell = (...c: any[]) => h('div', { class: 'flex items-center gap-2 flex-wrap' }, ...c);
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
        body: h('div', { class: 'flex flex-wrap gap-[16px]' },
            h('div', { class: 'flex-1 min-w-[234px] flex flex-col gap-2' }, grid, status, barWrap),
            h('div', { class: 'w-full sm:w-[180px] min-w-0 flex flex-col' },
                h('label', { class: 'block mb-0.5' }, 'Variables:'),
                varList)),
        buttons: [
            { label: 'Cancel', onClick: () => { aborted = true; } },
            { label: 'Export', primary: true, onClick: () => { if (!running) runExport(); return false; } }
        ]
    });
    updateEnabled();

    function setDisabled(v: any) {
        for (const c of [contentSel, encryptCheck.input, attachCheck.input, compressionSel, pwYes, pwNo, algoSel, pwInput, toServer, toComputer, rootInput, patternInput]) (c as any).disabled = v;
        if (!v) updateEnabled();
    }
    function progress(done: any) {
        fill.style.width = total ? Math.round((done / total) * 100) + '%' : '0%';
        barWrap.setAttribute('aria-valuenow', String(done));
        status.textContent = `Exporting… ${fmtNumber(done)} / ${fmtNumber(total)}`;
    }

    // Stream every export file to `sink(name, content)`; returns counts.
    async function eachFile(sink: any, opt: any, pattern: any, includeAttachments: any) {
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
    async function sinkAttachments(sink: any, m: any, base: any) {
        let n = 0;
        try {
            const resp = await fetch(`/api/channels/${channelId}/messages/${m.messageId}/attachments?includeContent=true`, {
                headers: { 'Accept': 'application/xml', 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' },
                credentials: 'same-origin'
            });
            if (!resp.ok) return 0;
            const raw = parseResponse(await resp.text());
            const noExt = base.replace(/\.[^./]+$/, '');
            for (const att of api.asList((raw as any)?.list?.attachment ?? (raw as any)?.attachment ?? raw)) {
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

    async function runServerExport(o: any) {
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
            // The engine writes every matching message to its filesystem before
            // answering — minutes for a big filter — so no client ceiling.
            const count = await api.post(`/channels/${channelId}/messages/_export`, null, { params, timeoutMs: null });
            toast(`Server exported ${fmtNumber(Number(count) || 0)} message(s) to ${o.rootFolder}`);
            dlg.close();
        } catch (e: any) {
            toast(`Server export failed: ${e.message}`, 'error');
            running = false; setDisabled(false);
        }
    }

    async function runExport() {
        const opt = EXPORT_CONTENT_OPTIONS.find(o => o.value === contentSel.value) || EXPORT_CONTENT_OPTIONS[0];
        const compression = compressionSel.value;
        const pattern = (patternInput as any).value.trim() || DEFAULT_FILE_PATTERN;
        const encryptContent = encryptCheck.input.checked;
        const includeAttachments = attachCheck.input.checked && opt.xml;
        const pwProtect = (pwYes as any).checked && compression === 'zip';
        const algo = ENCRYPTION_ALGORITHMS.find(a => a.value === algoSel.value) || ENCRYPTION_ALGORITHMS[0];
        const password = (pwInput as any).value;

        if ((toServer as any).checked) {
            if (!(rootInput as any).value.trim()) { toast('Enter a Root Path for server export', 'warn'); return; }
            if (pwProtect && !password) { toast('Enter a password, or turn off Password protect', 'warn'); return; }
            return runServerExport({ opt, compression, pattern, encryptContent, includeAttachments, pwProtect, algo, password, rootFolder: (rootInput as any).value.trim() });
        }

        // My Computer (browser) export.
        if (encryptContent) {
            toast('Content encryption requires "Server" export — the encryption key stays on the server. Switch Export To: Server, or uncheck Encrypt.', 'warn');
            return;
        }
        if (pwProtect && !password) { toast('Enter a password, or turn off Password protect', 'warn'); return; }

        running = true; aborted = false; setDisabled(true); barWrap.style.display = '';
        const now = new Date();
        const pad = (n: any) => String(n).padStart(2, '0');
        const archiveName = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.zip`;
        const buildZip = async () => {
            const zip = createZip();
            const result = await eachFile((n: any, c: any) => { zip.add(n, c); }, opt, pattern, includeAttachments);
            if (aborted) throw new Error('cancelled');
            if (!result.files) throw new Error('No content of that type found in the results');
            const blob = await zip.generate((pwProtect ? { password, strength: algo.strength } : {}) as any);
            (buildZip as any).result = result;
            return blob;
        };

        try {
            // My Computer always downloads a single ZIP; the browser's Save
            // dialog (where supported) lets the user choose the location,
            // otherwise it goes to the default download folder.
            await saveFile(archiveName, 'application/zip', buildZip);
            // buildZip.result is unset if the user cancelled the Save dialog.
            if ((buildZip as any).result) {
                const r = (buildZip as any).result;
                toast(`Exported ${fmtNumber(r.files)} file(s) from ${fmtNumber(r.done)} message(s)`);
                dlg.close();
            } else {
                running = false; setDisabled(false); barWrap.style.display = 'none';
            }
        } catch (e: any) {
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

function Field({ label, children }: any) {
    return <div className="field"><label>{label}</label>{children}</div>;
}

export function MessagesView({ params, query }: any) {
    const channelId = params.channelId;

    /* ---- search-engine state ------------------------------------------------
       Search is an explicit command, so its cursor lives in refs the commands
       mutate synchronously; the render-relevant results mirror into state.
       searchRef re-points to this render's runSearch so dialogs and context
       menus (which outlive the render that opened them) always call a fresh
       closure. */
    const offsetRef = useRef(0);
    const limitRef = useRef(Number(getPref('messagePageSize')) || 20);
    const totalRef = useRef<any>(null);   // full match count — null until counted (lazy) or auto-resolved on the last page
    const lastParamsRef = useRef<any>({});
    const searchRef = useRef<any>(null);
    // Latest selection mirror: async detail loads guard against a stale row, and
    // task-pane buttons resolve their target at execution time.
    const selectedRef = useRef<any>(null);

    // Staged advanced criteria (the dialog stages; Search runs). Deep-link from
    // the dashboard (double-click a connector row): pre-filter the search to
    // that single connector by its metaDataId.
    const advRef = useRef<any>(null);
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
    const [dlmScopes, setDlmScopes] = useState<string[]>([]);
    const [dlmMetaColumns, setDlmMetaColumns] = useState<string[]>([]);
    const [connectorVal, setConnectorVal] = useState('');
    const [pageSize, setPageSize] = useState(() => String(Number(getPref('messagePageSize')) || 20));
    const [advOn, setAdvOn] = useState(() => advIsActive(advRef.current));
    const [searchSummary, setSearchSummary] = useState('Current Search: (none — press Search)');
    const [criteriaCollapsed, setCriteriaCollapsed] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);

    /* ---- results + table state ---- */
    const [connectors, setConnectors] = useState([] as any[]);
    const [channelName, setChannelName] = useState(channelId);
    /* Every channel, for the picker. The browser is reachable without one — the
       bare /messages route — and the picker is how you choose. */
    const [channelList, setChannelList] = useState([] as any[]);
    const [metaDataColumns, setMetaDataColumns] = useState([] as any[]);
    const [messages, setMessages] = useState([] as any[]);
    // shown: null = no search has completed yet (blank counts label, legacy
    // parity) — distinct from a completed search with zero rows ('No results').
    const [pager, setPager] = useState<any>({ offset: 0, shown: null, total: null, hasNext: false });
    const [countBusy, setCountBusy] = useState(false);
    const [sort, setSort] = useState<any>({ key: 'id', dir: -1 });   // newest first by default
    const [expandedIds, setExpandedIds] = useState(() => new Set());
    const [allExpanded, setAllExpanded] = useState(false);
    const [selected, setSelected] = useState<any>(null);             // {m, metaDataId}
    const [detail, setDetail] = useState<any>({ status: 'empty' });

    /* Column visibility (persisted separately from the manager, matching the
       legacy webadmin-msg-columns store — `def` flags are the fallback). */
    const [columnVis, setColumnVis] = useState(() => {
        try { return JSON.parse(localStorage.getItem('webadmin-msg-columns') || '{}'); } catch { return {}; }
    });
    const saveColumnVis = (v: any) => { try { localStorage.setItem('webadmin-msg-columns', JSON.stringify(v)); } catch { /* private mode */ } };
    const isVisible = (c: any, vis: any) => (c.key in vis) ? !!vis[c.key] : !!c.def;

    // Column order + widths (resizable / reorderable, persisted), like the
    // dashboard. Visibility stays with columnVis above; the manager owns only
    // order + widths. columnsRev bumps after manager mutations to re-render.
    const mgrRef = useRef<any>(null);
    if (!mgrRef.current) mgrRef.current = createColumnManager('messages', MSG_COL_WIDTHS);
    const mgr = mgrRef.current;
    const [columnsRev, setColumnsRev] = useState(0);

    const allCols = useMemo(() => buildColumns(channelName, metaDataColumns), [channelName, metaDataColumns]);
    const visibleCols = useMemo(() => {
        const present = allCols.filter(c => isVisible(c, columnVis));
        return mgr.order(present.map(c => c.key)).map((k: any) => present.find(c => c.key === k));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allCols, columnVis, columnsRev]);

    const sortedMessages = useMemo(() => {
        const col = allCols.find(c => c.key === sort.key);
        if (!col) return messages;
        return [...messages].sort((a: any, b: any) => {
            const va = col.sort(a), vb = col.sort(b);
            return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
        });
    }, [messages, sort, allCols]);

    /* ---- params + summary (built from the live criteria at search time) ---- */

    function buildParams(dlmDecision: DlmDecision | null = null) {
        const adv = advRef.current;
        const params: any = {};
        const start = toCalendarParam(startDate);
        const end = toCalendarParam(endDate);
        if (start) params.startDate = start;
        if (end) params.endDate = end;
        if (statusSel.size) params.status = [...statusSel];
        // Text Search: the DLM turns the phrase into scoped params (content /
        // maps / metadata / message id). Never emit the engine textSearch
        // wildcard unless the user explicitly chose the legacy scope.
        if (dlmDecision) {
            Object.assign(params, dlmDecision.params);
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
        const nameOf = (id: any) => {
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
    function describeSearch(dlmDecision: DlmDecision | null = null) {
        const adv = advRef.current;
        const range = (lo: any, hi: any) => {
            lo = String(lo ?? '').trim(); hi = String(hi ?? '').trim();
            if (lo && hi) return `${lo}–${hi}`;
            if (lo) return `≥ ${lo}`;
            if (hi) return `≤ ${hi}`;
            return null;
        };
        const dt = (v: any) => v ? v.replace('T', ' ') : '(any)';
        const parts: any[] = [];
        parts.push(`Statuses: ${statusSel.size ? [...statusSel].join(', ') : '(any)'}`);
        parts.push(`Date Range: ${dt(startDate)} to ${dt(endDate)}`);
        if (dlmDecision?.summary?.length) {
            parts.push(...dlmDecision.summary);
        }
        parts.push(`Connectors: ${describeConnectors()}`);
        let r: any;
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

    // Search responses can resolve out of order (a slow page-1 landing after a
    // fast page-2); only the newest issued search may write results.
    const searchGenRef = useRef(0);

    async function runSearch(resetOffset: any) {
        let dlmDecision: DlmDecision | null = null;
        if (resetOffset) {
            const text = textSearch.trim();
            if (text) {
                // Scope already on the bar → build immediately. Otherwise open
                // the DLM prompt so Text Search never becomes an unscoped wildcard.
                if (dlmScopes.length) {
                    dlmDecision = dlmBuildDecision(text, {
                        scopes: dlmScopes,
                        metaColumns: dlmMetaColumns,
                        metaIgnoreCase: true,
                        textSearchRegex: textRegex
                    });
                    if (dlmDecision.operation === 'UNSUPPORTED') {
                        toast('That scope cannot be applied to this phrase (e.g. Message Id needs digits).', 'error');
                        return;
                    }
                } else {
                    dlmDecision = await promptDlmSearchScope({
                        text,
                        metaDataColumns,
                        textSearchRegex: textRegex
                    });
                    if (!dlmDecision) return;   // cancelled — leave the current results alone
                    setDlmScopes(dlmDecision.scopes);
                    setDlmMetaColumns(dlmDecision.metaColumns);
                }
                setPrefs({
                    messageSearchDlmScopes: dlmDecision.scopes,
                    messageSearchDlmMetaColumns: dlmDecision.metaColumns
                });
            }
        }

        const gen = ++searchGenRef.current;
        if (resetOffset) {
            offsetRef.current = 0;
            lastParamsRef.current = buildParams(dlmDecision);
            limitRef.current = Number(pageSize) || 20;
            setSearchSummary(`Current Search: ${describeSearch(dlmDecision)}`);
            totalRef.current = null;   // lazily counted (Count button) or auto-resolved on the last page
        }
        try {
            // Fetch one extra row to learn whether a next page exists, instead of
            // paying for a COUNT on every search (Swing's lazy-count model).
            const rows = await api.messages.search(channelId, { ...lastParamsRef.current, offset: offsetRef.current, limit: limitRef.current + 1 });
            if (gen !== searchGenRef.current) return;   // superseded by a newer search
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
        } catch (e: any) {
            if (gen !== searchGenRef.current) return;   // superseded — its results are on screen
            toast(`Search failed: ${e.message}`, 'error');
        }
    }
    searchRef.current = runSearch;

    /* The total match count is resolved lazily (Swing's Count button): a COUNT is
       expensive on large tables, so we don't run one on every search. */
    async function ensureTotal() {
        if (totalRef.current != null) return totalRef.current;
        const gen = searchGenRef.current;
        const n = toCount(await api.messages.count(channelId, lastParamsRef.current));
        // A count that lands after a newer search must not clobber that search's
        // total (runSearch's generation rule); it still answers the caller that asked.
        if (gen === searchGenRef.current) totalRef.current = n;
        return n;
    }
    async function doCount() {
        const gen = searchGenRef.current;
        setCountBusy(true);
        let n;
        try { n = await ensureTotal(); }
        catch (e: any) {
            if (gen === searchGenRef.current) toast(`Count failed: ${e.message}`, 'error');
            return;
        }
        finally { setCountBusy(false); }
        if (gen !== searchGenRef.current) return;   // superseded — the newer search owns the pager
        setPager((p: any) => ({ ...p, total: n }));
    }

    /* ---- selection + detail ---- */

    function selectMessage(m: any, metaDataId: any) {
        selectedRef.current = { m, metaDataId };
        setSelected({ m, metaDataId });
        // The parent (source) row is a placeholder when the source connector
        // message isn't in the result (e.g. a destination-only status filter):
        // there's no connector in context, so show nothing rather than fetching
        // the full message and rendering its source — matching the Swing browser.
        if (Number(metaDataId) === 0 && !sourceOf(m)) setDetail({ status: 'empty' });
        else showDetail(m, metaDataId);
    }

    async function showDetail(row: any, metaDataId: any) {
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
        } catch (e: any) {
            toast(`Failed to load message content: ${e.message}`, 'error');
        }
        if (selectedRef.current?.m !== row) return; // selection changed while loading
        setDetail({ status: 'ready', message, metaDataId });
    }

    /* Detail pane height: the global .split-handle mutates style.height directly
       during drags, so React never renders the height — a layout effect applies
       the 36px collapsed strip / restored expanded height only on transitions,
       preserving the user-dragged height across selections (legacy parity). */
    const detailPaneRef = useRef<any>(null);
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

    function openColumnMenu(e: any) {
        e.preventDefault();
        const items = allCols.map(c => ({
            label: (isVisible(c, columnVis) ? '✓  ' : '    ') + c.label,
            onClick: () => setColumnVis((vis: any) => {
                const next = { ...vis, [c.key]: !isVisible(c, vis) };
                saveColumnVis(next);
                return next;
            })
        }));
        (items as any).push('-', { label: 'Restore Default', onClick: () => { saveColumnVis({}); setColumnVis({}); } });
        contextMenu(e.clientX, e.clientY, items as any);
    }

    // Right-click parity with the Swing Message Browser (Frame.messagePopupMenu —
    // the full Message Tasks list). Per-message items take this row explicitly —
    // the menu outlives the render that opened it, so it never reads selection
    // state that may have moved on.
    function messageRowMenu(m: any, metaDataId: any, e: any) {
        e.preventDefault();
        selectMessage(m, metaDataId);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshMessages', group: 'message', onClick: () => {
                offsetRef.current = 0;
                totalRef.current = null;
                searchRef.current(false);
            } },
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
        } catch (e: any) {
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
        } catch (e: any) {
            toast(`Remove all failed: ${e.message}`, 'error');
        }
    }

    /* ---- results operations (operate on the current search filter) ---- */

    async function removeResultsTask() {
        const filter = { ...lastParamsRef.current };
        let total;
        try { total = await ensureTotal(); }
        catch (e: any) { toast(`Count failed: ${e.message}`, 'error'); return; }
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
            // search params already built for GET /messages. Removing a whole
            // result set can outlast the default ceiling — no client timeout.
            await api.del(`/channels/${channelId}/messages`, filter, { timeoutMs: null });
            toast('Messages removed');
            searchRef.current(true);
        } catch (e: any) {
            toast(`Remove results failed: ${e.message}`, 'error');
        }
    }

    async function reprocessResultsTask() {
        let total;
        try { total = await ensureTotal(); }
        catch (e: any) { toast(`Count failed: ${e.message}`, 'error'); return; }
        reprocessDialog({
            channelId, connectors, total, lastParams: lastParamsRef.current,
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
        let lastError: any = null;
        for (const xml of blocks) {
            try {
                await api.post(`/channels/${channelId}/messages/_import`, xml, { contentType: 'application/xml' });
                imported++;
            } catch (e: any) {
                failed++;
                lastError = e;
            }
        }
        if (failed) toast(`Imported ${imported} message(s); ${failed} failed: ${lastError.message}`, 'error');
        else toast(`Imported ${imported} message(s)`);
        searchRef.current(true);
    }

    async function exportResultsTask() {
        let total;
        try { total = await ensureTotal(); }
        catch (e: any) { toast(`Count failed: ${e.message}`, 'error'); return; }
        if (!total) { toast('No results to export', 'warn'); return; }
        exportResultsDialog({ channelId, total, lastParams: lastParamsRef.current });
    }

    /* ---- status filter dropdown (imperative checklist over the trigger) ---- */

    const [statusMenuOpen, setStatusMenuOpen] = useState(false);

    /* The status filter is a checklist, not a list of commands, so its items are
       Radix menuitemcheckboxes — announced with their checked state, and operable
       with the arrows/type-ahead/Escape the hand-built version never had. */
    function closeStatusMenu() { setStatusMenuOpen(false); }

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
        setDlmScopes([]);
        setDlmMetaColumns([]);
        setPrefs({ messageSearchDlmScopes: [], messageSearchDlmMetaColumns: [] });
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
            onApply: (next: any) => { advRef.current = next; setAdvOn(advIsActive(next)); }
        });
    }

    /* ---- filters popover (narrow layout) ---- */

    /* Wide, the criteria are an inline block the "Search Criteria" heading
       collapses; narrow, they move behind the Filters button as a popover. Radix
       positions and portals a popover, so it cannot also be the inline block —
       hence the threshold the container query used to apply is measured here. */
    const criteriaPanelRef = useRef<any>(null);
    const [narrowCriteria, setNarrowCriteria] = useState(false);
    useLayoutEffect(() => {
        const el = criteriaPanelRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setNarrowCriteria(entry.contentRect.width <= CRITERIA_INLINE_MIN));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /* ---- bootstrap ---- */

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (channelId) {
                try {
                    const names = await api.channels.connectorNames(channelId);
                    if (!cancelled) setConnectors(connectorEntries(names));
                } catch (e: any) {
                    toast(`Failed to load connectors: ${e.message}`, 'error');
                }
                try {
                    const cols = (await api.channels.metaDataColumns(channelId)).filter(c => c && c.name);
                    if (!cancelled && cols.length) setMetaDataColumns(cols);
                } catch { /* channel has no custom metadata columns */ }
            }
            try {
                const map = await api.channels.idsAndNames();
                const pairs = idNamePairs(map);
                if (!cancelled) setChannelList(pairs.slice().sort((a: any, b: any) => a.name.localeCompare(b.name)));
                const found = pairs.find(c => c.id === channelId);
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
            // Nothing to search until a channel is chosen.
            if (!cancelled && channelId) searchRef.current(true);
        })();
        if (channelId && query.send === '1') setTimeout(() => { if (!cancelled) sendMessageTask(); }, 200);
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

    /* Defined once and mounted inline or in the popover — two homes, not two copies. */
    /* WHICH channel, as opposed to what to search for — so it belongs beside the
       panel heading rather than in the criteria grid, and stays reachable while
       the criteria are collapsed. Changing it navigates, keeping the URL the
       thing that identifies a search and re-bootstrapping the view against the
       new channel's connectors and metadata columns. */
    const channelPicker = (
        <label className="msg-channel">
            <span>Channel</span>
            <select value={channelId || ''} aria-label="Channel"
                onChange={(e: any) => {
                    const id = e.target.value;
                    router.navigate(id ? `/messages/${id}` : '/messages');
                }}>
                <option value="">Select a channel…</option>
                {channelList.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        </label>
    );

    const criteria = (
        <>
                        <div className="form-row">
                            <Field label="Start Date">
                                <DateTimeField value={startDate} onChange={setStartDate} label="Start date" />
                            </Field>
                            <Field label="End Date">
                                <DateTimeField value={endDate} onChange={setEndDate} label="End date" />
                            </Field>
                            <Field label="Status">
                                <DropdownMenu.Root open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
                                    <DropdownMenu.Trigger asChild>
                                        <button type="button" className="btn justify-between min-w-[119px] font-normal">
                                            <span className="truncate">{statusLabel as any}</span>
                                            <span className="text-text-faint ml-2" aria-hidden="true">▾</span>
                                        </button>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                        <DropdownMenu.Content className="ctx-surface min-w-[144px]"
                                            align="start" sideOffset={4} collisionPadding={8}>
                                            {STATUS_FILTER_ORDER.map((st: any) => (
                                                <DropdownMenu.CheckboxItem key={st} className="ctx-item"
                                                    checked={statusSel.has(st)}
                                                    /* Ticking one status shouldn't shut the list — you
                                                       nearly always pick more than one. */
                                                    onSelect={(e: any) => e.preventDefault()}
                                                    onCheckedChange={(on: any) => setStatusSel((prev: any) => {
                                                        const next = new Set(prev);
                                                        on ? next.add(st) : next.delete(st);
                                                        return next;
                                                    })}>
                                                    {/* The slot is always there — ItemIndicator itself
                                                        unmounts when unchecked, which would shuffle the labels. */}
                                                    <span className="ctx-check" aria-hidden="true">
                                                        <DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator>
                                                    </span>
                                                    {st}
                                                </DropdownMenu.CheckboxItem>
                                            ))}
                                            <DropdownMenu.Separator className="ctx-sep" />
                                            <DropdownMenu.Item className="ctx-item"
                                                onSelect={() => setStatusSel(new Set())}>Clear (Any)</DropdownMenu.Item>
                                        </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                </DropdownMenu.Root>
                            </Field>
                            {/* The Regex checkbox rides on the label line (top-right of the
                                field) so it costs no slot in the criteria row. */}
                            <div className="field relative">
                                <label>Text Search</label>
                                <label className="check msg-regex"
                                    title="Treat the text search as a regular expression">
                                    <input type="checkbox" checked={textRegex} onChange={(e: any) => setTextRegex(e.target.checked)} />
                                    Regex
                                </label>
                                <input type="text" placeholder="Phrase…" className="w-[198px]"
                                    value={textSearch} onChange={(e: any) => setTextSearch(e.target.value)}
                                    onKeyDown={(e: any) => { if (e.key === 'Enter') runSearch(true); }} />
                            </div>
                            <DlmScopeField
                                scopes={dlmScopes}
                                onScopes={setDlmScopes}
                                metaColumns={metaDataColumns.map((c: any) => String(c?.name || '').trim()).filter(Boolean)}
                                selectedMeta={dlmMetaColumns}
                                onMeta={setDlmMetaColumns}
                            />
                            <Field label="Connector">
                                <select value={connectorVal} onChange={(e: any) => setConnectorVal(e.target.value)}>
                                    <option value="">Any</option>
                                    {connectors.map(c => (
                                        <option key={c.metaDataId} value={String(c.metaDataId)}>{`${c.name} (${c.metaDataId})`}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Page Size">
                                <select value={pageSize} onChange={(e: any) => setPageSize(e.target.value)}>
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
                                {advOn && <span className="inline-block w-[6px] h-[6px] ml-[6px] rounded-full bg-accent" />}
                            </button>
                        </div>
                        <div className="text-text-faint mt-1.5">{searchSummary}</div>
        </>
    );

    return (
        <div className="view">
            {/* Every task here acts on a channel (or a selection within one), so the
                pane stays empty until one is chosen rather than offering actions
                that cannot run. */}
            {channelId && <ViewTasks>
                <RailPane title="Message Tasks" paneKey="tasks:Message Tasks" group="message">
                    <div className="taskbar" data-pane-title="Message Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshMessages" onClick={() => {
                            // Re-run the last scoped params — do not re-open the DLM prompt.
                            offsetRef.current = 0;
                            totalRef.current = null;
                            runSearch(false);
                        }} />
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
            </ViewTasks>}
            <div className="view-body flush flex flex-col h-full min-h-0">
                {/* Wide: click the "Search Criteria" heading to collapse the criteria
                    in place. Narrow: they collapse into a "Filters" popover. */}
                {/* Wide: the "Search Criteria" heading is a real disclosure over the
                    inline criteria. Narrow: the same criteria move behind the Filters
                    button, where Radix owns Escape, outside-click and focus return. */}
                <div ref={criteriaPanelRef} className="panel filter-collapse flex-none mx-[13px] mt-3 mb-3">
                    {narrowCriteria ? (
                        <div className="panel-header flex items-center gap-2">
                            <span className="criteria-heading inline-flex items-center gap-1.5">Search Criteria</span>
                            {channelPicker}
                            <Popover.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
                                <Popover.Trigger asChild>
                                    <button className="btn filter-toggle" type="button">
                                        <Icon name="filter" /><span>Filters</span><Icon name="chevD" />
                                    </button>
                                </Popover.Trigger>
                                <Popover.Portal>
                                    <Popover.Content className="panel-body filter-popover filter-popover-pop"
                                        align="start" sideOffset={6} collisionPadding={12}>
                                        {criteria}
                                    </Popover.Content>
                                </Popover.Portal>
                            </Popover.Root>
                        </div>
                    ) : (
                        <Collapsible.Root open={!criteriaCollapsed}
                            onOpenChange={(open: any) => setCriteriaCollapsed(!open)}>
                            <div className="panel-header flex items-center gap-2">
                                <Collapsible.Trigger asChild>
                                    <button type="button" className="criteria-heading inline-flex items-center gap-1.5">
                                        <span aria-hidden="true">{criteriaCollapsed ? '▸' : '▾'}</span>
                                        Search Criteria
                                    </button>
                                </Collapsible.Trigger>
                                {channelPicker}
                            </div>
                            <Collapsible.Content className="panel-body filter-popover">
                                {criteria}
                            </Collapsible.Content>
                        </Collapsible.Root>
                    )}
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden oie-tablecard px-[13px] pt-3 pb-3">
                    {!channelId ? (
                        <div className="dt-empty">
                            <div className="empty-icon"><Icon name="messages" size={30} /></div>
                            Choose a channel to search its messages.
                        </div>
                    ) : (
                    <ResultsTable
                        cols={visibleCols} mgr={mgr} rows={sortedMessages}
                        expandedIds={expandedIds} allExpanded={allExpanded}
                        selKey={selected ? `${selected.m.messageId}:${selected.metaDataId}` : null}
                        sortKey={sort.key} sortDir={sort.dir}
                        onSort={(key: any) => setSort((s: any) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 })}
                        onToggleAll={toggleAll}
                        onToggleRow={(id: any) => setExpandedIds(prev => {
                            const next = new Set(prev);
                            next.has(id) ? next.delete(id) : next.add(id);
                            return next;
                        })}
                        onSelect={selectMessage}
                        onRowMenu={messageRowMenu}
                        onColumnMenu={openColumnMenu}
                        onColumnsChange={() => setColumnsRev(r => r + 1)} />
                    )}
                </div>

                <div className="filterbar flex-none panel overflow-visible mx-[13px]">
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

                <div className="split-handle mx-[13px]" data-orient="v" data-resize="next" />
                <div ref={detailPaneRef} className="flex-none h-[32px] overflow-hidden flex flex-col panel mx-[13px] mb-3">
                    <DetailBody detail={detail} channelId={channelId} platform={platform} />
                </div>
            </div>
        </div>
    );
}
