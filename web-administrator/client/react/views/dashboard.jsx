/*
 * Dashboard (React port of views/dashboard.js) — live channel status board with
 * the classic Administrator layout. The status board itself is the hand-built
 * `table.dt` tree-table (group rows + per-connector child rows + expand
 * twisties + per-row context menus + a resizable column manager + a typeahead
 * filter bar) — it is hierarchical and NOT expressible as a DataTable, so it is
 * kept mounted via refs and repainted imperatively, reusing the legacy
 * renderTable/groupRow/channelRow/connectorRow + filter-bar logic VERBATIM
 * (the HYBRID pattern, see code-templates.jsx).
 *
 * What becomes React: the view shell, the "Dashboard Tasks" pane (selection-
 * gated TaskButtons portaled into the rail via <ViewTasks>), and the plugin
 * dashboard tabs (rendered through <PluginHost>). Selection state the task
 * buttons gate on lives in refs; a useReducer force-update refreshes them.
 * 'dashboard:selection' is re-emitted via store.emit on every selection change.
 */

import { useEffect, useRef, useReducer } from 'react';
import { h, clear, icon, toast, confirmDialog, modal, checkbox, contextMenu, fmtNumber, fmtDate } from '@oie/web-ui';
import api, { statePip, stateLabel } from '@oie/web-api';
import { platform } from '@oie/web-shell';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { getPref } from '../../core/prefs.js';
import { openSendMessageDialog } from './messages.jsx';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { TreeTable } from '../tree-table.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { iconPath } from '../../core/icons.js';

export function register(platform) {
    platform.registerNavItem({ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard', section: 'Engine', order: 0, task: 'doShowDashboard' });
    platform.registerView('/dashboard', reactView(DashboardView), { title: 'Dashboard' });
}

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
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
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
    const wrap = h('span', { class: 'inline-flex flex-none border border-line-strong rounded-[4px] overflow-hidden' });
    const buttons = options.map(opt => h('button', {
        type: 'button', title: opt.title || opt.label || '',
        class: 'border-none cursor-pointer py-[3px] px-2 text-[11px] inline-flex items-center gap-1',
        style: {
            background: 'transparent', color: 'var(--text-dim)'
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


function DashboardView() {
    const [, forceRender] = useReducer((x) => x + 1, 0);

    // Working state read by the imperative table/filter callbacks (captured at
    // mount) and by the React task pane — kept in refs so neither sees a stale
    // closure. forceRender() refreshes the React task pane + plugin tabs.
    const statusesRef = useRef([]);
    const groupsRef = useRef([]);
    const tagsRef = useRef([]);
    const selectedRef = useRef(new Set());            // channelIds
    const lastClickedRef = useRef(null);              // anchor for shift-range selection
    const selectedConnectorRef = useRef(null);        // { channelId, metaDataId } when a connector row is selected
    const expandedChannelsRef = useRef(new Set());    // channels showing connector rows
    const collapsedGroupsRef = useRef(new Set());     // groups default to expanded
    const filterTextRef = useRef('');
    const filterChipsRef = useRef([]);                // explicit picks: [{ value, kind: 'tag' | 'channel' }]
    const lifetimeRef = useRef(false);
    const viewModeRef = useRef(lsGet('oie-dash-view', 'group') === 'channel' ? 'channel' : 'group');
    const sortKeyRef = useRef('name');
    const sortDirRef = useRef(1);                     // 1 = asc, -1 = desc
    const connectorTypesRef = useRef(new Map());      // channelId → Map(metaDataId → transportName)
    const sourcePortsRef = useRef(new Map());         // channelId → source listener port string
    const connectorMetaAtRef = useRef(0);             // last connector-metadata fetch (epoch ms)
    const destroyedRef = useRef(false);
    const loadedRef = useRef(false);                  // first status poll has landed
    const timerRef = useRef(null);

    const savedTagMode = lsGet('oie-dash-tagmode', 'names');
    const tagModeRef = useRef(['names', 'icons', 'off'].includes(savedTagMode) ? savedTagMode : 'names');

    // Type + Port are web-only columns Swing's dashboard doesn't have, so they
    // start hidden (reachable via the <TreeTable> column menu) — matching Swing's
    // default set. <TreeTable> owns the column manager (widths/order/hidden via
    // the 'dashboard' storageKey) so the show/hide menu + persistence are reused.
    const DASH_DEFAULT_HIDDEN = ['type', 'port'];

    // The imperative filter-bar host (built once on mount). The status board is
    // now the declarative <TreeTable> below.
    const filterbarHostRef = useRef(null);
    const countsLabelRef = useRef(null);
    const filterInputRef = useRef(null);
    const typeaheadRef = useRef(null);
    const chipHostRef = useRef(null);

    // Latest plugin-tab def + selection signature, mirrored into React state via
    // forceRender so the open tab re-scopes when the selection changes.
    const activeTabRef = useRef(null);

    const CONNECTOR_META_MS = 60000;

    // Selection handed to the dashboard tabs (Connection Log, …): the selected
    // connector's scope, otherwise the selected channels.
    function currentSelection() {
        const sel = selectedConnectorRef.current;
        return sel
            ? [{ channelId: sel.channelId, metaDataId: sel.metaDataId }]
            : statusesRef.current.filter(s => selectedRef.current.has(s.channelId));
    }
    function emitSelection() {
        store.emit('dashboard:selection', currentSelection());
        forceRender();   // re-render the open dashboard tab with the new selection
    }

    /* ---- channel control tasks (the "Dashboard Tasks" sidebar pane) ---- */

    // Halt applies only to transitional states; Undeploy is suppressed while a
    // channel is transitioning (except SYNCING) — matching the Swing dashboard.
    const isHaltable = (s) => !['STARTED', 'STOPPED', 'PAUSED'].includes(s);
    const isHaltableNonSyncing = (s) => isHaltable(s) && s !== 'SYNCING';

    async function controlSelected(action, label) {
        const selected = selectedRef.current;
        if (!selected.size) { toast('Select a channel first', 'warn'); return; }
        for (const channelId of selected) {
            try { await api.status[action](channelId); }
            catch (e) { toast(`${label} failed: ${e.message}`, 'error'); }
        }
        refresh();
    }

    const needSel = (fn) => () => {
        const selected = selectedRef.current;
        if (!selected.size) { toast('Select a channel first', 'warn'); return; }
        fn([...selected]);
    };

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
                h('div.mb-[14px]', `Clear the selected statistics for ${ids.length} channel(s)? This cannot be undone.`),
                h('div', { class: 'flex flex-col gap-1.5' },
                    received.el, filtered.el, sent.el, errored.el),
                h('div.hint.mt-[14px]', 'Queued statistics cannot be cleared.')),
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

    // Task-pane handlers, mirroring the Swing context group (Send/View/Remove
    // All/Clear Statistics/Start/Pause/Stop/Halt/Undeploy).
    function startTask() { controlSelected('start', 'Start'); }
    function pauseTask() { controlSelected('pause', 'Pause'); }
    function stopTask() { controlSelected('stop', 'Stop'); }
    async function haltTask() {
        if (await confirmDialog('Halt channels', 'Halting forcibly kills processing threads. Halt the selected channels?', { danger: true, okLabel: 'Halt' })) {
            controlSelected('halt', 'Halt');
        }
    }
    const clearStatsTask = needSel((ids) => openClearStatisticsDialog(ids));
    const undeployTask = needSel(async (ids) => {
        if (await confirmDialog('Undeploy', `Undeploy ${ids.length} channel(s)?`, { okLabel: 'Undeploy' })) {
            try { await api.engine.undeployMany(ids); } catch (e) { toast(e.message, 'error'); }
            refresh();
        }
    });
    const sendMessageTask = needSel((ids) => openSendMessageDialog(platform, ids[0], () => refresh()));
    const viewMessagesTask = needSel((ids) => router.navigate(`/messages/${ids[0]}`));
    const removeAllTask = needSel(async () => {
        const selected = selectedRef.current;
        if (await confirmDialog('Remove all messages', `Permanently remove ALL messages from ${selected.size} channel(s)? This cannot be undone.`, { danger: true, okLabel: 'Remove' })) {
            for (const id of selected) {
                try { await api.messages.removeAll(id); } catch (e) { toast(e.message, 'error'); }
            }
            toast('Messages removed');
            refresh();
        }
    });

    /* ---- connector metadata (Type + Port columns) ---- */

    /* Channel definitions and listener ports change rarely, so they refresh at
       most every ~60s alongside the status poll (or on manual Refresh).
       Failures degrade silently — the Type/Port cells simply render empty. */
    async function refreshConnectorMeta(force = false) {
        if (!force && Date.now() - connectorMetaAtRef.current < CONNECTOR_META_MS) return;
        connectorMetaAtRef.current = Date.now();
        const [channels, ports] = await Promise.all([
            api.channels.list().catch(() => null),
            api.channels.portsInUse().catch(() => null)
        ]);
        if (channels) {
            const map = new Map();
            for (const ch of channels) {
                if (!ch || !ch.id) continue;
                const types = new Map();
                if (ch.sourceConnector?.transportName) types.set(0, ch.sourceConnector.transportName);
                for (const dest of api.asList(ch.destinationConnectors, 'connector')) {
                    if (dest?.transportName && dest.metaDataId !== undefined) types.set(Number(dest.metaDataId), dest.transportName);
                }
                map.set(ch.id, types);
            }
            connectorTypesRef.current = map;
        }
        if (ports) {
            const map = new Map();
            for (let row of ports) {
                if (row && row.ports) row = row.ports;   // singleton lists stay wrapped
                if (row && row.id && row.port) map.set(row.id, String(row.port));
            }
            sourcePortsRef.current = map;
        }
    }

    /* ---- grouping ---- */

    function groupedStatuses() {
        const statuses = statusesRef.current;
        const byId = new Map(statuses.map(s => [s.channelId, s]));
        const used = new Set();
        const rows = [];
        for (const group of groupsRef.current) {
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
        const filterChips = filterChipsRef.current;
        const filterText = filterTextRef.current;
        if (!filterChips.length && !filterText) return members;

        // Explicit picks (exact, no wildcard): channels carrying any selected
        // tag, or matching any selected channel name. Multiple picks are OR'd.
        const chipChannelIds = new Set();
        const chipChannelNames = new Set();
        for (const chip of filterChips) {
            if (chip.kind === 'tag') {
                for (const tag of tagsRef.current) {
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
            for (const tag of tagsRef.current) {
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

    /* ---- columns ---- */

    /* Numeric stat cell content (JSX): colored on warn/err, plain otherwise. The
       owning column sets align:'right' + mono so the td matches the legacy
       `td.num` (right-aligned, monospace tabular). */
    const statCellContent = (value, warnLevel) => {
        const text = fmtNumber(value);
        if (value && warnLevel === 'err') return <span className="text-err">{text}</span>;
        if (value && warnLevel === 'warn') return <span className="text-warn">{text}</span>;
        return text;
    };

    const statColumn = (key, label, statKey, warnLevel) => ({
        key, label, align: 'right', mono: true,
        sortValue: (st) => statsOf(st, lifetimeRef.current)[statKey] || 0,
        renderChannel: (st, stats) => statCellContent(stats[statKey], warnLevel),
        renderGroupAggregate: (totals) => statKey === 'ERROR'
            ? (totals.ERROR ? <span className="text-err">{fmtNumber(totals.ERROR)}</span> : '0')
            : fmtNumber(totals[statKey]),
        renderConnector: (child, stats) => <span className="text-text-dim">{fmtNumber(stats[statKey])}</span>
    });

    /* Column-definition model: each column knows how to render its CELL CONTENT
       (TreeTable wraps it in the <td>) for the three row types (group aggregate,
       channel, connector) and how to produce a sort value for a channel status.
       `tree:true` marks the column that carries the depth indent + twisty.
       Statistics read the closure `lifetime` flag (via lifetimeRef). */
    const COLUMNS = [
        {
            key: 'state', label: 'Status',
            sortValue: (st) => stateLabel(st.state) || String(st.state || ''),
            renderChannel: (st) => <span className="status-cell"><span className={`pip ${statePip(st.state)}`} />{stateLabel(st.state)}</span>,
            renderGroupAggregate: (totals, ctx) => {
                if (!ctx.members.length) return '';
                // Uniform group → that state's pip + label; otherwise "Mixed"
                // with a warning pip (Swing DashboardTreeTable behavior).
                const states = new Set(ctx.members.map(m => m.state));
                if (states.size === 1) {
                    const state = ctx.members[0].state;
                    return <span className="status-cell"><span className={`pip ${statePip(state)}`} />{stateLabel(state)}</span>;
                }
                return <span className="status-cell"><span className="pip warn" />Mixed</span>;
            },
            renderConnector: (child) => <span className="status-cell"><span className={`pip ${statePip(child.state)}`} />{stateLabel(child.state)}</span>
        },
        {
            key: 'name', label: 'Name', tree: true,
            sortValue: (st) => String(st.name || '').toLowerCase(),
            renderChannel: (st) => <NameCell st={st} />,
            renderGroupAggregate: (totals, ctx) => `[${ctx.group.name}]`,
            renderConnector: (child) => <span className="text-text-dim">{String(child.name ?? '')}</span>
        },
        {
            key: 'type', label: 'Type',
            sortValue: (st) => String(connectorTypesRef.current.get(st.channelId)?.get(0) || ''),
            renderChannel: (st) => connectorTypesRef.current.get(st.channelId)?.get(0) || '',
            renderGroupAggregate: () => '',
            renderConnector: (child) => <span className="text-text-dim">{connectorTypesRef.current.get(child.channelId)?.get(Number(child.metaDataId)) || ''}</span>
        },
        {
            key: 'port', label: 'Port', mono: true,
            sortValue: (st) => Number(sourcePortsRef.current.get(st.channelId)) || 0,
            renderChannel: (st) => sourcePortsRef.current.get(st.channelId) || '',
            renderGroupAggregate: () => '',
            renderConnector: (child) => <span className="text-text-dim">{Number(child.metaDataId) === 0 ? (sourcePortsRef.current.get(child.channelId) || '') : ''}</span>
        },
        {
            key: 'rev', label: 'Rev Δ', align: 'right', mono: true,
            sortValue: (st) => Number(st.deployedRevisionDelta) || 0,
            renderChannel: (st) => {
                const d = Number(st.deployedRevisionDelta) || 0;
                // Out of sync on revision delta OR code-template changes (see channels.js).
                const ct = st.codeTemplatesChanged === true || st.codeTemplatesChanged === 'true';
                const title = d > 0 && ct ? 'Channel and code templates changed since last deployment'
                    : d > 0 ? 'Channel changed since last deployment'
                        : ct ? 'Code templates changed since last deployment' : undefined;
                return (d > 0 || ct) ? <span className="cell-flag" title={title}>{String(d)}</span> : '0';
            },
            renderGroupAggregate: () => '--',
            renderConnector: () => ''
        },
        {
            key: 'deployed', label: 'Last Deployed', mono: true,
            sortValue: (st) => st.deployedDate?.time ?? 0,
            renderChannel: (st) => isJustDeployed(st)
                ? <span className="cell-flag">{fmtDate(st.deployedDate)}</span>
                : fmtDate(st.deployedDate),
            renderGroupAggregate: () => '--',
            renderConnector: () => ''
        },
        statColumn('received', 'Received', 'RECEIVED'),
        statColumn('filtered', 'Filtered', 'FILTERED'),
        statColumn('queued', 'Queued', 'QUEUED', 'warn'),
        statColumn('sent', 'Sent', 'SENT'),
        statColumn('errored', 'Errored', 'ERROR', 'err')
    ];

    // The built-in columns plus any plugin dashboard columns (rendered last). A
    // plugin column's cell(status)/connectorCell(child) return React content,
    // rendered directly into the cell.
    function allColumns() {
        return COLUMNS.concat(platform.dashboardColumns().map(c => ({
            key: c.id ? String(c.id) : String(c.label),
            label: c.label,
            renderChannel: (st) => (c.cell ? (c.cell(st) ?? '') : ''),
            renderGroupAggregate: () => '',
            renderConnector: (child) => (c.connectorCell ? (c.connectorCell(child) ?? '') : '')
        })));
    }

    // TreeTable column definitions: one render(node) per column that branches on
    // the node kind (group / channel / connector) to produce the cell content.
    function treeColumns() {
        return allColumns().map((col) => ({
            key: col.key, label: col.label, align: col.align, mono: col.mono, tree: col.tree,
            render: (node) => {
                if (node.kind === 'group') return col.renderGroupAggregate(node.totals, node.ctx);
                if (node.kind === 'connector') return col.renderConnector(node.child, node.stats);
                return col.renderChannel(node.st, node.stats);
            }
        }));
    }

    function sortChannels(list) {
        const byName = (a, b) => String(a.name).localeCompare(String(b.name));
        const sortKey = sortKeyRef.current;
        const col = COLUMNS.find(c => c.key === sortKey && c.sortValue);
        if (!col) return list.slice().sort(byName);
        const sortDir = sortDirRef.current;
        return list.slice().sort((a, b) => {
            const va = col.sortValue(a), vb = col.sortValue(b);
            let cmp;
            if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
            else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            return cmp ? cmp * sortDir : byName(a, b);
        });
    }

    /* ---- table ---- */

    // Flat list of visible channel ids in display order — the basis for
    // shift-range selection (mirrors the channel-row rendering order below).
    function visibleChannelIds() {
        if (viewModeRef.current === 'channel') {
            return sortChannels(visibleMembers(statusesRef.current)).map(st => st.channelId);
        }
        const ids = [];
        for (const { group, members } of groupedStatuses()) {
            if (collapsedGroupsRef.current.has(group.id)) continue;   // children hidden
            for (const st of sortChannels(visibleMembers(members))) ids.push(st.channelId);
        }
        return ids;
    }

    // The status board is now the declarative <TreeTable> below; renderTable()
    // just triggers a React re-render (all existing call sites are unchanged).
    function renderTable() { forceRender(); }

    /* ---- tree data for <TreeTable> -------------------------------------------- */

    // rowKey() must agree with the keys used in selectedKeys / collapsedKeys below.
    function rowKey(node) {
        if (node.kind === 'group') return `group:${node.group.id}`;
        if (node.kind === 'connector') return `conn:${node.child.channelId}:${node.child.metaDataId}`;
        return `chan:${node.st.channelId}`;
    }

    function connectorNodes(st) {
        return childrenOf(st).map((child) => ({
            kind: 'connector', child, stats: statsOf(child, lifetimeRef.current)
        }));
    }

    function channelNode(st) {
        return { kind: 'channel', st, stats: statsOf(st, lifetimeRef.current), children: connectorNodes(st) };
    }

    // Builds the root nodes the same way the legacy tbody walk did: channel view
    // is a flat sorted list of channels; group view nests channels under group
    // aggregate rows (an extra parent level). Filtering + sort are applied here
    // (matching the legacy renderTable), so <TreeTable> needs no `matches` prop.
    function buildTreeData() {
        if (viewModeRef.current === 'channel') {
            return sortChannels(visibleMembers(statusesRef.current)).map(channelNode);
        }
        const roots = [];
        for (const { group, members } of groupedStatuses()) {
            const visible = sortChannels(visibleMembers(members));
            if (filterTextRef.current && !visible.length) continue;   // skip empty group while filtering
            const totals = { RECEIVED: 0, FILTERED: 0, QUEUED: 0, SENT: 0, ERROR: 0 };
            let started = 0;
            for (const st of visible) {
                const s = statsOf(st, lifetimeRef.current);
                for (const k of Object.keys(totals)) totals[k] += s[k] || 0;
                if (st.state === 'STARTED') started++;
            }
            roots.push({
                kind: 'group', group, members: visible, totals,
                ctx: { group, members: visible, started },
                children: visible.map(channelNode)
            });
        }
        return roots;
    }

    /* ---- collapse (controlled) -------------------------------------------------
       Two legacy collapse states map onto <TreeTable>'s single collapsedKeys Set:
       groups default EXPANDED (collapsed when in collapsedGroupsRef); channels
       default COLLAPSED (their connectors are hidden until expandedChannelsRef
       holds the channel). So a channel key is "collapsed" unless it is expanded. */
    function buildCollapsedKeys() {
        const set = new Set();
        for (const groupId of collapsedGroupsRef.current) set.add(`group:${groupId}`);
        for (const st of statusesRef.current) {
            if (!expandedChannelsRef.current.has(st.channelId)) set.add(`chan:${st.channelId}`);
        }
        return set;
    }

    function onToggleCollapse(key) {
        if (key.startsWith('group:')) {
            const groupId = key.slice('group:'.length);
            const collapsed = collapsedGroupsRef.current;
            collapsed.has(groupId) ? collapsed.delete(groupId) : collapsed.add(groupId);
        } else if (key.startsWith('chan:')) {
            const channelId = key.slice('chan:'.length);
            const expanded = expandedChannelsRef.current;
            expanded.has(channelId) ? expanded.delete(channelId) : expanded.add(channelId);
        }
        forceRender();
    }

    /* ---- selection highlight (channels Set + optional connector) -------------- */
    function buildSelectedKeys() {
        const set = new Set();
        for (const channelId of selectedRef.current) set.add(`chan:${channelId}`);
        const conn = selectedConnectorRef.current;
        if (conn) set.add(`conn:${conn.channelId}:${conn.metaDataId}`);
        return set;
    }

    // Row click: channels keep the multi-select (ctrl/shift) semantics; a group
    // row toggles its collapse; a connector row single-selects that connector.
    function onSelect(node, e) {
        if (node.kind === 'group') { onToggleCollapse(`group:${node.group.id}`); return; }
        if (node.kind === 'connector') {
            const child = node.child;
            selectedConnectorRef.current = { channelId: child.channelId, metaDataId: child.metaDataId };
            selectedRef.current = new Set();
            lastClickedRef.current = null;
            forceRender();
            emitSelection();
            return;
        }
        const st = node.st;
        const selected = selectedRef.current;
        if (e.metaKey || e.ctrlKey) {
            selected.has(st.channelId) ? selected.delete(st.channelId) : selected.add(st.channelId);
        } else if (e.shiftKey && lastClickedRef.current) {
            const visible = visibleChannelIds();
            const a = visible.indexOf(lastClickedRef.current), b = visible.indexOf(st.channelId);
            if (a !== -1 && b !== -1) selectedRef.current = new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
            else selectedRef.current = new Set([st.channelId]);
        } else {
            selectedRef.current = new Set([st.channelId]);
        }
        lastClickedRef.current = st.channelId;
        selectedConnectorRef.current = null;
        forceRender();
        emitSelection();
    }

    // Double-click: connector → message browser filtered to it; channel → the
    // channel's message browser (Swing parity); group → no-op.
    function onActivate(node) {
        if (node.kind === 'connector') router.navigate(`/messages/${node.child.channelId}?metaDataId=${node.child.metaDataId}`);
        else if (node.kind === 'channel') router.navigate(`/messages/${node.st.channelId}`);
    }

    function onRowContextMenu(node, e) {
        if (node.kind === 'group') return groupMenu(node.group, node.members, e);
        if (node.kind === 'connector') return connectorMenu(node.child, e);
        return channelMenu(node.st, e);
    }

    /* ---- per-row context menus (reused verbatim from the legacy rows) --------- */

    function groupMenu(group, members, e) {
        e.preventDefault();
        if (!members.length) return;
        // Select the group's visible members, then mirror the channel-row menu
        // acting on that selection. Send/View target the first member.
        selectedRef.current = new Set(members.map(m => m.channelId));
        selectedConnectorRef.current = null;
        forceRender();
        emitSelection();
        const first = members[0];
        const anyState = (fn) => members.some(fn);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() },
            '-',
            { label: 'Send Message', icon: 'send', task: 'doSendMessage', onClick: () => openSendMessageDialog(platform, first.channelId, () => refresh()) },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => router.navigate(`/messages/${first.channelId}`) },
            { label: 'Remove All Messages', icon: 'trash', danger: true, task: 'doRemoveAllMessages', onClick: () => removeAllTask() },
            { label: 'Clear Statistics', icon: 'clear', hidden: lifetimeRef.current, task: 'doClearStats', onClick: () => clearStatsTask() },
            '-',
            { label: 'Start', icon: 'play', hidden: !anyState(x => x.state === 'STOPPED' || x.state === 'PAUSED'), task: 'doStart', onClick: () => controlSelected('start', 'Start') },
            { label: 'Pause', icon: 'pause', hidden: !anyState(x => x.state === 'STARTED'), task: 'doPause', onClick: () => controlSelected('pause', 'Pause') },
            { label: 'Stop', icon: 'stop', hidden: !anyState(x => x.state === 'STARTED' || x.state === 'PAUSED'), task: 'doStop', onClick: () => controlSelected('stop', 'Stop') },
            { label: 'Halt', icon: 'halt', hidden: !(members.length === 1 && isHaltable(members[0].state)), task: 'doHalt', onClick: () => haltTask() },
            { label: 'Undeploy Channels', icon: 'undeploy', hidden: anyState(x => isHaltableNonSyncing(x.state)), task: 'doUndeployChannel', onClick: () => undeployTask() }
        ], 'dashboard');
    }

    function tagsFor(channelId) {
        return tagsRef.current.filter(tag => api.asList(tag.channelIds, 'string').includes(channelId));
    }

    /* Icons mode: the actual tag glyph filled with the tag's color, stroked a
       slightly darker shade so the shape still reads against any row. */
    function tagIconJsx(tag, key) {
        const color = tagRgb(tag) || 'var(--text-dim)';
        return (
            <span key={key} title={tag.name} className="inline-flex flex-none">
                <svg viewBox="0 0 24 24" width={12} height={12} fill={color}
                    stroke={`color-mix(in srgb, ${color} 75%, black)`}
                    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d={iconPath('tag')} />
                </svg>
            </span>
        );
    }

    function tagChipsJsx(channelId) {
        if (tagModeRef.current === 'off') return null;
        return tagsFor(channelId).map((tag, i) => tagModeRef.current === 'icons'
            ? tagIconJsx(tag, i)
            : <span key={i} className="tag" style={{ background: tagRgb(tag, 0.25) }}>{tag.name}</span>);
    }

    // Single line, never wrapping — excess tags clip rather than grow the row.
    function NameCell({ st }) {
        return (
            <span className="inline-flex items-center gap-1.5 flex-nowrap overflow-hidden max-w-full">
                <span className="shrink-0">{st.name}</span>
                {tagChipsJsx(st.channelId)}
            </span>
        );
    }

    function channelMenu(st, e) {
        e.preventDefault();
        if (!selectedRef.current.has(st.channelId)) { selectedRef.current = new Set([st.channelId]); selectedConnectorRef.current = null; forceRender(); emitSelection(); }
        const sel = statusesRef.current.filter(x => selectedRef.current.has(x.channelId));
        const anyState = (fn) => sel.some(fn);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() },
            '-',
            { label: 'Send Message', icon: 'send', task: 'doSendMessage', onClick: () => openSendMessageDialog(platform, st.channelId, () => refresh()) },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => router.navigate(`/messages/${st.channelId}`) },
            { label: 'Remove All Messages', icon: 'trash', danger: true, task: 'doRemoveAllMessages', onClick: () => removeAllTask() },
            { label: 'Clear Statistics', icon: 'clear', hidden: lifetimeRef.current, task: 'doClearStats', onClick: () => clearStatsTask() },
            '-',
            { label: 'Start', icon: 'play', hidden: !anyState(x => x.state === 'STOPPED' || x.state === 'PAUSED'), task: 'doStart', onClick: () => controlSelected('start', 'Start') },
            { label: 'Pause', icon: 'pause', hidden: !anyState(x => x.state === 'STARTED'), task: 'doPause', onClick: () => controlSelected('pause', 'Pause') },
            { label: 'Stop', icon: 'stop', hidden: !anyState(x => x.state === 'STARTED' || x.state === 'PAUSED'), task: 'doStop', onClick: () => controlSelected('stop', 'Stop') },
            { label: 'Halt', icon: 'halt', hidden: !(sel.length === 1 && isHaltable(sel[0].state)), task: 'doHalt', onClick: () => haltTask() },
            { label: 'Undeploy Channel', icon: 'undeploy', hidden: anyState(x => isHaltableNonSyncing(x.state)), task: 'doUndeployChannel', onClick: async () => { try { await api.engine.undeploy(st.channelId); } catch (err) { toast(err.message, 'error'); } refresh(); } },
            '-',
            { label: 'Edit Channel', icon: 'edit', task: 'doEditChannel', group: 'channel', onClick: () => router.navigate(`/channels/${st.channelId}/edit`) },
            { label: 'Edit Filter', icon: 'filter', onClick: () => router.navigate(`/channels/${st.channelId}/filter/0`) },
            { label: 'Edit Transformer', icon: 'transform', onClick: () => router.navigate(`/channels/${st.channelId}/transformer/0`) }
        ], 'dashboard');
    }

    // Right-click a source/destination connector row to start/stop just that
    // connector (Swing DASHBOARD_START_CONNECTOR / STOP_CONNECTOR).
    function connectorMenu(child, e) {
        e.preventDefault();
        const runConnector = (method) => async () => {
            try { await api.status[method](child.channelId, child.metaDataId); }
            catch (err) { toast(err.message, 'error'); }
            refresh();
        };
        // Swing Frame.doStopConnector: a destination connector (metaDataId != 0)
        // can only be stopped individually when queueing is enabled; otherwise the
        // engine leaves it running, so warn instead of silently doing nothing
        // (queueEnabled is a boolean on the connector's DashboardStatus, which the
        // server may serialize as the string "true"/"false").
        const queueEnabled = child.queueEnabled === true || child.queueEnabled === 'true';
        const stopConnector = async () => {
            if (Number(child.metaDataId) !== 0 && !queueEnabled) {
                modal({
                    title: 'Connector not stopped',
                    body: h('div',
                        'This destination connector was not stopped because queueing is not enabled.',
                        h('br'), h('br'),
                        'Queueing must be enabled for a destination connector to be stopped individually.'),
                    buttons: [{ label: 'OK', primary: true }]
                });
                return;
            }
            await runConnector('stopConnector')();
        };
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() },
            '-',
            { label: 'Start Connector', icon: 'play', hidden: !(child.state === 'STOPPED' || child.state === 'PAUSED'), task: 'doStartConnector', onClick: runConnector('startConnector') },
            { label: 'Stop Connector', icon: 'stop', hidden: !(child.state === 'STARTED' || child.state === 'PAUSED'), task: 'doStopConnector', onClick: stopConnector }
        ], 'dashboard');
    }

    // Updates the counts label inside the imperative filter bar (kept verbatim).
    // Called from an effect after every render so it tracks the live status refs.
    function updateCounts() {
        const countsLabel = countsLabelRef.current;
        if (!countsLabel) return;
        const statuses = statusesRef.current;
        const channels = `${statuses.length} Deployed Channel${statuses.length === 1 ? '' : 's'}`;
        if (viewModeRef.current === 'channel') {
            countsLabel.textContent = channels;
        } else {
            const rows = groupedStatuses();
            countsLabel.textContent = `${rows.length} Group${rows.length === 1 ? '' : 's'}, ${channels}`;
        }
    }

    /* ---- filter bar (typeahead + view/tag toggles + statistics radios) ---- */

    /* Custom typeahead dropdown (native <datalist> can't render icons):
       substring matches across channel names + tag names, each row shows a
       type icon (server = channel, tag = tag) and a right-aligned type hint. */
    const TYPEAHEAD_MAX = 12;
    let taItems = [];
    let taIndex = -1;

    function removeChip(chip) {
        filterChipsRef.current = filterChipsRef.current.filter(c => c !== chip);
        renderChips(); renderTable(); filterInputRef.current.focus();
    }

    function renderChips() {
        const chipHost = chipHostRef.current;
        clear(chipHost);
        const filterChips = filterChipsRef.current;
        for (const chip of filterChips) {
            const isTag = chip.kind === 'tag';
            const tag = isTag ? tagsRef.current.find(t => String(t.name) === chip.value) : null;
            chipHost.appendChild(h('span.tag', {
                class: 'inline-flex items-center gap-1 py-px pr-1 pl-[7px]',
                style: {
                    background: isTag ? (tagRgb(tag, 0.25) || 'var(--bg3)') : 'var(--bg3)'
                }
            },
                icon(isTag ? 'tag' : 'server', 12),
                h('span', chip.value),
                h('button', {
                    title: 'Remove', class: 'border-none cursor-pointer text-inherit text-[14px] leading-none py-0 px-px',
                    style: { background: 'none' },
                    onClick: () => removeChip(chip)
                }, '×')));
        }
        chipHost.style.display = filterChips.length ? 'inline-flex' : 'none';
    }

    function typeaheadMatches(text) {
        const needle = text.toLowerCase();
        const seen = new Set();
        const out = [];
        const filterChips = filterChipsRef.current;
        const add = (name, kind) => {
            const key = kind + ':' + name.toLowerCase();
            if (filterChips.some(c => c.kind === kind && c.value === name)) return;   // already picked
            if (name.toLowerCase().includes(needle) && !seen.has(key)) { seen.add(key); out.push({ value: name, kind }); }
        };
        for (const st of statusesRef.current) if (st.name) add(String(st.name), 'channel');
        for (const tag of tagsRef.current) if (tag.name) add(String(tag.name), 'tag');
        out.sort((a, b) => a.value.localeCompare(b.value));
        return out.slice(0, TYPEAHEAD_MAX);
    }

    function closeTypeahead() {
        typeaheadRef.current.classList.add('hidden');
        taItems = [];
        taIndex = -1;
    }

    function paintTypeahead() {
        const typeahead = typeaheadRef.current;
        [...typeahead.children].forEach((row, i) => row.classList.toggle('active', i === taIndex));
        if (taIndex >= 0) typeahead.children[taIndex].scrollIntoView({ block: 'nearest' });
    }

    function pickSuggestion(item) {
        // Add an explicit pill (deduped); clear the text so more can be added.
        const filterChips = filterChipsRef.current;
        if (!filterChips.some(c => c.kind === item.kind && c.value === item.value)) {
            filterChips.push({ value: item.value, kind: item.kind });
        }
        filterTextRef.current = '';
        filterInputRef.current.value = '';
        renderChips();
        renderTable();
        closeTypeahead();
        filterInputRef.current.focus();
    }

    function openTypeahead() {
        const filterInput = filterInputRef.current;
        const typeahead = typeaheadRef.current;
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

    // Builds the entire filter bar (hand-built DOM, reused verbatim) into the
    // filterbar host. Called once on mount.
    function buildFilterbar() {
        const filterbarHost = filterbarHostRef.current;
        if (!filterbarHost) return;
        clear(filterbarHost);

        const countsLabel = h('span.counts', '');
        countsLabelRef.current = countsLabel;
        const typeahead = h('div.typeahead.hidden');
        typeaheadRef.current = typeahead;
        // Explicit picks render as pills (tag/channel icon) before the input,
        // which stays usable so multiple tags/channels can be selected.
        const chipHost = h('span.filter-chip-host', { class: 'gap-1 flex-wrap', style: { display: 'none' } });
        chipHostRef.current = chipHost;

        const filterInput = h('input', {
            type: 'text', placeholder: 'Enter channel tag or name', autocomplete: 'off',
            onInput: (e) => { filterTextRef.current = e.target.value.trim(); renderTable(); openTypeahead(); },
            onFocus: () => openTypeahead(),
            onBlur: () => setTimeout(closeTypeahead, 150),    // small delay so clicks on the dropdown land
            onKeydown: (e) => {
                const open = !typeahead.classList.contains('hidden');
                if (e.key === 'Backspace' && !filterInput.value && filterChipsRef.current.length) {
                    // Backspace on an empty input removes the last pill.
                    e.preventDefault();
                    removeChip(filterChipsRef.current[filterChipsRef.current.length - 1]);
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
        filterInputRef.current = filterInput;

        const viewToggle = segControl([
            { value: 'group', icon: 'folder', title: 'Group view' },
            { value: 'channel', icon: 'channels', title: 'Channel view' }
        ], viewModeRef.current, (value) => { viewModeRef.current = value; lsSet('oie-dash-view', value); renderTable(); });

        const tagToggle = segControl([
            { value: 'names', label: 'Names', title: 'Show tags as names' },
            { value: 'icons', label: 'Icons', title: 'Show tags as icons' },
            { value: 'off', label: 'Off', title: 'Hide tags' }
        ], tagModeRef.current, (value) => { tagModeRef.current = value; lsSet('oie-dash-tagmode', value); renderTable(); });

        const radioName = 'dash-stats-' + Math.floor(performance.now());
        const filterbar = h('div.filterbar',
            h('label', 'Filter:'), chipHost, filterInput, typeahead, countsLabel,
            h('span', { class: 'ml-auto inline-flex items-center gap-2.5 flex-none' },
                viewToggle,
                h('span', { class: 'inline-flex items-center gap-[5px]' },
                    h('span', { class: 'text-text-faint text-[11px]' }, 'Tags:'), tagToggle)),
            h('div.radio-group.inline-row', { class: 'ml-0' },
                h('label', h('input', { type: 'radio', name: radioName, checked: true, onChange: () => { lifetimeRef.current = false; renderTable(); forceRender(); } }), 'Current Statistics'),
                h('label', h('input', { type: 'radio', name: radioName, onChange: () => { lifetimeRef.current = true; renderTable(); forceRender(); } }), 'Lifetime Statistics')));
        filterbarHost.appendChild(filterbar);
    }

    /* ---- polling ---- */

    async function refresh(manual = false) {
        if (destroyedRef.current) return;
        try {
            const [st, gr, tg] = await Promise.all([
                api.status.list(),
                api.channelGroups.list().catch(() => groupsRef.current),
                api.server.channelTags().catch(() => tagsRef.current),
                refreshConnectorMeta(manual)              // never throws; ~60s cadence
            ]);
            statusesRef.current = st;
            groupsRef.current = gr || [];
            tagsRef.current = tg || [];
            loadedRef.current = true;
            // Prune selection of channels that no longer exist, then sync tasks.
            const ids = new Set(statusesRef.current.map(x => x.channelId));
            for (const id of [...selectedRef.current]) if (!ids.has(id)) selectedRef.current.delete(id);
            if (selectedConnectorRef.current && !ids.has(selectedConnectorRef.current.channelId)) selectedConnectorRef.current = null;
            // Refresh open suggestions in place when polling brings new data.
            const typeahead = typeaheadRef.current;
            if (typeahead && !typeahead.classList.contains('hidden') && document.activeElement === filterInputRef.current) openTypeahead();
            renderTable();
            forceRender();
        } catch (e) {
            if (manual) toast(`Refresh failed: ${e.message}`, 'error');
        }
    }

    function loop() {
        if (destroyedRef.current) return;
        // Auto-refresh interval is a user preference (Administrator settings).
        const intervalMs = Math.max(1, Number(getPref('dashboardRefreshSeconds')) || 5) * 1000;
        timerRef.current = setTimeout(async () => { await refresh(); if (!destroyedRef.current) loop(); }, intervalMs);
    }

    // Click on empty space (not a row) clears the channel selection, so the
    // contextual task buttons can be dismissed (the <TreeTable> wrapper forwards
    // empty-space clicks here).
    function onEmptyClick(e) {
        if (e.target.closest('tr')) return;
        if (!selectedRef.current.size && !selectedConnectorRef.current) return;
        selectedRef.current = new Set();
        selectedConnectorRef.current = null;
        lastClickedRef.current = null;
        forceRender();
        emitSelection();
    }
    // Right-click the empty space below the rows: deselect and show the
    // no-selection dashboard popup (just Refresh), matching the Swing dashboard.
    function onEmptyContextMenu(e) {
        e.preventDefault();
        if (selectedRef.current.size || selectedConnectorRef.current) {
            selectedRef.current = new Set();
            selectedConnectorRef.current = null;
            lastClickedRef.current = null;
            forceRender();
            emitSelection();
        }
        contextMenu(e.clientX, e.clientY, [{ label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() }], 'dashboard');
    }

    /* ---- mount: build the filter bar once, then poll ---- */

    useEffect(() => {
        buildFilterbar();
        // Initial load shows the plugin tabs (via forceRender) once statuses land.
        refresh(true).then(forceRender);
        loop();

        return () => {
            destroyedRef.current = true;
            clearTimeout(timerRef.current);
            // Leaving the dashboard ends the one-time "just deployed" cue, so it
            // won't reappear when you navigate back.
            for (const st of statusesRef.current) if (isJustDeployed(st)) seenDeploys.add(deployKey(st));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep the imperative filter-bar's counts label in sync after every render.
    useEffect(() => { updateCounts(); });

    /* ---- React task pane: selection-gated visibility (Swing Dashboard Tasks) ---- */

    const sel = statusesRef.current.filter(s => selectedRef.current.has(s.channelId));
    const hasSel = sel.length > 0;
    const lifetime = lifetimeRef.current;
    const anyState = (fn) => sel.some(fn);
    // Started channel offers Pause/Stop, not Start/Halt (classic behavior).
    const showStart = anyState(s => s.state === 'STOPPED' || s.state === 'PAUSED');
    const showPause = anyState(s => s.state === 'STARTED');
    const showStop = anyState(s => s.state === 'STARTED' || s.state === 'PAUSED');
    // Halt is single-channel + transitional; Undeploy hides while a channel is
    // transitioning (except Syncing); Clear Statistics hides in Lifetime mode.
    const showHalt = sel.length === 1 && isHaltable(sel[0].state);
    const showUndeploy = hasSel && !anyState(s => isHaltableNonSyncing(s.state));
    const showClearStats = hasSel && !lifetime;

    /* ---- plugin dashboard tabs (Server Log, Connection Log, Global Maps, …) ---- */

    const tabDefs = platform.dashboardTabs();
    const selectionForTabs = currentSelection();
    // Re-scope the open tab when the selection changes by remounting on a
    // signature key (the old tab's poll loop self-stops once detached).
    const selectionSig = selectedConnectorRef.current
        ? `conn:${selectedConnectorRef.current.channelId}:${selectedConnectorRef.current.metaDataId}`
        : [...selectedRef.current].sort().join(',');
    if (tabDefs.length && (!activeTabRef.current || !tabDefs.includes(activeTabRef.current))) {
        activeTabRef.current = tabDefs[0];
    }
    const activeTab = tabDefs.length ? activeTabRef.current : null;
    const tabCtx = { selection: selectionForTabs, platform };

    /* ---- status board (<TreeTable>) data + collapse/selection state ---- */
    const treeData = buildTreeData();
    const collapsedKeys = buildCollapsedKeys();
    const selectedKeys = buildSelectedKeys();
    const emptyText = loadedRef.current
        ? (
            <div className="dt-empty">
                <div className="empty-icon"><Icon name="dashboard" size={30} /></div>
                <div>No deployed channels</div>
                <div className="text-text-faint mt-[14px]">Deploy a channel from the Channels view to see it here.</div>
            </div>
        )
        : 'Contacting engine…';

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Dashboard Tasks" paneKey="tasks:Dashboard Tasks" group="dashboard">
                    <div className="taskbar" data-pane-title="Dashboard Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshStatuses" onClick={() => refresh(true)} />
                        {hasSel && <TaskButton label="Send Message" icon="send" task="doSendMessage" onClick={sendMessageTask} />}
                        {hasSel && <TaskButton label="View Messages" icon="messages" task="doShowMessages" onClick={viewMessagesTask} />}
                        {hasSel && <TaskButton label="Remove All Messages" icon="trash" danger task="doRemoveAllMessages" onClick={removeAllTask} />}
                        {showClearStats && <TaskButton label="Clear Statistics" icon="clear" task="doClearStats" onClick={clearStatsTask} />}
                        {showStart && <TaskButton label="Start" icon="play" task="doStart" onClick={startTask} />}
                        {showPause && <TaskButton label="Pause" icon="pause" task="doPause" onClick={pauseTask} />}
                        {showStop && <TaskButton label="Stop" icon="stop" task="doStop" onClick={stopTask} />}
                        {showHalt && <TaskButton label="Halt" icon="halt" task="doHalt" onClick={haltTask} />}
                        {showUndeploy && <TaskButton label="Undeploy Channel" icon="undeploy" task="doUndeployChannel" onClick={undeployTask} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]"
                    onClick={onEmptyClick}
                    onContextMenu={(e) => { if (!e.target.closest('tr') && !e.target.closest('thead')) onEmptyContextMenu(e); }}>
                    <TreeTable
                        data={treeData}
                        columns={treeColumns()}
                        getChildren={(n) => n.children}
                        rowKey={rowKey}
                        rowClassName={(n) => (n.kind === 'group' ? 'group-row' : '')}
                        autoGroupRow={false}
                        selectedKeys={selectedKeys}
                        onSelect={onSelect}
                        onActivate={onActivate}
                        onRowContextMenu={onRowContextMenu}
                        onEmptyContextMenu={onEmptyContextMenu}
                        collapsedKeys={collapsedKeys}
                        onToggleCollapse={onToggleCollapse}
                        columnsKey="dashboard"
                        columnWidths={DASH_COL_WIDTHS}
                        defaultHidden={DASH_DEFAULT_HIDDEN}
                        pinnedKeys={['state', 'name']}
                        emptyText={emptyText} />
                </div>
                <div ref={filterbarHostRef} className="flex-none" />
                {tabDefs.length > 0 && (
                    <>
                        <div className="split-handle" data-orient="v" data-resize="next" />
                        <div className="flex-none h-[230px] overflow-hidden flex flex-col">
                            <div className="tabs flex-none">
                                {tabDefs.map((def) => (
                                    <button key={def.id || def.label}
                                        className={'tab' + (def === activeTab ? ' active' : '')}
                                        onClick={() => { activeTabRef.current = def; forceRender(); }}>{def.label}</button>
                                ))}
                            </div>
                            {activeTab && (
                                <div key={(activeTab.id || activeTab.label) + '|' + selectionSig}
                                    className="flex-1 overflow-auto min-h-0">
                                    <PluginSlot def={activeTab} ctx={tabCtx} />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
