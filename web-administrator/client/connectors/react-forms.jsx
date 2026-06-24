/*
 * React form layer for connector property panels.
 *
 * This is the React counterpart of the imperative buildForm/pollSettingsPanel/
 * transmissionModePanel helpers in ./forms.js. The field SCHEMA shape and every
 * data helper (getPath/setPath, mapEntries/writeMapEntries, default*Properties,
 * postConnectorProperties, CHARSETS, YES_NO, asBool, frameMode* …) are reused
 * VERBATIM from ./forms.js — only the rendering layer becomes React/JSX.
 *
 * The connector `def.component(ctx)` builds the SAME field arrays the old
 * `def.render(host, ctx)` did and hands them to <ConnectorForm>. Edits mutate
 * `properties` in place (preserving '@class'/'@version'/nested sub-objects for
 * the XStream round-trip), then call ctx.onChange() and bump a local tick so the
 * form repaints — matching the imperative builder's mutate-then-onChange model.
 *
 * Imperative helpers (modal/toast/createCodeEditor/the connector test + ports
 * servlets) are still CALLED from handlers; the buttons that opened modals are
 * provided here as small React components (PortsInUseButton/ConnectorTestButton).
 */

import { React, useReducer, useRef, useEffect, useMemo } from './react-platform.js';
import { platform } from '@oie/web-shell';
// Import UI helpers from the core modules directly (NOT @oie/web-ui): pkg-ui
// re-exports this module, so importing pkg-ui here would be a cycle.
import { h, modal, toast, taskButton, icon } from '../core/ui.js';
import { createCodeEditor } from '../core/codeeditor.js';
import * as api from '../core/api.js';
import {
    getPath, setPath, mapEntries, writeMapEntries, asBool,
    postConnectorProperties, successToast, apiErrorMessage
} from './forms.js';

/* Inline icon — raw-served modules can't import the bundled React <Icon> from
   ../react/bridges.jsx. icon() returns a trusted SVG node; mount it directly
   (no innerHTML, so no HTML-injection surface even if a name were ever dynamic). */
function Icon({ name }) {
    const ref = useRef(null);
    useEffect(() => { const el = ref.current; if (el) el.replaceChildren(icon(name)); }, [name]);
    return <span ref={ref} className="inline-flex" />;
}

/* Re-export the pure data helpers + transmission-mode dialog so connector
   modules import everything from one place (this React form module). */
export * from './forms.js';

/* ---- code editor island (wraps createCodeEditor; mutate-in-place onChange) --- */

const DEFAULT_WIDTHS = {
    number: '110px',
    text: '320px',
    password: '320px',
    select: '220px'
};

let cformUid = 0;

/* Monaco/textarea editor created ONCE; value flows in via initial value, edits
   flow out through onChange (which mutates properties + bumps the form). When the
   value is reassigned PROGRAMMATICALLY (e.g. WS "Generate Envelope" rewrites the
   SOAP envelope, then repaints), the editor is updated to the new value — but
   only when it differs, so normal typing never clobbers the cursor. */
function CodeField({ value, language, minHeight, placeholder, onChange, disabled }) {
    const hostRef = useRef(null);
    const edRef = useRef(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        const host = hostRef.current;
        const editor = createCodeEditor({
            value: value === null || value === undefined ? '' : String(value),
            language: language || 'text',
            minHeight: minHeight || '240px',
            placeholder,
            readOnly: !!disabled,
            onChange: (v) => onChangeRef.current && onChangeRef.current(v)
        });
        edRef.current = editor;
        host.appendChild(editor.el);
        return () => { try { editor.dispose && editor.dispose(); } catch { /* baseline no-op */ } edRef.current = null; if (host) host.replaceChildren(); };
        // Rebuilt when the language changes (e.g. SQL <-> JavaScript on the DB
        // reader's Use JavaScript toggle); value changes reconcile via the effect
        // below, so they don't rebuild.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);
    useEffect(() => {
        const ed = edRef.current;
        if (!ed) return;
        const next = value === null || value === undefined ? '' : String(value);
        if (ed.getValue() !== next) ed.setValue(next);
    }, [value]);
    // Reflect disabled (Swing setEnabled) onto the editor: the baseline textarea
    // honours readOnly; a richer registry editor reads opts.readOnly on edit.
    useEffect(() => {
        const ed = edRef.current;
        if (ed && ed.opts) ed.opts.readOnly = !!disabled;
        if (ed && ed.area) ed.area.readOnly = !!disabled;
    }, [disabled]);
    return <div ref={hostRef} style={disabled ? { opacity: 0.6 } : undefined} />;
}

/* Mounts a DOM Node (returned by a field's custom render() or an `append`
   helper) into the React tree. */
function DomNode({ node }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (node) host.appendChild(node);
        return () => { if (host) host.replaceChildren(); };
    }, [node]);
    return <span ref={ref} className="[display:contents]" />;
}

/* ---- key/value (XStream linked-hash-map) editor ----------------------------- */

function KeyValueEditor({ properties, field, onChange, disabled }) {
    const [, tick] = useReducer((n) => n + 1, 0);
    // rows live in a ref so edits mutate the same array across renders, exactly
    // like the imperative keyValueEditor's closure-captured `rows`.
    const rowsRef = useRef(null);
    // Re-read from the property when the map is REPLACED externally (e.g. loading
    // a JMS connection template) — detected by identity vs. our own last write.
    const lastMapRef = useRef(undefined);
    const currentMap = getPath(properties, field.key);
    if (rowsRef.current === null || currentMap !== lastMapRef.current) {
        rowsRef.current = mapEntries(currentMap);
        lastMapRef.current = currentMap;
    }
    const rows = rowsRef.current;
    const commit = () => {
        const written = writeMapEntries(getPath(properties, field.key), rows, field.mapShape || 'string');
        setPath(properties, field.key, written);
        lastMapRef.current = written;
        onChange();
    };
    return (
        <div style={disabled ? { opacity: 0.6 } : undefined}>
            {rows.map((row, i) => (
                <div key={i} className="flex gap-1.5 mb-1.5">
                    <input type="text" value={row[0]} placeholder="Name" className="flex-1" disabled={disabled}
                        onChange={(e) => { row[0] = e.target.value; tick(); commit(); }} />
                    <input type="text" value={row[1]} placeholder="Value" className="flex-[2]" disabled={disabled}
                        onChange={(e) => { row[1] = e.target.value; tick(); commit(); }} />
                    <button type="button" className="icon-btn" title="Remove" disabled={disabled}
                        onClick={() => { rows.splice(i, 1); commit(); tick(); }}><Icon name="x" /></button>
                </div>
            ))}
            <button type="button" className="btn" disabled={disabled} onClick={() => { rows.push(['', '']); tick(); }}>Add</button>
        </div>
    );
}

/* ---- one form row (control + label), React port of renderRow ---------------- */

function FieldRow({ properties, field, onChange, repaint }) {
    const f = field;
    const value = f.key === undefined ? undefined : getPath(properties, f.key);
    // Swing greys (disables) fields that don't apply to the current selection;
    // `disabled: (p) => bool` mirrors that (the control stays visible but inert).
    const disabled = typeof f.disabled === 'function' ? f.disabled(properties) : !!f.disabled;
    // Labels may be dynamic (Swing relabels some fields per selection); a function
    // label is re-evaluated on every repaint.
    const labelText = typeof f.label === 'function' ? f.label(properties) : f.label;
    const set = (v) => {
        if (f.key !== undefined) setPath(properties, f.key, v);
        if (f.onSet) f.onSet(properties, v);
        onChange();
        if (repaint) repaint();
    };

    let control = null;
    let wide = f.span === true;

    // Width handling mirrors forms.js renderRow: wide controls keep the full
    // column; otherwise width = f.width || the per-type default and is applied
    // to the input/select control (or always when f.width is explicit).
    const isWideType = f.type === 'textarea' || f.type === 'code' || f.type === 'keyvalue';
    const baseWide = wide || isWideType;
    const width = !baseWide ? (f.width || DEFAULT_WIDTHS[f.type || 'text']) : undefined;
    // INPUT/SELECT get the per-type default; non-input controls (radio/display)
    // only get a width when f.width is set explicitly.
    const isInputType = f.type === undefined || f.type === 'text' || f.type === 'password' || f.type === 'number' || f.type === 'select';
    const inputStyle = width && (f.width || isInputType) ? { width } : undefined;

    switch (f.type) {
        case 'checkbox':
            control = (
                <label className="check">
                    <input type="checkbox" checked={asBool(value)} disabled={disabled} onChange={(e) => set(e.target.checked)} />
                    {f.checkLabel || ''}
                </label>
            );
            break;
        case 'radio': {
            const name = `cform-radio-${++cformUid}`;
            control = (
                <div className="radio-group inline-row" style={f.width ? { width: f.width } : undefined}>
                    {(f.options || []).map((opt, i) => {
                        const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
                        return (
                            <label className="check" key={i}>
                                <input type="radio" name={name} disabled={disabled}
                                    checked={String(o.value) === String(value ?? '')}
                                    onChange={() => set(o.value)} />
                                {o.label}
                            </label>
                        );
                    })}
                </div>
            );
            break;
        }
        case 'display': {
            // Read-only computed text; refreshed whenever the form repaints.
            const text = f.compute ? f.compute(properties) : getPath(properties, f.key);
            control = <span className="cform-display" style={f.width ? { width: f.width } : undefined}>{text === null || text === undefined ? '' : String(text)}</span>;
            break;
        }
        case 'number':
            control = <input type="number" value={value ?? ''} placeholder={f.placeholder} style={inputStyle} disabled={disabled}
                onChange={(e) => set(f.numeric ? (parseInt(e.target.value, 10) || 0) : e.target.value)} />;
            break;
        case 'select':
            control = (
                <select value={value ?? ''} style={inputStyle} disabled={disabled}
                    onChange={(e) => set(f.numeric ? parseInt(e.target.value, 10) : e.target.value)}>
                    {(f.options || []).map((opt, i) => {
                        const o = typeof opt === 'object' ? opt : { value: opt, label: String(opt) };
                        return <option key={i} value={o.value}>{o.label}</option>;
                    })}
                </select>
            );
            break;
        case 'textarea':
            control = <textarea rows={f.rows || 5} placeholder={f.placeholder} disabled={disabled}
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(e) => set(e.target.value)} />;
            wide = true;
            break;
        case 'code':
            control = <CodeField value={value} language={typeof f.language === 'function' ? f.language(properties) : f.language} minHeight={f.minHeight}
                placeholder={f.placeholder} onChange={(v) => set(v)} disabled={disabled} />;
            wide = true;
            break;
        case 'keyvalue':
            control = <KeyValueEditor properties={properties} field={f} onChange={onChange} disabled={disabled} />;
            wide = true;
            break;
        case 'custom': {
            // The field's render() returns a DOM Node (verbatim connector logic);
            // mount it. repaint mirrors the imperative builder's repaint.
            const node = f.render(properties, { onChange, repaint: repaint || (() => {}) });
            if (node && f.width && node.style) node.style.width = f.width;
            control = <DomNode node={node} />;
            break;
        }
        default:
            // 'text' and 'password' (and any unknown type) render as a plain
            // input — password just swaps the input type, matching forms.js.
            control = <input type={f.type === 'password' ? 'password' : 'text'} value={value ?? ''} disabled={disabled}
                placeholder={f.placeholder} style={inputStyle} onChange={(e) => set(e.target.value)} />;
    }

    const appendNode = f.append ? f.append(properties, { onChange, repaint: repaint || (() => {}) }) : null;

    // `full` fields occupy the whole row (both grid columns, no label cell) — for
    // self-laid-out custom blocks that bring their own label column.
    if (f.full) {
        return (
            <div className="cform-control col-span-full">
                {control}
                {appendNode ? <DomNode node={appendNode} /> : null}
            </div>
        );
    }

    return (
        <>
            <label className={'cform-label' + (wide ? ' top' : '')} title={f.tooltip || undefined}
                style={disabled ? { opacity: 0.5 } : undefined}>
                {labelText ? `${labelText}:` : ''}
            </label>
            <div className={'cform-control' + (wide ? ' wide' : '')} title={f.tooltip || undefined}>
                {control}
                {appendNode ? <DomNode node={appendNode} /> : null}
            </div>
        </>
    );
}

/* ---- schema-driven form (React port of buildForm) ---------------------------
 * Same fields contract as forms.js buildForm: `section` opens a fieldset block;
 * fields render as label:control rows in a `.cform-grid`. `refresh`/`custom`
 * fields repaint the form (here, a state tick re-renders the whole component).
 */
export function ConnectorForm({ properties, fields, onChange }) {
    const [, repaint] = useReducer((n) => n + 1, 0);
    const notify = () => { onChange(); /* displays + visibility refresh on re-render */ repaint(); };

    // Group fields into sections exactly like buildForm's paint(): a `section`
    // entry opens a new grid; leading fields with no section open an untitled one.
    const sections = [];
    let current = null;
    for (const f of fields) {
        if (f.section !== undefined) {
            if (f.visible && !f.visible(properties)) { current = null; continue; }
            current = { title: f.section, rows: [] };
            sections.push(current);
            continue;
        }
        if (f.visible && !f.visible(properties)) continue;
        if (!current) { current = { title: null, rows: [] }; sections.push(current); }
        current.rows.push(f);
    }

    return (
        <div className="cform">
            {sections.map((section, si) => (
                <div className="cform-section" key={si}>
                    {section.title ? <div className="cform-section-title">{section.title}</div> : null}
                    <div className="cform-grid">
                        {section.rows.map((f, ri) => (
                            <FieldRow key={f.key || (typeof f.label === 'string' ? f.label : '') || `row-${si}-${ri}`} properties={properties} field={f}
                                onChange={notify}
                                repaint={(f.refresh || f.type === 'custom') ? repaint : null} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ---- 'Ports in Use' button (opens the imperative modal) --------------------- */

export function PortsInUseButton() {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        const btn = taskButton('Ports in Use', 'search', async () => {
            btn.disabled = true;
            try {
                const ports = await api.channels.portsInUse();
                const rows = ports
                    .filter((p) => p && typeof p === 'object')
                    .map((p) => h('tr', h('td.num', String(p.port ?? '')), h('td', String(p.name ?? ''))));
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
        host.appendChild(btn);
        return () => { if (host) host.replaceChildren(); };
    }, []);
    return <span ref={ref} className="[display:contents]" />;
}

/* ---- 'Test Connection' style button ----------------------------------------- */

export function ConnectorTestButton({ label = 'Test Connection', icon: iconName = 'link', path, channel, properties }) {
    const ref = useRef(null);
    // Latest props captured by ref so the button (built once) always POSTs the
    // current mutated properties.
    const stateRef = useRef({ label, iconName, path, channel, properties });
    stateRef.current = { label, iconName, path, channel, properties };
    useEffect(() => {
        const host = ref.current;
        const btn = taskButton(stateRef.current.label, stateRef.current.iconName, async () => {
            const s = stateRef.current;
            btn.disabled = true;
            try {
                const result = await postConnectorProperties(s.path, s.properties, s.channel);
                const type = result && typeof result === 'object' ? String(result.type ?? '') : '';
                const message = (result && typeof result === 'object' && result.message) || type || 'No response received';
                if (type === 'SUCCESS') successToast(message);
                else toast(message, 'error');
            } catch (e) {
                toast(apiErrorMessage(e), 'error');
            } finally {
                btn.disabled = false;
            }
        });
        host.appendChild(btn);
        return () => { if (host) host.replaceChildren(); };
    }, []);
    return <span ref={ref} className="[display:contents]" />;
}

/* ---- polling schedule (PollConnectorProperties), React port ----------------- */

export function PollSection({ properties, onChange }) {
    return (
        <div className="cform-section mt-4">
            <div className="cform-section-title">Polling Settings</div>
            <PollSettings properties={properties} onChange={onChange} />
        </div>
    );
}

function PollSettings({ properties, onChange }) {
    const [, tick] = useReducer((n) => n + 1, 0);
    const notify = () => { onChange(); tick(); };
    const p = properties.pollConnectorProperties;

    function cronRows() {
        const jobs = p.cronJobs;
        let list = jobs && typeof jobs === 'object' ? jobs.cronProperty : null;
        if (list === null || list === undefined || list === '') return [];
        return Array.isArray(list) ? list : [list];
    }

    // Cron rows mutate in a ref, committed back into p.cronJobs on each edit.
    const cronRef = useRef(null);
    if (cronRef.current === null) cronRef.current = cronRows().map((job) => ({ expression: job.expression ?? '', description: job.description ?? '' }));
    const cron = cronRef.current;
    const commitCron = () => {
        p.cronJobs = cron.length ? { cronProperty: cron.map((r) => ({ description: r.description, expression: r.expression })) } : null;
        onChange();
    };

    return (
        <div className="form-grid">
            <div className="field">
                <label>Schedule Type</label>
                <select value={p.pollingType} onChange={(e) => { p.pollingType = e.target.value; notify(); }}>
                    <option value="INTERVAL">Interval</option>
                    <option value="TIME">Time</option>
                    <option value="CRON">Cron</option>
                </select>
            </div>

            {p.pollingType === 'INTERVAL' && (
                <div className="field">
                    <label>Polling Frequency (ms)</label>
                    <input type="number" value={p.pollingFrequency ?? 5000}
                        onChange={(e) => { p.pollingFrequency = parseInt(e.target.value, 10) || 0; onChange(); }} />
                </div>
            )}

            {p.pollingType === 'TIME' && (
                <>
                    <div className="field">
                        <label>Hour (0-23)</label>
                        <input type="number" min={0} max={23} value={p.pollingHour ?? 0}
                            onChange={(e) => { p.pollingHour = parseInt(e.target.value, 10) || 0; onChange(); }} />
                    </div>
                    <div className="field">
                        <label>Minute (0-59)</label>
                        <input type="number" min={0} max={59} value={p.pollingMinute ?? 0}
                            onChange={(e) => { p.pollingMinute = parseInt(e.target.value, 10) || 0; onChange(); }} />
                    </div>
                </>
            )}

            {p.pollingType === 'CRON' && (
                <div className="field">
                    <label>Cron Jobs</label>
                    <div className="span-2">
                        {cron.map((row, i) => (
                            <div key={i} className="flex gap-1.5 mb-1.5">
                                <input type="text" value={row.expression} placeholder="Cron expression (e.g. 0 */5 * ? * *)" className="flex-[2]"
                                    onChange={(e) => { row.expression = e.target.value; tick(); commitCron(); }} />
                                <input type="text" value={row.description} placeholder="Description" className="flex-1"
                                    onChange={(e) => { row.description = e.target.value; tick(); commitCron(); }} />
                                <button type="button" className="icon-btn" title="Remove"
                                    onClick={() => { cron.splice(i, 1); commitCron(); tick(); }}><Icon name="x" /></button>
                            </div>
                        ))}
                        <button type="button" className="btn" onClick={() => { cron.push({ expression: '', description: '' }); tick(); }}>Add Cron Job</button>
                    </div>
                </div>
            )}

            <div className="field">
                {/* Empty label spacer so the checkbox drops to the control row,
                    aligning with the Schedule Type / Frequency inputs alongside. */}
                <label>&nbsp;</label>
                <div className="min-h-[34px] flex items-center">
                    <label className="check">
                        <input type="checkbox" checked={asBool(p.pollOnStart)}
                            onChange={(e) => { p.pollOnStart = e.target.checked; onChange(); }} />
                        Poll Once on Start
                    </label>
                </div>
            </div>
        </div>
    );
}

/* ---- Transmission Mode panel (TCP), React port ------------------------------ */

function defaultFrameMode() {
    return {
        '@class': 'com.mirth.connect.model.transmission.framemode.FrameModeProperties',
        pluginPointName: 'MLLP',
        startOfMessageBytes: '0B',
        endOfMessageBytes: '1C0D'
    };
}

export function TransmissionModePanel({ properties, onChange }) {
    const [, tick] = useReducer((n) => n + 1, 0);
    if (!properties.transmissionModeProperties || typeof properties.transmissionModeProperties !== 'object') {
        properties.transmissionModeProperties = defaultFrameMode();
    }
    const tm = properties.transmissionModeProperties;
    const modes = useMemo(() => platform.transmissionModes(), []);
    if (!tm.pluginPointName && modes[0]) tm.pluginPointName = modes[0].name;
    const modeOf = () => modes.find((m) => m.name === tm.pluginPointName);

    const mode = modeOf();
    const sample = mode && mode.sampleFrame ? mode.sampleFrame(tm) : '<Message Data>';

    const openSettings = () => {
        const m = modeOf();
        if (m && m.openSettings) m.openSettings(tm, () => { onChange(); tick(); });
    };

    return (
        <div className="mb-4">
            <div className="cform">
                <div className="cform-section">
                    <div className="cform-section-title">Transmission Mode</div>
                    <div className="cform-grid">
                        <label className="cform-label">Transmission Mode:</label>
                        <div className="cform-control">
                            <div className="flex gap-1.5 items-center">
                                <select value={tm.pluginPointName} className="w-[180px]"
                                    onChange={(e) => {
                                        tm.pluginPointName = e.target.value;
                                        const m = modeOf();
                                        if (m && m.apply) m.apply(tm);
                                        onChange();
                                        tick();
                                    }}>
                                    {modes.map((m) => <option key={m.name} value={m.name}>{m.label}</option>)}
                                </select>
                                {mode && mode.openSettings && (
                                    <button type="button" className="icon-btn" title="Transmission Mode Settings"
                                        onClick={openSettings}><Icon name="settings" /></button>
                                )}
                            </div>
                        </div>
                        <label className="cform-label">Sample Frame:</label>
                        <div className="cform-control"><span className="mono text-text-faint text-[12px]">{sample}</span></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
