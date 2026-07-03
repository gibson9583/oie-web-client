/*
 * Channel-level sub-editors for the guided wizard — kept out of channel-wizard.jsx so
 * the orchestrator stays readable. (The Filter/Transformer/Response editing is the
 * REAL editor embedded from filter-transformer.jsx — see channel-wizard.jsx.)
 *
 *   - ConnectorPropertiesPanels: the plugin SSL/auth panels the classic connector
 *     tab injects (pluginProperties[fqcn]).
 *   - QueueSettings: a destination's advanced queue/threading settings.
 *   - ChannelScripts: the four channel scripts (deploy/undeploy/pre/post) via Monaco.
 *   - ChannelSettings: the Summary-tab channel options (initial state, message
 *     storage + encryption, custom metadata columns, pruning, …).
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { PluginSlot } from '../plugin-slot.jsx';
import { mountReact } from '../mount.jsx';
import { CodeEditor } from '../ui.jsx';
import { Icon } from '../bridges.jsx';
import { setActiveScope, clearActiveScope } from '../../core/script-completions.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';

/* ---- per-connector data types (inbound/outbound + properties) ------------------ */

function dtDefaults(name, version) {
    const d = dataTypeDef(name);
    return d && typeof d.defaults === 'function' ? d.defaults(version) : { '@version': version };
}

// Inbound/outbound data type selectors + collapsible properties for one connector's
// transformer — so the types are settable right on the connector's Settings tab (not
// buried in the transformer's Message Templates). `holder` is the transformer object.
export function DataTypeBar({ holder, version, connectorType, onChange }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const [open, setOpen] = useState(false);
    const types = dataTypeList();
    const changed = () => { tick(); if (onChange) onChange(); };
    const setType = (dir, name) => { holder[`${dir}DataType`] = name; holder[`${dir}Properties`] = dtDefaults(name, version); changed(); };
    return (
        <div className="panel !mt-0">
            <div className="panel-header flex items-center gap-3">
                <span>Data Types</span>
                <button type="button" className="btn btn-sm btn-ghost ml-auto" onClick={() => setOpen(!open)}>
                    <Icon name={open ? 'chevD' : 'chevR'} size={13} />{open ? 'Hide' : 'Edit'} properties
                </button>
            </div>
            <div className="panel-body flex flex-col gap-3">
                <div className="flex flex-wrap gap-4">
                    <label className="flex flex-col gap-1">
                        <span className="text-text-dim text-[12px]">Inbound</span>
                        <select value={holder.inboundDataType} onChange={(e) => setType('inbound', e.target.value)}>
                            {types.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-text-dim text-[12px]">Outbound</span>
                        <select value={holder.outboundDataType} onChange={(e) => setType('outbound', e.target.value)}>
                            {types.map((t) => <option key={t.name} value={t.name}>{t.label}</option>)}
                        </select>
                    </label>
                </div>
                {open && (
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-1 min-w-0">
                            <div className="cform-section-title mb-1">Inbound properties</div>
                            <DataTypePropertiesEditor typeName={holder.inboundDataType} props={holder.inboundProperties}
                                version={version} direction="inbound" connectorType={connectorType}
                                onChange={changed} onReplace={(p) => { holder.inboundProperties = p; changed(); }} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="cform-section-title mb-1">Outbound properties</div>
                            <DataTypePropertiesEditor typeName={holder.outboundDataType} props={holder.outboundProperties}
                                version={version} direction="outbound" connectorType={connectorType}
                                onChange={changed} onReplace={(p) => { holder.outboundProperties = p; changed(); }} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ---- dependencies: code-template libraries + library resources ---------------- */

const idSet = (v) => api.asList(v, 'string').map(String);

function entriesToObj(map) {
    const out = {};
    if (map && typeof map === 'object') {
        for (const e of api.asList(map.entry)) {
            const pair = api.asList(e && e.string);
            if (pair.length >= 2) out[String(pair[0])] = String(pair[1]);
        }
    }
    return out;
}
function objToEntries(obj) {
    const keys = Object.keys(obj);
    return keys.length
        ? { '@class': 'linked-hash-map', entry: keys.map((id) => ({ string: [id, obj[id]] })) }
        : { '@class': 'linked-hash-map' };
}
// Every resourceIds holder in a channel (channel scripts + source + destinations).
function resourceHolders(channel) {
    const holders = [];
    if (channel.properties) holders.push(channel.properties);
    const sp = channel.sourceConnector && channel.sourceConnector.properties && channel.sourceConnector.properties.sourceConnectorProperties;
    if (sp) holders.push(sp);
    for (const d of oie.destinationsOf(channel)) {
        const dp = d.properties && d.properties.destinationConnectorProperties;
        if (dp) holders.push(dp);
    }
    return holders;
}

// Whether a library is (initially) associated with this channel — matches the
// classic CodeTemplateLibrariesPanel: explicit membership, or include-new-channels
// unless explicitly excluded.
function libEnabledFor(lib, channelId) {
    return idSet(lib.enabledChannelIds).includes(channelId)
        || (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(channelId));
}

// Persist library associations chosen in the Dependencies step. The channel doesn't
// store these (the LIBRARIES do), so this runs AFTER the channel is created: mutate
// each changed library's enabled/disabled channel sets and PUT the full list. Returns
// silently if nothing changed. (Resources ride on the channel and need no extra call.)
export async function persistLibraryAssociations(channel, libState, version) {
    const st = libState && libState.current;
    if (!st) return;
    const changed = st.libraries.filter((lib) => st.checked.get(lib.id) !== st.initial.get(lib.id));
    if (!changed.length) return;
    for (const lib of changed) {
        const enabled = new Set(idSet(lib.enabledChannelIds));
        const disabled = new Set(idSet(lib.disabledChannelIds));
        if (st.checked.get(lib.id)) { enabled.add(channel.id); disabled.delete(channel.id); }
        else { enabled.delete(channel.id); disabled.add(channel.id); }
        lib.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
        lib.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
    }
    const payload = st.libraries.map((lib) => {
        const { '@version': _v, codeTemplates: _ct, ...rest } = lib;
        const ids = api.asList(lib.codeTemplates, 'codeTemplate').map((t) => t && t.id).filter(Boolean);
        return {
            '@version': lib['@version'] || version,
            ...rest,
            codeTemplates: ids.length ? { codeTemplate: ids.map((id) => ({ '@version': version, id })) } : null
        };
    });
    await api.codeTemplates.updateLibraries(payload);
}

// Persist deploy/start dependencies chosen in the Dependencies step (after Create).
// setChannelDependencies replaces the whole server list, so we send the full set.
export async function persistChannelDependencies(depState) {
    const d = depState && depState.current;
    if (!d || !d.changed) return;
    const curKey = d.all.map((x) => x.dependentId + '>' + x.dependencyId).sort().join('|');
    if (curKey === d.initial) return;
    await api.server.setChannelDependencies(d.all.map((x) => ({ dependentId: x.dependentId, dependencyId: x.dependencyId })));
}

// Filterable, scrollable multi-select modal — for picking from potentially large
// lists (channels, libraries, resources). Returns the chosen ids via onAdd.
function PickerModal({ title, items, onAdd, onClose }) {
    const [q, setQ] = useState('');
    const [sel, setSel] = useState(() => new Set());
    const needle = q.trim().toLowerCase();
    const filtered = needle ? items.filter((it) => it.name.toLowerCase().includes(needle)) : items;
    const toggle = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
    return (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal" style={{ width: '460px', maxWidth: '92vw' }}>
                <div className="modal-header">{title}<button type="button" className="icon-btn" onClick={onClose} title="Close">✕</button></div>
                <div className="modal-body flex flex-col gap-2">
                    <input type="text" autoFocus placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
                    <div className="border border-line rounded-md overflow-auto max-h-[320px]">
                        {filtered.length === 0 && <div className="p-2 text-text-faint text-[12px]">No matches.</div>}
                        {filtered.map((it) => (
                            <label key={it.id} className="flex items-center gap-2 py-1.5 px-2 hover:bg-bg1 cursor-pointer">
                                <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} />
                                <span className="truncate">{it.name}</span>
                            </label>
                        ))}
                    </div>
                </div>
                <div className="modal-foot">
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={sel.size === 0} onClick={() => { onAdd([...sel]); onClose(); }}>Add{sel.size ? ` (${sel.size})` : ''}</button>
                </div>
            </div>
        </div>
    );
}

// Dependencies step: associate code-template libraries and library resources with
// the channel. Library selections are held in `libState` (an orchestrator ref) so
// they survive step changes and can be persisted after Create; resource toggles are
// written straight onto the channel's resourceIds (saved with the channel).
export function DependenciesStep({ channel, libState, depState }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const [tab, setTab] = useState('libraries');
    const [loaded, setLoaded] = useState(false);
    const [picker, setPicker] = useState(null);   // { kind, ids } when the channel picker is open
    const [libQuery, setLibQuery] = useState('');
    const [resQuery, setResQuery] = useState('');
    const [expanded, setExpanded] = useState(() => new Set());   // expanded library ids (show templates)
    const dataRef = useRef({ libraries: [], resources: [], names: new Map() });

    useEffect(() => {
        let alive = true;
        Promise.all([
            api.codeTemplates.libraries(true).catch(() => []),
            api.server.resources().catch(() => null),
            api.server.channelDependencies().catch(() => []),
            api.channels.idsAndNames().catch(() => null)
        ]).then(([libraries, resourcesRaw, channelDeps, idsAndNames]) => {
            if (!alive) return;
            // Deploy/start dependencies: full server list (setChannelDependencies replaces
            // it wholesale) + a name lookup for the picker. Held in depState so edits
            // survive step changes and can be persisted after Create.
            const deps = (Array.isArray(channelDeps) ? channelDeps : [])
                .map((d) => ({ dependentId: String(d.dependentId), dependencyId: String(d.dependencyId) }));
            if (!depState.current) depState.current = { all: deps, initial: deps.map((d) => d.dependentId + '>' + d.dependencyId).sort().join('|') };
            const names = new Map();
            for (const en of api.asList(idsAndNames && idsAndNames.entry)) {
                const pair = api.asList(en && en.string);
                if (pair.length >= 2) names.set(String(pair[0]), String(pair[1]));
            }
            const libs = Array.isArray(libraries) ? libraries : [];
            // Seed the shared library-selection state once.
            if (!libState.current) {
                const checked = new Map(libs.map((l) => [l.id, libEnabledFor(l, channel.id)]));
                libState.current = { libraries: libs, checked, initial: new Map(checked) };
            }
            // Flatten the resources map (skip the built-in Default Resource).
            const resources = [];
            const seen = new Set();
            const listObj = resourcesRaw && typeof resourcesRaw === 'object'
                ? (typeof resourcesRaw.list === 'object' ? resourcesRaw.list : resourcesRaw) : null;
            if (listObj) {
                for (const [k, v] of Object.entries(listObj)) {
                    if (k.startsWith('@')) continue;
                    for (const item of api.asList(v)) {
                        if (item && typeof item === 'object' && item.id && item.name
                            && String(item.id) !== 'Default Resource' && !seen.has(String(item.id))) {
                            seen.add(String(item.id));
                            resources.push({ id: String(item.id), name: String(item.name), type: String(item.type ?? '') });
                        }
                    }
                }
            }
            resources.sort((a, b) => a.name.localeCompare(b.name));
            dataRef.current = { libraries: libs, resources, names };
            setLoaded(true);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { libraries, resources } = dataRef.current;
    const st = libState.current || { checked: new Map() };
    const resObj = entriesToObj(channel.properties && channel.properties.resourceIds);

    const toggleLib = (id, on) => { st.checked.set(id, on); tick(); };
    const toggleRes = (id, name, on) => {
        for (const h of resourceHolders(channel)) {
            const obj = entriesToObj(h.resourceIds);
            if (on) obj[id] = name; else delete obj[id];
            h.resourceIds = objToEntries(obj);
        }
        tick();
    };

    // Deploy/start dependencies (flat direct list, add/remove).
    const dep = depState.current || { all: [] };
    const names = dataRef.current.names;
    const nameOf = (id) => names.get(id) || id;
    const dependsUpon = dep.all.filter((d) => d.dependentId === channel.id).map((d) => d.dependencyId);
    const dependedBy = dep.all.filter((d) => d.dependencyId === channel.id).map((d) => d.dependentId);
    const otherChannels = [...names.keys()].filter((id) => id !== channel.id);
    const addDep = (kind, id) => {
        if (!id) return;
        dep.all.push(kind === 'upstream' ? { dependentId: channel.id, dependencyId: id } : { dependentId: id, dependencyId: channel.id });
        dep.changed = true; tick();
    };
    const removeDep = (kind, id) => {
        dep.all = dep.all.filter((d) => kind === 'upstream'
            ? !(d.dependentId === channel.id && d.dependencyId === id)
            : !(d.dependencyId === channel.id && d.dependentId === id));
        depState.current.all = dep.all; dep.changed = true; tick();
    };
    const depSection = (kind, title, ids) => {
        const available = otherChannels.filter((id) => !ids.includes(id));
        return (
            <div className="flex flex-col gap-2">
                <div className="cform-section-title">{title}</div>
                <div className="step-list min-h-[70px] max-h-[220px] overflow-auto">
                    {ids.length === 0 && <div className="p-2 text-text-faint text-[12px]">None</div>}
                    {ids.map((id) => (
                        <div key={id} className="step-item flex items-center gap-2 min-w-0" title={nameOf(id)}>
                            <span className="flex-1 min-w-0 truncate">{nameOf(id)}</span>
                            <button type="button" className="btn btn-sm btn-danger flex-none" onClick={() => removeDep(kind, id)}><Icon name="trash" size={12} /></button>
                        </div>
                    ))}
                </div>
                <div>
                    <button type="button" className="btn btn-sm" disabled={!available.length} onClick={() => setPicker({ kind, ids })}>
                        <Icon name="plus" size={12} />Add channel
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-4 max-w-[820px]">
            <div className="tabs overflow-x-auto">
                <button type="button" className={`tab whitespace-nowrap ${tab === 'libraries' ? 'active' : ''}`} onClick={() => setTab('libraries')}>Code Template Libraries</button>
                <button type="button" className={`tab whitespace-nowrap ${tab === 'resources' ? 'active' : ''}`} onClick={() => setTab('resources')}>Library Resources</button>
                <button type="button" className={`tab whitespace-nowrap ${tab === 'deploy' ? 'active' : ''}`} onClick={() => setTab('deploy')}>Deploy/Start Dependencies</button>
            </div>

            {!loaded && <div className="hint">Loading…</div>}

            {loaded && tab === 'libraries' && (
                <div className="panel !mt-0">
                    <div className="panel-header flex flex-wrap items-center gap-2">
                        <span>Code Template Libraries</span>
                        {libraries.length > 0 && (
                            <span className="ml-auto flex flex-wrap gap-1">
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { libraries.forEach((l) => st.checked.set(l.id, true)); tick(); }}>Select all</button>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => { libraries.forEach((l) => st.checked.set(l.id, false)); tick(); }}>Deselect all</button>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set(libraries.map((l) => l.id)))}>Expand all</button>
                                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded(new Set())}>Collapse all</button>
                            </span>
                        )}
                    </div>
                    <div className="panel-body flex flex-col gap-1.5">
                        {libraries.length === 0 && <div className="hint">No code template libraries on this engine.</div>}
                        {libraries.length > 6 && <input type="text" placeholder="Filter libraries…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} />}
                        <div className="flex flex-col border border-line rounded-md max-h-[340px] overflow-auto divide-y divide-line">
                        {libraries.filter((lib) => !libQuery.trim() || String(lib.name || '').toLowerCase().includes(libQuery.trim().toLowerCase())).map((lib) => {
                            const templates = api.asList(lib.codeTemplates, 'codeTemplate').filter((t) => t && typeof t === 'object');
                            const open = expanded.has(lib.id);
                            return (
                                <div key={lib.id}>
                                    <label className="flex items-center gap-2 px-2.5 py-2 hover:bg-bg1 cursor-pointer">
                                        <button type="button" disabled={!templates.length}
                                            className="flex-none w-4 h-4 inline-flex items-center justify-center border-0 bg-transparent p-0 text-text-faint hover:text-accent cursor-pointer disabled:opacity-0"
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); const n = new Set(expanded); if (n.has(lib.id)) n.delete(lib.id); else n.add(lib.id); setExpanded(n); }}>
                                            <Icon name={open ? 'chevD' : 'chevR'} size={13} />
                                        </button>
                                        <input type="checkbox" checked={!!st.checked.get(lib.id)} onChange={(e) => toggleLib(lib.id, e.target.checked)} />
                                        <span className="min-w-0 flex-1">
                                            <span className="font-medium">{lib.name || '(unnamed library)'}</span>
                                            <span className="text-text-faint text-[11.5px]"> · {templates.length} template{templates.length === 1 ? '' : 's'}</span>
                                            {lib.description ? <span className="block hint">{lib.description}</span> : null}
                                        </span>
                                    </label>
                                    {open && templates.length > 0 && (
                                        <div className="flex flex-col pl-[46px] pr-2.5 pb-2 gap-0.5">
                                            {templates.map((t, i) => (
                                                <div key={t.id || i} className="flex items-center gap-2 text-[12px] text-text-dim">
                                                    <Icon name="code" size={12} /><span className="truncate">{t.name || '(unnamed template)'}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        </div>
                    </div>
                </div>
            )}

            {loaded && tab === 'resources' && (
                <div className="panel !mt-0">
                    <div className="panel-header">Library Resources</div>
                    <div className="panel-body flex flex-col gap-1.5">
                        {resources.length === 0 && <div className="hint">No library resources on this engine (besides the Default Resource, which always applies).</div>}
                        {resources.length > 6 && <input type="text" placeholder="Filter resources…" value={resQuery} onChange={(e) => setResQuery(e.target.value)} />}
                        <div className="flex flex-col border border-line rounded-md max-h-[340px] overflow-auto divide-y divide-line">
                        {resources.filter((r) => !resQuery.trim() || r.name.toLowerCase().includes(resQuery.trim().toLowerCase())).map((r) => (
                            <label key={r.id} className="flex items-center gap-2 px-2.5 py-2 hover:bg-bg1 cursor-pointer">
                                <input type="checkbox" checked={!!resObj[r.id]} onChange={(e) => toggleRes(r.id, r.name, e.target.checked)} />
                                <span className="font-medium">{r.name}</span>
                                {r.type ? <span className="text-text-faint text-[11.5px]">· {r.type}</span> : null}
                            </label>
                        ))}
                        </div>
                        {resources.length > 0 && <div className="hint">Selected resources are applied to the channel scripts, source, and all destinations.</div>}
                    </div>
                </div>
            )}

            {loaded && tab === 'deploy' && (
                <div className="panel !mt-0">
                    <div className="panel-header">Deploy / Start Dependencies</div>
                    <div className="panel-body grid sm:grid-cols-2 gap-6">
                        {depSection('upstream', 'This channel depends upon', dependsUpon)}
                        {depSection('downstream', 'This channel is depended upon by', dependedBy)}
                    </div>
                    <div className="panel-body pt-0"><div className="hint">Dependencies control deploy/start order and are saved to the engine when you create the channel.</div></div>
                </div>
            )}

            {picker && (
                <PickerModal title="Add channels"
                    items={otherChannels.filter((id) => !picker.ids.includes(id)).map((id) => ({ id, name: nameOf(id) }))}
                    onAdd={(chosen) => chosen.forEach((id) => addDep(picker.kind, id))}
                    onClose={() => setPicker(null)} />
            )}
        </div>
    );
}

/* ---- connector-properties plugin panels (SSL / auth) -------------------------- */

// Replicates the classic editor's connector-properties loop: plugin panels keyed by
// a fully-qualified class name under connector.properties.pluginProperties[fqcn].
export function ConnectorPropertiesPanels({ channel, connector, mode }) {
    const hostRef = useRef(null);
    const [, tick] = useReducer((x) => x + 1, 0);
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const teardowns = [];
        for (const ppDef of platform.connectorPropertiesPanels()) {
            if (ppDef.isSupported && !ppDef.isSupported(connector.transportName, mode, connector)) continue;
            const fqcn = typeof ppDef.propertiesClass === 'function'
                ? ppDef.propertiesClass(connector.transportName, mode, connector) : ppDef.propertiesClass;
            const getEntry = () => (connector.properties && connector.properties.pluginProperties && connector.properties.pluginProperties[fqcn]) || null;
            const setEntry = (entry) => {
                if (!connector.properties) return;
                const pp = connector.properties.pluginProperties || (connector.properties.pluginProperties = {});
                if (entry === null) delete pp[fqcn]; else pp[fqcn] = entry;
            };
            const wrap = document.createElement('div');
            wrap.className = 'panel !mt-0';
            const header = document.createElement('div');
            header.className = 'panel-header';
            header.textContent = ppDef.title || 'Connector Properties';
            const body = document.createElement('div');
            body.className = 'panel-body';
            wrap.append(header, body);
            host.appendChild(wrap);
            teardowns.push(mountReact(body, <PluginSlot def={ppDef} ctx={{ getEntry, setEntry, propertiesClass: fqcn, connector, channel, platform, onChange: () => {} }} />));
        }
        return () => { teardowns.forEach((t) => { try { t(); } catch { /* ignore */ } }); host.replaceChildren(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connector, connector.transportName, mode, tick]);
    return <div ref={hostRef} className="flex flex-col gap-4 empty:hidden" />;
}

/* ---- destination advanced queue settings -------------------------------------- */

const YESNO = (v) => v === true || v === 'true';

// Destination Settings — Queue Messages (Never / On failure / Always, the classic
// queueEnabled+sendFirst mapping), Validate Response, and a collapsible Advanced
// Queue Settings section. Rendered ABOVE the connector panel (classic layout).
export function QueueSettings({ connector, onChange }) {
    const dcp = (connector.properties && connector.properties.destinationConnectorProperties) || null;
    const [, tick] = useReducer((x) => x + 1, 0);
    const [open, setOpen] = useState(false);
    if (!dcp) return null;
    const changed = () => { tick(); if (onChange) onChange(); };
    const set = (k, v) => { dcp[k] = v; changed(); };
    const num = (k, v) => { dcp[k] = String(parseInt(v, 10) || 0); changed(); };
    const mode = !YESNO(dcp.queueEnabled) ? 'never' : (YESNO(dcp.sendFirst) ? 'failure' : 'always');
    const setMode = (m) => { dcp.queueEnabled = m !== 'never'; dcp.sendFirst = m === 'failure'; changed(); };
    const nm = `q-${connector.metaDataId}`;
    const retries = Number(dcp.retryCount) || 0;

    const col = (label, control) => (
        <div className="flex flex-col gap-1.5">
            <div className="text-[11px] uppercase tracking-wide text-text-faint font-semibold">{label}</div>
            {control}
        </div>
    );
    const radios = (name, opts, current, onSel) => (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
            {opts.map(([v, l]) => (
                <label key={String(v)} className="flex items-center gap-1.5">
                    <input type="radio" name={name} checked={current === v} onChange={() => onSel(v)} />{l}
                </label>
            ))}
        </div>
    );
    const YN = [[true, 'Yes'], [false, 'No']];

    return (
        <div className="panel !mt-0">
            <div className="panel-header">Destination Settings</div>
            <div className="panel-body flex flex-col gap-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4">
                    {col('Queue Messages', radios(`${nm}-mode`, [['never', 'Never'], ['failure', 'On Failure'], ['always', 'Always']], mode, setMode))}
                    {col('Advanced Queue Settings', (
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>Advanced Queue Settings</button>
                            <span className="text-text-faint text-[12px]">{retries} {retries === 1 ? 'retry' : 'retries'}</span>
                        </div>
                    ))}
                    {col('Validate Response', radios(`${nm}-vr`, YN, YESNO(dcp.validateResponse), (v) => set('validateResponse', v)))}
                    {col('Reattach Attachments', radios(`${nm}-ra`, YN, dcp.reattachAttachments !== false, (v) => set('reattachAttachments', v)))}
                </div>
                {open && (
                    <div className="border-t border-line pt-3 grid sm:grid-cols-2 gap-x-6 gap-y-3">
                        <label className="flex items-center gap-3"><span className="w-[150px] text-text-dim text-[12px]">Retry count</span><input type="number" className="w-[90px]" value={dcp.retryCount ?? '0'} onChange={(e) => num('retryCount', e.target.value)} /></label>
                        <label className="flex items-center gap-3"><span className="w-[150px] text-text-dim text-[12px]">Retry interval (ms)</span><input type="number" className="w-[110px]" value={dcp.retryIntervalMillis ?? '10000'} onChange={(e) => num('retryIntervalMillis', e.target.value)} /></label>
                        <label className="flex items-center gap-3"><span className="w-[150px] text-text-dim text-[12px]">Queue threads</span><input type="number" className="w-[90px]" value={dcp.threadCount ?? '1'} onChange={(e) => num('threadCount', e.target.value)} /></label>
                        <label className="flex items-center gap-3"><span className="w-[150px] text-text-dim text-[12px]">Queue buffer size</span><input type="number" className="w-[110px]" value={dcp.queueBufferSize ?? '1000'} onChange={(e) => num('queueBufferSize', e.target.value)} /></label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={YESNO(dcp.rotate)} disabled={mode === 'never'} onChange={(e) => set('rotate', e.target.checked)} />Rotate queue on failure</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={YESNO(dcp.regenerateTemplate)} onChange={(e) => set('regenerateTemplate', e.target.checked)} />Regenerate template on retry</label>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ---- channel scripts ---------------------------------------------------------- */

const SCRIPTS = [
    { key: 'deployScript', label: 'Deploy', hint: 'Runs once when the channel is deployed.', context: 'CHANNEL_DEPLOY' },
    { key: 'undeployScript', label: 'Undeploy', hint: 'Runs once when the channel is undeployed.', context: 'CHANNEL_UNDEPLOY' },
    { key: 'preprocessingScript', label: 'Preprocessor', hint: 'Runs before every message is processed.', context: 'CHANNEL_PREPROCESSOR' },
    { key: 'postprocessingScript', label: 'Postprocessor', hint: 'Runs after every message is processed.', context: 'CHANNEL_POSTPROCESSOR' }
];

export function ChannelScripts({ channel }) {
    const [which, setWhich] = useState('deployScript');
    const spec = SCRIPTS.find((s) => s.key === which);
    // Scope Monaco's variable/code-template completions to the selected script,
    // the same way the classic Scripts tab does (best-effort on an unsaved channel).
    useEffect(() => {
        setActiveScope(channel.id, [spec.context]);
        return () => clearActiveScope();
    }, [channel.id, spec.context]);
    return (
        <div className="panel !mt-0">
            <div className="panel-header flex items-center gap-3">
                <span>Scripts</span>
                <select className="ml-auto" value={which} onChange={(e) => setWhich(e.target.value)}>
                    {SCRIPTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
            </div>
            <div className="panel-body flex flex-col gap-2">
                <div className="hint">{spec.hint}</div>
                <CodeEditor key={which} language="javascript" defaultValue={channel[which] || ''}
                    onChange={(v) => { channel[which] = v; }} style={{ minHeight: '260px' }} />
            </div>
        </div>
    );
}

/* ---- channel settings (Summary-tab options) ----------------------------------- */

const STORAGE_MODES = [
    { value: 'DEVELOPMENT', label: 'Development', desc: 'Everything stored — full reprocessing & debugging. Highest storage, lowest performance.' },
    { value: 'PRODUCTION', label: 'Production', desc: 'Content + metadata; no debugging maps.' },
    { value: 'RAW', label: 'Raw', desc: 'Raw content + metadata only.' },
    { value: 'METADATA', label: 'Metadata', desc: 'Metadata only — no message content.' },
    { value: 'DISABLED', label: 'Disabled', desc: 'Nothing stored — highest performance, no message browsing.' }
];

// Modern segmented slider. Displayed least → most storage (Disabled … Development)
// so the default (Development) sits on the right and the storage meter reads "full".
function StorageSlider({ value, onChange }) {
    const display = [...STORAGE_MODES].reverse();
    const n = display.length;
    const di = Math.max(0, display.findIndex((m) => m.value === value));
    const fill = (di / (n - 1)) * 100;   // Development (rightmost) = 100%
    return (
        <div className="flex flex-col gap-3">
            <div className="relative flex p-1 rounded-xl bg-bg1 border border-line">
                <div className="absolute top-1 bottom-1 rounded-lg bg-accent shadow-sm transition-[left] duration-300 ease-out pointer-events-none"
                    style={{ width: `calc((100% - 0.5rem) / ${n})`, left: `calc(0.25rem + ${di} * (100% - 0.5rem) / ${n})` }} />
                {display.map((m, i) => (
                    <button key={m.value} type="button" onClick={() => onChange(m.value)}
                        className={`relative z-10 flex-1 border-0 bg-transparent py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors ${i === di ? 'text-white' : 'text-text-dim hover:text-text'}`}>
                        {m.label}
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-3">
                <span className="text-[11px] text-text-faint w-[100px]">Higher performance</span>
                <div className="relative flex-1 h-1.5 rounded-full bg-bg1 overflow-hidden">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${fill}%` }} />
                </div>
                <span className="text-[11px] text-text-faint w-[74px] text-right">More storage</span>
            </div>
            <div className="text-[12px] text-text-dim">{display[di].desc}</div>
        </div>
    );
}
const META_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'];

/* ---- attachment handler (channel.properties.attachmentProperties) ------------- */

const ATTACHMENT_TYPES = [
    { value: 'None', label: 'None', className: null },
    { value: 'Entire Message', label: 'Entire Message', className: 'com.mirth.connect.server.attachments.identity.IdentityAttachmentHandlerProvider' },
    { value: 'Regex', label: 'Regex', className: 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider' },
    { value: 'DICOM', label: 'DICOM', className: 'com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider' },
    { value: 'JavaScript', label: 'JavaScript', className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider' }
];
const DEFAULT_ATTACHMENT_SCRIPT = '// Modify the message variable below to create attachments\nreturn message;';

function AttachmentHandler({ channel, version }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const p = channel.properties = channel.properties || {};
    const ap = p.attachmentProperties = p.attachmentProperties || { '@version': version, type: 'None', properties: null };
    const map = entriesToObj(ap.properties);
    const setMap = (m) => { ap.properties = objToEntries(m); tick(); };

    const setType = (type) => {
        const def = ATTACHMENT_TYPES.find((t) => t.value === type);
        ap.type = type;
        if (def && def.className) ap.className = def.className; else delete ap.className;
        if (type === 'Regex') ap.properties = objToEntries({ 'regex.pattern0': '', 'regex.mimetype0': '' });
        else if (type === 'JavaScript') ap.properties = objToEntries({ 'javascript.script': DEFAULT_ATTACHMENT_SCRIPT });
        else if (type === 'Entire Message') ap.properties = objToEntries({ 'identity.mimetype': '' });
        else ap.properties = null;
        tick();
    };
    const regexRows = () => {
        const rows = [];
        for (let i = 0; map[`regex.pattern${i}`] !== undefined || map[`regex.mimetype${i}`] !== undefined; i++) {
            rows.push({ pattern: map[`regex.pattern${i}`] || '', mimetype: map[`regex.mimetype${i}`] || '' });
        }
        return rows.length ? rows : [{ pattern: '', mimetype: '' }];
    };
    const setRegexRows = (rows) => {
        const m = {};
        rows.forEach((r, i) => { m[`regex.pattern${i}`] = r.pattern; m[`regex.mimetype${i}`] = r.mimetype; });
        setMap(m);
    };

    const known = ATTACHMENT_TYPES.some((t) => t.value === ap.type);
    return (
        <div className="panel !mt-0">
            <div className="panel-header flex items-center gap-3">
                <span>Attachments</span>
                <label className="ml-auto normal-case font-normal flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={p.storeAttachments === true} onChange={(e) => { p.storeAttachments = e.target.checked; tick(); }} />Store attachments
                </label>
            </div>
            {p.storeAttachments && (
            <div className="panel-body flex flex-col gap-3">
                <label className="flex flex-wrap items-center gap-3">
                    <span className="w-[140px] text-text-dim text-[12px]">Attachment handler</span>
                    <select className="w-[200px]" value={ap.type || 'None'} onChange={(e) => setType(e.target.value)}>
                        {ATTACHMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        {!known && ap.type ? <option value={ap.type}>{ap.type} (custom)</option> : null}
                    </select>
                </label>
                {ap.type === 'Entire Message' && (
                    <label className="flex flex-wrap items-center gap-3">
                        <span className="w-[140px] text-text-dim text-[12px]">MIME type</span>
                        <input type="text" className="flex-1 min-w-[160px]" placeholder="e.g. text/plain"
                            value={map['identity.mimetype'] || ''} onChange={(e) => setMap({ ...map, 'identity.mimetype': e.target.value })} />
                    </label>
                )}
                {ap.type === 'JavaScript' && (
                    <CodeEditor key="att-js" language="javascript" defaultValue={map['javascript.script'] || DEFAULT_ATTACHMENT_SCRIPT}
                        onChange={(v) => { map['javascript.script'] = v; ap.properties = objToEntries(map); }} style={{ minHeight: '200px' }} />
                )}
                {ap.type === 'Regex' && (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-faint">
                            <span className="flex-1">Regex pattern</span><span className="flex-1">MIME type</span><span className="w-[30px] flex-none" />
                        </div>
                        {regexRows().map((r, i, arr) => (
                            <div key={i} className="flex items-center gap-2">
                                <input type="text" className="flex-1 min-w-0" value={r.pattern} onChange={(e) => setRegexRows(arr.map((x, idx) => idx === i ? { ...x, pattern: e.target.value } : x))} />
                                <input type="text" className="flex-1 min-w-0" value={r.mimetype} onChange={(e) => setRegexRows(arr.map((x, idx) => idx === i ? { ...x, mimetype: e.target.value } : x))} />
                                <button type="button" className="btn btn-sm btn-danger w-[30px] flex-none justify-center" onClick={() => setRegexRows(arr.length > 1 ? arr.filter((_, idx) => idx !== i) : [{ pattern: '', mimetype: '' }])}><Icon name="trash" size={12} /></button>
                            </div>
                        ))}
                        <div><button type="button" className="btn btn-sm" onClick={() => setRegexRows([...regexRows(), { pattern: '', mimetype: '' }])}><Icon name="plus" size={12} />Add pattern</button></div>
                    </div>
                )}
                {(ap.type === 'None' || ap.type === 'DICOM') && <div className="hint">{ap.type === 'DICOM' ? 'DICOM attachments are handled automatically.' : 'Choose a handler to extract attachments from incoming messages.'}</div>}
            </div>
            )}
        </div>
    );
}

/* ---- channel tags (channel.exportData.channelTags, saved with the channel) ----- */

function randomTagColor() {
    const hue = Math.floor(Math.random() * 360), s = 0.55, l = 0.6;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue < 60) [r, g, b] = [c, x, 0];
    else if (hue < 120) [r, g, b] = [x, c, 0];
    else if (hue < 180) [r, g, b] = [0, c, x];
    else if (hue < 240) [r, g, b] = [0, x, c];
    else if (hue < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { red: Math.round((r + m) * 255), green: Math.round((g + m) * 255), blue: Math.round((b + m) * 255), alpha: 255 };
}
function tagChipBg(color) {
    return (color && color.red !== undefined) ? `rgba(${color.red}, ${color.green}, ${color.blue}, 0.3)` : 'var(--bg2)';
}

function ChannelTags({ channel, version }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const st = useRef({ all: [], assigned: new Set(), available: false, loaded: false });
    useEffect(() => {
        let alive = true;
        api.server.channelTags().then((tags) => {
            if (!alive) return;
            const all = (Array.isArray(tags) ? tags : []).map((t) => ({ id: t.id, name: t.name, backgroundColor: t.backgroundColor, channelIds: api.asList(t.channelIds, 'string').map(String) }));
            const assigned = new Set();
            for (const t of all) if (t.channelIds.includes(channel.id)) assigned.add(t.name);
            for (const ct of api.asList(channel.exportData && channel.exportData.channelTags, 'channelTag')) {
                if (!ct || !ct.name) continue;
                if (!all.some((t) => t.name === ct.name)) all.push({ id: ct.id || oie.uuid(), name: ct.name, channelIds: api.asList(ct.channelIds, 'string').map(String), backgroundColor: ct.backgroundColor });
                assigned.add(String(ct.name));
            }
            st.current = { all, assigned, available: true, loaded: true };
            tick();
        }).catch(() => { st.current.loaded = true; tick(); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Write assigned tags onto the channel (engine reconciles membership on save).
    const apply = () => {
        const s = st.current;
        if (!s.available) return;
        const channelTags = s.all.filter((t) => s.assigned.has(t.name)).map((t) => {
            const ids = new Set(t.channelIds); ids.add(channel.id);
            return { '@version': version, id: t.id, name: t.name, channelIds: { string: [...ids] }, backgroundColor: t.backgroundColor };
        });
        channel.exportData = channel.exportData || {};
        channel.exportData.channelTags = channelTags.length ? { channelTag: channelTags } : '';
        for (const t of s.all) { const ids = new Set(t.channelIds); if (s.assigned.has(t.name)) ids.add(channel.id); else ids.delete(channel.id); t.channelIds = [...ids]; }
    };

    const s = st.current;
    const fixName = (n) => String(n).replace(/[^a-zA-Z_0-9\-\s]/g, '').slice(0, 24).trim();
    const addTag = (raw) => {
        const name = fixName(raw);
        if (!name || s.assigned.has(name)) return;
        if (!s.all.some((t) => t.name === name)) s.all.push({ id: oie.uuid(), name, channelIds: [], backgroundColor: randomTagColor() });
        s.assigned.add(name); apply(); tick();
    };
    const removeTag = (name) => { s.assigned.delete(name); apply(); tick(); };

    const assigned = [...s.assigned].sort((a, b) => a.localeCompare(b));
    const suggestions = s.all.filter((t) => !s.assigned.has(t.name)).map((t) => t.name);
    return (
        <div className="panel !mt-0">
            <div className="panel-header">Tags</div>
            <div className="panel-body">
                {!s.loaded && <div className="hint">Loading tags…</div>}
                {s.loaded && (
                    <div className="flex flex-wrap items-center gap-1.5">
                        {assigned.length === 0 && <span className="text-text-faint text-[12px]">No tags.</span>}
                        {assigned.map((name) => {
                            const tag = s.all.find((t) => t.name === name);
                            return (
                                <span key={name} className="inline-flex items-center gap-1 py-0.5 px-2 rounded-full border border-line text-[12px]" style={{ background: tagChipBg(tag && tag.backgroundColor) }}>
                                    {name}
                                    <button type="button" className="appearance-none border-0 bg-transparent p-0 text-text-dim hover:text-[var(--text)] leading-none cursor-pointer" style={{ font: 'inherit' }} title="Remove tag" onClick={() => removeTag(name)}>✕</button>
                                </span>
                            );
                        })}
                        <input type="text" list="wiz-tag-list" placeholder="Add tag…" className="w-[140px]"
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(e.target.value); e.target.value = ''; } }}
                            onChange={(e) => { if (e.target.value && suggestions.includes(e.target.value)) { addTag(e.target.value); e.target.value = ''; } }} />
                        <datalist id="wiz-tag-list">{suggestions.map((n) => <option key={n} value={n} />)}</datalist>
                    </div>
                )}
            </div>
        </div>
    );
}

export function ChannelSettings({ channel, version }) {
    const [, tick] = useReducer((x) => x + 1, 0);
    const p = channel.properties = channel.properties || {};
    const meta = channel.exportData = channel.exportData || {};
    meta.metadata = meta.metadata || { enabled: true, pruningSettings: {} };
    const prune = meta.metadata.pruningSettings = meta.metadata.pruningSettings || {};
    const storageDisabled = p.messageStorageMode === 'METADATA' || p.messageStorageMode === 'DISABLED';
    const nothingPruned = prune.pruneMetaDataDays == null && prune.pruneContentDays == null;

    const cols = () => {
        const mc = p.metaDataColumns = p.metaDataColumns || {};
        return Array.isArray(mc.metaDataColumn) ? mc.metaDataColumn : (mc.metaDataColumn ? [mc.metaDataColumn] : []);
    };
    const setCols = (list) => { p.metaDataColumns = { metaDataColumn: list }; tick(); };

    const chk = (obj, k, label, opts = {}) => (
        <label className={`flex items-center gap-2 ${opts.disabled ? 'opacity-50' : ''}`}>
            <input type="checkbox" checked={obj[k] === true} disabled={opts.disabled}
                onChange={(e) => { obj[k] = e.target.checked; tick(); }} />{label}
        </label>
    );

    const columns = cols();
    return (
        <div className="flex flex-col gap-4">
            <div className="panel !mt-0">
                <div className="panel-header">General</div>
                <div className="panel-body grid sm:grid-cols-2 gap-x-6 gap-y-3">
                    <label className="flex items-center gap-3"><span className="w-[140px] text-text-dim text-[12px]">Initial state</span>
                        <select value={p.initialState || 'STARTED'} onChange={(e) => { p.initialState = e.target.value; tick(); }}>
                            <option value="STARTED">Started</option><option value="PAUSED">Paused</option><option value="STOPPED">Stopped</option>
                        </select>
                    </label>
                    {chk(meta.metadata, 'enabled', 'Channel enabled')}
                    {chk(p, 'clearGlobalChannelMap', 'Clear global channel map on deploy')}
                </div>
            </div>

            <AttachmentHandler channel={channel} version={version} />
            <ChannelTags channel={channel} version={version} />

            <div className="panel !mt-0">
                <div className="panel-header">Message Storage</div>
                <div className="panel-body flex flex-col gap-3">
                    <StorageSlider value={p.messageStorageMode || 'DEVELOPMENT'} onChange={(v) => { p.messageStorageMode = v; tick(); }} />
                    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 pt-1">
                        {chk(p, 'encryptData', 'Encrypt message content')}
                        {chk(p, 'encryptAttachments', 'Encrypt attachments')}
                        {chk(p, 'encryptCustomMetaData', 'Encrypt custom metadata', { disabled: storageDisabled })}
                        {chk(p, 'removeContentOnCompletion', 'Remove content on completion', { disabled: storageDisabled })}
                        {chk(p, 'removeOnlyFilteredOnCompletion', 'Remove only filtered content', { disabled: storageDisabled || p.removeContentOnCompletion !== true })}
                        {chk(p, 'removeAttachmentsOnCompletion', 'Remove attachments on completion', { disabled: storageDisabled })}
                    </div>
                </div>
            </div>

            <div className="panel !mt-0">
                <div className="panel-header">Message Pruning</div>
                <div className="panel-body flex flex-col gap-4">
                    <div className="grid sm:grid-cols-2 gap-6">
                        <div className="flex flex-col gap-2">
                            <div className="cform-section-title">Metadata</div>
                            <label className="flex items-center gap-2">
                                <input type="radio" name="prune-meta" checked={prune.pruneMetaDataDays == null}
                                    onChange={() => { delete prune.pruneMetaDataDays; tick(); }} />Store indefinitely
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="radio" name="prune-meta" checked={prune.pruneMetaDataDays != null}
                                    onChange={() => { prune.pruneMetaDataDays = Number(prune.pruneMetaDataDays) || 30; tick(); }} />Prune older than
                                <input type="number" min="1" className="w-[80px]" disabled={prune.pruneMetaDataDays == null}
                                    value={prune.pruneMetaDataDays ?? ''} onChange={(e) => { prune.pruneMetaDataDays = Math.max(1, Number(e.target.value) || 1); tick(); }} />
                                <span className="text-text-dim text-[12px]">days</span>
                            </label>
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="cform-section-title">Content</div>
                            <label className="flex items-center gap-2">
                                <input type="radio" name="prune-content" checked={prune.pruneContentDays == null}
                                    onChange={() => { delete prune.pruneContentDays; tick(); }} />Prune when metadata is removed
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="radio" name="prune-content" checked={prune.pruneContentDays != null}
                                    onChange={() => { prune.pruneContentDays = Number(prune.pruneContentDays) || 30; tick(); }} />Prune older than
                                <input type="number" min="1" className="w-[80px]" disabled={prune.pruneContentDays == null}
                                    value={prune.pruneContentDays ?? ''} onChange={(e) => { prune.pruneContentDays = Math.max(1, Number(e.target.value) || 1); tick(); }} />
                                <span className="text-text-dim text-[12px]">days</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className={`flex items-center gap-2 ${nothingPruned ? 'opacity-50' : ''}`}>
                            <input type="checkbox" disabled={nothingPruned} checked={prune.archiveEnabled !== false}
                                onChange={(e) => { prune.archiveEnabled = e.target.checked; tick(); }} />Allow message archiving
                        </label>
                        {chk(prune, 'pruneErroredMessages', 'Prune errored messages', { disabled: nothingPruned })}
                        <div className="hint">{prune.pruneErroredMessages ? 'Incomplete and queued messages will not be pruned.' : 'Incomplete, errored, and queued messages will not be pruned.'}</div>
                    </div>
                </div>
            </div>

            <div className="panel !mt-0">
                <div className="panel-header">Custom Metadata Columns</div>
                <div className="panel-body flex flex-col gap-2">
                    {columns.length === 0 && <div className="hint">No custom columns. Add one to capture a value into the message metadata.</div>}
                    {columns.length > 0 && (
                        <div className="flex items-center gap-2 px-0.5 text-[11px] uppercase tracking-wide text-text-faint">
                            <span className="flex-1">Column name</span>
                            <span className="w-[130px] flex-none">Type</span>
                            <span className="flex-1">Mapping variable</span>
                            <span className="w-[30px] flex-none" />
                        </div>
                    )}
                    {columns.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <input type="text" className="flex-1 min-w-0" placeholder="e.g. patientId" value={c.name || ''}
                                onChange={(e) => { columns[i] = { ...c, name: e.target.value }; setCols([...columns]); }} />
                            <select className="w-[130px] flex-none" value={c.type || 'STRING'} onChange={(e) => { columns[i] = { ...c, type: e.target.value }; setCols([...columns]); }}>
                                {META_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <input type="text" className="flex-1 min-w-0" placeholder="e.g. mirth_patientId" value={c.mappingName || ''}
                                onChange={(e) => { columns[i] = { ...c, mappingName: e.target.value }; setCols([...columns]); }} />
                            <button type="button" className="btn btn-sm btn-danger w-[30px] flex-none justify-center" onClick={() => setCols(columns.filter((_, idx) => idx !== i))}><Icon name="trash" size={13} /></button>
                        </div>
                    ))}
                    <div><button type="button" className="btn btn-sm" onClick={() => setCols([...columns, { name: '', type: 'STRING', mappingName: '' }])}><Icon name="plus" size={13} />Add column</button></div>
                </div>
            </div>
        </div>
    );
}
