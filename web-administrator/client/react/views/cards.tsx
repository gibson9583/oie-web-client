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
import * as RadioGroup from '@radix-ui/react-radio-group';
import { toast, confirmDialog, contextMenu } from '@oie/web-ui';
import { Icon } from '../bridges.jsx';
import { ViewTasks } from '../mount.jsx';
import { useDeployedStatuses, useChannelGroups, useChannelTags } from '../queries.js';
import { RailPane, TaskButton } from '../ui.jsx';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { statsOf } from './dashboard.jsx';
import { runLifecycle } from './channel-lifecycle.js';

const CARD_MIN = 280;   // min card width (px) for the responsive grid
const EMPTY_LIST: any[] = [];  // stable fallback while queries load (memo-dep friendly)
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

function tagRgb(tag: any, alpha: any) {
    const c = tag && tag.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined) {
        return alpha !== undefined ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${alpha})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
    }
    return 'var(--bg2)';
}
const fmt = (n: any) => (Number(n) || 0).toLocaleString();

/* ---- summary stat card ---- */

function StatCard({ label, value, color, active, onClick, small }: any) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick}
            className={`panel !mt-0 text-left px-3.5 py-2.5 flex flex-col gap-0.5 min-w-[108px] ${onClick ? 'cursor-pointer hover:border-accent' : 'cursor-default'} ${active ? 'border-accent bg-[var(--accent-glow)]' : ''}`}>
            <span className={`${small ? 'text-lg' : 'text-2xl'} font-semibold tabular-nums`} style={{ color: color || 'var(--text)' }}>{value}</span>
            <span className="text-[10px] uppercase tracking-wide text-text-faint">{label}</span>
        </button>
    );
}

/* ---- channel card ---- */

function ChannelCard({ status, tags, selected, onSelect, onOpen, onMenu, lifetime }: any) {
    const s = statsOf(status, lifetime);
    // Manual double-click detection: a plain onClick + onDoubleClick pair races with
    // the selection re-render, so track the timestamp and open on a quick second click.
    const lastClick = useRef(0);
    const handleClick = (e: any) => {
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
            onClick={handleClick} onContextMenu={(e: any) => onMenu(status, e)}>
            <div className="px-3 pt-2.5 flex items-start gap-2">
                <span className={`pip ${statePip(status.state)} mt-1.5 flex-none`} />
                <div className="min-w-0 flex-1">
                    <div className="font-medium truncate" title={status.name}>{status.name}</div>
                    <div className="text-[10px] text-text-faint">{stateLabel(status.state)}</div>
                </div>
            </div>
            <div className="px-3 h-[16px] overflow-hidden flex gap-1">
                {tags.map((t: any, i: any) => <span key={i} className="tag !py-0 !text-[9px]" style={{ background: tagRgb(t, 0.26) }}>{t.name}</span>)}
            </div>
            <div className="grid grid-cols-4 border-t border-line divide-x divide-line text-center">
                {[['Received', s.RECEIVED, ''], ['Sent', s.SENT, ''], ['Queued', s.QUEUED, s.QUEUED ? 'text-warn' : ''], ['Errored', s.ERROR, s.ERROR ? 'text-err' : '']].map(([label, val, cls]) => (
                    <div key={label} className="py-1.5">
                        <div className={`text-[11.5px] font-semibold tabular-nums ${cls}`}>{fmt(val)}</div>
                        <div className="text-[9px] text-text-faint uppercase tracking-wide">{label}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ---- virtualized grid (ungrouped) ---- */

function VirtualGrid({ items, tagsFor, selectedSet, onSelect, onOpen, onMenu, onClear, lifetime }: any) {
    const ref = useRef<any>(null);
    const [vp, setVp] = useState<any>({ cols: 1, scrollTop: 0, height: 600, width: 800 });
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
                    {visible.map((st: any) => <ChannelCard key={st.channelId} status={st} tags={tagsFor(st.channelId)} selected={selectedSet.has(st.channelId)} onSelect={onSelect} onOpen={onOpen} onMenu={onMenu} lifetime={lifetime} />)}
                </div>
            </div>
        </div>
    );
}

/* ---- view ---- */

function CardsView({ onToggleView }: any) {
    const [live, setLive] = useState(true);
    // Server state via TanStack Query — deployed statuses poll on the dashboard
    // interval (paused when `live` is off); groups/tags load once. `statuses`
    // stays null until the first load so the loading state still renders.
    const statusesQuery = useDeployedStatuses(live);
    const statuses = statusesQuery.data ?? null;
    const groups = useChannelGroups().data ?? EMPTY_LIST;
    const tags = useChannelTags().data ?? EMPTY_LIST;
    const refresh = () => statusesQuery.refetch();
    const [query, setQuery] = useState('');
    const [groupBy, setGroupByState] = useState(() => {
        const g = getPref('cardsGroupBy');
        return ['none', 'group', 'tag', 'state'].includes(g) ? g : 'none';
    });
    const setGroupBy = (g: any) => { setGroupByState(g); setPrefs({ cardsGroupBy: g }); };
    const [stateFilter, setStateFilter] = useState<any>(null);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [sectionLimits, setSectionLimits] = useState({} as any);   // grouped view: sectionKey → cards shown
    const [selected, setSelected] = useState(() => new Set());   // selected channelIds (multi-select)
    // Current (since deploy/reset) vs. Lifetime statistics — mirrors the classic
    // dashboard's toggle; remembered like the group-by choice.
    const [lifetime, setLifetimeState] = useState(() => getPref('cardsLifetime') === true);
    const setLifetime = (v: any) => { setLifetimeState(v); setPrefs({ cardsLifetime: v }); };

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
    const tagsFor = (id: any) => tagsByChannel.get(id) || [];

    const all = useMemo(() => statuses || [], [statuses]);
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return all.filter((s: any) => {
            if (stateFilter && s.state !== stateFilter) return false;
            if (!q) return true;
            if (String(s.name || '').toLowerCase().includes(q)) return true;
            return tagsFor(s.channelId).some((t: any) => String(t.name || '').toLowerCase().includes(q));
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [all, query, stateFilter, tagsByChannel]);

    // aggregates (across ALL, not filtered — the summary reflects the whole engine)
    const agg = useMemo(() => {
        const states: any = {}; const totals = { RECEIVED: 0, SENT: 0, QUEUED: 0, ERROR: 0 };
        let withErrors = 0;
        for (const s of all) {
            states[s.state!] = (states[s.state!] || 0) + 1;
            const st = statsOf(s, lifetime);
            totals.RECEIVED += st.RECEIVED; totals.SENT += st.SENT; totals.QUEUED += st.QUEUED; totals.ERROR += st.ERROR;
            if (st.ERROR > 0) withErrors += 1;
        }
        return { states, totals, withErrors };
    }, [all, lifetime]);

    /* ---- selection + actions ---- */
    const selectCard = (status: any, e: any) => {
        const id = status.channelId;
        setSelected((cur: any) => {
            if (e.metaKey || e.ctrlKey) { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; }
            if (cur.size === 1 && cur.has(id)) return new Set();   // click the sole selection again to deselect
            return new Set([id]);
        });
    };
    const clearSelection = () => setSelected(new Set());
    const openMessages = (status: any) => router.navigate(`/messages/${status.channelId}`);

    async function bulkControl(kind: any, targets: any) {
        const ids = targets.map((s: any) => s.channelId);
        if (!ids.length) return;
        if (kind === 'halt' && !await confirmDialog('Halt channels', 'Halting forcibly kills processing threads. Halt the selected channels?', { danger: true, okLabel: 'Halt' })) return;
        try {
            if (await runLifecycle(kind, ids)) refresh();
        } catch (e: any) { toast(e && e.message ? e.message : 'Action failed', 'error'); refresh(); }
    }
    async function clearStats(targets: any) {
        if (!targets.length) return;
        if (!await confirmDialog('Clear Statistics', `Clear statistics for ${targets.length} channel${targets.length > 1 ? 's' : ''}?`)) return;
        try { await api.statistics.clear(Object.fromEntries(targets.map((s: any) => [s.channelId, null]))); refresh(); }
        catch (e: any) { toast(e && e.message ? e.message : 'Clear statistics failed', 'error'); }
    }

    // Right-click a card → the same gated actions as the Dashboard Tasks rail.
    // If the card isn't part of the current selection, right-clicking selects just it.
    const openMenu = (status: any, e: any) => {
        e.preventDefault();
        let targets: any;
        if (selected.has(status.channelId)) targets = all.filter((s: any) => selected.has(s.channelId));
        else { setSelected(new Set([status.channelId])); targets = [status]; }
        const has = (pred: any) => targets.some((s: any) => pred(s.state));
        const items: any[] = [
            { header: true, label: targets.length > 1 ? `${targets.length} channels selected` : status.name },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => openMessages(targets[0]) },
            { label: 'Clear Statistics', icon: 'clear', task: 'doClearStats', onClick: () => clearStats(targets) },
            '-'
        ];
        if (has((st: any) => st === 'STOPPED' || st === 'PAUSED')) items.push({ label: 'Start', icon: 'play', task: 'doStart', onClick: () => bulkControl('start', targets.filter((s: any) => ['STOPPED', 'PAUSED'].includes(s.state))) });
        if (has((st: any) => st === 'STARTED')) items.push({ label: 'Pause', icon: 'pause', task: 'doPause', onClick: () => bulkControl('pause', targets.filter((s: any) => s.state === 'STARTED')) });
        if (has((st: any) => st === 'STARTED' || st === 'PAUSED')) items.push({ label: 'Stop', icon: 'stop', danger: true, task: 'doStop', onClick: () => bulkControl('stop', targets.filter((s: any) => ['STARTED', 'PAUSED'].includes(s.state))) });
        if (targets.length === 1 && !['STARTED', 'STOPPED', 'PAUSED', 'UNDEPLOYED'].includes(targets[0].state)) items.push({ label: 'Halt', icon: 'halt', danger: true, task: 'doHalt', onClick: () => bulkControl('halt', targets) });
        if (has((st: any) => st !== 'UNDEPLOYED')) items.push({ label: 'Undeploy Channel', icon: 'undeploy', task: 'doUndeployChannel', onClick: () => bulkControl('undeploy', targets.filter((s: any) => s.state !== 'UNDEPLOYED')) });
        contextMenu(e.clientX, e.clientY, items as any, 'dashboard');
    };

    /* ---- grouping ---- */
    const sections = useMemo(() => {
        if (groupBy === 'none') return null;
        const byId = new Map(filtered.map((s: any) => [s.channelId, s]));
        const out: any[] = [];
        if (groupBy === 'group') {
            const used = new Set();
            for (const g of groups) {
                const members = api.asList(g.channels, 'channel').map((c: any) => byId.get(c.id)).filter(Boolean);
                members.forEach((m: any) => used.add(m.channelId));
                if (members.length) out.push({ key: g.id, label: g.name, members });
            }
            const rest = filtered.filter((s: any) => !used.has(s.channelId));
            if (rest.length) out.unshift({ key: '__default__', label: 'Default Group', members: rest });
        } else if (groupBy === 'tag') {
            const seen = new Set();
            for (const tag of tags) {
                const members = filtered.filter((s: any) => tagsFor(s.channelId).some((t: any) => t.name === tag.name));
                members.forEach((m: any) => seen.add(m.channelId));
                if (members.length) out.push({ key: `tag:${tag.name}`, label: tag.name, members });
            }
            const untagged = filtered.filter((s: any) => !seen.has(s.channelId));
            if (untagged.length) out.push({ key: '__untagged__', label: 'Untagged', members: untagged });
        } else if (groupBy === 'state') {
            const order = [...STATE_ORDER, ...Object.keys(agg.states).filter((s: any) => !STATE_ORDER.includes(s))];
            for (const state of order) {
                const members = filtered.filter((s: any) => s.state === state);
                if (members.length) out.push({ key: `state:${state}`, label: stateLabel(state), members });
            }
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupBy, filtered, groups, tags, tagsByChannel]);

    const toggleState = (s: any) => setStateFilter((cur: any) => (cur === s ? null : s));

    // Selection-gated tasks, mirroring the classic Dashboard Tasks pane.
    const sel = all.filter((s: any) => selected.has(s.channelId));
    const hasSel = sel.length > 0;
    const anySel = (pred: any) => sel.some((s: any) => pred(s.state));
    const showStart = anySel((st: any) => st === 'STOPPED' || st === 'PAUSED');
    const showPause = anySel((st: any) => st === 'STARTED');
    const showStop = anySel((st: any) => st === 'STARTED' || st === 'PAUSED');
    const showHalt = sel.length === 1 && !['STARTED', 'STOPPED', 'PAUSED', 'UNDEPLOYED'].includes(sel[0].state!);
    const showUndeploy = anySel((st: any) => st !== 'UNDEPLOYED');

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Dashboard Tasks" paneKey="tasks:Dashboard Tasks" group="dashboard">
                    <div className="taskbar" data-pane-title="Dashboard Tasks">
                        {onToggleView && <TaskButton label="Table view" icon="menu" onClick={onToggleView} />}
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshStatuses" onClick={refresh} />
                        {hasSel && <TaskButton label={sel.length > 1 ? `View Messages (${sel.length})` : 'View Messages'} icon="messages" task="doShowMessages" onClick={() => openMessages(sel[0])} />}
                        {hasSel && <TaskButton label="Clear Statistics" icon="clear" task="doClearStats" onClick={() => clearStats(sel)} />}
                        {showStart && <TaskButton label="Start" icon="play" task="doStart" onClick={() => bulkControl('start', sel.filter((s: any) => ['STOPPED', 'PAUSED'].includes(s.state)))} />}
                        {showPause && <TaskButton label="Pause" icon="pause" task="doPause" onClick={() => bulkControl('pause', sel.filter((s: any) => s.state === 'STARTED'))} />}
                        {showStop && <TaskButton label="Stop" icon="stop" danger task="doStop" onClick={() => bulkControl('stop', sel.filter((s: any) => ['STARTED', 'PAUSED'].includes(s.state)))} />}
                        {showHalt && <TaskButton label="Halt" icon="halt" danger task="doHalt" onClick={() => bulkControl('halt', sel)} />}
                        {showUndeploy && <TaskButton label="Undeploy Channel" icon="undeploy" task="doUndeployChannel" onClick={() => bulkControl('undeploy', sel.filter((s: any) => s.state !== 'UNDEPLOYED'))} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {/* Summary. No divider rule: these are cards on the dotted ground, and a
                full-bleed border-b drew a hairline straight across it. */}
            <div className="flex flex-wrap gap-2.5 px-[13px] pt-3 pb-2">
                <StatCard label="Channels" value={fmt(all.length)} />
                {STATE_ORDER.map((s: any) => ((agg.states as any)[s] ? (
                    <StatCard key={s} label={(STATE_META as any)[s].label} value={fmt((agg.states as any)[s])} color={(STATE_META as any)[s].color}
                        active={stateFilter === s} onClick={() => toggleState(s)} small />
                ) : null))}
                <div className="flex-1 min-w-[7px]" />
                <StatCard label="Received" value={fmt(agg.totals.RECEIVED)} small />
                <StatCard label="Sent" value={fmt(agg.totals.SENT)} small />
                <StatCard label="Queued" value={fmt(agg.totals.QUEUED)} color={agg.totals.QUEUED ? 'var(--warn)' : undefined} small />
                <StatCard label="Errored" value={fmt(agg.totals.ERROR)} color={agg.totals.ERROR ? 'var(--err)' : undefined} small />
            </div>

            {/* Controls — two groups: filters (left) and display controls (right).
                They sit on one line (spread apart) when there's room; when the row is
                too narrow the display cluster drops to a left-aligned second line. */}
            <div className="panel flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5 mx-[13px] mb-3 overflow-visible">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-faint"><Icon name="search" size={14} /></span>
                        <input type="text" className="w-[198px] max-w-full !pl-7" placeholder="Filter channels & tags…" value={query} onChange={(e: any) => setQuery(e.target.value)} />
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-text-dim whitespace-nowrap">Group by
                        <select value={groupBy} onChange={(e: any) => setGroupBy(e.target.value)}>
                            <option value="none">None</option>
                            <option value="group">Channel group</option>
                            <option value="tag">Tag</option>
                            <option value="state">State</option>
                        </select>
                    </label>
                    {stateFilter && <button className="btn btn-sm btn-ghost" onClick={() => setStateFilter(null)}><Icon name="x" size={12} />{(STATE_META as any)[stateFilter] ? (STATE_META as any)[stateFilter].label : stateFilter}</button>}
                </div>
                <div className="flex items-center gap-2">
                    {/* Current vs. Lifetime statistics */}
                    {/* Radix RadioGroup, same as the dashboard's SegPill. */}
                    <RadioGroup.Root value={lifetime ? 'lifetime' : 'current'}
                        aria-label="Statistics range" orientation="horizontal"
                        onValueChange={(v: any) => { if (v) setLifetime(v === 'lifetime'); }}
                        className="segpill flex-none">
                        {[['Current', 'current'], ['Lifetime', 'lifetime']].map(([label, val]) => (
                            <RadioGroup.Item key={val} value={val}
                                className={(lifetime ? 'lifetime' : 'current') === val ? 'on' : ''}>
                                {label}
                            </RadioGroup.Item>
                        ))}
                    </RadioGroup.Root>
                    <button className={`btn btn-ghost btn-sm ${live ? 'text-accent' : ''}`} onClick={() => setLive((v: any) => !v)} title="Toggle auto-refresh">
                        <span className={`pip ${live ? 'ok' : ''} mr-1`} />{live ? 'Live' : 'Paused'}
                    </button>
                    <span className="text-[11px] text-text-faint whitespace-nowrap">{filtered.length} of {all.length}</span>
                </div>
            </div>

            {/* Body */}
            {statuses === null ? (
                <div className="view-body"><div className="dt-empty">Loading channels…</div></div>
            ) : filtered.length === 0 ? (
                <div className="view-body"><div className="dt-empty"><div className="empty-icon"><Icon name="dashboard" size={30} /></div>No channels match.</div></div>
            ) : sections ? (
                <div className="view-body" onClick={clearSelection}>
                    {sections.map((sec: any) => {
                        const open = !collapsed.has(sec.key);
                        // Grouped mode isn't virtualized, so cap how many cards a section
                        // renders (bounds the DOM on big servers); "show more" reveals more.
                        const limit = sectionLimits[sec.key] || SECTION_CAP;
                        const shown = sec.members.slice(0, limit);
                        const more = sec.members.length - shown.length;
                        return (
                            <div key={sec.key} className="mb-4">
                                <div role="button" className="flex items-center gap-2 w-full py-1.5 border-b border-line mb-2 cursor-pointer hover:text-accent select-none"
                                    onClick={(e: any) => { e.stopPropagation(); setCollapsed((c: any) => { const n = new Set(c); if (n.has(sec.key)) n.delete(sec.key); else n.add(sec.key); return n; }); }}>
                                    <Icon name={open ? 'chevD' : 'chevR'} size={14} />
                                    <span className="font-semibold">{sec.label}</span>
                                    <span className="text-text-faint text-[11px]">{sec.members.length}</span>
                                </div>
                                {open && (
                                    <>
                                        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN}px, 1fr))` }}>
                                            {shown.map((st: any) => <div key={st.channelId} style={{ height: CARD_H }}><ChannelCard status={st} tags={tagsFor(st.channelId)} selected={selected.has(st.channelId)} onSelect={selectCard} onOpen={openMessages} onMenu={openMenu} lifetime={lifetime} /></div>)}
                                        </div>
                                        {more > 0 && (
                                            <button type="button" className="btn btn-sm btn-ghost mt-2"
                                                onClick={(e: any) => { e.stopPropagation(); setSectionLimits((l: any) => ({ ...l, [sec.key]: (l[sec.key] || SECTION_CAP) + SECTION_CAP })); }}>
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
