/*
 * React UI primitives for ported views. Declarative bits (task panes, buttons,
 * fields) are native React with VERBATIM class names; the data grid wraps the
 * proven core/ui.js DataTable (mounts its .el, bridges selection → React state)
 * so the column-menu/sort/selection behavior — and its e2e coverage — carry over
 * unchanged. Imperative helpers (modal/confirm/toast/contextMenu) are called
 * directly from React handlers; no rewrite needed.
 */

import { useState, useEffect, useRef, forwardRef, useImperativeHandle, createContext, useContext } from 'react';
import { Icon } from './bridges.jsx';
import { DataTable } from '@oie/web-ui';
import { createCodeEditor } from '../core/codeeditor.js';
import { checkTask } from '../core/authorization.js';

// Rail-pane collapse state, shared across the shell's nav panes and view task
// panes; persists for the session.
const paneCollapsed = new Map();

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
}) {
    const k = paneKey || title;
    const [collapsed, setCollapsed] = useState(() => paneCollapsed.get(k) || false);
    const toggle = () => { const next = !collapsed; setCollapsed(next); paneCollapsed.set(k, next); };
    // Stable id so the header can point at the region it collapses.
    const bodyId = 'rail-pane-' + String(k).replace(/[^a-zA-Z0-9_-]+/g, '-');
    const disclosure = !onHeaderClick;
    return (
        <div className={'rail-pane' + (collapsed ? ' collapsed' : '') + (className ? ' ' + className : '')}
            onDragOver={onPaneDragOver} onDrop={onPaneDrop}>
            {/* A collapse that was pointer-only and announced nothing: role + state,
                and Enter/Space so it can be worked from the keyboard. Kept as a div
                (not a <button>) so the rail's header layout/CSS is untouched. */}
            <div className="rail-pane-header" onClick={onHeaderClick || toggle}
                role="button"
                tabIndex={0}
                aria-expanded={disclosure ? String(!collapsed) : undefined}
                aria-controls={disclosure ? bodyId : undefined}
                aria-label={disclosure ? undefined : `Rename group ${title}`}
                draggable={headerDraggable || undefined}
                onDragStart={onHeaderDragStart}
                onDragEnd={onHeaderDragEnd}
                onContextMenu={onHeaderContextMenu}
                onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    (onHeaderClick || toggle)();
                }}>
                {headerDraggable ? <span className="rail-grip" aria-hidden="true">⠿</span> : null}
                {headerTitle !== undefined ? headerTitle : <span className="pane-title">{title}</span>}
                {headerExtra}
                {disclosure ? <span className="pane-chevron" aria-hidden="true">▲</span> : null}
            </div>
            <div className="rail-pane-body" id={bodyId}>
                {group ? <TaskGroupContext.Provider value={group}>{children}</TaskGroupContext.Provider> : children}
            </div>
        </div>
    );
}

/* Task-pane button (parity with core/ui.js taskButton). `task` (the Swing action
   constant, e.g. "doNewChannel") + the pane's group gate visibility via RBAC: an
   unauthorized task renders nothing, exactly like Swing hiding the task. */
export function TaskButton({ label, icon, onClick, primary, danger, task, group }) {
    const ctxGroup = useContext(TaskGroupContext);
    if (task && !checkTask(group || ctxGroup, task)) return null;
    const cls = 'btn' + (primary ? ' btn-primary' : '') + (danger ? ' btn-danger' : '');
    return <button className={cls} onClick={onClick}>{icon ? <Icon name={icon} /> : null}{label}</button>;
}

/* Mounts a core/ui.js DataTable and keeps its rows in sync. onReady hands the
   instance back so the view can read selectedRows()/clearSelection(). Selection
   and activation flow through the table's own options (onSelect/onActivate/
   onContextMenu). */
export function DataTableHost({ columns, options, rows, onReady }) {
    const ref = useRef(null);
    const tableRef = useRef(null);
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
    const stableRef = useRef(null);
    useEffect(() => {
        if (!import.meta.env || !import.meta.env.DEV) return;
        const prev = stableRef.current;
        stableRef.current = { columns, options, onReady };
        if (!prev) return;
        const changed = ['columns', 'options', 'onReady']
            .filter((k) => prev[k] !== stableRef.current[k]);
        if (changed.length) {
            console.warn(`[ui] DataTableHost: ${changed.map((k) => `\`${k}\``).join(', ')} changed identity after mount and ${changed.length > 1 ? 'were' : 'was'} ignored — hoist ${changed.length > 1 ? 'them' : 'it'} (useRef/useMemo/module const) or the table keeps the first render's values.`);
        }
    }, [columns, options, onReady]);
    return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} />;
}

/* Monaco code-editor island. Wraps createCodeEditor (baseline textarea now,
   Monaco upgrade when the CDN resolves — air-gapped keeps the baseline). Created
   ONCE; value/onChange flow through refs so re-renders never clobber the cursor.
   Imperative handle (getValue/setValue/focus) mirrors the vanilla editor API so
   views read/write exactly as before. */
export const CodeEditor = forwardRef(function CodeEditor({ language, readOnly, defaultValue, onChange, style }, apiRef) {
    const ref = useRef(null);
    const edRef = useRef(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        const host = ref.current;
        const ed = createCodeEditor({
            value: defaultValue, language, readOnly,
            onChange: (v) => onChangeRef.current && onChangeRef.current(v)
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
        setValue: (v) => edRef.current && edRef.current.setValue(v),
        focus: () => edRef.current && edRef.current.focus()
    }), []);
    return <div ref={ref} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...style }} />;
});

/*
 * Tablist semantics + keyboard for the app's hand-rolled `.tabs` strips.
 *
 * The dashboard dock is Radix and gets this for free; the other strips were bare
 * button rows — every tab its own Tab stop, arrows doing nothing, and no
 * announcement of which one was selected. Spread the returned props rather than
 * repeating the logic eight times:
 *
 *   const t = useTabList(labels.length, active, setActive, { label: 'Settings' });
 *   <div className="tabs" {...t.list}>
 *     {labels.map((l, i) => <button className="tab" {...t.tab(i)}>{l}</button>)}
 *   </div>
 *   <div className="tab-body" {...t.panel}>…</div>
 *
 * Activation follows focus (the APG default for tabs): the arrow keys select as
 * they move. Every tab button is in the DOM regardless of which is active, so the
 * new tab can be focused synchronously — no deferred focus() to race a keystroke.
 */
export function useTabList(count, active, onChange, { label = 'Tabs' } = {}) {
    const stripRef = useRef(null);
    const focusTab = (i) => {
        const btns = stripRef.current ? stripRef.current.querySelectorAll('[role="tab"]') : [];
        if (btns[i] && btns[i].focus) btns[i].focus();
    };
    const onKeyDown = (e) => {
        let to = -1;
        if (e.key === 'ArrowRight') to = (active + 1) % count;
        else if (e.key === 'ArrowLeft') to = (active - 1 + count) % count;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = count - 1;
        if (to < 0 || !count) return;
        e.preventDefault();
        onChange(to);
        focusTab(to);
    };
    return {
        list: { ref: stripRef, role: 'tablist', 'aria-label': label, onKeyDown },
        // Roving tabindex: the strip is one tab stop, not one per tab.
        tab: (i) => ({ role: 'tab', 'aria-selected': String(i === active), tabIndex: i === active ? 0 : -1 }),
        panel: { role: 'tabpanel' }
    };
}

/* Tabs (controlled). Every panel stays MOUNTED (inactive ones hidden via CSS) so
   editors/state inside survive tab switches — matches the vanilla tabs(). */
export function Tabs({ tabs, active, onActiveChange, label }) {
    // flex-based height chain (not height:100%) so editors/content fill even when
    // the parent's height is flex-computed — matches the vanilla tabs().
    const t = useTabList(tabs.length, active, onActiveChange, { label });
    return (
        <div className="tabs-wrap" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div className="tabs" {...t.list}>
                {tabs.map((tb, i) => (
                    <button key={i} className={'tab' + (i === active ? ' active' : '')}
                        {...t.tab(i)}
                        onClick={() => onActiveChange(i)}>{tb.label}</button>
                ))}
            </div>
            <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {tabs.map((tb, i) => (
                    <div key={i} {...(i === active ? t.panel : { role: 'tabpanel', 'aria-hidden': 'true' })}
                        style={{ flex: 1, minHeight: 0, display: i === active ? 'flex' : 'none', flexDirection: 'column' }}>
                        {tb.content}
                    </div>
                ))}
            </div>
        </div>
    );
}
