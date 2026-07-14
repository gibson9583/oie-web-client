/*
 * Alert editor (React port of renderAlertEditor from views/alerts.js). The
 * editor's form body is heavy, intricately-wired legacy DOM — the actions table
 * with right-click Add/Delete, the draggable alert variables, the error-type
 * checkboxes, regex and template fields — and the AlertChannels serialization
 * that round-trips byte-exact with the Swing Administrator's export. That DOM +
 * the model helpers + saveModel() are reused VERBATIM (copied from
 * views/alerts.js). The connector-granular CHANNELS TREE (twisties, clickable
 * pip toggles, filter, Expand/Collapse All, Enable/Disable selected) is now the
 * declarative <TreeTable> rather than a hand-built imperative tree; the rest of
 * the form is mounted via <ImperativeMount> (heavy legacy DOM kept verbatim).
 *
 * The shell is React: the heavy panels are mounted into ref'd <div>s
 * (<ImperativeMount>), the channels tree is <TreeTable>, the task pane
 * ('Alert Edit Tasks') is <ViewTasks>/<RailPane>/<TaskButton>, and the banner
 * title is refined via webadmin:set-title inside requestAnimationFrame (defer
 * past route:changed).
 *
 * The model is a mutable ref (NOT cloned into immutable React state) — its
 * @version/trigger/actionGroups identity is what saveModel() mutates and what
 * api.alerts.update sends, exactly as the legacy view depended on. The channels
 * tree's working node list (and the channel-level sets it serializes from) also
 * lives in refs; a useReducer force-update repaints the React tree.
 *
 * XStream JSON shapes (verified against the Java model + serialized fixtures):
 *   trigger['@class']          'defaultTrigger'
 *   trigger.errorEventTypes    { errorEventType: [...] } | null
 *   actionGroups               { alertActionGroup: [...] }
 *   group.actions              { alertAction: [{ protocol, recipient }] } | null
 *
 * alertChannels (com.mirth.connect.model.alert.AlertChannels + AlertConnectors,
 * serialized XStream-XML -> StAXON JSON by ObjectJSONSerializer):
 *   newChannelSource / newChannelDestination   booleans ('[New Channels]' node)
 *   enabledChannels / disabledChannels         Set<String>  -> { string: [...] } | null
 *   partialChannels                            Map<String, AlertConnectors> ->
 *       { entry: [{ string: channelId, alertConnectors: { enabledConnectors,
 *                   disabledConnectors } }] } | null
 */

import { useEffect, useRef, useReducer } from 'react';
import { h, clear, toast, contextMenu, confirmDialog, field, textInput, select, checkbox, loading, icon, saveFile, taskButton } from '@oie/web-ui';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { getPref } from '../../core/prefs.js';
import { platform } from '@oie/web-shell';
import { alertBaseline, confirmIfAlertChanged } from '../alert-conflict.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';

/* com.mirth.connect.donkey.model.event.ErrorEventType */
export const ERROR_EVENT_TYPES = [
    'ANY', 'SOURCE_CONNECTOR', 'DESTINATION_CONNECTOR', 'SERIALIZER', 'FILTER',
    'TRANSFORMER', 'USER_DEFINED_TRANSFORMER', 'RESPONSE_VALIDATION',
    'RESPONSE_TRANSFORMER', 'ATTACHMENT_HANDLER', 'DEPLOY_SCRIPT',
    'PREPROCESSOR_SCRIPT', 'POSTPROCESSOR_SCRIPT', 'UNDEPLOY_SCRIPT'
];

const DEFAULT_PROTOCOLS = ['Email', 'Channel', 'User'];

/* Substitution variables available to alert subject/template (classic editor list). */
export const ALERT_VARIABLES = [
    'alertId', 'alertName', 'serverId', 'serverName', 'globalMapVariable',
    'date', 'systemTime', 'error', 'errorMessage', 'errorType',
    'channelId', 'channelName', 'connectorName', 'connectorType', 'messageId'
];

export function eventTypeLabel(type) {
    return String(type).toLowerCase().split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ---- model helpers (copied verbatim from views/alerts.js) -------------------- */

export function newAlert(name, version) {
    return {
        // '@version' is required — the engine's migrator 500s without it.
        '@version': version || '4.5.2',
        id: uuid(),
        name,
        enabled: false,
        trigger: {
            '@class': 'defaultTrigger',
            alertChannels: {
                newChannelSource: false,
                newChannelDestination: false,
                enabledChannels: null,
                disabledChannels: null,
                partialChannels: null
            },
            errorEventTypes: { errorEventType: ['ANY'] },
            regex: ''
        },
        actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] },
        properties: null
    };
}

function groupsOf(model) {
    return api.asList(model?.actionGroups, 'alertActionGroup');
}

/* Maps from /channels/idsAndNames arrive as { entry: [{ string: [id, name] }] }. */
function channelEntriesOf(raw) {
    const out = [];
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const pair = api.asList(entry?.string);
        if (pair.length) out.push({ id: String(pair[0]), name: String(pair[1] ?? pair[0]) });
    }
    return out;
}

/* Full channel models -> { id, name, connectors } where connectors mirrors the
   Swing AlertChannelPane rows: 'Source' (metaDataId 0), each destination by
   name, then the '[New Destinations]' pseudo-connector (metaDataId null). */
function channelConnectorEntriesOf(channels) {
    const entries = [];
    for (const channel of channels) {
        if (!channel || !channel.id) continue;
        const connectors = [{ name: 'Source', metaDataId: 0 }];
        for (const dest of api.asList(channel.destinationConnectors, 'connector')) {
            if (!dest || dest.metaDataId === undefined || dest.metaDataId === null) continue;
            connectors.push({ name: String(dest.name ?? `Destination ${dest.metaDataId}`), metaDataId: Number(dest.metaDataId) });
        }
        connectors.push({ name: '[New Destinations]', metaDataId: null });
        entries.push({ id: String(channel.id), name: String(channel.name ?? channel.id), connectors });
    }
    // The Swing pane sorts channels case-insensitively by name.
    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return entries;
}

/* Set<Integer> -> { int: [...] } plus an optional "null" key for the <null/>
   element ([New Destinations]). Returned as a Set of numbers and/or null. */
function connectorIdSetOf(raw) {
    const set = new Set();
    if (raw && typeof raw === 'object') {
        for (const v of api.asList(raw.int)) {
            const n = parseInt(v, 10);
            if (!isNaN(n)) set.add(n);
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'null')) set.add(null);
    }
    return set;
}

function connectorIdSetJson(ids) {
    const ints = ids.filter(id => id !== null);
    const out = {};
    if (ints.length) out.int = ints;
    if (ids.length > ints.length) out['null'] = null; // serializes back to <null/>
    return Object.keys(out).length ? out : null;
}

/* partialChannels Map<String, AlertConnectors> -> Map(channelId -> {enabled, disabled} id sets). */
function partialChannelsOf(raw) {
    const map = new Map();
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const id = entry?.string;
        if (id === undefined || id === null || id === '') continue;
        map.set(String(id), {
            enabled: connectorIdSetOf(entry?.alertConnectors?.enabledConnectors),
            disabled: connectorIdSetOf(entry?.alertConnectors?.disabledConnectors)
        });
    }
    return map;
}

/* /alerts/options is a Map<String, Map<String, String>> keyed by protocol name. */
export function protocolsOf(raw) {
    const names = [];
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const name = api.asList(entry?.string)[0];
        if (name) names.push(String(name));
    }
    return names.length ? names : DEFAULT_PROTOCOLS;
}

/* Parse the same map into per-protocol recipient options. The inner map is
   id -> name (e.g. Channel, User); a null/absent inner map means the protocol
   takes free-text recipients (e.g. Email). Recipients are stored by id and
   shown by name, mirroring the Swing AlertActionPane combo box
   (getRecipientIdFromName / getRecipientNameFromId). */
export function recipientOptionsOf(raw) {
    const out = {};
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const name = String(api.asList(entry?.string)[0] ?? '');
        if (!name) continue;
        const inner = entry?.map;
        if (!inner) { out[name] = null; continue; }   // free-text recipients
        const opts = [];
        for (const e of api.asList(inner?.entry)) {
            const pair = api.asList(e?.string);
            if (pair.length) opts.push({ value: String(pair[0]), label: String(pair[1] ?? pair[0]) });
        }
        out[name] = opts;
    }
    return out;
}

/* Mounts imperative DOM (built by `build()`) into a div, rebuilding on `deps`
   change. Reused for the heavy legacy form panels (errors / regex / actions /
   template / variables) kept verbatim. */
function ImperativeMount({ build, deps = [], className, style }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return;
        host.replaceChildren();
        const node = build();
        if (node) host.appendChild(node);
        return () => host.replaceChildren();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return <div ref={ref} className={className} style={style} />;
}

/* ---- editor view ------------------------------------------------------------------ */

export function AlertEditor({ params, query = {} }) {
    const alertId = params.alertId;
    const isNew = query.new === '1';

    const [, forceRender] = useReducer((x) => x + 1, 0);

    // The model is a mutable object held in a ref (NOT immutable React state):
    // its identity is what saveModel() mutates and api.alerts.update sends.
    const modelRef = useRef(null);
    const baselineRef = useRef(null);   // server copy at edit start (alert conflict check)
    const saveModelRef = useRef(() => {});

    // Channels-tree working state read by the JSX <TreeTable> + saveModel; kept
    // in refs (the form does not own immutable React state). null until loaded.
    const treeStateRef = useRef(null);
    const selectedNodeKeyRef = useRef(null);
    const channelFilterRef = useRef('');
    const collapsedRef = useRef(new Set());   // collapsed channel-node keys
    // The connector tree mounts eagerly (parity with Swing showing it on open).
    // engageTree() is kept as a harmless no-op so the existing Channels-control
    // handlers need no change.
    const treeEngagedRef = useRef(true);
    function engageTree() { if (!treeEngagedRef.current) { treeEngagedRef.current = true; forceRender(); } }

    // Form-pane builders (errors/regex/actions/template/variables), set when the
    // alert + options load. saveModel reads the controls they create via refs.
    const panelsRef = useRef(null);

    // Unsaved-changes detection: the serialized model captured once the form is
    // built (clean baseline). The nav guard re-serializes on leave and prompts
    // when it differs — no per-edit markDirty, no false positives from UI-only
    // state (filter/selection live outside the model).
    const cleanSnapshotRef = useRef(null);
    function syncedModelJson() {
        try { saveModelRef.current(); } catch { return null; }
        return JSON.stringify(modelRef.current);
    }

    async function save() {
        const model = modelRef.current;
        if (!model) return;
        try {
            saveModelRef.current();
            if (!String(model.name || '').trim()) { toast('Alert name is required', 'warn'); return; }
            if (isNew) {
                await api.alerts.create(model);
            } else {
                if (!await confirmIfAlertChanged(model.id, baselineRef.current)) return;
                await api.alerts.update(model.id, model);
            }
            store.setState('editingAlert', null);
            store.setState('navGuard', null);   // saved — don't prompt on the redirect
            toast(isNew ? `Alert "${model.name}" created` : `Alert "${model.name}" saved`);
            router.navigate('/alerts');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* Exports the saved alert as the engine's own <alertModel> XML (Swing
       format). Unsaved edits are not included — save first. */
    async function exportTask() {
        const model = modelRef.current;
        if (!model) return;
        if (isNew) { toast('Save the alert first, then export it', 'warn'); return; }
        try {
            await saveFile(`${model.name || model.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${model.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Alert not found on the server — save it first');
                return xml;
            });
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function load() {
        try {
            const stored = store.getState('editingAlert');
            let model;
            if (stored && stored.id === alertId) {
                model = stored;
            } else {
                model = await api.alerts.get(alertId);
            }
            if (!model || !model.id) throw new Error('Alert not found');
            modelRef.current = model;
            if (!isNew) alertBaseline(model.id).then((b) => { baselineRef.current = b; });

            // route:changed resets the banner to the static route title after this
            // async handler returns; defer past it (rAF runs after that microtask,
            // before paint) so 'Edit Alert - <name>' sticks without a flash.
            window.requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('webadmin:set-title', {
                detail: { title: isNew ? 'Edit Alert' : `Edit Alert - ${model.name || model.id}` }
            })));

            // Full channel models give us per-connector granularity (cached for
            // the lifetime of this editor); fall back to channel-level only.
            const [channelModels, optionsRaw] = await Promise.all([
                api.channels.list().catch(() => null),
                api.alerts.options().catch(() => null)
            ]);
            let channelEntries;
            let includeConnectors = channelModels !== null;
            if (includeConnectors) {
                channelEntries = channelConnectorEntriesOf(channelModels);
            } else {
                toast('Could not load channel connectors; channel-level granularity only', 'warn');
                channelEntries = channelEntriesOf(await api.channels.idsAndNames().catch(() => null));
            }
            buildForm(channelEntries, includeConnectors, protocolsOf(optionsRaw), recipientOptionsOf(optionsRaw));
            forceRender();
        } catch (e) {
            modelRef.current = null;
            panelsRef.current = null;
            treeStateRef.current = { loadError: e.message };
            forceRender();
        }
    }

    /* Builds the channels-tree working state + the heavy imperative form panels.
       The channels tree is rendered declaratively by <TreeTable>; the rest of the
       panels stay verbatim legacy DOM (mounted via <ImperativeMount>). saveModel
       reads everything back out of the closures captured here. */
    function buildForm(channelEntries, includeConnectors, protocols, recipientOptions = {}) {
        const model = modelRef.current;
        const trigger = model.trigger || (model.trigger = { '@class': 'defaultTrigger' });
        const alertChannels = trigger.alertChannels || (trigger.alertChannels = {
            newChannelSource: false, newChannelDestination: false,
            enabledChannels: null, disabledChannels: null, partialChannels: null
        });
        const groups = groupsOf(model);
        const group = groups[0] || { actions: null, subject: '', template: '' };
        if (!groups.length) groups.push(group);

        /* ---- top row: name + enabled ---- */

        const nameInput = textInput(model.name || '', { class: 'flex-1 max-w-[560px]' });
        const enabledCheck = checkbox('Enabled', model.enabled === true);
        // New alert: focus the empty Name field so the user can type immediately.
        if (isNew) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);

        const topRow = h('div', { class: 'flex items-center gap-3 mb-3.5' },
            h('label', { class: 'text-[11px] font-[650] tracking-[0.08em] uppercase text-text-dim' }, 'Alert Name:'),
            nameInput,
            enabledCheck.el);

        /* ---- column 1: error event types (DefaultTrigger) ---- */

        const selectedTypes = new Set(api.asList(trigger.errorEventTypes, 'errorEventType').map(String));
        const typeChecks = ERROR_EVENT_TYPES.map(type => {
            const cb = checkbox(eventTypeLabel(type), selectedTypes.has(type));
            return { type, cb };
        });

        const errorsBody = h('div.panel-body', { class: 'flex-1 flex flex-col gap-0.5 overflow-auto' },
            typeChecks.map(t => t.cb.el));

        /* ---- column 2: regex ---- */

        const regexInput = h('textarea', {
            placeholder: 'Only trigger when the error matches this regular expression (leave blank to match any error)',
            class: 'flex-1 resize-none min-h-[180px] font-mono'
        }, trigger.regex ?? '');

        const regexBody = h('div.panel-body', { class: 'flex-1 flex min-h-0' }, regexInput);

        /* ---- column 3: channels tree (connector-level granularity, classic pane) ---- */

        const enabledChannelSet = new Set(api.asList(alertChannels.enabledChannels, 'string').map(String));
        const disabledChannelSet = new Set(api.asList(alertChannels.disabledChannels, 'string').map(String));
        const partialMap = partialChannelsOf(alertChannels.partialChannels);

        // AlertChannels.isConnectorEnabled() / isChannelEnabled() in JS.
        function connectorEnabled(channelId, metaDataId) {
            if (enabledChannelSet.has(channelId)) return true;
            if (disabledChannelSet.has(channelId)) return false;
            const partial = partialMap.get(channelId);
            if (partial) {
                return partial.enabled.has(metaDataId) ||
                    (partial.enabled.has(null) && !partial.disabled.has(metaDataId));
            }
            return (metaDataId === null || metaDataId > 0)
                ? alertChannels.newChannelDestination === true
                : alertChannels.newChannelSource === true;
        }

        function channelEnabled(channelId) {
            if (enabledChannelSet.has(channelId)) return true;
            if (disabledChannelSet.has(channelId)) return false;
            const partial = partialMap.get(channelId);
            if (partial) return partial.enabled.size > 0;
            return alertChannels.newChannelSource === true || alertChannels.newChannelDestination === true;
        }

        // Tree state. The '[New Channels]' pseudo-node binds Source ->
        // newChannelSource and [New Destinations] -> newChannelDestination.
        const newChannelsNode = {
            id: null, name: '[New Channels]', dirty: false,
            connectors: includeConnectors ? [
                { name: 'Source', metaDataId: 0, enabled: alertChannels.newChannelSource === true },
                { name: '[New Destinations]', metaDataId: null, enabled: alertChannels.newChannelDestination === true }
            ] : null,
            enabled: alertChannels.newChannelSource === true || alertChannels.newChannelDestination === true
        };
        const channelNodes = channelEntries.map(entry => ({
            id: entry.id, name: entry.name, dirty: false,
            connectors: includeConnectors
                ? entry.connectors.map(c => ({ ...c, enabled: connectorEnabled(entry.id, c.metaDataId) }))
                : null,
            enabled: channelEnabled(entry.id)
        }));
        const allChannelNodes = [newChannelsNode, ...channelNodes];

        treeStateRef.current = {
            includeConnectors, channelEntries, allChannelNodes, newChannelsNode, channelNodes,
            alertChannels, enabledChannelSet, disabledChannelSet
        };
        selectedNodeKeyRef.current = null;
        channelFilterRef.current = '';
        collapsedRef.current = new Set();

        /* ---- bottom column 1: actions (protocol/recipient pairs) ---- */

        let actionRows = api.asList(group.actions, 'alertAction')
            .map(a => ({ protocol: String(a?.protocol ?? protocols[0]), recipient: String(a?.recipient ?? '') }));

        const actionsHost = h('div');

        const addAction = () => { actionRows.push({ protocol: protocols[0], recipient: '' }); renderActions(); };
        const removeAction = (row) => { actionRows = actionRows.filter(r => r !== row); renderActions(); };
        // Right-click parity (Swing alert action popup): Add Action anywhere in the
        // panel, Delete Action on a row.
        actionsHost.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const tr = e.target.closest('tbody tr');
            const row = tr ? actionRows[[...tr.parentNode.children].indexOf(tr)] : null;
            const items = [{ label: 'Add Action', icon: 'plus', onClick: addAction }];
            if (row) items.push({ label: 'Delete Action', icon: 'trash', danger: true, onClick: () => removeAction(row) });
            contextMenu(e.clientX, e.clientY, items);
        });

        // Channel/User protocols carry an id->name option list (from /alerts/options);
        // fall back to the loaded channel list for Channel if the server omits it.
        function recipientList(protocol) {
            const opts = recipientOptions[protocol];
            if (opts && opts.length) return opts;
            if (protocol === 'Channel' && channelEntries.length) {
                return channelEntries.map(c => ({ value: c.id, label: c.name }));
            }
            return null;
        }

        function recipientControl(row) {
            const list = recipientList(row.protocol);
            if (list) {
                // Blank choice first; preserve an unknown current value so it round-trips.
                const full = [{ value: '', label: '' }, ...list];
                if (row.recipient && !list.some(o => String(o.value) === String(row.recipient))) {
                    full.push({ value: row.recipient, label: row.recipient });
                }
                return select(full, row.recipient, { onChange: (e) => { row.recipient = e.target.value; } });
            }
            return textInput(row.recipient, {
                placeholder: 'Recipient',
                onInput: (e) => { row.recipient = e.target.value; }
            });
        }

        function renderActions() {
            clear(actionsHost);
            if (!actionRows.length) {
                actionsHost.appendChild(h('div.text-text-dim', { class: 'py-1.5 px-0' }, 'No actions defined'));
                return;
            }
            const tbody = h('tbody');
            for (const row of actionRows) {
                // Switching protocol clears the recipient and swaps the editor (combo vs text).
                const protocolSel = select(protocols, row.protocol, { onChange: (e) => {
                    row.protocol = e.target.value;
                    row.recipient = '';
                    renderActions();
                } });
                tbody.appendChild(h('tr',
                    h('td', { class: 'w-[120px]' }, protocolSel),
                    h('td', recipientControl(row)),
                    h('td', { class: 'w-[40px] text-right' },
                        h('button.icon-btn', {
                            title: 'Remove action',
                            onClick: () => removeAction(row)
                        }, icon('trash')))));
            }
            actionsHost.appendChild(h('div.dt-wrap', h('table.dt',
                h('thead', h('tr', h('th', 'Protocol'), h('th', 'Recipient'), h('th', ''))),
                tbody)));
        }
        renderActions();

        const actionsBody = h('div.panel-body', { class: 'flex-1 flex flex-col min-h-0' },
            h('div', { class: 'flex-1 overflow-auto min-h-0' }, actionsHost),
            h('div.mt-[14px]', taskButton('Add', 'plus', addAction)));

        /* ---- bottom column 2: subject + template ---- */

        const subjectInput = textInput(group.subject ?? '');
        const templateInput = h('textarea', { rows: 8, class: 'flex-1 resize-none min-h-[140px]' }, group.template ?? '');

        // Variables insert into whichever of subject/template was last focused.
        let lastFocused = null;
        subjectInput.addEventListener('focus', () => { lastFocused = subjectInput; });
        templateInput.addEventListener('focus', () => { lastFocused = templateInput; });

        const messageBody = h('div.panel-body', { class: 'flex-1 flex flex-col min-h-0' },
            field('Subject (only used for email messages)', subjectInput),
            h('div.field', { class: 'flex-1 flex min-h-0 mb-0' },
                h('label', 'Template'),
                templateInput));

        /* ---- bottom column 3: alert variables ---- */

        function insertVariable(name) {
            const target = lastFocused || templateInput;
            const text = '${' + name + '}';
            let start = target.selectionStart ?? target.value.length;
            let end = target.selectionEnd ?? start;
            if (!lastFocused) start = end = target.value.length; // never focused: append to template
            target.value = target.value.slice(0, start) + text + target.value.slice(end);
            const pos = start + text.length;
            target.focus();
            target.setSelectionRange(pos, pos);
        }

        const variablesBody = h('div.panel-body.flush', { class: 'flex-1 overflow-auto min-h-0 p-1.5' },
            h('div.tree', ALERT_VARIABLES.map(name =>
                h('div.tree-node', {
                    title: 'Insert ${' + name + '} (drag onto the subject/template or click)',
                    draggable: 'true',
                    class: 'cursor-grab',
                    onClick: () => insertVariable(name),
                    onDragstart: (e) => {
                        e.dataTransfer.setData('text/plain', '${' + name + '}');
                        e.dataTransfer.effectAllowed = 'copy';
                    }
                }, name))));

        /* ---- collect form values back into the round-tripped model ---- */

        saveModelRef.current = () => {
            model.name = nameInput.value.trim();
            model.enabled = enabledCheck.input.checked;

            const types = typeChecks.filter(t => t.cb.input.checked).map(t => t.type);
            trigger.errorEventTypes = types.length ? { errorEventType: types } : null;
            trigger.regex = regexInput.value;

            if (includeConnectors) {
                // Rebuild AlertChannels from the tree, mirroring the Swing
                // ChannelTreeTableModel.getAlertChannels() + AlertChannels.addChannel().
                const newSource = newChannelsNode.connectors[0].enabled;
                const newDestination = newChannelsNode.connectors[1].enabled;
                const fullEnabled = [];
                const fullDisabled = [];
                const partialEntries = [];
                for (const node of channelNodes) {
                    let allEnabled = true, allDisabled = true, matchesNewChannel = true;
                    const en = [], dis = [];
                    for (const c of node.connectors) {
                        if (c.enabled) { allDisabled = false; en.push(c.metaDataId); }
                        else { allEnabled = false; dis.push(c.metaDataId); }
                        const newDefault = (c.metaDataId === null || c.metaDataId > 0) ? newDestination : newSource;
                        if (c.enabled !== newDefault) matchesNewChannel = false;
                    }
                    if (matchesNewChannel) continue; // matches new-channel defaults: omit
                    if (allEnabled) fullEnabled.push(node.id);
                    else if (allDisabled) fullDisabled.push(node.id);
                    else partialEntries.push({
                        string: node.id,
                        alertConnectors: {
                            enabledConnectors: connectorIdSetJson(en),
                            disabledConnectors: connectorIdSetJson(dis)
                        }
                    });
                }
                alertChannels.newChannelSource = newSource;
                alertChannels.newChannelDestination = newDestination;
                alertChannels.enabledChannels = fullEnabled.length ? { string: fullEnabled } : null;
                alertChannels.disabledChannels = fullDisabled.length ? { string: fullDisabled } : null;
                alertChannels.partialChannels = partialEntries.length ? { entry: partialEntries } : null;
            } else {
                // Channel-level fallback: only channels the user actually toggled
                // move between the sets; everything else round-trips untouched.
                const en = new Set(enabledChannelSet);
                const dis = new Set(disabledChannelSet);
                const dirtyIds = new Set();
                for (const node of channelNodes) {
                    if (!node.dirty) continue;
                    dirtyIds.add(node.id);
                    en.delete(node.id);
                    dis.delete(node.id);
                    (node.enabled ? en : dis).add(node.id);
                }
                alertChannels.enabledChannels = en.size ? { string: [...en] } : null;
                alertChannels.disabledChannels = dis.size ? { string: [...dis] } : null;
                if (dirtyIds.size) {
                    const rawEntries = api.asList(alertChannels.partialChannels?.entry ?? alertChannels.partialChannels)
                        .filter(entry => !dirtyIds.has(String(entry?.string)));
                    alertChannels.partialChannels = rawEntries.length ? { entry: rawEntries } : null;
                }
                if (newChannelsNode.dirty) {
                    alertChannels.newChannelSource = newChannelsNode.enabled;
                    alertChannels.newChannelDestination = newChannelsNode.enabled;
                }
            }

            group.subject = subjectInput.value;
            group.template = templateInput.value;
            const actions = actionRows
                .filter(r => r.recipient.trim() || r.protocol)
                .map(r => ({ protocol: r.protocol, recipient: r.recipient }));
            group.actions = actions.length ? { alertAction: actions } : null;
            model.actionGroups = { alertActionGroup: groups };
        };

        panelsRef.current = {
            topRow: () => topRow,
            errorsBody: () => errorsBody,
            regexBody: () => regexBody,
            actionsBody: () => actionsBody,
            messageBody: () => messageBody,
            variablesBody: () => variablesBody
        };
    }

    /* ---- channels-tree helpers (read/write treeStateRef; repaint via forceRender) ---- */

    const channelKey = (node) => 'ch:' + (node.id ?? '[new]');
    const connectorKey = (node, c) => channelKey(node) + '/' + (c.metaDataId ?? 'new');

    function channelPipState(node) {
        if (!node.connectors) return node.enabled ? 'ok' : 'err';
        const hasEnabled = node.connectors.some(c => c.enabled);
        const hasDisabled = node.connectors.some(c => !c.enabled);
        return hasEnabled && hasDisabled ? 'warn' : (hasEnabled ? 'ok' : 'err');
    }

    function setChannelNode(node, enabled) {
        if (node.connectors) for (const c of node.connectors) c.enabled = enabled;
        else { node.enabled = enabled; node.dirty = true; }
    }

    // Enable/Disable buttons act on the selected node; a channel node
    // cascades to all of its connectors (classic toggleSelectedRows()).
    function setSelectedNode(enabled) {
        const state = treeStateRef.current;
        if (!state || !state.allChannelNodes) return;
        const selectedNodeKey = selectedNodeKeyRef.current;
        for (const node of state.allChannelNodes) {
            if (channelKey(node) === selectedNodeKey) {
                setChannelNode(node, enabled);
                forceRender();
                return;
            }
            for (const c of node.connectors || []) {
                if (connectorKey(node, c) === selectedNodeKey) {
                    c.enabled = enabled;
                    forceRender();
                    return;
                }
            }
        }
        toast('Select a channel or connector in the tree first', 'warn');
    }

    function setAllExpanded(expanded) {
        const state = treeStateRef.current;
        if (!state || !state.allChannelNodes) return;
        const collapsed = collapsedRef.current;
        for (const node of state.allChannelNodes) {
            if (!node.connectors) continue;
            if (expanded) collapsed.delete(channelKey(node));
            else collapsed.add(channelKey(node));
        }
        forceRender();
    }

    // Build the imperative form panels once loaded, then load. Callbacks above
    // read the current model/saveModel/tree state via refs, so this mount-once
    // effect is correct.
    useEffect(() => {
        load();
        // Prompt before leaving with unsaved alert edits (Swing parity).
        store.setState('navGuard', async () => {
            if (cleanSnapshotRef.current === null || !modelRef.current) return;
            const now = syncedModelJson();
            if (now === null || now === cleanSnapshotRef.current) return;
            // No save permission -> say the edits can't be kept (channel editor parity).
            const ok = platform.checkTask('alertEdit', 'doSaveAlerts')
                ? await confirmDialog('Unsaved Changes',
                    'You have unsaved alert changes. Leave without saving?',
                    { danger: true, okLabel: 'Leave' })
                : await confirmDialog('Unsaved Changes',
                    "You don't have permission to save alert changes. Leaving will discard them.",
                    { okLabel: 'OK' });
            return ok ? undefined : false;
        });
        // Tab-close guard: same snapshot comparison, synchronous (core/unsaved.js).
        const unregister = registerUnsavedCheck(() => {
            if (cleanSnapshotRef.current === null || !modelRef.current) return false;
            const now = syncedModelJson();
            return now !== null && now !== cleanSnapshotRef.current;
        });
        return () => { store.setState('navGuard', null); unregister(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Capture the clean baseline once the form panels are built (before edits).
    useEffect(() => {
        if (cleanSnapshotRef.current === null && panelsRef.current && modelRef.current) {
            cleanSnapshotRef.current = syncedModelJson();
        }
    });

    const state = treeStateRef.current;
    const panels = panelsRef.current;
    const loadError = state && state.loadError;

    // <TreeTable> data + columns for the channels tree. Channel nodes are parents,
    // their connectors are children (only when connector-granular). The tree column
    // renders the clickable pip + the name.
    function treeData() {
        if (!state || !state.allChannelNodes) return [];
        return state.allChannelNodes.map(node => ({
            kind: 'channel', node,
            children: node.connectors
                ? node.connectors.map(c => ({ kind: 'connector', node, c }))
                : null
        }));
    }

    function pip(stateClass, onToggle) {
        return (
            <span className={'pip cursor-pointer flex-none' + (stateClass ? ' ' + stateClass : '')}
                title="Toggle enabled"
                onClick={(e) => { e.stopPropagation(); onToggle(); }} />
        );
    }

    const channelColumns = [{
        key: 'name', label: 'Channel', tree: true,
        render: (n) => {
            if (n.kind === 'connector') {
                return (
                    <span className="inline-flex items-center gap-[7px]">
                        {pip(n.c.enabled ? 'ok' : 'err', () => { n.c.enabled = !n.c.enabled; forceRender(); })}
                        <span>{n.c.name}</span>
                    </span>
                );
            }
            // Channel pip: green all-on, red all-off, amber mixed; clicking it
            // toggles the whole channel (mixed -> fully enabled).
            return (
                <span className="inline-flex items-center gap-[7px]">
                    {pip(channelPipState(n.node), () => { setChannelNode(n.node, channelPipState(n.node) !== 'ok'); forceRender(); })}
                    <span>{n.node.name}</span>
                </span>
            );
        }
    }];

    const filterTerm = channelFilterRef.current.trim().toLowerCase();
    const treeMatches = filterTerm
        ? (n) => {
            if (n.kind === 'connector') return n.c.name.toLowerCase().includes(filterTerm);
            return n.node.name.toLowerCase().includes(filterTerm) ||
                (n.node.connectors || []).some(c => c.name.toLowerCase().includes(filterTerm));
        }
        : undefined;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Alert Edit Tasks" paneKey="tasks:Alert Edit Tasks" group="alertEdit">
                    <div className="taskbar" data-pane-title="Alert Edit Tasks">
                        <TaskButton label="Save Alert" icon="save" primary task="doSaveAlerts" onClick={save} />
                        <TaskButton label="Export Alert" icon="export" task="doExportAlert" onClick={exportTask} />
                        {getPref('showViewSwitch') !== false && <TaskButton label="Open in Wizard" icon="wand" onClick={() => {
                            const model = modelRef.current;
                            store.setState('editingAlert', model);
                            store.setState('editingAlertNew', isNew);
                            store.setState('navGuard', null);
                            router.navigate(isNew || !model ? '/alerts/new/guided' : `/alerts/${model.id}/guided`);
                        }} />}
                        <span className="sep" />
                        <TaskButton label="Back to Alerts" icon="logout" onClick={() => router.navigate('/alerts')} />
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                {loadError
                    ? <div className="dt-empty">
                        <div className="empty-icon"><Icon name="alerts" size={30} /></div>
                        <div>Could not load alert: {loadError}</div>
                    </div>
                    : !panels
                        ? <div ref={(el) => { if (el && !el.firstChild) el.appendChild(loading('Loading alert…')); }} />
                        : (
                            <>
                                <ImperativeMount build={panels.topRow} />
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3.5 items-stretch">
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Errors (select all that apply)</div>
                                        <ImperativeMount build={panels.errorsBody} className="flex flex-col flex-1 min-h-0" />
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Regex (optional)</div>
                                        <ImperativeMount build={panels.regexBody} className="flex flex-col flex-1 min-h-0" />
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Channels</div>
                                        <div className="panel-body flex-1 flex flex-col gap-2 min-h-0">
                                            <div className="flex gap-1.5 items-center">
                                                <input type="text" placeholder="Filter channels" className="flex-1"
                                                    defaultValue={channelFilterRef.current}
                                                    onFocus={engageTree}
                                                    onInput={(e) => { channelFilterRef.current = e.target.value; engageTree(); forceRender(); }} />
                                                <TaskButton label="Enable" icon="check" onClick={() => { engageTree(); setSelectedNode(true); }} />
                                                <TaskButton label="Disable" icon="x" onClick={() => { engageTree(); setSelectedNode(false); }} />
                                            </div>
                                            {state.includeConnectors
                                                ? <div className="flex gap-2.5 justify-end">
                                                    <span title="Expand all nodes below." className="text-accent cursor-pointer underline text-[12px]"
                                                        onClick={() => { engageTree(); setAllExpanded(true); }}>Expand All</span>
                                                    <span title="Collapse all nodes below." className="text-accent cursor-pointer underline text-[12px]"
                                                        onClick={() => { engageTree(); setAllExpanded(false); }}>Collapse All</span>
                                                </div>
                                                : null}
                                            <div className="tree flex-1 min-h-0 max-h-[320px] overflow-auto"
                                                onPointerDown={engageTree}>
                                                {treeEngagedRef.current
                                                    ? <TreeTable
                                                        data={treeData()}
                                                        columns={channelColumns}
                                                        getChildren={(n) => n.children}
                                                        rowKey={(n) => n.kind === 'connector' ? connectorKey(n.node, n.c) : channelKey(n.node)}
                                                        selectedKey={selectedNodeKeyRef.current}
                                                        onSelect={(n) => { selectedNodeKeyRef.current = n.kind === 'connector' ? connectorKey(n.node, n.c) : channelKey(n.node); forceRender(); }}
                                                        matches={treeMatches}
                                                        collapsedKeys={collapsedRef.current}
                                                        onToggleCollapse={(key) => { const s = collapsedRef.current; if (s.has(key)) s.delete(key); else s.add(key); forceRender(); }}
                                                        columnsKey="alert-channels"
                                                        pinnedKeys={['name']}
                                                        emptyText="No matching channels" />
                                                    : <div className="text-text-dim py-1.5 px-2.5">
                                                        {treeData().length
                                                            ? `${state.channelNodes.length} channel${state.channelNodes.length === 1 ? '' : 's'} — click to configure connector enablement`
                                                            : 'No channels'}
                                                    </div>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3.5 mt-3.5 items-stretch">
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Actions</div>
                                        <ImperativeMount build={panels.actionsBody} className="flex flex-col flex-1 min-h-0" />
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Template</div>
                                        <ImperativeMount build={panels.messageBody} className="flex flex-col flex-1 min-h-0" />
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Alert Variables</div>
                                        <ImperativeMount build={panels.variablesBody} className="flex flex-col flex-1 min-h-0" />
                                    </div>
                                </div>
                            </>
                        )}
            </div>
        </div>
    );
}
