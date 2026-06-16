/*
 * Dashboard — live channel status board, classic Administrator layout:
 * channel-group tree rows, per-connector child rows, a bottom filter bar with
 * counts and a Current/Lifetime statistics toggle, and plugin tabs underneath
 * (Server Log, Connection Log, Global Maps... — DashboardTabPlugin equivalent).
 * Plugin columns (DashboardColumnPlugin) render after the statistics columns.
 */

import { h, clear, icon, toast, taskButton, confirmDialog, modal, checkbox, contextMenu, fmtNumber, fmtDate, loading } from '@oie/web-ui';
import api from '@oie/web-api';
import { statePip, stateLabel } from '@oie/web-api';
import { openSendMessageDialog } from './messages.js';
import { getPref } from '../core/prefs.js';
import { createColumnManager, decorateColumns } from '@oie/web-ui';

// Default widths for the dashboard's resizable data columns (after the twisty).
const DASH_COL_WIDTHS = {
    state: 110, name: 240, type: 110, port: 80, rev: 70, deployed: 150,
    received: 90, filtered: 90, queued: 90, sent: 90, errored: 90
};

/* DashboardStatus statistics arrive as an XStream map:
   {"entry":[{"com.mirth...Status":"RECEIVED","long":42}, ...]} */
export function statsOf(status, lifetime = false) {
    const out = { RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, SENT: 0, ERROR: 0, QUEUED: 0 };
    const source = lifetime ? status?.lifetimeStatistics : status?.statistics;
    const entries = source?.entry;
    if (entries) {
        for (const entry of Array.isArray(entries) ? entries : [entries]) {
            let key = null, value = null;
            for (const v of Object.values(entry)) {
                if (typeof v === 'string' && out[v] !== undefined) key = v;
                else if (typeof v === 'number') value = v;
            }
            if (key && value !== null) out[key] = value;
        }
    }
    if (status?.queued !== undefined && status.queued !== null) out.QUEUED = Number(status.queued) || out.QUEUED;
    return out;
}

function childrenOf(status) {
    const kids = status?.childStatuses?.dashboardStatus ?? status?.childStatuses;
    if (!kids) return [];
    return Array.isArray(kids) ? kids : [kids];
}

function lsGet(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}

function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode */ }
}

/* "Just deployed" highlight: a one-time, session-scoped cue. A deploy is
   highlighted only until you leave the dashboard — navigating away marks it
   seen so returning won't re-show it (matches the old Swing client). Keyed by
   channel + deploy timestamp so a *new* deploy highlights again. */
const JUST_DEPLOYED_MS = 15000;
const seenDeploys = new Set();
const deployKey = (st) => `${st.channelId}|${st.deployedDate?.time ?? ''}`;
function isJustDeployed(st) {
    const ms = Number(st.deployedDate?.time);
    return !!ms && (Date.now() - ms) >= 0 && (Date.now() - ms) < JUST_DEPLOYED_MS && !seenDeploys.has(deployKey(st));
}

/* ChannelTag backgroundColor arrives as {red, green, blue, alpha}. */
function tagRgb(tag, alpha) {
    const c = tag?.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined && c.green !== undefined && c.blue !== undefined) {
        return alpha !== undefined ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${alpha})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
    }
    return null;
}

/* Compact two-option segmented control used in the filter bar. */
function segControl(options, current, onChange) {
    const wrap = h('span', { style: { display: 'inline-flex', flex: 'none', border: '1px solid var(--line-strong)', borderRadius: '4px', overflow: 'hidden' } });
    const buttons = options.map(opt => h('button', {
        type: 'button', title: opt.title || opt.label || '',
        style: {
            border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
            padding: '3px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px'
        },
        onClick: () => { paint(opt.value); onChange(opt.value); }
    }, opt.icon ? icon(opt.icon, 13) : null, opt.label || null));
    function paint(value) {
        buttons.forEach((btn, i) => {
            const active = options[i].value === value;
            btn.style.background = active ? 'var(--accent-glow)' : 'transparent';
            btn.style.color = active ? 'var(--accent)' : 'var(--text-dim)';
        });
    }
    paint(current);
    buttons.forEach(b => wrap.appendChild(b));
    return wrap;
}

export function register(platform) {
    platform.registerNavItem({ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard', section: 'Engine', order: 0 });
    platform.registerView('/dashboard', () => renderDashboard(platform), { title: 'Dashboard' });
}

function renderDashboard(platform) {
    let statuses = [];
    let groups = [];
    let tags = [];
    let selected = new Set();             // channelIds
    let lastClicked = null;               // anchor for shift-range selection
    let expandedChannels = new Set();     // channels showing connector rows
    let collapsedGroups = new Set();      // groups default to expanded
    let filterText = '';
    let filterChips = [];    // explicit picks: [{ value, kind: 'tag' | 'channel' }]; free-typed text wildcards
    let lifetime = false;
    let viewMode = lsGet('oie-dash-view', 'group') === 'channel' ? 'channel' : 'group';
    const savedTagMode = lsGet('oie-dash-tagmode', 'names');
    let tagMode = ['names', 'icons', 'off'].includes(savedTagMode) ? savedTagMode : 'names';
    let sortKey = 'name';
    let sortDir = 1;                      // 1 = asc, -1 = desc
    let hiddenCols;                       // Set of hidden column keys, persisted
    try { hiddenCols = new Set(JSON.parse(lsGet('oie-dash-cols', '[]'))); } catch (e) { hiddenCols = new Set(); }
    const colMgr = createColumnManager('dashboard', DASH_COL_WIDTHS);
    hiddenCols.delete('name');            // Name can never be hidden
    let timer = null;
    let destroyed = false;
    let connectorTypes = new Map();       // channelId → Map(metaDataId → transportName)
    let sourcePorts = new Map();          // channelId → source listener port string
    let connectorMetaAt = 0;              // last connector-metadata fetch (epoch ms)
    const CONNECTOR_META_MS = 60000;

    const tableHost = h('div.grow', { style: { overflow: 'auto' } }, loading('Contacting engine…'));
    // Click on empty space (not a row) clears the channel selection, so the
    // contextual task buttons can be dismissed.
    tableHost.addEventListener('click', (e) => {
        if (e.target.closest('tr')) return;
        if (!selected.size) return;
        selected = new Set();
        lastClicked = null;
        renderTable();
        updateTaskVisibility();
        platform.events.emit('dashboard:selection', []);
    });
    const countsLabel = h('span.counts', '');
    const tabsHost = h('div', { style: { flex: 'none', height: '230px', overflow: 'hidden', display: 'flex', flexDirection: 'column' } });
    // Draggable divider (handled globally by core/resize.js) — resizes the tabs area.
    const tabsHandle = h('div.split-handle', { dataset: { orient: 'v', resize: 'next' } });

    /* ---- tasks (relocated to the "Dashboard Tasks" sidebar pane) --------------- */

    async function controlSelected(action, label) {
        if (!selected.size) { toast('Select a channel first', 'warn'); return; }
        for (const channelId of selected) {
            try { await api.status[action](channelId); }
            catch (e) { toast(`${label} failed: ${e.message}`, 'error'); }
        }
        refresh();
    }

    const needSel = (fn) => () => {
        if (!selected.size) { toast('Select a channel first', 'warn'); return; }
        fn([...selected]);
    };

    /* Channel control tasks show according to the selected channels' states
       (classic behavior: a Started channel offers Pause/Stop, not Start/Halt). */
    const btnStart = taskButton('Start', 'play', () => controlSelected('start', 'Start'));
    const btnPause = taskButton('Pause', 'pause', () => controlSelected('pause', 'Pause'));
    const btnStop = taskButton('Stop', 'stop', () => controlSelected('stop', 'Stop'));
    const btnHalt = taskButton('Halt', 'halt', async () => {
        if (await confirmDialog('Halt channels', 'Halting forcibly kills processing threads. Halt the selected channels?', { danger: true, okLabel: 'Halt' })) {
            controlSelected('halt', 'Halt');
        }
    });

    // Selection-dependent tasks live in a context group that only shows when
    // a channel is selected (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        taskButton('Send Message', 'send', needSel((ids) => openSendMessageDialog(platform, ids[0], () => refresh()))),
        taskButton('View Messages', 'messages', needSel((ids) => platform.router.navigate(`/messages/${ids[0]}`))),
        taskButton('Remove All Messages', 'trash', needSel(async () => {
            if (await confirmDialog('Remove all messages', `Permanently remove ALL messages from ${selected.size} channel(s)? This cannot be undone.`, { danger: true, okLabel: 'Remove' })) {
                for (const id of selected) {
                    try { await api.messages.removeAll(id); } catch (e) { toast(e.message, 'error'); }
                }
                toast('Messages removed');
                refresh();
            }
        }), { danger: true }),
        taskButton('Clear Statistics', 'clear', needSel((ids) => openClearStatisticsDialog(ids))),
        btnStart, btnPause, btnStop, btnHalt,
        taskButton('Undeploy Channel', 'undeploy', needSel(async (ids) => {
            if (await confirmDialog('Undeploy', `Undeploy ${ids.length} channel(s)?`, { okLabel: 'Undeploy' })) {
                try { await api.engine.undeployMany(ids); } catch (e) { toast(e.message, 'error'); }
                refresh();
            }
        })));

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Dashboard Tasks' } },
        taskButton('Refresh', 'refresh', () => refresh(true)),
        ctxTasks
    );

    /* Classic Clear Statistics dialog: pick which counters to reset. The body
       is the same {channelId: null} map (null metaDataId list = whole channel,
       verified in ChannelStatisticsServletInterface POST /_clearStatistics);
       received/filtered/sent/error become query params via
       api.statistics.clear. Queued is a live queue depth, not a counter, so
       it cannot be cleared. */
    function openClearStatisticsDialog(ids) {
        const received = checkbox('Received', true);
        const filtered = checkbox('Filtered', true);
        const sent = checkbox('Sent', true);
        const errored = checkbox('Errored', true);
        modal({
            title: 'Clear Statistics',
            body: h('div',
                h('div.mb', `Clear the selected statistics for ${ids.length} channel(s)? This cannot be undone.`),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    received.el, filtered.el, sent.el, errored.el),
                h('div.hint.mt', 'Queued statistics cannot be cleared.')),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Clear', primary: true,
                    onClick: async () => {
                        const flags = [received, filtered, sent, errored].map(c => c.input.checked);
                        if (!flags.some(Boolean)) {
                            toast('Select at least one statistic to clear', 'warn');
                            return false;
                        }
                        try {
                            await api.statistics.clear(Object.fromEntries(ids.map(id => [id, null])), ...flags);
                            toast('Statistics cleared');
                        } catch (e) {
                            toast(`Clear statistics failed: ${e.message}`, 'error');
                            return false;
                        }
                        refresh();
                    }
                }
            ]
        });
    }

    function btnFor(label) {
        return [...taskbar.querySelectorAll('.btn')].find(b => b.textContent.trim() === label);
    }

    function updateTaskVisibility() {
        const sel = statuses.filter(s => selected.has(s.channelId));
        ctxTasks.classList.toggle('hidden', sel.length === 0);
        const any = (fn) => sel.some(fn);
        btnStart.classList.toggle('hidden', !any(s => s.state === 'STOPPED' || s.state === 'PAUSED'));
        btnPause.classList.toggle('hidden', !any(s => s.state === 'STARTED'));
        btnStop.classList.toggle('hidden', !any(s => s.state === 'STARTED' || s.state === 'PAUSED'));
        // Halt only applies to transitional states (Starting, Stopping, ...).
        btnHalt.classList.toggle('hidden', !any(s => !['STARTED', 'STOPPED', 'PAUSED'].includes(s.state)));
    }

    /* ---- connector metadata (Type + Port columns) --------------------------------- */

    /* Channel definitions and listener ports change rarely, so they refresh at
       most every ~60s alongside the status poll (or on manual Refresh).
       Failures degrade silently — the Type/Port cells simply render empty.
       /channels/portsInUse rows are the Ports model (donkey
       model/channel/Ports.java): { id: channelId, name, port } — one row per
       channel holding its source listener port (no metaDataId). */
    async function refreshConnectorMeta(force = false) {
        if (!force && Date.now() - connectorMetaAt < CONNECTOR_META_MS) return;
        connectorMetaAt = Date.now();
        const [channels, ports] = await Promise.all([
            api.channels.list().catch(() => null),
            api.channels.portsInUse().catch(() => null)
        ]);
        if (channels) {
            connectorTypes = new Map();
            for (const ch of channels) {
                if (!ch || !ch.id) continue;
                const types = new Map();
                if (ch.sourceConnector?.transportName) types.set(0, ch.sourceConnector.transportName);
                for (const dest of api.asList(ch.destinationConnectors, 'connector')) {
                    if (dest?.transportName && dest.metaDataId !== undefined) types.set(Number(dest.metaDataId), dest.transportName);
                }
                connectorTypes.set(ch.id, types);
            }
        }
        if (ports) {
            sourcePorts = new Map();
            for (let row of ports) {
                if (row && row.ports) row = row.ports;   // singleton lists stay wrapped
                if (row && row.id && row.port) sourcePorts.set(row.id, String(row.port));
            }
        }
    }

    /* ---- grouping --------------------------------------------------------------- */

    function groupedStatuses() {
        const byId = new Map(statuses.map(s => [s.channelId, s]));
        const used = new Set();
        const rows = [];
        for (const group of groups) {
            const memberIds = api.asList(group.channels, 'channel').map(c => c.id).filter(Boolean);
            const members = memberIds.map(id => byId.get(id)).filter(Boolean);
            members.forEach(m => used.add(m.channelId));
            if (members.length) rows.push({ group, members });
        }
        const defaults = statuses.filter(s => !used.has(s.channelId));
        if (defaults.length || !rows.length) {
            rows.unshift({
                group: { id: '__default__', name: 'Default Group', description: 'Channels not part of a group will appear here.' },
                members: defaults
            });
        }
        return rows;
    }

    function visibleMembers(members) {
        if (!filterChips.length && !filterText) return members;

        // Explicit picks (exact, no wildcard): channels carrying any selected
        // tag, or matching any selected channel name. Multiple picks are OR'd.
        const chipChannelIds = new Set();
        const chipChannelNames = new Set();
        for (const chip of filterChips) {
            if (chip.kind === 'tag') {
                for (const tag of tags) {
                    if (String(tag.name) === chip.value) {
                        api.asList(tag.channelIds, 'string').forEach(id => chipChannelIds.add(id));
                    }
                }
            } else {
                chipChannelNames.add(String(chip.value).toLowerCase());
            }
        }

        // Free-typed text → substring (wildcard) across name + tag names.
        const needle = filterText.toLowerCase();
        let textTagged = null;
        if (needle) {
            textTagged = new Set();
            for (const tag of tags) {
                if (String(tag.name || '').toLowerCase().includes(needle)) {
                    api.asList(tag.channelIds, 'string').forEach(id => textTagged.add(id));
                }
            }
        }

        return members.filter(s => {
            if (chipChannelIds.has(s.channelId)) return true;
            if (chipChannelNames.has(String(s.name || '').toLowerCase())) return true;
            if (needle && (String(s.name || '').toLowerCase().includes(needle) || textTagged.has(s.channelId))) return true;
            return false;
        });
    }

    /* ---- columns -------------------------------------------------------------------- */

    /* Column-definition model: each column knows how to render its cell for the
       three row types (group aggregate, channel, connector) and how to produce a
       sort value for a channel status. Renderers return complete <td> elements so
       all three row builders share the same visible-columns list and alignment
       always holds. Statistics read the closure `lifetime` flag. */
    const statCell = (value, warnLevel) => {
        if (value && warnLevel === 'err') return h('td.num', h('span.err-text', fmtNumber(value)));
        if (value && warnLevel === 'warn') return h('td.num', h('span.warn-text', fmtNumber(value)));
        return h('td.num', fmtNumber(value));
    };

    const statColumn = (key, label, statKey, warnLevel) => ({
        key, label,
        thStyle: { textAlign: 'right' },
        sortValue: (st) => statsOf(st, lifetime)[statKey] || 0,
        renderChannel: (st, stats) => statCell(stats[statKey], warnLevel),
        renderGroupAggregate: (totals) => statKey === 'ERROR'
            ? h('td.num', totals.ERROR ? h('span.err-text', fmtNumber(totals.ERROR)) : '0')
            : h('td.num', fmtNumber(totals[statKey])),
        renderConnector: (child, stats) => h('td.num.muted', fmtNumber(stats[statKey]))
    });

    const COLUMNS = [
        {
            key: 'state', label: 'Status',
            sortValue: (st) => stateLabel(st.state) || String(st.state || ''),
            renderChannel: (st) => h('td', h('span.status-cell', h(`span.pip.${statePip(st.state)}`), stateLabel(st.state))),
            renderGroupAggregate: (totals, ctx) => {
                if (!ctx.members.length) return h('td', '');
                // Uniform group → that state's pip + label; otherwise "Mixed"
                // with a warning pip (Swing DashboardTreeTable behavior).
                const states = new Set(ctx.members.map(m => m.state));
                if (states.size === 1) {
                    const state = ctx.members[0].state;
                    return h('td', h('span.status-cell', h(`span.pip.${statePip(state)}`), stateLabel(state)));
                }
                return h('td', h('span.status-cell', h('span.pip.warn'), 'Mixed'));
            },
            renderConnector: (child) => h('td', h('span.status-cell', { style: { paddingLeft: '14px' } }, h(`span.pip.${statePip(child.state)}`), stateLabel(child.state)))
        },
        {
            key: 'name', label: 'Name',
            sortValue: (st) => String(st.name || '').toLowerCase(),
            renderChannel: (st) => h('td', { style: { paddingLeft: viewMode === 'group' ? '14px' : '0' } }, nameCell(st)),
            renderGroupAggregate: (totals, ctx) => h('td', `[${ctx.group.name}]`),
            renderConnector: (child) => h('td.muted', { style: { paddingLeft: '34px' } },
                String(child.name ?? ''))
        },
        {
            key: 'type', label: 'Type',
            sortValue: (st) => String(connectorTypes.get(st.channelId)?.get(0) || ''),
            renderChannel: (st) => h('td', connectorTypes.get(st.channelId)?.get(0) || ''),
            renderGroupAggregate: () => h('td', ''),
            renderConnector: (child) => h('td.muted', connectorTypes.get(child.channelId)?.get(Number(child.metaDataId)) || '')
        },
        {
            key: 'port', label: 'Port',
            sortValue: (st) => Number(sourcePorts.get(st.channelId)) || 0,
            renderChannel: (st) => h('td.mono', sourcePorts.get(st.channelId) || ''),
            renderGroupAggregate: () => h('td', ''),
            renderConnector: (child) => h('td.mono.muted', Number(child.metaDataId) === 0 ? (sourcePorts.get(child.channelId) || '') : '')
        },
        {
            key: 'rev', label: 'Rev Δ',
            sortValue: (st) => Number(st.deployedRevisionDelta) || 0,
            renderChannel: (st) => h('td.num', st.deployedRevisionDelta ? h('span.warn-text', `+${st.deployedRevisionDelta}`) : '0'),
            renderGroupAggregate: () => h('td.num', '--'),
            renderConnector: () => h('td', '')
        },
        {
            key: 'deployed', label: 'Last Deployed',
            sortValue: (st) => st.deployedDate?.time ?? 0,
            renderChannel: (st) => h('td.mono', isJustDeployed(st)
                ? { style: { background: '#f0e68c', color: '#1f2c38', fontWeight: '600' } }
                : {}, fmtDate(st.deployedDate)),
            renderGroupAggregate: () => h('td.mono', '--'),
            renderConnector: () => h('td', '')
        },
        statColumn('received', 'Received', 'RECEIVED'),
        statColumn('filtered', 'Filtered', 'FILTERED'),
        statColumn('queued', 'Queued', 'QUEUED', 'warn'),
        statColumn('sent', 'Sent', 'SENT'),
        statColumn('errored', 'Errored', 'ERROR', 'err')
    ];

    function allColumns() {
        return COLUMNS.concat(platform.dashboardColumns().map(c => ({
            key: c.id ? String(c.id) : String(c.label),
            label: c.label,
            sortable: false,
            renderChannel: (st) => h('td', c.render ? (c.render(st) ?? '') : ''),
            renderGroupAggregate: () => h('td', ''),
            renderConnector: (child) => h('td', c.renderConnector ? (c.renderConnector(child) ?? '') : '')
        })));
    }

    function sortChannels(list) {
        const byName = (a, b) => String(a.name).localeCompare(String(b.name));
        const col = allColumns().find(c => c.key === sortKey && c.sortable !== false && c.sortValue);
        if (!col) return list.slice().sort(byName);
        return list.slice().sort((a, b) => {
            const va = col.sortValue(a), vb = col.sortValue(b);
            let cmp;
            if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
            else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            return cmp ? cmp * sortDir : byName(a, b);
        });
    }

    function toggleColumn(key) {
        hiddenCols.has(key) ? hiddenCols.delete(key) : hiddenCols.add(key);
        if (hiddenCols.has(sortKey)) { sortKey = 'name'; sortDir = 1; }
        lsSet('oie-dash-cols', JSON.stringify([...hiddenCols]));
        renderTable();
    }

    function headerMenu(e) {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, allColumns()
            .filter(col => col.key !== 'name')    // Name cannot be hidden
            .map(col => ({
                label: `${hiddenCols.has(col.key) ? '   ' : '✓'} ${col.label}`,
                onClick: () => toggleColumn(col.key)
            })));
    }

    /* ---- table -------------------------------------------------------------------- */

    // Flat list of visible channel ids in display order — the basis for
    // shift-range selection (mirrors the channel-row rendering order below).
    function visibleChannelIds() {
        if (viewMode === 'channel') {
            return sortChannels(visibleMembers(statuses)).map(st => st.channelId);
        }
        const ids = [];
        for (const { group, members } of groupedStatuses()) {
            if (collapsedGroups.has(group.id)) continue;   // children hidden
            for (const st of sortChannels(visibleMembers(members))) ids.push(st.channelId);
        }
        return ids;
    }

    function renderTable() {
        clear(tableHost);
        if (!statuses.length) {
            tableHost.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('dashboard', 30)),
                h('div', 'No deployed channels'),
                h('div.faint.mt', 'Deploy a channel from the Channels view to see it here.')));
            updateCounts();
            return;
        }

        const cols = allColumns().filter(col => !hiddenCols.has(col.key));

        // Header row: twisty column stays unsortable; clicking a sortable header
        // toggles asc/desc with an arrow indicator; right-click opens the
        // show/hide column menu.
        const headRow = h('tr',
            h('th', { style: { width: '26px' } }, ''),
            cols.map(col => {
                const sortable = col.sortable !== false;
                return h('th' + (sortable ? '.sortable' : ''), {
                    style: col.thStyle || null,
                    onClick: sortable ? () => {
                        if (sortKey === col.key) sortDir = -sortDir;
                        else { sortKey = col.key; sortDir = 1; }
                        renderTable();
                    } : null
                },
                col.label,
                sortable && sortKey === col.key ? h('span.sort-arrow', sortDir > 0 ? '▲' : '▼') : null);
            }));
        headRow.addEventListener('contextmenu', headerMenu);
        const thead = h('thead', headRow);

        const tbody = h('tbody');
        if (viewMode === 'channel') {
            // Flat channel view: no group rows, all channels sorted by the active column.
            for (const st of sortChannels(visibleMembers(statuses))) {
                tbody.appendChild(channelRow(st, cols));
                if (expandedChannels.has(st.channelId)) {
                    for (const child of childrenOf(st)) tbody.appendChild(connectorRow(child, cols));
                }
            }
        } else {
            for (const { group, members } of groupedStatuses()) {
                const visible = sortChannels(visibleMembers(members));
                if (filterText && !visible.length) continue;
                tbody.appendChild(groupRow(group, visible, cols));
                if (!collapsedGroups.has(group.id)) {
                    for (const st of visible) {
                        tbody.appendChild(channelRow(st, cols));
                        if (expandedChannels.has(st.channelId)) {
                            for (const child of childrenOf(st)) tbody.appendChild(connectorRow(child, cols));
                        }
                    }
                }
            }
        }

        const table = h('table.dt', thead, tbody);
        tableHost.appendChild(table);
        decorateColumns(table, {
            manager: colMgr,
            presentKeys: cols.map(c => c.key),
            pinned: 1,
            pinnedWidths: [26],
            onChange: renderTable
        });
        updateCounts();
    }

    function groupRow(group, members, cols) {
        const isCollapsed = collapsedGroups.has(group.id);
        const totals = { RECEIVED: 0, FILTERED: 0, QUEUED: 0, SENT: 0, ERROR: 0 };
        let started = 0;
        for (const st of members) {
            const s = statsOf(st, lifetime);
            for (const k of Object.keys(totals)) totals[k] += s[k] || 0;
            if (st.state === 'STARTED') started++;
        }
        const ctx = { group, members, started };
        const tr = h('tr.group-row',
            h('td', h('span.twisty', { onClick: (e) => { e.stopPropagation(); toggleGroup(group.id); } }, isCollapsed ? '▸' : '▾')),
            cols.map(col => col.renderGroupAggregate ? col.renderGroupAggregate(totals, ctx) : h('td', '')));
        tr.addEventListener('click', () => toggleGroup(group.id));
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!members.length) return;
            // Select the group's visible members, then mirror the channel-row
            // menu acting on that selection (handlers reused via btnFor /
            // controlSelected; Send/View target the first member).
            selected = new Set(members.map(m => m.channelId));
            renderTable();
            updateTaskVisibility();
            platform.events.emit('dashboard:selection', statuses.filter(s => selected.has(s.channelId)));
            const first = members[0];
            const anyState = (fn) => members.some(fn);
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                '-',
                { label: 'Send Message', icon: 'send', onClick: () => openSendMessageDialog(platform, first.channelId, () => refresh()) },
                { label: 'View Messages', icon: 'messages', onClick: () => platform.router.navigate(`/messages/${first.channelId}`) },
                { label: 'Remove All Messages', icon: 'trash', danger: true, onClick: () => btnFor('Remove All Messages')?.click() },
                { label: 'Clear Statistics', icon: 'clear', onClick: () => btnFor('Clear Statistics')?.click() },
                '-',
                { label: 'Start', icon: 'play', hidden: !anyState(x => x.state === 'STOPPED' || x.state === 'PAUSED'), onClick: () => controlSelected('start', 'Start') },
                { label: 'Pause', icon: 'pause', hidden: !anyState(x => x.state === 'STARTED'), onClick: () => controlSelected('pause', 'Pause') },
                { label: 'Stop', icon: 'stop', hidden: !anyState(x => x.state === 'STARTED' || x.state === 'PAUSED'), onClick: () => controlSelected('stop', 'Stop') },
                { label: 'Halt', icon: 'halt', hidden: !anyState(x => !['STARTED', 'STOPPED', 'PAUSED'].includes(x.state)), onClick: () => btnFor('Halt')?.click() },
                { label: 'Undeploy Channels', icon: 'undeploy', onClick: () => btnFor('Undeploy Channel')?.click() }
            ]);
        });
        return tr;
    }

    function toggleGroup(groupId) {
        collapsedGroups.has(groupId) ? collapsedGroups.delete(groupId) : collapsedGroups.add(groupId);
        renderTable();
    }

    function tagsFor(channelId) {
        return tags.filter(tag => api.asList(tag.channelIds, 'string').includes(channelId));
    }

    /* Icons mode: the actual tag glyph filled with the tag's color, stroked a
       slightly darker shade so the shape still reads against any row. */
    function tagIcon(tag) {
        const color = tagRgb(tag) || 'var(--text-dim)';
        const svg = icon('tag', 12);
        svg.setAttribute('fill', color);
        svg.setAttribute('stroke', `color-mix(in srgb, ${color} 75%, black)`);
        return h('span', { title: tag.name, style: { display: 'inline-flex', flex: 'none' } }, svg);
    }

    function tagChips(channelId) {
        if (tagMode === 'off') return [];
        return tagsFor(channelId).map(tag => tagMode === 'icons'
            ? tagIcon(tag)
            : h('span.tag', { style: { background: tagRgb(tag, 0.25) } }, tag.name));
    }

    function nameCell(st) {
        // Single line, never wrapping — excess tags clip rather than grow the row.
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', overflow: 'hidden', maxWidth: '100%' } },
            h('span', { style: { flexShrink: '0' } }, st.name), tagChips(st.channelId));
    }

    function channelRow(st, cols) {
        const stats = statsOf(st, lifetime);
        const kids = childrenOf(st);
        const isExpanded = expandedChannels.has(st.channelId);

        const tr = h('tr', { class: selected.has(st.channelId) ? 'selected' : null, style: { cursor: 'pointer' } },
            h('td', { style: { paddingLeft: '20px' } }, kids.length ? h('span.twisty', {
                onClick: (e) => {
                    e.stopPropagation();
                    isExpanded ? expandedChannels.delete(st.channelId) : expandedChannels.add(st.channelId);
                    renderTable();
                }
            }, isExpanded ? '▾' : '▸') : ''),
            cols.map(col => col.renderChannel(st, stats)));

        tr.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) {
                selected.has(st.channelId) ? selected.delete(st.channelId) : selected.add(st.channelId);
            } else if (e.shiftKey && lastClicked) {
                const visible = visibleChannelIds();
                const a = visible.indexOf(lastClicked), b = visible.indexOf(st.channelId);
                if (a !== -1 && b !== -1) selected = new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
                else selected = new Set([st.channelId]);
            } else {
                selected = new Set([st.channelId]);
            }
            lastClicked = st.channelId;
            renderTable();
            updateTaskVisibility();
            platform.events.emit('dashboard:selection', statuses.filter(s => selected.has(s.channelId)));
        });
        tr.addEventListener('dblclick', () => platform.router.navigate(`/messages/${st.channelId}`));
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!selected.has(st.channelId)) { selected = new Set([st.channelId]); renderTable(); }
            const sel = statuses.filter(x => selected.has(x.channelId));
            const anyState = (fn) => sel.some(fn);
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                '-',
                { label: 'Send Message', icon: 'send', onClick: () => openSendMessageDialog(platform, st.channelId, () => refresh()) },
                { label: 'View Messages', icon: 'messages', onClick: () => platform.router.navigate(`/messages/${st.channelId}`) },
                { label: 'Remove All Messages', icon: 'trash', danger: true, onClick: () => btnFor('Remove All Messages')?.click() },
                { label: 'Clear Statistics', icon: 'clear', onClick: () => btnFor('Clear Statistics')?.click() },
                '-',
                { label: 'Start', icon: 'play', hidden: !anyState(x => x.state === 'STOPPED' || x.state === 'PAUSED'), onClick: () => controlSelected('start', 'Start') },
                { label: 'Pause', icon: 'pause', hidden: !anyState(x => x.state === 'STARTED'), onClick: () => controlSelected('pause', 'Pause') },
                { label: 'Stop', icon: 'stop', hidden: !anyState(x => x.state === 'STARTED' || x.state === 'PAUSED'), onClick: () => controlSelected('stop', 'Stop') },
                { label: 'Halt', icon: 'halt', hidden: !anyState(x => !['STARTED', 'STOPPED', 'PAUSED'].includes(x.state)), onClick: () => btnFor('Halt')?.click() },
                { label: 'Undeploy Channel', icon: 'undeploy', onClick: async () => { try { await api.engine.undeploy(st.channelId); } catch (err) { toast(err.message, 'error'); } refresh(); } },
                '-',
                { label: 'Edit Channel', icon: 'edit', onClick: () => platform.router.navigate(`/channels/${st.channelId}/edit`) },
                { label: 'Edit Filter', icon: 'filter', onClick: () => platform.router.navigate(`/channels/${st.channelId}/filter/0`) },
                { label: 'Edit Transformer', icon: 'transform', onClick: () => platform.router.navigate(`/channels/${st.channelId}/transformer/0`) }
            ]);
        });
        return tr;
    }

    function connectorRow(child, cols) {
        const stats = statsOf(child, lifetime);
        return h('tr', { style: { background: 'var(--bg0)' } },
            h('td', ''),
            cols.map(col => col.renderConnector ? col.renderConnector(child, stats) : h('td', '')));
    }

    function updateCounts() {
        const channels = `${statuses.length} Deployed Channel${statuses.length === 1 ? '' : 's'}`;
        if (viewMode === 'channel') {
            countsLabel.textContent = channels;
        } else {
            const rows = groupedStatuses();
            countsLabel.textContent = `${rows.length} Group${rows.length === 1 ? '' : 's'}, ${channels}`;
        }
    }

    /* ---- filter bar ------------------------------------------------------------------ */

    /* Custom typeahead dropdown (native <datalist> can't render icons):
       substring matches across channel names + tag names, each row shows a
       type icon (server = channel, tag = tag) and a right-aligned type hint. */
    const TYPEAHEAD_MAX = 12;
    let taItems = [];
    let taIndex = -1;
    const typeahead = h('div.typeahead.hidden');
    // Explicit picks render as pills (tag/channel icon) before the input, which
    // stays usable so multiple tags/channels can be selected.
    const chipHost = h('span.filter-chip-host', { style: { display: 'none', gap: '4px', flexWrap: 'wrap' } });

    function removeChip(chip) {
        filterChips = filterChips.filter(c => c !== chip);
        renderChips(); renderTable(); filterInput.focus();
    }

    function renderChips() {
        clear(chipHost);
        for (const chip of filterChips) {
            const isTag = chip.kind === 'tag';
            const tag = isTag ? tags.find(t => String(t.name) === chip.value) : null;
            chipHost.appendChild(h('span.tag', {
                style: {
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: isTag ? (tagRgb(tag, 0.25) || 'var(--bg3)') : 'var(--bg3)',
                    padding: '1px 4px 1px 7px'
                }
            },
                icon(isTag ? 'tag' : 'server', 12),
                h('span', chip.value),
                h('button', {
                    title: 'Remove', style: { border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontSize: '14px', lineHeight: '1', padding: '0 1px' },
                    onClick: () => removeChip(chip)
                }, '×')));
        }
        chipHost.style.display = filterChips.length ? 'inline-flex' : 'none';
    }

    function typeaheadMatches(text) {
        const needle = text.toLowerCase();
        const seen = new Set();
        const out = [];
        const add = (name, kind) => {
            const key = kind + ':' + name.toLowerCase();
            if (filterChips.some(c => c.kind === kind && c.value === name)) return;   // already picked
            if (name.toLowerCase().includes(needle) && !seen.has(key)) { seen.add(key); out.push({ value: name, kind }); }
        };
        for (const st of statuses) if (st.name) add(String(st.name), 'channel');
        for (const tag of tags) if (tag.name) add(String(tag.name), 'tag');
        out.sort((a, b) => a.value.localeCompare(b.value));
        return out.slice(0, TYPEAHEAD_MAX);
    }

    function closeTypeahead() {
        typeahead.classList.add('hidden');
        taItems = [];
        taIndex = -1;
    }

    function paintTypeahead() {
        [...typeahead.children].forEach((row, i) => row.classList.toggle('active', i === taIndex));
        if (taIndex >= 0) typeahead.children[taIndex].scrollIntoView({ block: 'nearest' });
    }

    function pickSuggestion(item) {
        // Add an explicit pill (deduped); clear the text so more can be added.
        if (!filterChips.some(c => c.kind === item.kind && c.value === item.value)) {
            filterChips.push({ value: item.value, kind: item.kind });
        }
        filterText = '';
        filterInput.value = '';
        renderChips();
        renderTable();
        closeTypeahead();
        filterInput.focus();
    }

    function openTypeahead() {
        taItems = typeaheadMatches(filterInput.value.trim());
        taIndex = -1;
        if (!taItems.length) { closeTypeahead(); return; }
        clear(typeahead);
        for (const item of taItems) {
            typeahead.appendChild(h('div.typeahead-item', {
                onMousedown: (e) => e.preventDefault(),   // keep input focus so blur doesn't race the click
                onClick: () => pickSuggestion(item)
            },
                icon(item.kind === 'tag' ? 'tag' : 'server', 14),
                h('span.typeahead-label', item.value),
                h('span.typeahead-kind', item.kind)));
        }
        typeahead.classList.remove('hidden');
        // Anchor under the filter input; flip above when the viewport runs out.
        const r = filterInput.getBoundingClientRect();
        typeahead.style.left = r.left + 'px';
        typeahead.style.minWidth = r.width + 'px';
        typeahead.style.top = (r.bottom + 2) + 'px';
        typeahead.style.bottom = 'auto';
        if (typeahead.getBoundingClientRect().bottom > window.innerHeight - 4) {
            typeahead.style.top = 'auto';
            typeahead.style.bottom = (window.innerHeight - r.top + 2) + 'px';
        }
    }

    const filterInput = h('input', {
        type: 'text', placeholder: 'Enter channel tag or name', autocomplete: 'off',
        onInput: (e) => { filterText = e.target.value.trim(); renderTable(); openTypeahead(); },
        onFocus: () => openTypeahead(),
        onBlur: () => setTimeout(closeTypeahead, 150),    // small delay so clicks on the dropdown land
        onKeydown: (e) => {
            const open = !typeahead.classList.contains('hidden');
            if (e.key === 'Backspace' && !filterInput.value && filterChips.length) {
                // Backspace on an empty input removes the last pill.
                e.preventDefault();
                removeChip(filterChips[filterChips.length - 1]);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!open) { openTypeahead(); return; }
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                taIndex = (taIndex + delta + taItems.length) % taItems.length;
                paintTypeahead();
            } else if (e.key === 'Enter' && open && taItems.length) {
                e.preventDefault();
                pickSuggestion(taItems[taIndex >= 0 ? taIndex : 0]);
            } else if (e.key === 'Escape' && open) {
                e.preventDefault();
                closeTypeahead();
            }
        }
    });

    const viewToggle = segControl([
        { value: 'group', icon: 'folder', title: 'Group view' },
        { value: 'channel', icon: 'channels', title: 'Channel view' }
    ], viewMode, (value) => { viewMode = value; lsSet('oie-dash-view', value); renderTable(); });

    const tagToggle = segControl([
        { value: 'names', label: 'Names', title: 'Show tags as names' },
        { value: 'icons', label: 'Icons', title: 'Show tags as icons' },
        { value: 'off', label: 'Off', title: 'Hide tags' }
    ], tagMode, (value) => { tagMode = value; lsSet('oie-dash-tagmode', value); renderTable(); });

    const radioName = 'dash-stats-' + Math.floor(performance.now());
    const filterbar = h('div.filterbar',
        h('label', 'Filter:'), chipHost, filterInput, typeahead, countsLabel,
        h('span', { style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '10px', flex: 'none' } },
            viewToggle,
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
                h('span', { style: { color: 'var(--text-faint)', fontSize: '11px' } }, 'Tags:'), tagToggle)),
        h('div.radio-group.inline', { style: { marginLeft: '0' } },
            h('label', h('input', { type: 'radio', name: radioName, checked: true, onChange: () => { lifetime = false; renderTable(); } }), 'Current Statistics'),
            h('label', h('input', { type: 'radio', name: radioName, onChange: () => { lifetime = true; renderTable(); } }), 'Lifetime Statistics')));

    /* ---- plugin dashboard tabs (Server Log, Connection Log, Global Maps, ...) --------- */

    function renderTabs() {
        const defs = platform.dashboardTabs();
        if (!defs.length) { tabsHost.style.display = 'none'; tabsHandle.style.display = 'none'; return; }
        const bar = h('div.tabs', { style: { flex: 'none' } });
        const body = h('div', { style: { flex: '1', overflow: 'auto', minHeight: '0' } });
        defs.forEach((def, i) => {
            bar.appendChild(h('button.tab', {
                class: i === 0 ? 'active' : null,
                onClick: (e) => {
                    bar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    e.currentTarget.classList.add('active');
                    mount(def);
                }
            }, def.label));
        });
        const mount = (def) => {
            clear(body);
            const host = h('div');
            // Attach before rendering so plugin code sees host.isConnected === true.
            body.appendChild(host);
            const result = def.render(host, {
                selection: statuses.filter(s => selected.has(s.channelId)),
                platform
            });
            if (result instanceof Node) host.appendChild(result);
        };
        clear(tabsHost);
        tabsHost.appendChild(bar);
        tabsHost.appendChild(body);
        mount(defs[0]);
    }

    /* ---- polling ------------------------------------------------------------------------ */

    async function refresh(manual = false) {
        if (destroyed) return;
        try {
            const [st, gr, tg] = await Promise.all([
                api.status.list(),
                api.channelGroups.list().catch(() => groups),
                api.server.channelTags().catch(() => tags),
                refreshConnectorMeta(manual)              // never throws; ~60s cadence
            ]);
            statuses = st;
            groups = gr || [];
            tags = tg || [];
            // Prune selection of channels that no longer exist, then sync tasks.
            const ids = new Set(statuses.map(x => x.channelId));
            for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
            // Refresh open suggestions in place when polling brings new data.
            if (!typeahead.classList.contains('hidden') && document.activeElement === filterInput) openTypeahead();
            renderTable();
            updateTaskVisibility();
        } catch (e) {
            if (manual) toast(`Refresh failed: ${e.message}`, 'error');
        }
    }

    function loop() {
        // Auto-refresh interval is a user preference (Administrator settings).
        const intervalMs = Math.max(1, Number(getPref('dashboardRefreshSeconds')) || 5) * 1000;
        timer = setTimeout(async () => { await refresh(); loop(); }, intervalMs);
    }

    refresh(true).then(renderTabs);
    loop();

    const el = h('div.view',
        taskbar,
        h('div.view-body.flush', { style: { display: 'flex', flexDirection: 'column' } },
            tableHost, filterbar, tabsHandle, tabsHost));

    return {
        el,
        teardown: () => {
            destroyed = true;
            clearTimeout(timer);
            // Leaving the dashboard ends the one-time "just deployed" cue, so it
            // won't reappear when you navigate back.
            for (const st of statuses) if (isJustDeployed(st)) seenDeploys.add(deployKey(st));
        }
    };
}
