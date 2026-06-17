/*
 * React UI primitives for ported views. Declarative bits (task panes, buttons,
 * fields) are native React with VERBATIM class names; the data grid wraps the
 * proven core/ui.js DataTable (mounts its .el, bridges selection → React state)
 * so the column-menu/sort/selection behavior — and its e2e coverage — carry over
 * unchanged. Imperative helpers (modal/confirm/toast/contextMenu) are called
 * directly from React handlers; no rewrite needed.
 */

import { useState, useEffect, useRef } from 'react';
import { Icon } from './bridges.jsx';
import { paneCollapsed } from './legacy-tasks.js';
import { DataTable } from '@oie/web-ui';

/* Collapsible rail pane (shared by the shell nav and React view task panes). */
export function RailPane({ title, paneKey, className, children }) {
    const k = paneKey || title;
    const [collapsed, setCollapsed] = useState(() => paneCollapsed.get(k) || false);
    const toggle = () => { const next = !collapsed; setCollapsed(next); paneCollapsed.set(k, next); };
    return (
        <div className={'rail-pane' + (collapsed ? ' collapsed' : '') + (className ? ' ' + className : '')}>
            <div className="rail-pane-header" onClick={toggle}>
                <span className="pane-title">{title}</span>
                <span className="pane-chevron">▲</span>
            </div>
            <div className="rail-pane-body">{children}</div>
        </div>
    );
}

/* Task-pane button (parity with core/ui.js taskButton). */
export function TaskButton({ label, icon, onClick, primary, danger }) {
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
