/*
 * Dashboard — live channel status board with the classic Administrator layout,
 * fully declarative React. Server state (statuses, groups, tags, connector
 * metadata) comes from TanStack Query hooks (react/queries.js) polling on the
 * dashboardRefreshSeconds preference; UI state (selection, expand/collapse,
 * filter, sort, display toggles) is React state. The status board is the
 * controlled <TreeTable> (column resize/reorder/hide + persistence); the filter
 * bar is <DashFilterBar> below (chips + typeahead + segmented display toggles).
 *
 * Menu/task actions take EXPLICIT channel-id lists (computed where the action
 * is offered) rather than reading selection state, so a context menu built
 * before a selection change can never act on a stale closure.
 * 'dashboard:selection' is re-emitted via store.emit on every user selection
 * change (polls prune a dead selection silently, matching the classic board).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { h, toast, confirmDialog, modal, checkbox, contextMenu, fmtNumber, fmtDate } from '@oie/web-ui';
import api, { statePip, stateLabel } from '@oie/web-api';
import { platform } from '@oie/web-shell';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { ViewTasks } from '../mount.jsx';
import { useDashboardStatuses, useChannelGroups, useChannelTags, useConnectorTypes, useSourcePorts } from '../queries.js';
import { RailPane, TaskButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { TreeTable } from '../tree-table.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { iconPath } from '../../core/icons.js';
import * as Tabs from '@radix-ui/react-tabs';   // shadcn/Radix dock tabs
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Popover from '@radix-ui/react-popover';
import { CardsView } from './cards.jsx';
import { openRemoveAllMessagesDialog } from '../remove-all-messages.js';
import { withDependencies } from './channel-lifecycle.js';

// Loaded on demand. This dialog is the dashboard's ONLY use of the message
// browser, and importing it statically drags that whole view — the largest in the
// app — into whatever chunk the dashboard lands in. It is already async, so the
// call sites are unchanged.
async function openSendMessageDialog(platform: any, channelId: any, onSent: any) {
    const messages = await import('./messages.jsx');
    return messages.openSendMessageDialog(platform, channelId, onSent);
}


/* The Dashboard is two interchangeable looks at the same channel-status data:
   the classic Swing-style table (DashboardView) and the modern card grid
   (CardsView) — alternates, like the classic vs. guided channel editor. One
   nav item; the remembered `dashboardView` preference picks which renders, and
   each view's rail has a toggle (persisted) to switch. */
export function DashboardHost() {
    const [view, setView] = useState(() => (getPref('dashboardView') === 'cards' ? 'cards' : 'classic'));
    const toggle = () => setView((v: any) => {
        const next = v === 'cards' ? 'classic' : 'cards';
        setPrefs({ dashboardView: next });
        return next;
    });
    return view === 'cards'
        ? <CardsView onToggleView={toggle} />
        : <DashboardView onToggleView={toggle} />;
}

// Stable empty fallbacks while the queries load (stable identities keep the
// effects that depend on `statuses` from re-running on every render).
const EMPTY_MAP = new Map();
const EMPTY_LIST: any[] = [];

// Default widths for the dashboard's resizable data columns (after the twisty).
const DASH_COL_WIDTHS = {
    state: 110, name: 240, type: 110, port: 80, rev: 70, deployed: 150,
    received: 90, filtered: 90, queued: 90, sent: 90, errored: 90
};

/* DashboardStatus statistics arrive as an XStream map:
   {"entry":[{"com.mirth...Status":"RECEIVED","long":42}, ...]} */
export function statsOf(status: any, lifetime = false) {
    const out = { RECEIVED: 0, FILTERED: 0, TRANSFORMED: 0, SENT: 0, ERROR: 0, QUEUED: 0 };
    const source = lifetime ? status?.lifetimeStatistics : status?.statistics;
    const entries = source?.entry;
    if (entries) {
        for (const entry of Array.isArray(entries) ? entries : [entries]) {
            let key = null, value = null;
            for (const v of Object.values(entry)) {
                if (typeof v === 'string' && (out as any)[v] !== undefined) key = v;
                else if (typeof v === 'number') value = v;
            }
            if (key && value !== null) (out as any)[key] = value;
        }
    }
    if (status?.queued !== undefined && status.queued !== null) out.QUEUED = Number(status.queued) || out.QUEUED;
    return out;
}

/* Engine-wide totals summed from the deployed channel statuses — the same
   per-channel numbers the table shows, aggregated (no new data source). Honors
   the Current/Lifetime toggle. queuedChannels = channels with a live queue. */
export function engineTotals(statuses: any, lifetime = false) {
    const t = { RECEIVED: 0, FILTERED: 0, QUEUED: 0, SENT: 0, ERROR: 0, queuedChannels: 0 };
    for (const st of statuses || []) {
        const s = statsOf(st, lifetime);
        t.RECEIVED += s.RECEIVED; t.FILTERED += s.FILTERED; t.QUEUED += s.QUEUED;
        t.SENT += s.SENT; t.ERROR += s.ERROR;
        if (s.QUEUED > 0) t.queuedChannels++;
    }
    return t;
}

function childrenOf(status: any) {
    const kids = status?.childStatuses?.dashboardStatus ?? status?.childStatuses;
    if (!kids) return [];
    return Array.isArray(kids) ? kids : [kids];
}

/* ---- bulk lifecycle + channel dependencies -------------------------------- */

/* A lifecycle action applied to a SET of channels in ONE request. The bulk
   endpoints exist so the engine can dependency-order the set before it acts
   (ChannelController sorts by the server's dependency graph); a per-channel
   loop hands it one id at a time, so nothing can ever be ordered — which is
   exactly the bug that made a start of A+B fail when B needed A up first.
   A lone channel still goes to its own addressable endpoint: there is no set to
   order, and the per-channel resource is what reports that channel's failure. */
const LIFECYCLE_MANY: any = {
    start: 'startMany', stop: 'stopMany', halt: 'haltMany', pause: 'pauseMany', resume: 'resumeMany'
};
export function submitLifecycle(action: any, ids: any) {
    return ids.length === 1
        ? (api.status as any)[action](ids[0])
        : (api.status as any)[LIFECYCLE_MANY[action]](ids);
}

function lsGet(key: any, fallback: any) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function lsSet(key: any, value: any) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

/* "Just deployed" highlight: a one-time, session-scoped cue. A deploy is
   highlighted only until you leave the dashboard — navigating away marks it
   seen so returning won't re-show it (matches the old Swing client). Keyed by
   channel + deploy timestamp so a *new* deploy highlights again. */
const JUST_DEPLOYED_MS = 15000;
const seenDeploys = new Set();
const deployKey = (st: any) => `${st.channelId}|${st.deployedDate?.time ?? ''}`;
function isJustDeployed(st: any) {
    const ms = Number(st.deployedDate?.time);
    return !!ms && (Date.now() - ms) >= 0 && (Date.now() - ms) < JUST_DEPLOYED_MS && !seenDeploys.has(deployKey(st));
}

/* ChannelTag backgroundColor arrives as {red, green, blue, alpha}. */
function tagRgb(tag: any, alpha?: any) {
    const c = tag?.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined && c.green !== undefined && c.blue !== undefined) {
        return alpha !== undefined ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${alpha})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
    }
    return null;
}

/* Per-tag color applied like the .tag.<color> variants (tint fill, colored
   border), with text mixed toward the theme foreground so arbitrary/pale tag
   colors stay readable in both themes. */
function tagPillStyle(tag: any) {
    const c = tagRgb(tag);
    if (!c) return undefined;
    return {
        background: `color-mix(in srgb, ${c} 26%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
        color: `color-mix(in srgb, ${c} 72%, var(--text))`
    };
}

// Type + Port are web-only columns Swing's dashboard doesn't have, so they
// start hidden (reachable via the <TreeTable> column menu) — matching Swing's
// default set. <TreeTable> owns the column manager (widths/order/hidden via
// the 'dashboard' storageKey) so the show/hide menu + persistence are reused.
const DASH_DEFAULT_HIDDEN = ['type', 'port'];

/* Segmented toggle — the single app-wide toggle style (.segpill: shadcn pill,
   same language as the tabs). Used for Tags / Stats / View / Current-Lifetime. */
/* Single-choice display toggles (View / Tags / Stats / Range) — Radix RadioGroup.
   RadioGroup rather than ToggleGroup deliberately: these are a mutually exclusive
   choice, one always selected, and the ARIA radiogroup pattern says an arrow key
   moves the selection. ToggleGroup only moves FOCUS on arrow and waits for Space,
   which would have quietly changed how these toggles behave. */
function SegPill({ options, value, onChange, label }: any) {
    return (
        <RadioGroup.Root value={value} aria-label={label} orientation="horizontal"
            onValueChange={(v: any) => { if (v) onChange(v); }}
            className="segpill flex-none">
            {options.map((opt: any) => (
                <RadioGroup.Item key={opt.value} value={opt.value}
                    title={opt.title || opt.label || ''}
                    aria-label={opt.label ? undefined : (opt.title || undefined)}
                    className={opt.value === value ? 'on' : ''}>
                    {opt.icon ? <Icon name={opt.icon} size={13} /> : null}
                    {opt.label || null}
                </RadioGroup.Item>
            ))}
        </RadioGroup.Root>
    );
}

/* The dashboard filter bar: chips + typeahead filter input + counts label, the
   "View" collapse button (container query on .filterbar hides the inline
   controls at narrow widths; the button opens them as a popover), and the
   View / Tags / Stats / Range segmented toggles. The typeahead dropdown is
   position:fixed and portaled to document.body so the (container-type) filter
   bar never becomes its containing block. */
const TYPEAHEAD_MAX = 12;
/* Filter-bar content width below which the display controls fold into the View
   popover.

   Measured, not estimated: the controls now occupy ~870px, so at the old 880 they
   went inline the moment there was technically room and squeezed the filter input
   to 41px — it did not recover its full 340px until ~1250. (The old figure of
   ~607px predates the segmented toggles, the chip host and the counts.) The
   threshold is the point where the filter still gets the ~240px the bar was
   designed around; below it, folded-and-usable beats inline-and-crushed. */
const CONTROLS_INLINE_MIN = 1120;

function DashFilterBar({
    statuses, tags, countsText,
    filterText, onFilterText, chips, onChips,
    viewMode, onViewMode, tagMode, onTagMode,
    showStats, onShowStats, lifetime, onLifetime
}: any) {
    const [taOpen, setTaOpen] = useState(false);
    const [taIndex, setTaIndex] = useState(-1);
    const inputRef = useRef<any>(null);
    const taRef = useRef<any>(null);
    const barRef = useRef<any>(null);

    /* Where the display controls live: inline in the bar, or behind the View
       button as a popover. This used to be a container query, but a Radix popover
       is positioned by Radix and portaled — it cannot also be an inline flex child
       — so the same threshold is measured here and the controls are rendered in
       one place or the other. The other .filterbar container queries are unaffected. */
    const [narrow, setNarrow] = useState(false);
    useLayoutEffect(() => {
        const el = barRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width <= CONTROLS_INLINE_MIN));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /* Substring matches across channel names + tag names (already-picked chips
       excluded). Derived from live props, so a poll landing while the dropdown
       is open refreshes the suggestions in place — same as the classic bar. */
    const taItems = useMemo(() => {
        if (!taOpen) return [];
        const needle = filterText.trim().toLowerCase();
        const seen = new Set();
        const out: any[] = [];
        const add = (name: any, kind: any) => {
            const key = kind + ':' + name.toLowerCase();
            if (chips.some((c: any) => c.kind === kind && c.value === name)) return;   // already picked
            if (name.toLowerCase().includes(needle) && !seen.has(key)) { seen.add(key); out.push({ value: name, kind }); }
        };
        for (const st of statuses) if (st.name) add(String(st.name), 'channel');
        for (const tag of tags) if (tag.name) add(String(tag.name), 'tag');
        out.sort((a: any, b: any) => a.value.localeCompare(b.value));
        return out.slice(0, TYPEAHEAD_MAX);
    }, [taOpen, filterText, chips, statuses, tags]);

    // Anchor under the filter input; flip above when the viewport runs out.
    // Measurement-dependent, so it writes styles after layout.
    useLayoutEffect(() => {
        const ta = taRef.current, input = inputRef.current;
        if (!taOpen || !taItems.length || !ta || !input) return;
        const r = input.getBoundingClientRect();
        ta.style.minWidth = r.width + 'px';
        ta.style.left = Math.max(4, Math.min(r.left, window.innerWidth - ta.offsetWidth - 4)) + 'px';
        ta.style.top = (r.bottom + 2) + 'px';
        ta.style.bottom = 'auto';
        if (ta.getBoundingClientRect().bottom > window.innerHeight - 4) {
            ta.style.top = 'auto';
            ta.style.bottom = (window.innerHeight - r.top + 2) + 'px';
        }
    }, [taOpen, taItems]);

    useEffect(() => {
        if (taIndex >= 0 && taRef.current?.children[taIndex]) {
            taRef.current.children[taIndex].scrollIntoView({ block: 'nearest' });
        }
    }, [taIndex]);

    const closeTypeahead = () => { setTaOpen(false); setTaIndex(-1); };

    const pickSuggestion = (item: any) => {
        // Add an explicit pill (deduped); clear the text so more can be added.
        if (!chips.some((c: any) => c.kind === item.kind && c.value === item.value)) {
            onChips([...chips, { value: item.value, kind: item.kind }]);
        }
        onFilterText('');
        closeTypeahead();
        inputRef.current?.focus();
    };

    const removeChip = (chip: any) => {
        onChips(chips.filter((c: any) => c !== chip));
        inputRef.current?.focus();
    };

    const onKeyDown = (e: any) => {
        const open = taOpen && taItems.length > 0;
        if (e.key === 'Backspace' && !filterText && chips.length) {
            // Backspace on an empty input removes the last pill.
            e.preventDefault();
            removeChip(chips[chips.length - 1]);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) { setTaOpen(true); return; }
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setTaIndex((i: any) => (i + delta + taItems.length) % taItems.length);
        } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            pickSuggestion(taItems[taIndex >= 0 ? taIndex : 0]);
        } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            closeTypeahead();
        }
    };

    /* Defined once and mounted in whichever place `narrow` calls for — the popover
       and the inline bar are two homes for the same controls, not two copies. */
    const controls = (
        <>
            <SegPill value={viewMode} onChange={onViewMode} label="Row grouping" options={[
                { value: 'group', icon: 'folder', title: 'Group view' },
                { value: 'channel', icon: 'channels', title: 'Channel view' }
            ]} />
            <span className="inline-flex items-center gap-[4px]">
                <span className="text-text-faint text-[10px]">Tags:</span>
                <SegPill value={tagMode} onChange={onTagMode} label="Tag display" options={[
                    { value: 'names', label: 'Names', title: 'Show tags as names' },
                    { value: 'icons', label: 'Icons', title: 'Show tags as icons' },
                    { value: 'off', label: 'Off', title: 'Hide tags' }
                ]} />
            </span>
            <span className="inline-flex items-center gap-[4px]">
                <span className="text-text-faint text-[10px]">Stats:</span>
                <SegPill value={showStats ? 'on' : 'off'} onChange={(v: any) => onShowStats(v === 'on')} label="Statistics strip" options={[
                    { value: 'on', label: 'On', title: 'Show stat cards' },
                    { value: 'off', label: 'Off', title: 'Hide stat cards' }
                ]} />
            </span>
            <span className="inline-flex items-center gap-[4px]">
                <span className="text-text-faint text-[10px]">Range:</span>
                <SegPill value={lifetime ? 'lifetime' : 'current'} onChange={(v: any) => onLifetime(v === 'lifetime')} label="Statistics range" options={[
                    { value: 'current', label: 'Current' },
                    { value: 'lifetime', label: 'Lifetime' }
                ]} />
            </span>
        </>
    );

    return (
        <div className="filterbar" ref={barRef}>
            <span className="flex items-center gap-2.5 flex-1 min-w-[198px]">
                <label>Filter:</label>
                {chips.length > 0 && (
                    <span className="filter-chip-host gap-1 flex-wrap" style={{ display: 'inline-flex' }}>
                        {chips.map((chip: any) => {
                            const isTag = chip.kind === 'tag';
                            const tag = isTag ? tags.find((t: any) => String(t.name) === chip.value) : null;
                            return (
                                <span key={chip.kind + ':' + chip.value}
                                    className="tag inline-flex items-center gap-1 py-px pr-1 pl-[6px]"
                                    style={{ background: isTag ? (tagRgb(tag, 0.25) || 'var(--bg3)') : 'var(--bg3)' }}>
                                    <Icon name={isTag ? 'tag' : 'server'} size={12} />
                                    <span>{chip.value}</span>
                                    <button title="Remove"
                                        className="appearance-none border-none cursor-pointer text-inherit text-[12.5px] leading-none py-0 px-px"
                                        style={{ background: 'none', fontFamily: 'inherit' }}
                                        onClick={() => removeChip(chip)}>×</button>
                                </span>
                            );
                        })}
                    </span>
                )}
                {/* combobox over the suggestion list: the arrow-key cursor was
                    visual only, so a screen reader never heard the active item. */}
                <input ref={inputRef} type="text" placeholder="Enter channel tag or name" autoComplete="off"
                    className="flex-1 min-w-0" value={filterText}
                    role="combobox"
                    aria-expanded={String(taOpen && taItems.length > 0) as any}
                    aria-controls="dash-typeahead"
                    aria-autocomplete="list"
                    aria-activedescendant={taOpen && taIndex >= 0 && taItems[taIndex]
                        ? `dash-ta-${taIndex}` : undefined}
                    onChange={(e: any) => { onFilterText(e.target.value); setTaOpen(true); setTaIndex(-1); }}
                    onFocus={() => setTaOpen(true)}
                    onBlur={() => setTimeout(closeTypeahead, 150)}    // small delay so clicks on the dropdown land
                    onKeyDown={onKeyDown} />
                <span className="whitespace-nowrap"><span className="counts">{countsText}</span></span>
            </span>
            {/* Radix owns the trigger's aria-haspopup/aria-expanded, Escape,
                outside-click and focus return — all of which this bar used to
                carry by hand. */}
            {narrow ? (
                <Popover.Root>
                    <Popover.Trigger asChild>
                        <button type="button" className="btn dash-options-btn">
                            <Icon name="eye" /><span>View</span><Icon name="chevD" />
                        </button>
                    </Popover.Trigger>
                    <Popover.Portal>
                        <Popover.Content className="dash-controls dash-controls-pop"
                            align="end" sideOffset={4} collisionPadding={8}>
                            {controls}
                        </Popover.Content>
                    </Popover.Portal>
                </Popover.Root>
            ) : (
                <div className="dash-controls flex items-center gap-x-3.5 gap-y-1.5 flex-wrap ml-auto">
                    {controls}
                </div>
            )}
            {createPortal(
                <div ref={taRef} id="dash-typeahead" role="listbox" aria-label="Filter suggestions"
                    className={'typeahead' + (taOpen && taItems.length ? '' : ' hidden')}>
                    {taItems.map((item: any, i: any) => (
                        <div key={item.kind + ':' + item.value}
                            id={`dash-ta-${i}`}
                            role="option"
                            aria-selected={String(i === taIndex) as any}
                            className={'typeahead-item' + (i === taIndex ? ' active' : '')}
                            onMouseDown={(e: any) => e.preventDefault()}   // keep input focus so blur doesn't race the click
                            onClick={() => pickSuggestion(item)}>
                            <Icon name={item.kind === 'tag' ? 'tag' : 'server'} size={14} />
                            <span className="typeahead-label">{item.value}</span>
                            <span className="typeahead-kind">{item.kind}</span>
                        </div>
                    ))}
                </div>,
                document.body)}
        </div>
    );
}


function DashboardView({ onToggleView }: any) {
    /* ---- server state (TanStack Query; polls on dashboardRefreshSeconds) ---- */
    const statusesQ = useDashboardStatuses();
    const groupsQ = useChannelGroups({ poll: true });
    const tagsQ = useChannelTags({ poll: true });
    const typesQ = useConnectorTypes();               // Type column, ~60s cadence
    const portsQ = useSourcePorts();                  // Port column, ~60s cadence

    const statuses = statusesQ.data ?? EMPTY_LIST;
    const groups = groupsQ.data ?? EMPTY_LIST;
    const tags = tagsQ.data ?? EMPTY_LIST;
    const connectorTypes = typesQ.data ?? EMPTY_MAP;  // channelId → Map(metaDataId → transportName)
    const sourcePorts = portsQ.data ?? EMPTY_MAP;     // channelId → source listener port string
    const loaded = statusesQ.data !== undefined;      // first status poll has landed

    /* ---- UI state ---- */
    const [selected, setSelected] = useState(() => new Set());          // channelIds
    const [selectedConnector, setSelectedConnector] = useState<any>(null);   // { channelId, metaDataId }
    const lastClickedRef = useRef<any>(null);              // anchor for shift-range selection (interaction-only)
    const [expandedChannels, setExpandedChannels] = useState(() => new Set());   // channels showing connector rows
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());     // groups default to expanded
    const [filterText, setFilterText] = useState('');
    const [chips, setChips] = useState([] as any[]);           // explicit picks: [{ value, kind: 'tag' | 'channel' }]
    const [lifetime, setLifetime] = useState(false);
    const [sort, setSort] = useState<any>({ key: 'name', dir: 1 });          // dir: 1 = asc, -1 = desc
    const [viewMode, setViewModeState] = useState(() => (lsGet('oie-dash-view', 'group') === 'channel' ? 'channel' : 'group'));
    const [tagMode, setTagModeState] = useState(() => {
        const saved = lsGet('oie-dash-tagmode', 'names');
        return ['names', 'icons', 'off'].includes(saved) ? saved : 'names';
    });
    const [showStats, setShowStatsState] = useState(() => lsGet('oie-dash-stats', 'on') !== 'off');   // KPI stat cards
    const [activeTabId, setActiveTabId] = useState<any>(null);               // plugin dock tab (id || label)

    const setViewMode = (v: any) => { setViewModeState(v); lsSet('oie-dash-view', v); };
    const setTagMode = (v: any) => { setTagModeState(v); lsSet('oie-dash-tagmode', v); };
    const setShowStats = (v: any) => { setShowStatsState(v); lsSet('oie-dash-stats', v ? 'on' : 'off'); };

    /* When a poll drops channels the selection referenced, prune silently — no
       'dashboard:selection' emit, matching the classic board (only USER actions
       announce a selection change). */
    useEffect(() => {
        const ids = new Set(statuses.map(s => s.channelId));
        setSelected(prev => {
            const next = new Set([...prev].filter(id => ids.has(id)));
            return next.size === prev.size ? prev : next;
        });
        setSelectedConnector((prev: any) => (prev && !ids.has(prev.channelId) ? null : prev));
    }, [statuses]);

    /* Selection handed to the dashboard tabs (Connection Log, …): the selected
       connector's scope, otherwise the selected channels. */
    const selectionForTabs = selectedConnector
        ? [{ channelId: selectedConnector.channelId, metaDataId: selectedConnector.metaDataId }]
        : statuses.filter(s => selected.has(s.channelId));

    /* The single choke point for USER selection changes: set both halves and
       re-emit for outside listeners (plugins). Rendering (task pane, tabs)
       follows from the state change itself. */
    function applySelection(nextSelected: any, nextConnector: any) {
        setSelected(nextSelected);
        setSelectedConnector(nextConnector);
        store.emit('dashboard:selection', nextConnector
            ? [{ channelId: nextConnector.channelId, metaDataId: nextConnector.metaDataId }]
            : statuses.filter(s => nextSelected.has(s.channelId)));
    }

    /* ---- channel control tasks (the "Dashboard Tasks" sidebar pane) ---- */

    // Halt applies only to transitional states; Undeploy is suppressed while a
    // channel is transitioning (except SYNCING) — matching the Swing dashboard.
    const isHaltable = (s: any) => !['STARTED', 'STOPPED', 'PAUSED'].includes(s);
    const isHaltableNonSyncing = (s: any) => isHaltable(s) && s !== 'SYNCING';

    // Channel name for the dependency prompt; a related channel that isn't
    // deployed has no status row, so fall back to its id rather than blank.
    const nameOf = (id: any) => String(statuses.find(s => s.channelId === id)?.name ?? id);

    /* Every action takes an EXPLICIT id list computed where it is offered (task
       pane closure or context-menu builder) — no reads of selection state from
       long-lived closures, so a menu can never act on a stale selection. */
    async function controlChannels(action: any, label: any, ids: any) {
        if (!ids.length) { toast('Select a channel first', 'warn'); return; }
        /* Start pulls in what the selection DEPENDS ON; stop pulls in what
           depends ON it. Halt and Pause do not prompt — Swing only offers the
           related channels for deploy/undeploy/start/stop, and a halt is an
           escape hatch that has no business widening its own blast radius. */
        const direction = action === 'start' ? 'dependencies' : action === 'stop' ? 'dependents' : null;
        const targets = direction ? await withDependencies(ids, direction, label, nameOf) : ids;
        if (!targets) return;                                  // dependency prompt cancelled

        /* "Start" on a PAUSED channel must resume it, not start it: PAUSED means
           the source is stopped while destinations run, and the engine's _start
           (Channel.start) only acts on a STOPPED/DEPLOYING channel — it's a no-op
           when PAUSED, so only _resume restarts the source. Matches Swing's
           Frame.doStart (PAUSED -> resumeChannels, else startChannels).

           A single bulk _start cannot express "start these, resume those", so the
           set is PARTITIONED by state and up to two bulk calls go out — still the
           set per call, which is what lets the engine dependency-order it. */
        const byId = new Map(statuses.map(s => [s.channelId, s]));
        const paused = new Set(action === 'start'
            ? targets.filter((id: any) => byId.get(id)?.state === 'PAUSED') : []);
        const batches = [
            [action, targets.filter((id: any) => !paused.has(id))],
            ['resume', [...paused]]
        ];
        for (const [act, batch] of batches) {
            if (!batch.length) continue;
            try { await submitLifecycle(act, batch); }
            catch (e: any) { toast(`${label} failed: ${e.message}`, 'error'); }
        }
        refresh();
    }

    /* Classic Clear Statistics dialog: pick which counters to reset. The body
       is the same {channelId: null} map (null metaDataId list = whole channel,
       verified in ChannelStatisticsServletInterface POST /_clearStatistics);
       received/filtered/sent/error become query params via
       api.statistics.clear. Queued is a live queue depth, not a counter, so
       it cannot be cleared. */
    function openClearStatisticsDialog(ids: any) {
        const received = checkbox('Received', true);
        const filtered = checkbox('Filtered', true);
        const sent = checkbox('Sent', true);
        const errored = checkbox('Errored', true);
        modal({
            title: 'Clear Statistics',
            body: h('div',
                h('div.mb-[13px]', `Clear the selected statistics for ${ids.length} channel(s)? This cannot be undone.`),
                h('div', { class: 'flex flex-col gap-1.5' },
                    received.el, filtered.el, sent.el, errored.el),
                h('div.hint.mt-[13px]', 'Queued statistics cannot be cleared.')),
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
                            await api.statistics.clear(Object.fromEntries(ids.map((id: any) => [id, null])), ...flags);
                            toast('Statistics cleared');
                        } catch (e: any) {
                            toast(`Clear statistics failed: ${e.message}`, 'error');
                            return false;
                        }
                        refresh();
                    }
                }
            ]
        });
    }

    // Task handlers, mirroring the Swing context group (Send/View/Remove
    // All/Clear Statistics/Start/Pause/Stop/Halt/Undeploy). All take explicit ids.
    const needIds = (ids: any) => {
        if (!ids.length) { toast('Select a channel first', 'warn'); return false; }
        return true;
    };
    const startTask = (ids: any) => controlChannels('start', 'Start', ids);
    const pauseTask = (ids: any) => controlChannels('pause', 'Pause', ids);
    const stopTask = (ids: any) => controlChannels('stop', 'Stop', ids);
    async function haltTask(ids: any) {
        if (!needIds(ids)) return;
        if (await confirmDialog('Halt channels', 'Halting forcibly kills processing threads. Halt the selected channels?', { danger: true, okLabel: 'Halt' })) {
            controlChannels('halt', 'Halt', ids);
        }
    }
    function clearStatsTask(ids: any) {
        if (needIds(ids)) openClearStatisticsDialog(ids);
    }
    /* Undeploying a channel strands everything that depends on it, so the related
       channels are offered BEFORE the confirmation — otherwise the confirmation
       would quote a count the user is about to change. */
    async function undeployTask(ids: any) {
        if (!needIds(ids)) return;
        const targets = await withDependencies(ids, 'dependents', 'Undeploy', nameOf);
        if (!targets) return;
        if (await confirmDialog('Undeploy', `Undeploy ${targets.length} channel(s)?`, { okLabel: 'Undeploy' })) {
            try { await api.engine.undeployMany(targets); } catch (e: any) { toast(e.message, 'error'); }
            refresh();
        }
    }
    function sendMessageTask(ids: any) {
        if (needIds(ids)) openSendMessageDialog(platform, ids[0], () => refresh());
    }
    function viewMessagesTask(ids: any) {
        if (needIds(ids)) router.navigate(`/messages/${ids[0]}`);
    }
    function removeAllTask(ids: any) {
        if (!needIds(ids)) return;
        const byId = new Map(statuses.map(status => [status.channelId, status]));
        openRemoveAllMessagesDialog({
            channels: ids.map((id: string) => byId.get(id)).filter(Boolean),
            onDone: () => refresh()
        });
    }

    /* ---- grouping ---- */
    /* (Connector Type/Port metadata now comes from useConnectorTypes /
       useSourcePorts — ~60s cadence, keep-last on failure, forced on manual
       Refresh — so the throttled imperative fetch is gone.) */

    function groupedStatuses() {
        const byId = new Map(statuses.map(s => [s.channelId, s]));
        const used = new Set();
        const rows: any[] = [];
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

    function visibleMembers(members: any) {
        const text = filterText.trim();
        if (!chips.length && !text) return members;

        // Explicit picks (exact, no wildcard): channels carrying any selected
        // tag, or matching any selected channel name. Multiple picks are OR'd.
        const chipChannelIds = new Set();
        const chipChannelNames = new Set();
        for (const chip of chips) {
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
        const needle = text.toLowerCase();
        let textTagged: any = null;
        if (needle) {
            textTagged = new Set();
            for (const tag of tags) {
                if (String(tag.name || '').toLowerCase().includes(needle)) {
                    api.asList(tag.channelIds, 'string').forEach(id => textTagged.add(id));
                }
            }
        }

        return members.filter((s: any) => {
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
    const statCellContent = (value: any, warnLevel: any) => {
        const text = fmtNumber(value);
        if (value && warnLevel === 'err') return <span className="text-err">{text}</span>;
        if (value && warnLevel === 'warn') return <span className="text-warn">{text}</span>;
        return text;
    };

    const statColumn = (key: any, label: any, statKey: any, warnLevel?: any) => ({
        key, label, align: 'right', mono: true,
        sortValue: (st: any) => (statsOf(st, lifetime) as any)[statKey] || 0,
        renderChannel: (st: any, stats: any) => statCellContent(stats[statKey], warnLevel),
        renderGroupAggregate: (totals: any) => statKey === 'ERROR'
            ? (totals.ERROR ? <span className="text-err">{fmtNumber(totals.ERROR)}</span> : '0')
            : fmtNumber(totals[statKey]),
        renderConnector: (child: any, stats: any) => <span className="text-text-dim">{fmtNumber(stats[statKey])}</span>
    });

    /* Column-definition model: each column knows how to render its CELL CONTENT
       (TreeTable wraps it in the <td>) for the three row types (group aggregate,
       channel, connector) and how to produce a sort value for a channel status.
       `tree:true` marks the column that carries the depth indent + twisty.
       Statistics read the `lifetime` state flag. */
    const COLUMNS = [
        {
            key: 'state', label: 'Status',
            sortValue: (st: any) => stateLabel(st.state) || String(st.state || ''),
            renderChannel: (st: any) => <span className="status-cell"><span className={`pip ${statePip(st.state)}`} />{stateLabel(st.state)}</span>,
            renderGroupAggregate: (totals: any, ctx: any) => {
                if (!ctx.members.length) return '';
                // Uniform group → that state's pip + label; otherwise "Mixed"
                // with a warning pip (Swing DashboardTreeTable behavior).
                const states = new Set(ctx.members.map((m: any) => m.state));
                if (states.size === 1) {
                    const state = ctx.members[0].state;
                    return <span className="status-cell"><span className={`pip ${statePip(state)}`} />{stateLabel(state)}</span>;
                }
                return <span className="status-cell"><span className="pip warn" />Mixed</span>;
            },
            renderConnector: (child: any) => <span className="status-cell"><span className={`pip ${statePip(child.state)}`} />{stateLabel(child.state)}</span>
        },
        {
            key: 'name', label: 'Name', tree: true,
            sortValue: (st: any) => String(st.name || '').toLowerCase(),
            renderChannel: (st: any) => nameCell(st),
            renderGroupAggregate: (totals: any, ctx: any) => `[${ctx.group.name}]`,
            renderConnector: (child: any) => <span className="text-text-dim">{String(child.name ?? '')}</span>
        },
        {
            key: 'type', label: 'Type',
            sortValue: (st: any) => String(connectorTypes.get(st.channelId)?.get(0) || ''),
            renderChannel: (st: any) => connectorTypes.get(st.channelId)?.get(0) || '',
            renderGroupAggregate: () => '',
            renderConnector: (child: any) => <span className="text-text-dim">{connectorTypes.get(child.channelId)?.get(Number(child.metaDataId)) || ''}</span>
        },
        {
            key: 'port', label: 'Port', mono: true,
            sortValue: (st: any) => Number(sourcePorts.get(st.channelId)) || 0,
            renderChannel: (st: any) => sourcePorts.get(st.channelId) || '',
            renderGroupAggregate: () => '',
            renderConnector: (child: any) => <span className="text-text-dim">{Number(child.metaDataId) === 0 ? (sourcePorts.get(child.channelId) || '') : ''}</span>
        },
        {
            key: 'rev', label: 'Rev Δ', align: 'right', mono: true,
            sortValue: (st: any) => Number(st.deployedRevisionDelta) || 0,
            renderChannel: (st: any) => {
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
            sortValue: (st: any) => st.deployedDate?.time ?? 0,
            renderChannel: (st: any) => isJustDeployed(st)
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
        return COLUMNS.concat(platform.dashboardColumns().map((c: any): any => ({
            key: c.id ? String(c.id) : String(c.label),
            label: c.label,
            renderChannel: (st: any) => (c.cell ? (c.cell(st) ?? '') : ''),
            renderGroupAggregate: () => '',
            renderConnector: (child: any) => (c.connectorCell ? (c.connectorCell(child) ?? '') : '')
        })));
    }

    // TreeTable column definitions: one render(node) per column that branches on
    // the node kind (group / channel / connector) to produce the cell content.
    function treeColumns() {
        return allColumns().map((col: any) => ({
            key: col.key, label: col.label, align: col.align, mono: col.mono, tree: col.tree,
            sortValue: col.sortValue,   // makes the header click-to-sort (controlled below)
            render: (node: any) => {
                if (node.kind === 'group') return col.renderGroupAggregate(node.totals, node.ctx);
                if (node.kind === 'connector') return col.renderConnector(node.child, node.stats);
                return col.renderChannel(node.st, node.stats);
            }
        }));
    }

    // Header-click sort: toggle direction on the same column, else sort ascending by
    // the new one. sortChannels (used by BOTH the tree AND visibleChannelIds) reads
    // the same sort state, so the displayed order and shift-select order stay in sync.
    function handleSort(key: any) {
        setSort((s: any) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
    }

    function sortChannels(list: any) {
        const byName = (a: any, b: any) => String(a.name).localeCompare(String(b.name));
        const col = COLUMNS.find(c => c.key === sort.key && c.sortValue);
        if (!col) return list.slice().sort(byName);
        const sortDir = sort.dir;
        return list.slice().sort((a: any, b: any) => {
            const va = col.sortValue(a), vb = col.sortValue(b);
            let cmp: any;
            if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
            else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
            return cmp ? cmp * sortDir : byName(a, b);
        });
    }

    // Group-level sort value for the active column so the GROUPS reorder too — Swing's
    // SortableTreeTableModel sorts each node's children (groups AND channels within).
    // Stat columns use the group's aggregate total; Name uses the group name; other
    // columns have no group-level value (groups keep their order).
    const STAT_SORT_KEYS = { received: 'RECEIVED', filtered: 'FILTERED', queued: 'QUEUED', sent: 'SENT', errored: 'ERROR' };
    function groupSortValue(members: any, sortKey: any) {
        if (sortKey === 'name') return null;   // handled by caller (uses group.name)
        const statKey = (STAT_SORT_KEYS as any)[sortKey];
        if (!statKey) return null;
        let sum = 0;
        for (const st of members) sum += (statsOf(st, lifetime) as any)[statKey] || 0;
        return sum;
    }

    // Groups with their channels sorted, and the groups themselves ordered by the
    // active column. Single source for BOTH the tree and the shift-select order.
    function orderedGroups() {
        const rows = groupedStatuses().map(({ group, members }) => ({
            group, members: sortChannels(visibleMembers(members))
        }));
        const sortKey = sort.key, sortDir = sort.dir;
        const valueOf = (r: any) => (sortKey === 'name'
            ? String(r.group.name || '').toLowerCase()
            : groupSortValue(r.members, sortKey));
        if (rows.some(r => valueOf(r) !== null)) {
            rows.sort((a: any, b: any) => {
                const va = valueOf(a), vb = valueOf(b);
                if (va === null && vb === null) return 0;
                if (va === null) return 1;
                if (vb === null) return -1;
                const cmp = (typeof va === 'number' && typeof vb === 'number')
                    ? va - vb : String(va).localeCompare(String(vb));
                return cmp ? cmp * sortDir : String(a.group.name || '').localeCompare(String(b.group.name || ''));
            });
        }
        return rows;
    }

    /* ---- table ---- */

    // Flat list of visible channel ids in display order — the basis for
    // shift-range selection (mirrors the channel-row rendering order below).
    function visibleChannelIds() {
        if (viewMode === 'channel') {
            return sortChannels(visibleMembers(statuses)).map((st: any) => st.channelId);
        }
        const ids: any[] = [];
        for (const { group, members } of orderedGroups()) {
            if (collapsedGroups.has(group.id)) continue;   // children hidden
            for (const st of members) ids.push(st.channelId);   // already sorted by orderedGroups
        }
        return ids;
    }

    /* ---- tree data for <TreeTable> -------------------------------------------- */

    // rowKey() must agree with the keys used in selectedKeys / collapsedKeys below.
    function rowKey(node: any) {
        if (node.kind === 'group') return `group:${node.group.id}`;
        if (node.kind === 'connector') return `conn:${node.child.channelId}:${node.child.metaDataId}`;
        return `chan:${node.st.channelId}`;
    }

    function connectorNodes(st: any) {
        return childrenOf(st).map((child: any) => ({
            kind: 'connector', child, stats: statsOf(child, lifetime)
        }));
    }

    function channelNode(st: any) {
        return { kind: 'channel', st, stats: statsOf(st, lifetime), children: connectorNodes(st) };
    }

    // Builds the root nodes the same way the legacy tbody walk did: channel view
    // is a flat sorted list of channels; group view nests channels under group
    // aggregate rows (an extra parent level). Filtering + sort are applied here
    // (matching the legacy renderTable), so <TreeTable> needs no `matches` prop.
    function buildTreeData() {
        if (viewMode === 'channel') {
            return sortChannels(visibleMembers(statuses)).map(channelNode);
        }
        const roots: any[] = [];
        for (const { group, members: visible } of orderedGroups()) {
            if (filterText.trim() && !visible.length) continue;   // skip empty group while filtering
            const totals = { RECEIVED: 0, FILTERED: 0, QUEUED: 0, SENT: 0, ERROR: 0 };
            let started = 0;
            for (const st of visible) {
                const s = statsOf(st, lifetime);
                for (const k of Object.keys(totals)) (totals as any)[k] += (s as any)[k] || 0;
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
       Two collapse states map onto <TreeTable>'s single collapsedKeys Set:
       groups default EXPANDED (collapsed when in collapsedGroups); channels
       default COLLAPSED (their connectors are hidden until expandedChannels
       holds the channel). So a channel key is "collapsed" unless it is expanded. */
    function buildCollapsedKeys() {
        const set = new Set();
        for (const groupId of collapsedGroups) set.add(`group:${groupId}`);
        for (const st of statuses) {
            if (!expandedChannels.has(st.channelId)) set.add(`chan:${st.channelId}`);
        }
        return set;
    }

    function onToggleCollapse(key: any) {
        const toggle = (prev: any, value: any) => {
            const next = new Set(prev);
            next.has(value) ? next.delete(value) : next.add(value);
            return next;
        };
        if (key.startsWith('group:')) setCollapsedGroups(prev => toggle(prev, key.slice('group:'.length)));
        else if (key.startsWith('chan:')) setExpandedChannels(prev => toggle(prev, key.slice('chan:'.length)));
    }

    /* ---- selection highlight (channels Set + optional connector) -------------- */
    function buildSelectedKeys() {
        const set = new Set();
        for (const channelId of selected) set.add(`chan:${channelId}`);
        if (selectedConnector) set.add(`conn:${selectedConnector.channelId}:${selectedConnector.metaDataId}`);
        return set;
    }

    // Row click: channels keep the multi-select (ctrl/shift) semantics; a group
    // row toggles its collapse; a connector row single-selects that connector.
    function onSelect(node: any, e: any) {
        if (node.kind === 'group') { onToggleCollapse(`group:${node.group.id}`); return; }
        if (node.kind === 'connector') {
            const child = node.child;
            lastClickedRef.current = null;
            applySelection(new Set(), { channelId: child.channelId, metaDataId: child.metaDataId });
            return;
        }
        const st = node.st;
        let next: any;
        if (e.metaKey || e.ctrlKey) {
            next = new Set(selected);
            next.has(st.channelId) ? next.delete(st.channelId) : next.add(st.channelId);
        } else if (e.shiftKey && lastClickedRef.current) {
            const visible = visibleChannelIds();
            const a = visible.indexOf(lastClickedRef.current), b = visible.indexOf(st.channelId);
            next = (a !== -1 && b !== -1)
                ? new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1))
                : new Set([st.channelId]);
        } else {
            next = new Set([st.channelId]);
        }
        lastClickedRef.current = st.channelId;
        applySelection(next, null);
    }

    // Double-click: connector → message browser filtered to it; channel → the
    // channel's message browser (Swing parity); group → no-op.
    function onActivate(node: any) {
        if (node.kind === 'connector') router.navigate(`/messages/${node.child.channelId}?metaDataId=${node.child.metaDataId}`);
        else if (node.kind === 'channel') router.navigate(`/messages/${node.st.channelId}`);
    }

    function onRowContextMenu(node: any, e: any) {
        if (node.kind === 'group') return groupMenu(node.group, node.members, e);
        if (node.kind === 'connector') return connectorMenu(node.child, e);
        return channelMenu(node.st, e);
    }

    /* ---- per-row context menus (reused verbatim from the legacy rows) --------- */

    function groupMenu(group: any, members: any, e: any) {
        e.preventDefault();
        if (!members.length) return;
        // Select the group's visible members, then mirror the channel-row menu
        // acting on those ids. Send/View target the first member.
        const ids = members.map((m: any) => m.channelId);
        applySelection(new Set(ids), null);
        const first = members[0];
        const anyState = (fn: any) => members.some(fn);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() },
            '-',
            { label: 'Send Message', icon: 'send', task: 'doSendMessage', onClick: () => openSendMessageDialog(platform, first.channelId, () => refresh()) },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => router.navigate(`/messages/${first.channelId}`) },
            { label: 'Remove All Messages', icon: 'trash', danger: true, task: 'doRemoveAllMessages', onClick: () => removeAllTask(ids) },
            { label: 'Clear Statistics', icon: 'clear', hidden: lifetime, task: 'doClearStats', onClick: () => clearStatsTask(ids) },
            '-',
            { label: 'Start', icon: 'play', hidden: !anyState((x: any) => x.state === 'STOPPED' || x.state === 'PAUSED'), task: 'doStart', onClick: () => controlChannels('start', 'Start', ids) },
            { label: 'Pause', icon: 'pause', hidden: !anyState((x: any) => x.state === 'STARTED'), task: 'doPause', onClick: () => controlChannels('pause', 'Pause', ids) },
            { label: 'Stop', icon: 'stop', hidden: !anyState((x: any) => x.state === 'STARTED' || x.state === 'PAUSED'), task: 'doStop', onClick: () => controlChannels('stop', 'Stop', ids) },
            { label: 'Halt', icon: 'halt', hidden: !(members.length === 1 && isHaltable(members[0].state)), task: 'doHalt', onClick: () => haltTask(ids) },
            { label: 'Undeploy Channels', icon: 'undeploy', hidden: anyState((x: any) => isHaltableNonSyncing(x.state)), task: 'doUndeployChannel', onClick: () => undeployTask(ids) }
        ], 'dashboard');
    }

    function tagsFor(channelId: any) {
        return tags.filter(tag => api.asList(tag.channelIds, 'string').includes(channelId));
    }

    /* Icons mode: the actual tag glyph filled with the tag's color, stroked a
       slightly darker shade so the shape still reads against any row. */
    function tagIconJsx(tag: any, key: any) {
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

    function tagChipsJsx(channelId: any) {
        if (tagMode === 'off') return null;
        return tagsFor(channelId).map((tag: any, i: any) => tagMode === 'icons'
            ? tagIconJsx(tag, i)
            : <span key={i} className="tag" style={tagPillStyle(tag)}>{tag.name}</span>);
    }

    // Single line, never wrapping — excess tags clip rather than grow the row.
    // A plain JSX builder (NOT a component defined per render, which would be a
    // new component type every render and remount the cell on each poll).
    function nameCell(st: any) {
        return (
            <span className="inline-flex items-center gap-1.5 flex-nowrap overflow-hidden max-w-full">
                <span className="shrink-0">{st.name}</span>
                {tagChipsJsx(st.channelId)}
            </span>
        );
    }

    function channelMenu(st: any, e: any) {
        e.preventDefault();
        // Right-click keeps a multi-selection that includes the row; otherwise it
        // becomes the selection — and the menu acts on exactly those ids.
        const ids = selected.has(st.channelId) ? [...selected] : [st.channelId];
        if (!selected.has(st.channelId)) applySelection(new Set([st.channelId]), null);
        const sel = statuses.filter(x => ids.includes(x.channelId));
        const anyState = (fn: any) => sel.some(fn);
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() },
            '-',
            { label: 'Send Message', icon: 'send', task: 'doSendMessage', onClick: () => openSendMessageDialog(platform, st.channelId, () => refresh()) },
            { label: 'View Messages', icon: 'messages', task: 'doShowMessages', onClick: () => router.navigate(`/messages/${st.channelId}`) },
            { label: 'Remove All Messages', icon: 'trash', danger: true, task: 'doRemoveAllMessages', onClick: () => removeAllTask(ids) },
            { label: 'Clear Statistics', icon: 'clear', hidden: lifetime, task: 'doClearStats', onClick: () => clearStatsTask(ids) },
            '-',
            { label: 'Start', icon: 'play', hidden: !anyState((x: any) => x.state === 'STOPPED' || x.state === 'PAUSED'), task: 'doStart', onClick: () => controlChannels('start', 'Start', ids) },
            { label: 'Pause', icon: 'pause', hidden: !anyState((x: any) => x.state === 'STARTED'), task: 'doPause', onClick: () => controlChannels('pause', 'Pause', ids) },
            { label: 'Stop', icon: 'stop', hidden: !anyState((x: any) => x.state === 'STARTED' || x.state === 'PAUSED'), task: 'doStop', onClick: () => controlChannels('stop', 'Stop', ids) },
            { label: 'Halt', icon: 'halt', hidden: !(sel.length === 1 && isHaltable(sel[0].state)), task: 'doHalt', onClick: () => haltTask(ids) },
            // Through undeployTask like every other undeploy entry point: its
            // `hidden` test already spans the selection, so undeploying only the
            // right-clicked row left the rest of the selection behind — and it
            // skipped both the dependency prompt and the confirmation.
            { label: 'Undeploy Channel', icon: 'undeploy', hidden: anyState((x: any) => isHaltableNonSyncing(x.state)), task: 'doUndeployChannel', onClick: () => undeployTask(ids) },
            '-',
            { label: 'Edit Channel', icon: 'edit', task: 'doEditChannel', group: 'channel', onClick: () => router.navigate(`/channels/${st.channelId}/edit`) },
            // Tagged with Swing's channelEdit constants (CHANNEL_EDIT_FILTER/_TRANSFORMER)
            // so an RBAC policy that hides filter/transformer editing applies here too.
            { label: 'Edit Filter', icon: 'filter', task: 'doEditFilter', group: 'channelEdit', onClick: () => router.navigate(`/channels/${st.channelId}/filter/0`) },
            { label: 'Edit Transformer', icon: 'transform', task: 'doEditTransformer', group: 'channelEdit', onClick: () => router.navigate(`/channels/${st.channelId}/transformer/0`) }
        ], 'dashboard');
    }

    // Right-click a source/destination connector row to start/stop just that
    // connector (Swing DASHBOARD_START_CONNECTOR / STOP_CONNECTOR).
    function connectorMenu(child: any, e: any) {
        e.preventDefault();
        const runConnector = (method: any) => async () => {
            try { await (api.status as any)[method](child.channelId, child.metaDataId); }
            catch (err: any) { toast(err.message, 'error'); }
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

    /* (The filter bar — chips, typeahead, counts, display toggles — is the
       declarative <DashFilterBar> component above; the imperative builders,
       updateCounts, and the document.body typeahead management are gone.) */

    /* ---- refresh (manual Refresh + post-action): refetch through the query
       cache. The auto-poll itself is Query's refetchInterval (the
       dashboardRefreshSeconds preference), so there is no timer chain here.
       A background/post-action refetch failure keeps the last data silently
       (self-heals next tick); only a MANUAL Refresh toasts. Manual also forces
       the ~60s connector-metadata queries, like the classic bar. */
    async function refresh(manual = false) {
        const jobs: any[] = [statusesQ.refetch(), groupsQ.refetch(), tagsQ.refetch()];
        if (manual) jobs.push(typesQ.refetch(), portsQ.refetch());
        const [st] = await Promise.all(jobs);
        if (manual && st.error) toast(`Refresh failed: ${st.error.message}`, 'error');
    }

    // Click on empty space (not a row) clears the channel selection, so the
    // contextual task buttons can be dismissed (the <TreeTable> wrapper forwards
    // empty-space clicks here).
    function onEmptyClick(e: any) {
        if (e.target.closest('tr')) return;
        if (!selected.size && !selectedConnector) return;
        lastClickedRef.current = null;
        applySelection(new Set(), null);
    }
    // Right-click the empty space below the rows: deselect and show the
    // no-selection dashboard popup (just Refresh), matching the Swing dashboard.
    function onEmptyContextMenu(e: any) {
        e.preventDefault();
        if (selected.size || selectedConnector) {
            lastClickedRef.current = null;
            applySelection(new Set(), null);
        }
        contextMenu(e.clientX, e.clientY, [{ label: 'Refresh', icon: 'refresh', task: 'doRefreshStatuses', onClick: () => refresh() }], 'dashboard');
    }

    /* Leaving the dashboard ends the one-time "just deployed" cue, so it won't
       reappear when you navigate back. The ref mirror exists only so the
       unmount cleanup sees the LATEST statuses (a []-effect closure would see
       the mount-time ones). */
    const statusesAtCleanup = useRef<any[]>([]);
    useEffect(() => { statusesAtCleanup.current = statuses; }, [statuses]);
    useEffect(() => () => {
        for (const st of statusesAtCleanup.current) if (isJustDeployed(st)) seenDeploys.add(deployKey(st));
    }, []);

    /* ---- React task pane: selection-gated visibility (Swing Dashboard Tasks) ---- */

    const sel = statuses.filter(s => selected.has(s.channelId));
    const hasSel = sel.length > 0;
    const anyState = (fn: any) => sel.some(fn);
    // Started channel offers Pause/Stop, not Start/Halt (classic behavior).
    const showStart = anyState((s: any) => s.state === 'STOPPED' || s.state === 'PAUSED');
    const showPause = anyState((s: any) => s.state === 'STARTED');
    const showStop = anyState((s: any) => s.state === 'STARTED' || s.state === 'PAUSED');
    // Halt is single-channel + transitional; Undeploy hides while a channel is
    // transitioning (except Syncing); Clear Statistics hides in Lifetime mode.
    const showHalt = sel.length === 1 && isHaltable(sel[0].state);
    const showUndeploy = hasSel && !anyState((s: any) => isHaltableNonSyncing(s.state));
    const showClearStats = hasSel && !lifetime;

    /* ---- plugin dashboard tabs (Server Log, Connection Log, Global Maps, …) ---- */

    // A tab may declare a `task` (e.g. an extension task name published through
    // RBAC's task-permission merge) — unauthorized tabs are hidden entirely.
    const tabDefs = platform.dashboardTabs().filter((t: any) => !t.task || platform.checkTask('dashboard', t.task));
    // Selection reaches the tabs through the `selection` prop (tabCtx) and each
    // tab re-scopes from it via its own effect — so the tab must NOT be remounted
    // on selection change. Keying it on a selection signature used to wipe the
    // Server Log's accumulated entries (and reset every tab's poll) on any
    // click/refresh; the key is stable per tab (id || label).
    const activeTab = tabDefs.find((d: any) => (d.id || d.label) === activeTabId) || tabDefs[0] || null;
    const tabCtx = { selection: selectionForTabs, platform };

    /* ---- status board (<TreeTable>) data + collapse/selection state ---- */
    const treeData = buildTreeData();
    const collapsedKeys = buildCollapsedKeys();
    const selectedKeys = buildSelectedKeys();
    const channelsText = `${statuses.length} Deployed Channel${statuses.length === 1 ? '' : 's'}`;
    const countsText = viewMode === 'channel'
        ? channelsText
        : (() => { const rows = groupedStatuses(); return `${rows.length} Group${rows.length === 1 ? '' : 's'}, ${channelsText}`; })();
    const emptyText = loaded
        ? (
            <div className="dt-empty">
                <div className="empty-icon"><Icon name="dashboard" size={30} /></div>
                <div>No deployed channels</div>
                <div className="text-text-faint mt-[13px]">Deploy a channel from the Channels view to see it here.</div>
            </div>
        )
        : 'Contacting engine…';

    return (
        <div className="view dash-shadcn">
            <ViewTasks>
                <RailPane title="Dashboard Tasks" paneKey="tasks:Dashboard Tasks" group="dashboard">
                    <div className="taskbar" data-pane-title="Dashboard Tasks">
                        {onToggleView && <TaskButton label="Card view" icon="dashboard" onClick={onToggleView} />}
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshStatuses" onClick={() => refresh(true)} />
                        {hasSel && <TaskButton label="Send Message" icon="send" task="doSendMessage" onClick={() => sendMessageTask([...selected])} />}
                        {hasSel && <TaskButton label="View Messages" icon="messages" task="doShowMessages" onClick={() => viewMessagesTask([...selected])} />}
                        {hasSel && <TaskButton label="Remove All Messages" icon="trash" danger task="doRemoveAllMessages" onClick={() => removeAllTask([...selected])} />}
                        {showClearStats && <TaskButton label="Clear Statistics" icon="clear" task="doClearStats" onClick={() => clearStatsTask([...selected])} />}
                        {showStart && <TaskButton label="Start" icon="play" task="doStart" onClick={() => startTask([...selected])} />}
                        {showPause && <TaskButton label="Pause" icon="pause" task="doPause" onClick={() => pauseTask([...selected])} />}
                        {showStop && <TaskButton label="Stop" icon="stop" task="doStop" onClick={() => stopTask([...selected])} />}
                        {showHalt && <TaskButton label="Halt" icon="halt" task="doHalt" onClick={() => haltTask([...selected])} />}
                        {showUndeploy && <TaskButton label="Undeploy Channel" icon="undeploy" task="doUndeployChannel" onClick={() => undeployTask([...selected])} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col">
                {statuses.length > 0 && (() => {
                    const k = engineTotals(statuses, lifetime);
                    const fmt = (n: any) => n.toLocaleString();
                    const pct = (n: any, d: any) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
                    return (
                        // Stays mounted when Stats is Off — the strip slides shut instead of
                        // popping out, which needs both states in the DOM (.dash-kpis-wrap).
                        <div className={`dash-kpis-wrap${showStats ? ' open' : ''}`} aria-hidden={!showStats}>
                          <div className="dash-kpis-slide">
                            <div className="dash-kpis">
                                <div className="dash-kpi">
                                    <div className="k-lbl">Received</div><div className="k-val">{fmt(k.RECEIVED)}</div>
                                    <div className="k-sub">{lifetime ? 'lifetime stats' : 'current stats'}</div>
                                </div>
                                <div className="dash-kpi">
                                    <div className="k-lbl">Filtered</div><div className="k-val">{fmt(k.FILTERED)}</div>
                                    <div className="k-sub">{pct(k.FILTERED, k.RECEIVED)}% of received</div>
                                </div>
                                <div className="dash-kpi warn">
                                    <div className="k-lbl">Queued</div><div className="k-val">{fmt(k.QUEUED)}</div>
                                    <div className="k-sub">across {k.queuedChannels} channel{k.queuedChannels === 1 ? '' : 's'}</div>
                                </div>
                                <div className="dash-kpi good">
                                    <div className="k-lbl">Sent</div><div className="k-val">{fmt(k.SENT)}</div>
                                    <div className="k-sub">{pct(k.SENT, k.RECEIVED)}% delivered</div>
                                </div>
                                <div className="dash-kpi bad">
                                    <div className="k-lbl">Errored</div><div className="k-val">{fmt(k.ERROR)}</div>
                                    <div className="k-sub">{pct(k.ERROR, k.RECEIVED)}% error rate</div>
                                </div>
                            </div>
                          </div>
                        </div>
                    );
                })()}
                <div className="dash-content flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]"
                    onClick={onEmptyClick}
                    onContextMenu={(e: any) => { if (!e.target.closest('tr') && !e.target.closest('thead')) onEmptyContextMenu(e); }}>
                    <TreeTable
                        data={treeData}
                        columns={treeColumns()}
                        sort={sort}
                        onSort={handleSort}
                        getChildren={(n: any) => n.children}
                        rowKey={rowKey}
                        rowClassName={(n: any) => (n.kind === 'group' ? 'group-row' : '')}
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
                <div className="dash-filterbar flex-none">
                    <DashFilterBar
                        statuses={statuses} tags={tags} countsText={countsText}
                        filterText={filterText} onFilterText={setFilterText}
                        chips={chips} onChips={setChips}
                        viewMode={viewMode} onViewMode={setViewMode}
                        tagMode={tagMode} onTagMode={setTagMode}
                        showStats={showStats} onShowStats={setShowStats}
                        lifetime={lifetime} onLifetime={setLifetime} />
                </div>
                {tabDefs.length > 0 && (
                    <>
                        <div className="split-handle dash-split" data-orient="v" data-resize="next" />
                        {/* Dock tabs via Radix (headless a11y: arrow-key nav, roving focus). */}
                        <Tabs.Root
                            value={activeTab ? (activeTab.id || activeTab.label) : undefined}
                            onValueChange={setActiveTabId}
                            className="dash-dock flex-none h-[clamp(140px,32vh,230px)] overflow-hidden flex flex-col">
                            <Tabs.List className="tabs flex-none">
                                {tabDefs.map((def: any) => (
                                    <Tabs.Trigger key={def.id || def.label} value={def.id || def.label} className="tab">
                                        {def.label}
                                    </Tabs.Trigger>
                                ))}
                            </Tabs.List>
                            {tabDefs.map((def: any) => (
                                <Tabs.Content key={def.id || def.label}
                                    value={def.id || def.label} className="flex-1 overflow-auto min-h-0">
                                    {def === activeTab && <PluginSlot def={def} ctx={tabCtx} />}
                                </Tabs.Content>
                            ))}
                        </Tabs.Root>
                    </>
                )}
            </div>
        </div>
    );
}
