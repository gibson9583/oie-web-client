import { wizardStepLabel, connectorTabLabel } from '../../core/labels.js';
import { t as translate, tx as richText, compareText } from "../../core/i18n.js";
import { channelEditState, loadChannelForEdit } from '../../core/channel-save.js';
import { persistChannelModel, confirmLibraryOverwrite, channelSessionActive } from '../channel-persistence.js';
import { withEditorSave } from '../save-lock.js';
import { channelDependencyState, persistLibraryAssociations, persistChannelDependencies } from '../../core/channel-dependencies.js';
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
import { toast, confirmDialog, errorModal } from '@oie/web-ui';
import { platform } from '@oie/web-shell';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { getPref } from '../../core/prefs.js';
import { PluginSlot } from '../plugin-slot.jsx';
import { mountReact, ViewTasks } from '../mount.jsx';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { RailPane, TaskButton, useSideCollapse, CollapsedSideStrip, SideCollapseButton } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { useWizardModel, useWizardSteps, useLeaveGuard, WizardStepper, WizardHeader } from './wizard-frame.jsx';
import { createEmbeddedEditor } from './filter-transformer.jsx';
import {
    ConnectorPropertiesPanels, QueueSettings, ChannelScripts, ChannelSettings, DataTypeBar,
    DependenciesStep
} from './channel-wizard-editors.jsx';
// Straight from core/mappings.js, not via channel-editor.jsx's re-export of it —
// the wizard has no other reason to reference the classic editor, and that lone
// import is what would otherwise chain the two into one bundle chunk.
import { DESTINATION_MAPPINGS } from '../../core/mappings.js';

const STEPS = ['Basics', 'Dependencies', 'Channel Options', 'Source', 'Destinations', 'Scripts', 'Review'];

/* ---- small model helpers ------------------------------------------------------ */

function connectorIcon(name: any) {
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

/** Steps/rules configured on a connector sub-editor (classic editor parity:
    the task rail's "Edit Filter (2)" labels use the same count). */
function stepCount(connector: any, key: any) {
    const el = connector && connector[key];
    return el ? oie.elementsToArray(el.elements).length : 0;
}
const withCount = (label: any, n: any) => (n > 0 ? `${label} (${n})` : label);

// Tab label → the connector field its count comes from.
const STEP_KEYS: any = { Filter: 'filter', Transformer: 'transformer', Response: 'responseTransformer' };

/* A compact rule/step count on a destination card; zero renders nothing —
   a bare card IS the "no logic here" signal. */
function CountBadge({ icon, n, what }: any) {
    if (!n) return null;
    const title = what === 'filter rule' ? translate('{count, plural, one {# filter rule} other {# filter rules}}', { count: n })
        : what === 'transformer step' ? translate('{count, plural, one {# transformer step} other {# transformer steps}}', { count: n })
            : translate('{count, plural, one {# response transformer step} other {# response transformer steps}}', { count: n });
    return (
        <span className="dest-badge" title={title}>
            <Icon name={icon} size={9} />{n}
        </span>
    );
}

/** Registered connector transport names for a mode (excludes the '*' fallback). */
function transportsFor(mode: any) {
    const names: any[] = [];
    for (const key of platform.connectorPanels().keys()) {
        const i = key.indexOf(':');
        if (key.slice(0, i) === mode) {
            const name = key.slice(i + 1);
            if (name !== '*') names.push(name);
        }
    }
    return names.sort((a: any, b: any) => compareText(a, b));
}

function dtDefaults(name: any, version: any) {
    const d = dataTypeDef(name);
    return d && typeof d.defaults === 'function' ? d.defaults(version) : { '@version': version };
}
function setTransformerInbound(tx: any, name: any, version: any) { tx.inboundDataType = name; tx.inboundProperties = dtDefaults(name, version); }
function setTransformerOutbound(tx: any, name: any, version: any) { tx.outboundDataType = name; tx.outboundProperties = dtDefaults(name, version); }
function setTransformerTypes(tx: any, inName: any, outName: any, version: any) {
    setTransformerInbound(tx, inName, version);
    setTransformerOutbound(tx, outName, version);
}
/** Seed a brand-new channel's data types uniformly: source and every destination
 *  get the chosen inbound/outbound. Editing an existing channel uses the precise,
 *  Swing-faithful handlers (changeInbound/changeOutbound) instead, which never
 *  overwrite a destination's own outbound data type. */
function applyDataTypes(channel: any, inbound: any, outbound: any, version: any) {
    setTransformerTypes(channel.sourceConnector.transformer, inbound, outbound, version);
    for (const d of oie.destinationsOf(channel)) setTransformerTypes(d.transformer, outbound, outbound, version);
}
function defaultDataType(types: any) {
    if (types.some((t: any) => t.name === 'HL7V2')) return 'HL7V2';
    const hl7 = types.find((t: any) => /hl7/i.test(t.name) || /hl7/i.test(t.label));
    return hl7 ? hl7.name : (types[0] ? types[0].name : 'RAW');
}

function applyTransport(connector: any, mode: any, name: any, version: any, onChange: any) {
    if (name === connector.transportName) return;
    const def = platform.connectorPanel(name, mode);
    if (!def || typeof def.defaults !== 'function') { toast(translate("\"{value1}\" has no web configuration panel.", { value1: String(name) }), 'warn'); return; }
    connector.transportName = name;
    connector.properties = def.defaults(version);
    onChange();
}

/* ---- connector panel island --------------------------------------------------- */

// Mount the real connector panel (all fields) as an imperative React island so it
// keeps its own state across wizard re-renders. Remounts when the transport changes.
function ConnectorPanelMount({ channel, connector, mode, onChange }: any) {
    const hostRef = useRef<any>(null);
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

function TransportPicker({ mode, current, onPick }: any) {
    const names = transportsFor(mode);
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {names.map((name: any) => {
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
function EmbeddedElementEditor({ channel, metaDataId, kind, onChange, viewportOffset = 340 }: any) {
    const hostRef = useRef<any>(null);
    const [ctx, setCtx] = useState<any>(null);
    const [, forceBar] = useReducer((x: any) => x + 1, 0);
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
        const editor = createEmbeddedEditor({ channelId: channel.id, metaDataId }, kind,
            () => { forceBar(); if (onChangeRef.current) onChangeRef.current(); });
        host.appendChild(editor.el);
        if (editor.onAccessorDragOver) host.addEventListener('dragover', editor.onAccessorDragOver);
        if (editor.onAccessorDrop) host.addEventListener('drop', editor.onAccessorDrop);
        store.setState('navGuard', wizardGuard);
        setCtx(editor);
        return () => {
            if (editor.onAccessorDragOver) host.removeEventListener('dragover', editor.onAccessorDragOver);
            if (editor.onAccessorDrop) host.removeEventListener('drop', editor.onAccessorDrop);
            setCtx(null);
            try { editor.teardown && editor.teardown(); } catch { /* ignore */ }
            host.replaceChildren();
            store.setState('navGuard', wizardGuard);
        };
    }, [channel, metaDataId, kind]);

    const t = ctx && ctx.handlers;
    const ts = (ctx && ctx.taskState && ctx.taskState()) || { onStep: false, assign: false, remove: false };
    const noun = kind === 'filter' ? translate('Rule') : translate('Step');
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
                {t && <button type="button" className="btn btn-sm" onClick={t.addElement}>{richText("{value1}Add {value2}", { value1: <Icon name="plus" size={13} />, value2: noun })}</button>}
                {t && ts.onStep && <button type="button" className="btn btn-sm btn-danger" onClick={t.deleteElement}>{richText("{value1}Delete", { value1: <Icon name="trash" size={13} /> })}</button>}
                {t && ts.assign && <button type="button" className="btn btn-sm" onClick={t.assignToIterator}>{richText("{value1}Assign to Iterator", { value1: <Icon name="plus" size={13} /> })}</button>}
                {t && ts.remove && <button type="button" className="btn btn-sm" onClick={t.removeFromIterator}>{richText("{value1}Remove from Iterator", { value1: <Icon name="minus" size={13} /> })}</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.importElements}>{richText("{value1}Import", { value1: <Icon name="import" size={13} /> })}</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.exportElements}>{richText("{value1}Export", { value1: <Icon name="export" size={13} /> })}</button>}
                {t && <button type="button" className="btn btn-sm" onClick={t.validateElements}>{richText("{value1}Validate", { value1: <Icon name="check" size={13} /> })}</button>}
            </div>
            {/* Grow with the window instead of a fixed 576px box — the wizard's
                steps otherwise leave the space under the editor dead. The offset
                approximates the chrome above/below (header, stepper, tabs,
                toolbar, footer); when the window is too short for that, the 576px
                floor keeps the grid usable and the step body scrolls as before. */}
            <div ref={hostRef} className="flex flex-col border border-line rounded-md overflow-hidden"
                style={{ height: `max(576px, calc(100dvh - ${viewportOffset}px))` }} />
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

function monacoInstanceAt(node: any) {
    const me = (window as any).monaco && (window as any).monaco.editor;
    const editors = me && me.getEditors ? me.getEditors() : [];
    return editors.find((ed: any) => { const n = ed.getDomNode && ed.getDomNode(); return n && n.contains(node); }) || null;
}

function insertableAt(node: any) {
    if (!node || !node.closest) return null;
    if (node.closest('.ce-monaco')) {
        const inst = monacoInstanceAt(node);
        if (inst) return { monaco: inst };
    }
    const el = node.closest('textarea, input[type=text]');
    if (el && !el.readOnly && !el.disabled) return { el };
    return null;
}

function insertIntoTarget(target: any, token: any, position?: any) {
    if (target.monaco) {
        const inst = target.monaco;
        const pos = position || inst.getPosition();
        const Range = (window as any).monaco.Range;
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

function DestinationMappingsRail({ hostRef }: any) {
    const targetRef = useRef<any>(null);   // last focused insertable inside hostRef
    const dragTokenRef = useRef<any>(null);
    // Shares its collapse flag with the classic editor's rail (same rail). The
    // early return sits AFTER every hook so the hook order never changes.
    const [collapsed, setCollapsed] = useSideCollapse('dest-mappings');

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const trackFocus = (e: any) => {
            const found = e.target instanceof Element ? insertableAt(e.target) : null;
            if (found) targetRef.current = found;
        };
        const onDragOver = (e: any) => {
            const carrying = dragTokenRef.current
                || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(MAPPING_FLAVOR));
            if (!carrying) return;
            if (insertableAt(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        };
        const onDrop = (e: any) => {
            const token = dragTokenRef.current
                || (e.dataTransfer && (e.dataTransfer.getData(MAPPING_FLAVOR) || e.dataTransfer.getData('text/plain')));
            dragTokenRef.current = null;
            const target = token ? insertableAt(e.target) : null;
            if (!target) return;
            e.preventDefault();
            let pos: any = null;
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

    const insert = (token: any) => {
        const target = targetRef.current;
        if (target && insertIntoTarget(target, token)) return;
        // No known target — fall back to the clipboard, like the classic editor.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(token).then(
                () => toast(translate("Copied {value1}", { value1: String(token) })),
                () => toast(translate("Focus a text field first"), 'warn'));
        } else {
            toast(translate("Focus a text field first"), 'warn');
        }
    };

    if (collapsed) {
        return <CollapsedSideStrip className="panel-strip wiz-mappings-strip" label={translate("Destination Mappings")}
            onExpand={() => setCollapsed(false)} />;
    }

    return (
        <div className="panel !mt-0 w-full lg:w-[216px] flex-none self-stretch">
            <div className="panel-header">{translate("Destination Mappings")}<div className="panel-tools">
                    <SideCollapseButton label={translate("Destination Mappings")} onCollapse={() => setCollapsed(true)} />
                </div>
            </div>
            <div className="panel-body flex flex-col gap-2">
                <div className="border border-line rounded overflow-auto max-h-[324px] min-h-[108px]">
                    {DESTINATION_MAPPINGS.map(([label, token]) => (
                        <div key={token} role="button" draggable title={token}
                            onDragStart={(e: any) => {
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
                <div className="hint">{translate("Click to insert into the focused field, or drag into a text field.")}</div>
            </div>
        </div>
    );
}

function ConnectorTabs({ channel, connector, mode, version, onChange, destIndex }: any) {
    const isDest = mode === 'DESTINATION';
    const TABS = isDest ? ['Settings', 'Filter', 'Transformer', 'Response'] : ['Settings', 'Filter', 'Transformer'];
    // Wizard chrome above/below the embedded editor (header, stepper, tab bar,
    // toolbar, footer); the Destinations step adds its name row above the tabs.
    const editorOffset = isDest ? 395 : 350;
    const [tab, setTab] = useState('Settings');
    const settingsHostRef = useRef<any>(null);   // focus/drop scope for the Destination Mappings rail
    return (
        <TabsPrimitive.Root value={tab} onValueChange={setTab} className="flex flex-col gap-4">
            {/* m-0 drops .tabs' built-in 7x13 margins so the pill left-aligns
                with the section content below (the Root's gap spaces the rows). */}
            <TabsPrimitive.List className="tabs overflow-x-auto m-0"
                aria-label={isDest ? translate("Destination sections") : translate("Source sections")}>
                {TABS.map((t: any) => (
                    <TabsPrimitive.Trigger key={t} value={t}
                        className={`tab whitespace-nowrap ${tab === t ? 'active' : ''}`}>
                        {/* "Filter (2)" at a glance; zero-count labels stay bare. An
                            edit in the embedded editor bumps the wizard, so the
                            counts track live. */}
                        {STEP_KEYS[t] ? withCount(connectorTabLabel(t), stepCount(connector, STEP_KEYS[t])) : connectorTabLabel(t)}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>

            {/* Each body is its own Content, so Radix's triggers point at a real panel
                rather than a dangling aria-controls. They mount on demand as before. */}
            <TabsPrimitive.Content value="Settings">{tab === 'Settings' && (
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="cform-section-title mb-2">{translate("Connector type")}</div>
                        <TransportPicker mode={mode} current={connector.transportName}
                            onPick={(name: any) => applyTransport(connector, mode, name, version, onChange)} />
                    </div>
                    {/* Inbound/outbound data types are settable right here (mirrored in the
                        Transformer tab's Message Templates — same model). */}
                    <DataTypeBar holder={connector.transformer} version={version} connectorType={mode} onChange={onChange} />
                    {/* "Wait for previous" applies to the 2nd destination onward (nothing
                        precedes the first). */}
                    {isDest && destIndex > 0 && (
                        <label className="flex items-center gap-2">{richText("{value1}Wait for previous destination", { value1: <input type="checkbox" checked={connector.waitForPrevious !== false}
                                onChange={(e: any) => { connector.waitForPrevious = e.target.checked; onChange(); }} /> })}</label>
                    )}
                    {/* Destination Settings (queue) sit above the connector panel, like the classic editor. */}
                    {isDest && <QueueSettings key={`q-${connector.metaDataId}-${connector.transportName}`} connector={connector} onChange={onChange} />}
                    {/* connector-properties (SSL/auth) panels render BEFORE the main panel, matching the classic editor */}
                    <ConnectorPropertiesPanels key={`pp-${connector.transportName}`} channel={channel} connector={connector} mode={mode} onChange={onChange} />
                    {/* Destinations get the classic Destination Mappings rail beside the
                        connector settings (styled like the alert wizard's Variables panel). */}
                    <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                        <div ref={settingsHostRef} className="panel !mt-0 flex-1 min-w-0">
                            <div className="panel-header">{translate("{value1} settings", { value1: connector.transportName })}</div>
                            <div className="panel-body">
                                <ConnectorPanelMount key={connector.transportName} channel={channel} connector={connector} mode={mode} onChange={onChange} />
                            </div>
                        </div>
                        {isDest && <DestinationMappingsRail hostRef={settingsHostRef} />}
                    </div>
                </div>
            )}</TabsPrimitive.Content>

            <TabsPrimitive.Content value="Filter">
                {tab === 'Filter' && <EmbeddedElementEditor key={`f-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="filter" onChange={onChange} viewportOffset={editorOffset} />}
            </TabsPrimitive.Content>

            <TabsPrimitive.Content value="Transformer">
                {tab === 'Transformer' && <EmbeddedElementEditor key={`t-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="transformer" onChange={onChange} viewportOffset={editorOffset} />}
            </TabsPrimitive.Content>

            {isDest && (
                <TabsPrimitive.Content value="Response">
                    {tab === 'Response' && <EmbeddedElementEditor key={`r-${connector.metaDataId}`} channel={channel} metaDataId={connector.metaDataId} kind="response" onChange={onChange} viewportOffset={editorOffset} />}
                </TabsPrimitive.Content>
            )}
        </TabsPrimitive.Root>
    );
}

/* ---- steps -------------------------------------------------------------------- */

function BasicsStep({ channel, types, inbound, outbound, onChange, onNameChange, onInbound, onOutbound, nameError }: any) {
    return (
        <div className="panel !mt-0 max-w-[648px]">
            <div className="panel-body flex flex-col gap-4">
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">{translate("Channel name")}</span>
                    <input autoFocus className={`w-full ${nameError ? 'cform-invalid' : ''}`} value={channel.name}
                        placeholder={translate("My Channel")} onChange={(e: any) => { channel.name = e.target.value; onNameChange(); }} />
                    {nameError ? <span className="text-err text-[10px]">{nameError}</span> : null}
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-text-dim">{translate("Description")}</span>
                    <textarea className="w-full" rows={3} value={channel.description || ''}
                        onChange={(e: any) => { channel.description = e.target.value; onChange(); }} />
                </label>
                <div className="flex flex-col sm:flex-row gap-4">
                    <label className="flex flex-col gap-1 flex-1">
                        <span className="text-text-dim">{translate("Inbound data type")}</span>
                        <select value={inbound} onChange={(e: any) => onInbound(e.target.value)}>
                            {types.map((t: any) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                        <span className="text-text-dim">{translate("Outbound data type")}</span>
                        <select value={outbound} onChange={(e: any) => onOutbound(e.target.value)}>
                            {types.map((t: any) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                </div>
                <div className="hint">{richText("These seed each connector''s data types. Per-connector inbound/outbound types & their properties live on each connector''s <e1>Transformer</e1> tab (Message Templates panel). Channel-level options are in the <e2>Dependencies</e2>, <e3>Channel Options</e3>, and <e4>Scripts</e4> steps.", { e1: (chunks: any) => <b>{chunks}</b>, e2: (chunks: any) => <b>{chunks}</b>, e3: (chunks: any) => <b>{chunks}</b>, e4: (chunks: any) => <b>{chunks}</b> })}</div>
            </div>
        </div>
    );
}

function DestinationsStep({ channel, version, selected, onSelect, onAdd, onRemove, onRename, onChange }: any) {
    const dests = oie.destinationsOf(channel);
    const sel = dests[selected] || dests[0];
    return (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
            {/* The rail rides along while the (long) connector editor scrolls;
                past ~a dozen destinations the list scrolls on its own instead of
                growing past the viewport. Both only make sense side-by-side, so
                they gate on the same lg breakpoint that stacks the layout. */}
            <div className="w-full lg:w-[216px] flex-none flex flex-col gap-2 lg:sticky lg:top-0">
                <div className="cform-section-title">{translate("Destinations")}</div>
                <div className="step-list panel overflow-auto p-1.5 min-h-[126px] lg:max-h-[calc(100dvh_-_290px)]">
                    {dests.map((d: any, i: any) => (
                        /* Two-line card (name / connector type), not the one cramped
                           row both used to truncate into. flex-col + items-stretch
                           override .step-item's row layout (utilities outrank
                           @layer components). */
                        <div key={d.metaDataId} className={`step-item flex-col items-stretch gap-1 min-w-0 ${i === selected ? 'selected' : ''}`}
                            onClick={() => onSelect(i)}
                            title={`${d.metaDataId}: ${d.name} — ${d.transportName}`}>
                            <div className="flex items-center gap-2 min-w-0">
                                <div className="flex-1 min-w-0 truncate font-semibold">{d.name}</div>
                                {/* The metadata id, as the classic editor's destination table
                                    shows it: it is what response/queue references and the
                                    Destination Mappings are written against, so it has to be
                                    readable here too. */}
                                <span className="step-id">{d.metaDataId}</span>
                            </div>
                            <div className="step-type flex items-center gap-1.5 min-w-0">
                                <Icon name={connectorIcon(d.transportName)} size={12} />
                                <span className="truncate">{d.transportName}</span>
                                <span className="ml-auto flex-none flex items-center gap-1">
                                    <CountBadge icon="filter" n={stepCount(d, 'filter')} what="filter rule" />
                                    <CountBadge icon="transform" n={stepCount(d, 'transformer')} what="transformer step" />
                                    <CountBadge icon="undo" n={stepCount(d, 'responseTransformer')} what="response transformer step" />
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex gap-2">
                    <button type="button" className="btn btn-sm" onClick={onAdd}>{richText("{value1}Add", { value1: <Icon name="plus" size={13} /> })}</button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => onRemove(selected)}>{richText("{value1}Remove", { value1: <Icon name="trash" size={13} /> })}</button>
                </div>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-4">
                {sel && (
                    <>
                        <label className="flex items-center gap-3">
                            <span className="w-[108px] text-text-dim">{translate("Destination name")}</span>
                            <input className="flex-1" value={sel.name} onChange={(e: any) => onRename(sel, e.target.value)} />
                        </label>
                        <ConnectorTabs key={sel.metaDataId} channel={channel} connector={sel} mode="DESTINATION" version={version} onChange={onChange} destIndex={selected} />
                    </>
                )}
            </div>
        </div>
    );
}

function ReviewLine({ label, value }: any) {
    return (
        <div className="flex gap-4 py-2 border-b border-line">
            <div className="w-[144px] flex-none text-text-dim">{label}</div>
            <div className="flex-1 min-w-0">{value}</div>
        </div>
    );
}

function dtSummary(connector: any, label: any) {
    const tx = connector.transformer || {};
    return `${label(tx.inboundDataType)} → ${label(tx.outboundDataType)}`;
}

function handlingSummary(connector: any) {
    const tx = oie.elementsToArray(connector.transformer && connector.transformer.elements);
    const fl = oie.elementsToArray(connector.filter && connector.filter.elements);
    const f = translate('{count, plural, =0 {Filter: accept all} one {Filter: # rule} other {Filter: # rules}}', {count: fl.length});
    const t = translate('{count, plural, =0 {Transform: passthrough} one {Transform: # step} other {Transform: # steps}}', {count: tx.length});
    return `${f} · ${t}`;
}

const STATE_LABELS = { STARTED: translate("Started"), PAUSED: translate("Paused"), STOPPED: translate("Stopped") };
const STORAGE_LABELS = { DEVELOPMENT: translate("Development"), PRODUCTION: translate("Production"), RAW: translate("Raw"), METADATA: translate("Metadata"), DISABLED: translate("Disabled") };
const SCRIPT_LABELS = { deployScript: translate("Deploy"), undeployScript: translate("Undeploy"), preprocessingScript: translate("Preprocessor"), postprocessingScript: translate("Postprocessor") };

function ReviewStep({ channel, inbound, outbound }: any) {
    const dests = oie.destinationsOf(channel);
    const label = (n: any) => (dataTypeList().find((t: any) => t.name === n) || {}).label || n;
    const p = channel.properties || {};
    const prune = (channel.exportData && channel.exportData.metadata && channel.exportData.metadata.pruningSettings) || {};
    const scripts = Object.keys(SCRIPT_LABELS).filter((k: any) => String(channel[k] || '').trim());
    const cols = ((p.metaDataColumns && (Array.isArray(p.metaDataColumns.metaDataColumn) ? p.metaDataColumns.metaDataColumn : (p.metaDataColumns.metaDataColumn ? [p.metaDataColumns.metaDataColumn] : []))) || []).filter((c: any) => c && c.name);
    const encFlags = [
        p.encryptData && translate("content"), p.encryptAttachments && translate("attachments"), p.encryptCustomMetaData && translate("metadata")
    ].filter(Boolean);
    const pruneText = (prune.pruneMetaDataDays == null && prune.pruneContentDays == null)
        ? translate("Stored indefinitely")
        : translate("Metadata {metadata} · Content {content}", { metadata: prune.pruneMetaDataDays == null ? translate("kept") : translate("{count, plural, one {# day} other {# days}}", { count: prune.pruneMetaDataDays }), content: prune.pruneContentDays == null ? translate("with metadata") : translate("{count, plural, one {# day} other {# days}}", { count: prune.pruneContentDays }) });
    const tags = api.asList(channel.exportData && channel.exportData.channelTags, 'channelTag').map((t: any) => t && t.name).filter(Boolean);
    const attType = channel.properties && channel.properties.attachmentProperties && channel.properties.attachmentProperties.type;
    return (
        <div className="panel !mt-0 max-w-[738px]">
            <div className="panel-body">
                <ReviewLine label={translate("Name")} value={channel.name || <span className="text-err">{translate("(required)")}</span>} />
                {channel.description ? <ReviewLine label={translate("Description")} value={channel.description} /> : null}
                <ReviewLine label={translate("Data types")} value={`${label(inbound)} → ${label(outbound)}`} />
                <ReviewLine label={translate("Initial state")} value={(STATE_LABELS as any)[p.initialState] || translate("Started")} />
                <ReviewLine label={translate("Message storage")} value={
                    <span>{(STORAGE_LABELS as any)[p.messageStorageMode] || translate("Development")}{encFlags.length ? <span className="hint">{translate(" · encrypting {value1}", { value1: encFlags.join(', ') })}</span> : null}</span>} />
                <ReviewLine label={translate("Pruning")} value={pruneText} />
                {attType && attType !== 'None' ? <ReviewLine label={translate("Attachments")} value={attType} /> : null}
                {tags.length ? <ReviewLine label={translate("Tags")} value={tags.join(', ')} /> : null}
                {cols.length ? <ReviewLine label={translate("Metadata columns")} value={cols.map((c: any) => c.name).join(', ')} /> : null}
                <ReviewLine label={translate("Scripts")} value={scripts.length ? scripts.map((k: any) => (SCRIPT_LABELS as any)[k]).join(', ') : translate("None")} />
                <ReviewLine label={translate("Source")} value={<div><div>{channel.sourceConnector.transportName}</div><div className="hint">{dtSummary(channel.sourceConnector, label)} · {handlingSummary(channel.sourceConnector)}</div></div>} />
                <ReviewLine label={translate("Destinations ({value1})", { value1: String(dests.length) })} value={
                    <div className="flex flex-col gap-2">
                        {dests.map((d: any) => <div key={d.metaDataId}><div>{d.name} — {d.transportName}</div><div className="hint">{dtSummary(d, label)} · {handlingSummary(d)}</div></div>)}
                    </div>} />
            </div>
        </div>
    );
}

/* ---- orchestrator ------------------------------------------------------------- */

// Loader: resolve the channel to edit (see wizard-frame's useWizardModel), then
// render the wizard. /channels/new/guided creates; /channels/:channelId/guided edits.
function ChannelWizardView({ params }: any) {
    const version = store.getState('serverVersion') || '4.5.2';
    const { model, isNew, ready } = useWizardModel({
        routeId: params && params.channelId,
        storeKey: 'editingChannel',
        isValid: (c: any) => !!c.sourceConnector,
        makeNew: () => {
            const c = oie.newChannel('', version);
            c.name = '';   // newChannel defaults to "New Channel"; start blank so Basics requires a name
            const dt = defaultDataType(dataTypeList());
            applyDataTypes(c, dt, dt, version);
            return c;
        },
        fetch: (id: any) => loadChannelForEdit(id),
        backPath: '/channels'
    });
    if (!ready || !model) return <div className="view"><div className="view-body"><div className="dt-empty">{translate("Loading channel…")}</div></div></div>;
    return <ChannelWizardInner key={model.id} channel={model} isNew={isNew} version={version} />;
}

function ChannelWizardInner({ channel, isNew, version }: any) {
    const editState = channelEditState(channel, isNew);
    isNew = editState.isNew;
    const [, forceRender] = useReducer((x: any) => x + 1, 0);
    const switchingRef = useRef(false);   // true when switching to the classic editor (keep editingChannel)
    const typesRef = useRef<any>(null);
    if (!typesRef.current) typesRef.current = dataTypeList();
    const types = typesRef.current;

    const dirtyRef = useRef(store.getState('editingChannelDirty') === true);
    const savedRef = useRef(false);   // channel has been created/updated
    // Mark dirty for BOTH the wizard (dirtyRef → Save/footer) and the classic editor
    // (store editingChannelDirty), so a switchToClassic after wizard edits agrees.
    const bump = () => { setStageFailure(null); savedRef.current = false; dirtyRef.current = true; store.setState('editingChannelDirty', true); forceRender(); };

    const [inbound, setInbound] = useState(() => channel.sourceConnector.transformer.inboundDataType || defaultDataType(types));
    const [outbound, setOutbound] = useState(() => channel.sourceConnector.transformer.outboundDataType || defaultDataType(types));

    const { step, setStep, maxStep, goStep } = useWizardSteps(isNew, STEPS.length);
    const [selectedDest, setSelectedDest] = useState(0);
    const [nameTouched, setNameTouched] = useState(!isNew);   // don't flag a blank name until touched (existing channels already have one)
    const [existingNames, setExistingNames] = useState<any>(null);
    const [saving, setSaving] = useState(false);
    const [deploying, setDeploying] = useState(false);
    const actionRef = useRef(false);
    const [stageFailure, setStageFailure] = useState<{ stage: string; message: string } | null>(null);
    const pendingDependencies = channelDependencyState(channel);
    const libStateRef = pendingDependencies.libraries;
    const depStateRef = pendingDependencies.dependencies;

    // Keep the model in the store (the embedded editors read it) + prompt-on-leave.
    // The channel also mirrors a `editingChannelDirty` flag the classic editor reads.
    useLeaveGuard({
        model: channel, isNew: () => editState.isNew, storeKey: 'editingChannel', storeNewKey: 'editingChannelNew',
        dirtyKey: 'editingChannelDirty', entityLabel: 'channel',
        dirtyRef, savedRef, switchingRef, save: () => saveChannel(false),
        canSave: () => platform.checkTask('channelEdit', 'doSaveChannel')
    });
    const canSave = platform.checkTask('channelEdit', 'doSaveChannel');
    const canDeploy = platform.checkTask('channelEdit', 'doDeployFromChannelView');

    // Clear connector validation highlights whenever the step changes.
    useEffect(() => { clearHighlights(); }, [step]);

    useEffect(() => {
        let alive = true;
        api.channels.idsAndNames().then((res: any) => {
            if (!alive) return;
            const names: any[] = [];
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
        if (!name) return translate("A channel name is required.");
        if (name.length > 40) return translate("Channel name cannot be longer than 40 characters.");
        if (!/^[A-Za-z0-9_\s-]*$/.test(name)) return translate("Only letters, numbers, spaces, hyphens and underscores are allowed.");
        if (existingNames && existingNames.includes(name.toLowerCase())) return translate("A channel named “{value1}” already exists.", { value1: String(name) });
        return null;
    }
    // Connector validation, mirroring the classic editor's "Validate Connector":
    // def.validate(properties) returns [{ key, label }]; we surface the labels and
    // red-highlight the matching fields (data-fkey) when the panel is on screen.
    function connectorErrors(connector: any, mode: any) {
        const def = platform.connectorPanel(connector.transportName, mode);
        if (!def || typeof def.validate !== 'function') return [];
        try { return def.validate(connector.properties) || []; } catch { return []; }
    }
    function connectorProblems(connector: any, mode: any, label: any) {
        return connectorErrors(connector, mode).map((e: any) => translate("{value1}: {value2} is required", { value1: String(label), value2: String(e.label) }));
    }
    const cssEsc = (s: any) => (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&');
    function clearHighlights() {
        document.querySelectorAll('.cform-invalid').forEach((el: any) => el.classList.remove('cform-invalid'));
    }
    function highlightConnector(connector: any, mode: any) {
        for (const err of connectorErrors(connector, mode)) {
            for (const el of document.querySelectorAll(`[data-fkey="${cssEsc(err.key)}"]`)) el.classList.add('cform-invalid');
        }
    }
    function stepProblems(i: any) {
        const name = STEPS[i];
        if (name === 'Basics') return nameError() ? [nameError()] : [];
        if (name === 'Source') return connectorProblems(channel.sourceConnector, 'SOURCE', 'Source');
        if (name === 'Destinations') return oie.destinationsOf(channel).flatMap((d: any) => connectorProblems(d, 'DESTINATION', d.name || 'Destination'));
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
    const changeInbound = (v: any) => { setInbound(v); setTransformerInbound(channel.sourceConnector.transformer, v, version); bump(); };
    const changeOutbound = (v: any) => {
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
    const removeDestination = (i: any) => {
        const dests = oie.destinationsOf(channel);
        if (dests.length <= 1) { toast(translate("A channel needs at least one destination."), 'warn'); return; }
        oie.setDestinations(channel, dests.filter((_, idx) => idx !== i));
        setSelectedDest(Math.max(0, i - 1));
        bump();
    };
    const renameDestination = (dest: any, name: any) => { dest.name = name; bump(); };

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
    function saveChannel(deploy: any) { return withEditorSave(() => saveChannelUnlocked(deploy)); }

    async function saveChannelUnlocked(deploy: any) {
        const isCurrent = channelSessionActive();
        if (!isCurrent()) return false;
        const probs = allProblems();
        if (probs.length) {
            const s = firstProblemStep();
            if (s >= 0) { setStep(s); clearHighlights(); }
            toast(probs.slice(0, 4).join('  ·  '), 'warn');
            return false;
        }
        let stage = 'channel';
        setStageFailure(null);
        try {
            const saved = await persistChannelModel(channel);
            if (!isCurrent() || !saved) return false;
            stage = translate("code template libraries");
            const librariesSaved = await persistLibraryAssociations(channel, libStateRef, version, confirmLibraryOverwrite);
            if (!isCurrent() || !librariesSaved) return false;
            stage = translate("deploy/start dependencies");
            await persistChannelDependencies(depStateRef);
            if (!isCurrent()) return false;
            // Only all persisted stages make the edit session clean. Deployment
            // remains a separate operation and must never erase a pending stage.
            savedRef.current = true;
            dirtyRef.current = false;
            store.setState('editingChannelDirty', false);
            if (deploy) {
                stage = 'deployment';
                await api.engine.deploy(channel.id);
                if (!isCurrent()) return false;
            }
            return true;
        } catch (e: any) {
            if (!isCurrent()) return false;
            const detail = e?.message || translate("The engine did not confirm this operation.");
            const message = stage === 'deployment' ? translate("Channel saved. Deployment failed: {value1}", { value1: String(detail) })
                : stage === 'channel' ? translate("Channel save failed: {value1}", { value1: String(detail) })
                    : translate("Channel saved; {value1} are still pending: {value2}", { value1: String(stage), value2: String(detail) });
            setStageFailure({ stage, message });
            if (stage === 'deployment') errorModal(translate("Channel Deployment Failed"), e, channel.name);
            else toast(message, 'error');
            return false;
        } finally {
            // A successful create may be followed by a failed related write.
            // Render the new existing-channel state immediately for recovery.
            if (isCurrent()) forceRender();
        }
    }

    const busy = saving || deploying;
    const deployLabel = stageFailure?.stage === 'deployment' ? translate("Retry Deploy") : translate("Deploy");
    async function finish(deploy: any) {
        const isCurrent = channelSessionActive();
        if (!isCurrent()) return;
        if (actionRef.current || store.getState('editorSave')) return;
        actionRef.current = true;
        const wasNew = editState.isNew;
        if (deploy) setDeploying(true); else setSaving(true);
        try {
            const saved = await saveChannel(deploy);
            if (!isCurrent() || !saved) return;
            store.setState('navGuard', null);
            const verb = wasNew ? 'created' : 'saved';
            toast(deploy ? translate("Channel “{value1}” saved; deployment requested.", { value1: String(channel.name) }) : translate("Channel “{value1}” {value2}.", { value1: String(channel.name), value2: String(verb) }), 'info');
            router.navigate(deploy ? '/dashboard' : '/channels');
        } finally {
            actionRef.current = false;
            if (isCurrent()) { setSaving(false); setDeploying(false); }
        }
    }

    // Retrying a failed deployment must not repeat accepted persistence stages.
    async function deployOnly() {
        const isCurrent = channelSessionActive();
        if (!isCurrent()) return;
        if (actionRef.current || store.getState('editorSave')) return;
        actionRef.current = true;
        setDeploying(true);
        try {
            const ok = await withEditorSave(async () => {
                await api.engine.deploy(channel.id);
                return isCurrent();
            }, translate("Deploying channel…"));
            if (!isCurrent() || !ok) return;
            setStageFailure(null);
            store.setState('navGuard', null);
            toast(translate("Deployment requested for “{value1}”.", { value1: String(channel.name) }), 'info');
            router.navigate('/dashboard');
        } catch (e: any) {
            if (!isCurrent()) return;
            setStageFailure({ stage: 'deployment', message: translate("Deployment failed: {value1}", { value1: String(e?.message || e) }) });
            errorModal(translate("Channel Deployment Failed"), e, channel.name);
        } finally {
            actionRef.current = false;
            if (isCurrent()) setDeploying(false);
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
                <RailPane title={translate("Channel Tasks")} paneKey="tasks:Channel Tasks" group="channelEdit">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        {getPref('showViewSwitch') !== false && <TaskButton label={translate("Classic editor")} icon="edit" onClick={switchToClassic} />}
                        {!isNew && dirtyRef.current && <TaskButton label={translate("Save Changes")} icon="save" primary task="doSaveChannel" onClick={() => finish(false)} />}
                        {!isNew && <TaskButton label={dirtyRef.current ? translate("Save & Deploy") : deployLabel} icon="deploy" task="doDeployFromChannelView" onClick={() => (dirtyRef.current ? finish(true) : deployOnly())} />}
                        <TaskButton label={translate("Back to Channels")} icon="channels" onClick={() => router.navigate('/channels')} />
                    </div>
                </RailPane>
            </ViewTasks>
            <WizardHeader icon="channels" title={isNew ? translate("New Channel — Wizard") : translate("{value1} — Wizard", { value1: String(channel.name || translate("Channel")) })} />
            {stageFailure && <div role="status" className="px-4 py-3 border-b border-line text-warning">{stageFailure.message}</div>}
            <WizardStepper steps={STEPS.map(wizardStepLabel)} step={step} maxStep={maxStep} onStep={setStep} />

            <div className="view-body overflow-x-hidden">
                {/* keyed on step so the slide-in animation replays on each step change */}
                <div className="wiz-pane" key={step}>
                    {stepName === 'Basics' && (
                        <BasicsStep channel={channel} types={types} inbound={inbound} outbound={outbound}
                            onChange={bump} onNameChange={() => { setNameTouched(true); bump(); }}
                            onInbound={changeInbound} onOutbound={changeOutbound} nameError={nErr} />
                    )}
                    {stepName === 'Dependencies' && <DependenciesStep channel={channel} libState={libStateRef} depState={depStateRef} onChange={bump} />}
                    {stepName === 'Channel Options' && <ChannelSettings channel={channel} version={version} onChange={bump} />}
                    {stepName === 'Source' && (
                        <ConnectorTabs channel={channel} connector={channel.sourceConnector} mode="SOURCE" version={version} onChange={bump} />
                    )}
                    {stepName === 'Destinations' && (
                        <DestinationsStep channel={channel} version={version} selected={selectedDest}
                            onSelect={setSelectedDest} onAdd={addDestination} onRemove={removeDestination}
                            onRename={renameDestination} onChange={bump} />
                    )}
                    {stepName === 'Scripts' && <ChannelScripts channel={channel} onChange={bump} />}
                    {stepName === 'Review' && <ReviewStep channel={channel} inbound={inbound} outbound={outbound} />}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                <button className="btn" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>{translate("Back")}</button>
                <div className="ml-auto flex items-center gap-2">
                    {!isLast ? (
                        <button className="btn btn-primary" disabled={stepName === 'Basics' && !!nameError()} onClick={tryNext}>{translate("Next")}</button>
                    ) : (
                        <>
                            {/* RBAC: save/deploy affordances hide without the matching
                                channelEdit task (same gating as the classic editor). */}
                            {(isNew || dirtyRef.current) && canSave ? (
                                <button className="btn" disabled={busy || !!nameError()} onClick={() => finish(false)}>
                                    <Icon name="save" size={14} />{saving ? (isNew ? translate("Creating…") : translate("Saving…")) : (isNew ? translate("Create Channel") : translate("Save Changes"))}
                                </button>
                            ) : (
                                <button className="btn" disabled={busy} onClick={() => router.navigate('/channels')}>{richText("{value1}Exit", { value1: <Icon name="x" size={14} /> })}</button>
                            )}
                            {isNew || dirtyRef.current ? (
                                canSave && canDeploy && <button className="btn btn-primary" disabled={busy || !!nameError()} onClick={() => finish(true)}>
                                    <Icon name="deploy" size={14} />{deploying ? translate("Deploying…") : (isNew ? translate("Create & Deploy") : translate("Save & Deploy"))}
                                </button>
                            ) : (
                                canDeploy && <button className="btn btn-primary" disabled={busy} onClick={deployOnly}>
                                    <Icon name="deploy" size={14} />{deploying ? translate("Deploying…") : deployLabel}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}


export { ChannelWizardView };
