/*
 * Alert editor — fully declarative React. The form body (name/enabled, the
 * error-type checkboxes, regex, the actions protocol/recipient table with its
 * right-click Add/Delete, subject/template with the draggable alert variables)
 * is controlled JSX bound to form state; the connector-granular CHANNELS TREE
 * (clickable pip toggles, filter, Expand/Collapse All, Enable/Disable selected)
 * is the declarative <TreeTable>.
 *
 * The MODEL stays a mutable ref (NOT cloned into immutable state) — its
 * @version/trigger/actionGroups identity is what saveModel() writes and what
 * api.alerts.update sends, with unknown engine fields round-tripping untouched.
 * saveModel() reads the FORM STATE (not the DOM, as the legacy did) and
 * serializes the AlertChannels byte-exactly with the Swing export; the
 * saveModelRef bridge is re-pointed every render so the mount-captured
 * navGuard/tab-close snapshot comparison always runs the latest closure.
 * Channel-tree nodes are an edit-session structure in state: node flags are
 * mutated in place and the container identity is bumped to repaint.
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

import { useEffect, useRef, useState } from 'react';
import { toast, contextMenu, confirmDialog, saveFile } from '@oie/web-ui';
import api, { uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { getPref } from '../../core/prefs.js';
import { platform } from '@oie/web-shell';
import { alertBaseline, confirmIfAlertChanged } from '../alert-conflict.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { useInvalidate } from '../queries.js';
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

export function eventTypeLabel(type: any) {
    return String(type).toLowerCase().split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/* ---- model helpers (copied verbatim from views/alerts.js) -------------------- */

export function newAlert(name: any, version: any) {
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

function groupsOf(model: any) {
    return api.asList(model?.actionGroups, 'alertActionGroup');
}

/* Maps from /channels/idsAndNames arrive as { entry: [{ string: [id, name] }] }. */
function channelEntriesOf(raw: any) {
    const out: any[] = [];
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const pair = api.asList(entry?.string);
        if (pair.length) out.push({ id: String(pair[0]), name: String(pair[1] ?? pair[0]) });
    }
    return out;
}

/* Full channel models -> { id, name, connectors } where connectors mirrors the
   Swing AlertChannelPane rows: 'Source' (metaDataId 0), each destination by
   name, then the '[New Destinations]' pseudo-connector (metaDataId null). */
function channelConnectorEntriesOf(channels: any) {
    const entries: any[] = [];
    for (const channel of channels) {
        if (!channel || !channel.id) continue;
        const connectors = [{ name: 'Source', metaDataId: 0 }];
        for (const dest of api.asList(channel.destinationConnectors, 'connector')) {
            if (!dest || dest.metaDataId === undefined || dest.metaDataId === null) continue;
            connectors.push({ name: String(dest.name ?? `Destination ${dest.metaDataId}`), metaDataId: Number(dest.metaDataId) });
        }
        connectors.push({ name: '[New Destinations]', metaDataId: null as any });
        entries.push({ id: String(channel.id), name: String(channel.name ?? channel.id), connectors });
    }
    // The Swing pane sorts channels case-insensitively by name.
    entries.sort((a: any, b: any) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return entries;
}

/* Set<Integer> -> { int: [...] } plus an optional "null" key for the <null/>
   element ([New Destinations]). Returned as a Set of numbers and/or null. */
function connectorIdSetOf(raw: any) {
    const set = new Set();
    if (raw && typeof raw === 'object') {
        for (const v of api.asList(raw.int)) {
            const n = parseInt(v as any, 10);
            if (!isNaN(n)) set.add(n);
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'null')) set.add(null);
    }
    return set;
}

function connectorIdSetJson(ids: any) {
    const ints = ids.filter((id: any) => id !== null);
    const out: any = {};
    if (ints.length) out.int = ints;
    if (ids.length > ints.length) out['null'] = null; // serializes back to <null/>
    return Object.keys(out).length ? out : null;
}

/* partialChannels Map<String, AlertConnectors> -> Map(channelId -> {enabled, disabled} id sets). */
function partialChannelsOf(raw: any) {
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
export function protocolsOf(raw: any) {
    const names: any[] = [];
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
export function recipientOptionsOf(raw: any) {
    const out: any = {};
    for (const entry of api.asList(raw?.entry ?? raw)) {
        const name = String(api.asList(entry?.string)[0] ?? '');
        if (!name) continue;
        const inner = entry?.map;
        if (!inner) { out[name] = null; continue; }   // free-text recipients
        const opts: any[] = [];
        for (const e of api.asList(inner?.entry)) {
            const pair = api.asList(e?.string);
            if (pair.length) opts.push({ value: String(pair[0]), label: String(pair[1] ?? pair[0]) });
        }
        out[name] = opts;
    }
    return out;
}

/* Channel/User protocols carry an id->name option list (from /alerts/options);
   fall back to the loaded channel list for Channel if the server omits it. */
function recipientList(protocol: any, tree: any) {
    const opts = tree.recipientOptions[protocol];
    if (opts && opts.length) return opts;
    if (protocol === 'Channel' && tree.channelEntries.length) {
        return tree.channelEntries.map((c: any) => ({ value: c.id, label: c.name }));
    }
    return null;
}

/* Recipient editor: a combo for list-carrying protocols (blank choice first; an
   unknown current value is preserved so it round-trips), else free text. */
function RecipientControl({ row, index, tree, patchAction }: any) {
    const list = recipientList(row.protocol, tree);
    if (list) {
        const full = [{ value: '', label: '' }, ...list];
        if (row.recipient && !list.some((o: any) => String(o.value) === String(row.recipient))) {
            full.push({ value: row.recipient, label: row.recipient });
        }
        return (
            <select value={row.recipient || ''} onChange={(e: any) => patchAction(index, { recipient: e.target.value })}>
                {full.map((o: any, i: any) => <option key={i} value={o.value}>{o.label}</option>)}
            </select>
        );
    }
    return (
        <input type="text" placeholder="Recipient" value={row.recipient}
            onChange={(e: any) => patchAction(index, { recipient: e.target.value })} />
    );
}

/* ---- editor view ------------------------------------------------------------------ */

export function AlertEditor({ params, query = {} }: any) {
    const alertId = params.alertId;
    const isNew = query.new === '1';
    // The list's ['alerts'] cache outlives this view (30s staleTime), so a save has
    // to mark it stale or the list we redirect back to repaints the pre-edit rows
    // until its 5s poll happens to tick.
    const invalidate = useInvalidate();

    // The model is a mutable object held in a ref (NOT immutable React state):
    // its identity is what saveModel() mutates and api.alerts.update sends.
    const modelRef = useRef<any>(null);
    const baselineRef = useRef<any>(null);   // server copy at edit start (alert conflict check)
    // Bridge for the mount-captured navGuard/tab-close guards: re-pointed at the
    // latest saveModel closure every render.
    const saveModelRef = useRef(() => {});

    /* Form state (controlled inputs). null until the alert + options load. */
    const [form, setForm] = useState<any>(null);
    const patchForm = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

    /* Channels-tree edit-session structure: node `enabled`/`dirty` flags are
       mutated in place (saveModel serializes from the same objects); touchTree()
       bumps the container identity to repaint. null until loaded; holds
       { loadError } when the alert could not load. */
    const [tree, setTree] = useState<any>(null);
    const touchTree = () => setTree((t: any) => (t ? { ...t } : t));
    const [selectedNodeKey, setSelectedNodeKey] = useState<any>(null);
    const [channelFilter, setChannelFilter] = useState('');
    const [collapsed, setCollapsed] = useState(() => new Set());

    // Unsaved-changes detection: the serialized model captured once the form is
    // built (clean baseline). The nav guard re-serializes on leave and prompts
    // when it differs — no per-edit markDirty, no false positives from UI-only
    // state (filter/selection live outside the model).
    const cleanSnapshotRef = useRef<any>(null);
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
            await invalidate('alerts');
            toast(isNew ? `Alert "${model.name}" created` : `Alert "${model.name}" saved`);
            router.navigate('/alerts');
        } catch (e: any) {
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
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    async function load() {
        try {
            const stored = store.getState('editingAlert');
            let model: any;
            if (stored && stored.id === alertId) {
                model = stored;
            } else {
                model = await api.alerts.get(alertId);
            }
            if (!model || !model.id) throw new Error('Alert not found');
            modelRef.current = model;
            if (!isNew) alertBaseline(model.id).then((b: any) => { baselineRef.current = b; });

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
            let channelEntries: any;
            let includeConnectors = channelModels !== null;
            if (includeConnectors) {
                channelEntries = channelConnectorEntriesOf(channelModels);
            } else {
                toast('Could not load channel connectors; channel-level granularity only', 'warn');
                channelEntries = channelEntriesOf(await api.channels.idsAndNames().catch(() => null));
            }
            initForm(channelEntries, includeConnectors, protocolsOf(optionsRaw), recipientOptionsOf(optionsRaw));
        } catch (e: any) {
            modelRef.current = null;
            setForm(null);
            setTree({ loadError: e.message });
        }
    }

    /* Builds the channels-tree working state + seeds the form state from the
       loaded model. The tree nodes' enabled/dirty flags are the objects
       saveModel() serializes from. */
    function initForm(channelEntries: any, includeConnectors: any, protocols: any, recipientOptions: any = {}) {
        const model = modelRef.current;
        const trigger = model.trigger || (model.trigger = { '@class': 'defaultTrigger' });
        const alertChannels = trigger.alertChannels || (trigger.alertChannels = {
            newChannelSource: false, newChannelDestination: false,
            enabledChannels: null, disabledChannels: null, partialChannels: null
        });
        const groups = groupsOf(model);
        const group = groups[0] || { actions: null, subject: '', template: '' };
        if (!groups.length) groups.push(group);

        /* ---- channels tree working state (connector-level granularity) ---- */

        const enabledChannelSet = new Set(api.asList(alertChannels.enabledChannels, 'string').map(String));
        const disabledChannelSet = new Set(api.asList(alertChannels.disabledChannels, 'string').map(String));
        const partialMap = partialChannelsOf(alertChannels.partialChannels);

        // AlertChannels.isConnectorEnabled() / isChannelEnabled() in JS.
        function connectorEnabled(channelId: any, metaDataId: any) {
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

        function channelEnabled(channelId: any) {
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
        const channelNodes = channelEntries.map((entry: any) => ({
            id: entry.id, name: entry.name, dirty: false,
            connectors: includeConnectors
                ? entry.connectors.map((c: any) => ({ ...c, enabled: connectorEnabled(entry.id, c.metaDataId) }))
                : null,
            enabled: channelEnabled(entry.id)
        }));
        const allChannelNodes = [newChannelsNode, ...channelNodes];

        setTree({
            includeConnectors, channelEntries, allChannelNodes, newChannelsNode, channelNodes,
            alertChannels, enabledChannelSet, disabledChannelSet,
            protocols, recipientOptions
        });
        setSelectedNodeKey(null);
        setChannelFilter('');
        setCollapsed(new Set());

        /* ---- seed the form state from the model ---- */
        setForm({
            name: model.name || '',
            enabled: model.enabled === true,
            types: api.asList(trigger.errorEventTypes, 'errorEventType').map(String),
            regex: trigger.regex ?? '',
            subject: group.subject ?? '',
            template: group.template ?? '',
            actionRows: api.asList(group.actions, 'alertAction')
                .map(a => ({ protocol: String(a?.protocol ?? protocols[0]), recipient: String(a?.recipient ?? '') }))
        });
    }

    /* ---- collect the form + tree state back into the round-tripped model ----
       The AlertChannels rebuild mirrors Swing's ChannelTreeTableModel
       .getAlertChannels() + AlertChannels.addChannel() byte-exactly. Re-created
       every render (reads form/tree state); saveModelRef points at the latest
       closure for the mount-captured guards. */
    function saveModel() {
        const model = modelRef.current;
        if (!model || !form || !tree || tree.loadError) return;
        const trigger = model.trigger;
        const alertChannels = trigger.alertChannels;
        const groups = groupsOf(model);
        const group = groups[0] || { actions: null, subject: '', template: '' };
        if (!groups.length) groups.push(group);

        model.name = form.name.trim();
        model.enabled = form.enabled;
        // Canonical ERROR_EVENT_TYPES order (as the classic editor emitted):
        // toggle order must not change the PUT bytes or trip the dirty snapshot.
        // Unknown server-seeded values are preserved after the known set
        // (round-trip invariant — the old editor silently dropped them).
        const types = [
            ...ERROR_EVENT_TYPES.filter(t => form.types.includes(t)),
            ...form.types.filter((t: any) => !ERROR_EVENT_TYPES.includes(t))
        ];
        trigger.errorEventTypes = types.length ? { errorEventType: types } : null;
        trigger.regex = form.regex;

        if (tree.includeConnectors) {
            const { newChannelsNode, channelNodes } = tree;
            const newSource = newChannelsNode.connectors[0].enabled;
            const newDestination = newChannelsNode.connectors[1].enabled;
            const fullEnabled: any[] = [];
            const fullDisabled: any[] = [];
            const partialEntries: any[] = [];
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
            const en = new Set(tree.enabledChannelSet);
            const dis = new Set(tree.disabledChannelSet);
            const dirtyIds = new Set();
            for (const node of tree.channelNodes) {
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
            if (tree.newChannelsNode.dirty) {
                alertChannels.newChannelSource = tree.newChannelsNode.enabled;
                alertChannels.newChannelDestination = tree.newChannelsNode.enabled;
            }
        }

        group.subject = form.subject;
        group.template = form.template;
        const actions = form.actionRows
            .filter((r: any) => r.recipient.trim() || r.protocol)
            .map((r: any) => ({ protocol: r.protocol, recipient: r.recipient }));
        group.actions = actions.length ? { alertAction: actions } : null;
        model.actionGroups = { alertActionGroup: groups };
    }
    saveModelRef.current = saveModel;

    /* ---- channels-tree helpers (mutate nodes in place; touchTree repaints) ---- */

    const channelKey = (node: any) => 'ch:' + (node.id ?? '[new]');
    const connectorKey = (node: any, c: any) => channelKey(node) + '/' + (c.metaDataId ?? 'new');

    function channelPipState(node: any) {
        if (!node.connectors) return node.enabled ? 'ok' : 'err';
        const hasEnabled = node.connectors.some((c: any) => c.enabled);
        const hasDisabled = node.connectors.some((c: any) => !c.enabled);
        return hasEnabled && hasDisabled ? 'warn' : (hasEnabled ? 'ok' : 'err');
    }

    function setChannelNode(node: any, enabled: any) {
        if (node.connectors) for (const c of node.connectors) c.enabled = enabled;
        else { node.enabled = enabled; node.dirty = true; }
    }

    // Enable/Disable buttons act on the selected node; a channel node
    // cascades to all of its connectors (classic toggleSelectedRows()).
    function setSelectedNode(enabled: any) {
        if (!tree || !tree.allChannelNodes) return;
        for (const node of tree.allChannelNodes) {
            if (channelKey(node) === selectedNodeKey) {
                setChannelNode(node, enabled);
                touchTree();
                return;
            }
            for (const c of node.connectors || []) {
                if (connectorKey(node, c) === selectedNodeKey) {
                    c.enabled = enabled;
                    touchTree();
                    return;
                }
            }
        }
        toast('Select a channel or connector in the tree first', 'warn');
    }

    function setAllExpanded(expanded: any) {
        if (!tree || !tree.allChannelNodes) return;
        setCollapsed(prev => {
            const next = new Set(prev);
            for (const node of tree.allChannelNodes) {
                if (!node.connectors) continue;
                if (expanded) next.delete(channelKey(node));
                else next.add(channelKey(node));
            }
            return next;
        });
    }

    // Load on mount; the guards read the model + latest saveModel via refs, so
    // this mount-once effect is correct.
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

    // Capture the clean baseline once the form is seeded (before edits).
    useEffect(() => {
        if (cleanSnapshotRef.current === null && form && tree && !tree.loadError && modelRef.current) {
            cleanSnapshotRef.current = syncedModelJson();
        }
    });

    // New alert: focus the empty Name field so the user can type immediately.
    const nameRef = useRef<any>(null);
    const focusedNewRef = useRef(false);
    useEffect(() => {
        if (isNew && form && !focusedNewRef.current && nameRef.current) {
            focusedNewRef.current = true;
            nameRef.current.focus();
            nameRef.current.select();
        }
    }, [isNew, form]);

    // Variables insert into whichever of subject/template was last focused
    // (default: append to the template).
    const subjectRef = useRef<any>(null);
    const templateRef = useRef<any>(null);
    const lastFocusedRef = useRef<any>(null);   // 'subject' | 'template' | null
    function insertVariable(name: any) {
        const key = lastFocusedRef.current;
        const fieldKey = key === 'subject' ? 'subject' : 'template';
        const target = key === 'subject' ? subjectRef.current : templateRef.current;
        const text = '${' + name + '}';
        const value = form[fieldKey] || '';
        let start = key && target ? (target.selectionStart ?? value.length) : value.length;
        let end = key && target ? (target.selectionEnd ?? start) : start;
        patchForm({ [fieldKey]: value.slice(0, start) + text + value.slice(end) });
        const pos = start + text.length;
        requestAnimationFrame(() => {
            target?.focus();
            target?.setSelectionRange(pos, pos);
        });
    }

    const loadError = tree && tree.loadError;
    const ready = !!form && !!tree && !loadError;

    /* ---- actions rows (protocol/recipient pairs) ---- */
    const addAction = () => patchForm({ actionRows: [...form.actionRows, { protocol: tree.protocols[0], recipient: '' }] });
    const removeAction = (i: any) => patchForm({ actionRows: form.actionRows.filter((_: any, idx: any) => idx !== i) });
    const patchAction = (i: any, patch: any) => patchForm({ actionRows: form.actionRows.map((r: any, idx: any) => (idx === i ? { ...r, ...patch } : r)) });

    // <TreeTable> data + columns for the channels tree. Channel nodes are parents,
    // their connectors are children (only when connector-granular). The tree column
    // renders the clickable pip + the name.
    function treeData() {
        if (!tree || !tree.allChannelNodes) return [];
        return tree.allChannelNodes.map((node: any) => ({
            kind: 'channel', node,
            children: node.connectors
                ? node.connectors.map((c: any) => ({ kind: 'connector', node, c }))
                : null
        }));
    }

    function pip(stateClass: any, onToggle: any) {
        return (
            <span className={'pip cursor-pointer flex-none' + (stateClass ? ' ' + stateClass : '')}
                title="Toggle enabled"
                onClick={(e: any) => { e.stopPropagation(); onToggle(); }} />
        );
    }

    const channelColumns = [{
        key: 'name', label: 'Channel', tree: true,
        render: (n: any) => {
            if (n.kind === 'connector') {
                return (
                    <span className="inline-flex items-center gap-[6px]">
                        {pip(n.c.enabled ? 'ok' : 'err', () => { n.c.enabled = !n.c.enabled; touchTree(); })}
                        <span>{n.c.name}</span>
                    </span>
                );
            }
            // Channel pip: green all-on, red all-off, amber mixed; clicking it
            // toggles the whole channel (mixed -> fully enabled).
            return (
                <span className="inline-flex items-center gap-[6px]">
                    {pip(channelPipState(n.node), () => { setChannelNode(n.node, channelPipState(n.node) !== 'ok'); touchTree(); })}
                    <span>{n.node.name}</span>
                </span>
            );
        }
    }];

    const filterTerm = channelFilter.trim().toLowerCase();
    const treeMatches = filterTerm
        ? (n: any) => {
            if (n.kind === 'connector') return n.c.name.toLowerCase().includes(filterTerm);
            return n.node.name.toLowerCase().includes(filterTerm) ||
                (n.node.connectors || []).some((c: any) => c.name.toLowerCase().includes(filterTerm));
        }
        : undefined;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Alert Edit Tasks" paneKey="tasks:Alert Edit Tasks" group="alertEdit">
                    <div className="taskbar" data-pane-title="Alert Edit Tasks">
                        <TaskButton label="Save Alert" icon="save" primary task="doSaveAlerts" onClick={save} />
                        <TaskButton label="Export Alert" icon="export" task="doExportAlert" onClick={exportTask} />
                        <span className="sep" />
                        <TaskButton label="Back to Alerts" icon="logout" onClick={() => router.navigate('/alerts')} />
                        {/* Open in Wizard — always pinned to the bottom of the task list. */}
                        {getPref('showViewSwitch') !== false && <TaskButton label="Open in Wizard" icon="wand" onClick={() => {
                            // Flush the form state into the model FIRST — the wizard
                            // receives the model object, not this editor's state.
                            saveModelRef.current();
                            const model = modelRef.current;
                            store.setState('editingAlert', model);
                            store.setState('editingAlertNew', isNew);
                            store.setState('navGuard', null);
                            router.navigate(isNew || !model ? '/alerts/new/guided' : `/alerts/${model.id}/guided`);
                        }} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body">
                {loadError
                    ? <div className="dt-empty">
                        <div className="empty-icon"><Icon name="alerts" size={30} /></div>
                        <div>Could not load alert: {loadError}</div>
                    </div>
                    : !ready
                        ? <div className="loading-block"><div className="spinner" />Loading alert…</div>
                        : (
                            <>
                                {/* ---- top row: name + enabled ---- */}
                                <div className="flex items-center gap-3 mb-3.5">
                                    <label className="text-[10px] font-[650] tracking-[0.08em] uppercase text-text-dim">Alert Name:</label>
                                    <input ref={nameRef} type="text" className="flex-1 max-w-[504px]" value={form.name}
                                        onChange={(e: any) => patchForm({ name: e.target.value })} />
                                    <label className="check">
                                        <input type="checkbox" checked={form.enabled}
                                            onChange={(e: any) => patchForm({ enabled: e.target.checked })} />
                                        Enabled
                                    </label>
                                </div>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3.5 items-stretch">
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Errors (select all that apply)</div>
                                        <div className="panel-body flex-1 flex flex-col gap-0.5 overflow-auto">
                                            {ERROR_EVENT_TYPES.map((type: any) => (
                                                <label key={type} className="check">
                                                    <input type="checkbox" checked={form.types.includes(type)}
                                                        onChange={(e: any) => patchForm({
                                                            types: e.target.checked
                                                                ? [...form.types, type]
                                                                : form.types.filter((t: any) => t !== type)
                                                        })} />
                                                    {eventTypeLabel(type)}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Regex (optional)</div>
                                        <div className="panel-body flex-1 flex min-h-0">
                                            <textarea className="flex-1 resize-none min-h-[162px] font-mono"
                                                placeholder="Only trigger when the error matches this regular expression (leave blank to match any error)"
                                                value={form.regex} onChange={(e: any) => patchForm({ regex: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Channels</div>
                                        <div className="panel-body flex-1 flex flex-col gap-2 min-h-0">
                                            <div className="flex gap-1.5 items-center">
                                                <input type="text" placeholder="Filter channels" className="flex-1"
                                                    value={channelFilter}
                                                    onChange={(e: any) => setChannelFilter(e.target.value)} />
                                                <TaskButton label="Enable" icon="check" onClick={() => setSelectedNode(true)} />
                                                <TaskButton label="Disable" icon="x" onClick={() => setSelectedNode(false)} />
                                            </div>
                                            {tree.includeConnectors
                                                ? <div className="flex gap-2.5 justify-end">
                                                    <span title="Expand all nodes below." className="text-accent cursor-pointer underline text-[11px]"
                                                        onClick={() => setAllExpanded(true)}>Expand All</span>
                                                    <span title="Collapse all nodes below." className="text-accent cursor-pointer underline text-[11px]"
                                                        onClick={() => setAllExpanded(false)}>Collapse All</span>
                                                </div>
                                                : null}
                                            <div className="tree flex-1 min-h-0 max-h-[288px] overflow-auto">
                                                <TreeTable
                                                    data={treeData()}
                                                    columns={channelColumns}
                                                    getChildren={(n: any) => n.children}
                                                    rowKey={(n: any) => n.kind === 'connector' ? connectorKey(n.node, n.c) : channelKey(n.node)}
                                                    selectedKey={selectedNodeKey}
                                                    onSelect={(n: any) => setSelectedNodeKey(n.kind === 'connector' ? connectorKey(n.node, n.c) : channelKey(n.node))}
                                                    matches={treeMatches}
                                                    collapsedKeys={collapsed}
                                                    onToggleCollapse={(key: any) => setCollapsed(prev => {
                                                        const next = new Set(prev);
                                                        next.has(key) ? next.delete(key) : next.add(key);
                                                        return next;
                                                    })}
                                                    columnsKey="alert-channels"
                                                    pinnedKeys={['name']}
                                                    emptyText="No matching channels" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-3.5 mt-3.5 items-stretch">
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Actions</div>
                                        <div className="panel-body flex-1 flex flex-col min-h-0">
                                            <div className="flex-1 overflow-auto min-h-0"
                                                onContextMenu={(e: any) => {
                                                    // Right-click parity (Swing alert action popup): Add Action
                                                    // anywhere in the panel, Delete Action on a row.
                                                    e.preventDefault();
                                                    const tr = e.target.closest('tbody tr');
                                                    const index = tr ? [...tr.parentNode.children].indexOf(tr) : -1;
                                                    const items: any[] = [{ label: 'Add Action', icon: 'plus', onClick: addAction }];
                                                    if (index >= 0) items.push({ label: 'Delete Action', icon: 'trash', danger: true, onClick: () => removeAction(index) });
                                                    contextMenu(e.clientX, e.clientY, items);
                                                }}>
                                                {form.actionRows.length === 0
                                                    ? <div className="text-text-dim py-1.5 px-0">No actions defined</div>
                                                    : (
                                                        <div className="dt-wrap">
                                                            <table className="dt">
                                                                <thead><tr><th>Protocol</th><th>Recipient</th><th></th></tr></thead>
                                                                <tbody>
                                                                    {form.actionRows.map((row: any, i: any) => (
                                                                        <tr key={i}>
                                                                            <td className="w-[108px]">
                                                                                {/* Switching protocol clears the recipient and swaps the editor (combo vs text). */}
                                                                                <select value={row.protocol}
                                                                                    onChange={(e: any) => patchAction(i, { protocol: e.target.value, recipient: '' })}>
                                                                                    {tree.protocols.map((prot: any) => <option key={prot} value={prot}>{prot}</option>)}
                                                                                </select>
                                                                            </td>
                                                                            <td><RecipientControl row={row} index={i} tree={tree} patchAction={patchAction} /></td>
                                                                            <td className="w-[36px] text-right">
                                                                                <button type="button" className="icon-btn" title="Remove action"
                                                                                    onClick={() => removeAction(i)}><Icon name="trash" /></button>
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                            </div>
                                            <div className="mt-[13px]"><TaskButton label="Add" icon="plus" onClick={addAction} /></div>
                                        </div>
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Template</div>
                                        <div className="panel-body flex-1 flex flex-col min-h-0">
                                            <div className="field">
                                                <label>Subject (only used for email messages)</label>
                                                <input ref={subjectRef} type="text" value={form.subject}
                                                    onFocus={() => { lastFocusedRef.current = 'subject'; }}
                                                    onChange={(e: any) => patchForm({ subject: e.target.value })} />
                                            </div>
                                            <div className="field flex-1 flex min-h-0 mb-0">
                                                <label>Template</label>
                                                <textarea ref={templateRef} rows={8} className="flex-1 resize-none min-h-[126px]"
                                                    value={form.template}
                                                    onFocus={() => { lastFocusedRef.current = 'template'; }}
                                                    onChange={(e: any) => patchForm({ template: e.target.value })} />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="panel m-0 flex flex-col min-h-0">
                                        <div className="panel-header">Alert Variables</div>
                                        <div className="panel-body flush flex-1 overflow-auto min-h-0 p-1.5">
                                            <div className="tree">
                                                {ALERT_VARIABLES.map((name: any) => (
                                                    <div key={name} className="tree-node cursor-grab" draggable
                                                        title={'Insert ${' + name + '} (drag onto the subject/template or click)'}
                                                        onClick={() => insertVariable(name)}
                                                        onDragStart={(e: any) => {
                                                            e.dataTransfer.setData('text/plain', '${' + name + '}');
                                                            e.dataTransfer.effectAllowed = 'copy';
                                                        }}>{name}</div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
            </div>
        </div>
    );
}
