/*
 * React UI primitives for ported views. Declarative bits (task panes, buttons,
 * fields) are native React with VERBATIM class names; the data grid wraps the
 * proven core/ui.js DataTable (mounts its .el, bridges selection → React state)
 * so the column-menu/sort/selection behavior — and its e2e coverage — carry over
 * unchanged. Imperative helpers (modal/confirm/toast/contextMenu) are called
 * directly from React handlers; no rewrite needed.
 */

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, createContext, useContext } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Icon } from './bridges.jsx';
import { DataTable } from '@oie/web-ui';
import { createCodeEditor } from '../core/codeeditor.js';
import { checkTask } from '../core/authorization.js';

// Rail-pane collapse state, shared across the shell's nav panes and view task
// panes; persists for the session.
const paneCollapsed = new Map();

/** Forget the per-view pane collapse state — called on sign-out so the next
    user of this tab starts from the defaults, not the last user's layout. */
export function resetPaneCollapsed() { paneCollapsed.clear(); }

// RBAC task group (Swing pane key, e.g. "channel"). A task pane sets it once via
// RailPane group=...; its TaskButtons read it so each only needs its `task` id.
const TaskGroupContext = createContext(null);

/* Collapsible rail pane (shared by the shell nav and React view task panes).
   `group` (optional) is the RBAC task-pane key, provided to child TaskButtons. */
export function RailPane({
    title, paneKey, group, className, children,
    /* Nav-rail customization hooks (see react/nav-rail.jsx). While customizing,
       `onHeaderClick` replaces the collapse action with a rename, so the header
       stops being a disclosure and drops its expanded state accordingly. */
    headerTitle, headerExtra, onHeaderClick, headerDraggable,
    onHeaderDragStart, onHeaderDragEnd, onHeaderContextMenu, onPaneDragOver, onPaneDrop
}: any) {
    const k = paneKey || title;
    const [collapsed, setCollapsed] = useState(() => paneCollapsed.get(k) || false);
    const disclosure = !onHeaderClick;

    /* A real <button>: Radix's Trigger wires aria-expanded/aria-controls and the
       element itself brings Enter/Space, which the old div had to reimplement.
       Preflight already strips a button's chrome, so .rail-pane-header only needed
       a width/alignment line to look identical. */
    const header = (
        <button type="button" className="rail-pane-header"
            aria-label={disclosure ? undefined : `Rename group ${title}`}
            onClick={disclosure ? undefined : onHeaderClick}
            draggable={headerDraggable || undefined}
            onDragStart={onHeaderDragStart}
            onDragEnd={onHeaderDragEnd}
            onContextMenu={onHeaderContextMenu}>
            {headerDraggable ? <span className="rail-grip" aria-hidden="true">⠿</span> : null}
            {headerTitle !== undefined ? headerTitle : <span className="pane-title">{title}</span>}
            {headerExtra}
            {disclosure ? <span className="pane-chevron" aria-hidden="true">▲</span> : null}
        </button>
    );

    return (
        /* While customizing, the header renames instead of collapsing, so the pane
           is pinned open and the header is not a Trigger at all — a disclosure that
           doesn't disclose would be worse than none. */
        <Collapsible.Root
            open={disclosure ? !collapsed : true}
            onOpenChange={(open: any) => { setCollapsed(!open); paneCollapsed.set(k, !open); }}
            className={'rail-pane' + (collapsed ? ' collapsed' : '') + (className ? ' ' + className : '')}
            onDragOver={onPaneDragOver} onDrop={onPaneDrop}>
            {disclosure ? <Collapsible.Trigger asChild>{header}</Collapsible.Trigger> : header}
            <Collapsible.Content className="rail-pane-body">
                {group ? <TaskGroupContext.Provider value={group}>{children}</TaskGroupContext.Provider> : children}
            </Collapsible.Content>
        </Collapsible.Root>
    );
}

/* Task-pane button (parity with core/ui.js taskButton). `task` (the Swing action
   constant, e.g. "doNewChannel") + the pane's group gate visibility via RBAC: an
   unauthorized task renders nothing, exactly like Swing hiding the task. */
export function TaskButton({ label, icon, onClick, primary, danger, task, group }: any) {
    const ctxGroup = useContext(TaskGroupContext);
    if (task && !checkTask(group || ctxGroup, task)) return null;
    const cls = 'btn' + (primary ? ' btn-primary' : '') + (danger ? ' btn-danger' : '');
    return <button className={cls} onClick={onClick}>{icon ? <Icon name={icon} /> : null}{label}</button>;
}

/* Mounts a core/ui.js DataTable and keeps its rows in sync. onReady hands the
   instance back so the view can read selectedRows()/clearSelection(). Selection
   and activation flow through the table's own options (onSelect/onActivate/
   onContextMenu). */
export function DataTableHost({ columns, options, rows, onReady }: any) {
    const ref = useRef<any>(null);
    const tableRef = useRef<any>(null);
    useEffect(() => {
        const host = ref.current;
        const table = new DataTable(columns, options);
        tableRef.current = table;
        host.appendChild(table.el);
        if (onReady) onReady(table);
        return () => { host.replaceChildren(); };
        // Build once; rows are pushed via the effect below. columns/options/onReady
        // are captured at mount and never re-read — the table owns sort, selection
        // and column visibility from then on, so rebuilding it would throw that
        // state away. The effect below enforces the stability that assumes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (tableRef.current && rows) tableRef.current.setRows(rows);
    }, [rows]);
    // Dev-only: a caller that rebuilds columns/options/onReady each render silently
    // gets the FIRST render's values forever — the failure is invisible (stale
    // callbacks), so say it out loud. Seeded from a ref rather than the mount
    // effect's closure so a StrictMode remount re-seeds instead of false-firing.
    // vite constant-folds import.meta.env.DEV, so this whole block leaves the build.
    const stableRef = useRef<any>(null);
    useEffect(() => {
        if (!(import.meta as any).env || !(import.meta as any).env.DEV) return;
        const prev = stableRef.current;
        stableRef.current = { columns, options, onReady };
        if (!prev) return;
        const changed = ['columns', 'options', 'onReady']
            .filter((k: any) => prev[k] !== stableRef.current[k]);
        if (changed.length) {
            console.warn(`[ui] DataTableHost: ${changed.map((k: any) => `\`${k}\``).join(', ')} changed identity after mount and ${changed.length > 1 ? 'were' : 'was'} ignored — hoist ${changed.length > 1 ? 'them' : 'it'} (useRef/useMemo/module const) or the table keeps the first render's values.`);
        }
    }, [columns, options, onReady]);
    return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} />;
}

/* Monaco code-editor island. Wraps createCodeEditor (baseline textarea now,
   Monaco upgrade when the CDN resolves — air-gapped keeps the baseline). Created
   ONCE; value/onChange flow through refs so re-renders never clobber the cursor.
   Imperative handle (getValue/setValue/focus) mirrors the vanilla editor API so
   views read/write exactly as before. */
export const CodeEditor = forwardRef(function CodeEditor({ language, readOnly, defaultValue, onChange, style }: any, apiRef: any) {
    const ref = useRef<any>(null);
    const edRef = useRef<any>(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        const host = ref.current;
        const ed = createCodeEditor({
            value: defaultValue, language, readOnly,
            onChange: (v: any) => onChangeRef.current && onChangeRef.current(v)
        });
        edRef.current = ed;
        host.appendChild(ed.el);
        ed.el.style.flex = '1';
        ed.el.style.minHeight = '0';
        return () => { try { ed.dispose(); } catch { /* baseline no-op */ } host.replaceChildren(); };
        // Build once; value/language/onChange handled via refs + the imperative handle.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useImperativeHandle(apiRef, () => ({
        getValue: () => (edRef.current ? edRef.current.getValue() : ''),
        setValue: (v: any) => edRef.current && edRef.current.setValue(v),
        focus: () => edRef.current && edRef.current.focus()
    }), []);
    return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...style }} />;
});

/*
 * Tabs — Radix, controlled.
 *
 * Radix owns the roles, the roving tabindex and the arrow/Home/End keys; we own
 * the value, which is what lets a call site REFUSE a switch (settings prompts on
 * unsaved changes): onValueChange proposes, and if the caller declines to move
 * `active`, the controlled value simply stays put.
 *
 * Every panel stays MOUNTED via forceMount, so Monaco editors and scroll state
 * inside survive a switch — matches the vanilla tabs(). Radix marks the inactive
 * ones with `hidden` + data-state, and .tab-body > [role=tabpanel] in app.css
 * turns the active one back into the flex column the height chain needs.
 */
export function Tabs({ tabs, active, onActiveChange, label }: any) {
    const value = String(active);
    return (
        <TabsPrimitive.Root value={value} onValueChange={(v: any) => onActiveChange(Number(v))}
            className="tabs-wrap"
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <TabsPrimitive.List className="tabs" aria-label={label}>
                {tabs.map((tb: any, i: any) => (
                    <TabsPrimitive.Trigger key={i} value={String(i)}
                        className={'tab' + (i === active ? ' active' : '')}>
                        {tb.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {tabs.map((tb: any, i: any) => (
                    <TabsPrimitive.Content key={i} value={String(i)} forceMount
                        style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}>
                        {tb.content}
                    </TabsPrimitive.Content>
                ))}
            </div>
        </TabsPrimitive.Root>
    );
}
