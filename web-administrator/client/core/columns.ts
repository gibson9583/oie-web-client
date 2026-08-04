/*
 * Resizable + reorderable columns for the hand-built `table.dt` grids
 * (Dashboard, Channels). The views render their header/body rows in a fixed
 * canonical column order; after the table is in the DOM they call
 * decorateColumns(), which:
 *   - switches the table to fixed layout with a <colgroup> for widths,
 *   - permutes each row's cells into the user's saved order,
 *   - draws drag-to-reorder and drag-to-resize affordances on the header,
 *   - persists order + widths per view in localStorage.
 *
 * Leading columns can be "pinned" (e.g. the expand twisty): they stay first and
 * are neither movable nor resizable.
 */

import { h, contextMenu } from './ui.js';
import type { MenuEntry } from './ui.js';

const PREFIX = 'webadmin-cols-';

/** Per-view persisted column state: order, widths, hidden set. */
export interface ColumnManager {
    /** Order `presentKeys` (canonical order) by the saved order. */
    order(presentKeys: string[]): string[];
    width(key: string): number;
    setWidth(key: string, px: number): void;
    setOrder(keys: string[]): void;
    isHidden(key: string): boolean;
    setHidden(key: string, v: boolean): void;
    reset(): void;
}

export interface ColumnMenuOptions {
    manager: ColumnManager;
    /** Full canonical column set ({ key, label }). */
    columns: Array<{ key: string; label?: string }>;
    onChange?: () => void;
    /** Column keys that can never be hidden. */
    pinnedKeys?: string[];
}

export interface DecorateColumnsOptions {
    manager: ColumnManager;
    /** Canonical order of the data columns actually rendered. */
    presentKeys: string[];
    /** Number of leading fixed (non-reorderable) columns. */
    pinned?: number;
    pinnedWidths?: number[];
    onChange?: () => void;
}

/** Per-view persistent column order + widths + hidden set. `defaults` maps key ->
    width px; `defaultHidden` lists keys hidden by default (Swing parity) until the
    user changes them. */
export function createColumnManager(storageKey: string, defaults: Record<string, number>, defaultHidden: string[] = []): ColumnManager {
    let order: string[] | null = null;        // saved data-column key order, or null = canonical
    let widths: Record<string, number> = {};
    let hidden = new Set<string>(defaultHidden);  // column keys hidden (seeded from defaults)
    try {
        const raw = JSON.parse(localStorage.getItem(PREFIX + storageKey) || '{}');
        if (Array.isArray(raw.order)) order = raw.order;
        if (raw.widths && typeof raw.widths === 'object') widths = raw.widths;
        if (Array.isArray(raw.hidden)) hidden = new Set(raw.hidden);
    } catch { /* defaults */ }

    function save(): void {
        try { localStorage.setItem(PREFIX + storageKey, JSON.stringify({ order, widths, hidden: [...hidden] })); }
        catch { /* private mode */ }
    }

    return {
        // Order `presentKeys` (canonical order) by the saved order. Saved keys
        // that aren't present are skipped; present keys not yet saved are appended.
        order(presentKeys: string[]): string[] {
            if (!order) return presentKeys.slice();
            const present = new Set(presentKeys);
            const out: string[] = [], seen = new Set<string>();
            for (const k of order) if (present.has(k) && !seen.has(k)) { out.push(k); seen.add(k); }
            for (const k of presentKeys) if (!seen.has(k)) out.push(k);
            return out;
        },
        width(key: string) { return widths[key] != null ? widths[key] : (defaults[key] || 120); },
        setWidth(key: string, px: number) { widths[key] = Math.max(40, Math.round(px)); save(); },
        setOrder(keys: string[]) { order = keys.slice(); save(); },
        isHidden(key: string) { return hidden.has(key); },
        setHidden(key: string, v: boolean) { if (v) hidden.add(key); else hidden.delete(key); save(); },
        reset() { order = null; widths = {}; hidden = new Set<string>(defaultHidden); save(); }
    };
}

/**
 * Wire a Swing MirthTable-style "show/hide columns + Restore Default" menu onto a
 * header element's right-click. `columns` is the full canonical [{key,label}] set;
 * `pinnedKeys` names columns that can never be hidden. Toggling a column (or
 * Restore Default) updates the manager and calls onChange so the view re-renders.
 */
export function attachColumnMenu(headerEl: HTMLElement, { manager, columns, onChange, pinnedKeys = [] }: ColumnMenuOptions): void {
    headerEl.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();   // don't fall through to a table-level context menu
        const toggleable = columns.filter(c => !pinnedKeys.includes(c.key));
        const visibleCount = toggleable.filter(c => !manager.isHidden(c.key)).length;
        const items: MenuEntry[] = toggleable.map(c => {
            const shown = !manager.isHidden(c.key);
            return {
                label: `${shown ? '✓  ' : '     '}${c.label || c.key}`,
                onClick: () => {
                    if (shown && visibleCount <= 1) return;   // keep at least one column visible
                    manager.setHidden(c.key, shown);
                    onChange && onChange();
                }
            };
        });
        items.push('-', { label: 'Restore Default', onClick: () => { manager.reset(); onChange && onChange(); } });
        contextMenu(e.clientX, e.clientY, items);
    });
}

/**
 * Make an already-rendered table's columns resizable + reorderable.
 *
 * opts:
 *   manager       — from createColumnManager
 *   presentKeys   — canonical-order keys of the data columns actually rendered
 *   pinned        — number of leading pinned (non-movable) columns (default 0)
 *   pinnedWidths  — widths (px) for the pinned columns
 *   onChange      — called after a reorder so the view can re-render
 */
export function decorateColumns(table: HTMLTableElement, opts: DecorateColumnsOptions): void {
    const { manager, presentKeys, pinned = 0, pinnedWidths = [], onChange } = opts;
    if (!table || !presentKeys.length) return;
    const displayOrder = manager.order(presentKeys);
    const canonIndex = new Map<string, number>(presentKeys.map((k, i) => [k, i]));

    // 1. Permute each row's data cells (those after the pinned leading cells).
    const permute = (tr: Element) => {
        const cells = [...tr.children];
        if (cells.length < pinned + presentKeys.length) return;   // unexpected shape
        const dataCells = cells.slice(pinned, pinned + presentKeys.length);   // canonical order
        for (const key of displayOrder) {
            const cell = dataCells[canonIndex.get(key)!];
            if (cell) tr.appendChild(cell);   // appendChild moves the node to the end
        }
    };
    const headTr = table.querySelector('thead > tr');
    if (headTr) permute(headTr);
    for (const tr of table.querySelectorAll('tbody > tr')) permute(tr);

    // 2. Fixed layout + <colgroup> so widths apply uniformly and cells clip.
    //    Every column gets an explicit width EXCEPT the last, which is left auto
    //    so it absorbs the remaining space and the table fills its container.
    const lastKey = displayOrder[displayOrder.length - 1];
    table.querySelector('colgroup')?.remove();
    const colgroup = h('colgroup');
    for (let i = 0; i < pinned; i++) {
        colgroup.appendChild(h('col', { style: { width: (pinnedWidths[i] || 26) + 'px' } }));
    }
    const colByKey = new Map<string, HTMLElement>();
    for (const key of displayOrder) {
        const col = key === lastKey ? h('col') : h('col', { style: { width: manager.width(key) + 'px' } });
        colgroup.appendChild(col);
        colByKey.set(key, col);
    }
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
    // Min width so the table scrolls (rather than crushing columns) when the
    // fixed widths exceed the viewport; the auto last column keeps an 80px floor.
    const syncMinWidth = () => {
        let min = 0;
        for (let i = 0; i < pinned; i++) min += (pinnedWidths[i] || 26);
        for (const key of displayOrder) min += (key === lastKey ? 80 : (parseFloat(colByKey.get(key)!.style.width) || manager.width(key)));
        table.style.minWidth = min + 'px';
    };
    syncMinWidth();
    table.classList.add('dt-resizable');

    // 3. Header cells: drag-to-reorder (all) + a right-edge resize grabber
    //    (all but the last/filler column).
    if (!headTr) return;
    const headCells = [...headTr.children].slice(pinned) as HTMLElement[];   // now in display order
    headCells.forEach((th, i) => {
        const key = displayOrder[i];
        th.draggable = true;
        th.dataset.colKey = key;

        th.addEventListener('dragstart', (e: DragEvent) => {
            e.dataTransfer!.effectAllowed = 'move';
            e.dataTransfer!.setData('text/plain', key);
            th.classList.add('col-dragging');
        });
        th.addEventListener('dragend', () => th.classList.remove('col-dragging'));
        th.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; th.classList.add('col-drop'); });
        th.addEventListener('dragleave', () => th.classList.remove('col-drop'));
        th.addEventListener('drop', (e: DragEvent) => {
            e.preventDefault();
            th.classList.remove('col-drop');
            const from = e.dataTransfer!.getData('text/plain');
            if (!from || from === key) return;
            const next = displayOrder.filter(k => k !== from);
            next.splice(next.indexOf(key), 0, from);   // drop before the target column
            manager.setOrder(next);
            onChange && onChange();
        });

        if (key === lastKey) return;   // filler column: no resize grabber

        const handle = h('div.col-resize');
        handle.addEventListener('click', (e: MouseEvent) => e.stopPropagation());      // don't trigger sort
        handle.addEventListener('dragstart', (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); });
        // Double-click the edge → auto-fit the column to its widest content.
        handle.addEventListener('dblclick', (e: MouseEvent) => {
            e.preventDefault(); e.stopPropagation();
            const cellIndex = pinned + i;
            let max = th.scrollWidth;
            for (const tr of table.querySelectorAll('tbody > tr')) {
                const c = tr.children[cellIndex];
                if (!c || (c as HTMLTableCellElement).colSpan > 1) continue;     // skip spanning (empty-state) cells
                max = Math.max(max, c.scrollWidth);
            }
            const w = Math.max(40, max + 10);
            colByKey.get(key)!.style.width = w + 'px';
            syncMinWidth();
            manager.setWidth(key, w);
        });
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            e.preventDefault(); e.stopPropagation();
            const startX = e.clientX;
            const col = colByKey.get(key);
            const startW = col ? parseFloat(col.style.width) : manager.width(key);
            document.body.style.cursor = 'col-resize';
            const move = (ev: MouseEvent) => {
                const w = Math.max(40, startW + (ev.clientX - startX));
                if (col) col.style.width = w + 'px';
                syncMinWidth();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                document.body.style.cursor = '';
                manager.setWidth(key, col ? parseFloat(col.style.width) : manager.width(key));
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        th.appendChild(handle);
    });
}
