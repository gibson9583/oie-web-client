/*
 * Guided channel builder — a step-by-step ALTERNATIVE to the classic tabbed
 * channel editor, for NEW channels only. It has FEATURE PARITY with the classic
 * editor (every option is reachable) in a modern, responsive wizard UI, and emits
 * the exact same channel model (newChannel() + connector panels + transformer/
 * filter elements), so Save / deploy / export / import are unchanged.
 *
 * Steps: Basics → Source → Destinations → Scripts → Advanced → Review. Source and
 * every destination expose Settings / Filter / Transformer (+ Response for
 * destinations) sub-tabs — the real connector panels, connector-properties (SSL/
 * auth) panels, queue settings, data-type properties, and the full step/rule
 * editors from the registries. On Create the channel is saved to the engine, then
 * the completion screen offers Open in Editor / Deploy / Done.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { toast, confirmDialog } from '@oie/web-ui';
import { platform } from '@oie/web-shell';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { getPref } from '../../core/prefs.js';
import { PluginSlot } from '../plugin-slot.jsx';
import { reactView, mountReact, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { useWizardModel, useWizardSteps, useLeaveGuard, WizardStepper, WizardHeader } from './wizard-frame.jsx';
import { createEmbeddedEditor } from './filter-transformer.jsx';
import {
    ConnectorPropertiesPanels, QueueSettings, ChannelScripts, ChannelSettings, DataTypeBar,
    DependenciesStep, persistLibraryAssociations, persistChannelDependencies
} from './channel-wizard-editors.jsx';
import { DESTINATION_MAPPINGS } from './channel-editor.jsx';

const STEPS = ['Basics', 'Dependencies', 'Channel Options', 'Source', 'Destinations', 'Scripts', 'Review'];

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

function dtDefaults(name, version) {
    const d = dataTypeDef(name);
    return d && typeof d.defaults === 'function' ? d.defaults(version) : { '@version': version };
}
function setTransformerInbound(tx, name, version) { tx.inboundDataType = name; tx.inboundProperties = dtDefaults(name, version); }
function setTransformerOutbound(tx, name, version) { tx.outboundDataType = name; tx.outboundProperties = dtDefaults(name, version); }
function setTransformerTypes(tx, inName, outName, version) {
    setTransformerInbound(tx, inName, version);
    setTransformerOutbound(tx, outName, version);
}
/** Seed a brand-new channel's data types uniformly: source and every destination
 *  get the chosen inbound/outbound. Editing an existing channel uses the precise,
 *  Swing-faithful handlers (changeInbound/changeOutbound) instead, which never
 *  overwrite a destination's own outbound data type. */
function applyDataTypes(channel, inbound, outbound, version) {
    setTransformerTypes(channel.sourceConnector.transformer, inbound, outbound, version);
    for (const d of oie.destinationsOf(channel)) setTransformerTypes(d.transformer, outbound, outbound, version);
}
function defaultDataType(types) {
    if (types.some((t) => t.name === 'HL7V2')) return 'HL7V2';
    const hl7 = types.find((t) => /hl7/i.test(t.name) || /hl7/i.test(t.label));
    return hl7 ? hl7.name : (types[0] ? types[0].name : 'RAW');
}

function applyTransport(connector, mode, name, version, onChange) {
    if (name === connector.transportName) return;
    const def = platform.connectorPanel(name, mode);
    if (!def || typeof def.defaults !== 'function') { toast(`"${name}" has no web configuration panel.`, 'warn'); return; }
    connector.transportName = name;
    connector.properties = def.defaults(version);
    onChange();
}

/* ---- connector panel island --------------------------------------------------- */

// Mount the real connector panel (all fields) as an imperative React island so it
// keeps its own state across wizard re-renders. Remounts when the transport changes.
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
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {names.map((name) => {
                const active = name === current;
                return (
                    <button key={name} type="button" onClick={() => onPick(name)} style={{ font: 'inherit' }}
                        className={`panel !mt-0 appearance-none text-[var(--text)] text-left p-3 flex items-center gap-2.5 cursor-pointer transition-colors ${active ? 'border-accent bg-[var(--accent-glow)]' : 'hover:border-accent'}`}>
                        <Icon name={connectorIcon(name)} size={18} />
                        <span className={active ? 'text-accent font-semibold' : ''}>{name}</span>
                    </button>
                );
            })}
        </div>
    );
}

/* ---- embedded filter / transformer / response editor -------------------------- */

// Mount the REAL filter/transformer/response editor (from filter-transformer.jsx) as
// an imperative island — full parity: step/rule grid, plugin step editors (Monaco),
// data types, message templates + trees, accessor drag-and-drop, generated-script
// preview. Its tasks (add/delete/iterator/import/export/validate) are surfaced as an
// inline toolbar; Save/Back are omitted (the wizard owns those). The editor reads the
// channel from the store, so we point store.editingChannel at the wizard's channel.
function EmbeddedElementEditor({ channel, metaDataId, kind, onChange }) {
    const hostRef = useRef(null);
    const ctxRef = useRef(null);
    const [, forceBar] = useReducer((x) => x + 1, 0);
    // Latest onChange without re-running the mount effect (bump is a fresh closure each render).
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        store.setState('editingChannel', channel);
        store.setState('editingChannelNew', true);
        // createEmbeddedEditor (buildBody) installs its OWN nav guard for the classic
        // editor's benefit — that would clobber the wizard's prompt-on-leave guard and
        // leave it gone for the rest of the session. Capture the wizard's guard first
        // and restore it (here and on unmount), so leaving still prompts on unsaved work.
        const wizardGuard = store.getState('navGuard');
        // An edit in the embedded filter/transformer/response must mark the WIZARD dirty
        // (via bump), or an existing channel's Save never shows and the edits are lost.
        const ctx = createEmbeddedEditor({ channelId: channel.id, metaDataId }, kind,
            () => { forceBar(); if (onChangeRef.current) onChangeRef.current(); });
        ctxRef.current = ctx;
        host.appendChild(ctx.el);
        if (ctx.onAccessorDragOver) host.addEventListener('dragover', ctx.onAccessorDragOver);
        if (ctx.onAccessorDrop) host.addEventListener('drop', ctx.onAccessorDrop);
        store.setState('navGuard', wizardGuard);
        forceBar();
        return () => {
            if (ctx.onAccessorDragOver) host.removeEventListener('dragover', ctx.onAccessorDragOver);
            if (ctx.onAccessorDrop) host.removeEventListener('drop', ctx.onAccessorDrop);
            ctxRef.current = null;
            try { ctx.teardown && ctx.teardown(); } catch { /* ignore */ }
            host.replaceChildren();
            store.setState('navGuard', wizardGuard);
        };
    }, [channel, metaDataId, kind]);

    const ctx = ctxRef.current;
    const t = ctx && ctx.handlers;
    const ts = (ctx && ctx.taskState && ctx.taskState()) || { onStep: false, assign: false, remove: false };
    const noun = kind === 'filter' ? 'Rule' : 'Step';
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
                {t && <button type="button" className="btn btn-sm" onClick={t.addElement}><Icon name="plus" size={13} />Add {noun}</button>}
                {t && ts.onStep && <button type="button" className="btn btn-sm btn-danger" onClick={t.deleteElement}><Icon name="trash" size={13} />Delete</button>}
                {t && ts.assign && <button type="button" className="btn btn-sm" onClick={t.assignToIterator}><Icon name="plus" size={13} />Assign to Iterator</button>}
                {t && ts.remove && <button type="button" className="btn btn-sm" onClick={t.removeFromIterator}><Icon name="minus" size={13} />Remove from Iterator</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.importElements}><Icon name="import" size={13} />Import</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.exportElements}><Icon name="export" size={13} />Export</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.validateElements}><Icon name="check" size={13} />Validate</button>}
            </div>
            <div ref={hostRef} className="flex flex-col h-[640px] border border-line rounded-md overflow-hidden" />
        </div>
    );
}

/* ---- connector step with Settings / Filter / Transformer / Response tabs ------- */

/* ---- Destination Mappings rail (velocity variable insert / drag) -------------- */

// The classic editor's Destination Mappings tokens, presented like the alert
// wizard's Variables panel: click inserts into the last-focused field of the
// connector settings; drag drops into any text field or Monaco editor. Monaco's
// native drop is bypassed (it snippet-escapes ${...}), so drops insert the token
// as plain text at the drop point — same approach as the classic editor.
const MAPPING_FLAVOR = 'application/x-oie-mapping';

function monacoInstanceAt(node) {
    const me = window.monaco && window.monaco.editor;
    const editors = me && me.getEditors ? me.getEditors() : [];
    return editors.find((ed) => { const n = ed.getDomNode && ed.getDomNode(); return n && n.contains(node); }) || null;
}

function insertableAt(node) {
    if (!node || !node.closest) return null;
    if (node.closest('.ce-monaco')) {
        const inst = monacoInstanceAt(node);
        if (inst) return { monaco: inst };
    }
    const el = node.closest('textarea, input[type=text]');
    if (el && !el.readOnly && !el.disabled) return { el };
    return null;
}

function insertIntoTarget(target, token, position) {
    if (target.monaco) {
        const inst = target.monaco;
        const pos = position || inst.getPosition();
        const Range = window.monaco.Range;
        inst.executeEdits('destination-mapping', [{
            range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: token, forceMoveMarkers: true
        }]);
        inst.focus();
        return true;
    }
    const el = target.el;
    if (!el || !el.isConnected) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + token.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
}

function DestinationMappingsRail({ hostRef }) {
    const targetRef = useRef(null);   // last focused insertable inside hostRef
    const dragTokenRef = useRef(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const trackFocus = (e) => {
            const found = e.target instanceof Element ? insertableAt(e.target) : null;
            if (found) targetRef.current = found;
        };
        const onDragOver = (e) => {
            const carrying = dragTokenRef.current
                || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(MAPPING_FLAVOR));
            if (!carrying) return;
            if (insertableAt(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        };
        const onDrop = (e) => {
            const token = dragTokenRef.current
                || (e.dataTransfer && (e.dataTransfer.getData(MAPPING_FLAVOR) || e.dataTransfer.getData('text/plain')));
            dragTokenRef.current = null;
            const target = token ? insertableAt(e.target) : null;
            if (!target) return;
            e.preventDefault();
            let pos = null;
            if (target.monaco && target.monaco.getTargetAtClientPoint) {
                const tgt = target.monaco.getTargetAtClientPoint(e.clientX, e.clientY);
                if (tgt && tgt.position) pos = tgt.position;
            }
            insertIntoTarget(target, token, pos);
        };
        host.addEventListener('focusin', trackFocus);
        host.addEventListener('dragover', onDragOver);
        host.addEventListener('drop', onDrop);
        return () => {
            host.removeEventListener('focusin', trackFocus);
            host.removeEventListener('dragover', onDragOver);
            host.removeEventListener('drop', onDrop);
        };
    }, [hostRef]);

    const insert = (token) => {
        const target = targetRef.current;
        if (target && insertIntoTarget(target, token)) return;
        // No known target — fall back to the clipboard, like the classic editor.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(
                () => toast(`Copied ${token}`),
                () => toast('Focus a text field first', 'warn'));
        } else {
            toast('Focus a text field first', 'warn');
        }
    };

    return (
        <div className="panel !mt-0 w-full lg:w-[240px] flex-none self-stretch">
            <div className="panel-header">Destination Mappings</div>
            <div className="panel-body flex flex-col gap-2">
                <div className="border border-line rounded overflow-auto max-h-[360px] min-h-[120px]">
                    {DESTINATION_MAPPINGS.map(([label, token]) => (
                        <div key={token} role="button" draggable title={token}
                            onDragStart={(e) => {
                                dragTokenRef.current = token;
                                e.dataTransfer.effectAllowed = 'copy';
                                e.dataTransfer.setData('text/plain', token);
                                e.dataTransfer.setData(MAPPING_FLAVOR, token);
                            }}
                            onDragEnd={() => { dragTokenRef.current = null; }}
                            onClick={() => insert(token)}
                            className="step-item cursor-grab">
                            <div className="flex-1 min-w-0"><div className="truncate">{label}</div></div>
                        </div>
                    ))}
                </div>
                <div className="hint">Click to insert into the focused field, or drag into a text field.</div>
            </div>
        </div>
    );
}

function ConnectorTabs({ channel, connector, mode, version, onChange, destIndex }) {
    const isDest = mode === 'DESTINATION';
    const TABS = isDest ? ['Settings', 'Filter', 'Transformer', 'Response'] : ['Settings', 'Filter', 'Transformer'];
    const [tab, setTab] = useState('Settings');
    const settingsHostRef = useRef(null);   // focus/drop scope for the Destination Mappings rail
    return (
        <div className="flex flex-col gap-4">
            <div className="tabs overflow-x-auto">
                {TABS.map((t) => (
                    <button key={t} type="button" className={`tab whitespace-nowrap ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
                ))}
            </div>

            {tab === 'Settings' && (
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="cform-section-title mb-2">Connector type</div>
                        <TransportPicker mode={mode} current={connector.transportName}
                            onPick={(name) => applyTransport(connector, mode, name, version, onChange)} />
                    </div>
                    {/* Inbound/outbound data types are settable right here (mirrored in the
                        Transformer tab's Message Templates — same model). */}
                    <DataTypeBar holder={connector.transformer} version={version} connectorType={mode} onChange={onChange} />
                    {/* "Wait for previous" applies to the 2nd destination onward (nothing
                        precedes the first). */}
                    {isDest && destIndex > 0 && (
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={connector.waitForPrevious !== false}
                                onChange={(e) => { connector.waitForPrevious = e.target.checked; onChange(); }} />
                            Wait for previous destination
                        </label>
                    )}
                    {/* Destination Settings (queue) sit above the connector panel, like the classic editor. */}
                    {isDest && <QueueSettings key={`q-${connector.metaDataId}-${connector.transportName}`} connector={connector} onChange={onChange} />}
                    {/* connector-properties (SSL/auth) panels render BEFORE the main panel, matching the classic editor */}
                    <ConnectorPropertiesPanels key={`pp-${connector.transportName}`} channel={channel} connector={connector} mode={mode} />
                    {/* Destinations get the classic Destination Mappings rail beside the
                        connector settings (styled like the alert wizard's Variables panel). */}
                    <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                        <div ref={settingsHostRef} className="panel !mt-0 flex-1 min-w-0">
                            <div className="panel-header">{connector.transportName} settings</div>
                            <div className="panel-body">
                                <ConnectorPanelMount key={connector.transportName} channel={channel} connector={connector} mode={mode} onChange={onChange} />
                            </div>
                        </div>
                        {isDest && <DestinationMappingsRail hostRef={settingsHostRef} />}
                    </div>
                </div>
            )}

            {tab === 'Filter' && <EmbeddedElementEditor key={`f-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="filter" onChange={onChange} />}

            {tab === 'Transformer' && <EmbeddedElementEditor key={`t-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="transformer" onChange={onChange} />}

            {isDest && tab === 'Response' && <EmbeddedElementEditor key={`r-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="response" onChange={onChange} />}
        </div>
    );
}

/* ---- steps -------------------------------------------------------------------- */

function BasicsStep({ channel, types, inbound, outbound, onChange, onNameChange, onInbound, onOutbound, nameError }) {
    return (
        <div className="panel !mt-0 max-w-[720px]">
            <div className="panel-body flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">Channel name</span>
                    <input autoFocus className={`w-full ${nameError ? 'cform-invalid' : ''}`} value={channel.name}
                        placeholder="My Channel" onChange={(e) => { channel.name = e.target.value; onNameChange(); }} />
                    {nameError ? <span className="text-err text-[11px]">{nameError}</span> : null}
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">Description</span>
                    <textarea className="w-full" rows={3} value={channel.description || ''}
                        onChange={(e) => { channel.description = e.target.value; onChange(); }} />
                </label>
                <div className="flex flex-col sm:flex-row gap-4">
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
                <div className="hint">These seed each connector's data types. Per-connector inbound/outbound types &amp; their properties live on each connector's <b>Transformer</b> tab (Message Templates panel). Channel-level options are in the <b>Dependencies</b>, <b>Channel Options</b>, and <b>Scripts</b> steps.</div>
            </div>
        </div>
    );
}

function DestinationsStep({ channel, version, selected, onSelect, onAdd, onRemove, onRename, onChange }) {
    const dests = oie.destinationsOf(channel);
    const sel = dests[selected] || dests[0];
    return (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="w-full lg:w-[240px] flex-none flex flex-col gap-2">
                <div className="cform-section-title">Destinations</div>
                <div className="step-list">
                    {dests.map((d, i) => (
                        <div key={d.metaDataId} className={`step-item min-w-0 ${i === selected ? 'selected' : ''}`} onClick={() => onSelect(i)} title={`${d.name} — ${d.transportName}`}>
                            <div className="flex items-center gap-2 min-w-0">
                                <Icon name={connectorIcon(d.transportName)} size={14} />
                                <div className="flex-1 min-w-0 truncate">{d.name}</div>
                            </div>
                            <div className="step-type truncate">{d.transportName}</div>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={onAdd}><Icon name="plus" size={13} />Add</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(selected)}><Icon name="trash" size={13} />Remove</button>
                </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-4">
                {sel && (
                    <>
                        <label className="flex items-center gap-3">
                            <span className="w-[120px] text-text-dim">Destination name</span>
                            <input className="flex-1" value={sel.name} onChange={(e) => onRename(sel, e.target.value)} />
                        </label>
                        <ConnectorTabs key={sel.metaDataId} channel={channel} connector={sel} mode="DESTINATION" version={version} onChange={onChange} destIndex={selected} />
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

function dtSummary(connector, label) {
    const tx = connector.transformer || {};
    return `${label(tx.inboundDataType)} → ${label(tx.outboundDataType)}`;
}

function handlingSummary(connector) {
    const tx = oie.elementsToArray(connector.transformer && connector.transformer.elements);
    const fl = oie.elementsToArray(connector.filter && connector.filter.elements);
    const f = fl.length ? `Filter: ${fl.length} rule${fl.length > 1 ? 's' : ''}` : 'Filter: accept all';
    const t = tx.length ? `Transform: ${tx.length} step${tx.length > 1 ? 's' : ''}` : 'Transform: passthrough';
    return `${f} · ${t}`;
}

const STATE_LABELS = { STARTED: 'Started', PAUSED: 'Paused', STOPPED: 'Stopped' };
const STORAGE_LABELS = { DEVELOPMENT: 'Development', PRODUCTION: 'Production', RAW: 'Raw', METADATA: 'Metadata', DISABLED: 'Disabled' };
const SCRIPT_LABELS = { deployScript: 'Deploy', undeployScript: 'Undeploy', preprocessingScript: 'Preprocessor', postprocessingScript: 'Postprocessor' };

function ReviewStep({ channel, inbound, outbound }) {
    const dests = oie.destinationsOf(channel);
    const label = (n) => (dataTypeList().find((t) => t.name === n) || {}).label || n;
    const p = channel.properties || {};
    const prune = (channel.exportData && channel.exportData.metadata && channel.exportData.metadata.pruningSettings) || {};
    const scripts = Object.keys(SCRIPT_LABELS).filter((k) => String(channel[k] || '').trim());
    const cols = ((p.metaDataColumns && (Array.isArray(p.metaDataColumns.metaDataColumn) ? p.metaDataColumns.metaDataColumn : (p.metaDataColumns.metaDataColumn ? [p.metaDataColumns.metaDataColumn] : []))) || []).filter((c) => c && c.name);
    const encFlags = [
        p.encryptData && 'content', p.encryptAttachments && 'attachments', p.encryptCustomMetaData && 'metadata'
    ].filter(Boolean);
    const pruneText = (prune.pruneMetaDataDays == null && prune.pruneContentDays == null)
        ? 'Stored indefinitely'
        : `Metadata ${prune.pruneMetaDataDays == null ? 'kept' : prune.pruneMetaDataDays + ' days'} · Content ${prune.pruneContentDays == null ? 'with metadata' : prune.pruneContentDays + ' days'}`;
    const tags = api.asList(channel.exportData && channel.exportData.channelTags, 'channelTag').map((t) => t && t.name).filter(Boolean);
    const attType = channel.properties && channel.properties.attachmentProperties && channel.properties.attachmentProperties.type;
    return (
        <div className="panel !mt-0 max-w-[820px]">
            <div className="panel-body">
                <ReviewLine label="Name" value={channel.name || <span className="text-err">(required)</span>} />
                {channel.description ? <ReviewLine label="Description" value={channel.description} /> : null}
                <ReviewLine label="Data types" value={`${label(inbound)} → ${label(outbound)}`} />
                <ReviewLine label="Initial state" value={STATE_LABELS[p.initialState] || 'Started'} />
                <ReviewLine label="Message storage" value={
                    <span>{STORAGE_LABELS[p.messageStorageMode] || 'Development'}{encFlags.length ? <span className="hint"> · encrypting {encFlags.join(', ')}</span> : null}</span>} />
                <ReviewLine label="Pruning" value={pruneText} />
                {attType && attType !== 'None' ? <ReviewLine label="Attachments" value={attType} /> : null}
                {tags.length ? <ReviewLine label="Tags" value={tags.join(', ')} /> : null}
                {cols.length ? <ReviewLine label="Metadata columns" value={cols.map((c) => c.name).join(', ')} /> : null}
                <ReviewLine label="Scripts" value={scripts.length ? scripts.map((k) => SCRIPT_LABELS[k]).join(', ') : 'None'} />
                <ReviewLine label="Source" value={<div><div>{channel.sourceConnector.transportName}</div><div className="hint">{dtSummary(channel.sourceConnector, label)} · {handlingSummary(channel.sourceConnector)}</div></div>} />
                <ReviewLine label={`Destinations (${dests.length})`} value={
                    <div className="flex flex-col gap-2">
                        {dests.map((d) => <div key={d.metaDataId}><div>{d.name} — {d.transportName}</div><div className="hint">{dtSummary(d, label)} · {handlingSummary(d)}</div></div>)}
                    </div>} />
            </div>
        </div>
    );
}

/* ---- orchestrator ------------------------------------------------------------- */

// Loader: resolve the channel to edit (see wizard-frame's useWizardModel), then
// render the wizard. /channels/new/guided creates; /channels/:channelId/guided edits.
function ChannelWizardView({ params }) {
    const version = store.getState('serverVersion') || '4.6.0';
    const { model, isNew, ready } = useWizardModel({
        routeId: params && params.channelId,
        storeKey: 'editingChannel',
        isValid: (c) => !!c.sourceConnector,
        makeNew: () => {
            const c = oie.newChannel('', version);
            c.name = '';   // newChannel defaults to "New Channel"; start blank so Basics requires a name
            const dt = defaultDataType(dataTypeList());
            applyDataTypes(c, dt, dt, version);
            return c;
        },
        fetch: (id) => api.channels.get(id),
        backPath: '/channels'
    });
    if (!ready || !model) return <div className="view"><div className="view-body"><div className="dt-empty">Loading channel…</div></div></div>;
    return <ChannelWizardInner key={model.id} channel={model} isNew={isNew} version={version} />;
}

function ChannelWizardInner({ channel, isNew, version }) {
    // When editing began — for the engine's modified-since-opened check on save.
    const startEditRef = useRef(new Date());
    const [, forceRender] = useReducer((x) => x + 1, 0);
    const switchingRef = useRef(false);   // true when switching to the classic editor (keep editingChannel)
    const typesRef = useRef(null);
    if (!typesRef.current) typesRef.current = dataTypeList();
    const types = typesRef.current;

    const dirtyRef = useRef(false);   // user changed something since the last save
    const savedRef = useRef(false);   // channel has been created/updated
    // Mark dirty for BOTH the wizard (dirtyRef → Save/footer) and the classic editor
    // (store editingChannelDirty), so a switchToClassic after wizard edits agrees.
    const bump = () => { dirtyRef.current = true; store.setState('editingChannelDirty', true); forceRender(); };

    const [inbound, setInbound] = useState(() => channel.sourceConnector.transformer.inboundDataType || defaultDataType(types));
    const [outbound, setOutbound] = useState(() => channel.sourceConnector.transformer.outboundDataType || defaultDataType(types));

    const { step, setStep, maxStep, goStep } = useWizardSteps(isNew, STEPS.length);
    const [selectedDest, setSelectedDest] = useState(0);
    const [nameTouched, setNameTouched] = useState(!isNew);   // don't flag a blank name until touched (existing channels already have one)
    const [existingNames, setExistingNames] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const libStateRef = useRef(null);            // code-template library selections (persisted after Create)
    const depStateRef = useRef(null);            // deploy/start channel dependencies (persisted after Create)

    // Keep the model in the store (the embedded editors read it) + prompt-on-leave.
    // The channel also mirrors a `editingChannelDirty` flag the classic editor reads.
    useLeaveGuard({
        model: channel, isNew, storeKey: 'editingChannel', storeNewKey: 'editingChannelNew',
        dirtyKey: 'editingChannelDirty', entityLabel: 'channel',
        dirtyRef, savedRef, switchingRef, save: () => saveChannel(false)
    });

    // Clear connector validation highlights whenever the step changes.
    useEffect(() => { clearHighlights(); }, [step]);

    useEffect(() => {
        let alive = true;
        api.channels.idsAndNames().then((res) => {
            if (!alive) return;
            const names = [];
            for (const en of api.asList(res && res.entry)) {
                const pair = api.asList(en && en.string);
                // Exclude this channel's own name (relevant when editing an existing one).
                if (pair.length >= 2 && String(pair[0]) !== channel.id) names.push(String(pair[1]).toLowerCase());
            }
            setExistingNames(names);
        }).catch(() => { if (alive) setExistingNames([]); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Connector validation, mirroring the classic editor's "Validate Connector":
    // def.validate(properties) returns [{ key, label }]; we surface the labels and
    // red-highlight the matching fields (data-fkey) when the panel is on screen.
    function connectorErrors(connector, mode) {
        const def = platform.connectorPanel(connector.transportName, mode);
        if (!def || typeof def.validate !== 'function') return [];
        try { return def.validate(connector.properties) || []; } catch { return []; }
    }
    function connectorProblems(connector, mode, label) {
        return connectorErrors(connector, mode).map((e) => `${label}: ${e.label} is required`);
    }
    const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
    function clearHighlights() {
        document.querySelectorAll('.cform-invalid').forEach((el) => el.classList.remove('cform-invalid'));
    }
    function highlightConnector(connector, mode) {
        for (const err of connectorErrors(connector, mode)) {
            for (const el of document.querySelectorAll(`[data-fkey="${cssEsc(err.key)}"]`)) el.classList.add('cform-invalid');
        }
    }
    function stepProblems(i) {
        const name = STEPS[i];
        if (name === 'Basics') return nameError() ? [nameError()] : [];
        if (name === 'Source') return connectorProblems(channel.sourceConnector, 'SOURCE', 'Source');
        if (name === 'Destinations') return oie.destinationsOf(channel).flatMap((d) => connectorProblems(d, 'DESTINATION', d.name || 'Destination'));
        return [];
    }
    // First step (by index) with a problem — used to jump the user there on Create.
    function firstProblemStep() {
        for (let i = 0; i < STEPS.length; i++) if (stepProblems(i).length) return i;
        return -1;
    }
    function allProblems() {
        return STEPS.flatMap((_, i) => stepProblems(i));
    }

    // Advance, validating the current step first (highlight + toast, matching classic).
    function tryNext() {
        const probs = stepProblems(step);
        if (probs.length) {
            clearHighlights();
            if (STEPS[step] === 'Source') highlightConnector(channel.sourceConnector, 'SOURCE');
            else if (STEPS[step] === 'Destinations') { const d = oie.destinationsOf(channel)[selectedDest]; if (d) highlightConnector(d, 'DESTINATION'); }
            toast(probs.slice(0, 4).join('  ·  '), 'warn');
            return;
        }
        clearHighlights();
        goStep(step + 1);
    }

    /* ---- data-type + destination actions ---- */
    // Match Swing's Set Data Types: changing the source inbound touches only the
    // source; changing the source outbound also cascades to each destination's
    // INBOUND (data entering the destination), leaving destination outbound alone.
    const changeInbound = (v) => { setInbound(v); setTransformerInbound(channel.sourceConnector.transformer, v, version); bump(); };
    const changeOutbound = (v) => {
        setOutbound(v);
        setTransformerOutbound(channel.sourceConnector.transformer, v, version);
        for (const d of oie.destinationsOf(channel)) setTransformerInbound(d.transformer, v, version);
        bump();
    };

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

    /* ---- navigation + create / finish ---- */
    function switchToClassic() {
        switchingRef.current = true;
        store.setState('editingChannel', channel);
        store.setState('editingChannelNew', isNew);
        store.setState('navGuard', null);
        router.navigate(`/channels/${channel.id}/edit${isNew ? '?new=1' : ''}`);
    }

    // Validate the whole channel, then create/update it and persist library +
    // dependency choices. No navigation — callers decide where to go. Returns true
    // on success. On a validation problem it jumps to the offending step.
    async function saveChannel(deploy) {
        const probs = allProblems();
        if (probs.length) {
            const s = firstProblemStep();
            if (s >= 0) { setStep(s); clearHighlights(); }
            toast(probs.slice(0, 4).join('  ·  '), 'warn');
            return false;
        }
        try {
            if (isNew) {
                await api.channels.create(channel);
            } else {
                const ok = await api.channels.update(channel.id, channel, false, startEditRef.current);
                if (String(ok) === 'false') {
                    const overwrite = await confirmDialog('Channel Modified',
                        'This channel has been modified since you first opened it. Are you sure you want to overwrite it?',
                        { danger: true, okLabel: 'Overwrite' });
                    if (!overwrite) return false;
                    await api.channels.update(channel.id, channel, true);
                }
                startEditRef.current = new Date();
            }
            // Library associations live on the libraries, not the channel — persist them
            // after the channel exists. A failure here shouldn't lose the created channel.
            try { await persistLibraryAssociations(channel, libStateRef, version); }
            catch (e) { toast(`Channel saved, but updating code-template libraries failed: ${e.message}`, 'warn'); }
            try { await persistChannelDependencies(depStateRef); }
            catch (e) { toast(`Channel saved, but updating dependencies failed: ${e.message}`, 'warn'); }
            if (deploy) await api.engine.deploy(channel.id);
            savedRef.current = true;
            dirtyRef.current = false;
            return true;
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not save the channel.', 'error');
            return false;
        }
    }

    const busy = saving || deploying;
    async function finish(deploy) {
        if (busy) return;
        if (deploy) setDeploying(true); else setSaving(true);
        const ok = await saveChannel(deploy);
        if (!ok) { setSaving(false); setDeploying(false); return; }
        store.setState('navGuard', null);   // don't prompt on our own navigation
        const verb = isNew ? 'created' : 'saved';
        toast(deploy ? `${isNew ? 'Created' : 'Saved'} and deploying “${channel.name}”.` : `Channel “${channel.name}” ${verb}.`, 'info');
        router.navigate(deploy ? '/dashboard' : '/channels');
    }

    // Existing channel with no unsaved edits: deploy the saved version directly,
    // skipping the redundant PUT that "Save & Deploy" would do.
    async function deployOnly() {
        if (busy) return;
        setDeploying(true);
        try {
            await api.engine.deploy(channel.id);
            store.setState('navGuard', null);
            toast(`Deploying “${channel.name}”.`, 'info');
            router.navigate('/dashboard');
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not deploy the channel.', 'error');
            setDeploying(false);
        }
    }

    const isLast = step === STEPS.length - 1;
    // Only surface the inline name error once the field has been touched (the Next
    // button is still disabled while the name is empty, so the flow stays gated).
    const nErr = step === 0 && nameTouched ? nameError() : null;
    const stepName = STEPS[step];

    return (
        <div className="view">
            {/* Channel Tasks rail — contextual. A NEW channel is still being built
                (create/deploy live in the footer), so it only offers the view switch
                and an exit. An EXISTING channel adds Save (when dirty) and Deploy, so
                they're reachable from any step. */}
            <ViewTasks>
                <RailPane title="Channel Tasks" paneKey="tasks:Channel Tasks" group="channelEdit">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        {getPref('showViewSwitch') !== false && <TaskButton label="Classic editor" icon="edit" onClick={switchToClassic} />}
                        {!isNew && dirtyRef.current && <TaskButton label="Save Changes" icon="save" primary task="doSaveChannel" onClick={() => finish(false)} />}
                        {!isNew && <TaskButton label={dirtyRef.current ? 'Save & Deploy' : 'Deploy'} icon="deploy" task="doDeployFromChannelView" onClick={() => (dirtyRef.current ? finish(true) : deployOnly())} />}
                        <TaskButton label="Back to Channels" icon="channels" onClick={() => router.navigate('/channels')} />
                    </div>
                </RailPane>
            </ViewTasks>
            <WizardHeader icon="channels" title={isNew ? 'New Channel — Wizard' : `${channel.name || 'Channel'} — Wizard`} />
            <WizardStepper steps={STEPS} step={step} maxStep={maxStep} onStep={setStep} />

            <div className="view-body overflow-x-hidden">
                {/* keyed on step so the slide-in animation replays on each step change */}
                <div className="wiz-pane" key={step}>
                    {stepName === 'Basics' && (
                        <BasicsStep channel={channel} types={types} inbound={inbound} outbound={outbound}
                            onChange={bump} onNameChange={() => { setNameTouched(true); bump(); }}
                            onInbound={changeInbound} onOutbound={changeOutbound} nameError={nErr} />
                    )}
                    {stepName === 'Dependencies' && <DependenciesStep channel={channel} libState={libStateRef} depState={depStateRef} />}
                    {stepName === 'Channel Options' && <ChannelSettings channel={channel} version={version} />}
                    {stepName === 'Source' && (
                        <ConnectorTabs channel={channel} connector={channel.sourceConnector} mode="SOURCE" version={version} onChange={bump} />
                    )}
                    {stepName === 'Destinations' && (
                        <DestinationsStep channel={channel} version={version} selected={selectedDest}
                            onSelect={setSelectedDest} onAdd={addDestination} onRemove={removeDestination}
                            onRename={renameDestination} onChange={bump} />
                    )}
                    {stepName === 'Scripts' && <ChannelScripts channel={channel} />}
                    {stepName === 'Review' && <ReviewStep channel={channel} inbound={inbound} outbound={outbound} />}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                <button className="btn" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
                <div className="ml-auto flex items-center gap-2">
                    {!isLast ? (
                        <button className="btn btn-primary" disabled={stepName === 'Basics' && !!nameError()} onClick={tryNext}>Next</button>
                    ) : (
                        <>
                            {isNew || dirtyRef.current ? (
                                <button className="btn" disabled={busy || !!nameError()} onClick={() => finish(false)}>
                                    <Icon name="save" size={14} />{saving ? (isNew ? 'Creating…' : 'Saving…') : (isNew ? 'Create Channel' : 'Save Changes')}
                                </button>
                            ) : (
                                <button className="btn" disabled={busy} onClick={() => router.navigate('/channels')}>
                                    <Icon name="x" size={14} />Exit
                                </button>
                            )}
                            {isNew || dirtyRef.current ? (
                                <button className="btn btn-primary" disabled={busy || !!nameError()} onClick={() => finish(true)}>
                                    <Icon name="deploy" size={14} />{deploying ? 'Deploying…' : (isNew ? 'Create & Deploy' : 'Save & Deploy')}
                                </button>
                            ) : (
                                <button className="btn btn-primary" disabled={busy} onClick={deployOnly}>
                                    <Icon name="deploy" size={14} />{deploying ? 'Deploying…' : 'Deploy'}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export function register(platform) {
    platform.registerView('/channels/new/guided', reactView(ChannelWizardView), { title: 'New Channel — Wizard' });
    platform.registerView('/channels/:channelId/guided', reactView(ChannelWizardView), { title: 'Channel — Wizard' });
}

export { ChannelWizardView };
