/*
 * Guided channel builder — a step-by-step ALTERNATIVE to the classic tabbed
 * channel editor, for NEW channels only. It produces the exact same channel
 * model as newChannel() + the connector panels + transformer/filter steps, so
 * Save / deploy / export / import are all unchanged. Reached from the New Channel
 * chooser (channels.jsx) or directly at /channels/new/guided; the classic editor
 * stays the default unless the user prefers guided (Settings → Administrator).
 *
 * Steps: Basics → Source → Destinations → Review. Source and every destination
 * carry their own Filter + Transform (Passthrough / Field mapper / JavaScript),
 * built into the channel's element lists. On Create the channel is saved to the
 * engine, then the completion screen offers Open in Editor / Deploy / Done.
 *
 * Connector panels are the real registered panels (all fields), mounted as
 * imperative React islands (mountReact) exactly like the classic editor so they
 * keep their own state across the wizard's re-renders.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { toast } from '@oie/web-ui';
import { platform } from '@oie/web-shell';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { PluginSlot } from '../plugin-slot.jsx';
import { reactView, mountReact } from '../mount.jsx';
import { CodeEditor } from '../ui.jsx';
import { Icon } from '../bridges.jsx';

const STEPS = ['Basics', 'Source', 'Destinations', 'Review'];

const MAPPER_TYPE = 'com.mirth.connect.plugins.mapper.MapperStep';
const JS_STEP_TYPE = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE_TYPE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const JS_RULE_TYPE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';

const RULE_CONDITIONS = [
    { value: 'EXISTS', label: 'Exists' },
    { value: 'NOT_EXIST', label: 'Does not exist' },
    { value: 'EQUALS', label: 'Equals' },
    { value: 'NOT_EQUAL', label: 'Does not equal' },
    { value: 'CONTAINS', label: 'Contains' },
    { value: 'NOT_CONTAIN', label: 'Does not contain' }
];
const NEEDS_VALUE = (c) => !['EXISTS', 'NOT_EXIST'].includes(c);

/* ---- small model helpers ------------------------------------------------------ */

function connectorIcon(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('channel')) return 'channels';
    if (n.includes('http') || n.includes('web service')) return 'globe';
    if (n.includes('tcp') || n.includes('mllp')) return 'server';
    if (n.includes('database')) return 'db';
    if (n.includes('file') || n.includes('document')) return 'folder';
    if (n.includes('javascript')) return 'code';
    if (n.includes('smtp') || n.includes('jms') || n.includes('mail')) return 'mail';
    if (n.includes('dicom')) return 'file';
    return 'puzzle';
}

/** Registered connector transport names for a mode (excludes the '*' fallback). */
function transportsFor(mode) {
    const names = [];
    for (const key of platform.connectorPanels().keys()) {
        const i = key.indexOf(':');
        if (key.slice(0, i) === mode) {
            const name = key.slice(i + 1);
            if (name !== '*') names.push(name);
        }
    }
    return names.sort((a, b) => a.localeCompare(b));
}

/** A data type's default properties object (falls back to a bare versioned object). */
function dtDefaults(name, version) {
    const d = dataTypeDef(name);
    return d && typeof d.defaults === 'function' ? d.defaults(version) : { '@version': version };
}

function setTransformerTypes(tx, inName, outName, version) {
    tx.inboundDataType = inName;
    tx.inboundProperties = dtDefaults(inName, version);
    tx.outboundDataType = outName;
    tx.outboundProperties = dtDefaults(outName, version);
}

/** Push the Basics data types through the source and every destination. */
function applyDataTypes(channel, inbound, outbound, version) {
    setTransformerTypes(channel.sourceConnector.transformer, inbound, outbound, version);
    for (const d of oie.destinationsOf(channel)) setTransformerTypes(d.transformer, outbound, outbound, version);
}

/** Prefer HL7 v2.x as the default data type, else the first registered one. */
function defaultDataType(types) {
    if (types.some((t) => t.name === 'HL7V2')) return 'HL7V2';
    const hl7 = types.find((t) => /hl7/i.test(t.name) || /hl7/i.test(t.label));
    return hl7 ? hl7.name : (types[0] ? types[0].name : 'RAW');
}

/* Serialize the simplified handling UI back into engine element lists. */
function serializeTransform(tx, mode, mapperRows, script, version) {
    if (mode === 'mapper') {
        const steps = mapperRows
            .filter((r) => (r.variable || '').trim() || (r.mapping || '').trim())
            .map((r) => ({
                __type: MAPPER_TYPE, '@version': version,
                name: (r.variable || '').trim() || 'Mapping', enabled: true,
                variable: (r.variable || '').trim(), mapping: (r.mapping || '').trim(),
                defaultValue: r.defaultValue || '', replacements: '', scope: 'CHANNEL'
            }));
        tx.elements = oie.arrayToElements(steps);
    } else if (mode === 'javascript') {
        const s = (script || '').trim();
        tx.elements = s ? oie.arrayToElements([{ __type: JS_STEP_TYPE, '@version': version, name: 'JavaScript', enabled: true, script }]) : null;
    } else {
        tx.elements = null;
    }
}

function serializeFilter(flt, mode, ruleRows, script, version) {
    if (mode === 'rules') {
        const rules = ruleRows
            .filter((r) => (r.field || '').trim())
            .map((r, i) => ({
                __type: RULE_TYPE, '@version': version,
                name: `Rule ${i + 1}`, enabled: true, operator: i === 0 ? 'NONE' : 'AND',
                field: (r.field || '').trim(), condition: r.condition || 'EXISTS',
                values: NEEDS_VALUE(r.condition || 'EXISTS') && (r.value || '').trim() ? { string: [(r.value || '').trim()] } : ''
            }));
        flt.elements = oie.arrayToElements(rules);
    } else if (mode === 'javascript') {
        const s = (script || '').trim();
        flt.elements = s ? oie.arrayToElements([{ __type: JS_RULE_TYPE, '@version': version, name: 'JavaScript', enabled: true, operator: 'NONE', script }]) : null;
    } else {
        flt.elements = null;
    }
}

/* ---- connector panel island --------------------------------------------------- */

// Mount the real connector panel (all fields) as an imperative React island so it
// keeps its own state across wizard re-renders. Remounts when the transport
// changes (new properties object) or the connector identity changes.
function ConnectorPanelMount({ channel, connector, mode, onChange }) {
    const hostRef = useRef(null);
    useEffect(() => {
        const host = hostRef.current;
        const def = platform.connectorPanel(connector.transportName, mode) || platform.connectorPanel('*', mode);
        if (!host || !def || typeof def.component !== 'function') return undefined;
        return mountReact(host, <PluginSlot def={def} ctx={{ properties: connector.properties, connector, channel, platform, onChange }} />);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connector, connector.transportName, mode]);
    return <div ref={hostRef} />;
}

/* ---- transport picker --------------------------------------------------------- */

function TransportPicker({ mode, current, onPick }) {
    const names = transportsFor(mode);
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {names.map((name) => {
                const active = name === current;
                return (
                    <button key={name} type="button" onClick={() => onPick(name)}
                        className={`panel !mt-0 text-left p-3 flex items-center gap-2.5 cursor-pointer transition-colors ${active ? 'border-accent bg-[var(--accent-glow)]' : 'hover:border-accent'}`}>
                        <Icon name={connectorIcon(name)} size={18} />
                        <span className={active ? 'text-accent font-semibold' : ''}>{name}</span>
                    </button>
                );
            })}
        </div>
    );
}

/* ---- filter / transform handling ---------------------------------------------- */

function RowButton({ label, icon, onClick, danger }) {
    return (
        <button type="button" onClick={onClick} className={`btn btn-sm ${danger ? 'btn-danger' : ''}`}>
            {icon ? <Icon name={icon} size={13} /> : null}{label}
        </button>
    );
}

// Simplified filter + transform editor for one connector. Owns its UI state
// (seeded empty — the wizard always starts from a blank connector) and writes the
// engine element lists back into connector.transformer / connector.filter on every
// change. Keyed by the connector so switching destinations gives a fresh editor.
function HandlingEditor({ connector, version }) {
    const [txMode, setTxMode] = useState('passthrough');
    const [mapperRows, setMapperRows] = useState([{ variable: '', mapping: '', defaultValue: '' }]);
    const [txScript, setTxScript] = useState('// Modify the message, then return it.\nreturn msg;');

    const [fMode, setFMode] = useState('none');
    const [ruleRows, setRuleRows] = useState([{ field: '', condition: 'EXISTS', value: '' }]);
    const [fScript, setFScript] = useState('// Return true to accept the message, false to filter it.\nreturn true;');

    useEffect(() => { serializeTransform(connector.transformer, txMode, mapperRows, txScript, version); }, [connector, txMode, mapperRows, txScript, version]);
    useEffect(() => { serializeFilter(connector.filter, fMode, ruleRows, fScript, version); }, [connector, fMode, ruleRows, fScript, version]);

    const setRow = (rows, setRows, i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

    return (
        <div className="flex flex-col gap-4">
            {/* Filter */}
            <div className="panel !mt-0">
                <div className="panel-header flex items-center gap-2"><Icon name="filter" size={14} />Filter</div>
                <div className="panel-body flex flex-col gap-3">
                    <label className="flex items-center gap-3">
                        <span className="w-[130px] text-text-dim">Accept messages</span>
                        <select className="flex-none" value={fMode} onChange={(e) => setFMode(e.target.value)}>
                            <option value="none">Accept all</option>
                            <option value="rules">Matching conditions…</option>
                            <option value="javascript">Custom JavaScript…</option>
                        </select>
                    </label>
                    {fMode === 'rules' && (
                        <div className="flex flex-col gap-2">
                            {ruleRows.map((r, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <input className="flex-1" placeholder="Field (e.g. msg['MSH']['MSH.9']['MSH.9.1'].toString())"
                                        value={r.field} onChange={(e) => setRow(ruleRows, setRuleRows, i, { field: e.target.value })} />
                                    <select value={r.condition} onChange={(e) => setRow(ruleRows, setRuleRows, i, { condition: e.target.value })}>
                                        {RULE_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                    </select>
                                    <input className="w-[140px]" placeholder="Value" disabled={!NEEDS_VALUE(r.condition)}
                                        value={r.value} onChange={(e) => setRow(ruleRows, setRuleRows, i, { value: e.target.value })} />
                                    <RowButton icon="trash" danger onClick={() => setRuleRows(ruleRows.length > 1 ? ruleRows.filter((_, idx) => idx !== i) : [{ field: '', condition: 'EXISTS', value: '' }])} />
                                </div>
                            ))}
                            <div><RowButton label="Add condition" icon="plus" onClick={() => setRuleRows([...ruleRows, { field: '', condition: 'EXISTS', value: '' }])} /></div>
                            <div className="hint">All conditions must match (AND) for the message to be accepted.</div>
                        </div>
                    )}
                    {fMode === 'javascript' && (
                        <CodeEditor language="javascript" defaultValue={fScript} onChange={setFScript} style={{ minHeight: '150px' }} />
                    )}
                </div>
            </div>

            {/* Transform */}
            <div className="panel !mt-0">
                <div className="panel-header flex items-center gap-2"><Icon name="transform" size={14} />Transform</div>
                <div className="panel-body flex flex-col gap-3">
                    <label className="flex items-center gap-3">
                        <span className="w-[130px] text-text-dim">Message handling</span>
                        <select className="flex-none" value={txMode} onChange={(e) => setTxMode(e.target.value)}>
                            <option value="passthrough">Pass through (no changes)</option>
                            <option value="mapper">Map fields…</option>
                            <option value="javascript">Custom JavaScript…</option>
                        </select>
                    </label>
                    {txMode === 'mapper' && (
                        <div className="flex flex-col gap-2">
                            {mapperRows.map((r, i) => (
                                <div key={i} className="flex items-center gap-2">
                                    <input className="w-[180px]" placeholder="Variable name"
                                        value={r.variable} onChange={(e) => setRow(mapperRows, setMapperRows, i, { variable: e.target.value })} />
                                    <span className="text-text-faint">=</span>
                                    <input className="flex-1" placeholder="Source (e.g. msg['PID']['PID.3']['PID.3.1'].toString())"
                                        value={r.mapping} onChange={(e) => setRow(mapperRows, setMapperRows, i, { mapping: e.target.value })} />
                                    <input className="w-[120px]" placeholder="Default"
                                        value={r.defaultValue} onChange={(e) => setRow(mapperRows, setMapperRows, i, { defaultValue: e.target.value })} />
                                    <RowButton icon="trash" danger onClick={() => setMapperRows(mapperRows.length > 1 ? mapperRows.filter((_, idx) => idx !== i) : [{ variable: '', mapping: '', defaultValue: '' }])} />
                                </div>
                            ))}
                            <div><RowButton label="Add mapping" icon="plus" onClick={() => setMapperRows([...mapperRows, { variable: '', mapping: '', defaultValue: '' }])} /></div>
                            <div className="hint">Each mapping stores the source value into a channel variable (a Mapper step).</div>
                        </div>
                    )}
                    {txMode === 'javascript' && (
                        <CodeEditor language="javascript" defaultValue={txScript} onChange={setTxScript} style={{ minHeight: '150px' }} />
                    )}
                </div>
            </div>
        </div>
    );
}

/* ---- connector step (source / a destination) ---------------------------------- */

function ConnectorStep({ channel, connector, mode, version, onChange }) {
    return (
        <div className="flex flex-col gap-4">
            <div>
                <div className="cform-section-title mb-2">Connector type</div>
                <TransportPicker mode={mode} current={connector.transportName}
                    onPick={(name) => {
                        if (name === connector.transportName) return;
                        const def = platform.connectorPanel(name, mode);
                        if (!def || typeof def.defaults !== 'function') { toast(`"${name}" has no web configuration panel.`, 'warn'); return; }
                        connector.transportName = name;
                        connector.properties = def.defaults(version);
                        onChange();
                    }} />
            </div>
            <div className="panel !mt-0">
                <div className="panel-header">{connector.transportName} settings</div>
                <div className="panel-body">
                    <ConnectorPanelMount key={connector.transportName} channel={channel} connector={connector} mode={mode} onChange={onChange} />
                </div>
            </div>
            <HandlingEditor key={`h-${connector.metaDataId}`} connector={connector} version={version} />
        </div>
    );
}

/* ---- steps -------------------------------------------------------------------- */

function BasicsStep({ channel, types, inbound, outbound, onChange, onInbound, onOutbound, nameError }) {
    return (
        <div className="panel !mt-0 max-w-[720px]">
            <div className="panel-body flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">Channel name</span>
                    <input autoFocus className={`w-full ${nameError ? 'cform-invalid' : ''}`} value={channel.name}
                        placeholder="My Channel" onChange={(e) => { channel.name = e.target.value; onChange(); }} />
                    {nameError ? <span className="text-err text-[11px]">{nameError}</span> : null}
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">Description</span>
                    <textarea className="w-full" rows={3} value={channel.description || ''}
                        onChange={(e) => { channel.description = e.target.value; onChange(); }} />
                </label>
                <div className="flex gap-4">
                    <label className="flex flex-col gap-1 flex-1">
                        <span className="text-text-dim">Inbound data type</span>
                        <select value={inbound} onChange={(e) => onInbound(e.target.value)}>
                            {types.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                        <span className="text-text-dim">Outbound data type</span>
                        <select value={outbound} onChange={(e) => onOutbound(e.target.value)}>
                            {types.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                </div>
                <div className="hint">The inbound type is what the source receives; the outbound type is what destinations send. You can refine everything later in the editor.</div>
            </div>
        </div>
    );
}

function DestinationsStep({ channel, version, selected, onSelect, onAdd, onRemove, onRename, onChange }) {
    const dests = oie.destinationsOf(channel);
    const sel = dests[selected] || dests[0];
    return (
        <div className="flex gap-4 items-start">
            <div className="w-[240px] flex-none flex flex-col gap-2">
                <div className="cform-section-title">Destinations</div>
                <div className="step-list">
                    {dests.map((d, i) => (
                        <div key={d.metaDataId} className={`step-item ${i === selected ? 'selected' : ''}`} onClick={() => onSelect(i)}>
                            <div className="flex items-center gap-2">
                                <Icon name={connectorIcon(d.transportName)} size={14} />
                                <div className="flex-1 truncate">{d.name}</div>
                            </div>
                            <div className="step-type">{d.transportName}</div>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <RowButton label="Add" icon="plus" onClick={onAdd} />
                    <RowButton label="Remove" icon="trash" danger onClick={() => onRemove(selected)} />
                </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-4">
                {sel && (
                    <>
                        <label className="flex items-center gap-3">
                            <span className="w-[120px] text-text-dim">Destination name</span>
                            <input className="flex-1" value={sel.name} onChange={(e) => onRename(sel, e.target.value)} />
                        </label>
                        <ConnectorStep key={sel.metaDataId} channel={channel} connector={sel} mode="DESTINATION" version={version} onChange={onChange} />
                    </>
                )}
            </div>
        </div>
    );
}

function ReviewLine({ label, value }) {
    return (
        <div className="flex gap-4 py-2 border-b border-line">
            <div className="w-[160px] flex-none text-text-dim">{label}</div>
            <div className="flex-1 min-w-0">{value}</div>
        </div>
    );
}

function handlingSummary(connector) {
    const tx = oie.elementsToArray(connector.transformer && connector.transformer.elements);
    const fl = oie.elementsToArray(connector.filter && connector.filter.elements);
    const t = !tx.length ? 'Passthrough'
        : tx.every((e) => e.__type === MAPPER_TYPE) ? `${tx.length} field mapping${tx.length > 1 ? 's' : ''}`
            : 'JavaScript';
    const f = !fl.length ? 'Accept all' : fl.every((e) => e.__type === RULE_TYPE) ? `${fl.length} condition${fl.length > 1 ? 's' : ''}` : 'JavaScript';
    return `Filter: ${f} · Transform: ${t}`;
}

function ReviewStep({ channel, inbound, outbound }) {
    const dests = oie.destinationsOf(channel);
    const label = (n) => (dataTypeList().find((t) => t.name === n) || {}).label || n;
    return (
        <div className="panel !mt-0 max-w-[820px]">
            <div className="panel-body">
                <ReviewLine label="Name" value={channel.name || <span className="text-err">(required)</span>} />
                {channel.description ? <ReviewLine label="Description" value={channel.description} /> : null}
                <ReviewLine label="Data types" value={`${label(inbound)} → ${label(outbound)}`} />
                <ReviewLine label="Source" value={<div><div>{channel.sourceConnector.transportName}</div><div className="hint">{handlingSummary(channel.sourceConnector)}</div></div>} />
                <ReviewLine label={`Destinations (${dests.length})`} value={
                    <div className="flex flex-col gap-2">
                        {dests.map((d) => <div key={d.metaDataId}><div>{d.name} — {d.transportName}</div><div className="hint">{handlingSummary(d)}</div></div>)}
                    </div>} />
            </div>
        </div>
    );
}

function Completion({ channelName, onOpen, onDeploy, onList, deploying }) {
    return (
        <div className="panel !mt-0 max-w-[560px] mx-auto text-center">
            <div className="panel-body flex flex-col items-center gap-4 py-8">
                <div className="text-accent"><Icon name="check" size={40} /></div>
                <div className="text-lg font-semibold">Channel created</div>
                <div className="text-text-dim">“{channelName}” was saved to the engine.</div>
                <div className="flex gap-2 mt-2">
                    <button className="btn btn-primary" onClick={onOpen}><Icon name="edit" size={14} />Open in Editor</button>
                    <button className="btn" onClick={onDeploy} disabled={deploying}><Icon name="deploy" size={14} />{deploying ? 'Deploying…' : 'Deploy now'}</button>
                    <button className="btn btn-ghost" onClick={onList}>Back to Channels</button>
                </div>
            </div>
        </div>
    );
}

/* ---- orchestrator ------------------------------------------------------------- */

function ChannelWizardView() {
    const version = store.getState('serverVersion') || '4.6.0';
    const [, bump] = useReducer((x) => x + 1, 0);

    const channelRef = useRef(null);
    const typesRef = useRef(null);
    if (!typesRef.current) typesRef.current = dataTypeList();
    const types = typesRef.current;

    const [inbound, setInbound] = useState(() => defaultDataType(types));
    const [outbound, setOutbound] = useState(() => defaultDataType(types));

    if (!channelRef.current) {
        channelRef.current = oie.newChannel('', version);
        channelRef.current.name = '';   // newChannel defaults to "New Channel"; start blank so Basics requires a name
        applyDataTypes(channelRef.current, inbound, outbound, version);
    }
    const channel = channelRef.current;

    const [step, setStep] = useState(0);
    const [selectedDest, setSelectedDest] = useState(0);
    const [existingNames, setExistingNames] = useState(null);
    const [created, setCreated] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deploying, setDeploying] = useState(false);

    useEffect(() => {
        let alive = true;
        api.channels.idsAndNames().then((res) => {
            if (!alive) return;
            const names = [];
            for (const en of api.asList(res && res.entry)) {
                const pair = api.asList(en && en.string);
                if (pair.length >= 2) names.push(String(pair[1]).toLowerCase());
            }
            setExistingNames(names);
        }).catch(() => { if (alive) setExistingNames([]); });
        return () => { alive = false; };
    }, []);

    /* ---- validation ---- */
    function nameError() {
        const name = String(channel.name || '').trim();
        if (!name) return 'A channel name is required.';
        if (name.length > 40) return 'Channel name cannot be longer than 40 characters.';
        if (!/^[A-Za-z0-9_\s-]*$/.test(name)) return 'Only letters, numbers, spaces, hyphens and underscores are allowed.';
        if (existingNames && existingNames.includes(name.toLowerCase())) return `A channel named “${name}” already exists.`;
        return null;
    }
    function connectorErrors(connector, mode) {
        const def = platform.connectorPanel(connector.transportName, mode);
        if (!def || typeof def.validate !== 'function') return [];
        try { return def.validate(connector.properties) || []; } catch { return []; }
    }
    function stepValid(i) {
        if (i === 0) return !nameError();
        if (i === 1) return connectorErrors(channel.sourceConnector, 'SOURCE').length === 0;
        if (i === 2) return oie.destinationsOf(channel).every((d) => connectorErrors(d, 'DESTINATION').length === 0);
        return true;
    }

    /* ---- data-type + destination actions ---- */
    const changeInbound = (v) => { setInbound(v); applyDataTypes(channel, v, outbound, version); bump(); };
    const changeOutbound = (v) => { setOutbound(v); applyDataTypes(channel, inbound, v, version); bump(); };

    const addDestination = () => {
        const dests = oie.destinationsOf(channel);
        const id = channel.nextMetaDataId || (dests.length + 1);
        channel.nextMetaDataId = id + 1;
        const dest = oie.defaultDestinationConnector(version, id, `Destination ${dests.length + 1}`);
        setTransformerTypes(dest.transformer, outbound, outbound, version);
        oie.setDestinations(channel, [...dests, dest]);
        setSelectedDest(dests.length);
        bump();
    };
    const removeDestination = (i) => {
        const dests = oie.destinationsOf(channel);
        if (dests.length <= 1) { toast('A channel needs at least one destination.', 'warn'); return; }
        oie.setDestinations(channel, dests.filter((_, idx) => idx !== i));
        setSelectedDest(Math.max(0, i - 1));
        bump();
    };
    const renameDestination = (dest, name) => { dest.name = name; bump(); };

    /* ---- create / finish ---- */
    async function create() {
        if (saving) return;
        setSaving(true);
        try {
            await api.channels.create(channel);
            setCreated(true);
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not save the channel.', 'error');
        } finally {
            setSaving(false);
        }
    }
    function openInEditor() {
        store.setState('editingChannel', channel);
        store.setState('editingChannelNew', false);
        router.navigate(`/channels/${channel.id}/edit`);
    }
    async function deployNow() {
        if (deploying) return;
        setDeploying(true);
        try {
            await api.engine.deploy(channel.id);
            toast(`Deploying “${channel.name}”.`, 'info');
            router.navigate('/dashboard');
        } catch (e) {
            toast(e && e.message ? e.message : 'Deploy failed.', 'error');
            setDeploying(false);
        }
    }

    if (created) {
        return (
            <div className="view"><div className="view-body p-4">
                <Completion channelName={channel.name} deploying={deploying}
                    onOpen={openInEditor} onDeploy={deployNow} onList={() => router.navigate('/channels')} />
            </div></div>
        );
    }

    const canNext = stepValid(step);
    const nErr = step === 0 ? nameError() : null;

    return (
        <div className="view">
            <div className="view-header flex items-center gap-3">
                <Icon name="channels" size={18} />
                <div className="font-semibold">New Channel — Guided</div>
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => router.navigate('/channels')}>Cancel</button>
            </div>

            {/* Stepper — folded chevron arrows: Basics ▸ Source ▸ Destinations ▸ Review */}
            <div className="wiz-steps px-4 py-3 border-b border-line select-none">
                {STEPS.map((label, i) => {
                    const done = i < step;
                    const active = i === step;
                    const clickable = i <= step;
                    return (
                        <div key={label} role="button" aria-current={active ? 'step' : undefined}
                            className={`wiz-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${clickable ? 'clickable' : ''}`}
                            onClick={() => clickable && setStep(i)}>
                            {done ? <Icon name="check" size={13} /> : null}
                            <span>{label}</span>
                        </div>
                    );
                })}
            </div>

            <div className="view-body overflow-x-hidden">
                {/* keyed on step so the slide-in animation replays on each step change */}
                <div className="wiz-pane" key={step}>
                    {step === 0 && (
                        <BasicsStep channel={channel} types={types} inbound={inbound} outbound={outbound}
                            onChange={bump} onInbound={changeInbound} onOutbound={changeOutbound} nameError={nErr} />
                    )}
                    {step === 1 && (
                        <ConnectorStep channel={channel} connector={channel.sourceConnector} mode="SOURCE" version={version} onChange={bump} />
                    )}
                    {step === 2 && (
                        <DestinationsStep channel={channel} version={version} selected={selectedDest}
                            onSelect={setSelectedDest} onAdd={addDestination} onRemove={removeDestination}
                            onRename={renameDestination} onChange={bump} />
                    )}
                    {step === 3 && <ReviewStep channel={channel} inbound={inbound} outbound={outbound} />}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                <button className="btn" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
                <div className="ml-auto flex items-center gap-2">
                    {step < STEPS.length - 1 ? (
                        <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button>
                    ) : (
                        <button className="btn btn-primary" disabled={saving || !!nameError()} onClick={create}>
                            <Icon name="save" size={14} />{saving ? 'Creating…' : 'Create Channel'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function register(platform) {
    platform.registerView('/channels/new/guided', reactView(ChannelWizardView), { title: 'New Channel — Guided' });
}

export { ChannelWizardView };
