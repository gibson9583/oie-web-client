/*
 * Shared helpers for connector property panels.
 *
 *   getPath/setPath      dot-path access that preserves sibling keys
 *   buildForm            small schema-driven form builder
 *   mapEntries/writeMapEntries  XStream linked-hash-map editing
 *   pollSettingsPanel    PollConnectorProperties editor (File/Database/JS readers)
 *   default*Properties   nested default sub-objects mirroring the Java constructors
 */

import { h, clear, field, textInput, numberInput, select, checkbox, icon, toast, taskButton, modal } from '../core/ui.js';
import { createCodeEditor } from '../core/codeeditor.js';
import * as api from '../core/api.js';

/* ---- dot-path access ----------------------------------------------------- */

export function getPath(obj, path) {
    let current = obj;
    for (const key of path.split('.')) {
        if (current === null || current === undefined || typeof current !== 'object') return undefined;
        current = current[key];
    }
    return current;
}

export function setPath(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === null || current[keys[i]] === undefined || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
    return obj;
}

/* ---- XStream map shapes ----------------------------------------------------
 * Map<String,String>       { entry: [{ string: [key, value] }] }
 * Map<String,List<String>> { entry: [{ string: key, list: { string: [v...] } }] }
 * Either may arrive with a single bare object instead of an array.
 */

export function mapEntries(map) {
    const out = [];
    if (!map || typeof map !== 'object') return out;
    let entries = map.entry;
    if (entries === null || entries === undefined || entries === '') return out;
    if (!Array.isArray(entries)) entries = [entries];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (Array.isArray(entry.string) && entry.list === undefined) {
            out.push([String(entry.string[0] ?? ''), String(entry.string[1] ?? '')]);
        } else if (entry.string !== undefined && entry.list !== undefined) {
            const key = Array.isArray(entry.string) ? String(entry.string[0] ?? '') : String(entry.string);
            let values = entry.list && typeof entry.list === 'object' ? entry.list.string : null;
            if (values === null || values === undefined || values === '') values = [];
            if (!Array.isArray(values)) values = [values];
            if (!values.length) values = [''];
            for (const v of values) out.push([key, String(v ?? '')]);
        } else if (entry.string !== undefined) {
            out.push([String(entry.string), '']);
        }
    }
    return out;
}

export function writeMapEntries(map, rows, shape = 'string') {
    const target = map && typeof map === 'object' ? map : {};
    if (!target['@class']) target['@class'] = 'linked-hash-map';
    const clean = rows.filter(([k]) => k !== '' && k !== null && k !== undefined);
    if (!clean.length) {
        delete target.entry;
        return target;
    }
    if (shape === 'list') {
        const grouped = new Map();
        for (const [k, v] of clean) {
            if (!grouped.has(k)) grouped.set(k, []);
            grouped.get(k).push(v);
        }
        target.entry = [...grouped].map(([k, values]) => ({ string: k, list: { string: values } }));
    } else {
        target.entry = clean.map(([k, v]) => ({ string: [k, v] }));
    }
    return target;
}

function keyValueEditor(properties, f, onChange) {
    const wrap = h('div');
    const rows = mapEntries(getPath(properties, f.key));
    const commit = () => {
        setPath(properties, f.key, writeMapEntries(getPath(properties, f.key), rows, f.mapShape || 'string'));
        onChange();
    };
    function paint() {
        clear(wrap);
        rows.forEach((row, i) => {
            wrap.appendChild(h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
                textInput(row[0], { placeholder: 'Name', style: { flex: '1' }, onInput: (e) => { row[0] = e.target.value; commit(); } }),
                textInput(row[1], { placeholder: 'Value', style: { flex: '2' }, onInput: (e) => { row[1] = e.target.value; commit(); } }),
                h('button.icon-btn', { type: 'button', title: 'Remove', onClick: () => { rows.splice(i, 1); commit(); paint(); } }, icon('x'))));
        });
        wrap.appendChild(h('button.btn', { type: 'button', onClick: () => { rows.push(['', '']); paint(); } }, 'Add'));
    }
    paint();
    return wrap;
}

/* ---- schema-driven form builder ---------------------------------------------
 * Classic-administrator layout: `section` entries open a fieldset-style block
 * (11px bold uppercase title over a hairline rule); fields render as
 * label:control rows in a `max-content 1fr` grid with right-aligned labels
 * (.cform* classes in app.css).
 *
 * fields: [{ key, label, type, options?, hint?, placeholder?, numeric?,
 *            mapShape?, language?, minHeight?, visible?(properties),
 *            refresh? (repaint form after change), section?,
 *            width? ('90px' — control width; defaults by type),
 *            append?(properties, { onChange, repaint }) — extra element
 *              rendered beside the control (e.g. a 'Ports in Use' button),
 *            onSet?(properties, value) — called after a value is written }]
 * type 'radio'   inline radio group from f.options (values may be booleans)
 * type 'display' read-only computed text: f.compute(properties); refreshed on
 *                every change in the form
 * type 'custom'  renders f.render(properties, { onChange, repaint }) as the control.
 */

const DEFAULT_WIDTHS = {
    number: '110px',
    text: '320px',
    password: '320px',
    select: '220px'
};

let cformUid = 0;

export function buildForm(host, properties, fields, onChange) {
    const displays = [];
    const notify = () => {
        onChange();
        for (const d of displays) d();
    };
    function paint() {
        clear(host);
        displays.length = 0;
        const root = h('div.cform');
        let grid = null;
        const openSection = (title) => {
            grid = h('div.cform-grid');
            root.appendChild(h('div.cform-section',
                title ? h('div.cform-section-title', title) : null, grid));
        };
        for (const f of fields) {
            if (f.section !== undefined) {
                if (f.visible && !f.visible(properties)) { grid = null; continue; }
                openSection(f.section);
                continue;
            }
            if (f.visible && !f.visible(properties)) continue;
            if (!grid) openSection(null);
            renderRow(grid, properties, f, notify, (f.refresh || f.type === 'custom') ? paint : null, displays);
        }
        host.appendChild(root);
    }
    paint();
    return { repaint: paint };
}

export function asBool(value) {
    return value === true || value === 'true';
}

function renderRow(grid, properties, f, onChange, repaint, displays) {
    const value = f.key === undefined ? undefined : getPath(properties, f.key);
    const set = (v) => {
        if (f.key !== undefined) setPath(properties, f.key, v);
        if (f.onSet) f.onSet(properties, v);
        onChange();
        if (repaint) repaint();
    };
    let control;
    let wide = f.span === true;
    switch (f.type) {
        case 'checkbox':
            control = checkbox(f.checkLabel || '', asBool(value), { onChange: (e) => set(e.target.checked) }).el;
            break;
        case 'radio': {
            const name = `cform-radio-${++cformUid}`;
            control = h('div.radio-group.inline',
                (f.options || []).map(opt => {
                    const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
                    return h('label.check',
                        h('input', { type: 'radio', name, checked: String(o.value) === String(value ?? ''), onChange: () => set(o.value) }),
                        o.label);
                }));
            break;
        }
        case 'display': {
            control = h('span.cform-display');
            const update = () => {
                const text = f.compute ? f.compute(properties) : getPath(properties, f.key);
                control.textContent = text === null || text === undefined ? '' : String(text);
            };
            update();
            displays.push(update);
            break;
        }
        case 'number':
            control = numberInput(value ?? '', {
                placeholder: f.placeholder,
                onInput: (e) => set(f.numeric ? (parseInt(e.target.value, 10) || 0) : e.target.value)
            });
            break;
        case 'select':
            control = select((f.options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) })), value, {
                onChange: (e) => set(f.numeric ? parseInt(e.target.value, 10) : e.target.value)
            });
            break;
        case 'textarea':
            control = h('textarea', {
                rows: f.rows || 5,
                placeholder: f.placeholder,
                onInput: (e) => set(e.target.value)
            }, value === null || value === undefined ? '' : String(value));
            wide = true;
            break;
        case 'code': {
            const editor = createCodeEditor({
                value: value === null || value === undefined ? '' : String(value),
                language: f.language || 'text',
                minHeight: f.minHeight || '240px',
                placeholder: f.placeholder,
                onChange: (v) => set(v)
            });
            control = editor.el;
            wide = true;
            break;
        }
        case 'keyvalue':
            control = keyValueEditor(properties, f, onChange);
            wide = true;
            break;
        case 'custom':
            control = f.render(properties, { onChange, repaint: repaint || (() => {}) });
            break;
        default:
            control = textInput(value ?? '', {
                placeholder: f.placeholder,
                onInput: (e) => set(e.target.value)
            });
    }

    // Fixed control widths (classic compact inputs); f.width overrides the
    // per-type default. Wide controls keep the full column.
    if (!wide && control) {
        const width = f.width || DEFAULT_WIDTHS[f.type || 'text'];
        if (f.width) {
            control.style.width = f.width;
        } else if (width && (control.tagName === 'INPUT' || control.tagName === 'SELECT')) {
            control.style.width = width;
        }
    }

    // `tooltip` shows on hover — the only form of help text (no inline hints).
    const labelEl = h('label.cform-label', { title: f.tooltip || null }, f.label ? `${f.label}:` : '');
    if (wide) labelEl.classList.add('top');
    const cell = h('div.cform-control', { title: f.tooltip || null },
        control,
        f.append ? f.append(properties, { onChange, repaint: repaint || (() => {}) }) : null);
    if (wide) cell.classList.add('wide');
    grid.appendChild(labelEl);
    grid.appendChild(cell);
}

/* 'Ports in Use' button shared by the TCP/HTTP/WS listener panels: fetches
   /channels/portsInUse and lists port → channel name in a modal. */
export function portsInUseButton() {
    const btn = taskButton('Ports in Use', 'search', async () => {
        btn.disabled = true;
        try {
            const ports = await api.channels.portsInUse();
            const rows = ports
                .filter(p => p && typeof p === 'object')
                .map(p => h('tr', h('td.num', String(p.port ?? '')), h('td', String(p.name ?? ''))));
            modal({
                title: 'Ports in Use',
                body: h('table.dt',
                    h('thead', h('tr', h('th', 'Port'), h('th', 'Channel Name'))),
                    h('tbody', rows.length ? rows : h('tr', h('td', { colSpan: 2 }, 'No listener ports in use')))),
                buttons: [{ label: 'Close', primary: true }]
            });
        } catch (e) {
            toast(apiErrorMessage(e), 'error');
        } finally {
            btn.disabled = false;
        }
    });
    return btn;
}

export const YES_NO = [
    { value: true, label: 'Yes' },
    { value: false, label: 'No' }
];

/* ---- polling schedule (PollConnectorProperties) ------------------------------- */

/* pollSettingsPanel wrapped as a classic fieldset-style section. */
export function pollSection(properties, onChange) {
    return h('div.cform-section', { style: { marginTop: '16px' } },
        h('div.cform-section-title', 'Polling Settings'),
        pollSettingsPanel(properties, onChange));
}

export function pollSettingsPanel(properties, onChange) {
    const host = h('div');
    function poll() {
        return properties.pollConnectorProperties;
    }
    function cronRows() {
        const jobs = poll().cronJobs;
        let list = jobs && typeof jobs === 'object' ? jobs.cronProperty : null;
        if (list === null || list === undefined || list === '') return [];
        return Array.isArray(list) ? list : [list];
    }
    function paint() {
        clear(host);
        const p = poll();
        const grid = h('div.form-grid');
        grid.appendChild(field('Schedule Type', select([
            { value: 'INTERVAL', label: 'Interval' },
            { value: 'TIME', label: 'Time' },
            { value: 'CRON', label: 'Cron' }
        ], p.pollingType, { onChange: (e) => { p.pollingType = e.target.value; onChange(); paint(); } })));

        if (p.pollingType === 'INTERVAL') {
            grid.appendChild(field('Polling Frequency (ms)', numberInput(p.pollingFrequency ?? 5000, {
                onInput: (e) => { p.pollingFrequency = parseInt(e.target.value, 10) || 0; onChange(); }
            })));
        } else if (p.pollingType === 'TIME') {
            grid.appendChild(field('Hour (0-23)', numberInput(p.pollingHour ?? 0, {
                min: 0, max: 23,
                onInput: (e) => { p.pollingHour = parseInt(e.target.value, 10) || 0; onChange(); }
            })));
            grid.appendChild(field('Minute (0-59)', numberInput(p.pollingMinute ?? 0, {
                min: 0, max: 59,
                onInput: (e) => { p.pollingMinute = parseInt(e.target.value, 10) || 0; onChange(); }
            })));
        } else if (p.pollingType === 'CRON') {
            const rows = cronRows().map(job => ({ expression: job.expression ?? '', description: job.description ?? '' }));
            const commit = () => {
                p.cronJobs = rows.length ? { cronProperty: rows.map(r => ({ description: r.description, expression: r.expression })) } : null;
                onChange();
            };
            const cronWrap = h('div.span-2');
            const paintCron = () => {
                clear(cronWrap);
                rows.forEach((row, i) => {
                    cronWrap.appendChild(h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
                        textInput(row.expression, { placeholder: 'Cron expression (e.g. 0 */5 * ? * *)', style: { flex: '2' }, onInput: (e) => { row.expression = e.target.value; commit(); } }),
                        textInput(row.description, { placeholder: 'Description', style: { flex: '1' }, onInput: (e) => { row.description = e.target.value; commit(); } }),
                        h('button.icon-btn', { type: 'button', title: 'Remove', onClick: () => { rows.splice(i, 1); commit(); paintCron(); } }, icon('x'))));
                });
                cronWrap.appendChild(h('button.btn', { type: 'button', onClick: () => { rows.push({ expression: '', description: '' }); paintCron(); } }, 'Add Cron Job'));
            };
            paintCron();
            grid.appendChild(field('Cron Jobs', cronWrap));
        }

        const startCb = checkbox('Poll Once on Start', asBool(p.pollOnStart), {
            onChange: (e) => { p.pollOnStart = e.target.checked; onChange(); }
        });
        grid.appendChild(h('div.field', startCb.el));
        host.appendChild(grid);
    }
    paint();
    return host;
}

/* ---- default nested sub-objects (mirror the Java constructors) ----------------- */

function defaultResource() {
    return {
        '@class': 'linked-hash-map',
        entry: [{ string: ['Default Resource', '[Default Resource]'] }]
    };
}

export function defaultSourceProperties(version, overrides = {}) {
    return Object.assign({
        '@version': version,
        responseVariable: 'None',
        respondAfterProcessing: true,
        processBatch: false,
        firstResponse: false,
        processingThreads: 1,
        resourceIds: defaultResource(),
        queueBufferSize: 1000
    }, overrides);
}

export function defaultDestinationProperties(version, overrides = {}) {
    return Object.assign({
        '@version': version,
        queueEnabled: false,
        sendFirst: false,
        retryIntervalMillis: 10000,
        regenerateTemplate: false,
        retryCount: 0,
        rotate: false,
        includeFilterTransformer: false,
        threadCount: 1,
        threadAssignmentVariable: null,
        validateResponse: false,
        resourceIds: defaultResource(),
        queueBufferSize: 1000,
        reattachAttachments: true
    }, overrides);
}

export function defaultListenerProperties(version, port) {
    return { '@version': version, host: '0.0.0.0', port: String(port) };
}

export function defaultPollProperties(version) {
    return {
        '@version': version,
        pollingType: 'INTERVAL',
        pollOnStart: false,
        pollingFrequency: 5000,
        pollingHour: 0,
        pollingMinute: 0,
        cronJobs: null,
        pollConnectorPropertiesAdvanced: {
            weekly: true,
            inactiveDays: { boolean: [false, false, false, false, false, false, false, false] },
            dayOfMonth: 1,
            allDay: true,
            startingHour: 8,
            startingMinute: 0,
            endingHour: 17,
            endingMinute: 0
        }
    };
}

/* ---- connector servlet helpers --------------------------------------------------
 * The /connectors/* servlets accept the connector properties object as the
 * request body. XStream identifies the class by the JSON root key, so the
 * payload is wrapped in the properties' own '@class' (FQCN) with the root-level
 * '@class' key removed (it is redundant once it becomes the root element name).
 */

export function successToast(message) {
    const el = toast(message, 'success');
    el.style.borderLeftColor = 'var(--ok)';
    return el;
}

/* JSON null values become empty XML elements server-side, which XStream cannot
   deserialize for abstract-typed fields (e.g. File schemeProperties) — omit them. */
function stripNulls(value) {
    if (Array.isArray(value)) return value.map(stripNulls);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            out[key] = stripNulls(v);
        }
        return out;
    }
    return value;
}

/* Engine errors arrive as serialized Java exceptions; surface the readable part. */
export function apiErrorMessage(e) {
    if (e && e.body) {
        try {
            const parsed = api.parseBody(e.body);
            if (parsed && typeof parsed === 'object') {
                const msg = parsed.message || parsed.detailedError || parsed.detailMessage
                    || (parsed.cause && parsed.cause.detailMessage);
                if (msg && typeof msg === 'string') return msg;
            }
        } catch { /* fall through */ }
    }
    return e && e.message ? e.message : String(e);
}

export function postConnectorProperties(path, properties, channel, params) {
    const body = stripNulls(properties);
    delete body['@class'];
    return api.post(path, body, {
        wrapKey: properties['@class'],
        params: Object.assign({
            channelId: channel ? channel.id : '',
            channelName: channel ? channel.name : ''
        }, params || {})
    });
}

/* 'Test Connection' style button: POSTs the connector properties to a
   /connectors/* test endpoint and toasts the ConnectionTestResponse. */
export function connectorTestButton({ label = 'Test Connection', icon: iconName = 'link', path, channel, properties }) {
    const btn = taskButton(label, iconName, async () => {
        btn.disabled = true;
        try {
            const result = await postConnectorProperties(path, properties, channel);
            const type = result && typeof result === 'object' ? String(result.type ?? '') : '';
            const message = (result && typeof result === 'object' && result.message) || type || 'No response received';
            if (type === 'SUCCESS') {
                successToast(message);
            } else {
                toast(message, 'error');
            }
        } catch (e) {
            toast(apiErrorMessage(e), 'error');
        } finally {
            btn.disabled = false;
        }
    });
    return btn;
}

export const CHARSETS = [
    { value: 'DEFAULT_ENCODING', label: 'Default' },
    { value: 'UTF-8', label: 'UTF-8' },
    { value: 'ISO-8859-1', label: 'ISO-8859-1' },
    { value: 'US-ASCII', label: 'US-ASCII' },
    { value: 'UTF-16', label: 'UTF-16' }
];

/* ---- Frame transmission mode (Basic / MLLP) -------------------------------
 * Shared by the built-in Basic mode (connectors/index.js) and the mllpmode
 * plugin. Frame bytes are stored as hex strings (e.g. '0B', '1C0D'); the
 * settings dialog and sample-frame preview mirror the Swing Transmission Mode
 * Settings panel. */

const CONTROL_ABBR = {
    '00': 'NUL', '01': 'SOH', '02': 'STX', '03': 'ETX', '04': 'EOT', '05': 'ENQ', '06': 'ACK', '07': 'BEL',
    '08': 'BS', '09': 'TAB', '0A': 'LF', '0B': 'VT', '0C': 'FF', '0D': 'CR', '0E': 'SO', '0F': 'SI',
    '10': 'DLE', '11': 'DC1', '12': 'DC2', '13': 'DC3', '14': 'DC4', '15': 'NAK', '16': 'SYN', '17': 'ETB',
    '18': 'CAN', '19': 'EM', '1A': 'SUB', '1B': 'ESC', '1C': 'FS', '1D': 'GS', '1E': 'RS', '1F': 'US', '7F': 'DEL'
};

function hexToTokens(hex) {
    const s = String(hex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    const out = [];
    for (let i = 0; i + 2 <= s.length; i += 2) {
        const byte = s.slice(i, i + 2);
        const abbr = CONTROL_ABBR[byte];
        if (abbr) out.push(`<${abbr}>`);
        else {
            const code = parseInt(byte, 16);
            out.push(code >= 32 && code < 127 ? String.fromCharCode(code) : `<0x${byte}>`);
        }
    }
    return out.join('');
}

/* Preview string shown next to the Transmission Mode dropdown. */
export function frameModeSampleFrame(tm) {
    const start = hexToTokens(tm && tm.startOfMessageBytes);
    const end = hexToTokens(tm && tm.endOfMessageBytes);
    if (!start && !end) return '<Message Data>';
    return `${start} Message Data ${end}`.replace(/\s+/g, ' ').trim();
}

/* "Transmission Mode Settings" dialog — Start/End of Message Bytes (hex) plus a
   clickable Byte Abbreviations reference that inserts the byte into the field. */
export function frameModeSettingsDialog(tm, onChange) {
    const hexInput = (val) => textInput(String(val || ''), { style: { width: '120px', fontFamily: 'var(--font-mono)' } });
    const startInput = hexInput(tm.startOfMessageBytes);
    const endInput = hexInput(tm.endOfMessageBytes);
    let lastFocused = startInput;
    startInput.addEventListener('focus', () => { lastFocused = startInput; });
    endInput.addEventListener('focus', () => { lastFocused = endInput; });

    const abbrevList = h('div', {
        style: { maxHeight: '280px', overflow: 'auto', border: '1px solid var(--bg3)', borderRadius: '4px', padding: '4px', minWidth: '110px' }
    }, Object.entries(CONTROL_ABBR).map(([hex, abbr]) => h('div.tree-node', {
        title: `Insert 0x${hex}`,
        style: { cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '12px' },
        onClick: () => { lastFocused.value = (lastFocused.value || '') + hex; lastFocused.focus(); }
    }, `<${abbr}>`)));

    const hexRow = (label, input) => h('div.flex', { style: { alignItems: 'center', gap: '6px', marginBottom: '8px' } },
        h('label', { style: { minWidth: '160px' } }, label), h('span.mono.faint', '0x'), input);

    modal({
        title: 'Transmission Mode Settings',
        size: 'wide',
        body: h('div', { style: { display: 'flex', gap: '18px', minWidth: '520px' } },
            h('div', { style: { flex: '1' } },
                h('div', { style: { fontWeight: '650', marginBottom: '8px' } }, 'Basic Settings'),
                hexRow('Start of Message Bytes:', startInput),
                hexRow('End of Message Bytes:', endInput)),
            h('div', h('div', { style: { fontWeight: '650', marginBottom: '8px' } }, 'Byte Abbreviations'), abbrevList)),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'OK', primary: true,
                onClick: () => {
                    tm.startOfMessageBytes = startInput.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
                    tm.endOfMessageBytes = endInput.value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
                    onChange();
                }
            }
        ]
    });
}
