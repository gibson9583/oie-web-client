/*
 * Channel editor (React port of views/channel-editor.js) — parity with the Swing
 * Administrator's channel setup pane. One mutable channel object is shared by
 * every tab; all edits mutate it in place so the XStream round-trip
 * (GET → mutate → PUT) preserves '@class', '@version' and any properties
 * contributed by server-side plugins. The model object stays a mutable ref (NOT
 * cloned into immutable React state) — @class/@version/pluginProperties and the
 * filter/transformer sub-editor handoff depend on it.
 *
 * The channel travels through the store ('editingChannel') when navigating to
 * the filter/transformer editors so unsaved edits survive the round trip. Dirty
 * is the explicit 'editingChannelDirty' store flag, NOT object identity.
 *
 * Almost the entire tab body is heavy imperative DOM — a DataTable destinations
 * grid, the message-storage slider, plugin-rendered connector property panels
 * (platform.connectorPanel / connectorPropertiesPanels / channelTabs), Monaco
 * script editors, and a stack of sub-modals (Set Data Types, Set Dependencies,
 * Advanced Queue Settings, Attachment Handler). So (like code-templates.jsx) the
 * body is kept mounted via a ref and built ONCE by the legacy buildBody() logic
 * reused VERBATIM; only the task panes (Channel Tasks + the contextual connector
 * tasks) become React <TaskButton>s, gated on the active-tab/selection state the
 * body drives through onTasksChange.
 *
 * register(platform) also registers the filter/transformer/response sub-editor
 * routes (registerFilterTransformer), since they share the in-store editingChannel.
 */

import { useEffect, useRef, useReducer, useState } from 'react';
import { h, clear, field, textInput, numberInput, select, checkbox, taskButton, tabs, toast, confirmDialog, promptDialog, modal, DataTable, saveFile, pickFile, fmtDate, contextMenu } from '@oie/web-ui';
import api from '@oie/web-api';
import * as oie from '@oie/web-api';
import { createCodeEditor } from '@oie/web-ui';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { validateScript } from '../../core/serialize.js';
import { setActiveScope, clearActiveScope } from '../../core/script-completions.js';
import { dataTypeDef, dataTypeList } from '../../datatypes/index.js';
import { DataTypePropertiesEditor } from '../../datatypes/props-editor.jsx';
import { platform } from '@oie/web-shell';
import { register as registerFilterTransformer } from './filter-transformer.jsx';
import { reactView, ViewTasks, mountReact } from '../mount.jsx';
import { PluginSlot } from '../plugin-slot.jsx';
import { RailPane, TaskButton } from '../ui.jsx';

const INITIAL_STATES = ['STARTED', 'PAUSED', 'STOPPED'];

/* New channel tags get a random pleasant color, like the Swing client. */
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

/* ChannelTag backgroundColor → a chip background rgba, matching channels.js. */
function tagChipBg(color) {
    return (color && color.red !== undefined)
        ? `rgba(${color.red}, ${color.green}, ${color.blue}, 0.3)` : 'var(--bg3)';
}

/* AttachmentHandlerType strings/classes from com.mirth.connect.model.attachments */
const ATTACHMENT_TYPES = [
    { value: 'None', label: 'None', className: null },
    { value: 'Entire Message', label: 'Entire Message', className: 'com.mirth.connect.server.attachments.identity.IdentityAttachmentHandlerProvider' },
    { value: 'Regex', label: 'Regex', className: 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider' },
    { value: 'DICOM', label: 'DICOM', className: 'com.mirth.connect.server.attachments.dicom.DICOMAttachmentHandlerProvider' },
    { value: 'JavaScript', label: 'JavaScript', className: 'com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider' }
];

const META_COLUMN_TYPES = ['STRING', 'NUMBER', 'BOOLEAN', 'TIMESTAMP'];

const DEFAULT_ATTACHMENT_SCRIPT = '// Modify the message variable below to create attachments\nreturn message;';

/* Classic Administrator "Destination Mappings" velocity variables. */
const DESTINATION_MAPPINGS = [
    ['Channel ID', '${channelId}'],
    ['Channel Name', '${channelName}'],
    ['Message ID', '${message.messageId}'],
    ['Raw Data', '${message.rawData}'],
    ['Transformed Data', '${message.transformedData}'],
    ['Encoded Data', '${message.encodedData}'],
    ['Message Source', '${message.source}'],
    ['Message Type', '${message.type}'],
    ['Message Version', '${message.version}'],
    ['Date', '${date}'],
    ['Formatted Date', "${date.get('yyyy-M-d H.m.s')}"],
    ['Timestamp', '${SYSTIME}'],
    ['Unique ID', '${UUID}'],
    ['Original File Name', '${originalFilename}'],
    ['Count', '${COUNT}'],
    ['XML Entity Encoder', '${XmlUtil.encode()}'],
    ['XML Pretty Printer', '${XmlUtil.prettyPrint()}'],
    ['Escape JSON String', '${JsonUtil.escape()}'],
    ['JSON Pretty Printer', '${JsonUtil.prettyPrint()}'],
    ['CDATA Tag', '<![CDATA[]]>'],
    ['DICOM Message Raw Data', '${DICOMMESSAGE}']
];

/* Summary text shown next to the Advanced Queue Settings button, replicating
   the Swing DestinationSettingsPanel.updateAdvancedSettingsLabel(). */
function advancedQueueSummary(dcp) {
    const parts = [];
    const queueEnabled = !!dcp.queueEnabled;
    const sendFirst = queueEnabled && !!dcp.sendFirst;
    const retryCount = Number(dcp.retryCount) || 0;
    const interval = Number(dcp.retryIntervalMillis) || 0;
    const threads = Number(dcp.threadCount) || 1;
    const retries = `${retryCount} ${retryCount === 1 ? 'Retry' : 'Retries'}`;
    if (!queueEnabled) {
        parts.push(retries);
        if (retryCount > 0) parts.push(`Interval ${interval} ms`);
    } else {
        if (dcp.regenerateTemplate) parts.push('Regenerate');
        if (dcp.rotate) parts.push('Rotate');
        if (dcp.includeFilterTransformer) parts.push('Including Transformer');
        if (sendFirst) parts.push(retries);
        parts.push(`Interval ${interval} ms`);
        if (threads > 1) {
            parts.push(`${threads} Threads`);
            if (dcp.threadAssignmentVariable) parts.push(`Group By ${dcp.threadAssignmentVariable}`);
        }
    }
    return parts.join(' / ');
}

/* ---- XStream Properties map: { entry: [{ string: [key, value] }] } ----------- */

function entriesToObj(map) {
    const obj = {};
    if (!map || typeof map !== 'object') return obj;
    for (const entry of api.asList(map.entry)) {
        const pair = api.asList(entry && entry.string);
        if (!pair.length) continue;
        obj[String(pair[0])] = pair.length > 1 ? pair[1] : '';
    }
    return obj;
}

function objToEntries(obj) {
    const entries = Object.entries(obj).map(([key, value]) => ({ string: [key, String(value ?? '')] }));
    return entries.length ? { entry: entries } : null;
}

export function register(platform) {
    platform.registerView('/channels/:channelId/edit', reactView(ChannelEditorView), { title: 'Edit Channel' });
    // Data types are provided entirely by plugins (plugins/datatype-*), loaded
    // at startup and read from the platform registry via dataTypeDef/dataTypeList.
    // Companion routes (filter / transformer / response transformer editors).
    registerFilterTransformer(platform);
}

function ChannelEditorView({ params, query }) {
    const [, forceRender] = useReducer((x) => x + 1, 0);
    // Whether the channel was already in the store at mount (returning from a
    // sub-editor / opened from the list with edits) vs. fetched fresh here. A
    // fresh load starts clean; a returning channel keeps its dirty flag.
    const returningRef = useRef(null);
    if (returningRef.current === null) {
        const c = store.getState('editingChannel');
        returningRef.current = !!(c && c.id === params.channelId);
    }
    // The channel is read from the store (seeded by the Channels list / New
    // Channel) or fetched here (matching the async legacy renderEditor) before the
    // body builds. `ready` flips once the channel is available; null = loading.
    const [ready, setReady] = useState(() => returningRef.current ? true : null);
    const bodyHostRef = useRef(null);
    const ctxRef = useRef(null);

    // No in-store channel: fetch it, then build.
    useEffect(() => {
        if (ready) return;
        let alive = true;
        api.channels.get(params.channelId).then((loaded) => {
            if (!alive) return;
            store.setState('editingChannel', loaded);
            setReady(true);
        }).catch((e) => { if (alive) { toast(e.message, 'error'); setReady(false); } });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!ready) return;
        const host = bodyHostRef.current;
        if (!host) return;
        const ctx = buildBody(params, query, forceRender, returningRef.current);
        ctxRef.current = ctx;
        if (ctx.el) host.appendChild(ctx.el);
        forceRender();   // first paint of the (now-populated) task panes
        return () => {
            ctxRef.current = null;
            if (ctx.teardown) ctx.teardown();
            host.replaceChildren();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    const ctx = ctxRef.current;
    const ts = (ctx && ctx.taskState && ctx.taskState()) || { dirty: false, tab: 'Summary', destSelected: false };
    const t = ctx && ctx.handlers;

    return (
        <div className="view flex flex-col flex-1 min-h-0">
            <ViewTasks>
                <RailPane title="Channel Tasks" paneKey="tasks:Channel Tasks" group="channelEdit">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        {t && ts.dirty && <TaskButton label="Save Changes" icon="save" primary task="doSaveChannel" onClick={t.save} />}
                        {t && <TaskButton label="Deploy Channel" icon="deploy" task="doDeployFromChannelView" onClick={t.deploy} />}
                        {t && <TaskButton label="Debug Channel" icon="deploy" task="doDebugDeployFromChannelView" onClick={t.openDebugDeployModal} />}
                        {t && <TaskButton label="Export Channel" icon="export" task="doExportChannel" onClick={t.exportChannel} />}
                        {t && <TaskButton label="Back to Channels" icon="channels" onClick={t.backToChannels} />}

                        {/* Contextual connector tasks (Swing ctx-tasks), gated by active tab. */}
                        {t && ts.tab === 'Source' && <TaskButton label={t.withCount('Edit Filter', t.sourceStepCount('filter'))} icon="filter" onClick={() => t.gotoElements('filter', 0)} />}
                        {t && ts.tab === 'Source' && <TaskButton label={t.withCount('Edit Transformer', t.sourceStepCount('transformer'))} icon="transform" onClick={() => t.gotoElements('transformer', 0)} />}

                        {t && ts.tab === 'Destinations' && <TaskButton label="New Destination" icon="plus" task="doNewDestination" onClick={t.destNew} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Delete Destination" icon="trash" danger task="doDeleteDestination" onClick={t.destDelete} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Move Dest. Up" icon="arrowUp" task="doMoveDestinationUp" onClick={() => t.destMove(-1)} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Move Dest. Down" icon="arrowDown" task="doMoveDestinationDown" onClick={() => t.destMove(1)} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Filter', t.destStepCount('filter'))} icon="filter" onClick={() => t.destEdit('filter')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Transformer', t.destStepCount('transformer'))} icon="transform" onClick={() => t.destEdit('transformer')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label={t.withCount('Edit Response', t.destStepCount('responseTransformer'))} icon="transform" onClick={() => t.destEdit('response')} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Import Connector" icon="import" task="doImportConnector" onClick={t.destImport} />}
                        {t && ts.tab === 'Destinations' && <TaskButton label="Export Connector" icon="export" task="doExportConnector" onClick={t.destExport} />}
                    </div>
                </RailPane>
            </ViewTasks>
            {ready === null
                ? <div className="view-body"><div className="dt-empty">Loading channel…</div></div>
                : ready === false
                    ? <div className="view-body"><div className="dt-empty">Channel not loaded</div></div>
                    : <div ref={bodyHostRef} className="flex flex-col flex-1 min-h-0" />}
        </div>
    );
}

/* Build the imperative editor body (tabbed channel setup pane), returning
   { el, teardown, handlers, taskState }. The body logic is reused VERBATIM from
   the legacy view; only the task panes are lifted into React (the legacy taskbar
   + ctx-tasks elements are dropped, replaced by the gated task-state the React
   pane reads). `onTasksChange` is called whenever the active tab / dirty / dest
   selection changes so the React pane re-renders. The channel is guaranteed
   present in the store here. `returning` = the channel was already in the store
   at mount (opened with edits / returning from a sub-editor) vs. fetched fresh. */
function buildBody(params, query, onTasksChange, returning) {
    /* ---- load --------------------------------------------------------------- */

    const channel = store.getState('editingChannel');
    let isNew = query.new === '1' || store.getState('editingChannelNew') === true;
    store.setState('editingChannelNew', isNew);

    const version = channel['@version'] || store.getState('serverVersion') || '4.5.2';

    // route:changed resets the banner to the static route title ("Edit Channel")
    // after this async handler returns; defer past it (rAF runs after that
    // microtask, before paint) so the channel name sticks without a flash.
    const bannerTitle = channel.name ? `Edit Channel - ${channel.name}` : 'Edit Channel';
    window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
        detail: { title: bannerTitle }
    })));

    // Unsaved state is tracked in a shared store flag ('editingChannelDirty') so
    // it survives navigation to the filter/transformer sub-editors and back.
    // Previously "the channel is in the store" was treated as dirty, but those
    // sub-editors leave it in the store even after they save — which falsely
    // re-prompted on exit. A freshly loaded existing channel starts clean; a
    // brand-new channel is dirty until saved.
    if (!returning) store.setState('editingChannelDirty', false);
    // The shared flag is the single source of truth (it stays live while the
    // filter/transformer sub-editors edit the same channel), so read it rather
    // than mirror it in a local that goes stale across sub-editor navigation.
    const isDirty = () => isNew || store.getState('editingChannelDirty') === true;
    // The Save button shows only when there are unsaved changes (Swing isSaveEnabled).
    function refreshSaveVisibility() { onTasksChange(); }
    function markDirty() { store.setState('editingChannelDirty', true); refreshSaveVisibility(); }

    /* Leaving the editor with unsaved changes asks Save / Don't Save / Cancel
       (classic behavior). Navigation within this channel's editing flow
       (filter/transformer/response editors) keeps the working copy. */
    function promptSaveChanges() {
        return new Promise((resolve) => {
            modal({
                title: 'Unsaved Changes',
                body: h('div', `Would you like to save the changes made to "${channel.name || 'this channel'}"?`),
                onClose: () => resolve('cancel'),
                buttons: [
                    { label: 'Cancel', onClick: () => { resolve('cancel'); } },
                    { label: "Don't Save", danger: true, onClick: () => { resolve('discard'); } },
                    { label: 'Save Changes', primary: true, onClick: () => { resolve('save'); } }
                ]
            });
        });
    }

    store.setState('navGuard', async ({ path }) => {
        if (path.startsWith(`/channels/${params.channelId}/`)) return; // same editing flow
        if (isDirty()) {
            const choice = await promptSaveChanges();
            if (choice === 'cancel') return false;
            if (choice === 'save' && !await save()) return false;
        }
        // Leaving the editor: drop the working copy AND this guard — it must
        // never prompt again for navigation outside the editor.
        store.setState('editingChannel', null);
        store.setState('editingChannelNew', false);
        store.setState('editingChannelDirty', false);
        store.setState('navGuard', null);
    });

    function gotoElements(kind, metaDataId) {
        store.setState('editingChannel', channel);
        store.setState('editingChannelNew', isNew);
        router.navigate(`/channels/${channel.id}/${kind}/${metaDataId}`);
    }

    /* ---- save / deploy / export ------------------------------------------------ */

    // Channel tags: global ChannelTags that include this channel. Loaded lazily
    // by the Summary "Tags" field and persisted on save if membership changed.
    const tagState = { loaded: false, available: false, all: [], assigned: new Set(), initial: new Set() };
    async function ensureTags() {
        if (tagState.loaded) return tagState;
        try {
            const tags = await api.server.channelTags();
            tagState.all = tags.map(t => ({
                id: t.id, name: t.name, backgroundColor: t.backgroundColor,
                channelIds: api.asList(t.channelIds, 'string').map(String)
            }));
            for (const t of tagState.all) if (t.channelIds.includes(channel.id)) tagState.assigned.add(t.name);
            tagState.available = true;
        } catch { /* tags unavailable; can still create tags locally */ }
        // Restore any unsaved tag selection already written onto the channel, so
        // it survives an editor re-render (e.g. after editing a connector) before
        // the first save — the channel object itself lives on in the store.
        for (const ct of api.asList(channel.exportData && channel.exportData.channelTags, 'channelTag')) {
            if (!ct || !ct.name) continue;
            if (!tagState.all.some(t => t.name === ct.name)) {
                tagState.all.push({
                    id: ct.id || oie.uuid(), name: ct.name,
                    channelIds: api.asList(ct.channelIds, 'string').map(String),
                    backgroundColor: ct.backgroundColor
                });
            }
            tagState.assigned.add(String(ct.name));
        }
        tagState.initial = new Set(tagState.assigned);
        tagState.loaded = true;
        return tagState;
    }

    /* Write the assigned tags into the channel's exportData.channelTags. The
       engine's updateChannel() treats this list as the authoritative membership
       (DefaultChannelController.updateChannelTags): tags present get this channel
       added/created, tags absent get it removed. Doing it here — rather than a
       separate setChannelTags call — keeps every save idempotent, so a second
       save (e.g. Save then Deploy) can't detach the tag. */
    function applyTagsToChannel() {
        if (!tagState.available) return;   // membership unknown — don't disturb
        const channelTags = tagState.all
            .filter(t => tagState.assigned.has(t.name))
            .map(t => {
                const ids = new Set(t.channelIds);
                ids.add(channel.id);
                // '@version' first (array-nested; the engine's JSON→XML reorder
                // fallback doesn't descend into arrays).
                return { '@version': version, id: t.id, name: t.name, channelIds: { string: [...ids] }, backgroundColor: t.backgroundColor };
            });
        channel.exportData = channel.exportData || {};
        // List<ChannelTag>: {channelTag:[...]}; empty string = empty list (detach all).
        channel.exportData.channelTags = channelTags.length ? { channelTag: channelTags } : '';
        // Keep the local cache in sync so re-saves stay consistent.
        for (const t of tagState.all) {
            const ids = new Set(t.channelIds);
            if (tagState.assigned.has(t.name)) ids.add(channel.id); else ids.delete(channel.id);
            t.channelIds = [...ids];
        }
        tagState.initial = new Set(tagState.assigned);
    }

    async function save() {
        const problems = oie.validateChannel(channel);
        if (problems.length) {
            modal({
                title: 'Cannot Save Channel',
                body: h('div',
                    h('p', 'Fix the following before saving — the engine would reject this channel:'),
                    h('ul', { class: 'mt-2 mx-0 mb-0 pl-[18px]' }, problems.map(p => h('li', p)))),
                buttons: [{ label: 'OK' }]
            });
            return false;
        }
        try {
            // Reconcile tag membership into the channel itself so the PUT attaches
            // them (idempotent — survives a follow-up Deploy that re-saves).
            await ensureTags();
            applyTagsToChannel();
            if (isNew) {
                await api.channels.create(channel);
                isNew = false;
                store.setState('editingChannel', null);
                store.setState('editingChannelNew', false);
            } else {
                channel.revision = (Number(channel.revision) || 0) + 1;
                await api.channels.update(channel.id, channel);
            }
            store.setState('editingChannelDirty', false);
            refreshSaveVisibility();
            toast(`Saved ${channel.name}`);
            return true;
        } catch (e) {
            toast(e.message, 'error');
            return false;
        }
    }

    async function deploy() {
        // Match the Swing channel-view deploy (Frame.doDeployFromChannelView):
        // unsaved changes prompt to save-and-deploy; otherwise a plain confirm.
        if (isDirty()) {
            if (!await confirmDialog('Deploy Channel',
                'This channel will be saved before it is deployed. Are you sure you want to save and deploy this channel?',
                { okLabel: 'Save and Deploy' })) return;
            if (!await save()) return;
        } else if (!await confirmDialog('Deploy Channel', 'Are you sure you want to deploy this channel?', { okLabel: 'Deploy' })) {
            return;
        }
        try {
            await api.engine.deploy(channel.id);
            toast(`Deployed ${channel.name}`);
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    // Validate Connector (Swing channelEditPopupMenu) — structural well-formedness
    // of the channel/connectors (same check applied on save).
    function validateConnector() {
        const problems = oie.validateChannel(channel);
        if (!problems.length) { toast('Connector configuration is valid'); return; }
        modal({
            title: 'Validation Errors',
            body: h('div',
                h('p', 'The engine would reject this channel:'),
                h('ul', { class: 'mt-2 mx-0 mb-0 pl-[18px]' }, problems.map(p => h('li', p)))),
            buttons: [{ label: 'OK' }]
        });
    }

    // Validate Script (Swing) — real Rhino compile check of the four channel
    // scripts via the engine bridge.
    async function validateChannelScripts() {
        const list = [
            ['Deploy', channel.deployScript],
            ['Undeploy', channel.undeployScript],
            ['Preprocessor', channel.preprocessingScript],
            ['Postprocessor', channel.postprocessingScript]
        ];
        for (const [label, code] of list) {
            if (typeof code !== 'string' || !code.trim()) continue;
            const result = await validateScript(code);
            if (result.ok === null) { toast(result.message, 'warn'); return; }
            if (result.ok === false) { toast(`${label} script — ${result.message}`, 'error'); return; }
        }
        toast('Channel scripts validated successfully');
    }

    function exportChannel() {
        saveFile(`${channel.name || channel.id}.json`, 'application/json', () => JSON.stringify({ channel }, null, 2));
    }

    function backToChannels() { router.navigate('/channels'); }

    /* Debug deploy (classic DeployInDebugModeDialog). The REST endpoint
       POST /channels/{id}/_deploy accepts a debugOptions query param: seven
       comma-separated t/f flags in DebugOptions constructor order —
       deploy/undeploy/pre/postprocessor, attachment/batch, source connector,
       source filter/transformer, destination filter/transformer, destination
       connector, destination response transformer
       (DebuggerUtil.parseDebugOptions). */
    function openDebugDeployModal() {
        const options = [
            { label: 'Deploy/Undeploy/Preprocessor/Postprocessor scripts' },
            { label: 'Attachment/Batch scripts' },
            { label: 'Source connector scripts' },
            { label: 'Source filter/transformer' },
            { label: 'Destination filter/transformer' },
            { label: 'Destination connector scripts' },
            { label: 'Destination response transformer' }
        ];
        const state = options.map(() => false);
        modal({
            title: 'Debug Channel Deploy Options',
            body: h('div',
                h('div.hint', { class: 'mb-2.5' },
                    'Select the scripts to debug. The channel is saved, then deployed in debug mode with these options.'),
                h('div', { class: 'flex flex-col gap-1.5' },
                    options.map((opt, i) => checkbox(opt.label, false, {
                        onChange: (e) => { state[i] = e.target.checked; }
                    }).el))),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Debug Deploy', primary: true,
                    onClick: async () => {
                        if (!await save()) return false;
                        const debugOptions = state.map(on => on ? 't' : 'f').join(',');
                        try {
                            await api.post(`/channels/${channel.id}/_deploy`, null,
                                { params: { returnErrors: true, debugOptions } });
                            toast(`Deployed ${channel.name} in debug mode`);
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    // The destinations pane exposes its handlers/selection here so the React
    // connector-task buttons can drive them (classic ctx-tasks behavior).
    const destTasks = {};          // handlers exposed by renderDestinations()
    let activeTab = 'Summary';

    // Count the filter rules / transformer steps on a connector so the task
    // buttons can show a "(n)" indicator (Swing shows none; this surfaces that a
    // connector has steps without opening it). Returns 0 for a missing connector.
    function stepCount(connector, key) {
        const el = connector && connector[key];
        return el ? oie.elementsToArray(el.elements).length : 0;
    }
    const withCount = (label, n) => n > 0 ? `${label} (${n})` : label;

    /* ====================================================================== *
     *  Summary tab
     * ====================================================================== */

    function renderSummary() {
        const props = channel.properties = channel.properties || {};
        channel.exportData = channel.exportData || {};
        const metadata = channel.exportData.metadata = channel.exportData.metadata || { enabled: true };

        const root = h('div', { class: 'flex flex-col gap-3.5' },
            renderChannelProperties(props, metadata),
            // Storage and pruning side by side; wraps to one column when narrow.
            h('div', { class: 'grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] gap-3.5 items-start' },
                renderMessageStorage(props),
                renderPruning(metadata)),
            renderMetaDataColumns(props),
            renderDescription());
        // The flex gap replaces the global `.panel + .panel` spacing rule.
        root.querySelectorAll('.panel').forEach(p => { p.style.marginTop = '0'; });
        return root;
    }

    /* ---- channel properties (classic top-left fieldset) ------------------------ */

    function renderChannelProperties(props, metadata) {
        const ap = props.attachmentProperties = props.attachmentProperties ||
            { '@version': version, type: 'None', properties: null };

        /* Two-column key-indexed table (regex patterns / replacements). Rows are
           re-indexed on every commit, mirroring the Swing RegexAttachmentDialog
           which clears the map and rewrites keyA0/keyB0, keyA1/keyB1, ... */
        function pairTable(title, rows, colA, colB, commit, hint) {
            const host = h('div');
            function renderRows() {
                clear(host);
                const grid = h('div', { class: 'grid grid-cols-[minmax(160px,2fr)_minmax(120px,1fr)_70px] gap-y-1 gap-x-1.5 items-center' },
                    h('label', colA), h('label', colB), h('span'));
                for (const row of rows) {
                    grid.appendChild(textInput(row.a, {
                        spellcheck: 'false',
                        onInput: (e) => { row.a = e.target.value; commit(); }
                    }));
                    grid.appendChild(textInput(row.b, {
                        spellcheck: 'false',
                        onInput: (e) => { row.b = e.target.value; commit(); }
                    }));
                    grid.appendChild(h('button.btn.btn-sm', {
                        title: 'Remove row',
                        onClick: () => { rows.splice(rows.indexOf(row), 1); commit(); renderRows(); }
                    }, 'Delete'));
                }
                if (!rows.length) grid.appendChild(h('div.text-text-faint', { class: 'col-[1/-1]' }, 'No entries'));
                host.appendChild(grid);
            }
            renderRows();
            const addBtn = h('button.btn.btn-sm', {
                onClick: () => { rows.push({ a: '', b: '' }); commit(); renderRows(); }
            }, 'New');
            return h('div.field',
                h('div', { class: 'flex items-center justify-between gap-2.5' },
                    h('label', { class: 'm-0' }, title), addBtn),
                host,
                hint ? h('div.hint', hint) : null);
        }

        /* Classic RegexAttachmentDialog: patterns (regex.pattern0/regex.mimetype0,
           regex.pattern1/...; the legacy non-indexed regex.pattern/regex.mimetype
           pair is also honored) plus inbound (regex.replaceKey0/regex.replaceValue0)
           and outbound (outbound.regex.replaceKey0/outbound.regex.replaceValue0)
           replacement tables — key schemes verified against
           RegexAttachmentHandlerProvider.setProperties(). */
        function renderRegexEditor() {
            const map = entriesToObj(ap.properties);
            const consumed = new Set();
            const take = (key) => { consumed.add(key); return String(map[key] ?? ''); };
            const collect = (keyA, keyB) => {
                const rows = [];
                for (let i = 0; map[`${keyA}${i}`] !== undefined; i++) {
                    rows.push({ a: take(`${keyA}${i}`), b: take(`${keyB}${i}`) });
                }
                return rows;
            };
            const patterns = [];
            if (map['regex.pattern'] !== undefined) {
                patterns.push({ a: take('regex.pattern'), b: take('regex.mimetype') });
            }
            patterns.push(...collect('regex.pattern', 'regex.mimetype'));
            const inbound = collect('regex.replaceKey', 'regex.replaceValue');
            const outbound = collect('outbound.regex.replaceKey', 'outbound.regex.replaceValue');
            // Keys outside the regex schemes survive the rewrite untouched.
            const extras = {};
            for (const [k, v] of Object.entries(map)) if (!consumed.has(k)) extras[k] = v;

            function commit() {
                const next = { ...extras };
                patterns.forEach((r, i) => { next[`regex.pattern${i}`] = r.a; next[`regex.mimetype${i}`] = r.b; });
                inbound.forEach((r, i) => { next[`regex.replaceKey${i}`] = r.a; next[`regex.replaceValue${i}`] = r.b; });
                outbound.forEach((r, i) => { next[`outbound.regex.replaceKey${i}`] = r.a; next[`outbound.regex.replaceValue${i}`] = r.b; });
                ap.properties = objToEntries(next);
                markDirty();
            }

            return h('div',
                pairTable('Regular Expressions', patterns, 'Regular Expression', 'MIME Type', commit,
                    'Capturing group 1 of each expression is extracted as an attachment; a blank MIME type defaults to text/plain.'),
                pairTable('Inbound Replacements', inbound, 'Replace All', 'Replace With', commit,
                    'Applied to attachment content as it is extracted. Java string escape sequences (\\n, \\t, …) are unescaped by the server.'),
                pairTable('Outbound Replacements', outbound, 'Replace All', 'Replace With', commit,
                    'Applied when attachments are re-attached to outbound messages.'));
        }

        /* IdentityAttachmentHandlerProvider reads a single identity.mimetype key. */
        function renderIdentityEditor() {
            const map = entriesToObj(ap.properties);
            return field('Attachment MIME Type', textInput(String(map['identity.mimetype'] ?? ''), {
                class: 'max-w-[260px]',
                placeholder: 'text/plain',
                onInput: (e) => {
                    map['identity.mimetype'] = e.target.value;
                    ap.properties = objToEntries(map);
                    markDirty();
                }
            }), 'The entire message is stored as a single attachment with this MIME type.');
        }

        /* Unknown plugin handler types: raw key/value map editor (classic
           CustomAttachmentDialog behavior). */
        function renderCustomEditor() {
            const map = entriesToObj(ap.properties);
            const rows = Object.entries(map).map(([k, v]) => ({ a: k, b: String(v ?? '') }));
            function commit() {
                const next = {};
                for (const row of rows) if (row.a !== '') next[row.a] = row.b;
                ap.properties = objToEntries(next);
                markDirty();
            }
            return pairTable('Attachment Handler Properties', rows, 'Property', 'Value', commit,
                `Raw property map for the "${ap.type}" attachment handler.`);
        }

        // Editor body for the attachment Properties modal (per handler type).
        // Returns { body, editor } so the modal can dispose a code editor on close.
        function attachmentEditor() {
            if (ap.type === 'JavaScript') {
                const map = entriesToObj(ap.properties);
                if (map['javascript.script'] === undefined) map['javascript.script'] = DEFAULT_ATTACHMENT_SCRIPT;
                const editor = createCodeEditor({
                    value: String(map['javascript.script'] ?? ''),
                    minHeight: '240px',
                    onChange: (value) => {
                        map['javascript.script'] = value;      // unknown keys in `map` survive
                        ap.properties = objToEntries(map);
                        markDirty();
                    }
                });
                return { body: field('Attachment Script', editor.el), editor };
            }
            if (ap.type === 'Regex') return { body: renderRegexEditor() };
            if (ap.type === 'Entire Message') return { body: renderIdentityEditor() };
            if (ap.type && ap.type !== 'None' && ap.type !== 'DICOM' &&
                !ATTACHMENT_TYPES.some(t => t.value === ap.type)) return { body: renderCustomEditor() };
            return { body: h('div.text-text-faint', 'This attachment handler has no configurable properties.') };
        }

        // A plugin-contributed type already on the channel stays selectable.
        const typeOptions = ATTACHMENT_TYPES.slice();
        if (ap.type && !typeOptions.some(t => t.value === ap.type)) {
            typeOptions.unshift({ value: ap.type, label: `${ap.type} (custom)`, className: ap.className });
        }

        const typeSelect = select(typeOptions, ap.type || 'None', {
            class: 'w-[180px]',
            onChange: (e) => {
                const def = typeOptions.find(t => t.value === e.target.value);
                ap.type = def.value;
                if (def.className) ap.className = def.className;
                else delete ap.className;
                if (def.value === 'Regex') {
                    ap.properties = objToEntries({ 'regex.pattern0': '', 'regex.mimetype0': '' });
                } else if (def.value === 'JavaScript') {
                    ap.properties = objToEntries({ 'javascript.script': DEFAULT_ATTACHMENT_SCRIPT });
                } else if (def.value === 'Entire Message') {
                    ap.properties = objToEntries({ 'identity.mimetype': '' });
                } else {
                    ap.properties = null;
                }
                markDirty();
                updateAttachmentUI();
            }
        });

        // "Properties" button opens the handler editor in a modal (enabled only
        // when a handler other than None/DICOM is selected, matching Swing).
        const propsBtn = taskButton('Properties', null, () => {
            const { body, editor } = attachmentEditor();
            modal({
                title: 'Set Attachment Handler',
                body,
                buttons: [{ label: 'Close', primary: true }],
                // Dispose the code editor (when present) on any close path; guarded
                // because the plain-textarea baseline has no dispose().
                onClose: () => { try { editor && editor.dispose && editor.dispose(); } catch { /* baseline no-op */ } }
            });
        });
        propsBtn.classList.add('btn-sm');
        const attachWarn = h('div', { class: 'text-[#d00] text-[11px] mt-0.5 mx-0 mb-0' });
        const storeBox = checkbox('Store Attachments', !!props.storeAttachments, {
            onChange: (e) => { props.storeAttachments = e.target.checked; markDirty(); updateAttachmentUI(); }
        });
        function updateAttachmentUI() {
            propsBtn.disabled = ap.type === 'None' || ap.type === 'DICOM';
            attachWarn.textContent = (ap.type !== 'None' && !props.storeAttachments)
                ? 'Attachments will be extracted but not stored or reattached.' : '';
        }
        updateAttachmentUI();

        // Tags: assign/unassign existing global channel tags for this channel.
        const tagsHost = h('div');
        const dlId = 'channel-tags-list';
        function renderTags() {
            clear(tagsHost);
            const row = h('div', { class: 'flex flex-wrap gap-[5px] items-center' });
            for (const name of [...tagState.assigned].sort((a, b) => a.localeCompare(b))) {
                const tag = tagState.all.find(t => t.name === name);
                row.appendChild(h('span', {
                    class: 'inline-flex items-center gap-1 py-px px-1.5 rounded-[10px] border border-line text-[11.5px]',
                    style: { background: tagChipBg(tag && tag.backgroundColor) }
                }, name, h('span', {
                    class: 'cursor-pointer text-text-dim',
                    title: 'Remove tag',
                    onClick: () => { tagState.assigned.delete(name); applyTagsToChannel(); markDirty(); renderTags(); }
                }, '✕')));
            }
            const input = h('input', { list: dlId, placeholder: 'Add tag…', class: 'w-[130px]' });
            const dl = h('datalist', { id: dlId },
                tagState.all.filter(t => !tagState.assigned.has(t.name)).map(t => h('option', { value: t.name })));
            // Mirror ChannelTag.fixName: strip disallowed chars, cap at 24.
            const fixTagName = (n) => String(n).replace(/[^a-zA-Z_0-9\-\s]/g, '').slice(0, 24).trim();
            input.addEventListener('change', () => {
                const name = fixTagName(input.value);
                input.value = '';
                if (!name || tagState.assigned.has(name)) return;
                // Create the tag if it doesn't exist yet (Swing tag field allows
                // creating tags; new tags default to lightGray like ChannelTag).
                if (!tagState.all.some(t => t.name === name)) {
                    tagState.all.push({ id: oie.uuid(), name, channelIds: [], backgroundColor: randomTagColor() });
                }
                tagState.assigned.add(name); applyTagsToChannel(); markDirty(); renderTags();
            });
            row.append(input, dl);
            tagsHost.appendChild(row);
        }
        // Only render the field once tags have loaded, so a tag added during the
        // load window can't be lost when ensureTags() populates tagState.
        tagsHost.appendChild(h('span.text-text-faint', { class: 'text-[11.5px]' }, 'Loading tags…'));
        ensureTags().then(renderTags);

        const nameInput = textInput(channel.name ?? '', {
            class: 'max-w-[360px]',
            onInput: (e) => { channel.name = e.target.value; markDirty(); }
        });
        // New channel: focus the empty Name field so the user can type immediately.
        if (isNew) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);

        const left = h('div',
            field('Name', nameInput),
            h('div.form-row', { class: 'mb-3' },
                field('Initial State', select(
                    INITIAL_STATES.map(s => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })),
                    props.initialState || 'STARTED', {
                    class: 'w-[170px]',
                    onChange: (e) => { props.initialState = e.target.value; markDirty(); }
                })),
                field('Attachment', h('div', { class: 'flex gap-1.5 items-center' }, typeSelect, propsBtn))),
            field('Tags', tagsHost),
            h('div', { class: 'flex flex-wrap gap-y-1.5 gap-x-[18px] mt-0 mx-0 mb-1' },
                checkbox('Enabled', metadata.enabled !== false, {
                    onChange: (e) => { metadata.enabled = e.target.checked; markDirty(); }
                }).el,
                checkbox('Clear global channel map on deploy', !!props.clearGlobalChannelMap, {
                    onChange: (e) => { props.clearGlobalChannelMap = e.target.checked; markDirty(); }
                }).el,
                storeBox.el),
            attachWarn,
            h('div', { class: 'flex flex-wrap gap-2 mt-3' },
                taskButton('Set Data Types', 'transform', openDataTypesModal),
                taskButton('Set Dependencies', 'link', openDependenciesModal)));

        // Read-only identity comes from the loaded channel itself; the metadata
        // object normalized in renderSummary() holds lastModified (a Calendar —
        // {time, timezone} — which fmtDate() understands).
        const right = h('div', h('dl.kv',
            h('dt', 'Id'), h('dd', channel.id ?? ''),
            h('dt', 'Revision'), h('dd', String(channel.revision ?? 0)),
            h('dt', 'Last Modified'), h('dd', fmtDate(metadata.lastModified) || '—')));

        return h('div.panel',
            h('div.panel-header', 'Channel Properties'),
            h('div.panel-body', h('div', {
                class: 'grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-y-0 gap-x-7 items-start'
            }, left, right)));
    }

    /* ---- Set Data Types modal ----------------------------------------------------
     * Mirror of the Swing DataTypesDialog: a connector table (source + each
     * destination) with inbound/outbound type selects, and grouped property
     * panels for the selected row. All edits go to deep-copied drafts and are
     * committed back onto the transformers on OK; Cancel/Escape discards.
     * Schemas come from client/datatypes/index.js; all property groups are
     * rendered for both sides — the engine ignores groups that don't apply.
     */

    function openDataTypesModal() {
        const clone = (obj) => obj == null ? null : JSON.parse(JSON.stringify(obj));
        const dtOptions = dataTypeList().map(dt => ({ value: dt.name, label: dt.label }));

        channel.sourceConnector.transformer =
            channel.sourceConnector.transformer || oie.emptyTransformer(version);
        const rows = [{ label: 'Source Connector', transformer: channel.sourceConnector.transformer }];
        for (const dest of oie.destinationsOf(channel)) {
            dest.transformer = dest.transformer || oie.emptyTransformer(version);
            rows.push({ label: dest.name || `Destination ${dest.metaDataId}`, transformer: dest.transformer });
        }
        for (const row of rows) {
            row.draft = {
                inboundDataType: row.transformer.inboundDataType || 'RAW',
                outboundDataType: row.transformer.outboundDataType || 'RAW',
                inboundProperties: clone(row.transformer.inboundProperties),
                outboundProperties: clone(row.transformer.outboundProperties)
            };
        }

        let selected = rows[0];
        const dtLabelOf = (name) => (dtOptions.find(o => o.value === name) || { label: name }).label;

        // Bulk Edit (Swing DataTypesDialog "Bulk Edit" radio): check connectors,
        // pick one inbound/outbound data type in the shared panels, and apply to
        // all checked connectors at once. `bulkRow` is the shared draft the panels
        // edit; `bulkSel` is the set of target rows.
        let bulkMode = false;
        const bulkSel = new Set(rows);
        const applySides = { inbound: true, outbound: true };
        const bulkRow = {
            label: 'Selected connectors',
            draft: {
                inboundDataType: rows[0].draft.inboundDataType,
                outboundDataType: rows[0].draft.outboundDataType,
                inboundProperties: clone(rows[0].draft.inboundProperties),
                outboundProperties: clone(rows[0].draft.outboundProperties)
            }
        };

        const tableHost = h('div');
        const panelsHost = h('div', {
            class: 'grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3.5 mt-3.5 items-start'
        });
        // Teardowns for the mounted <DataTypePropertiesEditor> React roots;
        // unmounted on each rebuild (renderPanels) and on dialog close.
        const dtEditorRoots = [];
        const clearDtEditors = () => { dtEditorRoots.forEach(t => { try { t(); } catch { /* ignore */ } }); dtEditorRoots.length = 0; };

        function setType(row, side, name) {
            if (row.draft[`${side}DataType`] === name) return;
            const def = dataTypeDef(name);
            const freshProps = () => def ? def.defaults(version) : { '@version': version };
            row.draft[`${side}DataType`] = name;
            row.draft[`${side}Properties`] = freshProps();
            // Swing DataTypesDialog.updateSingleDataType: a destination's inbound
            // data type IS the source's outbound, so changing the SOURCE outbound
            // type also sets every destination's inbound type + default properties.
            if (side === 'outbound' && row === rows[0]) {
                for (let i = 1; i < rows.length; i++) {
                    rows[i].draft.inboundDataType = name;
                    rows[i].draft.inboundProperties = freshProps();
                }
            }
            renderAll();
        }

        /* ---- connector table ---- */

        function typeCell(row, side) {
            const sel = select(dtOptions, row.draft[`${side}DataType`], {
                onChange: (e) => { selected = row; setType(row, side, e.target.value); }
            });
            sel.addEventListener('click', (e) => e.stopPropagation());
            return sel;
        }

        function renderTable() {
            clear(tableHost);
            const tbody = h('tbody');
            for (const row of rows) {
                if (bulkMode) {
                    // Checkbox to include this connector; type columns are read-only here.
                    const cb = checkbox('', bulkSel.has(row), {
                        onChange: (e) => { e.target.checked ? bulkSel.add(row) : bulkSel.delete(row); }
                    });
                    tbody.appendChild(h('tr',
                        h('td', { class: 'w-[36px]' }, cb.el),
                        h('td', row.label),
                        h('td.text-text-faint', dtLabelOf(row.draft.inboundDataType)),
                        h('td.text-text-faint', dtLabelOf(row.draft.outboundDataType))));
                } else {
                    const tr = h('tr', { class: row === selected ? 'selected cursor-pointer' : 'cursor-pointer' },
                        h('td', row.label),
                        h('td', typeCell(row, 'inbound')),
                        h('td', typeCell(row, 'outbound')));
                    tr.addEventListener('click', () => {
                        if (selected !== row) { selected = row; renderAll(); }
                    });
                    tbody.appendChild(tr);
                }
            }
            const headCells = [
                h('th', { class: 'w-[40%]' }, 'Connector'),
                h('th', 'Inbound'), h('th', 'Outbound')
            ];
            if (bulkMode) headCells.unshift(h('th', ''));
            tableHost.appendChild(h('table.dt', h('thead', h('tr', headCells)), tbody));
        }

        function buildPanel(side, title, row = selected) {
            const typeName = row.draft[`${side}DataType`];
            const def = dataTypeDef(typeName);
            if (def && (!row.draft[`${side}Properties`] || typeof row.draft[`${side}Properties`] !== 'object')) {
                row.draft[`${side}Properties`] = def.defaults(version);
            }

            const restoreBtn = h('button.btn.btn-sm', {
                disabled: !def,
                title: 'Reset every property of this data type to its default value',
                onClick: () => {
                    row.draft[`${side}Properties`] = def.defaults(version);
                    renderAll();
                }
            }, 'Restore Defaults');

            const head = h('div', { class: 'flex items-end gap-2.5 mb-1' },
                field('Data Type', select(dtOptions, typeName, {
                    onChange: (e) => setType(row, side, e.target.value)
                })),
                h('div', { class: 'pb-3' }, restoreBtn));

            const editorHost = h('div');
            dtEditorRoots.push(mountReact(editorHost, <DataTypePropertiesEditor
                typeName={typeName}
                props={row.draft[`${side}Properties`]}
                version={version}
                direction={side}
                connectorType={row.label === 'Source Connector' ? 'SOURCE' : 'DESTINATION'}
                onReplace={(obj) => { row.draft[`${side}Properties`] = obj; }} />));
            return h('div.panel', { class: 'mt-0' },
                h('div.panel-header', `${title} — ${row.label}`),
                h('div.panel-body', head, editorHost));
        }

        function renderPanels() {
            clearDtEditors();
            clear(panelsHost);
            if (bulkMode) {
                // Side toggles + an explicit apply button operating on the bulk draft.
                const sideToggle = (side, lbl) => checkbox(lbl, applySides[side], {
                    onChange: (e) => { applySides[side] = e.target.checked; }
                }).el;
                const applyBtn = h('button.btn.btn-primary', {
                    onClick: () => {
                        const targets = rows.filter(r => bulkSel.has(r));
                        if (!targets.length) { toast('Select at least one connector', 'warn'); return; }
                        if (!applySides.inbound && !applySides.outbound) { toast('Choose Inbound and/or Outbound to apply', 'warn'); return; }
                        for (const r of targets) {
                            if (applySides.inbound) {
                                r.draft.inboundDataType = bulkRow.draft.inboundDataType;
                                r.draft.inboundProperties = clone(bulkRow.draft.inboundProperties);
                            }
                            if (applySides.outbound) {
                                r.draft.outboundDataType = bulkRow.draft.outboundDataType;
                                r.draft.outboundProperties = clone(bulkRow.draft.outboundProperties);
                            }
                        }
                        toast(`Applied to ${targets.length} connector${targets.length === 1 ? '' : 's'}`);
                        renderAll();
                    }
                }, 'Apply to Selected Connectors');
                panelsHost.appendChild(h('div', { class: 'col-[1/-1] flex gap-4 items-center' },
                    h('span.text-text-faint', { class: 'text-[11px] uppercase tracking-[0.08em]' }, 'Apply:'),
                    sideToggle('inbound', 'Inbound'), sideToggle('outbound', 'Outbound'), applyBtn));
                panelsHost.appendChild(buildPanel('inbound', 'Inbound Properties', bulkRow));
                panelsHost.appendChild(buildPanel('outbound', 'Outbound Properties', bulkRow));
            } else {
                panelsHost.appendChild(buildPanel('inbound', 'Inbound Properties'));
                panelsHost.appendChild(buildPanel('outbound', 'Outbound Properties'));
            }
        }

        const editModeName = 'dt-edit-mode';
        function modeRadio(label, isBulk) {
            const input = h('input', { type: 'radio', name: editModeName, checked: bulkMode === isBulk,
                onChange: () => { if (input.checked) { bulkMode = isBulk; renderAll(); } } });
            return h('label.check', input, label);
        }
        const modeBar = h('div', { class: 'flex gap-[18px] items-center mb-2.5' },
            h('span.text-text-faint', { class: 'text-[11px] uppercase tracking-[0.08em]' }, 'Editing:'),
            modeRadio('Single Edit', false),
            modeRadio('Bulk Edit', true));

        function renderAll() { renderTable(); renderPanels(); }
        renderAll();

        modal({
            title: 'Set Data Types',
            size: 'xwide',
            onClose: clearDtEditors,
            body: h('div',
                modeBar,
                h('div.panel', { class: 'mt-0' }, h('div.panel-body.flush', tableHost)),
                panelsHost,
                h('div.hint', { class: 'mt-2.5' },
                    'All property groups are shown for each data type; the engine ignores groups that do not apply to a side (e.g. response generation on an outbound type).')),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'OK', primary: true,
                    onClick: () => {
                        for (const row of rows) Object.assign(row.transformer, row.draft);
                        markDirty();
                    }
                }
            ]
        });
    }

    /* ---- Set Dependencies modal ---------------------------------------------------
     * Mirror of the Swing ChannelDependenciesDialog (Channel Dependencies):
     * three tabs — Code Template Libraries, Library Resources, Deploy/Start
     * Dependencies. Apply semantics match the classic dialog: on OK the
     * dependency set and any code template library changes are PUT to the
     * server immediately, while the resource selection only mutates the
     * in-memory channel (channel.properties.resourceIds) and is persisted by
     * Save Changes.
     *
     * ChannelDependency (com.mirth.connect.model.ChannelDependency) holds
     * { dependentId, dependencyId }: the dependent channel deploys/starts
     * after the dependency channel.
     */

    async function openDependenciesModal() {
        const idSet = (value) => api.asList(value, 'string').map(String);
        const props = channel.properties = channel.properties || {};

        let idsAndNames, deps, libraries, resourcesRaw;
        try {
            [idsAndNames, deps, libraries, resourcesRaw] = await Promise.all([
                api.channels.idsAndNames(),
                api.server.channelDependencies(),
                api.codeTemplates.libraries(true),
                api.server.resources()
            ]);
        } catch (e) {
            toast(`Could not load dependencies: ${e.message}`, 'error');
            return;
        }

        /* ---- shared link/tree helpers ---- */

        const link = (label, onClick) => {
            const a = h('a', { href: '#', class: 'text-accent underline cursor-pointer text-[12px] whitespace-nowrap' }, label);
            a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
            return a;
        };
        const linkSep = () => h('span.text-text-faint', { class: 'text-[12px]' }, '|');
        const treeBox = () => h('div', { class: 'flex-1 min-h-[110px] overflow-auto border border-line rounded-[4px] bg-bg1' });
        const SEL_BG = 'color-mix(in srgb, var(--accent) 16%, transparent)';

        /* ===== Tab 1: Code Template Libraries (CodeTemplateLibrariesPanel) ===== */

        const libChecked = new Map(libraries.map(lib => [lib.id,
            idSet(lib.enabledChannelIds).includes(channel.id) ||
            (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(channel.id))]));
        const libInitial = new Map(libChecked);
        const libExpanded = new Set();

        function renderLibrariesTab() {
            const tree = treeBox();
            const desc = h('div', { class: 'h-[88px] overflow-auto border border-line rounded-[4px] py-1.5 px-2 text-[11.5px] text-text-dim bg-bg1' });
            const setDesc = (t) => { clear(desc); desc.appendChild(h('span', { class: 'italic' }, t && String(t).trim() ? String(t) : 'No description.')); };
            setDesc('');
            function draw() {
                clear(tree);
                if (!libraries.length) { tree.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'No code template libraries')); return; }
                for (const lib of libraries) {
                    const templates = api.asList(lib.codeTemplates, 'codeTemplate').filter(t => t && typeof t === 'object');
                    const open = libExpanded.has(lib.id);
                    const tw = h('span', { class: 'w-[14px] text-center text-text-dim select-none', style: { cursor: templates.length ? 'pointer' : 'default' } }, templates.length ? (open ? '▾' : '▸') : '');
                    if (templates.length) tw.addEventListener('click', () => { open ? libExpanded.delete(lib.id) : libExpanded.add(lib.id); draw(); });
                    const box = h('input', { type: 'checkbox' });
                    box.checked = !!libChecked.get(lib.id);
                    box.addEventListener('change', () => libChecked.set(lib.id, box.checked));
                    const name = h('span', { class: 'cursor-pointer' }, lib.name || '(unnamed library)');
                    name.addEventListener('click', () => setDesc(lib.description));
                    tree.appendChild(h('div', { class: 'flex items-center gap-1 py-0.5 px-2' }, tw, box, name));
                    if (open) for (const t of templates) {
                        const row = h('div', { class: 'pt-0.5 pr-2 pb-0.5 pl-[44px] cursor-pointer text-[12px]' }, t.name || '(unnamed)');
                        row.addEventListener('click', () => setDesc((t.properties && t.properties.description) || t.description));
                        tree.appendChild(row);
                    }
                }
            }
            draw();
            const bar = h('div', { class: 'flex justify-between mb-1.5' },
                h('div', { class: 'flex gap-1.5 items-center' },
                    link('Select All', () => { libraries.forEach(l => libChecked.set(l.id, true)); draw(); }), linkSep(),
                    link('Deselect All', () => { libraries.forEach(l => libChecked.set(l.id, false)); draw(); })),
                h('div', { class: 'flex gap-1.5 items-center' },
                    link('Expand All', () => { libraries.forEach(l => libExpanded.add(l.id)); draw(); }), linkSep(),
                    link('Collapse All', () => { libExpanded.clear(); draw(); })));
            return h('div', { class: 'flex flex-col h-full' }, bar, tree, h('div', { class: 'h-1.5' }), desc);
        }

        /* ===== Tab 2: Library Resources (LibraryResourcesPanel) ===== */

        const resources = [];   // listed library resources { id, name, type } (Default Resource not listed)
        {
            const seen = new Set();
            const listObj = resourcesRaw && typeof resourcesRaw === 'object'
                ? (typeof resourcesRaw.list === 'object' ? resourcesRaw.list : resourcesRaw) : null;
            if (listObj) for (const [k, v] of Object.entries(listObj)) {
                if (k.startsWith('@')) continue;
                for (const item of api.asList(v)) {
                    if (item && typeof item === 'object' && item.id && item.name &&
                        String(item.id) !== 'Default Resource' && !seen.has(String(item.id))) {
                        seen.add(String(item.id));
                        resources.push({ id: String(item.id), name: String(item.name), type: String(item.type ?? '') });
                    }
                }
            }
            resources.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Contexts: Channel Scripts (channel props), Source (0), each destination.
        const src = channel.sourceConnector || {};
        const srcProps = (src.properties && src.properties.sourceConnectorProperties) || null;
        const resourceTargets = [
            { key: 'null', label: 'Channel Scripts', leaves: ['Deploy Script', 'Undeploy Script', 'Preprocessor Script', 'Postprocessor Script', 'Attachment Script', 'Batch Script'], holder: () => props },
            { key: '0', label: 'Source Connector' + (src.transportName ? ` (${src.transportName})` : ''), leaves: ['Receiver', 'Filter / Transformer Script'], holder: () => srcProps }
        ];
        for (const d of oie.destinationsOf(channel)) {
            const dp = (d.properties && d.properties.destinationConnectorProperties) || null;
            resourceTargets.push({ key: String(d.metaDataId), label: (d.name || `Destination ${d.metaDataId}`) + (d.transportName ? ` (${d.transportName})` : ''), leaves: ['Filter / Transformer Script', 'Dispatcher', 'Response Transformer Script'], holder: () => dp });
        }
        const ctxMaps = new Map();   // key -> { resourceId: resourceName } (full map, incl. Default Resource)
        for (const t of resourceTargets) { const hd = t.holder(); ctxMaps.set(t.key, entriesToObj(hd && hd.resourceIds)); }

        function renderResourcesTab() {
            let selectedKey = 'channel';   // 'channel' root = aggregate; or a context key; or a leaf key
            const ctxExpanded = new Set();
            const ctxTree = treeBox();
            const resTable = h('div', { class: 'flex-1 overflow-auto border border-line rounded-[4px] bg-bg1' });
            const isCtxKey = (k) => k === 'channel' || resourceTargets.some(t => t.key === k);
            const aggState = (id) => {
                let all = true, none = true;
                for (const t of resourceTargets) { if (ctxMaps.get(t.key)[id]) none = false; else all = false; }
                return all ? true : none ? false : null;
            };
            function drawTable() {
                clear(resTable);
                const isRoot = selectedKey === 'channel';
                const enabled = isCtxKey(selectedKey);
                resTable.appendChild(h('div', { class: 'grid grid-cols-[24px_1fr_120px] gap-1 py-1 px-2 font-semibold text-[11px] border-b border-line sticky top-0 bg-bg1' }, h('span'), h('span', 'Name'), h('span', 'Type')));
                if (!resources.length) { resTable.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'No library resources')); return; }
                for (const r of resources) {
                    const box = h('input', { type: 'checkbox', disabled: !enabled });
                    if (isRoot) { const st = aggState(r.id); box.checked = st === true; box.indeterminate = st === null; }
                    else if (enabled) box.checked = !!ctxMaps.get(selectedKey)[r.id];
                    box.addEventListener('change', () => {
                        const apply = (key) => { if (box.checked) ctxMaps.get(key)[r.id] = r.name; else delete ctxMaps.get(key)[r.id]; };
                        if (isRoot) resourceTargets.forEach(t => apply(t.key)); else apply(selectedKey);
                        drawTable();
                    });
                    resTable.appendChild(h('div', { class: 'grid grid-cols-[24px_1fr_120px] gap-1 py-[3px] px-2 items-center' }, box, h('span.truncate', r.name), h('span.text-text-faint', { class: 'text-[11px]' }, r.type)));
                }
            }
            function drawTree() {
                clear(ctxTree);
                const node = (label, key, depth, opts = {}) => {
                    const row = h('div', { class: 'flex items-center gap-1 text-[12px] cursor-pointer', style: { padding: `3px 8px 3px ${8 + depth * 16}px`, color: opts.grey ? 'var(--text-dim)' : 'inherit', background: key === selectedKey ? SEL_BG : 'transparent' } }, opts.twisty || h('span', { class: 'w-[12px]' }), h('span', label));
                    row.addEventListener('click', () => { selectedKey = key; drawTree(); drawTable(); });
                    ctxTree.appendChild(row);
                };
                node('Channel', 'channel', 0);
                for (const t of resourceTargets) {
                    const open = ctxExpanded.has(t.key);
                    const tw = h('span', { class: 'w-[12px] cursor-pointer text-text-dim select-none' }, t.leaves.length ? (open ? '▾' : '▸') : '');
                    tw.addEventListener('click', (e) => { e.stopPropagation(); open ? ctxExpanded.delete(t.key) : ctxExpanded.add(t.key); drawTree(); });
                    node(t.label, t.key, 1, { twisty: tw });
                    if (open) for (const leaf of t.leaves) node(leaf, `${t.key}::${leaf}`, 2, { grey: true });
                }
            }
            drawTree();
            drawTable();
            return h('div', { class: 'flex flex-col h-full gap-1.5' },
                h('div', { class: 'flex-[1.1] flex flex-col min-h-0' }, ctxTree),
                h('div', { class: 'flex-1 flex flex-col min-h-0' }, resTable));
        }

        /* ===== Tab 3: Deploy/Start Dependencies (ChannelDependenciesPanel) ===== */

        const channelNames = new Map();
        for (const en of api.asList(idsAndNames && idsAndNames.entry)) {
            const pair = api.asList(en && en.string);
            if (pair.length) channelNames.set(String(pair[0]), String(pair[1] ?? pair[0]));
        }
        channelNames.set(channel.id, channel.name || channel.id);
        const channelNameOf = (id) => channelNames.get(id) || id;
        const otherChannelsAll = [...channelNames.entries()].filter(([id]) => id !== channel.id)
            .map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

        let dependencies = deps.map(d => ({ dependentId: String(d.dependentId), dependencyId: String(d.dependencyId) }));
        const depKey = (d) => `${d.dependentId}|${d.dependencyId}`;
        const initialDepKeys = new Set(dependencies.map(depKey));
        const directDeps = (id) => dependencies.filter(d => d.dependentId === id).map(d => d.dependencyId);
        const directDependents = (id) => dependencies.filter(d => d.dependencyId === id).map(d => d.dependentId);
        function dependsOn(a, b, seen = new Set()) {   // does a transitively depend on b?
            if (seen.has(a)) return false; seen.add(a);
            return directDeps(a).some(dep => dep === b || dependsOn(dep, b, seen));
        }

        function openAddDialog(kind, allowed, onAdd) {
            const checks = new Map();
            const listEl = h('div', { class: 'max-h-[220px] overflow-auto border border-line rounded-[4px] py-1.5 px-2' });
            function drawList() {
                clear(listEl);
                if (!allowed.length) { listEl.appendChild(h('div.text-text-faint', 'No channels available')); return; }
                for (const c of allowed) {
                    const box = h('input', { type: 'checkbox' }); box.checked = !!checks.get(c.id);
                    box.addEventListener('change', () => checks.set(c.id, box.checked));
                    listEl.appendChild(h('label.check', { class: 'flex gap-1.5 py-0.5 px-0 items-center' }, box, c.name));
                }
            }
            drawList();
            modal({
                title: kind === 'dependency' ? 'Add Dependency' : 'Add Dependent',
                body: h('div',
                    h('div', { class: 'mb-1.5' }, kind === 'dependency' ? 'Select the dependency channel(s) to add.' : 'Select the dependent channel(s) to add.'),
                    h('div', { class: 'flex gap-1.5 justify-end mb-1' },
                        link('Select All', () => { allowed.forEach(c => checks.set(c.id, true)); drawList(); }), linkSep(),
                        link('Deselect All', () => { checks.clear(); drawList(); })),
                    listEl),
                buttons: [
                    { label: 'Cancel' },
                    { label: 'OK', primary: true, onClick: () => {
                        const sel = allowed.filter(c => checks.get(c.id)).map(c => c.id);
                        if (!sel.length) { toast(kind === 'dependency' ? 'You must select at least one dependency channel.' : 'You must select at least one dependent channel.', 'warn'); return false; }
                        onAdd(sel);
                    } }
                ]
            });
        }

        function depSection(title, kind) {
            let selected = null;
            const expanded = new Set();
            const tree = treeBox();
            const childrenOf = (id) => kind === 'dependency' ? directDeps(id) : directDependents(id);
            const allowed = () => otherChannelsAll.filter(c => kind === 'dependency'
                ? !directDeps(channel.id).includes(c.id) && !dependsOn(c.id, channel.id)
                : !directDependents(channel.id).includes(c.id) && !dependsOn(channel.id, c.id));
            const removeBtn = taskButton('Remove', 'trash', doRemove, { danger: true });
            const addBtn = taskButton('Add', 'plus', () => openAddDialog(kind, allowed(), (ids) => {
                for (const id of ids) dependencies.push(kind === 'dependency'
                    ? { dependentId: channel.id, dependencyId: id }
                    : { dependentId: id, dependencyId: channel.id });
                draw();
            }));
            function drawNode(id, depth, path) {
                const kids = childrenOf(id);
                const key = path + id;
                const isTop = depth === 0;
                const open = expanded.has(key);
                const tw = h('span', { class: 'w-[12px] text-text-dim select-none', style: { cursor: kids.length ? 'pointer' : 'default' } }, kids.length ? (open ? '▾' : '▸') : '');
                if (kids.length) tw.addEventListener('click', (e) => { e.stopPropagation(); open ? expanded.delete(key) : expanded.add(key); draw(); });
                const row = h('div', { class: 'flex items-center gap-1 text-[12px]', style: { padding: `3px 8px 3px ${8 + depth * 16}px`, cursor: isTop ? 'pointer' : 'default', color: isTop ? 'inherit' : 'var(--text-dim)', background: (isTop && selected === id) ? SEL_BG : 'transparent' } }, tw, h('span', channelNameOf(id)));
                if (isTop) row.addEventListener('click', () => { selected = id; draw(); });
                tree.appendChild(row);
                if (open && !path.includes('>' + id + '>')) for (const k of kids) drawNode(k, depth + 1, key + '>');
            }
            function draw() {
                clear(tree);
                const top = childrenOf(channel.id).slice().sort((a, b) => channelNameOf(a).localeCompare(channelNameOf(b)));
                if (!top.length) tree.appendChild(h('div.text-text-faint', { class: 'p-2.5' }, 'None'));
                else for (const id of top) drawNode(id, 0, '>');
                if (!top.includes(selected)) selected = null;
                removeBtn.disabled = !selected;
                addBtn.disabled = !allowed().length;
            }
            function doRemove() {
                if (!selected) return;
                dependencies = dependencies.filter(d => kind === 'dependency'
                    ? !(d.dependentId === channel.id && d.dependencyId === selected)
                    : !(d.dependencyId === channel.id && d.dependentId === selected));
                selected = null; draw();
            }
            function collectPaths() {
                const out = [];
                const walk = (id, path) => { const key = path + id; if (childrenOf(id).length && !path.includes('>' + id + '>')) { out.push(key); for (const k of childrenOf(id)) walk(k, key + '>'); } };
                for (const id of childrenOf(channel.id)) walk(id, '>');
                return out;
            }
            draw();
            return h('div', { class: 'flex flex-col min-h-0 flex-1' },
                h('div', { class: 'flex justify-between items-center mb-1' },
                    h('label', { class: 'font-semibold text-[12px]' }, title),
                    h('div', { class: 'flex gap-1.5 items-center' },
                        link('Expand All', () => { collectPaths().forEach(p => expanded.add(p)); draw(); }), linkSep(),
                        link('Collapse All', () => { expanded.clear(); draw(); }))),
                h('div', { class: 'flex gap-1.5 min-h-0 flex-1' },
                    tree, h('div', { class: 'flex flex-col gap-1' }, addBtn, removeBtn)));
        }

        function renderDependenciesTab() {
            return h('div', { class: 'flex flex-col gap-3 h-full' },
                depSection('This channel depends upon:', 'dependency'),
                depSection('This channel is depended upon by:', 'dependent'));
        }

        const tabbed = tabs([
            { label: 'Code Template Libraries', render: renderLibrariesTab },
            { label: 'Library Resources', render: renderResourcesTab },
            { label: 'Deploy/Start Dependencies', render: renderDependenciesTab }
        ]);
        tabbed.el.style.height = '380px';
        tabbed.el.querySelector('.tab-body').style.padding = '12px 4px';

        const depDialog = modal({
            title: 'Channel Dependencies',
            body: tabbed.el,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'OK', primary: true,
                    onClick: async () => {
                        try {
                            // 1. Deploy/start dependencies — saved to the server
                            //    immediately, with a confirmation (matches Swing).
                            const curKeys = new Set(dependencies.map(depKey));
                            const depChanged = curKeys.size !== initialDepKeys.size
                                || [...curKeys].some(k => !initialDepKeys.has(k));
                            if (depChanged) {
                                const ok = await confirmDialog('Save Dependencies',
                                    "You've made changes to deploy/start dependencies, which will be saved now. Are you sure you wish to continue?");
                                if (!ok) return false;
                                await api.server.setChannelDependencies(
                                    dependencies.map(d => ({ dependentId: d.dependentId, dependencyId: d.dependencyId })));
                                toast('Channel dependencies saved');
                            }

                            // 2. Code template libraries — mutate this channel's
                            //    membership, then PUT the full list. Changing a
                            //    library's channel set edits the SHARED libraries,
                            //    so confirm first (matches Swing).
                            const changedLibs = libraries.filter(lib => libChecked.get(lib.id) !== libInitial.get(lib.id));
                            if (changedLibs.length) {
                                const ok = await confirmDialog('Save Code Template Libraries',
                                    "You've made changes to code template libraries, which will be saved now. Are you sure you wish to continue?");
                                if (!ok) return false;
                                for (const lib of changedLibs) {
                                    const enabled = new Set(idSet(lib.enabledChannelIds));
                                    const disabled = new Set(idSet(lib.disabledChannelIds));
                                    if (libChecked.get(lib.id)) { enabled.add(channel.id); disabled.delete(channel.id); }
                                    else { enabled.delete(channel.id); disabled.add(channel.id); }
                                    lib.enabledChannelIds = enabled.size ? { string: [...enabled] } : '';
                                    lib.disabledChannelIds = disabled.size ? { string: [...disabled] } : '';
                                }
                                // '@version' must be the FIRST key on both the library
                                // and each template ref (array-nested; the engine's
                                // JSON→XML reorder fallback doesn't run there).
                                const payload = libraries.map(lib => {
                                    const { '@version': _v, codeTemplates: _ct, ...rest } = lib;
                                    const ids = api.asList(lib.codeTemplates, 'codeTemplate')
                                        .map(t => t && t.id).filter(Boolean);
                                    return {
                                        '@version': lib['@version'] || version,
                                        ...rest,
                                        codeTemplates: ids.length
                                            ? { codeTemplate: ids.map(id => ({ '@version': version, id })) }
                                            : null
                                    };
                                });
                                await api.codeTemplates.updateLibraries(payload);
                                toast('Code template libraries saved');
                            }

                            // 3. Library resources — write each context's resourceIds
                            //    onto the channel and its connectors (persisted by
                            //    Save Changes). Existing entries (Default Resource)
                            //    are preserved; only listed resources toggle.
                            let resChanged = false;
                            for (const t of resourceTargets) {
                                const hd = t.holder();
                                if (!hd) continue;
                                const after = Object.keys(ctxMaps.get(t.key)).sort();
                                const before = Object.keys(entriesToObj(hd.resourceIds)).sort();
                                const prevClass = (hd.resourceIds && hd.resourceIds['@class']) || 'linked-hash-map';
                                hd.resourceIds = {
                                    '@class': prevClass,
                                    entry: Object.entries(ctxMaps.get(t.key)).map(([id, name]) => ({ string: [id, String(name)] }))
                                };
                                if (JSON.stringify(before) !== JSON.stringify(after)) resChanged = true;
                            }
                            if (resChanged) markDirty();
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
        // Wide enough that the three tab labels fit on one row (no scrollbar).
        depDialog.el.style.width = 'min(620px, calc(100vw - 40px))';
        // The fixed-height tabs manage their own inner scrolling, so the modal
        // body itself must not add a second (vertical) scrollbar.
        depDialog.el.querySelector('.modal-body').style.overflow = 'hidden';
    }

    /* ---- message storage ---------------------------------------------------------- */

    // Slider value 1..5 → storage mode (MessageStorageMode.fromInt); top = 5.
    const STORAGE_SLIDER = ['DISABLED', 'METADATA', 'RAW', 'PRODUCTION', 'DEVELOPMENT'];
    const STORAGE_INFO = {
        DEVELOPMENT: { label: 'Development', content: 'Content: All', meta: 'Metadata: All', durable: 'On', dc: '#008200', perf: 20 },
        PRODUCTION:  { label: 'Production', content: 'Content: Raw, Encoded, Sent, Response, Maps', meta: 'Metadata: All', durable: 'On', dc: '#008200', perf: 25 },
        RAW:         { label: 'Raw', content: 'Content: Raw', meta: 'Metadata: All', durable: 'Reprocess only', dc: '#ff6600', perf: 60 },
        METADATA:    { label: 'Metadata', content: 'Content: None', meta: 'Metadata: All', durable: 'Off', dc: '#820000', perf: 65 },
        DISABLED:    { label: 'Disabled', content: 'Content: None', meta: 'Metadata: None', durable: 'Off', dc: '#820000', perf: 100 }
    };

    function renderMessageStorage(props) {
        let mode = props.messageStorageMode || 'DEVELOPMENT';

        const modeLabel = h('div', { class: 'font-bold text-[14px]' });
        const contentLabel = h('div', { class: 'text-[12px]' });
        const metaLabel = h('div', { class: 'text-[12px]' });
        const durableVal = h('span', { class: 'font-semibold' });
        const meterBar = h('div', { class: 'h-full bg-accent opacity-75 [transition:width_0.2s_ease]' });
        const meter = h('div', { class: 'h-2 w-[180px] bg-bg3 border border-line rounded-[3px] overflow-hidden' }, meterBar);
        const queueWarn = h('div', { class: 'text-[#d00] text-[11px] min-h-3.5' });

        const cbDefs = [
            { key: 'encryptData', label: 'Encrypt message content' },
            { key: 'encryptAttachments', label: 'Attachments' },
            { key: 'encryptCustomMetaData', label: 'Custom metadata' },
            { key: 'removeContentOnCompletion', label: 'Remove content on completion' },
            { key: 'removeOnlyFilteredOnCompletion', label: 'Filtered only' },
            { key: 'removeAttachmentsOnCompletion', label: 'Remove attachments on completion' }
        ];
        const boxes = {};
        const boxEls = cbDefs.map(def => {
            const c = checkbox(def.label, !!props[def.key], { onChange: (e) => { props[def.key] = e.target.checked; markDirty(); refresh(); } });
            boxes[def.key] = c.input;
            return c.el;
        });

        function refresh() {
            const info = STORAGE_INFO[mode];
            modeLabel.textContent = info.label;
            contentLabel.textContent = info.content;
            metaLabel.textContent = info.meta;
            durableVal.textContent = info.durable; durableVal.style.color = info.dc;
            const meta = mode === 'METADATA', dis = mode === 'DISABLED';
            const disabled = {
                encryptData: meta || dis,
                encryptAttachments: meta || dis,
                encryptCustomMetaData: dis,
                removeContentOnCompletion: meta || dis,
                removeOnlyFilteredOnCompletion: meta || dis || !props.removeContentOnCompletion,
                removeAttachmentsOnCompletion: meta || dis
            };
            for (const def of cbDefs) { boxes[def.key].disabled = !!disabled[def.key]; boxes[def.key].checked = !!props[def.key]; }
            let perf = info.perf;
            for (const k of ['encryptData', 'encryptAttachments', 'removeContentOnCompletion', 'removeAttachmentsOnCompletion']) {
                if (!disabled[k] && props[k]) perf -= 3;
            }
            meterBar.style.width = Math.max(0, Math.min(100, perf)) + '%';
            const queued = (mode === 'RAW' || mode === 'METADATA' || mode === 'DISABLED') &&
                oie.destinationsOf(channel).some(d => d.properties && d.properties.destinationConnectorProperties && d.properties.destinationConnectorProperties.queueEnabled);
            queueWarn.textContent = queued ? 'Disable destination queueing before using this mode' : '';
        }

        const slider = h('input', { type: 'range', min: '1', max: '5', step: '1', class: '[writing-mode:vertical-lr] [direction:rtl] h-[150px] w-[22px] p-0' });
        slider.value = String(STORAGE_SLIDER.indexOf(mode) + 1);
        slider.addEventListener('input', () => { mode = STORAGE_SLIDER[Number(slider.value) - 1]; props.messageStorageMode = mode; markDirty(); refresh(); });
        const ticks = h('div', { class: 'flex flex-col justify-between h-[150px] text-[11px] text-text-dim' },
            h('div', 'Development'), h('div', 'Production'), h('div', 'Raw'), h('div', 'Metadata'), h('div', 'Disabled'));

        refresh();
        return h('div.panel',
            h('div.panel-header', 'Message Storage'),
            h('div.panel-body', h('div', { class: 'flex gap-4' },
                h('div', { class: 'flex gap-1.5' }, slider, ticks),
                h('div', { class: 'flex flex-col gap-[5px] flex-1 min-w-0' },
                    modeLabel, contentLabel, metaLabel,
                    h('div', { class: 'text-[12px]' }, 'Durable Message Delivery: ', durableVal),
                    h('div', { class: 'flex items-center gap-2 text-[12px]' }, h('span', 'Performance:'), meter),
                    h('div', { class: 'flex flex-wrap gap-y-1 gap-x-3.5 mt-1' }, boxEls[0], boxEls[1], boxEls[2]),
                    h('div', { class: 'flex flex-wrap gap-y-1 gap-x-3.5' }, boxEls[3], boxEls[4]),
                    boxEls[5],
                    queueWarn))));
    }

    /* ---- custom metadata columns ------------------------------------------------ */

    function renderMetaDataColumns(props) {
        const columns = api.asList(props.metaDataColumns, 'metaDataColumn');
        const host = h('div');

        function commit() {
            props.metaDataColumns = columns.length ? { metaDataColumn: columns } : null;
            markDirty();
        }

        function renderRows() {
            clear(host);
            if (!columns.length) {
                host.appendChild(h('div.text-text-faint', 'No custom metadata columns'));
                return;
            }
            const grid = h('div', { class: 'grid grid-cols-[minmax(160px,1fr)_130px_minmax(160px,1fr)_70px] gap-y-1 gap-x-1.5 items-center max-w-[760px]' },
                h('label', 'Column Name'), h('label', 'Type'), h('label', 'Variable Mapping'), h('span'));
            for (const col of columns) {
                grid.appendChild(textInput(col.name ?? '', {
                    onInput: (e) => { col.name = e.target.value; commit(); }
                }));
                grid.appendChild(select(META_COLUMN_TYPES, col.type || 'STRING', {
                    onChange: (e) => { col.type = e.target.value; commit(); }
                }));
                grid.appendChild(textInput(col.mappingName ?? '', {
                    onInput: (e) => { col.mappingName = e.target.value; commit(); }
                }));
                grid.appendChild(h('button.btn.btn-sm', {
                    title: 'Remove column',
                    onClick: () => { columns.splice(columns.indexOf(col), 1); commit(); renderRows(); }
                }, 'Delete'));
            }
            host.appendChild(grid);
        }

        renderRows();
        const snapshot = JSON.parse(JSON.stringify(columns));
        const addBtn = taskButton('Add', 'plus', () => {
            columns.push({ name: '', type: 'STRING', mappingName: '' });
            commit();
            renderRows();
        });
        const revertBtn = taskButton('Revert', null, () => {
            columns.length = 0;
            for (const c of JSON.parse(JSON.stringify(snapshot))) columns.push(c);
            commit();
            renderRows();
        });
        revertBtn.title = 'Revert the custom metadata settings to the last save.';
        addBtn.classList.add('btn-sm');
        revertBtn.classList.add('btn-sm');
        return h('div.panel',
            h('div.panel-header', 'Custom Metadata', h('div.panel-tools', addBtn, revertBtn)),
            h('div.panel-body', host));
    }

    /* ---- message pruning ----------------------------------------------------------- */

    function renderPruning(metadata) {
        const pruning = metadata.pruningSettings = metadata.pruningSettings || { archiveEnabled: true };

        function radio(name, checked, onChange, label) {
            return h('label.check', h('input', { type: 'radio', name, checked, onChange }), label);
        }

        function daysInput(key) {
            return numberInput(pruning[key] ?? '', {
                min: 1,
                class: 'w-[90px]',
                disabled: pruning[key] == null,
                onInput: (e) => {
                    pruning[key] = Math.max(1, Number(e.target.value) || 1);
                    markDirty();
                }
            });
        }

        const metaDays = daysInput('pruneMetaDataDays');
        const contentDays = daysInput('pruneContentDays');

        const archiveBox = checkbox('Allow message archiving', pruning.archiveEnabled !== false, {
            onChange: (e) => { pruning.archiveEnabled = e.target.checked; markDirty(); }
        });
        const erroredBox = checkbox('Prune Errored Messages', !!pruning.pruneErroredMessages, {
            onChange: (e) => { pruning.pruneErroredMessages = e.target.checked; markDirty(); refreshPrune(); }
        });
        const warn = h('div.hint', { class: 'mt-2' });

        // Archiving / prune-errored only apply when something is actually pruned.
        function refreshPrune() {
            const nothingPruned = pruning.pruneMetaDataDays == null && pruning.pruneContentDays == null;
            archiveBox.input.disabled = nothingPruned;
            erroredBox.input.disabled = nothingPruned;
            warn.textContent = pruning.pruneErroredMessages
                ? '(incomplete and queued messages will not be pruned)'
                : '(incomplete, errored, and queued messages will not be pruned)';
        }

        const metaGroup = h('div.radio-group',
            radio('prune-metadata', pruning.pruneMetaDataDays == null, () => {
                delete pruning.pruneMetaDataDays;
                metaDays.value = '';
                metaDays.disabled = true;
                markDirty(); refreshPrune();
            }, 'Store indefinitely'),
            h('div', { class: 'flex items-center gap-2' },
                radio('prune-metadata', pruning.pruneMetaDataDays != null, () => {
                    pruning.pruneMetaDataDays = Number(metaDays.value) || 30;
                    metaDays.value = String(pruning.pruneMetaDataDays);
                    metaDays.disabled = false;
                    markDirty(); refreshPrune();
                }, 'Prune metadata older than'),
                metaDays, h('span.text-text-dim', 'days')));

        const contentGroup = h('div.radio-group',
            radio('prune-content', pruning.pruneContentDays == null, () => {
                delete pruning.pruneContentDays;
                contentDays.value = '';
                contentDays.disabled = true;
                markDirty(); refreshPrune();
            }, 'Prune when message metadata is removed'),
            h('div', { class: 'flex items-center gap-2' },
                radio('prune-content', pruning.pruneContentDays != null, () => {
                    pruning.pruneContentDays = Number(contentDays.value) || 30;
                    contentDays.value = String(pruning.pruneContentDays);
                    contentDays.disabled = false;
                    markDirty(); refreshPrune();
                }, 'Prune content older than'),
                contentDays, h('span.text-text-dim', 'days')));

        refreshPrune();
        return h('div.panel',
            h('div.panel-header', 'Message Pruning'),
            h('div.panel-body',
                h('div.form-grid',
                    h('div.field', h('label', 'Metadata'), metaGroup),
                    h('div.field', h('label', 'Content'), contentGroup)),
                h('div', { class: 'flex flex-col gap-1 mt-1.5' }, archiveBox.el, erroredBox.el),
                warn));
    }

    /* ---- channel description ---------------------------------------------------------- */

    function renderDescription() {
        return h('div.panel',
            h('div.panel-header', 'Channel Description'),
            h('div.panel-body', h('textarea', {
                rows: 4,
                placeholder: 'Describe what this channel does…',
                onInput: (e) => { channel.description = e.target.value; markDirty(); }
            }, channel.description ?? '')));
    }

    /* ====================================================================== *
     *  Connector helpers (shared by Source / Destinations)
     * ====================================================================== */

    function transportNamesFor(mode, current) {
        const names = [];
        for (const key of platform.connectorPanels().keys()) {
            const [keyMode, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
            if (keyMode === mode && name !== '*') names.push(name);
        }
        if (current && !names.includes(current)) names.unshift(current);
        return names;
    }

    /* Connector types installed on the engine (GET /extensions/connectors →
       XStream map of name → connectorMetaData with name + type SOURCE|DESTINATION).
       Cached for the lifetime of this editor; failure degrades silently to the
       web-registered panels only. */
    let engineConnectorTypesPromise = null;
    function engineConnectorTypes() {
        if (!engineConnectorTypesPromise) {
            engineConnectorTypesPromise = api.extensions.connectors().then((raw) => {
                const types = [];
                if (!raw || typeof raw !== 'object') return types;
                const push = (meta) => {
                    if (meta && typeof meta === 'object' && meta.name && meta.type) {
                        types.push({ name: String(meta.name), type: String(meta.type) });
                    }
                };
                if (raw.entry !== undefined) {
                    for (const e of api.asList(raw.entry)) {
                        if (!e || typeof e !== 'object') continue;
                        let meta = e.connectorMetaData;
                        if (!meta || typeof meta !== 'object') {
                            for (const [k, v] of Object.entries(e)) {
                                if (k !== 'string' && v && typeof v === 'object') { meta = v; break; }
                            }
                        }
                        push(meta);
                    }
                } else {
                    for (const [k, meta] of Object.entries(raw)) {
                        if (!k.startsWith('@')) push(meta);
                    }
                }
                return types;
            }).catch(() => []);
        }
        return engineConnectorTypesPromise;
    }

    function connectorTypeSelect(connector, mode, onChanged) {
        const names = transportNamesFor(mode, connector.transportName);
        const sel = select(names, connector.transportName, {
            onChange: async (e) => {
                const name = e.target.value;
                if (name === connector.transportName) return;
                const def = platform.connectorPanel(name, mode);
                if (!def || typeof def.defaults !== 'function') {
                    // Engine-only type: we cannot synthesize its '@class'
                    // properties object, so block the switch. (Existing
                    // channels already using such a type still render via the
                    // generic JSON fallback panel.)
                    e.target.value = connector.transportName;
                    toast(`"${name}" cannot be configured in the web administrator — install a web admin plugin that registers a connector panel for it.`, 'warn');
                    return;
                }
                const ok = await confirmDialog('Change Connector Type',
                    `Switch this connector to ${name}? Connector settings will reset to defaults (the filter and transformer are kept).`);
                if (!ok) { e.target.value = connector.transportName; return; }
                connector.transportName = name;
                connector.properties = def.defaults(version);
                markDirty();
                onChanged();
            }
        });
        // Merge in connector types reported by the engine that have no web
        // panel registration, labeled so the gap is visible.
        engineConnectorTypes().then((types) => {
            for (const { name, type } of types) {
                if (type !== mode || names.includes(name)) continue;
                names.push(name);
                sel.appendChild(h('option', { value: name }, `${name} (no web editor)`));
            }
        });
        return sel;
    }

    // Teardowns for plugin React panels (connector-properties panels) mounted
    // into the imperative connector area; unmounted before each connector
    // rebuild (renderSource/renderDestEditor) and on editor teardown.
    const pluginPanelRoots = [];
    const clearPluginPanels = () => { pluginPanelRoots.forEach(t => { try { t(); } catch { /* ignore */ } }); pluginPanelRoots.length = 0; };
    // Channel-tab React roots are tracked separately from the connector panels:
    // clearPluginPanels() fires on connector rebuilds, which must not tear down a
    // mounted plugin channel tab. tabs() re-renders + clears on every switch, so a
    // component tab keeps at most one live root (unmounted before the next render).
    const channelTabRoots = [];
    const clearChannelTabRoots = () => { channelTabRoots.forEach(t => { try { t(); } catch { /* ignore */ } }); channelTabRoots.length = 0; };

    // The Scripts tab's single code editor is recreated each time that tab is
    // rendered (the tab system clear()s the body with no per-tab teardown), so
    // track the live instance and dispose the prior one when the tab is rebuilt
    // or the view is torn down. Guarded: the baseline textarea has no dispose().
    let scriptsEditor = null;
    const clearScriptsEditor = () => {
        try { scriptsEditor && scriptsEditor.dispose && scriptsEditor.dispose(); } catch { /* baseline no-op */ }
        scriptsEditor = null;
    };

    function connectorPanelHost(connector, mode) {
        const def = platform.connectorPanel(connector.transportName, mode) || platform.connectorPanel('*', mode);
        const container = h('div');
        if (def && typeof def.component === 'function') {
            pluginPanelRoots.push(mountReact(container, <PluginSlot def={def}
                ctx={{ properties: connector.properties, connector, channel, platform, onChange: markDirty }} />));
        } else {
            const area = h('textarea', { rows: 16, spellcheck: 'false' },
                JSON.stringify(connector.properties, null, 2));
            area.addEventListener('blur', () => {
                let parsed;
                try {
                    parsed = JSON.parse(area.value);
                } catch (e) {
                    toast(`Invalid JSON: ${e.message}`, 'error');
                    return;
                }
                // The engine needs a properties object carrying its '@class';
                // never let the connector be saved without it.
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed['@class']) {
                    toast('Connector properties must be an object with an "@class" field', 'error');
                    area.value = JSON.stringify(connector.properties, null, 2);
                    return;
                }
                connector.properties = parsed;
                markDirty();
            });
            container.appendChild(field('Connector Properties (JSON)', area,
                `No settings panel registered for "${connector.transportName}" — edit the raw properties`));
        }
        const settingsPanel = h('div.panel',
            h('div.panel-header', `${connector.transportName} Settings`),
            h('div.panel-body', container));

        // This wrapper sits after the Source/Destination Settings panel; the
        // `.panel + .panel` spacing rule can't bridge across the wrapper, so add
        // the same 14px gap here. Panels inside still self-space via that rule.
        const root = h('div', { class: 'mt-3.5' });

        // Plugin-contributed sections (web equivalent of Swing's
        // ConnectorPropertiesPlugin, e.g. httpauth / an SSL settings panel).
        // Each edits its own entry in connector.properties.pluginProperties,
        // JSON-keyed by the entry's Java class name. They render BEFORE the
        // connector's own settings panel — matching Swing, which places them
        // between Source/Destination Settings and the connector's main settings.
        for (const ppDef of platform.connectorPropertiesPanels()) {
            try {
                if (!ppDef.isSupported || !ppDef.isSupported(connector.transportName, mode, connector)) continue;
                const host = h('div');
                const fqcn = typeof ppDef.propertiesClass === 'function'
                    ? ppDef.propertiesClass(connector.transportName, mode, connector)
                    : ppDef.propertiesClass;
                if (!fqcn) continue;
                const getEntry = () => {
                    const pp = connector.properties && connector.properties.pluginProperties;
                    return (pp && typeof pp === 'object' && pp[fqcn]) || null;
                };
                const setEntry = (entry) => {
                    if (!connector.properties) return;
                    let pp = connector.properties.pluginProperties;
                    if (entry === null || entry === undefined) {
                        if (pp && typeof pp === 'object') {
                            delete pp[fqcn];
                            if (!Object.keys(pp).filter(k => !k.startsWith('@')).length) {
                                connector.properties.pluginProperties = null;
                            }
                        }
                    } else {
                        if (!pp || typeof pp !== 'object') {
                            pp = connector.properties.pluginProperties = {};
                        }
                        pp[fqcn] = entry;
                    }
                    markDirty();
                };
                pluginPanelRoots.push(mountReact(host, <PluginSlot def={ppDef} ctx={{ getEntry, setEntry, propertiesClass: fqcn, connector, channel, platform, onChange: markDirty }} />));
                root.appendChild(h('div.panel',
                    h('div.panel-header', ppDef.title || ppDef.id),
                    h('div.panel-body', host)));
            } catch (e) {
                console.error(`[connector-properties-panel] ${ppDef.id || '?'} failed:`, e);
            }
        }

        root.appendChild(settingsPanel);
        return root;
    }

    /* ====================================================================== *
     *  Source tab — filter/transformer tasks live in the React task pane
     * ====================================================================== */

    function renderSource() {
        const root = h('div');
        const connector = channel.sourceConnector;

        function rebuild() {
            clearPluginPanels();
            clear(root);
            root.appendChild(h('div.panel',
                h('div.panel-header', 'Connector Type'),
                h('div.panel-body',
                    field('Source Connector', connectorTypeSelect(connector, 'SOURCE', rebuild)))));

            const scp = connector.properties && connector.properties.sourceConnectorProperties;
            if (scp) {
                // Source Settings — parity with the Swing SourceSettingsPanel.
                const settingsHost = h('div');
                function renderSourceSettings() {
                    clear(settingsHost);
                    const respondAfter = scp.respondAfterProcessing !== false;   // queue OFF when true

                    // Source Queue: OFF = respond after processing (can use destination
                    // responses); ON = queue + respond before processing.
                    const queueSel = select([
                        { value: 'off', label: 'OFF (Respond after processing)' },
                        { value: 'on', label: 'ON (Respond before processing)' }
                    ], respondAfter ? 'off' : 'on', {
                        onChange: (e) => {
                            scp.respondAfterProcessing = e.target.value === 'off';
                            // ON can't respond from destinations; clamp to a valid choice.
                            if (!scp.respondAfterProcessing &&
                                !['None', 'Auto-generate (Before processing)'].includes(scp.responseVariable)) {
                                scp.responseVariable = 'None';
                            }
                            markDirty();
                            renderSourceSettings();
                        }
                    });

                    // Response: static auto-generate options (fewer when queued), plus
                    // "respond from" each destination (stored as the "d<id>" response key).
                    const respOpts = (respondAfter
                        ? ['None', 'Auto-generate (Before processing)', 'Auto-generate (After source transformer)', 'Auto-generate (Destinations completed)', 'Postprocessor']
                        : ['None', 'Auto-generate (Before processing)']).map(v => ({ value: v, label: v }));
                    if (respondAfter) {
                        for (const d of oie.destinationsOf(channel)) {
                            respOpts.push({ value: 'd' + d.metaDataId, label: d.name || `Destination ${d.metaDataId}` });
                        }
                    }
                    const currentResp = scp.responseVariable ?? 'None';
                    if (!respOpts.some(o => o.value === currentResp)) respOpts.push({ value: currentResp, label: currentResp });
                    const responseSel = select(respOpts, currentResp, {
                        onChange: (e) => { scp.responseVariable = e.target.value; markDirty(); }
                    });

                    // Queue Buffer Size — only meaningful (editable) when queue is ON.
                    const bufInput = numberInput(scp.queueBufferSize || 1000, {
                        min: 0,
                        onInput: (e) => { scp.queueBufferSize = Number(e.target.value) || 0; markDirty(); }
                    });
                    bufInput.disabled = respondAfter;

                    const batchSel = select([{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
                        scp.processBatch ? 'yes' : 'no', {
                            onChange: (e) => { scp.processBatch = e.target.value === 'yes'; markDirty(); renderSourceSettings(); }
                        });

                    // Batch Response — only applies when batching is on.
                    const batchRespSel = select([{ value: 'first', label: 'First' }, { value: 'last', label: 'Last' }],
                        scp.firstResponse ? 'first' : 'last', {
                            onChange: (e) => { scp.firstResponse = e.target.value === 'first'; markDirty(); }
                        });
                    batchRespSel.disabled = !scp.processBatch;

                    const threadsInput = numberInput(scp.processingThreads ?? 1, {
                        min: 1,
                        onInput: (e) => { scp.processingThreads = Number(e.target.value) || 1; markDirty(); }
                    });

                    settingsHost.appendChild(h('div.form-grid',
                        field('Source Queue', queueSel),
                        field('Queue Buffer Size', bufInput),
                        field('Response', responseSel),
                        field('Process Batch', batchSel),
                        field('Batch Response', batchRespSel),
                        field('Max Processing Threads', threadsInput)));
                }
                renderSourceSettings();
                root.appendChild(h('div.panel',
                    h('div.panel-header', 'Source Settings'),
                    h('div.panel-body', settingsHost)));
            }

            root.appendChild(connectorPanelHost(connector, 'SOURCE'));
        }

        rebuild();
        return root;
    }

    /* ====================================================================== *
     *  Destinations tab
     * ====================================================================== */

    function renderDestinations() {
        const root = h('div', { class: 'flex-1 min-h-0' });
        let selectedId = null;
        let destHeaderEl = null;   // detail-panel header, kept in sync with inline name edits

        const table = new DataTable([
            { key: 'metaDataId', label: 'Id', width: '46px', className: 'num' },
            {
                key: 'enabled', label: 'Status', width: '100px',
                sortValue: (d) => d.enabled !== false ? 0 : 1,
                render: (d) => d.enabled !== false
                    ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
                    : h('span.status-cell', h('span.pip'), h('span.text-text-dim', 'Disabled'))
            },
            {
                key: 'name', label: 'Name',
                // Inline-editable name cell (matches the Swing Destinations grid).
                // Clicks are kept off the row handler so the table never re-renders
                // mid-edit and steals focus.
                render: (d) => {
                    const input = h('input.grid-name', {
                        type: 'text', value: d.name || '',
                        onInput: (e) => {
                            d.name = e.target.value;
                            markDirty();
                            if (destHeaderEl && selectedDest() === d) destHeaderEl.textContent = `Destination ${d.metaDataId} — ${d.name}`;
                        }
                    });
                    ['click', 'mousedown', 'dblclick'].forEach(ev => input.addEventListener(ev, (e) => e.stopPropagation()));
                    return input;
                }
            },
            { key: 'transportName', label: 'Type' },
            {
                key: 'waitForPrevious', label: 'Chain', sortable: false,
                render: (d) => d.waitForPrevious !== false ? 'Wait for previous' : 'Don\'t wait'
            }
        ], {
            selectable: 'single',
            rowKey: (d) => String(d.metaDataId),
            emptyText: 'No destinations',
            columnsMenu: true,
            columnsMenuKey: 'webadmin-cols-destinations',
            onSelect: (rows) => {
                selectedId = rows.length ? rows[0].metaDataId : null;
                renderDestEditor();
                onTasksChange();
            },
            // Right-click parity with the Swing channel editor's Destinations table.
            onContextMenu: (d, e) => {
                selectedId = d.metaDataId;
                renderDestEditor();
                onTasksChange();
                // Full Swing channelEditPopupMenu set, plus Edit Filter/Transformer/Response.
                contextMenu(e.clientX, e.clientY, [
                    { label: 'Save Changes', icon: 'save', task: 'doSaveChannel', group: 'channelEdit', onClick: () => save() },
                    { label: 'Validate Connector', icon: 'check', task: 'doValidate', group: 'channelEdit', onClick: () => validateConnector() },
                    '-',
                    { label: 'New Destination', icon: 'plus', task: 'doNewDestination', group: 'channelEdit', onClick: () => destTasks.newDestination() },
                    { label: 'Delete Destination', icon: 'trash', danger: true, task: 'doDeleteDestination', group: 'channelEdit', onClick: () => destTasks.deleteDestination() },
                    { label: 'Clone Destination', icon: 'copy', task: 'doCloneDestination', group: 'channelEdit', onClick: () => destTasks.cloneDestination() },
                    d.enabled !== false
                        ? { label: 'Disable Destination', icon: 'x', task: 'doDisableDestination', group: 'channelEdit', onClick: () => destTasks.setEnabled(false) }
                        : { label: 'Enable Destination', icon: 'check', task: 'doEnableDestination', group: 'channelEdit', onClick: () => destTasks.setEnabled(true) },
                    '-',
                    { label: 'Move Dest. Up', icon: 'arrowUp', task: 'doMoveDestinationUp', group: 'channelEdit', onClick: () => destTasks.move(-1) },
                    { label: 'Move Dest. Down', icon: 'arrowDown', task: 'doMoveDestinationDown', group: 'channelEdit', onClick: () => destTasks.move(1) },
                    '-',
                    { label: 'Edit Filter', icon: 'filter', onClick: () => destTasks.editElements('filter') },
                    { label: 'Edit Transformer', icon: 'transform', onClick: () => destTasks.editElements('transformer') },
                    { label: 'Edit Response', icon: 'transform', onClick: () => destTasks.editElements('response') },
                    '-',
                    { label: 'Import Connector', icon: 'import', task: 'doImportConnector', group: 'channelEdit', onClick: () => destTasks.importConnector() },
                    { label: 'Export Connector', icon: 'export', task: 'doExportConnector', group: 'channelEdit', onClick: () => destTasks.exportConnector() },
                    { label: 'Export Channel', icon: 'export', task: 'doExportChannel', group: 'channelEdit', onClick: () => saveFile(`${channel.name || channel.id}.json`, 'application/json', () => JSON.stringify({ channel }, null, 2)) },
                    { label: 'Validate Script', icon: 'check', task: 'doValidateChannelScripts', group: 'channelEdit', onClick: () => validateChannelScripts() },
                    '-',
                    { label: 'Debug Channel', icon: 'deploy', task: 'doDebugDeployFromChannelView', group: 'channelEdit', onClick: () => openDebugDeployModal() },
                    { label: 'Deploy Channel', icon: 'deploy', task: 'doDeployFromChannelView', group: 'channelEdit', onClick: () => deploy() }
                ]);
            }
        });

        const editorHost = h('div.mt-[14px]', { class: 'flex-1 min-h-0 overflow-auto [scrollbar-gutter:stable]' });

        const dests = () => oie.destinationsOf(channel);
        const selectedDest = () => dests().find(d => String(d.metaDataId) === String(selectedId));

        function refresh() {
            // Always keep a destination selected (classic behavior): fall back
            // to the first one so its connector panel and the sidebar
            // connector tasks apply immediately.
            const list = dests();
            if (!list.some(d => String(d.metaDataId) === String(selectedId))) {
                selectedId = list.length ? list[0].metaDataId : null;
            }
            table.selected = new Set(selectedId == null ? [] : [String(selectedId)]);
            table.setRows(list);
            renderDestEditor();
            onTasksChange();
        }

        function needSelection() {
            const dest = selectedDest();
            if (!dest) toast('Select a destination first', 'warn');
            return dest;
        }

        async function newDestination() {
            const name = await promptDialog('New Destination', 'Destination name', `Destination ${dests().length + 1}`);
            if (name === null || !name.trim()) return;
            const metaDataId = Number(channel.nextMetaDataId) || (dests().length + 1);
            const dest = oie.defaultDestinationConnector(version, metaDataId, name.trim());
            channel.nextMetaDataId = metaDataId + 1;
            const list = dests().slice();
            list.push(dest);
            oie.setDestinations(channel, list);
            selectedId = metaDataId;
            table.selected = new Set([String(metaDataId)]);
            markDirty();
            refresh();
        }

        async function deleteDestination() {
            const dest = needSelection();
            if (!dest) return;
            if (dests().length <= 1) { toast('A channel must have at least one destination', 'warn'); return; }
            if (!await confirmDialog('Delete Destination', `Delete destination "${dest.name}"?`, { danger: true, okLabel: 'Delete' })) return;
            oie.setDestinations(channel, dests().filter(d => d !== dest));
            selectedId = null;
            markDirty();
            refresh();
        }

        function move(delta) {
            const dest = needSelection();
            if (!dest) return;
            const list = dests().slice();
            const index = list.indexOf(dest);
            const next = index + delta;
            if (next < 0 || next >= list.length) return;
            list.splice(index, 1);
            list.splice(next, 0, dest);
            oie.setDestinations(channel, list);
            markDirty();
            refresh();
        }

        /* Classic connector import/export: replace the selected destination's
           content but keep its identity (metaDataId + name). */
        async function importConnector() {
            const dest = needSelection();
            if (!dest) return;
            const file = await pickFile('.json');
            if (!file) return;
            let imported;
            try {
                imported = JSON.parse(String(file.content || ''));
            } catch (e) {
                toast(`Invalid JSON: ${e.message}`, 'error');
                return;
            }
            if (imported && typeof imported === 'object' && imported.connector) imported = imported.connector;
            if (!imported || typeof imported !== 'object' || !imported.transportName) {
                toast('File is not a connector export', 'error');
                return;
            }
            if (imported.mode && imported.mode !== 'DESTINATION') {
                toast('Not a destination connector export', 'error');
                return;
            }
            if (!await confirmDialog('Import Connector',
                `Replace the settings of "${dest.name}" with the imported ${imported.transportName} connector? The destination keeps its id and name.`)) return;
            dest.transportName = imported.transportName;
            dest.properties = imported.properties;
            dest.filter = imported.filter || oie.emptyFilter(version);
            dest.transformer = imported.transformer || oie.emptyTransformer(version);
            dest.responseTransformer = imported.responseTransformer || dest.responseTransformer || oie.emptyTransformer(version);
            markDirty();
            refresh();
        }

        function exportConnector() {
            const dest = needSelection();
            if (!dest) return;
            saveFile(`${dest.name || 'destination'}.json`, 'application/json', () => JSON.stringify({ connector: dest }, null, 2));
        }

        function cloneDestination() {
            const dest = needSelection();
            if (!dest) return;
            const copy = JSON.parse(JSON.stringify(dest));
            const metaDataId = Number(channel.nextMetaDataId) || (dests().length + 1);
            copy.metaDataId = metaDataId;
            copy.name = `${dest.name || 'Destination'} (copy)`;
            channel.nextMetaDataId = metaDataId + 1;
            const list = dests().slice();
            list.push(copy);
            oie.setDestinations(channel, list);
            selectedId = metaDataId;
            markDirty();
            refresh();
        }
        function setEnabled(value) {
            const dest = needSelection();
            if (!dest) return;
            dest.enabled = value;
            markDirty();
            refresh();
        }

        Object.assign(destTasks, {
            newDestination, deleteDestination, move, importConnector, exportConnector,
            cloneDestination, setEnabled, selected: selectedDest,
            stepCountOf: (key) => stepCount(selectedDest(), key),
            editElements(kind) {
                const dest = needSelection();
                if (dest) gotoElements(kind, dest.metaDataId);
            }
        });

        function renderDestEditor() {
            clearPluginPanels();
            clear(editorHost);
            const dest = selectedDest();
            if (!dest) {
                editorHost.appendChild(h('div.text-text-faint', { class: 'py-2.5 px-0.5' },
                    'Select a destination to edit its settings'));
                return;
            }

            destHeaderEl = h('div.panel-header', `Destination ${dest.metaDataId} — ${dest.name}`);
            // Wait-for is pushed to the right; Enabled is toggled from the
            // destinations grid / Enable–Disable Destination tasks instead.
            const waitBox = checkbox('Wait for previous destination', dest.waitForPrevious !== false, {
                onChange: (e) => { dest.waitForPrevious = e.target.checked; markDirty(); table.setRows(dests()); }
            });
            waitBox.el.style.marginLeft = 'auto';
            const typeSelect = connectorTypeSelect(dest, 'DESTINATION', renderDestEditor);
            typeSelect.style.width = '200px';
            // Static header: connector type + wait-for on ONE compact line (Swing
            // parity) — always visible above the scrollable connector panel below.
            editorHost.appendChild(h('div.panel', { class: 'm-0 sticky top-0 z-[1]' },
                destHeaderEl,
                h('div.panel-body', { class: 'py-1.5 px-3' },
                    h('div', { class: 'flex items-center gap-2' },
                        h('label', { class: 'font-semibold whitespace-nowrap' }, 'Connector Type:'),
                        typeSelect,
                        waitBox.el))));

            // Queue settings + connector panel scroll UNDER the sticky header above.
            // Sharing editorHost's single scroll keeps one scrollbar aligned with
            // both the header and the panels (no full-width/pinched-body mismatch).
            const dcp = dest.properties && dest.properties.destinationConnectorProperties;
            if (dcp) editorHost.appendChild(renderDestinationSettings(dcp));
            editorHost.appendChild(connectorPanelHost(dest, 'DESTINATION'));
        }

        /* ---- Destination Settings (classic Queue Messages / Validate Response) -- */

        function yesNoRadios(name, checked, onChange) {
            const radio = (val, label) => h('label.check', h('input', {
                type: 'radio', name, checked: checked === val,
                onChange: () => onChange(val)
            }), label);
            return h('div.radio-group.inline-row', radio(true, 'Yes'), radio(false, 'No'));
        }

        function renderDestinationSettings(dcp) {
            const advSummary = h('span.text-text-faint', advancedQueueSummary(dcp));

            // Classic Swing mapping (DestinationSettingsPanel.fillProperties):
            //   Never      → queueEnabled=false, sendFirst=false
            //   On Failure → queueEnabled=true,  sendFirst=true
            //   Always     → queueEnabled=true,  sendFirst=false
            const mode = !dcp.queueEnabled ? 'never' : (dcp.sendFirst ? 'failure' : 'always');
            const queueRadio = (value, label) => h('label.check', h('input', {
                type: 'radio', name: 'dest-queue-mode', checked: mode === value,
                onChange: () => {
                    dcp.queueEnabled = value !== 'never';
                    dcp.sendFirst = value === 'failure';
                    advSummary.textContent = advancedQueueSummary(dcp);
                    markDirty();
                }
            }), label);

            return h('div.panel',
                h('div.panel-header', 'Destination Settings'),
                h('div.panel-body', h('div.form-grid',
                    field('Queue Messages', h('div.radio-group.inline-row',
                        queueRadio('never', 'Never'),
                        queueRadio('failure', 'On Failure'),
                        queueRadio('always', 'Always'))),
                    field('Advanced Queue Settings', h('div', { class: 'flex items-center gap-2.5 flex-wrap' },
                        taskButton('Advanced Queue Settings', null, () =>
                            openAdvancedQueueSettings(dcp, () => { advSummary.textContent = advancedQueueSummary(dcp); })),
                        advSummary)),
                    field('Validate Response', yesNoRadios('dest-validate-response', !!dcp.validateResponse,
                        (v) => { dcp.validateResponse = v; markDirty(); })),
                    field('Reattach Attachments', yesNoRadios('dest-reattach-attachments', dcp.reattachAttachments !== false,
                        (v) => { dcp.reattachAttachments = v; markDirty(); })))));
        }

        /* Modal mirror of the Swing advanced queue settings dialog; edits a draft
           and commits on OK so Cancel discards. Enablement rules follow
           DestinationSettingsPanel.updateComponentsEnabled(). */
        function openAdvancedQueueSettings(dcp, onDone) {
            const queueEnabled = !!dcp.queueEnabled;
            const sendFirst = queueEnabled && !!dcp.sendFirst;
            const draft = {
                retryCount: Number(dcp.retryCount) || 0,
                retryIntervalMillis: Number(dcp.retryIntervalMillis) || 10000,
                regenerateTemplate: !!dcp.regenerateTemplate,
                rotate: !!dcp.rotate,
                includeFilterTransformer: !!dcp.includeFilterTransformer,
                threadCount: Number(dcp.threadCount) || 1,
                threadAssignmentVariable: String(dcp.threadAssignmentVariable ?? ''),
                queueBufferSize: Number(dcp.queueBufferSize) || 1000
            };

            function ynGroup(name, value, onChange) {
                const inputs = [];
                const radio = (val, label) => {
                    const input = h('input', {
                        type: 'radio', name, checked: value === val,
                        onChange: () => onChange(val)
                    });
                    inputs.push(input);
                    return h('label.check', input, label);
                };
                const el = h('div.radio-group.inline-row', radio(true, 'Yes'), radio(false, 'No'));
                return { el, setEnabled(on) { inputs.forEach(i => { i.disabled = !on; }); } };
            }

            const retryCountInput = numberInput(draft.retryCount, {
                min: 0,
                onInput: (e) => { draft.retryCount = Math.max(0, Number(e.target.value) || 0); sync(); }
            });
            const retryIntervalInput = numberInput(draft.retryIntervalMillis, {
                min: 1,
                onInput: (e) => { draft.retryIntervalMillis = Math.max(1, Number(e.target.value) || 1); }
            });
            const regenerate = ynGroup('adv-regenerate-template', draft.regenerateTemplate,
                (v) => { draft.regenerateTemplate = v; sync(); });
            const includeFT = ynGroup('adv-include-filter-transformer', draft.includeFilterTransformer,
                (v) => { draft.includeFilterTransformer = v; });
            const rotate = ynGroup('adv-rotate-queue', draft.rotate, (v) => { draft.rotate = v; });
            const threadCountInput = numberInput(draft.threadCount, {
                min: 1,
                onInput: (e) => { draft.threadCount = Math.max(1, Number(e.target.value) || 1); sync(); }
            });
            const threadVarInput = textInput(draft.threadAssignmentVariable, {
                onInput: (e) => { draft.threadAssignmentVariable = e.target.value; }
            });
            const bufferInput = numberInput(draft.queueBufferSize, {
                min: 1,
                onInput: (e) => { draft.queueBufferSize = Math.max(1, Number(e.target.value) || 1); }
            });

            function sync() {
                retryCountInput.disabled = !(!queueEnabled || sendFirst);
                retryIntervalInput.disabled = !(queueEnabled || draft.retryCount > 0);
                regenerate.setEnabled(queueEnabled);
                includeFT.setEnabled(queueEnabled && draft.regenerateTemplate);
                rotate.setEnabled(queueEnabled);
                threadCountInput.disabled = !queueEnabled;
                threadVarInput.disabled = !(queueEnabled && draft.threadCount > 1);
                bufferInput.disabled = !queueEnabled;
            }
            sync();

            modal({
                title: 'Settings',
                body: h('div.form-grid',
                    field('Retry Count Before Queue/Error', retryCountInput),
                    field('Retry Interval (ms)', retryIntervalInput),
                    field('Regenerate Template', regenerate.el),
                    field('Include Filter/Transformer', includeFT.el),
                    field('Rotate Queue', rotate.el),
                    field('Queue Threads', threadCountInput),
                    field('Thread Assignment Variable', threadVarInput),
                    field('Queue Buffer Size', bufferInput)),
                buttons: [
                    { label: 'Cancel' },
                    {
                        label: 'OK', primary: true,
                        onClick: () => {
                            dcp.retryCount = draft.retryCount;
                            dcp.retryIntervalMillis = draft.retryIntervalMillis;
                            dcp.regenerateTemplate = draft.regenerateTemplate;
                            dcp.rotate = draft.rotate;
                            dcp.includeFilterTransformer = draft.includeFilterTransformer;
                            dcp.threadCount = draft.threadCount;
                            dcp.threadAssignmentVariable = draft.threadAssignmentVariable.trim() || null;
                            dcp.queueBufferSize = draft.queueBufferSize;
                            markDirty();
                            onDone();
                        }
                    }
                ]
            });
        }

        /* ---- Destination Mappings (insert / drag velocity tokens) --------------- */

        // Last focused insertable control in the destinations pane. Tracked via
        // 'focusin' so the target survives losing focus to the mapping list.
        // Editors may have been upgraded in place to Monaco (the plain textarea
        // is replaced), so a focused element inside '.ce-monaco' is resolved to
        // its Monaco instance through monaco.editor.getEditors().
        let insertTarget = null;

        function trackFocus(e) {
            const t = e.target;
            if (!t || !(t instanceof Element)) return;
            if (t.closest('.ce-monaco')) {
                const me = window.monaco && window.monaco.editor;
                const editors = me && me.getEditors ? me.getEditors() : [];
                const inst = editors.find(ed => {
                    const node = ed.getDomNode && ed.getDomNode();
                    return node && node.contains(t);
                });
                if (inst) insertTarget = { monaco: inst };
            } else if ((t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text')) &&
                       !t.readOnly && !t.disabled) {
                insertTarget = { el: t };
            }
        }

        function insertToken(token) {
            if (insertTarget && insertTarget.monaco) {
                const inst = insertTarget.monaco;
                const node = inst.getDomNode && inst.getDomNode();
                if (node && node.isConnected) {
                    inst.executeEdits('destination-mapping', [{
                        range: inst.getSelection(), text: token, forceMoveMarkers: true
                    }]);
                    inst.focus();
                    return;
                }
            }
            if (insertTarget && insertTarget.el && insertTarget.el.isConnected) {
                const el = insertTarget.el;
                const start = el.selectionStart ?? el.value.length;
                const end = el.selectionEnd ?? start;
                el.value = el.value.slice(0, start) + token + el.value.slice(end);
                el.selectionStart = el.selectionEnd = start + token.length;
                // Fire the existing onInput/input bindings so the model updates.
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.focus();
                return;
            }
            // No known target — fall back to the clipboard.
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(token).then(
                    () => toast(`Copied ${token}`),
                    () => toast('Focus a text field first', 'warn'));
            } else {
                toast('Focus a text field first', 'warn');
            }
        }

        // Drag-and-drop insertion. Monaco's native drop is disabled (it snippet-
        // escapes ${...}), so we insert the token as plain text at the drop point.
        const MAPPING_FLAVOR = 'application/x-oie-mapping';
        let draggingMapping = null;

        function resolveEditorAt(node) {
            if (!node || !node.closest) return null;
            const monacoEl = node.closest('.ce-monaco');
            if (monacoEl) {
                const me = window.monaco && window.monaco.editor;
                const editors = me && me.getEditors ? me.getEditors() : [];
                const inst = editors.find(ed => { const n = ed.getDomNode && ed.getDomNode(); return n && n.contains(node); });
                if (inst) return { monaco: inst };
            }
            const ta = node.closest('textarea, input[type=text]');
            if (ta && !ta.readOnly && !ta.disabled) return { el: ta };
            return null;
        }
        function mappingToken(e) {
            return draggingMapping ||
                (e.dataTransfer && (e.dataTransfer.getData(MAPPING_FLAVOR) || e.dataTransfer.getData('text/plain')));
        }
        function onMappingDragOver(e) {
            if (!draggingMapping && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes(MAPPING_FLAVOR))) return;
            if (resolveEditorAt(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
        }
        function onMappingDrop(e) {
            const token = mappingToken(e);
            const editor = token ? resolveEditorAt(e.target) : null;
            draggingMapping = null;
            if (!editor) return;
            e.preventDefault();
            if (editor.monaco) {
                const inst = editor.monaco;
                let pos = inst.getPosition();
                if (inst.getTargetAtClientPoint) {
                    const tgt = inst.getTargetAtClientPoint(e.clientX, e.clientY);
                    if (tgt && tgt.position) pos = tgt.position;
                }
                const Range = window.monaco.Range;
                inst.executeEdits('destination-mapping', [{
                    range: new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
                    text: token, forceMoveMarkers: true
                }]);
                inst.focus();
            } else {
                const t = editor.el;
                const start = t.selectionStart ?? t.value.length;
                const end = t.selectionEnd ?? start;
                t.value = t.value.slice(0, start) + token + t.value.slice(end);
                t.selectionStart = t.selectionEnd = start + token.length;
                t.dispatchEvent(new Event('input', { bubbles: true }));
                t.focus();
            }
        }

        function buildMappingsPanel() {
            const list = h('div', { class: 'overflow-auto flex-1 py-1 px-0' });
            for (const [label, token] of DESTINATION_MAPPINGS) {
                list.appendChild(h('div', {
                    draggable: 'true',
                    title: token,
                    class: 'py-[3px] px-3 cursor-pointer text-[12px] truncate',
                    onClick: () => insertToken(token),
                    onDragstart: (e) => {
                        draggingMapping = token;
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', token);
                        e.dataTransfer.setData(MAPPING_FLAVOR, token);
                    },
                    onDragend: () => { draggingMapping = null; },
                    onMouseenter: (e) => { e.currentTarget.style.background = 'var(--bg3)'; },
                    onMouseleave: (e) => { e.currentTarget.style.background = ''; }
                }, label));
            }
            return h('div.panel', {
                class: 'w-[240px] flex-[0_0_240px] flex flex-col self-stretch mt-0'
            },
                h('div.panel-header', 'Destination Mappings'),
                list);
        }

        refresh();
        // `editor-max-host` makes a maximized connector code field (e.g. JavaScript
        // Writer) fill THIS area instead of the whole viewport, so the Destination
        // Mappings rail beside it stays visible (the drag source for the script).
        const main = h('div', { class: 'editor-max-host flex-auto min-w-0 flex flex-col min-h-0' },
            h('div.panel', { class: 'flex-none' }, h('div.panel-body.flush', table.el)),
            editorHost);
        main.addEventListener('focusin', trackFocus);
        root.addEventListener('dragover', onMappingDragOver);
        root.addEventListener('drop', onMappingDrop);
        root.style.display = 'flex';
        root.style.gap = '14px';
        root.style.alignItems = 'stretch';
        root.appendChild(main);
        root.appendChild(buildMappingsPanel());
        return root;
    }

    /* ====================================================================== *
     *  Scripts tab
     * ====================================================================== */

    function renderScripts() {
        // A new editor is built below; dispose the one from a prior render of
        // this tab (it is no longer mounted) before replacing the reference.
        clearScriptsEditor();
        const scripts = [
            { key: 'deployScript', label: 'Deploy', hint: 'Runs once when the channel is deployed', context: 'CHANNEL_DEPLOY' },
            { key: 'undeployScript', label: 'Undeploy', hint: 'Runs once when the channel is undeployed', context: 'CHANNEL_UNDEPLOY' },
            { key: 'preprocessingScript', label: 'Preprocessor', hint: 'Runs before every message is processed', context: 'CHANNEL_PREPROCESSOR' },
            { key: 'postprocessingScript', label: 'Postprocessor', hint: 'Runs after every message is processed', context: 'CHANNEL_POSTPROCESSOR' }
        ];
        let current = scripts[0];
        let switching = false;     // suppress markDirty while loading a script

        // One editor switches between the four channel scripts, so scope the
        // code-template completions to whichever script is showing.
        const applyScriptScope = () => setActiveScope(channel.id, [current.context]);
        applyScriptScope();

        const hint = h('span.text-text-faint', current.hint);
        const editor = createCodeEditor({
            value: channel[current.key] ?? '',
            language: 'javascript',
            minHeight: '260px',
            maximizable: true,   // channel scripts (Deploy/Undeploy/Pre/Postprocessor) can go full-screen
            onChange: (value) => {
                if (switching) return;
                channel[current.key] = value;
                markDirty();
            }
        });
        editor.el.style.flex = '1';
        editor.el.style.minHeight = '0';
        scriptsEditor = editor;

        const scriptSelect = select(scripts.map(s => ({ value: s.key, label: s.label })), current.key, {
            class: 'w-[180px]',
            onChange: (e) => {
                channel[current.key] = editor.getValue();
                current = scripts.find(s => s.key === e.target.value) || current;
                hint.textContent = current.hint;
                switching = true;
                editor.setValue(channel[current.key] ?? '');
                switching = false;
                applyScriptScope();
            }
        });

        return h('div', { class: 'flex flex-col flex-1 min-h-0 gap-2.5' },
            h('div.form-row', { class: 'items-center' },
                h('label', { class: 'm-0' }, 'Script:'), scriptSelect, hint),
            editor.el);
    }

    /* ====================================================================== *
     *  Assemble
     * ====================================================================== */

    const tabDefs = [
        { label: 'Summary', render: renderSummary },
        { label: 'Source', render: renderSource },
        { label: 'Destinations', render: renderDestinations, fill: true },
        { label: 'Scripts', render: renderScripts, fill: true }
    ];

    for (const def of platform.channelTabs()) {
        tabDefs.push({
            label: def.label,
            render: () => {
                const host = h('div');
                // Channel tabs are React components, mounted like every other
                // plugin slot. Drop the prior root first — tabs() cleared the old
                // body DOM.
                if (typeof def.component === 'function') {
                    clearChannelTabRoots();
                    channelTabRoots.push(mountReact(host, <PluginSlot def={def} ctx={{ channel, platform, onChange: markDirty }} />));
                }
                return host;
            }
        });
    }

    const tabbed = tabs(tabDefs.map(def => ({
        label: def.label,
        // 'fill' tabs (Scripts) get a flex column the full height of the tab
        // body so their content can stretch; others scroll naturally.
        render: () => h('div', {
            class: def.fill
                ? 'py-3.5 px-0 h-full box-border flex flex-col overflow-hidden min-h-0'
                : 'py-3.5 px-0 overflow-auto'
        }, def.render())
    })), {
        // Keep the React connector-task pane in sync with the active tab.
        // (renderDestinations also drives onTasksChange on selection change; the
        // update here covers Summary/Source/Scripts/plugin tabs.)
        onChange: (i, def) => {
            activeTab = def.label;
            onTasksChange();
        }
    });

    // The task panes are React; the body is the tab strip only (no .taskbar here).
    const el = h('div.view-body', { class: 'flex flex-col flex-1 min-h-0' }, tabbed.el);

    return {
        el,
        taskState: () => ({
            dirty: isDirty(),
            tab: activeTab,
            // step counts read live (the React buttons call the count helpers below)
            destSelected: !!(destTasks.selected && destTasks.selected())
        }),
        handlers: {
            save, deploy, openDebugDeployModal, exportChannel, backToChannels,
            gotoElements, withCount,
            sourceStepCount: (key) => stepCount(channel.sourceConnector, key),
            destStepCount: (key) => (destTasks.stepCountOf ? destTasks.stepCountOf(key) : 0),
            destNew: () => destTasks.newDestination && destTasks.newDestination(),
            destDelete: () => destTasks.deleteDestination && destTasks.deleteDestination(),
            destMove: (delta) => destTasks.move && destTasks.move(delta),
            destEdit: (kind) => destTasks.editElements && destTasks.editElements(kind),
            destImport: () => destTasks.importConnector && destTasks.importConnector(),
            destExport: () => destTasks.exportConnector && destTasks.exportConnector()
        },
        teardown: () => {
            // Unmount any plugin React panels mounted into the imperative editor.
            clearPluginPanels();
            clearChannelTabRoots();
            // Dispose the Scripts-tab code editor if it's still live.
            clearScriptsEditor();
            // In-flow hops (filter/transformer) re-register on return; anything
            // else must not inherit a stale guard.
            store.setState('navGuard', null);
            // Drop this channel's code-template completion scope so it can't
            // leak into the next channel's script editors.
            clearActiveScope();
        }
    };
}
