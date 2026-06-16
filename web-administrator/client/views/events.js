/*
 * Events — server event viewer (parity with the Swing Administrator's event
 * browser). Classic two-pane layout: criteria bar on top, paginated results
 * table filling the view, and a resizable detail pane underneath that shows
 * the selected event's attribute map as a Name | Value table.
 *
 * Query parameter names mirror EventServletInterface (GET /events): name,
 * level (repeatable), outcome, startDate/endDate (Calendar, formatted
 * yyyy-MM-dd'T'HH:mm:ss.SSSZ per CalendarParamConverterProvider, e.g.
 * 2015-10-21T07:28:00.000-0700), offset, limit. ServerEvent fields: id,
 * eventTime, level (INFORMATION/WARNING/ERROR), name, attributes,
 * outcome (SUCCESS/FAILURE), userId, ipAddress, serverId.
 */

import { h, clear, icon, toast, taskButton, confirmDialog, select, field, checkbox, fmtDate, fmtNumber, DataTable, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import { toDisplayString } from '../core/xstream.js';
import { getPref } from '../core/prefs.js';

const LEVELS = ['INFORMATION', 'WARNING', 'ERROR'];
const OUTCOMES = ['SUCCESS', 'FAILURE'];

export function register(platform) {
    platform.registerNavItem({ id: 'events', label: 'Events', icon: 'events', path: '/events', section: 'Engine', order: 5 });
    platform.registerView('/events', () => renderEvents(platform), { title: 'Events' });
}

/* ---- XStream JSON normalization helpers -------------------------------------- */

// Render an XStream-encoded value (event attributes etc.) the way Swing does.
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

/* ServerEvent is XStream-aliased to "event", so the API helper's
   asList(v, 'serverEvent') can hand back [{event:[...]}] — unwrap it. */
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
        return h('span.tag', { style: {
            color: 'var(--ok)',
            borderColor: 'color-mix(in srgb, var(--ok) 40%, transparent)',
            background: 'color-mix(in srgb, var(--ok) 10%, transparent)'
        } }, icon('check', 11), 'SUCCESS');
    }
    if (outcome === 'FAILURE') return h('span.tag.red', icon('x', 11), 'FAILURE');
    return h('span.tag', outcome || '');
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

/* Server errors can arrive as a whole serialized exception (XML stack trace);
   reduce them to one readable line for the toast. */
function shortError(e) {
    let msg = String((e && e.message) || e || 'Unknown error');
    if (msg.includes('<')) msg = msg.replace(/<[^>]*>/g, ' ');
    msg = msg.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (msg.length > 180) msg = msg.slice(0, 180) + '…';
    if (!msg) msg = 'Unknown error';
    return (e && e.status) ? `${msg} (HTTP ${e.status})` : msg;
}

/* ---- view --------------------------------------------------------------------- */

function renderEvents(platform) {
    let offset = 0;
    let limit = Number(getPref('eventPageSize')) || 20;
    let total = 0;
    let lastParams = {};
    let usernames = {}; // userId -> username (best effort; falls back to the raw id)

    /* ---- criteria -------------------------------------------------------- */

    const startInput = h('input', { type: 'datetime-local' });
    const endInput = h('input', { type: 'datetime-local' });
    const nameInput = h('input', {
        type: 'text', placeholder: 'Event name contains…',
        style: { width: '190px' },
        onKeydown: (e) => { if (e.key === 'Enter') search(true); }
    });
    const levelChecks = {
        INFORMATION: checkbox('Information', true),
        WARNING: checkbox('Warning', true),
        ERROR: checkbox('Error', true)
    };
    const outcomeSel = select([{ value: '', label: 'Any' }, ...OUTCOMES], '');
    const pageSizeSel = select([20, 50, 100], limit);

    /* Advanced criteria (collapsible) — query params verified against
       EventServletInterface GET /events: userId (Integer), ipAddress,
       serverId, attributeSearch. All omitted when empty. */
    const enterSearch = (e) => { if (e.key === 'Enter') search(true); };
    const userIdInput = h('input', {
        type: 'number', min: '0', style: { width: '90px' }, onKeydown: enterSearch
    });
    const ipInput = h('input', { type: 'text', style: { width: '130px' }, onKeydown: enterSearch });
    const serverIdInput = h('input', { type: 'text', style: { width: '230px' }, onKeydown: enterSearch });
    const attrSearchInput = h('input', {
        type: 'text', placeholder: 'Attribute values contain…',
        style: { width: '190px' }, onKeydown: enterSearch
    });
    const advancedRow = h('div.form-row.hidden', { style: { marginTop: '8px' } },
        field('User Id', userIdInput),
        field('IP Address', ipInput),
        field('Server Id', serverIdInput),
        field('Attribute Search', attrSearchInput));
    const advancedBtn = h('button.btn', {
        onClick: () => {
            const open = advancedRow.classList.toggle('hidden');
            advancedBtn.classList.toggle('btn-primary', !open);
        },
        title: 'Show advanced search criteria'
    }, icon('filter'), 'Advanced');

    const criteriaBar = h('div', {
        style: { flex: 'none', padding: '10px 14px', background: 'var(--bg1)', borderBottom: '1px solid var(--line)' }
    },
        h('div.form-row',
            field('Start Time', startInput),
            field('End Time', endInput),
            field('Name', nameInput),
            field('Level', h('div.flex', LEVELS.map(l => levelChecks[l].el))),
            field('Outcome', outcomeSel),
            field('Page Size', pageSizeSel),
            advancedBtn,
            taskButton('Search', 'search', () => search(true), { primary: true })),
        advancedRow);

    function checkedLevels() {
        return LEVELS.filter(l => levelChecks[l].input.checked);
    }

    /* Every optional criterion must be OMITTED (undefined) when unset — never
       sent as '' or a placeholder like 'Any'. Jersey parses unknown enum values
       out of Set<Level> silently and an empty/absent set reaches the EVENT
       query as "EVENT_LEVEL IN ()" (Derby syntax error). qs() in core/api.js
       drops undefined/null/'' values, so plain omission here is enough.
       Levels: a strict subset of the checkboxes is sent as repeated level
       params; none or all checked means "no filter", so the param is omitted
       entirely for the events list. */
    function buildParams() {
        const params = {};
        const name = nameInput.value.trim();
        if (name) params.name = name;
        const levels = checkedLevels();
        if (levels.length > 0 && levels.length < LEVELS.length) params.level = levels;
        if (outcomeSel.value) params.outcome = outcomeSel.value;
        const start = toCalendarParam(startInput.value);
        const end = toCalendarParam(endInput.value);
        if (start) params.startDate = start;
        if (end) params.endDate = end;
        const userId = userIdInput.value.trim();
        if (userId !== '') params.userId = userId;
        const ipAddress = ipInput.value.trim();
        if (ipAddress) params.ipAddress = ipAddress;
        const serverId = serverIdInput.value.trim();
        if (serverId) params.serverId = serverId;
        const attributeSearch = attrSearchInput.value.trim();
        if (attributeSearch) params.attributeSearch = attributeSearch;
        return params;
    }

    /* GET /events/count: JAX-RS hands the servlet an EMPTY Set<Level> when the
       level param is absent, and EventServlet.getEventCount() puts that set on
       the EventFilter unconditionally (getEvents() guards with isNotEmpty, the
       count path does not) — MyBatis then renders "EVENT_LEVEL IN ()" and the
       engine 500s. Work around it by always sending an explicit non-empty
       level list: the checked subset, or all levels when none/all are checked
       (equivalent to no filter, since EVENT_LEVEL is always one of them). */
    function countParams(params) {
        return { ...params, level: params.level ?? LEVELS };
    }

    /* ---- results table -------------------------------------------------------- */

    function username(userId) {
        if (userId === null || userId === undefined || userId === '') return '';
        return usernames[String(userId)] ?? String(userId);
    }

    const table = new DataTable([
        { key: 'level', label: 'Level', width: '120px', render: (e) => levelTag(e.level) },
        { key: 'eventTime', label: 'Date & Time', width: '160px', className: 'mono', sortValue: (e) => fmtDate(e.eventTime), render: (e) => fmtDate(e.eventTime) },
        { key: 'name', label: 'Name' },
        { key: 'serverId', label: 'Server ID', width: '150px', className: 'mono faint', render: (e) => displayValue(e.serverId) },
        { key: 'userId', label: 'User', width: '110px', sortValue: (e) => username(e.userId), render: (e) => username(e.userId) },
        { key: 'outcome', label: 'Outcome', width: '110px', render: (e) => outcomeTag(e.outcome) },
        { key: 'ipAddress', label: 'IP Address', className: 'mono', width: '130px' }
    ], {
        selectable: 'single',
        rowKey: (e) => String(e.id),
        emptyText: 'No events found',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-events',
        onSelect: (rows) => showDetail(rows.length ? rows[0] : null),
        // Right-click parity with the Swing Event Browser (eventPopupMenu).
        onContextMenu: (row, ev) => {
            showDetail(row);
            contextMenu(ev.clientX, ev.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => search(true) },
                { label: 'Export All Events', icon: 'export', onClick: () => exportAllEvents() }
            ]);
        }
    });

    const tableHost = h('div.grow', { style: { overflow: 'auto', minHeight: '0' } }, table.el);

    /* ---- pagination strip ------------------------------------------------------- */

    const pagerLabel = h('span.counts', '');
    const prevBtn = taskButton('Prev', null, () => { offset = Math.max(0, offset - limit); search(false); });
    const nextBtn = taskButton('Next', null, () => { offset += limit; search(false); });
    const pagerBar = h('div.filterbar', prevBtn, nextBtn, pagerLabel);

    function updatePager() {
        const from = total === 0 ? 0 : offset + 1;
        const to = Math.min(offset + limit, total);
        pagerLabel.textContent = `${fmtNumber(from)}–${fmtNumber(to)} of ${fmtNumber(total)}`;
        prevBtn.disabled = offset <= 0;
        nextBtn.disabled = offset + limit >= total;
    }

    /* ---- detail pane (resizable via the global .split-handle wiring) ------------- */

    const detailHandle = h('div.split-handle', { dataset: { orient: 'v', resize: 'next' } });
    const detailPane = h('div', {
        style: { flex: 'none', height: '35%', minHeight: '48px', overflow: 'auto', background: 'var(--bg1)' }
    });

    function kvItem(label, value) {
        return h('span.flex', { style: { gap: '5px' } },
            h('span.faint', { style: { fontSize: '10.5px', fontWeight: '640', letterSpacing: '0.1em', textTransform: 'uppercase' } }, label),
            h('span.mono', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px' } }, value));
    }

    function showDetail(event) {
        clear(detailPane);
        if (!event) {
            detailPane.appendChild(h('div.dt-empty', 'Select an event to view its details.'));
            return;
        }

        const summary = h('div.flex.flex-wrap', {
            style: { gap: '18px', padding: '8px 14px', borderBottom: '1px solid var(--line)', flex: 'none' }
        },
            kvItem('Id', displayValue(event.id)),
            kvItem('Level', displayValue(event.level)),
            kvItem('Outcome', displayValue(event.outcome)),
            kvItem('User', username(event.userId)),
            kvItem('IP', displayValue(event.ipAddress)));

        // Only show attributes that actually have a value (Swing omits blanks).
        const attributes = mapEntries(event.attributes)
            .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
        const valueStyle = {
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: 'var(--font-mono)', fontSize: '11.5px'
        };
        const attrTable = attributes.length
            ? h('table.dt',
                h('thead', h('tr',
                    h('th', { style: { width: '1%' } }, 'Name'),
                    h('th', 'Value'))),
                h('tbody', attributes.map(([k, v]) => h('tr',
                    h('td', { style: { whiteSpace: 'nowrap', verticalAlign: 'top', fontWeight: '600' } }, k),
                    h('td.mono', { style: valueStyle }, v)))))
            : h('div.faint', { style: { padding: '12px 14px' } }, 'This event has no attributes.');

        detailPane.appendChild(summary);
        detailPane.appendChild(attrTable);
    }

    /* ---- search -------------------------------------------------------------- */

    async function search(resetOffset) {
        if (resetOffset) {
            offset = 0;
            lastParams = buildParams();
            limit = Number(pageSizeSel.value) || 20;
        }
        try {
            const [rows, count] = await Promise.all([
                api.events.search({ ...lastParams, offset, limit }),
                api.events.count(countParams(lastParams))
            ]);
            total = toCount(count);
            table.setRows(normalizeEvents(rows));
            updatePager();
        } catch (e) {
            // Show an empty (but intact) view rather than leaving stale rows.
            total = 0;
            table.setRows([]);
            updatePager();
            toast(`Event search failed: ${shortError(e)}`, 'error');
        }
        // setRows prunes selections whose rows are gone; sync the detail pane.
        const kept = table.selectedRows();
        showDetail(kept.length ? kept[0] : null);
    }

    /* ---- export -------------------------------------------------------------- */

    /* POST /events/_export (verified in EventServletInterface): exports every
       event server-side into the application data/exports directory and
       returns the absolute file path as text/plain. */
    async function exportAllEvents() {
        if (!await confirmDialog('Export All Events',
            'Export all events to a file in the exports directory on the server?',
            { okLabel: 'Export' })) return;
        try {
            const path = await api.post('/events/_export', null, { raw: true });
            toast(`Events exported on the server to: ${String(path || '').trim()}`);
        } catch (e) {
            toast(`Export failed: ${shortError(e)}`, 'error');
        }
    }

    /* ---- bootstrap ------------------------------------------------------------------- */

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Event Tasks' } },
        taskButton('Search', 'refresh', () => search(true)),
        taskButton('Export All Events', 'export', exportAllEvents),
        h('span.taskbar-spacer'));

    // Best-effort user-id -> username map for the User column (admin shows names).
    api.users.list().then(users => {
        for (const u of users) if (u && u.id !== undefined) usernames[String(u.id)] = displayValue(u.username || u.id);
        table.render();
    }).catch(() => { /* keep raw ids */ });

    showDetail(null);
    search(true);

    const el = h('div.view',
        taskbar,
        h('div.view-body.flush', { style: { display: 'flex', flexDirection: 'column' } },
            criteriaBar, tableHost, pagerBar, detailHandle, detailPane));

    return { el };
}
