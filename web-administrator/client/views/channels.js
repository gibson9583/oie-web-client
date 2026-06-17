/*
 * Channels — group tree view (parity with the Swing Administrator's channel
 * panel). Channels are listed under their channel group (or a synthetic
 * "[Default Group]"), with enabled state, data type, tags, deployed revision
 * delta and dates. Channel lifecycle tasks live in the "Channels Tasks" pane,
 * group management in the "Group Tasks" pane, and a filter bar with counts
 * runs along the bottom.
 */

import { h, clear, icon, toast, taskButton, confirmDialog, promptDialog, contextMenu, modal, select, field, textInput, saveFile, pickFile, fmtDate } from '@oie/web-ui';
import api from '@oie/web-api';
import { newChannel, uuid } from '@oie/web-api';
import { getPref } from '../core/prefs.js';
import { createColumnManager, decorateColumns } from '@oie/web-ui';

// Canonical data columns (after the leading twisty), with default widths.
const CHANNEL_COLUMNS = [
    { key: 'status', width: 90 },
    { key: 'dataType', width: 95 },
    { key: 'name', width: 280 },
    { key: 'id', width: 250 },
    { key: 'description', width: 240 },
    { key: 'revDelta', width: 60 },
    { key: 'lastDeployed', width: 150 },
    { key: 'lastModified', width: 150 }
];

/* ---- code template library bundling (Swing "import/export libraries with channels") ----
   Export uses the engine (includeCodeTemplateLibraries) to bundle libraries into the
   channel XML. Import must merge those libraries itself — the engine doesn't auto-import
   exportData.codeTemplateLibraries on channel create (ChannelPanel does it client-side). */

// Per the "Import code template libraries with channels" preference.
async function shouldImportBundledLibraries(count) {
    const lp = getPref('importLibrariesWithChannels');
    if (lp === 'yes') return true;
    if (lp === 'no') return false;
    return confirmDialog('Import Channel',
        `This export bundles ${count} code template librar${count === 1 ? 'y' : 'ies'}. Import ${count === 1 ? 'it' : 'them'} too?`,
        { okLabel: 'Import' });
}

// Merge bundled <codeTemplateLibrary> elements (from a channel XML export) into the
// server's library list, appending any not already present (by id), and save their
// full code templates first (the library PUT may keep only refs).
async function importLibraryElementsXml(bundledEls) {
    const existingXml = await api.getXml('/codeTemplateLibraries');
    let doc = new DOMParser().parseFromString(existingXml && existingXml.trim() ? existingXml : '<list/>', 'text/xml');
    if (!doc.documentElement || doc.documentElement.nodeName !== 'list' || doc.querySelector('parsererror')) {
        doc = new DOMParser().parseFromString('<list/>', 'text/xml');
    }
    const list = doc.documentElement;
    const idOf = (el) => [...el.children].find(c => c.tagName === 'id')?.textContent;
    const existingIds = new Set([...list.children].filter(c => c.tagName === 'codeTemplateLibrary').map(idOf).filter(Boolean));
    let added = 0;
    for (const lib of bundledEls) {
        const id = idOf(lib);
        if (id && existingIds.has(id)) continue;   // simple merge: keep existing as-is
        list.appendChild(doc.importNode(lib, true));
        added++;
    }
    if (!added) return;
    const fullTemplates = [...list.querySelectorAll('codeTemplates > codeTemplate')]
        .filter(el => [...el.children].some(c => c.tagName !== 'id'));
    for (const el of fullTemplates) {
        const id = idOf(el);
        if (!id) continue;
        await api.putXml(`/codeTemplates/${encodeURIComponent(id)}`, new XMLSerializer().serializeToString(el), { override: true });
    }
    await api.putXml('/codeTemplateLibraries', new XMLSerializer().serializeToString(doc), { override: true });
}

// Import a channel XML export, handling bundled libraries per the preference.
async function importChannelXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('Not a valid channel XML file');
    const libsContainer = doc.querySelector('exportData > codeTemplateLibraries');
    const bundled = libsContainer ? [...libsContainer.children].filter(c => c.tagName === 'codeTemplateLibrary') : [];
    if (bundled.length && await shouldImportBundledLibraries(bundled.length)) {
        await importLibraryElementsXml(bundled);
    }
    // The engine ignores bundled libraries on create; strip them from the channel.
    if (libsContainer && libsContainer.parentNode) libsContainer.parentNode.removeChild(libsContainer);
    await api.post('/channels', new XMLSerializer().serializeToString(doc), { contentType: 'application/xml' });
}

// Merge bundled libraries into the existing server set (port of
// ChannelPanel.importChannel): dedupe code templates by id, union the
// enabled/disabled channel ids, and ensure the imported channel is enabled.
function mergeImportedLibraries(existing, imported, channelId) {
    const templatesOf = (lib) => api.asList(lib.codeTemplates, 'codeTemplate').filter(t => t && t.id);
    const stringsOf = (v) => api.asList(v, 'string').map(String);
    const byId = new Map(existing.map(l => [l.id, l]));
    const seen = new Set();
    for (const lib of existing) for (const t of templatesOf(lib)) seen.add(t.id);

    for (const lib of imported) {
        if (!lib || !lib.id) continue;
        const match = byId.get(lib.id);
        if (match) {
            const merged = templatesOf(match).slice();
            for (const t of templatesOf(lib)) if (seen.add(t.id)) merged.push(t);
            match.codeTemplates = { codeTemplate: merged };
            const enabled = new Set([...stringsOf(match.enabledChannelIds), ...stringsOf(lib.enabledChannelIds), channelId]);
            const disabled = new Set([...stringsOf(match.disabledChannelIds), ...stringsOf(lib.disabledChannelIds)]);
            for (const id of enabled) disabled.delete(id);
            match.enabledChannelIds = { string: [...enabled] };
            match.disabledChannelIds = { string: [...disabled] };
        } else {
            const tpls = [];
            for (const t of templatesOf(lib)) if (seen.add(t.id)) tpls.push(t);
            lib.codeTemplates = { codeTemplate: tpls };
            lib.enabledChannelIds = { string: [...new Set([...stringsOf(lib.enabledChannelIds), channelId])] };
            byId.set(lib.id, lib);
        }
    }
    return [...byId.values()];
}

const DEFAULT_GROUP_ID = '__default__';

export function register(platform) {
    platform.registerNavItem({ id: 'channels', label: 'Channels', icon: 'channels', path: '/channels', section: 'Engine', order: 1 });
    platform.registerView('/channels', () => renderChannels(platform), { title: 'Channels' });
}

/* Enabled flag lives at channel.exportData.metadata.enabled (ChannelMetadata,
   defaults true). Be defensive: InvalidChannel instances may lack exportData. */
function isEnabled(channel) {
    return channel?.exportData?.metadata?.enabled !== false;
}

function isInvalid(channel) {
    return String(channel?.['@class'] || '').includes('InvalidChannel');
}

function tagColor(tag) {
    const c = tag?.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined && c.green !== undefined && c.blue !== undefined) {
        return `rgba(${c.red}, ${c.green}, ${c.blue}, 0.25)`;
    }
    return null;
}

function firstLine(text) {
    return String(text || '').split('\n')[0].trim();
}

function renderChannels(platform) {
    let channels = [];
    let tags = [];
    let groups = [];
    let statusById = {};            // channelId -> dashboardStatus
    let selected = new Set();       // channel ids
    let lastClicked = null;         // for shift-range selection
    let lastGroupId = null;         // last-clicked group row (for Delete Group)
    const collapsed = new Set();    // group ids (default expanded)
    let filterText = '';
    const colMgr = createColumnManager('channels', Object.fromEntries(CHANNEL_COLUMNS.map(c => [c.key, c.width])));

    const tableHost = h('div.dt-wrap', { style: { flex: '1', minHeight: '0', overflow: 'auto' } });
    // Click on empty space (not a row) clears the selection, dismissing the
    // contextual task buttons.
    tableHost.addEventListener('click', (e) => {
        if (e.target.closest('tr')) return;
        if (!selected.size && !lastGroupId) return;
        selected = new Set();
        lastClicked = null;
        lastGroupId = null;
        renderTable();
        updateTasks();
        updateGroupTasks();
    });
    const countsEl = h('span.counts', '');

    /* ---- grouping --------------------------------------------------------- */

    /* Returns [{ id, name, description, group?, channels: [...] }] — every
       real group plus the synthetic default group for unreferenced channels. */
    function groupedChannels() {
        const byId = new Map(channels.map(c => [c.id, c]));
        const claimed = new Set();
        const rows = [];
        for (const group of groups) {
            const members = [];
            for (const ref of api.asList(group.channels, 'channel')) {
                if (!ref || !ref.id) continue;
                claimed.add(ref.id);
                const channel = byId.get(ref.id);
                if (channel) members.push(channel);
            }
            rows.push({ id: group.id, name: group.name, description: group.description || '', group, channels: members });
        }
        rows.push({
            id: DEFAULT_GROUP_ID,
            name: 'Default Group',
            description: 'Channels not part of a group will appear here.',
            channels: channels.filter(c => !claimed.has(c.id))
        });
        return rows;
    }

    function channelTags(channel) {
        return tags.filter(t => api.asList(t.channelIds, 'string').includes(channel.id));
    }

    function matchesFilter(channel) {
        const needle = filterText.trim().toLowerCase();
        if (!needle) return true;
        if (String(channel.name || '').toLowerCase().includes(needle)) return true;
        return channelTags(channel).some(t => String(t.name || '').toLowerCase().includes(needle));
    }

    /* ---- table ------------------------------------------------------------ */

    function renderTable() {
        clear(tableHost);

        const grouped = groupedChannels()
            .map(g => ({ ...g, channels: g.channels.filter(matchesFilter) }))
            .filter(g => g.channels.length > 0 || !filterText.trim());

        const visibleChannels = grouped.flatMap(g => g.channels);
        const enabledCount = visibleChannels.filter(isEnabled).length;
        countsEl.textContent = `${grouped.length} Group${grouped.length === 1 ? '' : 's'}, ` +
            `${visibleChannels.length} Channel${visibleChannels.length === 1 ? '' : 's'}, ` +
            `${enabledCount} Enabled`;

        if (!channels.length) {
            tableHost.appendChild(h('div.dt-empty',
                h('div.empty-icon', icon('channels', 30)),
                h('div', 'No channels'),
                h('div.faint.mt', 'Create a channel with "New Channel" in the Channels Tasks pane.')));
            return;
        }

        const thead = h('thead', h('tr',
            h('th', { style: { width: '24px' } }, ''),
            h('th', { style: { width: '90px' } }, 'Status'),
            h('th', { style: { width: '90px' } }, 'Data Type'),
            h('th', 'Name'),
            h('th', { style: { width: '250px' } }, 'Id'),
            h('th', 'Description'),
            h('th', { style: { width: '50px' } }, 'Rev Δ'),
            h('th', { style: { width: '140px' } }, 'Last Deployed'),
            h('th', { style: { width: '140px' } }, 'Last Modified')));

        const tbody = h('tbody');
        for (const group of grouped) {
            tbody.appendChild(groupRow(group));
            if (!collapsed.has(group.id)) {
                const sorted = [...group.channels].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
                for (const channel of sorted) tbody.appendChild(channelRow(channel));
            }
        }

        const table = h('table.dt', thead, tbody);
        tableHost.appendChild(table);
        decorateColumns(table, {
            manager: colMgr,
            presentKeys: CHANNEL_COLUMNS.map(c => c.key),
            pinned: 1,
            pinnedWidths: [24],
            onChange: renderTable
        });
    }

    let dragIds = null;   // channel ids being dragged onto a group row

    function groupRow(group) {
        const isCollapsed = collapsed.has(group.id);
        const isSelected = lastGroupId === group.id;
        const toggleCollapse = () => {
            isCollapsed ? collapsed.delete(group.id) : collapsed.add(group.id);
            renderTable();
        };
        const selectGroup = () => {
            lastGroupId = group.id;
            // A group selection and a channel selection are mutually exclusive.
            selected = new Set();
            lastClicked = null;
            renderTable();
            updateTasks();
            updateGroupTasks();
        };
        const tr = h('tr', { class: isSelected ? 'selected' : null, style: { cursor: 'pointer', background: isSelected ? null : 'var(--bg1)' } },
            h('td', h('span.twisty', { style: { cursor: 'pointer' }, onClick: (e) => { e.stopPropagation(); toggleCollapse(); } }, isCollapsed ? '▸' : '▾')),
            h('td', ''),
            h('td', ''),
            h('td', { style: { fontWeight: '700' } }, `[${group.name}]`),
            h('td.mono', h('span', { style: { color: 'var(--text-faint)' } },
                group.id === DEFAULT_GROUP_ID ? 'Default Group' : (group.id || '--'))),
            h('td.muted', descriptionCell(group.description)),
            h('td.num', '--'),
            h('td.mono', '--'),
            h('td.mono', '--'));
        tr.addEventListener('click', selectGroup);
        tr.addEventListener('dblclick', toggleCollapse);
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectGroup();
            const isRealGroup = group.id !== DEFAULT_GROUP_ID;
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                '-',
                { label: 'New Group', icon: 'plus', onClick: () => newGroupTask() },
                { label: 'Edit Group Details', icon: 'edit', hidden: !isRealGroup, onClick: () => editGroupTask() },
                { label: 'Delete Group', icon: 'trash', danger: true, hidden: !isRealGroup, onClick: () => deleteGroupTask() },
                '-',
                { label: 'Import Group', icon: 'import', onClick: () => importGroupTask() },
                { label: 'Export Group', icon: 'export', hidden: !isRealGroup, onClick: () => exportGroupTask() },
                { label: 'Export All Groups', icon: 'export', onClick: () => exportGroupsTask() },
                '-',
                { label: 'New Channel', icon: 'plus', onClick: () => newTask() }
            ]);
        });
        tr.addEventListener('dragover', (e) => {
            if (!dragIds) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tr.classList.add('drop-target');
        });
        tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
        tr.addEventListener('drop', async (e) => {
            e.preventDefault();
            tr.classList.remove('drop-target');
            if (!dragIds) return;
            const ids = new Set(dragIds);
            dragIds = null;
            const names = channels.filter(c => ids.has(c.id)).map(c => c.name).join(', ');
            if (await confirmDialog('Move to Group',
                `Move ${ids.size === 1 ? `"${names}"` : ids.size + ' channels'} to [${group.name}]?`,
                { okLabel: 'Move' })) {
                await moveChannelsToGroup(ids, group.id);
            }
        });
        return tr;
    }

    function descriptionCell(text) {
        return h('span', {
            style: {
                display: 'inline-block', maxWidth: '320px', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom'
            }
        }, firstLine(text));
    }

    function statusCell(channel) {
        if (isInvalid(channel)) return h('span.status-cell', h('span.pip.err'), 'Invalid');
        return isEnabled(channel)
            ? h('span.status-cell', h('span.pip.ok'), 'Enabled')
            : h('span.status-cell', h('span.pip'), h('span.muted', 'Disabled'));
    }

    function nameCell(channel) {
        const chips = channelTags(channel).map(tag => {
            const color = tagColor(tag);
            return h('span.tag', { style: { flexShrink: '0', ...(color ? { background: color } : {}) } }, tag.name);
        });
        // Single line, never wrapping: the name always shows in full; if there are
        // more tags than fit, they clip horizontally rather than growing the row.
        return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', paddingLeft: '18px', verticalAlign: 'middle' } },
            h('span', { style: { flexShrink: '0' } }, channel.name || ''),
            chips.length ? h('span', { style: { display: 'inline-flex', gap: '6px', flexWrap: 'nowrap', overflow: 'hidden', maxWidth: '260px' } }, chips) : null);
    }

    function channelRow(channel) {
        const status = statusById[channel.id];
        const delta = status ? Number(status.deployedRevisionDelta) || 0 : null;
        // A channel is out of sync (needs redeploy) when its saved revision is
        // ahead of the deployed one OR its code templates changed since deploy —
        // so the delta can read 0 yet still be flagged (matches the engine).
        const ctChanged = !!status && (status.codeTemplatesChanged === true || status.codeTemplatesChanged === 'true');
        const outOfSync = delta > 0 || ctChanged;
        const revTitle = !outOfSync ? undefined
            : delta > 0 && ctChanged ? 'Channel and code templates changed since last deployment'
                : delta > 0 ? 'Channel changed since last deployment'
                    : 'Code templates changed since last deployment';

        const tr = h('tr', { class: selected.has(channel.id) ? 'selected' : null, style: { cursor: 'pointer' } },
            h('td', ''),
            h('td', statusCell(channel)),
            h('td', channel.sourceConnector?.transformer?.inboundDataType || ''),
            h('td', nameCell(channel)),
            h('td.mono', h('span', { style: { color: 'var(--text-faint)' } }, channel.id || '')),
            h('td', descriptionCell(channel.description)),
            delta === null ? h('td.num', '--')
                : outOfSync ? h('td.num.cell-flag', { title: revTitle }, String(delta))
                    : h('td.num', '0'),
            h('td.mono', status ? fmtDate(status.deployedDate) : '--'),
            h('td.mono', fmtDate(channel.exportData?.metadata?.lastModified)));

        tr.addEventListener('click', (e) => {
            if (e.metaKey || e.ctrlKey) {
                selected.has(channel.id) ? selected.delete(channel.id) : selected.add(channel.id);
            } else if (e.shiftKey && lastClicked) {
                const visible = visibleChannelIds();
                const a = visible.indexOf(lastClicked), b = visible.indexOf(channel.id);
                if (a !== -1 && b !== -1) selected = new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
                else selected = new Set([channel.id]);
            } else {
                selected = new Set([channel.id]);
            }
            lastClicked = channel.id;
            // A channel selection clears any group selection (mutually exclusive).
            lastGroupId = null;
            renderTable();
            updateTasks();
            updateGroupTasks();
        });
        // Drag channels onto group rows to re-group them.
        tr.draggable = true;
        tr.addEventListener('dragstart', (e) => {
            dragIds = selected.has(channel.id) ? new Set(selected) : new Set([channel.id]);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', [...dragIds].join(','));
        });
        tr.addEventListener('dragend', () => { dragIds = null; });
        tr.addEventListener('dblclick', () => platform.router.navigate(`/channels/${channel.id}/edit`));
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!selected.has(channel.id)) {
                selected = new Set([channel.id]);
                lastClicked = channel.id;
                lastGroupId = null;
                renderTable();
                updateTasks();
                updateGroupTasks();
            }
            // Full Swing channelPopupMenu (ChannelPanel) — the whole Channel Tasks list.
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', onClick: () => refresh() },
                { label: 'Redeploy All', icon: 'deploy', onClick: () => redeployAllTask() },
                '-',
                { label: 'Edit Global Scripts', icon: 'scripts', onClick: () => platform.router.navigate('/global-scripts') },
                { label: 'Edit Code Templates', icon: 'code', onClick: () => platform.router.navigate('/code-templates') },
                '-',
                { label: 'New Channel', icon: 'plus', onClick: () => newTask() },
                { label: 'Import Channel', icon: 'import', onClick: () => importTask() },
                { label: 'Export All Channels', icon: 'export', onClick: () => exportAllTask() },
                '-',
                { label: 'Edit Channel', icon: 'edit', onClick: () => platform.router.navigate(`/channels/${channel.id}/edit`) },
                { label: 'View Messages', icon: 'messages', onClick: () => messagesTask() },
                '-',
                { label: 'Deploy Channel', icon: 'deploy', onClick: () => deployTask() },
                { label: 'Enable Channel', icon: 'check', onClick: () => setEnabledTask(true) },
                { label: 'Disable Channel', icon: 'x', onClick: () => setEnabledTask(false) },
                '-',
                { label: 'Clone Channel', icon: 'copy', onClick: () => cloneTask() },
                { label: 'Export Channel', icon: 'export', onClick: () => exportTask() },
                { label: 'Move to Group…', icon: 'folder', onClick: () => moveToGroupTask() },
                '-',
                { label: 'Delete Channel', icon: 'trash', danger: true, onClick: () => deleteTask() }
            ]);
        });
        return tr;
    }

    function visibleChannelIds() {
        return groupedChannels()
            .filter(g => !collapsed.has(g.id))
            .flatMap(g => [...g.channels]
                .filter(matchesFilter)
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
                .map(c => c.id));
    }

    /* ---- data --------------------------------------------------------------- */

    async function refresh() {
        try {
            const [channelList, groupList, tagList, statusList] = await Promise.all([
                api.channels.list(),
                api.channelGroups.list().catch(() => []),
                api.server.channelTags().catch(() => []),
                api.status.list().catch(() => [])
            ]);
            channels = channelList.filter(c => c && c.id);
            groups = groupList.filter(g => g && g.id);
            tags = tagList;
            statusById = {};
            for (const st of statusList) {
                if (st && st.channelId) statusById[st.channelId] = st;
            }
            const ids = new Set(channels.map(c => c.id));
            for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
            // Drop a stale group selection (group deleted/renamed away).
            if (lastGroupId && lastGroupId !== DEFAULT_GROUP_ID && !groups.some(g => g.id === lastGroupId)) lastGroupId = null;
            renderTable();
            updateTasks();
            updateGroupTasks();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ---- selection helpers ---------------------------------------------------- */

    function selectedChannels() {
        return channels.filter(c => selected.has(c.id));
    }

    function single() {
        const rows = selectedChannels();
        if (rows.length !== 1) { toast('Select a single channel', 'warn'); return null; }
        return rows[0];
    }

    function multi() {
        const rows = selectedChannels();
        if (!rows.length) { toast('Select a channel first', 'warn'); return null; }
        return rows;
    }

    /* ---- channel tasks ----------------------------------------------------------- */

    async function redeployAllTask() {
        if (!await confirmDialog('Redeploy All', 'Undeploy and redeploy all channels?', { okLabel: 'Redeploy' })) return;
        try {
            await api.engine.redeployAll();
            toast('Redeploy task sent');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function newTask() {
        // No name prompt — go straight to the Summary tab with an empty Name
        // field focused (the editor focuses it when isNew).
        const channel = newChannel('', platform.store.getState('serverVersion') || '4.6.0');
        platform.store.setState('editingChannel', channel);
        platform.router.navigate(`/channels/${channel.id}/edit?new=1`);
    }

    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                // XML export — handles bundled code template libraries.
                await importChannelXml(content);
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.channel) obj = obj.channel;
                // JSON bundle (web-admin native): merge bundled libraries as objects.
                const bundled = api.asList(obj.exportData && obj.exportData.codeTemplateLibraries, 'codeTemplateLibrary')
                    .filter(l => l && typeof l === 'object' && l.id);
                if (bundled.length && await shouldImportBundledLibraries(bundled.length)) {
                    const existing = await api.codeTemplates.libraries(true);
                    await api.codeTemplates.updateLibraries(mergeImportedLibraries(existing, bundled, obj.id));
                }
                // Libraries are saved separately; strip them before creating the channel.
                if (obj.exportData) delete obj.exportData.codeTemplateLibraries;
                await api.channels.create(obj);
            }
            toast(`Imported ${file.name}`);
            refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* Exports use the engine's own XStream XML (Accept: application/xml) so the
       files are interchangeable with the Swing Administrator. The engine bundles
       the channel's code template libraries into exportData when asked
       (includeCodeTemplateLibraries) — same format the Swing client produces. */
    async function exportTask() {
        const channel = single();
        if (!channel) return;
        try {
            // The Save dialog must open within the click gesture, so it's the
            // first await — the "include libraries?" prompt + fetch run inside the
            // content callback (after the file is chosen).
            await saveFile(`${channel.name || channel.id}.xml`, 'application/xml', async () => {
                const pref = getPref('exportLibrariesWithChannels');
                let includeLibs = pref === 'yes';
                if (pref === 'ask') {
                    includeLibs = await confirmDialog('Export Channel',
                        'Include this channel\'s code template libraries in the export?', { okLabel: 'Include' });
                }
                return api.getXml(`/channels/${channel.id}`, includeLibs ? { includeCodeTemplateLibraries: true } : undefined);
            });
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function exportAllTask() {
        if (!channels.length) { toast('No channels to export', 'warn'); return; }
        try {
            // One combined Swing-format <list> of <channel> elements.
            await saveFile('channels.xml', 'application/xml', () => api.getXml('/channels'));
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function cloneTask() {
        const channel = single();
        if (!channel) return;
        try {
            const copy = structuredClone(channel);
            copy.id = uuid();
            copy.name = `${channel.name} copy`;
            copy.revision = 0;
            await api.channels.create(copy);
            toast(`Cloned ${channel.name}`);
            refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function deleteTask() {
        const rows = multi();
        if (!rows) return;
        if (!await confirmDialog('Delete channels', `Permanently delete ${rows.length} channel(s)? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        for (const channel of rows) {
            try { await api.channels.remove(channel.id); } catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }

    async function setEnabledTask(enabled) {
        const rows = multi();
        if (!rows) return;
        for (const channel of rows) {
            try { await api.channels.setEnabled(channel.id, enabled); } catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }

    async function deployTask() {
        const rows = multi();
        if (!rows) return;
        try {
            await api.engine.deployMany(rows.map(c => c.id));
            toast('Deploy task sent');
        } catch (e) {
            toast(e.message, 'error');
        }
        refresh();
    }

    function messagesTask() {
        const channel = single();
        if (!channel) return;
        platform.router.navigate(`/messages/${channel.id}`);
    }

    /* Move channels between groups (used by the modal task and drag/drop).
       targetId DEFAULT_GROUP_ID means "remove from all groups". */
    async function moveChannelsToGroup(ids, targetId) {
        const updated = structuredClone(groups);
        for (const group of updated) {
            let members = api.asList(group.channels, 'channel').filter(m => m && m.id && !ids.has(m.id));
            if (group.id === targetId) members = members.concat([...ids].map(id => ({ id })));
            group.channels = members.length ? { channel: members } : null;
        }
        try {
            await api.channelGroups.bulkUpdate(updated, []);
            toast('Channels moved');
            refresh();
            return true;
        } catch (e) {
            toast(e.message, 'error');
            return false;
        }
    }

    function moveToGroupTask() {
        const rows = multi();
        if (!rows) return;
        const ids = new Set(rows.map(c => c.id));
        const picker = select(
            [{ value: DEFAULT_GROUP_ID, label: '[Default Group]' },
             ...groups.map(g => ({ value: g.id, label: g.name }))],
            DEFAULT_GROUP_ID);
        modal({
            title: 'Move to Group',
            body: h('div.field',
                h('label', `Move ${rows.length} channel(s) to:`), picker),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Move', primary: true,
                    onClick: async () => !(await moveChannelsToGroup(ids, picker.value)) && false
                }
            ]
        });
    }

    /* ---- group tasks --------------------------------------------------------------- */

    async function newGroupTask() {
        const name = await promptDialog('New Group', 'Group name');
        if (name === null || !name.trim()) return;
        const updated = structuredClone(groups);
        updated.push({ id: uuid(), name: name.trim(), revision: 0, description: '', channels: null });
        try {
            await api.channelGroups.bulkUpdate(updated, []);
            toast(`Created group ${name.trim()}`);
            refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* The last-clicked real group row (group tasks ignore the synthetic
       Default Group, which only exists client-side). */
    function lastClickedGroup() {
        if (!lastGroupId || lastGroupId === DEFAULT_GROUP_ID) {
            toast('Select a group row first', 'warn');
            return null;
        }
        const group = groups.find(g => g.id === lastGroupId);
        if (!group) toast('Select a group row first', 'warn');
        return group || null;
    }

    async function deleteGroupTask() {
        const group = lastClickedGroup();
        if (!group) return;
        if (!await confirmDialog('Delete Group', `Delete group "${group.name}"? Its channels move to the Default Group.`, { danger: true, okLabel: 'Delete' })) return;
        const remaining = structuredClone(groups.filter(g => g.id !== group.id));
        try {
            await api.channelGroups.bulkUpdate(remaining, [group.id]);
            toast(`Deleted group ${group.name}`);
            lastGroupId = null;
            refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function editGroupTask() {
        const group = lastClickedGroup();
        if (!group) return;
        const nameInput = textInput(group.name || '');
        const descArea = h('textarea', { rows: 4 });
        descArea.value = group.description || '';
        modal({
            title: 'Edit Group Details',
            body: h('div', field('Name', nameInput), field('Description', descArea)),
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Save', primary: true,
                    onClick: async () => {
                        const name = nameInput.value.trim();
                        if (!name) { toast('Group name is required', 'warn'); return false; }
                        const updated = structuredClone(groups);
                        const target = updated.find(g => g.id === group.id);
                        target.name = name;
                        target.description = descArea.value;
                        try {
                            await api.channelGroups.bulkUpdate(updated, []);
                            toast(`Group "${name}" updated`);
                            refresh();
                        } catch (e) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    /* The engine has no direct group import endpoint (only the multipart
       _bulkUpdate), so Swing-format group XML is parsed client-side into
       {id, name, description, channels} and merged via bulkUpdate. */
    function parseGroupXml(text) {
        const doc = new DOMParser().parseFromString(String(text || '').trim(), 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
        const root = doc.documentElement;
        const els = root.tagName === 'channelGroup'
            ? [root]
            : [...root.querySelectorAll(':scope > channelGroup')];
        if (!els.length) throw new Error('No <channelGroup> elements found in the file');
        return els.map(el => {
            const childText = (tag) => {
                const child = [...el.children].find(c => c.tagName === tag);
                return child ? child.textContent : '';
            };
            const refs = [...el.querySelectorAll(':scope > channels > channel')]
                .map(c => ({ id: [...c.children].find(x => x.tagName === 'id')?.textContent }))
                .filter(ref => ref.id);
            return {
                id: childText('id') || uuid(),
                name: childText('name') || 'Imported Group',
                revision: 0,
                description: childText('description'),
                channels: refs.length ? { channel: refs } : null
            };
        });
    }

    async function importGroupTask() {
        const file = await pickFile('.xml');
        if (!file) return;
        try {
            const imported = parseGroupXml(file.content);
            const importedIds = new Set(imported.map(g => g.id));
            const importedChannelIds = new Set(imported.flatMap(g =>
                api.asList(g.channels, 'channel').map(ref => ref.id)));
            // Replace same-id groups and pull imported channels out of other
            // groups (a channel may only belong to one group).
            const updated = structuredClone(groups.filter(g => !importedIds.has(g.id)));
            for (const group of updated) {
                const members = api.asList(group.channels, 'channel')
                    .filter(ref => ref && ref.id && !importedChannelIds.has(ref.id));
                group.channels = members.length ? { channel: members } : null;
            }
            await api.channelGroups.bulkUpdate(updated.concat(imported), []);
            toast(`Imported ${imported.length} group(s) from ${file.name}`);
            refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* The engine has no single-group XML GET, so fetch the full Swing-format
       <list> and extract the one <channelGroup> element verbatim. */
    async function exportGroupTask() {
        const group = lastClickedGroup();
        if (!group) return;
        try {
            await saveFile(`${group.name || group.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml('/channelgroups');
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Engine returned invalid XML');
                const el = [...doc.querySelectorAll('channelGroup')].find(node =>
                    [...node.children].find(c => c.tagName === 'id')?.textContent === group.id);
                if (!el) throw new Error(`Group "${group.name}" not found in the engine's XML`);
                return new XMLSerializer().serializeToString(el);
            });
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function exportGroupsTask() {
        try {
            await saveFile('channel-groups.xml', 'application/xml', () => api.getXml('/channelgroups'));
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ---- task bars -------------------------------------------------------------------- */

    const selButtons = [
        taskButton('Export Channel', 'export', exportTask),
        taskButton('Clone', 'copy', cloneTask),
        taskButton('Delete', 'trash', deleteTask, { danger: true }),
        taskButton('Enable', 'check', () => setEnabledTask(true)),
        taskButton('Disable', 'x', () => setEnabledTask(false)),
        taskButton('Deploy', 'deploy', deployTask),
        taskButton('View Messages', 'messages', messagesTask),
        taskButton('Move to Group…', 'folder', moveToGroupTask)
    ];

    // Selection-dependent tasks live in a context group that only shows when
    // a channel is selected (classic task-pane behavior).
    const ctxTasks = h('div.ctx-tasks.hidden',
        h('span.sep'),
        selButtons);

    function updateTasks() {
        const none = selected.size === 0;
        for (const btn of selButtons) btn.disabled = none;
        ctxTasks.classList.toggle('hidden', none);
    }
    updateTasks();

    // Group tasks that require a selected (real) group — hidden otherwise.
    const groupSelButtons = [
        taskButton('Edit Group Details', 'edit', editGroupTask),
        taskButton('Delete Group', 'trash', deleteGroupTask, { danger: true }),
        taskButton('Export Group', 'export', exportGroupTask)
    ];
    const groupCtxTasks = h('div.ctx-tasks.hidden', h('span.sep'), groupSelButtons);

    function updateGroupTasks() {
        const hasGroup = !!lastGroupId && lastGroupId !== DEFAULT_GROUP_ID && groups.some(g => g.id === lastGroupId);
        groupCtxTasks.classList.toggle('hidden', !hasGroup);
    }

    const taskbar = h('div.taskbar', { dataset: { paneTitle: 'Channel Tasks' } },
        taskButton('Refresh', 'refresh', () => refresh()),
        taskButton('Redeploy All', 'deploy', redeployAllTask),
        taskButton('Edit Global Scripts', 'scripts', () => platform.router.navigate('/global-scripts')),
        taskButton('Edit Code Templates', 'code', () => platform.router.navigate('/code-templates')),
        taskButton('New Channel', 'plus', newTask, { primary: true }),
        taskButton('Import Channel', 'import', importTask),
        taskButton('Export All Channels', 'export', exportAllTask),
        ctxTasks);

    const groupTaskbar = h('div.taskbar',
        taskButton('New Group', 'plus', newGroupTask),
        taskButton('Import Group', 'import', importGroupTask),
        taskButton('Export All Groups', 'export', exportGroupsTask),
        groupCtxTasks);
    groupTaskbar.dataset.paneTitle = 'Group Tasks';
    updateGroupTasks();

    /* ---- filter bar ---------------------------------------------------------------------- */

    const filterbar = h('div.filterbar',
        h('label', 'Filter:'),
        h('input', {
            type: 'text',
            placeholder: 'Enter channel tag or name',
            onInput: (e) => { filterText = e.target.value; renderTable(); }
        }),
        countsEl);

    refresh();

    const el = h('div.view',
        taskbar,
        groupTaskbar,
        h('div.view-body.flush', { style: { display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            tableHost,
            filterbar));

    return { el };
}
