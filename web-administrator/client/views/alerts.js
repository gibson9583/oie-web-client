/*
 * Alerts — list and editor for AlertModel objects (parity with the Swing
 * Administrator's alert panel). The default trigger ("Channel Error") matches
 * com.mirth.connect.model.alert.DefaultTrigger: a set of ErrorEventTypes, an
 * optional regex, and per-channel enablement (AlertChannels). Actions are
 * grouped in a single AlertActionGroup with protocol/recipient pairs.
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
 *       (channel fully enabled/disabled, including future connectors)
 *   partialChannels                            Map<String, AlertConnectors> ->
 *       { entry: [{ string: channelId,
 *                   alertConnectors: { enabledConnectors: { int: [...], null: null },
 *                                      disabledConnectors: { ... } } }] } | null
 *       Set<Integer> elements are connector metaDataIds; a <null/> element
 *       (JSON key "null") is the '[New Destinations]' pseudo-connector.
 *   Per AlertChannels.addChannel(): a channel whose connector states all match
 *   the new-channel defaults is omitted entirely; all-enabled -> enabledChannels,
 *   all-disabled -> disabledChannels, mixed -> partialChannels.
 */

import { h, clear, toast, taskButton, confirmDialog, contextMenu, DataTable, field, textInput, select, checkbox, loading, icon, saveFile, pickFile } from '@oie/web-ui';
import api from '@oie/web-api';
import { uuid } from '@oie/web-api';

/* com.mirth.connect.donkey.model.event.ErrorEventType */
const ERROR_EVENT_TYPES = [
    'ANY', 'SOURCE_CONNECTOR', 'DESTINATION_CONNECTOR', 'SERIALIZER', 'FILTER',
    'TRANSFORMER', 'USER_DEFINED_TRANSFORMER', 'RESPONSE_VALIDATION',
    'RESPONSE_TRANSFORMER', 'ATTACHMENT_HANDLER', 'DEPLOY_SCRIPT',
    'PREPROCESSOR_SCRIPT', 'POSTPROCESSOR_SCRIPT', 'UNDEPLOY_SCRIPT'
];

const DEFAULT_PROTOCOLS = ['Email', 'Channel', 'User'];

/* Substitution variables available to alert subject/template (classic editor list). */
const ALERT_VARIABLES = [
    'alertId', 'alertName', 'serverId', 'serverName', 'globalMapVariable',
    'date', 'systemTime', 'error', 'errorMessage', 'errorType',
    'channelId', 'channelName', 'connectorName', 'connectorType', 'messageId'
];

function eventTypeLabel(type) {
    return String(type).toLowerCase().split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function register(platform) {
    platform.registerNavItem({ id: 'alerts', label: 'Alerts', icon: 'alerts', path: '/alerts', section: 'Engine', order: 4 });
    platform.registerView('/alerts', () => renderAlerts(platform), { title: 'Alerts' });
    platform.registerView('/alerts/:alertId/edit',
        ({ params, query }) => renderAlertEditor(platform, params.alertId, query), { title: 'Edit Alert' });
}

/* ---- model helpers ---------------------------------------------------------- */

function newAlert(name, version) {
    return {
        // '@version' is required — the engine's migrator 500s without it.
        '@version': version || '4.6.0',
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
function protocolsOf(raw) {
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
function recipientOptionsOf(raw) {
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

/* ---- list view ----------------------------------------------------------------- */

function renderAlerts(platform) {
    let alerts = [];

    const table = new DataTable([
        {
            key: 'enabled', label: 'Status', width: '90px',
            sortValue: (a) => a.enabled ? 0 : 1,
            render: (a) => a.enabled
                ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
                : h('span.status-cell', h('span.pip'), h('span.muted', 'Disabled'))
        },
        { key: 'name', label: 'Name', render: (a) => a.name || '' },
        {
            key: 'id', label: 'Id', className: 'mono',
            render: (a) => h('span', { style: { color: 'var(--text-faint)' } }, a.id || '')
        }
    ], {
        selectable: 'multi',
        rowKey: (a) => a.id,
        emptyText: 'No alerts',
        columnsMenu: true,
        columnsMenuKey: 'webadmin-cols-alerts',
        onActivate: (a) => platform.router.navigate(`/alerts/${a.id}/edit`),
        onSelect: () => updateTaskVisibility(),
        // Right-click selects the row without firing onSelect, so sync here too.
        // Full Swing alertPopupMenu (Frame.alertPopupMenu).
        onContextMenu: (a, e) => {
            updateTaskVisibility();
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                { label: 'New Alert', icon: 'plus', onClick: () => newTask() },
                { label: 'Import Alert', icon: 'import', onClick: () => importTask() },
                { label: 'Export All Alerts', icon: 'export', onClick: () => exportAllTask() },
                '-',
                { label: 'Edit Alert', icon: 'edit', onClick: () => editTask() },
                { label: 'Export Alert', icon: 'export', onClick: () => exportTask() },
                '-',
                { label: 'Enable Alert', icon: 'check', onClick: () => setEnabledTask(true) },
                { label: 'Disable Alert', icon: 'x', onClick: () => setEnabledTask(false) },
                '-',
                { label: 'Delete Alert', icon: 'trash', danger: true, onClick: () => deleteTask() }
            ]);
        }
    });

    async function refresh() {
        try {
            alerts = (await api.alerts.list()).filter(a => a && a.id);
            table.setRows(alerts);
            updateTaskVisibility();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function single() {
        const rows = table.selectedRows();
        if (rows.length !== 1) { toast('Select a single alert', 'warn'); return null; }
        return rows[0];
    }

    function multi() {
        const rows = table.selectedRows();
        if (!rows.length) { toast('Select an alert first', 'warn'); return null; }
        return rows;
    }

    /* ---- tasks ---- */

    function newTask() {
        // No name prompt — open the editor with an empty Name field focused
        // (the editor focuses it when isNew).
        const model = newAlert('', platform.store.getState('serverVersion'));
        platform.store.setState('editingAlert', model);
        platform.router.navigate(`/alerts/${model.id}/edit?new=1`);
    }

    function editTask() {
        const alert = single();
        if (!alert) return;
        platform.router.navigate(`/alerts/${alert.id}/edit`);
    }

    async function setEnabledTask(enabled) {
        const rows = multi();
        if (!rows) return;
        for (const alert of rows) {
            try {
                await (enabled ? api.alerts.enable(alert.id) : api.alerts.disable(alert.id));
            } catch (e) {
                toast(e.message, 'error');
            }
        }
        refresh();
    }

    async function deleteTask() {
        const rows = multi();
        if (!rows) return;
        if (!await confirmDialog('Delete alerts', `Permanently delete ${rows.length} alert(s)? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        for (const alert of rows) {
            try { await api.alerts.remove(alert.id); } catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }

    /* Import/export use the engine's XStream XML (a single <alertModel>),
       interchangeable with the Swing Administrator's alert export. */
    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                await api.postXml('/alerts', content);
            } else {
                // Tolerate this client's previous JSON exports.
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.alertModel) obj = obj.alertModel;
                await api.alerts.create(obj);
            }
            toast(`Imported ${file.name}`);
            refresh();
        } catch (e) {
            toast(`Import failed: ${e.message}`, 'error');
        }
    }

    async function exportTask() {
        const alert = single();
        if (!alert) return;
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Alert not found on the server');
                return xml;
            });
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    // Export All Alerts (Swing ALERT_EXPORT_ALL) — every alert in one re-importable
    // <list> of serialized alertModel elements.
    async function exportAllTask() {
        if (!alerts.length) { toast('No alerts to export', 'warn'); return; }
        try {
            let count = 0;
            await saveFile('alerts.xml', 'application/xml', async () => {
                const parts = [];
                for (const a of alerts) {
                    const xml = await api.getXml(`/alerts/${a.id}`);
                    if (xml && String(xml).trim()) parts.push(String(xml).replace(/^<\?xml[^>]*\?>\s*/, '').trim());
                }
                count = parts.length;
                return `<list>\n${parts.join('\n')}\n</list>`;
            });
            if (count) toast(`Exported ${count} alert(s)`);
        } catch (e) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    // Selection-dependent tasks live in a context group that only shows when
    // an alert is selected (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        taskButton('Edit', 'edit', editTask),
        taskButton('Export Alert', 'export', exportTask),
        h('span.sep'),
        taskButton('Enable', 'check', () => setEnabledTask(true)),
        taskButton('Disable', 'x', () => setEnabledTask(false)),
        h('span.sep'),
        taskButton('Delete', 'trash', deleteTask, { danger: true }));

    function updateTaskVisibility() {
        ctxTasks.classList.toggle('hidden', table.selectedRows().length === 0);
    }

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Alert Tasks' } },
        taskButton('Refresh', 'refresh', () => refresh()),
        h('span.sep'),
        taskButton('New Alert', 'plus', newTask, { primary: true }),
        taskButton('Import Alert', 'import', importTask),
        taskButton('Export All Alerts', 'export', exportAllTask),
        ctxTasks);

    refresh();

    const el = h('div.view',
        taskbar,
        h('div.view-body',
            h('div.panel', h('div.panel-body.flush', table.el))));

    return { el };
}

/* ---- editor view ------------------------------------------------------------------ */

function renderAlertEditor(platform, alertId, query = {}) {
    const isNew = query.new === '1';
    const body = h('div.view-body', loading('Loading alert…'));

    let model = null;
    let saveModel = () => {};

    async function save() {
        if (!model) return;
        try {
            saveModel();
            if (!String(model.name || '').trim()) { toast('Alert name is required', 'warn'); return; }
            if (isNew) await api.alerts.create(model);
            else await api.alerts.update(model.id, model);
            platform.store.setState('editingAlert', null);
            toast(isNew ? `Alert "${model.name}" created` : `Alert "${model.name}" saved`);
            platform.router.navigate('/alerts');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* Exports the saved alert as the engine's own <alertModel> XML (Swing
       format). Unsaved edits are not included — save first. */
    async function exportTask() {
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

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Alert Edit Tasks' } },
        taskButton('Save Alert', 'check', save, { primary: true }),
        taskButton('Export Alert', 'export', exportTask),
        h('span.sep'),
        taskButton('Back to Alerts', 'logout', () => platform.router.navigate('/alerts')));

    async function load() {
        try {
            const stored = platform.store.getState('editingAlert');
            if (stored && stored.id === alertId) {
                model = stored;
            } else {
                model = await api.alerts.get(alertId);
            }
            if (!model || !model.id) throw new Error('Alert not found');

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
            renderForm(channelEntries, includeConnectors, protocolsOf(optionsRaw), recipientOptionsOf(optionsRaw));
        } catch (e) {
            toast(e.message, 'error');
            clear(body).appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('alerts', 30)),
                h('div', `Could not load alert: ${e.message}`)));
        }
    }

    function renderForm(channelEntries, includeConnectors, protocols, recipientOptions = {}) {
        const trigger = model.trigger || (model.trigger = { '@class': 'defaultTrigger' });
        const alertChannels = trigger.alertChannels || (trigger.alertChannels = {
            newChannelSource: false, newChannelDestination: false,
            enabledChannels: null, disabledChannels: null, partialChannels: null
        });
        const groups = groupsOf(model);
        const group = groups[0] || { actions: null, subject: '', template: '' };
        if (!groups.length) groups.push(group);

        /* ---- top row: name + enabled ---- */

        const nameInput = textInput(model.name || '', { style: { flex: '1', maxWidth: '560px' } });
        const enabledCheck = checkbox('Enabled', model.enabled === true);
        // New alert: focus the empty Name field so the user can type immediately.
        if (isNew) setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);

        const topRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' } },
            h('label', { style: { fontSize: '11px', fontWeight: '650', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-dim)' } }, 'Alert Name:'),
            nameInput,
            enabledCheck.el);

        /* ---- column 1: error event types (DefaultTrigger) ---- */

        const selectedTypes = new Set(api.asList(trigger.errorEventTypes, 'errorEventType').map(String));
        const typeChecks = ERROR_EVENT_TYPES.map(type => {
            const cb = checkbox(eventTypeLabel(type), selectedTypes.has(type));
            return { type, cb };
        });

        const errorsPanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Errors (select all that apply)'),
            h('div.panel-body', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'auto' } },
                typeChecks.map(t => t.cb.el)));

        /* ---- column 2: regex ---- */

        const regexInput = h('textarea', {
            placeholder: 'Only trigger when the error matches this regular expression (leave blank to match any error)',
            style: { flex: '1', resize: 'none', minHeight: '180px', fontFamily: 'var(--font-mono)' }
        }, trigger.regex ?? '');

        const regexPanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Regex (optional)'),
            h('div.panel-body', { style: { flex: '1', display: 'flex', minHeight: '0' } }, regexInput));

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
            id: null, name: '[New Channels]', expanded: true, dirty: false,
            connectors: includeConnectors ? [
                { name: 'Source', metaDataId: 0, enabled: alertChannels.newChannelSource === true },
                { name: '[New Destinations]', metaDataId: null, enabled: alertChannels.newChannelDestination === true }
            ] : null,
            enabled: alertChannels.newChannelSource === true || alertChannels.newChannelDestination === true
        };
        const channelNodes = channelEntries.map(entry => ({
            id: entry.id, name: entry.name, expanded: false, dirty: false,
            connectors: includeConnectors
                ? entry.connectors.map(c => ({ ...c, enabled: connectorEnabled(entry.id, c.metaDataId) }))
                : null,
            enabled: channelEnabled(entry.id)
        }));
        const allChannelNodes = [newChannelsNode, ...channelNodes];

        let selectedNodeKey = null;
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
            for (const node of allChannelNodes) {
                if (channelKey(node) === selectedNodeKey) {
                    setChannelNode(node, enabled);
                    renderChannelTree();
                    return;
                }
                for (const c of node.connectors || []) {
                    if (connectorKey(node, c) === selectedNodeKey) {
                        c.enabled = enabled;
                        renderChannelTree();
                        return;
                    }
                }
            }
            toast('Select a channel or connector in the tree first', 'warn');
        }

        const treeHost = h('div.tree', { style: { flex: '1', minHeight: '0', maxHeight: '320px', overflow: 'auto' } });
        const channelFilterInput = h('input', { type: 'text', placeholder: 'Filter channels', style: { flex: '1' }, onInput: () => renderChannelTree() });

        function nodeMatchesFilter(node, f) {
            return !f || node.name.toLowerCase().includes(f) ||
                (node.connectors || []).some(c => c.name.toLowerCase().includes(f));
        }

        function pipEl(state, onToggle) {
            return h('span.pip' + (state ? '.' + state : ''), {
                title: 'Toggle enabled',
                style: { cursor: 'pointer', flex: 'none' },
                onClick: (e) => { e.stopPropagation(); onToggle(); }
            });
        }

        function renderChannelTree() {
            clear(treeHost);
            const f = channelFilterInput.value.trim().toLowerCase();
            const visible = allChannelNodes.filter(node => nodeMatchesFilter(node, f));
            if (!visible.length) {
                treeHost.appendChild(h('div.muted', { style: { padding: '6px 10px' } }, 'No matching channels'));
                return;
            }
            for (const node of visible) {
                const key = channelKey(node);
                treeHost.appendChild(h(`div.tree-node${selectedNodeKey === key ? '.selected' : ''}`,
                    { onClick: () => { selectedNodeKey = key; renderChannelTree(); } },
                    node.connectors
                        ? h('span.twisty' + (node.expanded ? '.open' : ''), {
                            onClick: (e) => { e.stopPropagation(); node.expanded = !node.expanded; renderChannelTree(); }
                        }, '▸')
                        : h('span.twisty'),
                    // Channel pip: green all-on, red all-off, amber mixed; clicking
                    // it toggles the whole channel (mixed -> fully enabled).
                    pipEl(channelPipState(node), () => { setChannelNode(node, channelPipState(node) !== 'ok'); renderChannelTree(); }),
                    h('span', node.name)));
                if (node.connectors && node.expanded) {
                    treeHost.appendChild(h('div.tree-children', node.connectors.map(c => {
                        const ck = connectorKey(node, c);
                        return h(`div.tree-node${selectedNodeKey === ck ? '.selected' : ''}`,
                            { onClick: () => { selectedNodeKey = ck; renderChannelTree(); } },
                            h('span.twisty'),
                            pipEl(c.enabled ? 'ok' : 'err', () => { c.enabled = !c.enabled; renderChannelTree(); }),
                            h('span', c.name));
                    })));
                }
            }
        }

        function setAllExpanded(expanded) {
            for (const node of allChannelNodes) node.expanded = expanded;
            renderChannelTree();
        }

        function treeLink(label, title, onClick) {
            return h('span', {
                title,
                style: { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px' },
                onClick
            }, label);
        }

        renderChannelTree();

        const channelsPanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Channels'),
            h('div.panel-body', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '0' } },
                h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
                    channelFilterInput,
                    taskButton('Enable', 'check', () => setSelectedNode(true)),
                    taskButton('Disable', 'x', () => setSelectedNode(false))),
                includeConnectors
                    ? h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } },
                        treeLink('Expand All', 'Expand all nodes below.', () => setAllExpanded(true)),
                        treeLink('Collapse All', 'Collapse all nodes below.', () => setAllExpanded(false)))
                    : null,
                treeHost));

        /* ---- bottom column 1: actions (protocol/recipient pairs) ---- */

        let actionRows = api.asList(group.actions, 'alertAction')
            .map(a => ({ protocol: String(a?.protocol ?? protocols[0]), recipient: String(a?.recipient ?? '') }));

        const actionsHost = h('div');

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
                actionsHost.appendChild(h('div.muted', { style: { padding: '6px 0' } }, 'No actions defined'));
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
                    h('td', { style: { width: '120px' } }, protocolSel),
                    h('td', recipientControl(row)),
                    h('td', { style: { width: '40px', textAlign: 'right' } },
                        h('button.icon-btn', {
                            title: 'Remove action',
                            onClick: () => { actionRows = actionRows.filter(r => r !== row); renderActions(); }
                        }, icon('trash')))));
            }
            actionsHost.appendChild(h('div.dt-wrap', h('table.dt',
                h('thead', h('tr', h('th', 'Protocol'), h('th', 'Recipient'), h('th', ''))),
                tbody)));
        }
        renderActions();

        const actionsPanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Actions'),
            h('div.panel-body', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } },
                h('div', { style: { flex: '1', overflow: 'auto', minHeight: '0' } }, actionsHost),
                h('div.mt', taskButton('Add', 'plus', () => {
                    actionRows.push({ protocol: protocols[0], recipient: '' });
                    renderActions();
                }))));

        /* ---- bottom column 2: subject + template ---- */

        const subjectInput = textInput(group.subject ?? '');
        const templateInput = h('textarea', { rows: 8, style: { flex: '1', resize: 'none', minHeight: '140px' } }, group.template ?? '');

        // Variables insert into whichever of subject/template was last focused.
        let lastFocused = null;
        subjectInput.addEventListener('focus', () => { lastFocused = subjectInput; });
        templateInput.addEventListener('focus', () => { lastFocused = templateInput; });

        const messagePanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Template'),
            h('div.panel-body', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } },
                field('Subject (only used for email messages)', subjectInput),
                h('div.field', { style: { flex: '1', display: 'flex', minHeight: '0', marginBottom: '0' } },
                    h('label', 'Template'),
                    templateInput)));

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

        const variablesPanel = h('div.panel', { style: { margin: '0', display: 'flex', flexDirection: 'column', minHeight: '0' } },
            h('div.panel-header', 'Alert Variables'),
            h('div.panel-body.flush', { style: { flex: '1', overflow: 'auto', minHeight: '0', padding: '6px' } },
                h('div.tree', ALERT_VARIABLES.map(name =>
                    h('div.tree-node', {
                        title: 'Insert ${' + name + '} (drag onto the subject/template or click)',
                        draggable: 'true',
                        style: { cursor: 'grab' },
                        onClick: () => insertVariable(name),
                        onDragstart: (e) => {
                            e.dataTransfer.setData('text/plain', '${' + name + '}');
                            e.dataTransfer.effectAllowed = 'copy';
                        }
                    }, name)))));

        /* ---- collect form values back into the round-tripped model ---- */

        saveModel = () => {
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

        clear(body);
        body.appendChild(topRow);
        body.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.4fr', gap: '14px', alignItems: 'stretch' } },
            errorsPanel, regexPanel, channelsPanel));
        body.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 2fr 240px', gap: '14px', marginTop: '14px', alignItems: 'stretch' } },
            actionsPanel, messagePanel, variablesPanel));
    }

    load();

    const el = h('div.view', taskbar, body);
    return { el };
}
