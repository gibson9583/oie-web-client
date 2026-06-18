/*
 * Pure-JSX hierarchical tree-table. Replaces the hand-built imperative table.dt
 * tree-grids (Dashboard / Channels / Code Templates / alert channels) with a
 * declarative React component: parent/child rows with expand/collapse twisties,
 * single-row selection, per-row + empty-space context menus, and a reusable
 * column manager (resizable / hideable / reorderable / persisted) reusing
 * core/columns.js createColumnManager for state — only the DOM rendering and the
 * resize/reorder/menu interactions are reimplemented in JSX (no ref-mounting).
 *
 * Props:
 *   columns      [{ key, label, align?, tree?, render(node) }] — `tree` column
 *                gets the depth indent + twisty; render() returns cell content.
 *   data         root nodes; children via getChildren(node).
 *   getChildren  (node) => array | undefined/null (leaf).
 *   rowKey       (node) => stable string key.
 *   rowClassName (node, depth) => extra <tr> classes (optional).
 *   selectedKey  currently-selected rowKey (or null).
 *   onSelect / onActivate / onRowContextMenu(node, e) / onEmptyContextMenu(e)
 *   columnsKey   localStorage key (createColumnManager storageKey).
 *   columnWidths { key: px } default widths.
 *   defaultHidden [key] hidden by default.
 *   pinnedKeys   [key] that can never be hidden/reordered (the tree column).
 *   emptyText    shown when data is empty.
 *   matches      optional (node) => bool filter; non-matching leaves are dropped,
 *                parents kept if they or a descendant match.
 */

import { useReducer, useRef, useState } from 'react';
import { createColumnManager, contextMenu } from '@oie/web-ui';
import { Icon } from './bridges.jsx';

export function TreeTable({
    columns, data, getChildren, rowKey, rowClassName,
    selectedKey, selectedKeys, onSelect, onActivate, onRowContextMenu, onEmptyContextMenu,
    rowDraggable, onRowDrop,
    columnsKey, columnWidths = {}, defaultHidden = [], pinnedKeys = [],
    emptyText = 'No items', matches, collapsedKeys, onToggleCollapse
}) {
    const [, force] = useReducer((x) => x + 1, 0);
    const mgrRef = useRef(null);
    if (!mgrRef.current) mgrRef.current = createColumnManager(columnsKey, columnWidths, defaultHidden);
    const mgr = mgrRef.current;
    // Collapse is controlled when onToggleCollapse is supplied (lets a view expand
    // a node programmatically); otherwise internal (default expanded).
    const internalCollapsed = useRef(new Set());
    const collapsed = collapsedKeys || internalCollapsed.current;
    const colRefs = useRef({});               // key -> <col> element (for live resize)

    const childrenOf = (node) => (getChildren ? getChildren(node) : node.children) || [];
    const hasKids = (node) => childrenOf(node).length > 0;

    // A node is kept under a filter if it matches or any descendant matches.
    const keep = (node) => {
        if (!matches) return true;
        if (matches(node)) return true;
        return childrenOf(node).some(keep);
    };

    // Opt-in sort: clicking a header whose column has sortValue() sorts siblings
    // at every level (nulls last). Default (sort.key null) keeps the data order.
    const [sort, setSort] = useState({ key: null, dir: 1 });
    const sortCol = sort.key ? columns.find((c) => c.key === sort.key && c.sortValue) : null;
    const sortNodes = (nodes) => {
        if (!sortCol) return nodes;
        return [...nodes].sort((a, b) => {
            const av = sortCol.sortValue(a), bv = sortCol.sortValue(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
    };

    // Flatten visible rows (respecting collapse + filter) into {node, depth, expandable}.
    const rows = [];
    const walk = (nodes, depth) => {
        for (const node of sortNodes(nodes)) {
            if (!keep(node)) continue;
            const key = rowKey(node);
            const expandable = hasKids(node);
            rows.push({ node, key, depth, expandable });
            if (expandable && !collapsed.has(key)) {
                // Under a filter, show only matching descendants (parent already kept).
                const kids = matches ? childrenOf(node).filter(keep) : childrenOf(node);
                walk(kids, depth + 1);
            }
        }
    };
    walk(data || [], 0);

    const visibleCols = mgr.order(columns.map((c) => c.key))
        .map((k) => columns.find((c) => c.key === k))
        .filter((c) => c && !mgr.isHidden(c.key));
    const lastKey = visibleCols.length ? visibleCols[visibleCols.length - 1].key : null;

    const toggle = (key) => {
        if (onToggleCollapse) { onToggleCollapse(key); return; }
        const s = internalCollapsed.current; if (s.has(key)) s.delete(key); else s.add(key); force();
    };

    /* ---- column menu (right-click header): show/hide + Restore Default ---- */
    const headerMenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const toggleable = columns.filter((c) => !pinnedKeys.includes(c.key));
        const visibleCount = toggleable.filter((c) => !mgr.isHidden(c.key)).length;
        const items = toggleable.map((c) => {
            const shown = !mgr.isHidden(c.key);
            return {
                label: `${shown ? '✓  ' : '     '}${c.label || c.key}`,
                onClick: () => { if (shown && visibleCount <= 1) return; mgr.setHidden(c.key, shown); force(); }
            };
        });
        items.push('-', { label: 'Restore Default', onClick: () => { mgr.reset(); force(); } });
        contextMenu(e.clientX, e.clientY, items);
    };

    /* ---- resize drag (live width via the <col> ref; commit on mouseup) ---- */
    const startResize = (e, key) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const col = colRefs.current[key];
        const startW = col ? parseFloat(col.style.width) || mgr.width(key) : mgr.width(key);
        document.body.style.cursor = 'col-resize';
        const move = (ev) => { const w = Math.max(40, startW + (ev.clientX - startX)); if (col) col.style.width = w + 'px'; };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.style.cursor = '';
            mgr.setWidth(key, col ? parseFloat(col.style.width) : startW);
            force();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    };

    /* ---- drag-to-reorder columns ---- */
    const onColDrop = (fromKey, toKey) => {
        if (!fromKey || fromKey === toKey || pinnedKeys.includes(fromKey)) return;
        const next = visibleCols.map((c) => c.key).filter((k) => k !== fromKey);
        next.splice(next.indexOf(toKey), 0, fromKey);
        mgr.setOrder(next);
        force();
    };

    if (!rows.length) {
        return (
            <div className="dt-wrap" onContextMenu={onEmptyContextMenu}>
                <div className="dt-empty">{emptyText}</div>
            </div>
        );
    }

    return (
        <div className="dt-wrap" onContextMenu={(e) => { if (!e.target.closest('tr') && onEmptyContextMenu) onEmptyContextMenu(e); }}>
            <table className="dt dt-resizable" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                    {visibleCols.map((c) => (
                        <col key={c.key}
                            ref={(el) => { colRefs.current[c.key] = el; }}
                            style={c.key === lastKey ? undefined : { width: mgr.width(c.key) + 'px' }} />
                    ))}
                </colgroup>
                <thead>
                    <tr onContextMenu={headerMenu}>
                        {visibleCols.map((c) => (
                            <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                                className={c.sortValue ? 'sortable' : undefined}
                                draggable={!pinnedKeys.includes(c.key)}
                                onDragStart={(e) => e.dataTransfer.setData('text/plain', c.key)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => { e.preventDefault(); onColDrop(e.dataTransfer.getData('text/plain'), c.key); }}
                                onClick={c.sortValue ? () => setSort((s) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 })) : undefined}>
                                {c.label}
                                {sort.key === c.key ? <span className="sort-arrow">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
                                {c.key !== lastKey
                                    ? <div className="col-resize" onMouseDown={(e) => startResize(e, c.key)}
                                        onClick={(e) => e.stopPropagation()} />
                                    : null}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ node, key, depth, expandable }) => {
                        const selected = selectedKeys ? selectedKeys.has(key) : (selectedKey != null && key === selectedKey);
                        const cls = ['', expandable ? 'group-row' : '', selected ? 'selected' : '',
                            rowClassName ? rowClassName(node, depth) : ''].filter(Boolean).join(' ');
                        const drag = rowDraggable && rowDraggable(node);
                        return (
                            <tr key={key} className={cls || undefined}
                                draggable={drag || undefined}
                                onDragStart={drag ? (e) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                                onDragOver={onRowDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                                onDrop={onRowDrop ? (e) => { e.preventDefault(); onRowDrop(e.dataTransfer.getData('text/plain'), node); } : undefined}
                                onClick={(e) => onSelect && onSelect(node, e)}
                                onDoubleClick={() => onActivate && onActivate(node)}
                                onContextMenu={(e) => onRowContextMenu && onRowContextMenu(node, e)}>
                                {visibleCols.map((c) => {
                                    const content = c.render ? c.render(node) : '';
                                    if (c.tree) {
                                        return (
                                            <td key={c.key}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: depth * 18 }}>
                                                    {expandable
                                                        ? <span className="twisty" style={{ cursor: 'pointer' }}
                                                            onClick={(e) => { e.stopPropagation(); toggle(key); }}>
                                                            {collapsed.has(key) ? '▸' : '▾'}</span>
                                                        : <span className="twisty" />}
                                                    {content}
                                                </span>
                                            </td>
                                        );
                                    }
                                    return <td key={c.key} className={c.mono ? 'mono' : undefined}
                                        style={c.align === 'right' ? { textAlign: 'right' } : undefined}>{content}</td>;
                                })}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// Convenience for the common name-cell content: an icon + label.
export function TreeLabel({ icon, label }) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={icon} size={14} /><span>{label}</span></span>;
}
