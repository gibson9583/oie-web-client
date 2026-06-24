/*
 * Events view (React port of views/events.js). Criteria bar → paginated results
 * table (DataTableHost) → resizable detail pane. The XStream normalization,
 * level/outcome tags, calendar-param formatting and the subtle buildParams/
 * countParams engine quirks are reused VERBATIM; the criteria inputs are
 * controlled React state, the detail pane is a React component.
 */

import { useState, useEffect, useRef, useReducer } from 'react';
import { h, icon, toast, confirmDialog, contextMenu, fmtDate, fmtNumber } from '@oie/web-ui';
import api from '@oie/web-api';
import { toDisplayString } from '../../core/xstream.js';
import { getPref } from '../../core/prefs.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, DataTableHost } from '../ui.jsx';
import { Icon } from '../bridges.jsx';

const LEVELS = ['INFORMATION', 'WARNING', 'ERROR'];
const OUTCOMES = ['SUCCESS', 'FAILURE'];

export function register(platform) {
    platform.registerNavItem({ id: 'events', label: 'Events', icon: 'events', path: '/events', section: 'Engine', order: 5 });
    platform.registerView('/events', reactView(EventsView), { title: 'Events' });
}

/* ---- XStream normalization + display helpers (reused verbatim) ---- */

const displayValue = (v) => toDisplayString(v);

function mapEntries(map) {
    if (!map || typeof map !== 'object') return [];
    if (map.entry === undefined) {
        return Object.entries(map).filter(([k]) => !k.startsWith('@')).map(([k, v]) => [k, displayValue(v)]);
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

function eventAttr(event, key) {
    for (const [k, v] of mapEntries(event && event.attributes)) {
        if (k === key) return v == null ? '' : String(v).trim();
    }
    return '';
}
function eventChannelId(event) {
    const channel = eventAttr(event, 'channel');
    const i = channel.indexOf('id='), c = channel.indexOf(',');
    return (i !== -1 && c !== -1) ? channel.slice(i + 3, c) : '';
}
function eventChannelName(event) {
    const channel = eventAttr(event, 'channel');
    const i = channel.indexOf('name='), b = channel.indexOf(']');
    return (i !== -1 && b !== -1) ? channel.slice(i + 5, b) : '';
}
function eventChannelIdWithMessageId(event) {
    const id = eventChannelId(event);
    const msg = eventAttr(event, 'messageId');
    return id ? (msg ? `${id} - ${msg}` : id) : '';
}

function normalizeEvents(rows) {
    if (rows.length === 1 && rows[0] && typeof rows[0] === 'object'
            && rows[0].id === undefined && rows[0].event !== undefined) {
        return api.asList(rows[0].event);
    }
    return rows.filter(r => r && typeof r === 'object');
}

function levelTag(level) {
    if (level === 'ERROR') return h('span.tag.red', icon('warning', 11), 'ERROR');
    if (level === 'WARNING') return h('span.tag.amber', icon('warning', 11), 'WARNING');
    return h('span.tag.blue', icon('info', 11), level || '');
}
function outcomeTag(outcome) {
    if (outcome === 'SUCCESS') {
        return h('span.tag', { class: 'text-ok border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,transparent)]' }, icon('check', 11), 'SUCCESS');
    }
    if (outcome === 'FAILURE') return h('span.tag.red', icon('x', 11), 'FAILURE');
    return h('span.tag', outcome || '');
}

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

function shortError(e) {
    let msg = String((e && e.message) || e || 'Unknown error');
    if (msg.includes('<')) msg = msg.replace(/<[^>]*>/g, ' ');
    msg = msg.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (msg.length > 180) msg = msg.slice(0, 180) + '…';
    if (!msg) msg = 'Unknown error';
    return (e && e.status) ? `${msg} (HTTP ${e.status})` : msg;
}

/* ---- small React form helpers ---- */

function Field({ label, children }) {
    return <div className="field"><label>{label}</label>{children}</div>;
}

/* ---- detail pane ---- */

function EventDetail({ event, username }) {
    if (!event) return <div className="dt-empty">Select an event to view its details.</div>;
    const kv = (label, value) => (
        <span className="flex items-center gap-[5px]">
            <span className="text-text-faint text-[10.5px] font-[640] tracking-[0.1em] uppercase">{label}</span>
            <span className="mono font-mono text-[12px]">{value}</span>
        </span>
    );
    const attributes = mapEntries(event.attributes)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
    const valueClass = 'whitespace-pre-wrap [word-break:break-word] font-mono text-[11.5px]';
    return (
        <>
            <div className="flex flex-wrap items-center gap-[18px] py-2 px-3.5 border-b border-line flex-none">
                {kv('Id', displayValue(event.id))}
                {kv('Level', displayValue(event.level))}
                {kv('Outcome', displayValue(event.outcome))}
                {kv('User', username(event.userId))}
                {kv('IP', displayValue(event.ipAddress))}
            </div>
            {attributes.length
                ? <table className="dt">
                    <thead><tr><th className="w-[1%]">Name</th><th>Value</th></tr></thead>
                    <tbody>{attributes.map(([k, v], i) => (
                        <tr key={i}>
                            <td className="whitespace-nowrap align-top font-semibold">{k}</td>
                            <td className={"mono " + valueClass}>{v}</td>
                        </tr>
                    ))}</tbody>
                </table>
                : <div className="text-text-faint py-3 px-3.5">This event has no attributes.</div>}
        </>
    );
}

/* ---- view ---- */

function EventsView() {
    const [, forceRender] = useReducer((x) => x + 1, 0);
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [name, setName] = useState('');
    const [levels, setLevels] = useState({ INFORMATION: true, WARNING: true, ERROR: true });
    const [outcome, setOutcome] = useState('');
    const [pageSize, setPageSize] = useState(Number(getPref('eventPageSize')) || 20);
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [userId, setUserId] = useState('');
    const [ip, setIp] = useState('');
    const [serverId, setServerId] = useState('');
    const [attrSearch, setAttrSearch] = useState('');
    const [selected, setSelected] = useState(null);

    // Search-engine state lives in a ref (mutated imperatively across pages);
    // forceRender refreshes the pager. usernames is best-effort id -> name.
    const st = useRef({ offset: 0, limit: pageSize, total: 0, lastParams: {} });
    const tableRef = useRef(null);
    const usernamesRef = useRef({});
    // Latest criteria + search, read by table callbacks captured at mount.
    const criteriaRef = useRef(null);
    const searchRef = useRef(null);

    function username(uid) {
        if (uid === null || uid === undefined || uid === '') return '';
        if (String(uid) === '0') return 'System';   // engine's own (no logged-in user)
        return usernamesRef.current[String(uid)] ?? String(uid);
    }

    /* Optional criteria are OMITTED when unset (qs() drops ''/null/undefined).
       Level: a strict subset is sent as repeated params; none/all = no filter. */
    function buildParams() {
        const c = criteriaRef.current;
        const params = {};
        if (c.name.trim()) params.name = c.name.trim();
        const ls = LEVELS.filter((l) => c.levels[l]);
        if (ls.length > 0 && ls.length < LEVELS.length) params.level = ls;
        if (c.outcome) params.outcome = c.outcome;
        const s = toCalendarParam(c.start);
        const e = toCalendarParam(c.end);
        if (s) params.startDate = s;
        if (e) params.endDate = e;
        if (c.userId.trim() !== '') params.userId = c.userId.trim();
        if (c.ip.trim()) params.ipAddress = c.ip.trim();
        if (c.serverId.trim()) params.serverId = c.serverId.trim();
        if (c.attrSearch.trim()) params.attributeSearch = c.attrSearch.trim();
        return params;
    }
    // The count path 500s on an empty level set ("EVENT_LEVEL IN ()"); always send one.
    const countParams = (params) => ({ ...params, level: params.level ?? LEVELS });

    async function search(resetOffset) {
        const c = criteriaRef.current;
        if (resetOffset) {
            st.current.offset = 0;
            st.current.lastParams = buildParams();
            st.current.limit = Number(c.pageSize) || 20;
        }
        const { offset, limit, lastParams } = st.current;
        try {
            const [rows, count] = await Promise.all([
                api.events.search({ ...lastParams, offset, limit }),
                api.events.count(countParams(lastParams))
            ]);
            st.current.total = toCount(count);
            tableRef.current?.setRows(normalizeEvents(rows));
        } catch (e) {
            st.current.total = 0;
            tableRef.current?.setRows([]);
            toast(`Event search failed: ${shortError(e)}`, 'error');
        }
        const kept = tableRef.current ? tableRef.current.selectedRows() : [];
        setSelected(kept.length ? kept[0] : null);
        forceRender();
    }

    async function exportAllEvents() {
        if (!await confirmDialog('Export All Events',
            'Export all events to a file in the exports directory on the server?', { okLabel: 'Export' })) return;
        try {
            const path = await api.post('/events/_export', null, { raw: true });
            toast(`Events exported on the server to: ${String(path || '').trim()}`);
        } catch (e) {
            toast(`Export failed: ${shortError(e)}`, 'error');
        }
    }

    // Mirror current criteria into the ref each render; expose search to callbacks.
    criteriaRef.current = { start, end, name, levels, outcome, pageSize, userId, ip, serverId, attrSearch };
    searchRef.current = search;

    const COLUMNS = useRef([
        { key: 'level', label: 'Level', width: '120px', render: (e) => levelTag(e.level) },
        { key: 'eventTime', label: 'Date & Time', width: '160px', className: 'mono', sortValue: (e) => fmtDate(e.eventTime), render: (e) => fmtDate(e.eventTime) },
        { key: 'name', label: 'Name' },
        { key: 'serverId', label: 'Server ID', width: '150px', className: 'mono text-text-faint', render: (e) => displayValue(e.serverId) },
        { key: 'userId', label: 'User', width: '110px', sortValue: (e) => username(e.userId), render: (e) => username(e.userId) },
        { key: 'outcome', label: 'Outcome', width: '110px', render: (e) => outcomeTag(e.outcome) },
        { key: 'ipAddress', label: 'IP Address', className: 'mono', width: '130px' },
        { key: 'channelMsgId', label: 'Channel ID - Message ID', className: 'mono', defaultHidden: true, sortValue: eventChannelIdWithMessageId, render: eventChannelIdWithMessageId },
        { key: 'channelName', label: 'Channel Name', defaultHidden: true, sortValue: eventChannelName, render: eventChannelName },
        { key: 'patientId', label: 'Patient ID', defaultHidden: true, sortValue: (e) => eventAttr(e, 'patientId'), render: (e) => eventAttr(e, 'patientId') }
    ]).current;

    const options = useRef({
        selectable: 'single',
        rowKey: (e) => String(e.id),
        emptyText: 'No events found',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-events',
        onSelect: (rows) => setSelected(rows.length ? rows[0] : null),
        onContextMenu: (row, ev) => {
            setSelected(row);
            contextMenu(ev.clientX, ev.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => searchRef.current(true) },
                { label: 'Export All Events', icon: 'export', onClick: () => exportAllEvents() }
            ]);
        }
    }).current;

    // Initial load + best-effort username map.
    useEffect(() => {
        api.users.list().then((users) => {
            for (const u of users) if (u && u.id !== undefined) usernamesRef.current[String(u.id)] = displayValue(u.username || u.id);
            tableRef.current?.render();
        }).catch(() => { /* keep raw ids */ });
        search(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const enterSearch = (e) => { if (e.key === 'Enter') searchRef.current(true); };
    const s = st.current;
    const from = s.total === 0 ? 0 : s.offset + 1;
    const to = Math.min(s.offset + s.limit, s.total);

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Event Tasks" paneKey="tasks:Event Tasks">
                    <div className="taskbar" data-pane-title="Event Tasks">
                        <TaskButton label="Search" icon="refresh" onClick={() => search(true)} />
                        <TaskButton label="Export All Events" icon="export" onClick={exportAllEvents} />
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                <div className="flex-none py-2.5 px-3.5 bg-bg1 border-b border-line">
                    <div className="form-row">
                        <Field label="Start Time"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
                        <Field label="End Time"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
                        <Field label="Name"><input type="text" placeholder="Event name contains…" className="w-[190px]" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enterSearch} /></Field>
                        <Field label="Level">
                            <div className="flex items-center gap-2">
                                {LEVELS.map((l) => (
                                    <label key={l} className="check">
                                        <input type="checkbox" checked={levels[l]} onChange={(e) => setLevels((p) => ({ ...p, [l]: e.target.checked }))} />
                                        {l.charAt(0) + l.slice(1).toLowerCase()}
                                    </label>
                                ))}
                            </div>
                        </Field>
                        <Field label="Outcome">
                            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                                <option value="">Any</option>
                                {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </Field>
                        <Field label="Page Size">
                            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                                {[20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </Field>
                        <button className={'btn' + (advancedOpen ? ' btn-primary' : '')} title="Show advanced search criteria"
                            onClick={() => setAdvancedOpen((o) => !o)}><Icon name="filter" />Advanced</button>
                        <TaskButton label="Search" icon="search" primary onClick={() => search(true)} />
                    </div>
                    {advancedOpen && (
                        <div className="form-row mt-2">
                            <Field label="User Id"><input type="number" min="0" className="w-[90px]" value={userId} onChange={(e) => setUserId(e.target.value)} onKeyDown={enterSearch} /></Field>
                            <Field label="IP Address"><input type="text" className="w-[130px]" value={ip} onChange={(e) => setIp(e.target.value)} onKeyDown={enterSearch} /></Field>
                            <Field label="Server Id"><input type="text" className="w-[230px]" value={serverId} onChange={(e) => setServerId(e.target.value)} onKeyDown={enterSearch} /></Field>
                            <Field label="Attribute Search"><input type="text" placeholder="Attribute values contain…" className="w-[190px]" value={attrSearch} onChange={(e) => setAttrSearch(e.target.value)} onKeyDown={enterSearch} /></Field>
                        </div>
                    )}
                </div>
                <div className="flex-1 overflow-auto min-h-0 flex flex-col">
                    <DataTableHost columns={COLUMNS} options={options} onReady={(t) => { tableRef.current = t; }} />
                </div>
                <div className="filterbar">
                    <button className="btn" disabled={s.offset <= 0}
                        onClick={() => { st.current.offset = Math.max(0, st.current.offset - st.current.limit); search(false); }}>Prev</button>
                    <button className="btn" disabled={s.offset + s.limit >= s.total}
                        onClick={() => { st.current.offset += st.current.limit; search(false); }}>Next</button>
                    <span className="counts">{`${fmtNumber(from)}–${fmtNumber(to)} of ${fmtNumber(s.total)}`}</span>
                </div>
                <div className="split-handle" data-orient="v" data-resize="next" />
                <div className="flex-none h-[35%] min-h-[48px] overflow-auto bg-bg1">
                    <EventDetail event={selected} username={username} />
                </div>
            </div>
        </div>
    );
}
