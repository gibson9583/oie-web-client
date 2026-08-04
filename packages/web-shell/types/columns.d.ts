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
    columns: Array<{
        key: string;
        label?: string;
    }>;
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
export declare function createColumnManager(storageKey: string, defaults: Record<string, number>, defaultHidden?: string[]): ColumnManager;
/**
 * Wire a Swing MirthTable-style "show/hide columns + Restore Default" menu onto a
 * header element's right-click. `columns` is the full canonical [{key,label}] set;
 * `pinnedKeys` names columns that can never be hidden. Toggling a column (or
 * Restore Default) updates the manager and calls onChange so the view re-renders.
 */
export declare function attachColumnMenu(headerEl: HTMLElement, { manager, columns, onChange, pinnedKeys }: ColumnMenuOptions): void;
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
export declare function decorateColumns(table: HTMLTableElement, opts: DecorateColumnsOptions): void;
