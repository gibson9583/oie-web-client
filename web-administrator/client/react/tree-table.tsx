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
    emptyText = 'No items', matches, collapsedKeys, onToggleCollapse,
    // Controlled sort (opt-in): pass `sort={{key,dir}}` + `onSort(key)` to let the
    // parent own sorting (it pre-sorts `data`, e.g. the dashboard keeping display and
    // shift-select order in sync). Omit both for TreeTable's built-in header sort.
    sort: controlledSort, onSort,
    // When true (default) every expandable row gets the bold/tinted `group-row`
    // style. Trees with multiple expandable levels (e.g. the dashboard, where
    // channels are also expandable) set this false and class only true group
    // rows via rowClassName.
    autoGroupRow = true
}: any) {
    const [, force] = useReducer((x: any) => x + 1, 0);
    const mgrRef = useRef<any>(null);
    if (!mgrRef.current) mgrRef.current = createColumnManager(columnsKey, columnWidths, defaultHidden);
    const mgr = mgrRef.current;
    // Manual double-click: selecting a row re-renders and replaces its cell
    // content, which breaks the native `dblclick` (its two clicks land on
    // different nodes). Detect it on the row's onClick — bound to the stable
    // <tr> — so activating a not-yet-selected row works on the first
    // double-click, anywhere on the row (the twisty stops propagation, so it's
    // excluded).
    const lastActivateRef = useRef({ key: null, t: 0 });
    // Collapse is controlled when onToggleCollapse is supplied (lets a view expand
    // a node programmatically); otherwise internal (default expanded).
    const internalCollapsed = useRef(new Set());
    const collapsed = collapsedKeys || internalCollapsed.current;
    const colRefs = useRef<any>({});               // key -> <col> element (for live resize)

    const childrenOf = (node: any) => (getChildren ? getChildren(node) : node.children) || [];
    const hasKids = (node: any) => childrenOf(node).length > 0;

    // A node is kept under a filter if it matches or any descendant matches.
    const keep = (node: any) => {
        if (!matches) return true;
        if (matches(node)) return true;
        return childrenOf(node).some(keep);
    };

    // Opt-in sort: clicking a header whose column has sortValue() sorts siblings
    // at every level (nulls last). Default (sort.key null) keeps the data order.
    const controlled = typeof onSort === 'function';
    const [internalSort, setInternalSort] = useState<any>({ key: null, dir: 1 });
    const sort = controlled ? (controlledSort || { key: null, dir: 1 }) : internalSort;
    const sortCol = sort.key ? columns.find((c: any) => c.key === sort.key && c.sortValue) : null;
    const sortNodes = (nodes: any) => {
        if (controlled || !sortCol) return nodes;   // parent pre-sorts in controlled mode
        return [...nodes].sort((a: any, b: any) => {
            const av = sortCol.sortValue(a), bv = sortCol.sortValue(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
    };

    // Flatten visible rows (respecting collapse + filter) into {node, depth, expandable}.
    const rows: any[] = [];
    const walk = (nodes: any, depth: any) => {
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

    const visibleCols = mgr.order(columns.map((c: any) => c.key))
        .map((k: any) => columns.find((c: any) => c.key === k))
        .filter((c: any) => c && !mgr.isHidden(c.key));
    const lastKey = visibleCols.length ? visibleCols[visibleCols.length - 1].key : null;

    // Floor the table to the sum of its column widths so a narrow viewport scrolls
    // the .dt-wrap horizontally instead of crushing every column to unreadable
    // truncation (mirrors core/columns.js syncMinWidth for the imperative tables).
    // The last column is auto-width, so give it an 80px floor.
    const minTableWidth = visibleCols.reduce(
        (sum: any, c: any) => sum + (c.key === lastKey ? 80 : mgr.width(c.key)), 0);

    const toggle = (key: any) => {
        if (onToggleCollapse) { onToggleCollapse(key); return; }
        const s = internalCollapsed.current; if (s.has(key)) s.delete(key); else s.add(key); force();
    };

    /* ---- keyboard: treegrid with ROW-level focus -----------------------------
       The table is the app's primary surface and used to be mouse-only: no row
       was focusable and no key did anything. Row focus (rather than cell focus)
       is the variant that fits a Swing-parity table — one tab stop for the whole
       grid, arrows walk rows, Right/Left open and close a branch.
       Focus MOVES without selecting; Space selects, Enter activates (what a
       double-click does). Keeping the two apart avoids firing a view's selection
       side effects — task panes, dashboard:selection — on every arrow press. */
    const bodyRef = useRef<any>(null);
    const [focusKey, setFocusKey] = useState<any>(null);
    const selectable = !!(onSelect || selectedKeys || selectedKey != null);

    // The single tab stop: the focused row, else the first selected row, else the
    // first row — so tabbing in lands somewhere meaningful.
    const focusedRow = rows.some((r: any) => r.key === focusKey) ? focusKey : null;
    const tabKey = focusedRow
        ?? (rows.find((r: any) => (selectedKeys ? selectedKeys.has(r.key) : r.key === selectedKey)) || rows[0] || {}).key;

    const focusIndex = (i: any) => {
        if (!rows.length) return;
        const n = Math.max(0, Math.min(i, rows.length - 1));
        setFocusKey(rows[n].key);
        const tr = bodyRef.current && bodyRef.current.children[n];
        if (tr && tr.focus) tr.focus();
    };

    const onBodyKeyDown = (e: any) => {
        const idx = rows.findIndex((r: any) => r.key === (focusedRow ?? tabKey));
        if (idx < 0) return;
        const row = rows[idx];
        const expanded = row.expandable && !collapsed.has(row.key);
        switch (e.key) {
            case 'ArrowDown': focusIndex(idx + 1); break;
            case 'ArrowUp': focusIndex(idx - 1); break;
            case 'Home': focusIndex(0); break;
            case 'End': focusIndex(rows.length - 1); break;
            case 'ArrowRight':
                // Closed branch opens; open branch steps into its first child.
                if (row.expandable && !expanded) toggle(row.key);
                else if (expanded) focusIndex(idx + 1);
                else return;
                break;
            case 'ArrowLeft':
                // Open branch closes; anything else walks out to its parent row.
                if (expanded) toggle(row.key);
                else {
                    for (let j = idx - 1; j >= 0; j--) {
                        if (rows[j].depth < row.depth) { focusIndex(j); break; }
                    }
                }
                break;
            case ' ':
                if (!selectable) return;
                onSelect && onSelect(row.node, e);
                break;
            case 'Enter':
                if (onActivate) onActivate(row.node);
                else if (selectable) onSelect && onSelect(row.node, e);
                else return;
                break;
            default: return;
        }
        e.preventDefault();
    };

    /* ---- column menu (right-click header): show/hide + Restore Default ---- */
    const headerMenu = (e: any) => {
        e.preventDefault();
        e.stopPropagation();
        const toggleable = columns.filter((c: any) => !pinnedKeys.includes(c.key));
        const visibleCount = toggleable.filter((c: any) => !mgr.isHidden(c.key)).length;
        const items = toggleable.map((c: any) => {
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
    const startResize = (e: any, key: any) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const col = colRefs.current[key];
        const startW = col ? parseFloat(col.style.width) || mgr.width(key) : mgr.width(key);
        document.body.style.cursor = 'col-resize';
        const move = (ev: any) => { const w = Math.max(40, startW + (ev.clientX - startX)); if (col) col.style.width = w + 'px'; };
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
    const onColDrop = (fromKey: any, toKey: any) => {
        if (!fromKey || fromKey === toKey || pinnedKeys.includes(fromKey)) return;
        const next = visibleCols.map((c: any) => c.key).filter((k: any) => k !== fromKey);
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
        <div className="dt-wrap" onContextMenu={(e: any) => { if (!e.target.closest('tr') && onEmptyContextMenu) onEmptyContextMenu(e); }}>
            {/* treegrid, not table: the rows are a selectable, expandable hierarchy,
                and each <td> is a gridcell rather than a static cell. */}
            <table className="dt dt-resizable" role="treegrid"
                aria-multiselectable={selectedKeys ? 'true' : undefined}
                style={{ tableLayout: 'fixed', width: '100%', minWidth: minTableWidth + 'px' }}>
                <colgroup>
                    {visibleCols.map((c: any) => (
                        <col key={c.key}
                            ref={(el: any) => { colRefs.current[c.key] = el; }}
                            style={c.key === lastKey ? undefined : { width: mgr.width(c.key) + 'px' }} />
                    ))}
                </colgroup>
                <thead>
                    <tr onContextMenu={headerMenu}>
                        {visibleCols.map((c: any) => (
                            <th key={c.key} scope="col"
                                style={c.align === 'right' ? { textAlign: 'right' } : undefined}
                                className={c.sortValue ? 'sortable' : undefined}
                                // Which way a column is sorted, and that it can be
                                // sorted at all, was previously visual only.
                                aria-sort={c.sortValue
                                    ? (sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none')
                                    : undefined}
                                // A sortable header is an activatable control, so it
                                // needs to be reachable and operable by keyboard.
                                tabIndex={c.sortValue ? 0 : undefined}
                                draggable={!pinnedKeys.includes(c.key)}
                                onDragStart={(e: any) => e.dataTransfer.setData('text/plain', c.key)}
                                onDragOver={(e: any) => e.preventDefault()}
                                onDrop={(e: any) => { e.preventDefault(); onColDrop(e.dataTransfer.getData('text/plain'), c.key); }}
                                onKeyDown={c.sortValue ? (e: any) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    if (controlled) onSort(c.key);
                                    else setInternalSort((s: any) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 }));
                                } : undefined}
                                onClick={c.sortValue ? () => (controlled ? onSort(c.key) : setInternalSort((s: any) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 }))) : undefined}>
                                {c.label}
                                {/* Decorative: aria-sort carries the state, and leaving the
                                    glyph exposed would append "▲" to the header's name. */}
                                {sort.key === c.key ? <span className="sort-arrow" aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
                                {c.key !== lastKey
                                    ? <div className="col-resize" onMouseDown={(e: any) => startResize(e, c.key)}
                                        onClick={(e: any) => e.stopPropagation()} />
                                    : null}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody ref={bodyRef} onKeyDown={onBodyKeyDown}>
                    {rows.map(({ node, key, depth, expandable }) => {
                        const selected = selectedKeys ? selectedKeys.has(key) : (selectedKey != null && key === selectedKey);
                        const cls = ['', (expandable && autoGroupRow) ? 'group-row' : '', selected ? 'selected' : '',
                            rowClassName ? rowClassName(node, depth) : ''].filter(Boolean).join(' ');
                        const drag = rowDraggable && rowDraggable(node);
                        return (
                            <tr key={key} className={cls || undefined}
                                role="row"
                                aria-level={depth + 1}
                                aria-expanded={(expandable ? String(!collapsed.has(key)) : undefined) as any}
                                aria-selected={(selectable ? String(selected) : undefined) as any}
                                // Roving: one row in the tab order at a time.
                                tabIndex={key === tabKey ? 0 : -1}
                                onFocus={() => { if (key !== focusKey) setFocusKey(key); }}
                                draggable={drag || undefined}
                                onDragStart={drag ? (e: any) => { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'move'; } : undefined}
                                onDragOver={onRowDrop ? (e: any) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
                                onDrop={onRowDrop ? (e: any) => { e.preventDefault(); onRowDrop(e.dataTransfer.getData('text/plain'), node); } : undefined}
                                onClick={(e: any) => {
                                    onSelect && onSelect(node, e);
                                    if (!onActivate) return;
                                    const now = Date.now();
                                    const last = lastActivateRef.current;
                                    if (last.key === key && now - last.t < 400) {
                                        lastActivateRef.current = { key: null, t: 0 };
                                        onActivate(node);
                                    } else {
                                        lastActivateRef.current = { key, t: now };
                                    }
                                }}
                                onContextMenu={(e: any) => onRowContextMenu && onRowContextMenu(node, e)}>
                                {visibleCols.map((c: any) => {
                                    const content = c.render ? c.render(node) : '';
                                    if (c.tree) {
                                        return (
                                            <td key={c.key}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: depth * 18 }}>
                                                    {expandable
                                                        // aria-hidden: the row's aria-expanded already
                                                        // carries the state; the glyph would only add
                                                        // a stray "▸" to the announcement.
                                                        ? <span className="twisty" aria-hidden="true" style={{ cursor: 'pointer' }}
                                                            onClick={(e: any) => { e.stopPropagation(); toggle(key); }}>
                                                            {collapsed.has(key) ? '▸' : '▾'}</span>
                                                        : <span className="twisty" aria-hidden="true" />}
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
export function TreeLabel({ icon, label }: any) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name={icon} size={14} /><span>{label}</span></span>;
}
