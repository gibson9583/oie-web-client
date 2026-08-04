import { icon } from './icons.js';
import type { ColumnManager } from './columns.js';
export type Child = Node | string | number | boolean | null | undefined | Child[];
export interface ElementAttrs {
    [key: string]: any;
}
export type ToastType = 'info' | 'success' | 'warn' | 'error';
/**
 * What the transient-UI factories return: the rendered element (available
 * immediately) and a close() that dismisses it and runs onClose.
 */
export interface UiHandle {
    close(): void;
    el: HTMLElement;
}
export interface ModalButton {
    label: string;
    primary?: boolean;
    danger?: boolean;
    /** Return `false` to keep the dialog open; anything else closes it. */
    onClick?: () => boolean | void | Promise<boolean | void>;
}
export interface ModalOptions {
    title?: string | Node;
    body: Node | string;
    buttons?: ModalButton[];
    /** Extra size class, e.g. `'wide'`. */
    size?: string;
    onClose?: () => void;
    /** Accessible name when `title` is a Node (aria-label). */
    label?: string;
}
export interface ModalHandle extends UiHandle {
}
/**
 * RBAC gating tags shared by every actionable surface — task-pane buttons,
 * context-menu items, and (via @oie/web-shell) nav items and dashboard tabs.
 * `task` is the Swing TaskConstants action identifier; `group` the task-pane
 * key. checkTask(group, task) returning false HIDES the item. See RBAC.md.
 */
export interface TaskRef {
    /** Swing TaskConstants action identifier (e.g. `"doNewChannel"`). Omit = ungated. */
    task?: string;
    /** Task-pane group key (e.g. `"channel"`, `"settings_Server"`). Optional. */
    group?: string;
}
export interface ContextMenuItem extends TaskRef {
    label?: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    hidden?: boolean;
    /** Non-interactive heading row (e.g. "signed in as"), with optional sub line. */
    header?: boolean;
    sub?: string;
    onClick?: () => void;
}
export type MenuEntry = ContextMenuItem | '-';
export interface TabDef {
    label: string;
    render(): Node;
}
export interface TabsHandle {
    el: HTMLElement;
    select(index: number): void;
    readonly active: number;
}
export interface Column<T = any> {
    key: string;
    label: string;
    render?(row: T): Node | string | number | null | undefined;
    sortValue?(row: T): any;
    sortable?: boolean;
    className?: string;
    width?: string;
    /** Hidden until the user shows it (Swing parity). */
    defaultHidden?: boolean;
}
export interface DataTableOptions<T = any> {
    selectable?: 'single' | 'multi' | false;
    onSelect?(rows: T[]): void;
    onActivate?(row: T): void;
    onContextMenu?(row: T, event: MouseEvent): void;
    rowKey?(row: T): string;
    emptyText?: string;
    /** Enable the header column-visibility menu. */
    columnsMenu?: boolean;
    /** localStorage key to persist hidden columns. */
    columnsMenuKey?: string;
    /** Opt-in resizable + reorderable columns, persisted under this key. */
    columnsKey?: string;
}
export type SelectOption = string | {
    value: any;
    label: string;
};
export interface CheckboxHandle {
    el: HTMLElement;
    input: HTMLInputElement;
}
export declare function h(spec: string, ...children: Child[]): HTMLElement;
export declare function h(spec: string, attrs: ElementAttrs | null, ...children: Child[]): HTMLElement;
export declare function clear<T extends Node>(el: T): T;
export { icon };
export declare function fmtNumber(n: number | string | null | undefined): string;
export declare function fmtDate(value: any): string;
export declare function escapeHtml(s: unknown): string;
/** Register the app's toast renderer. Pass null to fall back to the DOM one. */
export declare function setToastRenderer(fn: ((message: string, type: ToastType, timeout: number) => UiHandle) | null): void;
export declare function toast(message: any, type?: ToastType, timeout?: number): UiHandle | HTMLElement;
/** Register the app's dialog renderer. Pass null to fall back to the DOM one. */
export declare function setDialogRenderer(fn: ((options: ModalOptions) => ModalHandle) | null): void;
export declare function modal(opts: ModalOptions): ModalHandle;
export declare function confirmDialog(title: string, message: unknown, { danger, okLabel }?: {
    danger?: boolean;
    okLabel?: string;
}): Promise<boolean>;
export declare function promptDialog(title: string, label: string, initial?: string): Promise<string | null>;
/**
 * A read-only detail dialog for an error or long message, styled like the
 * Server Log Entry modal: an optional severity badge + a dim meta line, one or
 * more labeled monospace blocks (scrollable), and Copy + Close. Use it instead
 * of a corner toast whenever the content is long, multi-line, or important
 * enough to demand acknowledgement — validation errors, deploy failures, etc.
 *
 *   title    dialog title
 *   badge    { text, tone } — tone 'err' | 'warn' | 'ok' | 'info' (optional)
 *   meta     small dim line beside the badge, e.g. a name/timestamp (optional)
 *   sections [{ label?, text }]  one labeled <pre> block each
 *   copy     text the Copy button writes (defaults to the sections joined)
 */
export interface DetailSection {
    label?: string;
    text: unknown;
}
export interface DetailModalOptions {
    title?: string;
    badge?: {
        text: string;
        tone?: 'err' | 'warn' | 'ok' | 'info';
    };
    meta?: unknown;
    sections?: DetailSection[];
    copy?: string;
}
export declare function detailModal({ title, badge, meta, sections, copy }?: DetailModalOptions): ModalHandle;
/** Show an engine/operation error (deploy failure, etc.) in the detail modal —
 *  a red ERROR badge + the full message. Shorthand over detailModal for the
 *  common "long engine exception" case that must never go in a corner toast. */
export declare function errorModal(title: string, error: any, meta?: unknown): ModalHandle;
type ContextMenuRenderer = (menu: {
    x: number;
    y: number;
    items: MenuEntry[];
}) => {
    close(options?: {
        restore?: boolean;
    }): void;
    el?: HTMLElement;
};
/** Register the app's context-menu renderer. Pass null for the DOM one. */
export declare function setContextMenuRenderer(fn: ContextMenuRenderer | null): void;
export declare function contextMenu(x: number, y: number, items: MenuEntry[], group?: string): HTMLElement | null;
export declare function closeContextMenu({ restore }?: {
    restore?: boolean;
}): void;
export declare function tabs(defs: TabDef[], { onChange, active, label }?: {
    onChange?: (index: number, def: TabDef) => void;
    active?: number;
    label?: string;
}): TabsHandle;
/**
 * DataTable — dense, sortable, selectable grid.
 *
 * columns: [{ key, label, render?(row), sortValue?(row), className?, width? }]
 * options: { selectable: 'single'|'multi'|false, onSelect(rows), onActivate(row),
 *            onContextMenu(row, event), rowKey(row), emptyText }
 */
export declare class DataTable<T = any> {
    columns: Column<T>[];
    options: DataTableOptions<T>;
    rows: T[];
    selected: Set<string>;
    sortKey: string | null;
    sortDir: number;
    defaultHidden: Set<string>;
    hidden: Set<string>;
    manager: ColumnManager | null;
    el: HTMLElement;
    lastKey?: string;
    constructor(columns: Column<T>[], options?: DataTableOptions<T>);
    visibleColumns(): Column<T>[];
    saveHidden(): void;
    openColumnsMenu(e: MouseEvent): void;
    setRows(rows: T[] | null | undefined): void;
    key(row: T): string;
    selectedRows(): T[];
    clearSelection(): void;
    sortedRows(): T[];
    render(): void;
    handleSelect(row: T, e: MouseEvent): void;
}
export declare function field(label: string | Node, control: Node, hint?: string): HTMLElement;
export declare function textInput(value?: string, attrs?: ElementAttrs): HTMLInputElement;
export declare function numberInput(value?: string | number, attrs?: ElementAttrs): HTMLInputElement;
export declare function select(options: SelectOption[], value?: any, attrs?: ElementAttrs): HTMLSelectElement;
export declare function checkbox(label: string, checked?: boolean, attrs?: ElementAttrs): CheckboxHandle;
export declare function taskButton(label: string, iconName?: string | null, onClick?: (e: MouseEvent) => void, opts?: TaskRef & {
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
}): HTMLElement | null;
export declare function downloadFile(filename: string, content: Blob | string | BlobPart, type?: string): void;
export declare function saveFile(suggestedName: string, type: string, getContent: string | Blob | (() => string | Blob | Promise<string | Blob>)): Promise<void>;
export declare function pickFile(accept?: string, { binary }?: {
    binary?: boolean;
}): Promise<{
    name: string;
    content: string;
} | null>;
export declare function loading(text?: string): HTMLElement;
