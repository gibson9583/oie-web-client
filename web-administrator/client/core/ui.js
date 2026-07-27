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

/* ---- element builder -------------------------------------------------------- */

export function h(spec, attrs, ...children) {
    let tag = 'div';
    const classes = [];
    let id = null;
    for (const part of String(spec).split(/(?=[.#])/)) {
        if (part.startsWith('.')) classes.push(part.slice(1));
        else if (part.startsWith('#')) id = part.slice(1);
        else if (part) tag = part;
    }
    const el = document.createElement(tag);
    if (id) el.id = id;
    if (classes.length) el.className = classes.join(' ');

    if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) {
        children.unshift(attrs);
        attrs = null;
    }
    for (const [key, value] of Object.entries(attrs || {})) {
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
            el[key] = value;
        } else {
            el.setAttribute(key, value === true ? '' : value);
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        if (Array.isArray(child)) append(el, child);
        else if (child instanceof Node) el.appendChild(child);
        else el.appendChild(document.createTextNode(String(child)));
    }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export { icon };

/* ---- formatting helpers ------------------------------------------------------- */

export function fmtNumber(n) {
    if (n === null || n === undefined || n === '') return '0';
    return Number(n).toLocaleString();
}

export function fmtDate(value) {
    if (value === null || value === undefined || value === '') return '';
    let millis = value;
    if (typeof value === 'object') millis = value.time ?? value.timestamp ?? null; // Calendar JSON
    if (millis === null) return '';
    const d = new Date(Number(millis));
    if (isNaN(d.getTime())) return String(value);
    // Rendered in the user's chosen time zone (Server / Local / UTC).
    return formatInZone(d);
}

export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ---- toast notifications --------------------------------------------------------- */

let toastHost = null;

/* Low-level corner toast: transient, non-blocking. Used for info/success and
   for feedback that must never steal focus (e.g. clipboard results). */
function cornerToast(message, type = 'info', timeout = 4200) {
    if (!toastHost) {
        toastHost = h('div.toasts');
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
    return el;
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
export function toast(message, type = 'info', timeout = 4200) {
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

export function modal({ title, body, buttons = [], size = '', onClose }) {
    const overlay = h('div.modal-overlay');
    const close = () => { overlay.remove(); onClose && onClose(); };

    const dialog = h(`div.modal${size ? '.' + size : ''}`,
        h('div.modal-header', title,
            h('button.icon-btn', { onClick: close, title: 'Close' }, icon('x'))),
        h('div.modal-body', body),
        buttons.length ? h('div.modal-foot', buttons.map(btn =>
            h(`button.btn${btn.primary ? '.btn-primary' : ''}${btn.danger ? '.btn-danger' : ''}`, {
                onClick: async () => {
                    const result = btn.onClick ? await btn.onClick() : true;
                    if (result !== false) close();
                }
            }, btn.label))) : null
    );

    overlay.appendChild(dialog);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    return { close, el: dialog };
}

export function confirmDialog(title, message, { danger = false, okLabel = 'OK' } = {}) {
    return new Promise(resolve => {
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

export function promptDialog(title, label, initial = '') {
    return new Promise(resolve => {
        const input = h('input', { type: 'text', value: initial });
        const m = modal({
            title,
            body: h('div.field', h('label', label), input),
            onClose: () => resolve(null),
            buttons: [
                { label: 'Cancel', onClick: () => { resolve(null); } },
                { label: 'OK', primary: true, onClick: () => { resolve(input.value); } }
            ]
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { resolve(input.value); m.close(); }
        });
        setTimeout(() => input.focus(), 30);
    });
}

/* Copy text to the clipboard with a small toast — shared by detail modals. */
function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(String(text));
            toast('Copied to clipboard');
            return;
        }
    } catch { /* fall through to the unavailable notice */ }
    toast('Clipboard unavailable', 'warn');
}

const DETAIL_TONE = { err: 'var(--err)', warn: 'var(--warn)', ok: 'var(--ok)', info: 'var(--accent)' };

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
export function detailModal({ title, badge, meta, sections = [], copy } = {}) {
    const preClass = 'mono m-0 whitespace-pre-wrap [word-break:break-word] overflow-x-hidden '
        + 'overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px] '
        + 'max-h-[50vh] text-[12px]';
    const tone = badge ? (DETAIL_TONE[badge.tone] || 'var(--text)') : null;
    const badgeEl = badge
        ? h('span.tag', { class: 'font-[650]', style: { color: tone, borderColor: tone } },
            String(badge.text).toUpperCase())
        : null;
    const copyText = copy != null ? copy : sections.map(s => s.text).join('\n\n');
    return modal({
        title,
        size: 'wide',
        body: h('div', { class: 'flex flex-col gap-2 min-w-[620px] max-w-[80vw]' },
            (badge || meta) ? h('div', { class: 'flex gap-[14px] items-center flex-wrap' },
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
export function errorModal(title, error, meta) {
    return detailModal({
        title,
        badge: { text: 'Error', tone: 'err' },
        meta,
        sections: [{ label: 'Message', text: (error && error.message) || String(error) }]
    });
}

/* ---- context menu ----------------------------------------------------------------------- */

let openMenu = null;

export function contextMenu(x, y, items, group) {
    closeContextMenu();
    const menu = h('div.ctx-menu');
    for (const item of items) {
        if (item === '-') { menu.appendChild(h('div.ctx-sep')); continue; }
        if (item.hidden) continue;
        // Non-interactive heading row (e.g. the account menu's "signed in as").
        if (item.header) {
            menu.appendChild(h('div.ctx-head',
                h('div.ctx-head-name', item.label),
                item.sub ? h('div.ctx-head-sub', item.sub) : null));
            continue;
        }
        // RBAC: hide an item the user isn't authorized for (Swing's paired popup
        // task). `group` (the task-pane key) may be set per item or for the menu.
        if (item.task && !checkTask(item.group || group, item.task)) continue;
        menu.appendChild(h(`button.ctx-item${item.danger ? '.danger' : ''}`, {
            disabled: item.disabled,
            onClick: () => { closeContextMenu(); item.onClick && item.onClick(); }
        }, item.icon ? icon(item.icon) : null, item.label));
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
    openMenu = menu;
    setTimeout(() => document.addEventListener('mousedown', dismissMenu), 0);
    return menu;
}

function dismissMenu(e) {
    if (openMenu && !openMenu.contains(e.target)) closeContextMenu();
}

export function closeContextMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', dismissMenu); }
}

/* ---- tabs ----------------------------------------------------------------------------------- */

export function tabs(defs, { onChange, active = 0 } = {}) {
    const bar = h('div.tabs');
    const body = h('div.tab-body');
    const root = h('div', { class: 'flex flex-col flex-1 overflow-hidden min-h-0' }, bar, body);
    let current = -1;

    const buttons = defs.map((def, i) =>
        h('button.tab', { onClick: () => select(i) }, def.label));
    buttons.forEach(b => bar.appendChild(b));

    function select(i) {
        if (i === current) return;
        current = i;
        buttons.forEach((b, j) => b.classList.toggle('active', i === j));
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
export class DataTable {
    constructor(columns, options = {}) {
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
            const saved = localStorage.getItem(options.columnsMenuKey);
            if (saved != null) { try { this.hidden = new Set(JSON.parse(saved)); } catch { /* keep defaults */ } }
        }
        // Opt-in resizable + reorderable + show/hide columns (persisted per view),
        // the same machinery the Dashboard/Channels tree tables use. When set, the
        // manager owns order/widths/visibility (superseding the columnsMenu path).
        this.manager = options.columnsKey
            ? createColumnManager(
                options.columnsKey,
                Object.fromEntries(columns.filter(c => c.width).map(c => [c.key, parseInt(c.width, 10) || 120])),
                [...this.defaultHidden])
            : null;
        this.el = h('div.dt-wrap');
        this.render();
    }

    visibleColumns() {
        if (this.manager) return this.columns.filter(c => !this.manager.isHidden(c.key));
        return this.options.columnsMenu ? this.columns.filter(c => !this.hidden.has(c.key)) : this.columns;
    }

    saveHidden() {
        if (this.options.columnsMenuKey) {
            try { localStorage.setItem(this.options.columnsMenuKey, JSON.stringify([...this.hidden])); } catch { /* private mode */ }
        }
    }

    // Header right-click: toggle each column's visibility + Restore Default (Swing
    // MirthTable column control). Never hides the last remaining column.
    openColumnsMenu(e) {
        e.preventDefault();
        const items = this.columns.map(col => ({
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

    setRows(rows) {
        this.rows = rows || [];
        const keys = new Set(this.rows.map(r => this.key(r)));
        for (const k of [...this.selected]) if (!keys.has(k)) this.selected.delete(k);
        this.render();
    }

    key(row) { return this.options.rowKey ? this.options.rowKey(row) : JSON.stringify(row); }

    selectedRows() { return this.rows.filter(r => this.selected.has(this.key(r))); }

    clearSelection() { this.selected.clear(); this.render(); }

    sortedRows() {
        if (!this.sortKey) return this.rows;
        const col = this.columns.find(c => c.key === this.sortKey);
        if (!col) return this.rows;
        const value = (row) => col.sortValue ? col.sortValue(row) : row[col.key];
        return [...this.rows].sort((a, b) => {
            const va = value(a), vb = value(b);
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * this.sortDir;
            return String(va).localeCompare(String(vb)) * this.sortDir;
        });
    }

    render() {
        clear(this.el);
        const { options } = this;

        if (!this.rows.length) {
            this.el.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('search', 30)),
                h('div', options.emptyText || 'Nothing to display')));
            return;
        }

        const cols = this.visibleColumns();
        const headRow = h('tr', cols.map(col =>
            h('th' + (col.sortable === false ? '' : '.sortable'), {
                style: col.width ? { width: col.width } : null,
                onClick: col.sortable === false ? null : () => {
                    if (this.sortKey === col.key) this.sortDir = -this.sortDir;
                    else { this.sortKey = col.key; this.sortDir = 1; }
                    this.render();
                }
            },
            col.label,
            this.sortKey === col.key ? h('span.sort-arrow', this.sortDir > 0 ? '▲' : '▼') : null)
        ));
        if (options.columnsMenu && !this.manager) headRow.addEventListener('contextmenu', (e) => this.openColumnsMenu(e));
        const thead = h('thead', headRow);

        const tbody = h('tbody');
        for (const row of this.sortedRows()) {
            const k = this.key(row);
            const tr = h('tr', { class: this.selected.has(k) ? 'selected' : null });
            for (const col of cols) {
                const td = h('td' + (col.className ? '.' + col.className : ''));
                const content = col.render ? col.render(row) : row[col.key];
                if (content instanceof Node) td.appendChild(content);
                else if (content !== null && content !== undefined) td.textContent = String(content);
                tr.appendChild(td);
            }
            if (options.selectable) {
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', (e) => this.handleSelect(row, e));
            }
            if (options.onActivate) {
                tr.addEventListener('dblclick', () => options.onActivate(row));
            }
            if (options.onContextMenu) {
                tr.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (!this.selected.has(k)) { this.selected = new Set([k]); this.render(); }
                    options.onContextMenu(row, e);
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
            decorateColumns(table, {
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

    handleSelect(row, e) {
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

/* ---- form field helpers ------------------------------------------------------------------------------ */

export function field(label, control, hint) {
    return h('div.field', h('label', label), control, hint ? h('div.hint', hint) : null);
}

export function textInput(value = '', attrs = {}) {
    return h('input', { type: 'text', value, ...attrs });
}

export function numberInput(value = '', attrs = {}) {
    return h('input', { type: 'number', value, ...attrs });
}

export function select(options, value, attrs = {}) {
    const el = h('select', attrs);
    for (const opt of options) {
        const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
        el.appendChild(h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label));
    }
    return el;
}

export function checkbox(label, checked = false, attrs = {}) {
    const input = h('input', { type: 'checkbox', checked, ...attrs });
    return { el: h('label.check', input, label), input };
}

export function taskButton(label, iconName, onClick, opts = {}) {
    // RBAC: opts.task + opts.group hide an unauthorized task (Swing parity). Returns
    // null, which the rail's taskbar host skips.
    if (opts.task && !checkTask(opts.group, opts.task)) return null;
    return h(`button.btn${opts.primary ? '.btn-primary' : ''}${opts.danger ? '.btn-danger' : ''}`,
        { onClick, disabled: opts.disabled, title: opts.title || null },
        iconName ? icon(iconName) : null, label);
}

export function downloadFile(filename, content, type = 'application/octet-stream') {
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
export async function saveFile(suggestedName, type, getContent) {
    const ext = (String(suggestedName).match(/\.[^./\\]+$/) || [''])[0];
    const resolve = async () => {
        const v = typeof getContent === 'function' ? await getContent() : getContent;
        return v instanceof Blob ? v : new Blob([v == null ? '' : v], { type });
    };
    if (window.showSaveFilePicker) {
        let handle;
        try {
            handle = await window.showSaveFilePicker({
                suggestedName,
                types: ext ? [{ description: 'File', accept: { [type || 'application/octet-stream']: [ext] } }] : undefined
            });
        } catch (e) {
            if (e && e.name === 'AbortError') return;   // user cancelled the dialog
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

export function pickFile(accept, { binary = false } = {}) {
    return new Promise(resolve => {
        const input = h('input', { type: 'file', accept, class: 'hidden' });
        input.addEventListener('change', () => {
            const file = input.files[0];
            input.remove();
            if (!file) return resolve(null);
            const reader = new FileReader();
            // binary: resolve base64 (data URL payload) for non-text files (e.g. DICOM).
            reader.onload = () => resolve({
                name: file.name,
                content: binary ? (String(reader.result).split(',')[1] || '') : reader.result
            });
            if (binary) reader.readAsDataURL(file); else reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
    });
}

export function loading(text = 'Loading…') {
    return h('div.loading-block', h('div.spinner'), text);
}
