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
export function RailPane({ title, paneKey, group, className, children }) {
    const k = paneKey || title;
    const [collapsed, setCollapsed] = useState(() => paneCollapsed.get(k) || false);
    const toggle = () => { const next = !collapsed; setCollapsed(next); paneCollapsed.set(k, next); };
    return (
        <div className={'rail-pane' + (collapsed ? ' collapsed' : '') + (className ? ' ' + className : '')}>
            <div className="rail-pane-header" onClick={toggle}>
                <span className="pane-title">{title}</span>
                <span className="pane-chevron">▲</span>
            </div>
            <div className="rail-pane-body">
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
        // Build once; rows are pushed via the effect below. columns/options are
        // captured at mount (views keep them stable), matching legacy view usage.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (tableRef.current && rows) tableRef.current.setRows(rows);
    }, [rows]);
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

/* Tabs (controlled). Every panel stays MOUNTED (inactive ones hidden via CSS) so
   editors/state inside survive tab switches — matches the vanilla tabs(). */
export function Tabs({ tabs, active, onActiveChange }) {
    // flex-based height chain (not height:100%) so editors/content fill even when
    // the parent's height is flex-computed — matches the vanilla tabs().
    return (
        <div className="tabs-wrap" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div className="tabs">
                {tabs.map((t, i) => (
                    <button key={i} className={'tab' + (i === active ? ' active' : '')}
                        onClick={() => onActiveChange(i)}>{t.label}</button>
                ))}
            </div>
            <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {tabs.map((t, i) => (
                    <div key={i} style={{ flex: 1, minHeight: 0, display: i === active ? 'flex' : 'none', flexDirection: 'column' }}>
                        {t.content}
                    </div>
                ))}
            </div>
        </div>
    );
}
