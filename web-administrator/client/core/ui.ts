/*
 * Tiny DOM toolkit + shared components (no framework, no build step).
 *
 *   h('div.cls#id', {attrs}, ...children)   create elements
 *   DataTable                                sortable/selectable data grid
 *   Tabs, Modal, confirm, prompt, toast, contextMenu, field helpers
 */

import { icon } from './icons.js';
import { formatInZone } from './timezone.js';
import { checkTask } from './authorization.js';
// columns.js imports h/contextMenu from here; the cycle is safe because both
// sides only use the imported bindings at call time, never at module load.
import { createColumnManager, decorateColumns, attachColumnMenu } from './columns.js';
import { scopedKey } from './store.js';
import type { ColumnManager } from './columns.js';

/* ---- public types ----------------------------------------------------------
   These ARE the @oie/web-ui contract for this module — the package's
   declarations are emitted from here. */

export type Child = Node | string | number | boolean | null | undefined | Child[];
export interface ElementAttrs { [key: string]: any; }

export type ToastType = 'info' | 'success' | 'warn' | 'error';

/**
 * What the transient-UI factories return: the rendered element (available
 * immediately) and a close() that dismisses it and runs onClose.
 */
export interface UiHandle { close(): void; el: HTMLElement; }

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
export interface ModalHandle extends UiHandle {}

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
    /** Nested submenu ("Select for Compare ▸"). The item itself is then a
        disclosure, not a command — any `onClick` on it is ignored. Children are
        RBAC-filtered like any other item, and a submenu left with nothing to
        show is dropped along with its parent. */
    items?: MenuEntry[];
    onClick?: () => void;
}
export type MenuEntry = ContextMenuItem | '-';

export interface TabDef { label: string; render(): Node; }
export interface TabsHandle { el: HTMLElement; select(index: number): void; readonly active: number; }

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

export type SelectOption = string | { value: any; label: string };
export interface CheckboxHandle { el: HTMLElement; input: HTMLInputElement; }

/* ---- element builder -------------------------------------------------------- */

export function h(spec: string, ...children: Child[]): HTMLElement;
export function h(spec: string, attrs: ElementAttrs | null, ...children: Child[]): HTMLElement;
export function h(spec: string, attrs?: ElementAttrs | Child | null, ...children: Child[]): HTMLElement {
    let tag = 'div';
    const classes: string[] = [];
    let id: string | null = null;
    for (const part of String(spec).split(/(?=[.#])/)) {
        if (part.startsWith('.')) classes.push(part.slice(1));
        else if (part.startsWith('#')) id = part.slice(1);
        else if (part) tag = part;
    }
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(' ');

    if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) {
        children.unshift(attrs as Child);
        attrs = null;
    }
    for (const [key, value] of Object.entries((attrs as ElementAttrs) || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key.startsWith('on') && typeof value === 'function') {
            el.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'class') {
            // Merge with classes from the spec string instead of replacing them.
            for (const cls of String(value).split(/\s+/)) if (cls) el.classList.add(cls);
        } else if (key === 'style' && typeof value === 'object') {
            Object.assign(el.style, value);
        } else if (key === 'dataset') {
            Object.assign(el.dataset, value);
        } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected' || key === 'readOnly') {
            (el as any)[key] = value;
        } else {
            el.setAttribute(key, value === true ? '' : String(value));
        }
    }
    append(el, children);
    return el;
}

function append(el: Element, children: Child[]): void {
    for (const child of children) {
        if (child === null || child === undefined || child === false || child === true) continue;
        if (Array.isArray(child)) append(el, child);
        else if (child instanceof Node) el.appendChild(child);
        else el.appendChild(document.createTextNode(String(child)));
    }
}

export function clear<T extends Node>(el: T): T { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export { icon };

/* ---- formatting helpers ------------------------------------------------------- */

export function fmtNumber(n: number | string | null | undefined): string {
    if (n === null || n === undefined || n === '') return '0';
    return Number(n).toLocaleString();
}

export function fmtDate(value: any): string {
    if (value === null || value === undefined || value === '') return '';
    let millis = value;
    if (typeof value === 'object') millis = value.time ?? value.timestamp ?? null; // Calendar JSON
    if (millis === null) return '';
    const d = new Date(Number(millis));
    if (isNaN(d.getTime())) return String(value);
    // Rendered in the user's chosen time zone (Server / Local / UTC).
    return formatInZone(d);
}

export function escapeHtml(s: unknown): string {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    } as Record<string, string>)[c]);
}

/* ---- toast notifications --------------------------------------------------------- */

let toastHost: HTMLElement | null = null;

/* Rendered by Radix Toast when the app registers its renderer — same reason as
   setDialogRenderer below: this module cannot import React. The DOM version
   stays as the fallback. */
let toastRenderer: ((message: string, type: ToastType, timeout: number) => UiHandle) | null = null;

/** Register the app's toast renderer. Pass null to fall back to the DOM one. */
export function setToastRenderer(fn: ((message: string, type: ToastType, timeout: number) => UiHandle) | null): void { toastRenderer = fn; }

/* Low-level corner toast: transient, non-blocking. Used for info/success and
   for feedback that must never steal focus (e.g. clipboard results).
   Exported for the narrow case toast() cannot serve: a WARNING that is about the
   user's own click rather than the engine — a guard on a mis-click — where the
   acknowledge-to-dismiss dialog below would be an interruption out of all
   proportion, and would land a dialog on top of whatever the click was aimed at.
   Anything the user must not miss still goes through toast(msg, 'warn'). */
export function cornerToast(message: string, type: ToastType = 'info', timeout = 4200): UiHandle {
    if (toastRenderer) return toastRenderer(String(message), type, timeout);
    return domCornerToast(message, type, timeout);
}

function domCornerToast(message: string, type: ToastType, timeout: number): UiHandle {
    if (!toastHost) {
        // A polite live region, or none of this reaches a screen reader: these are
        // the app's only confirmation that a save/deploy/copy actually happened.
        // aria-atomic=false so a second toast announces on its own rather than
        // re-reading the whole stack.
        toastHost = h('div.toasts', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'false' });
        document.body.appendChild(toastHost);
    }
    const name = (type === 'error' || type === 'warn') ? 'warning' : 'check';
    const el = h(`div.toast.${type}`, icon(name, 15), h('div.toast-msg', String(message)));
    toastHost.appendChild(el);
    setTimeout(() => {
        el.style.transition = 'opacity 0.25s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 260);
    }, timeout);
    return { el, close: () => el.remove() };
}

/*
 * Notifications. Errors and warnings are surfaced in the readable,
 * acknowledge-to-dismiss detail modal (the Server Log Entry look) instead of a
 * corner toast, so long engine exceptions and important notices can't be missed
 * or scroll away. Info/success stay as transient corner toasts. Callers that
 * want a specific title/metadata call detailModal/errorModal directly (e.g. the
 * deploy and validation flows); a plain toast(msg, 'error'|'warn') gets a
 * generic Error/Warning dialog.
 */
export function toast(message: any, type: ToastType = 'info', timeout = 4200): UiHandle {
    if (type === 'error' || type === 'warn') {
        return detailModal({
            title: type === 'error' ? 'Error' : 'Warning',
            badge: { text: type === 'error' ? 'Error' : 'Warning', tone: type === 'error' ? 'err' : 'warn' },
            sections: [{ text: String(message) }]
        });
    }
    return cornerToast(message, type, timeout);
}

/* ---- modal dialogs ------------------------------------------------------------------ */

/* Focusable descendants, in DOM order — the tab ring for a trapped dialog.
   Deliberately not a generic selector library: this is the set the app builds. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function focusable(root: Element): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

let modalSeq = 0;     // unique ids for aria-labelledby

/* The app renders dialogs with Radix, but this module cannot import it: plugins
   load core/ui.js as a URL module and resolve bare specifiers through the page
   import map, which carries no `react` and no `@radix-ui/*`. So the app registers
   its renderer here at boot and every modal() call — including confirmDialog,
   promptDialog, detailModal and errorModal, which are built on this one — is
   rendered by Radix without a single call site changing. The DOM implementation
   below stays as the fallback for anything running without the React shell. */
let dialogRenderer: ((options: ModalOptions) => ModalHandle) | null = null;

/** Register the app's dialog renderer. Pass null to fall back to the DOM one. */
export function setDialogRenderer(fn: ((options: ModalOptions) => ModalHandle) | null): void { dialogRenderer = fn; }

export function modal(opts: ModalOptions): ModalHandle {
    return dialogRenderer ? dialogRenderer(opts) : domModal(opts);
}

function domModal({ title, body, buttons = [], size = '', onClose, label }: ModalOptions): ModalHandle {
    const overlay = h('div.modal-overlay');
    // The element to hand focus back to. Captured before the dialog mounts, so
    // dismissing returns the caret to whatever opened it (Swing does the same).
    const opener = document.activeElement as HTMLElement | null;
    const titleId = 'modal-title-' + (++modalSeq);
    let closed = false;

    const close = () => {
        if (closed) return;                       // idempotent: overlay click + button can race
        closed = true;
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        syncAppHidden();          // a nested confirm closing must not un-hide the app
        if (opener && opener.isConnected && opener.focus) opener.focus();
        onClose && onClose();
    };

    const dialog = h(`div.modal${size ? '.' + size : ''}`, {
        role: 'dialog',
        'aria-modal': 'true',
        // -1 so the dialog itself can take focus when it holds no controls.
        tabindex: '-1',
        // Prefer the visible title; `label` covers dialogs built with a node title.
        ...(label ? { 'aria-label': label } : { 'aria-labelledby': titleId })
    },
        h('div.modal-header', h('span', { id: titleId }, title),
            h('button.icon-btn', { onClick: close, title: 'Close', 'aria-label': 'Close' }, icon('x'))),
        h('div.modal-body', body),
        buttons.length ? h('div.modal-foot', buttons.map(btn =>
            h(`button.btn${btn.primary ? '.btn-primary' : ''}${btn.danger ? '.btn-danger' : ''}`, {
                onClick: async () => {
                    const result = btn.onClick ? await btn.onClick() : true;
                    if (result !== false) close();
                }
            }, btn.label))) : null
    );

    /* Escape closes; Tab cycles inside the dialog instead of walking out into the
       page behind the overlay. One listener, removed by close() — NOT only on the
       Escape path, or every dialog dismissed another way leaves a live handler
       that re-runs close()/onClose() on the next Escape anywhere in the app. */
    // Nested dialogs both listen on document, so each one only acts when it is the
    // topmost overlay — otherwise one Escape would close the whole stack.
    const isTopmost = () => {
        const all = document.querySelectorAll('.modal-overlay');
        return !all.length || all[all.length - 1] === overlay;
    };

    function onKeyDown(e: KeyboardEvent): void {
        if (!isTopmost()) return;
        if (e.key === 'Escape') { close(); return; }
        if (e.key !== 'Tab') return;
        const ring = focusable(dialog);
        if (!ring.length) { e.preventDefault(); return; }
        const first = ring[0];
        const last = ring[ring.length - 1];
        const active = document.activeElement;
        if (!active || !dialog.contains(active)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }

    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (e: MouseEvent) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    syncAppHidden();
    document.addEventListener('keydown', onKeyDown);

    /* Initial focus inside the dialog, so the trap has somewhere to start and a
       screen reader announces the dialog rather than the page behind it. A form
       field wins over the header's Close button — that's where the caret belongs
       in a prompt, and it saves callers a deferred focus() of their own. */
    const ring = focusable(dialog);
    const field = ring.find((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    (field || ring[0] || dialog).focus();

    return { close, el: dialog };
}

/* Hide the app from assistive tech while a dialog owns the screen — otherwise a
   screen reader walks straight past the dialog into the page behind it. `inert`
   would also block pointer/focus, but the overlay does that visually and the Tab
   trap does it for the keyboard; this is the announce-ability half. Dialogs live
   in document.body, outside #app, so they stay reachable.

   Derived from the DOM rather than a counter, so it is self-healing: if an
   overlay is ever removed by something other than close() (a React unmount, a
   navigation), the next open or close puts the attribute back in step. */
function syncAppHidden(): void {
    const app = document.getElementById('app') || document.querySelector('.shell');
    if (!app) return;
    if (document.querySelector('.modal-overlay')) app.setAttribute('aria-hidden', 'true');
    else app.removeAttribute('aria-hidden');
}

export function confirmDialog(title: string, message: unknown, { danger = false, okLabel = 'OK' }: { danger?: boolean; okLabel?: string } = {}): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        modal({
            title,
            body: h('div', String(message)),
            onClose: () => resolve(false),
            buttons: [
                { label: 'Cancel', onClick: () => { resolve(false); } },
                { label: okLabel, primary: !danger, danger, onClick: () => { resolve(true); } }
            ]
        });
    });
}

export function promptDialog(title: string, label: string, initial = ''): Promise<string | null> {
    return new Promise<string | null>(resolve => {
        const input = h('input', { type: 'text', value: initial }) as HTMLInputElement;
        const m = modal({
            title,
            body: h('div.field', h('label', label), input),
            onClose: () => resolve(null),
            buttons: [
                { label: 'Cancel', onClick: () => { resolve(null); } },
                { label: 'OK', primary: true, onClick: () => { resolve(input.value); } }
            ]
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') { resolve(input.value); m.close(); }
        });
        // No deferred focus() here: modal() focuses the first form field as it
        // mounts. A setTimeout focus can land mid-keystroke and yank the caret
        // back to this field after the user has already moved on.
    });
}

/* Copy text to the clipboard with a small toast — shared by detail modals.
   writeText is async and can reject (permissions policy, non-secure context):
   await it so the toast reports what actually happened, not a false "Copied". */
async function copyToClipboard(text: unknown): Promise<void> {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(String(text));
            toast('Copied to clipboard');
            return;
        }
    } catch { /* fall through to the unavailable notice */ }
    toast('Clipboard unavailable', 'warn');
}

const DETAIL_TONE: Record<string, string> = { err: 'var(--err)', warn: 'var(--warn)', ok: 'var(--ok)', info: 'var(--accent)' };

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
export interface DetailSection { label?: string; text: unknown; }
export interface DetailModalOptions {
    title?: string;
    badge?: { text: string; tone?: 'err' | 'warn' | 'ok' | 'info' };
    meta?: unknown;
    sections?: DetailSection[];
    copy?: string;
}
export function detailModal({ title, badge, meta, sections = [], copy }: DetailModalOptions = {}): ModalHandle {
    const preClass = 'mono m-0 whitespace-pre-wrap [word-break:break-word] overflow-x-hidden '
        + 'overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px] '
        + 'max-h-[50vh] text-[11px]';
    const tone = badge ? (DETAIL_TONE[badge.tone || ''] || 'var(--text)') : null;
    const badgeEl = badge
        ? h('span.tag', { class: 'font-[650]', style: { color: tone, borderColor: tone } },
            String(badge.text).toUpperCase())
        : null;
    const copyText = copy != null ? copy : sections.map(s => s.text).join('\n\n');
    return modal({
        title,
        size: 'wide',
        body: h('div', { class: 'flex flex-col gap-2 min-w-[558px] max-w-[80vw]' },
            (badge || meta) ? h('div', { class: 'flex gap-[13px] items-center flex-wrap' },
                badgeEl, meta ? h('span.mono.text-text-faint', String(meta)) : null) : null,
            ...sections.flatMap(s => [
                s.label ? h('div', { class: 'font-semibold' }, s.label) : null,
                h('pre', { class: preClass }, String(s.text ?? ''))
            ])),
        buttons: [
            { label: 'Copy', onClick: () => { copyToClipboard(copyText); return false; } },
            { label: 'Close', primary: true }
        ]
    });
}

/** Show an engine/operation error (deploy failure, etc.) in the detail modal —
 *  a red ERROR badge + the full message. Shorthand over detailModal for the
 *  common "long engine exception" case that must never go in a corner toast. */
export function errorModal(title: string, error: any, meta?: unknown): ModalHandle {
    return detailModal({
        title,
        badge: { text: 'Error', tone: 'err' },
        meta,
        sections: [{ label: 'Message', text: (error && error.message) || String(error) }]
    });
}

/* ---- context menu ----------------------------------------------------------------------- */

let openMenu: HTMLElement | null = null;
let menuOpener: HTMLElement | null = null;   // element focus returns to when the menu is dismissed

/* Rendered by Radix DropdownMenu when the app registers its renderer — same
   constraint as setDialogRenderer above: this module cannot import React. */
type ContextMenuRenderer = (menu: { x: number; y: number; items: MenuEntry[] }) => { close(options?: { restore?: boolean }): void; el?: HTMLElement };
let contextMenuRenderer: ContextMenuRenderer | null = null;
let openRendered: ReturnType<ContextMenuRenderer> | null = null;      // the registered renderer's handle for the open menu

/** Register the app's context-menu renderer. Pass null for the DOM one. */
export function setContextMenuRenderer(fn: ContextMenuRenderer | null): void { contextMenuRenderer = fn; }

/* Which items actually appear. Shared by both renderers so RBAC and `hidden` are
   decided in exactly one place. Separators are passed through as-is — collapsing
   the ones left dangling by a filtered-out item would change existing menus. */
function visibleMenuItems(items: MenuEntry[], group?: string): MenuEntry[] {
    const out: MenuEntry[] = [];
    for (const item of items) {
        if (item === '-' || item.header) { out.push(item); continue; }
        if (item.hidden) continue;
        // RBAC: hide an item the user isn't authorized for (Swing's paired popup
        // task). `group` (the task-pane key) may be set per item or for the menu.
        if (item.task && !checkTask(item.group || group, item.task)) continue;
        if (item.items) {
            // A submenu is filtered by the same rules; one whose children are all
            // hidden is a disclosure onto nothing, so it goes too.
            const children = visibleMenuItems(item.items, item.group || group);
            if (!children.some(c => c !== '-')) continue;
            out.push({ ...item, items: children });
            continue;
        }
        out.push(item);
    }
    return out;
}

export function contextMenu(x: number, y: number, items: MenuEntry[], group?: string): HTMLElement | null {
    const visible = visibleMenuItems(items, group);
    if (contextMenuRenderer) {
        // restore:false — replacing one menu with another must not bounce focus
        // back to the first menu's opener on the way.
        closeContextMenu({ restore: false });
        openRendered = contextMenuRenderer({ x, y, items: visible });
        return openRendered.el || null;
    }
    return domContextMenu(x, y, visible);
}

function domContextMenu(x: number, y: number, items: MenuEntry[]): HTMLElement {
    closeContextMenu({ restore: false });
    // Hand focus back where it came from on dismiss (the row, the task button).
    menuOpener = document.activeElement as HTMLElement | null;
    // .ctx-surface is the shared menu look; .ctx-menu only adds the coordinate
    // placement this menu does for itself (a Radix menu is placed by Radix).
    const menu = h('div.ctx-menu.ctx-surface', { role: 'menu' });
    const render = (item: MenuEntry, nested: boolean): void => {
        if (item === '-') { menu.appendChild(h('div.ctx-sep', { role: 'separator' })); return; }
        // Non-interactive heading row (e.g. the account menu's "signed in as").
        if (item.header) {
            menu.appendChild(h('div.ctx-head', { role: 'presentation' },
                h('div.ctx-head-name', item.label),
                item.sub ? h('div.ctx-head-sub', item.sub) : null));
            return;
        }
        // No hover-out submenus in the DOM menu (this renderer is the fallback for
        // plugin/no-React contexts; the app's Radix one does real submenus). The
        // children are inlined under their label instead, so nothing is lost.
        if (item.items) {
            menu.appendChild(h('div.ctx-head', { role: 'presentation' },
                h('div.ctx-head-name', item.label)));
            for (const child of item.items) render(child, true);
            return;
        }
        menu.appendChild(h(`button.ctx-item${item.danger ? '.danger' : ''}${nested ? '.ctx-item-nested' : ''}`, {
            role: 'menuitem',
            // Roving focus: the menu is one stop, arrows move within it.
            tabindex: '-1',
            disabled: item.disabled,
            onClick: () => { closeContextMenu({ restore: false }); item.onClick && item.onClick(); }
        }, item.icon ? icon(item.icon) : null, item.label));
    };
    for (const item of items) render(item, false);
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
    openMenu = menu;
    setTimeout(() => document.addEventListener('mousedown', dismissMenu), 0);
    document.addEventListener('keydown', menuKeys);
    // Focus the first item so the menu is operable from the keyboard at all — it
    // used to open with focus left behind on the page, unreachable by Tab.
    const first = menuItems()[0];
    if (first) first.focus();
    return menu;
}

function menuItems(): HTMLElement[] {
    return openMenu ? Array.from(openMenu.querySelectorAll<HTMLElement>('.ctx-item:not([disabled])')) : [];
}

function menuMove(delta: number, absolute?: number): void {
    const items = menuItems();
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const next = absolute !== undefined
        ? (absolute < 0 ? items.length - 1 : 0)
        : (cur + delta + items.length) % items.length;
    items[next].focus();
}

function menuKeys(e: KeyboardEvent): void {
    if (!openMenu) return;
    switch (e.key) {
        case 'Escape':
            e.preventDefault();
            closeContextMenu();
            return;
        case 'ArrowDown': e.preventDefault(); menuMove(1); return;
        case 'ArrowUp': e.preventDefault(); menuMove(-1); return;
        case 'Home': e.preventDefault(); menuMove(0, 0); return;
        case 'End': e.preventDefault(); menuMove(0, -1); return;
        case 'Tab':
            // Tabbing out of a popup menu dismisses it (Swing does the same).
            closeContextMenu();
            return;
        default:
            break;
    }
    // Type-ahead: jump to the next item starting with the typed letter.
    if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const items = menuItems();
        const from = items.indexOf(document.activeElement as HTMLElement) + 1;
        const key = e.key.toLowerCase();
        for (let i = 0; i < items.length; i++) {
            const it = items[(from + i) % items.length];
            if ((it.textContent || '').trim().toLowerCase().startsWith(key)) { e.preventDefault(); it.focus(); return; }
        }
    }
}

function dismissMenu(e: MouseEvent): void {
    if (openMenu && !openMenu.contains(e.target as Node)) closeContextMenu({ restore: false });
}

export function closeContextMenu({ restore = true }: { restore?: boolean } = {}): void {
    if (openRendered) { const handle = openRendered; openRendered = null; handle.close({ restore }); return; }
    if (!openMenu) return;
    openMenu.remove();
    openMenu = null;
    document.removeEventListener('mousedown', dismissMenu);
    document.removeEventListener('keydown', menuKeys);
    // Only a keyboard dismissal returns focus; a click elsewhere has already
    // moved it, and an activated item may have opened a dialog of its own.
    const opener = menuOpener;
    menuOpener = null;
    if (restore && opener && opener.isConnected && opener.focus) opener.focus();
}

/* ---- tabs ----------------------------------------------------------------------------------- */

export function tabs(defs: TabDef[], { onChange, active = 0, label = 'Tabs' }: { onChange?: (index: number, def: TabDef) => void; active?: number; label?: string } = {}): TabsHandle {
    // role=tablist + roving tabindex, matching react/ui.jsx useTabList: one tab
    // stop for the strip, arrows move and select (the APG default for tabs).
    const bar = h('div.tabs', { role: 'tablist', 'aria-label': label });
    const body = h('div.tab-body', { role: 'tabpanel' });
    const root = h('div', { class: 'flex flex-col flex-1 overflow-hidden min-h-0' }, bar, body);
    let current = -1;

    const buttons = defs.map((def, i) =>
        h('button.tab', { role: 'tab', tabindex: '-1', onClick: () => select(i) }, def.label));
    buttons.forEach(b => bar.appendChild(b));

    bar.addEventListener('keydown', (e: KeyboardEvent) => {
        let to = -1;
        if (e.key === 'ArrowRight') to = (current + 1) % buttons.length;
        else if (e.key === 'ArrowLeft') to = (current - 1 + buttons.length) % buttons.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = buttons.length - 1;
        if (to < 0 || !buttons.length) return;
        e.preventDefault();
        select(to);
        buttons[to].focus();
    });

    function select(i: number): void {
        if (i === current) return;
        current = i;
        buttons.forEach((b, j) => {
            const on = i === j;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        clear(body);
        const content = defs[i].render();
        if (content instanceof Node) body.appendChild(content);
        onChange && onChange(i, defs[i]);
    }

    select(active);
    return { el: root, select, get active() { return current; } };
}

/* ---- data table -------------------------------------------------------------------------------- */

/**
 * DataTable — dense, sortable, selectable grid.
 *
 * columns: [{ key, label, render?(row), sortValue?(row), className?, width? }]
 * options: { selectable: 'single'|'multi'|false, onSelect(rows), onActivate(row),
 *            onContextMenu(row, event), rowKey(row), emptyText }
 */
export class DataTable<T = any> {
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
    constructor(columns: Column<T>[], options: DataTableOptions<T> = {}) {
        this.columns = columns;
        this.options = options;
        this.rows = [];
        this.selected = new Set();
        this.sortKey = null;
        this.sortDir = 1;
        // Hidden columns for the header column-visibility menu (Swing parity).
        // Persisted when options.columnsMenuKey is set.
        // Columns may be hidden by default (col.defaultHidden) — Swing parity; a
        // saved preference (if the menu key has ever been written) overrides them.
        this.defaultHidden = new Set(columns.filter(c => c.defaultHidden).map(c => c.key));
        this.hidden = new Set(this.defaultHidden);
        if (options.columnsMenuKey) {
            // Scoped per server+user, matching createColumnManager's persistence.
            const saved = localStorage.getItem(scopedKey(options.columnsMenuKey));
            if (saved != null) { try { this.hidden = new Set(JSON.parse(saved)); } catch { /* keep defaults */ } }
        }
        // Opt-in resizable + reorderable + show/hide columns (persisted per view),
        // the same machinery the Dashboard/Channels tree tables use. When set, the
        // manager owns order/widths/visibility (superseding the columnsMenu path).
        this.manager = options.columnsKey
            ? createColumnManager(
                options.columnsKey,
                Object.fromEntries(columns.filter(c => c.width).map(c => [c.key, parseInt(c.width!, 10) || 120])),
                [...this.defaultHidden])
            : null;
        this.el = h('div.dt-wrap');
        this.render();
    }

    visibleColumns(): Column<T>[] {
        if (this.manager) return this.columns.filter(c => !this.manager!.isHidden(c.key));
        return this.options.columnsMenu ? this.columns.filter(c => !this.hidden.has(c.key)) : this.columns;
    }

    saveHidden(): void {
        if (this.options.columnsMenuKey) {
            try { localStorage.setItem(scopedKey(this.options.columnsMenuKey), JSON.stringify([...this.hidden])); } catch { /* private mode */ }
        }
    }

    // Header right-click: toggle each column's visibility + Restore Default (Swing
    // MirthTable column control). Never hides the last remaining column.
    openColumnsMenu(e: MouseEvent): void {
        e.preventDefault();
        const items: MenuEntry[] = this.columns.map(col => ({
            label: (this.hidden.has(col.key) ? ' ' : '✓ ') + (col.label || col.key),
            onClick: () => {
                if (this.hidden.has(col.key)) this.hidden.delete(col.key);
                else if (this.columns.length - this.hidden.size > 1) this.hidden.add(col.key);
                this.saveHidden();
                this.render();
            }
        }));
        items.push('-', { label: 'Restore Default', onClick: () => { this.hidden = new Set(this.defaultHidden); this.saveHidden(); this.render(); } });
        contextMenu(e.clientX, e.clientY, items);
    }

    setRows(rows: T[] | null | undefined): void {
        this.rows = rows || [];
        const keys = new Set(this.rows.map(r => this.key(r)));
        for (const k of [...this.selected]) if (!keys.has(k)) this.selected.delete(k);
        this.render();
    }

    key(row: T): string { return this.options.rowKey ? this.options.rowKey(row) : JSON.stringify(row); }

    selectedRows(): T[] { return this.rows.filter(r => this.selected.has(this.key(r))); }

    clearSelection(): void { this.selected.clear(); this.render(); }

    sortedRows(): T[] {
        if (!this.sortKey) return this.rows;
        const col = this.columns.find(c => c.key === this.sortKey);
        if (!col) return this.rows;
        const value = (row: T) => col.sortValue ? col.sortValue(row) : (row as any)[col.key];
        return [...this.rows].sort((a, b) => {
            const va = value(a), vb = value(b);
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * this.sortDir;
            return String(va).localeCompare(String(vb)) * this.sortDir;
        });
    }

    render(): void {
        clear(this.el);
        const { options } = this;

        if (!this.rows.length) {
            this.el.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('search', 30)),
                h('div', options.emptyText || 'Nothing to display')));
            return;
        }

        const cols = this.visibleColumns();
        const headRow = h('tr', cols.map(col => {
            const sortable = col.sortable !== false;
            const sortNow = () => {
                if (this.sortKey === col.key) this.sortDir = -this.sortDir;
                else { this.sortKey = col.key; this.sortDir = 1; }
                this.render();
            };
            return h('th' + (sortable ? '.sortable' : ''), {
                scope: 'col',
                style: col.width ? { width: col.width } : null,
                // Sort state was visual only; and a sortable header is a control, so
                // it needs to be reachable and operable from the keyboard.
                'aria-sort': sortable
                    ? (this.sortKey === col.key ? (this.sortDir > 0 ? 'ascending' : 'descending') : 'none')
                    : null,
                tabindex: sortable ? '0' : null,
                onKeydown: sortable ? (e: KeyboardEvent) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    sortNow();
                } : null,
                onClick: sortable ? sortNow : null
            },
            col.label,
            // Decorative: aria-sort carries the state, and an exposed glyph would
            // append "▲" to the header's accessible name.
            this.sortKey === col.key
                ? h('span.sort-arrow', { 'aria-hidden': 'true' }, this.sortDir > 0 ? '▲' : '▼')
                : null);
        }));
        if (options.columnsMenu && !this.manager) headRow.addEventListener('contextmenu', (e: MouseEvent) => this.openColumnsMenu(e));
        const thead = h('thead', headRow);

        const tbody = h('tbody');
        for (const row of this.sortedRows()) {
            const k = this.key(row);
            const tr = h('tr', { class: this.selected.has(k) ? 'selected' : null });
            for (const col of cols) {
                const td = h('td' + (col.className ? '.' + col.className : ''));
                const content = col.render ? col.render(row) : (row as any)[col.key];
                if (content instanceof Node) td.appendChild(content);
                else if (content !== null && content !== undefined) td.textContent = String(content);
                tr.appendChild(td);
            }
            if (options.selectable) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', (e: MouseEvent) => this.handleSelect(row, e));
            }
            if (options.onActivate) {
                tr.addEventListener('dblclick', () => options.onActivate!(row));
            }
            if (options.onContextMenu) {
                tr.addEventListener('contextmenu', (e: MouseEvent) => {
                    e.preventDefault();
                    if (!this.selected.has(k)) { this.selected = new Set([k]); this.render(); }
                    options.onContextMenu!(row, e);
                });
            }
            tbody.appendChild(tr);
        }

        const table = h('table.dt', thead, tbody);
        this.el.appendChild(table);

        // Resizable + reorderable columns (+ a show/hide menu) when a columnsKey
        // is configured. decorateColumns permutes/sizes the DOM in place; both it
        // and the menu re-render through render() so the decoration re-applies.
        if (this.manager) {
            decorateColumns(table as HTMLTableElement, {
                manager: this.manager,
                presentKeys: cols.map(c => c.key),
                onChange: () => this.render()
            });
            attachColumnMenu(thead, {
                manager: this.manager,
                columns: this.columns,
                onChange: () => this.render()
            });
        }
    }

    handleSelect(row: T, e: MouseEvent): void {
        const k = this.key(row);
        const multi = this.options.selectable === 'multi';
        if (multi && (e.metaKey || e.ctrlKey)) {
            this.selected.has(k) ? this.selected.delete(k) : this.selected.add(k);
        } else if (multi && e.shiftKey && this.lastKey) {
            const sorted = this.sortedRows().map(r => this.key(r));
            const a = sorted.indexOf(this.lastKey), b = sorted.indexOf(k);
            this.selected = new Set(sorted.slice(Math.min(a, b), Math.max(a, b) + 1));
        } else {
            this.selected = new Set([k]);
        }
        this.lastKey = k;
        this.render();
        this.options.onSelect && this.options.onSelect(this.selectedRows());
    }
}

/* Delegated hover tooltips for truncated table cells: any `.dt` cell whose
   content is ellipsized (the cell itself, or a `truncate` span inside it) gets
   its full text as a native title — every table, React or imperative, plugin
   or built-in, with no per-view wiring. Cells that set their own title keep it
   (only titles marked as ours are ever written or cleared). Wired once at boot
   next to initSplitters(). */
let truncationTitlesInstalled = false;
export function initTruncationTitles(): void {
    if (truncationTitlesInstalled) return;
    truncationTitlesInstalled = true;
    document.addEventListener('mouseover', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        const cell = target?.closest<HTMLElement>('table.dt td, table.dt th');
        if (!cell) return;
        if (cell.title && cell.dataset.autoTitle === undefined) return;  // renderer's own title
        // The ellipsis may sit on the cell or on a clipped element inside it
        // (e.g. a max-width `truncate` span): check the hovered chain up to the cell.
        let truncated = false;
        for (let el: HTMLElement | null = target as HTMLElement; el; el = el === cell ? null : el.parentElement) {
            if (el.scrollWidth > el.clientWidth + 1) { truncated = true; break; }
            if (el === cell) break;
        }
        const text = truncated ? (cell.textContent || '').trim() : '';
        if (text) {
            cell.title = text;
            cell.dataset.autoTitle = '1';
        } else if (cell.dataset.autoTitle !== undefined) {
            cell.removeAttribute('title');
            delete cell.dataset.autoTitle;
        }
    });
}

/* ---- form field helpers ------------------------------------------------------------------------------ */

export function field(label: string | Node, control: Node, hint?: string): HTMLElement {
    return h('div.field', h('label', label), control, hint ? h('div.hint', hint) : null);
}

export function textInput(value: string = '', attrs: ElementAttrs = {}): HTMLInputElement {
    return h('input', { type: 'text', value, ...attrs }) as HTMLInputElement;
}

export function numberInput(value: string | number = '', attrs: ElementAttrs = {}): HTMLInputElement {
    return h('input', { type: 'number', value, ...attrs }) as HTMLInputElement;
}

export function select(options: SelectOption[], value?: any, attrs: ElementAttrs = {}): HTMLSelectElement {
    const el = h('select', attrs) as HTMLSelectElement;
    for (const opt of options) {
        const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
        el.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label));
    }
    return el;
}

export function checkbox(label: string, checked: boolean = false, attrs: ElementAttrs = {}): CheckboxHandle {
    const input = h('input', { type: 'checkbox', checked, ...attrs }) as HTMLInputElement;
    return { el: h('label.check', input, label), input };
}

export function taskButton(label: string, iconName?: string | null, onClick?: (e: MouseEvent) => void, opts: TaskRef & { primary?: boolean; danger?: boolean; disabled?: boolean; title?: string } = {}): HTMLElement | null {
    // RBAC: opts.task + opts.group hide an unauthorized task (Swing parity). Returns
    // null, which the rail's taskbar host skips.
    if (opts.task && !checkTask(opts.group, opts.task)) return null;
    return h(`button.btn${opts.primary ? '.btn-primary' : ''}${opts.danger ? '.btn-danger' : ''}`,
        { onClick, disabled: opts.disabled, title: opts.title || null },
        iconName ? icon(iconName) : null, label);
}

export function downloadFile(filename: string, content: Blob | string | BlobPart, type = 'application/octet-stream'): void {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* Save with a native "Save As" dialog (choose filename + folder) where the
   browser supports it (File System Access API — Chromium), falling back to a
   normal download elsewhere. The picker MUST open inside the click gesture, so
   `getContent` (which may fetch/await) runs AFTER the picker is chosen. Pass a
   string/Blob value or a (sync/async) function returning one. */
export async function saveFile(suggestedName: string, type: string, getContent: string | Blob | (() => string | Blob | Promise<string | Blob>)): Promise<void> {
    const ext = (String(suggestedName).match(/\.[^./\\]+$/) || [''])[0];
    const resolve = async () => {
        const v = typeof getContent === 'function' ? await getContent() : getContent;
        return v instanceof Blob ? v : new Blob([v == null ? '' : v], { type });
    };
    if ((window as any).showSaveFilePicker) {
        let handle: any;
        try {
            handle = await (window as any).showSaveFilePicker({
                suggestedName,
                types: ext ? [{ description: 'File', accept: { [type || 'application/octet-stream']: [ext] } }] : undefined
            });
        } catch (e) {
            if (e && (e as { name?: string }).name === 'AbortError') return;   // user cancelled the dialog
            handle = null;                              // unsupported options → fall back
        }
        if (handle) {
            const blob = await resolve();
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        }
    }
    // Fallback: standard download (honors the browser's "ask where to save" setting).
    downloadFile(suggestedName, await resolve(), type);
}

export function pickFile(accept?: string, { binary = false }: { binary?: boolean } = {}): Promise<{ name: string; content: string } | null> {
    return new Promise<{ name: string; content: string } | null>(resolve => {
        const input = h('input', { type: 'file', accept, class: 'hidden' }) as HTMLInputElement;
        // Dismissing the OS dialog fires 'cancel' (no 'change'); without this the
        // returned promise never settles and the hidden input leaks.
        input.addEventListener('cancel', () => { input.remove(); resolve(null); });
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return resolve(null);
            const reader = new FileReader();
            // binary: resolve base64 (data URL payload) for non-text files (e.g. DICOM).
            reader.onload = () => resolve({
                name: file.name,
                content: binary ? (String(reader.result).split(',')[1] || '') : (reader.result as string)
            });
            if (binary) reader.readAsDataURL(file); else reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
    });
}

export function loading(text = 'Loading…'): HTMLElement {
    return h('div.loading-block', h('div.spinner'), text);
}
