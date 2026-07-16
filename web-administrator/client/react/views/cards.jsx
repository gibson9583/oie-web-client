/*
 * Card view — a modern, card-based alternative to the classic Dashboard table.
 * Highlights aggregate statistics + channel state, groups by channel group / tag /
 * state, and shows each channel as a compact card with live stats and quick actions.
 *
 * Built to scale: the ungrouped card grid is VIRTUALIZED (only the cards in view are
 * rendered), so thousands of channels stay smooth. It reuses the real dashboard data
 * (api.status.list + statsOf), channel groups, and channel tags.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import api, { statePip, stateLabel } from '@oie/web-api';
import { toast, confirmDialog, contextMenu } from '@oie/web-ui';
import { Icon } from '../bridges.jsx';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { statsOf } from './dashboard.jsx';

const CARD_MIN = 280;   // min card width (px) for the responsive grid
const CARD_H = 128;     // fixed card height (px) — required for virtualization
const GAP = 12;
const SECTION_CAP = 60; // grouped view: max cards rendered per section before "show more"
                        // (grouped mode isn't virtualized, so this bounds the DOM on big servers)

const STATE_ORDER = ['STARTED', 'PAUSED', 'STOPPED'];   // undeployed channels are excluded
const STATE_META = {
    STARTED: { label: 'Started', pip: 'ok', color: 'var(--ok, #3ecf8e)' },
    PAUSED: { label: 'Paused', pip: 'warn', color: 'var(--warn)' },
    STOPPED: { label: 'Stopped', pip: 'err', color: 'var(--err)' },
    UNDEPLOYED: { label: 'Undeployed', pip: '', color: 'var(--text-faint)' }
};

function tagRgb(tag, alpha) {
    const c = tag && tag.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined) {
        return alpha !== undefined ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${alpha})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
    }
    return 'var(--bg2)';
}
const fmt = (n) => (Number(n) || 0).toLocaleString();

/* ---- summary stat card ---- */

function StatCard({ label, value, color, active, onClick, small }) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick}
            className={`panel !mt-0 text-left px-3.5 py-2.5 flex flex-col gap-0.5 min-w-[120px] ${onClick ? 'cursor-pointer hover:border-accent' : 'cursor-default'} ${active ? 'border-accent bg-[var(--accent-glow)]' : ''}`}>
            <span className={`${small ? 'text-lg' : 'text-2xl'} font-semibold tabular-nums`} style={{ color: color || 'var(--text)' }}>{value}</span>
            <span className="text-[11px] uppercase tracking-wide text-text-faint">{label}</span>
        </button>
    );
}

/* ---- channel card ---- */

function ChannelCard({ status, tags, selected, onSelect, onOpen, onMenu, lifetime }) {
    const s = statsOf(status, lifetime);
    // Manual double-click detection: a plain onClick + onDoubleClick pair races with
    // the selection re-render, so track the timestamp and open on a quick second click.
    const lastClick = useRef(0);
    const handleClick = (e) => {
        e.stopPropagation();   // let a click on empty space (below) clear the selection
        const now = Date.now();
        if (now - lastClick.current < 350) { lastClick.current = 0; onOpen(status); return; }
        lastClick.current = now;
        onSelect(status, e);
    };
    return (
        <div className={`panel !mt-0 flex flex-col justify-between overflow-hidden cursor-pointer select-none ${selected ? 'border-accent bg-[var(--accent-glow)]' : ''}`}
            style={{ height: CARD_H }}
            title="Click to select (⌘/Ctrl for multiple) · double-click to open messages · right-click for actions"
            onClick={handleClick} onContextMenu={(e) => onMenu(status, e)}>
            <div className="px-3 pt-2.5 flex items-start gap-2">
                <span className={`pip ${statePip(status.state)} mt-1.5 flex-none`} />
                <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" title={status.name}>{status.name}</div>
                    <div className="text-[11px] text-text-faint">{stateLabel(status.state)}</div>
                </div>
            </div>
            <div className="px-3 h-[18px] overflow-hidden flex gap-1">
                {tags.map((t, i) => <span key={i} className="tag !py-0 !text-[10px]" style={{ background: tagRgb(t, 0.25) }}>{t.name}</span>)}
            </div>
            <div className="grid grid-cols-4 border-t border-line divide-x divide-line text-center">
                {[['Received', s.RECEIVED, ''], ['Sent', s.SENT, ''], ['Queued', s.QUEUED, s.QUEUED ? 'text-warn' : ''], ['Errored', s.ERROR, s.ERROR ? 'text-err' : '']].map(([label, val, cls]) => (
                    <div key={label} className="py-1.5">
                        <div className={`text-[13px] font-semibold tabular-nums ${cls}`}>{fmt(val)}</div>
                        <div className="text-[10px] text-text-faint uppercase tracking-wide">{label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ---- virtualized grid (ungrouped) ---- */

function VirtualGrid({ items, tagsFor, selectedSet, onSelect, onOpen, onMenu, onClear, lifetime }) {
    const ref = useRef(null);
    const [vp, setVp] = useState({ cols: 1, scrollTop: 0, height: 600, width: 800 });
    useEffect(() => {
        const el = ref.current;
        if (!el) return undefined;
        const measure = () => setVp({
            cols: Math.max(1, Math.floor((el.clientWidth + GAP) / (CARD_MIN + GAP))),
            scrollTop: el.scrollTop, height: el.clientHeight, width: el.clientWidth
        });
        measure();
        el.addEventListener('scroll', measure, { passive: true });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
    }, []);

    const rowH = CARD_H + GAP;
    const totalRows = Math.ceil(items.length / vp.cols);
    const firstRow = Math.max(0, Math.floor(vp.scrollTop / rowH) - 2);
    const lastRow = Math.min(totalRows, Math.ceil((vp.scrollTop + vp.height) / rowH) + 2);
    const start = firstRow * vp.cols;
    const end = Math.min(items.length, lastRow * vp.cols);
    const visible = items.slice(start, end);

    return (
        <div ref={ref} className="flex-1 overflow-auto px-4 pb-4" onClick={onClear}>
            <div style={{ height: totalRows * rowH, position: 'relative' }}>
                <div style={{ position: 'absolute', top: firstRow * rowH, left: 0, right: 0, display: 'grid', gap: GAP, gridTemplateColumns: `repeat(${vp.cols}, minmax(0, 1fr))` }}>
                    {visible.map((st) => <ChannelCard key={st.channelId} status={st} tags={tagsFor(st.channelId)} selected={selectedSet.has(st.channelId)} onSelect={onSelect} onOpen={onOpen} onMenu={onMenu} lifetime={lifetime} />)}
                </div>
            </div>
        </div>
    );
}

/* ---- view ---- */

function CardsView({ onToggleView }) {
    const [statuses, setStatuses] = useState(null);
    const [groups, setGroups] = useState([]);
    const [tags, setTags] = useState([]);
    const [query, setQuery] = useState('');
    const [groupBy, setGroupByState] = useState(() => {
        const g = getPref('cardsGroupBy');
        return ['none', 'group', 'tag', 'state'].includes(g) ? g : 'none';
    });
    const setGroupBy = (g) => { setGroupByState(g); setPrefs({ cardsGroupBy: g }); };
    const [stateFilter, setStateFilter] = useState(null);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [sectionLimits, setSectionLimits] = useState({});   // grouped view: sectionKey → cards shown
    const [selected, setSelected] = useState(() => new Set());   // selected channelIds (multi-select)
    const [live, setLive] = useState(true);
    const liveRef = useRef(true);
    liveRef.current = live;
    // Current (since deploy/reset) vs. Lifetime statistics — mirrors the classic
    // dashboard's toggle; remembered like the group-by choice.
    const [lifetime, setLifetimeState] = useState(() => getPref('cardsLifetime') === true);
    const setLifetime = (v) => { setLifetimeState(v); setPrefs({ cardsLifetime: v }); };

    const refresh = async () => {
        // Deployed channels only — undeployed ones aren't running, so they're excluded.
        try {
            const list = await api.status.list(undefined, undefined, false);
            setStatuses(list.filter((s) => s.state !== 'UNDEPLOYED'));
        } catch { /* keep last */ }
    };
    useEffect(() => {
        refresh();
        api.channelGroups.list().then(setGroups).catch(() => {});
        api.server.channelTags().then(setTags).catch(() => {});
        const secs = Math.max(2, Number(getPref('dashboardRefreshSeconds')) || 5);
        const t = setInterval(() => { if (liveRef.current) refresh(); }, secs * 1000);
        return () => clearInterval(t);
    }, []);

    // channelId -> tags
    const tagsByChannel = useMemo(() => {
        const map = new Map();
        for (const tag of tags) {
            for (const id of api.asList(tag.channelIds, 'string').map(String)) {
                if (!map.has(id)) map.set(id, []);
                map.get(id).push(tag);
            }
        }
        return map;
    }, [tags]);
    const tagsFor = (id) => tagsByChannel.get(id) || [];

    const all = useMemo(() => statuses || [], [statuses]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return all.filter((s) => {
            if (stateFilter && s.state !== stateFilter) return false;
            if (!q) return true;
            if (String(s.name || '').toLowerCase().includes(q)) return true;
            return tagsFor(s.channelId).some((t) => String(t.name || '').toLowerCase().includes(q));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [all, query, stateFilter, tagsByChannel]);

    // aggregates (across ALL, not filtered — the summary reflects the whole engine)
    const agg = useMemo(() => {
        const states = {}; const totals = { RECEIVED: 0, SENT: 0, QUEUED: 0, ERROR: 0 };
        let withErrors = 0;
        for (const s of all) {
            states[s.state] = (states[s.state] || 0) + 1;
            const st = statsOf(s, lifetime);
            totals.RECEIVED += st.RECEIVED; totals.SENT += st.SENT; totals.QUEUED += st.QUEUED; totals.ERROR += st.ERROR;
            if (st.ERROR > 0) withErrors += 1;
        }
        return { states, totals, withErrors };
    }, [all, lifetime]);

    /* ---- selection + actions ---- */
    const selectCard = (status, e) => {
        const id = status.channelId;
        setSelected((cur) => {
            if (e.metaKey || e.ctrlKey) { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }
            if (cur.size === 1 && cur.has(id)) return new Set();   // click the sole selection again to deselect
            return new Set([id]);
        });
    };
    const clearSelection = () => setSelected(new Set());
    const openMessages = (status) => router.navigate(`/messages/${status.channelId}`);

    async function bulkControl(kind, targets) {
        const ids = targets.map((s) => s.channelId);
        if (!ids.length) return;
        if (kind === 'undeploy' && !await confirmDialog('Undeploy', `Undeploy ${ids.length} channel${ids.length > 1 ? 's' : ''}?`, { okLabel: 'Undeploy' })) return;
        if (kind === 'halt' && !await confirmDialog('Halt channels', 'Halting forcibly kills processing threads. Halt the selected channels?', { danger: true, okLabel: 'Halt' })) return;
        try {
            if (kind === 'undeploy') await api.engine.undeployMany(ids);
            // "Start" on a PAUSED channel resumes it (restarts the stopped source):
            // the engine's _start (Channel.start) only acts on a STOPPED/DEPLOYING
            // channel and is a no-op when PAUSED. Matches Swing's Frame.doStart.
            else for (const s of targets) await api.status[(kind === 'start' && s.state === 'PAUSED') ? 'resume' : kind](s.channelId);
            refresh();
        } catch (e) { toast(e && e.message ? e.message : 'Action failed', 'error'); }
    }
    async function clearStats(targets) {
        if (!targets.length) return;
        if (!await confirmDialog('Clear Statistics', `Clear statistics for ${targets.length} channel${targets.length > 1 ? 's' : ''}?`)) return;
        try { await api.statistics.clear(Object.fromEntries(targets.map((s) => [s.channelId, null]))); refresh(); }
        catch (e) { toast(e && e.message ? e.message : 'Clear statistics failed', 'error'); }
    }

    // Right-click a card → the same gated actions as the Dashboard Tasks rail.
    // If the card isn't part of the current selection, right-clicking selects just it.
    const openMenu = (status, e) => {
        e.preventDefault();
        let targets;
        if (selected.has(status.channelId)) targets = all.filter((s) => selected.has(s.channelId));
        else { setSelected(new Set([status.channelId])); targets = [status]; }
        const has = (pred) => targets.some((s) => pred(s.state));
        const items = [
            { header: true, label: targets.length > 1 ? `${targets.length} channels selected` : status.name },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => openMessages(targets[0]) },
            { label: 'Clear Statistics', icon: 'clear', task: 'doClearStats', onClick: () => clearStats(targets) },
            '-'
        ];
        if (has((st) => st === 'STOPPED' || st === 'PAUSED')) items.push({ label: 'Start', icon: 'play', task: 'doStart', onClick: () => bulkControl('start', targets.filter((s) => ['STOPPED', 'PAUSED'].includes(s.state))) });
        if (has((st) => st === 'STARTED')) items.push({ label: 'Pause', icon: 'pause', task: 'doPause', onClick: () => bulkControl('pause', targets.filter((s) => s.state === 'STARTED')) });
        if (has((st) => st === 'STARTED' || st === 'PAUSED')) items.push({ label: 'Stop', icon: 'stop', danger: true, task: 'doStop', onClick: () => bulkControl('stop', targets.filter((s) => ['STARTED', 'PAUSED'].includes(s.state))) });
        if (targets.length === 1 && !['STARTED', 'STOPPED', 'PAUSED', 'UNDEPLOYED'].includes(targets[0].state)) items.push({ label: 'Halt', icon: 'halt', danger: true, task: 'doHalt', onClick: () => bulkControl('halt', targets) });
        if (has((st) => st !== 'UNDEPLOYED')) items.push({ label: 'Undeploy Channel', icon: 'undeploy', task: 'doUndeployChannel', onClick: () => bulkControl('undeploy', targets.filter((s) => s.state !== 'UNDEPLOYED')) });
        contextMenu(e.clientX, e.clientY, items, 'dashboard');
    };

    /* ---- grouping ---- */
    const sections = useMemo(() => {
        if (groupBy === 'none') return null;
        const byId = new Map(filtered.map((s) => [s.channelId, s]));
        const out = [];
        if (groupBy === 'group') {
            const used = new Set();
            for (const g of groups) {
                const members = api.asList(g.channels, 'channel').map((c) => byId.get(c.id)).filter(Boolean);
                members.forEach((m) => used.add(m.channelId));
                if (members.length) out.push({ key: g.id, label: g.name, members });
            }
            const rest = filtered.filter((s) => !used.has(s.channelId));
            if (rest.length) out.unshift({ key: '__default__', label: 'Default Group', members: rest });
        } else if (groupBy === 'tag') {
            const seen = new Set();
            for (const tag of tags) {
                const members = filtered.filter((s) => tagsFor(s.channelId).some((t) => t.name === tag.name));
                members.forEach((m) => seen.add(m.channelId));
                if (members.length) out.push({ key: `tag:${tag.name}`, label: tag.name, members });
            }
            const untagged = filtered.filter((s) => !seen.has(s.channelId));
            if (untagged.length) out.push({ key: '__untagged__', label: 'Untagged', members: untagged });
        } else if (groupBy === 'state') {
            const order = [...STATE_ORDER, ...Object.keys(agg.states).filter((s) => !STATE_ORDER.includes(s))];
            for (const state of order) {
                const members = filtered.filter((s) => s.state === state);
                if (members.length) out.push({ key: `state:${state}`, label: stateLabel(state), members });
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupBy, filtered, groups, tags, tagsByChannel]);

    const toggleState = (s) => setStateFilter((cur) => (cur === s ? null : s));

    // Selection-gated tasks, mirroring the classic Dashboard Tasks pane.
    const sel = all.filter((s) => selected.has(s.channelId));
    const hasSel = sel.length > 0;
    const anySel = (pred) => sel.some((s) => pred(s.state));
    const showStart = anySel((st) => st === 'STOPPED' || st === 'PAUSED');
    const showPause = anySel((st) => st === 'STARTED');
    const showStop = anySel((st) => st === 'STARTED' || st === 'PAUSED');
    const showHalt = sel.length === 1 && !['STARTED', 'STOPPED', 'PAUSED', 'UNDEPLOYED'].includes(sel[0].state);
    const showUndeploy = anySel((st) => st !== 'UNDEPLOYED');

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Dashboard Tasks" paneKey="tasks:Dashboard Tasks" group="dashboard">
                    <div className="taskbar" data-pane-title="Dashboard Tasks">
                        {onToggleView && <TaskButton label="Table view" icon="menu" onClick={onToggleView} />}
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshStatuses" onClick={refresh} />
                        {hasSel && <TaskButton label={sel.length > 1 ? `View Messages (${sel.length})` : 'View Messages'} icon="messages" task="doShowMessages" onClick={() => openMessages(sel[0])} />}
                        {hasSel && <TaskButton label="Clear Statistics" icon="clear" task="doClearStats" onClick={() => clearStats(sel)} />}
                        {showStart && <TaskButton label="Start" icon="play" task="doStart" onClick={() => bulkControl('start', sel.filter((s) => ['STOPPED', 'PAUSED'].includes(s.state)))} />}
                        {showPause && <TaskButton label="Pause" icon="pause" task="doPause" onClick={() => bulkControl('pause', sel.filter((s) => s.state === 'STARTED'))} />}
                        {showStop && <TaskButton label="Stop" icon="stop" danger task="doStop" onClick={() => bulkControl('stop', sel.filter((s) => ['STARTED', 'PAUSED'].includes(s.state)))} />}
                        {showHalt && <TaskButton label="Halt" icon="halt" danger task="doHalt" onClick={() => bulkControl('halt', sel)} />}
                        {showUndeploy && <TaskButton label="Undeploy Channel" icon="undeploy" task="doUndeployChannel" onClick={() => bulkControl('undeploy', sel.filter((s) => s.state !== 'UNDEPLOYED'))} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {/* Summary */}
            <div className="flex flex-wrap gap-2.5 px-4 py-3 border-b border-line">
                <StatCard label="Channels" value={fmt(all.length)} />
                {STATE_ORDER.map((s) => (agg.states[s] ? (
                    <StatCard key={s} label={STATE_META[s].label} value={fmt(agg.states[s])} color={STATE_META[s].color}
                        active={stateFilter === s} onClick={() => toggleState(s)} small />
                ) : null))}
                <div className="flex-1 min-w-[8px]" />
                <StatCard label="Received" value={fmt(agg.totals.RECEIVED)} small />
                <StatCard label="Sent" value={fmt(agg.totals.SENT)} small />
                <StatCard label="Queued" value={fmt(agg.totals.QUEUED)} color={agg.totals.QUEUED ? 'var(--warn)' : undefined} small />
                <StatCard label="Errored" value={fmt(agg.totals.ERROR)} color={agg.totals.ERROR ? 'var(--err)' : undefined} small />
            </div>

            {/* Controls — two groups: filters (left) and display controls (right).
                They sit on one line (spread apart) when there's room; when the row is
                too narrow the display cluster drops to a left-aligned second line. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint"><Icon name="search" size={14} /></span>
                        <input type="text" className="w-[220px] max-w-full !pl-7" placeholder="Filter channels & tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <label className="flex items-center gap-2 text-[12px] text-text-dim">Group by
                        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                            <option value="none">None</option>
                            <option value="group">Channel group</option>
                            <option value="tag">Tag</option>
                            <option value="state">State</option>
                        </select>
                    </label>
                    {stateFilter && <button className="btn btn-sm btn-ghost" onClick={() => setStateFilter(null)}><Icon name="x" size={12} />{STATE_META[stateFilter] ? STATE_META[stateFilter].label : stateFilter}</button>}
                </div>
                <div className="flex items-center gap-2">
                    {/* Current vs. Lifetime statistics */}
                    <div className="inline-flex flex-none border border-line-strong rounded-md overflow-hidden text-[12px]">
                        {[['Current', false], ['Lifetime', true]].map(([label, val]) => (
                            <button key={label} type="button" onClick={() => setLifetime(val)}
                                className="appearance-none border-0 cursor-pointer px-3 py-1 transition-colors"
                                style={{
                                    background: lifetime === val ? 'var(--accent-glow)' : 'transparent',
                                    color: lifetime === val ? 'var(--accent)' : 'var(--text-dim)'
                                }}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <button className={`btn btn-ghost btn-sm ${live ? 'text-accent' : ''}`} onClick={() => setLive((v) => !v)} title="Toggle auto-refresh">
                        <span className={`pip ${live ? 'ok' : ''} mr-1`} />{live ? 'Live' : 'Paused'}
                    </button>
                    <span className="text-[12px] text-text-faint whitespace-nowrap">{filtered.length} of {all.length}</span>
                </div>
            </div>

            {/* Body */}
            {statuses === null ? (
                <div className="view-body"><div className="dt-empty">Loading channels…</div></div>
            ) : filtered.length === 0 ? (
                <div className="view-body"><div className="dt-empty"><div className="empty-icon"><Icon name="dashboard" size={30} /></div>No channels match.</div></div>
            ) : sections ? (
                <div className="view-body" onClick={clearSelection}>
                    {sections.map((sec) => {
                        const open = !collapsed.has(sec.key);
                        // Grouped mode isn't virtualized, so cap how many cards a section
                        // renders (bounds the DOM on big servers); "show more" reveals more.
                        const limit = sectionLimits[sec.key] || SECTION_CAP;
                        const shown = sec.members.slice(0, limit);
                        const more = sec.members.length - shown.length;
                        return (
                            <div key={sec.key} className="mb-4">
                                <div role="button" className="flex items-center gap-2 w-full py-1.5 border-b border-line mb-2 cursor-pointer hover:text-accent select-none"
                                    onClick={(e) => { e.stopPropagation(); setCollapsed((c) => { const n = new Set(c); if (n.has(sec.key)) n.delete(sec.key); else n.add(sec.key); return n; }); }}>
                                    <Icon name={open ? 'chevD' : 'chevR'} size={14} />
                                    <span className="font-semibold">{sec.label}</span>
                                    <span className="text-text-faint text-[12px]">{sec.members.length}</span>
                                </div>
                                {open && (
                                    <>
                                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))` }}>
                                            {shown.map((st) => <div key={st.channelId} style={{ height: CARD_H }}><ChannelCard status={st} tags={tagsFor(st.channelId)} selected={selected.has(st.channelId)} onSelect={selectCard} onOpen={openMessages} onMenu={openMenu} lifetime={lifetime} /></div>)}
                                        </div>
                                        {more > 0 && (
                                            <button type="button" className="btn btn-sm btn-ghost mt-2"
                                                onClick={(e) => { e.stopPropagation(); setSectionLimits((l) => ({ ...l, [sec.key]: (l[sec.key] || SECTION_CAP) + SECTION_CAP })); }}>
                                                Show {Math.min(more, SECTION_CAP)} more ({more} hidden)
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <VirtualGrid items={filtered} tagsFor={tagsFor} selectedSet={selected} onSelect={selectCard} onClear={clearSelection} onOpen={openMessages} onMenu={openMenu} lifetime={lifetime} />
            )}
        </div>
    );
}

/* No standalone registration: the card view is one of the Dashboard's two looks,
   mounted by DashboardHost (dashboard.jsx) under the single "Dashboard" nav item. */
export { CardsView };
