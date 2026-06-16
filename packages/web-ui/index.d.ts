/*
 * Type definitions for @oie/web-ui — the web admin UI framework: DOM toolkit,
 * tables, dialogs, forms, code editor, resizable columns, and the connector-
 * panel toolkit. Engine model objects are loose (`OieObject`, from
 * @oie/web-api); these types pin down the component/function surface.
 */

import type { OieObject, QueryParams } from '@oie/web-api';

/* ---- DOM toolkit (ui.js) --------------------------------------------------- */

export type Child = Node | string | number | null | undefined | Child[];
export interface ElementAttrs {
    [key: string]: any;
}

/**
 * Create an element from a `tag.class#id` spec, optional attrs, and children.
 * A non-plain-object second argument (string/number/Node/array) is treated as
 * the first child, so `h('div', 'text')` and `h('div', { class: 'x' }, child)`
 * both work.
 */
export function h(spec: string, ...children: Child[]): HTMLElement;
export function h(spec: string, attrs: ElementAttrs | null, ...children: Child[]): HTMLElement;
/** Remove all children of `el` and return it. */
export function clear<T extends Node>(el: T): T;
/** Render a named icon (size in px, default 16). */
export function icon(name: string, size?: number): SVGElement;

export function fmtNumber(n: number): string;
/** Format a date/timestamp in the user's selected time zone (Server/Local/UTC). */
export function fmtDate(value: any): string;
export function escapeHtml(s: string): string;

export type ToastType = 'info' | 'success' | 'warn' | 'error';
export function toast(message: string, type?: ToastType, timeout?: number): HTMLElement;

/* ---- dialogs --------------------------------------------------------------- */

export interface ModalButton {
    label: string;
    primary?: boolean;
    danger?: boolean;
    /** Return `false` to keep the dialog open; anything else closes it. */
    onClick?: () => boolean | void | Promise<boolean | void>;
}
export interface ModalOptions {
    title: string;
    body: Node | string;
    buttons?: ModalButton[];
    /** Extra size class, e.g. `'wide'`. */
    size?: string;
    onClose?: () => void;
}
export interface ModalHandle {
    close(): void;
    el: HTMLElement;
}
export function modal(options: ModalOptions): ModalHandle;

export function confirmDialog(
    title: string,
    message: string,
    opts?: { danger?: boolean; okLabel?: string }
): Promise<boolean>;
export function promptDialog(title: string, label: string, initial?: string): Promise<string | null>;

/* ---- context menu ---------------------------------------------------------- */

export interface ContextMenuItem {
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    hidden?: boolean;
    onClick?: () => void;
}
/** `'-'` renders a separator. */
export function contextMenu(x: number, y: number, items: Array<ContextMenuItem | '-'>): HTMLElement;
export function closeContextMenu(): void;

/* ---- tabs ------------------------------------------------------------------ */

export interface TabDef {
    label: string;
    render(): Node;
}
export interface TabsHandle {
    el: HTMLElement;
    select(index: number): void;
    readonly active: number;
}
export function tabs(
    defs: TabDef[],
    opts?: { onChange?: (index: number, def: TabDef) => void; active?: number }
): TabsHandle;

/* ---- data table ------------------------------------------------------------ */

export interface Column<T = any> {
    key: string;
    label: string;
    render?(row: T): Node | string | number | null | undefined;
    sortValue?(row: T): any;
    sortable?: boolean;
    className?: string;
    width?: string;
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
}
export class DataTable<T = any> {
    constructor(columns: Column<T>[], options?: DataTableOptions<T>);
    el: HTMLElement;
    rows: T[];
    setRows(rows: T[]): void;
    selectedRows(): T[];
    clearSelection(): void;
    key(row: T): string;
    render(): void;
}

/* ---- form helpers ---------------------------------------------------------- */

export function field(label: string, control: Node, hint?: string): HTMLElement;
export function textInput(value?: string, attrs?: ElementAttrs): HTMLInputElement;
export function numberInput(value?: string | number, attrs?: ElementAttrs): HTMLInputElement;
export type SelectOption = string | { value: any; label: string };
export function select(options: SelectOption[], value?: any, attrs?: ElementAttrs): HTMLSelectElement;
export interface CheckboxHandle {
    el: HTMLElement;
    input: HTMLInputElement;
}
export function checkbox(label: string, checked?: boolean, attrs?: ElementAttrs): CheckboxHandle;
export function taskButton(
    label: string,
    iconName?: string,
    onClick?: (e: MouseEvent) => void,
    opts?: { primary?: boolean; danger?: boolean; disabled?: boolean; title?: string }
): HTMLElement;

export function downloadFile(filename: string, content: string | Blob, type?: string): void;
/** Save with a native "Save As" picker where supported, else a normal download. */
export function saveFile(
    suggestedName: string,
    type: string,
    getContent: string | Blob | (() => string | Blob | Promise<string | Blob>)
): Promise<void>;
export function pickFile(accept?: string): Promise<{ name: string; content: string } | null>;
export function loading(text?: string): HTMLElement;

/* ---- resizable / reorderable columns (columns.js) -------------------------- */

export interface ColumnManager {
    [key: string]: any;
}
export interface DecorateColumnsOptions {
    manager: ColumnManager;
    /** Canonical order of the data columns. */
    presentKeys: string[];
    /** Number of leading fixed (non-reorderable) columns. */
    pinned?: number;
    pinnedWidths?: number[];
    onChange?: () => void;
}
export function createColumnManager(storageKey: string, defaults: Record<string, number>): ColumnManager;
export function decorateColumns(table: HTMLTableElement, opts: DecorateColumnsOptions): void;

/* ---- code editor (codeeditor.js) ------------------------------------------- */

export interface CodeEditorOptions {
    value?: string;
    onChange?(value: string): void;
    language?: string;
    minHeight?: string;
    [key: string]: any;
}
export class CodeEditor {
    constructor(opts?: CodeEditorOptions);
    el: HTMLElement;
    getValue(): string;
    setValue(value: string): void;
    focus(): void;
}
export function createCodeEditor(opts?: CodeEditorOptions): CodeEditor;
/** Swap the editor implementation app-wide (e.g. CodeMirror/Monaco). */
export function setCodeEditorFactory(fn: (opts?: CodeEditorOptions) => CodeEditor): void;

/* ---- connector-panel toolkit (connectors/forms.js) ------------------------- */

export interface FormField {
    key?: string;
    label?: string;
    /** Renders a section header instead of a field. */
    section?: string;
    type?: 'text' | 'select' | 'checkbox' | 'code' | string;
    options?: SelectOption[];
    width?: string;
    placeholder?: string;
    hint?: string;
    checkLabel?: string;
    minHeight?: string;
    /** Re-render the form when this field changes (for dependent visibility). */
    refresh?: boolean;
    visible?(properties: OieObject): boolean;
    [key: string]: any;
}
/** Render a schema-driven property form into `host`. */
export function buildForm(
    host: HTMLElement,
    properties: OieObject,
    fields: FormField[],
    onChange: (properties: OieObject) => void
): void;
/** The polling-schedule section for a source connector. */
export function pollSection(properties: OieObject, onChange: (properties: OieObject) => void): HTMLElement;
export function pollSettingsPanel(properties: OieObject, onChange: (properties: OieObject) => void): HTMLElement;

/** Default `sourceConnectorProperties` shape for the engine version. */
export function defaultSourceProperties(version: string, overrides?: OieObject): OieObject;
/** Default `destinationConnectorProperties` shape for the engine version. */
export function defaultDestinationProperties(version: string, overrides?: OieObject): OieObject;
export function defaultListenerProperties(version: string, port?: string | number): OieObject;
/** Default `pollConnectorProperties` shape for the engine version. */
export function defaultPollProperties(version: string): OieObject;

export const CHARSETS: Array<{ value: string; label: string }>;
export const YES_NO: Array<{ value: boolean; label: string }>;

export function asBool(value: any): boolean;
export function getPath(obj: any, path: string): any;
export function setPath(obj: any, path: string, value: any): void;
export function mapEntries(map: OieObject): Array<[string, any]>;
export function writeMapEntries(map: OieObject, rows: any[], shape?: string): void;
export function portsInUseButton(): HTMLElement;
export function successToast(message: string): HTMLElement;
export function apiErrorMessage(e: any): string;
export function postConnectorProperties(
    path: string,
    properties: OieObject,
    channel: OieObject,
    params?: QueryParams
): Promise<any>;
export function connectorTestButton(opts: {
    label?: string;
    icon?: string;
    path: string;
    channel: OieObject;
    properties: OieObject;
}): HTMLElement;
export function frameModeSampleFrame(tm: OieObject): string;
export function frameModeSettingsDialog(tm: OieObject, onChange: (tm: OieObject) => void): void;
