/*
 * Channels view (React port of the LIST half of views/channels.js). The Swing
 * channel panel is a GROUPED TREE-TABLE — channels listed under their channel
 * group (or a synthetic "[Default Group]"), with twisty expand/collapse, indented
 * channel rows carrying tag chips, drag-channel-onto-group to re-group,
 * click-empty-to-clear, and a bottom counts bar. That hierarchy is now the
 * declarative <TreeTable> (parent group rows + channel child rows), driven by the
 * working list/selection/filter/collapsed state kept in refs — group/channel
 * rows, twisties, the column manager (resizable/hideable/reorderable/persisted),
 * per-row + header context menus, and drag-to-regroup are all owned by TreeTable.
 *
 * Two flat task panes — Channel Tasks / Group Tasks — render as React
 * <TaskButton>s gated on the current selection (effectiveChannels()/single()/
 * multi()); a useReducer force-update (renderTable()) refreshes the React tree +
 * task panes. New Channel seeds store.editingChannel and navigates to the
 * channel editor — a React view registered at /channels/:channelId/edit.
 */

import { useEffect, useRef, useReducer } from 'react';
import { h, icon, toast, confirmDialog, promptDialog, contextMenu, modal, select, field, textInput, saveFile, pickFile, fmtDate } from '@oie/web-ui';
import api, { newChannel, uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { checkImportVersion, checkImportVersionFromDoc } from '../../core/import-guard.js';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';

export function register(platform) {
    platform.registerNavItem({ id: 'channels', label: 'Channels', icon: 'channels', path: '/channels', section: 'Engine', order: 1, task: 'doShowChannel' });
    platform.registerView('/channels', reactView(ChannelsView), { title: 'Channels' });
}

// Canonical data columns (the Name column carries the tree twisty/indent), with
// default widths. Order/visibility/widths are persisted by TreeTable's column
// manager under the same 'channels' key the legacy grid used.
const CHANNEL_COLUMNS = [
    { key: 'status', label: 'Status', width: 140 },   // tree column: carries the depth indent + twisty spacer + pip, so needs room for "Disabled"/"Invalid"
    { key: 'dataType', label: 'Data Type', width: 95 },
    { key: 'name', label: 'Name', width: 280 },
    { key: 'id', label: 'Id', width: 250 },
    { key: 'description', label: 'Description', width: 240 },
    { key: 'revDelta', label: 'Rev Δ', width: 60 },
    { key: 'lastDeployed', label: 'Last Deployed', width: 150 },
    { key: 'lastModified', label: 'Last Modified', width: 150 }
];
const CHANNEL_COL_WIDTHS = Object.fromEntries(CHANNEL_COLUMNS.map(c => [c.key, c.width]));

const DEFAULT_GROUP_ID = '__default__';

/* ---- code template library bundling (Swing "import/export libraries with channels") ----
   Export uses the engine (includeCodeTemplateLibraries) to bundle libraries into the
   channel XML. Import must merge those libraries itself — the engine doesn't auto-import
   exportData.codeTemplateLibraries on channel create (ChannelPanel does it client-side). */

// OK-only warning (Swing alertWarning).
function alertWarning(message) {
    return new Promise(resolve => modal({
        title: 'Warning', body: h('div', String(message)), onClose: resolve,
        buttons: [{ label: 'OK', primary: true, onClick: resolve }]
    }));
}

// OK-only info (Swing alertInformation, title "Information"). pre-line renders the
// message's \n line breaks the way JOptionPane does.
function alertInformation(message) {
    return new Promise(resolve => modal({
        title: 'Information',
        body: h('div', { style: 'white-space: pre-line' }, String(message)),
        onClose: resolve,
        buttons: [{ label: 'OK', primary: true, onClick: resolve }]
    }));
}

// Yes / No option (Swing alertOption): resolves true on Yes, false on No/closed.
function optionYesNo(title, message) {
    return new Promise(resolve => modal({
        title, body: h('div', { style: 'white-space: pre-line' }, String(message)), onClose: () => resolve(false),
        buttons: [
            { label: 'No', onClick: () => resolve(false) },
            { label: 'Yes', primary: true, onClick: () => resolve(true) }
        ]
    }));
}

// "Channel X has code template libraries included — import them?" — Yes/No/Cancel
// with an "always" checkbox that persists the importLibrariesWithChannels pref.
// Returns 'yes' | 'no' | 'cancel'.
function promptImportLibraries(channelName, count) {
    const pref = getPref('importLibrariesWithChannels');
    if (pref === 'yes') return Promise.resolve('yes');
    if (pref === 'no') return Promise.resolve('no');
    const plural = count === 1 ? 'y' : 'ies';
    const them = count === 1 ? 'it' : 'them';
    return new Promise(resolve => {
        const always = h('input', { type: 'checkbox' });
        const remember = (choice) => { if (always.checked) setPrefs({ importLibrariesWithChannels: choice }); return choice; };
        modal({
            title: 'Import Channel',
            body: h('div',
                h('div', { class: 'mb-2.5' },
                    `Channel "${channelName}" has code template librar${plural} included with it. Would you like to import ${them}?`),
                h('label', { class: 'flex items-center gap-1.5 text-[12px]' },
                    always, 'Always choose this option by default in the future (may be changed in Settings)')),
            onClose: () => resolve('cancel'),
            buttons: [
                { label: 'Cancel', onClick: () => resolve('cancel') },
                { label: 'No', onClick: () => resolve(remember('no')) },
                { label: 'Yes', primary: true, onClick: () => resolve(remember('yes')) }
            ]
        });
    });
}

// Code template library names linked to a channel (same predicate as the Set
// Dependencies modal): enabled for the channel, or include-new and not disabled.
async function linkedLibraryNames(channelId) {
    try {
        const libs = await api.codeTemplates.libraries(false);
        const idSet = (v) => api.asList(v, 'string').map(String);
        const cid = String(channelId);
        return libs.filter(lib =>
            idSet(lib.enabledChannelIds).includes(cid) ||
            (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(cid)))
            .map(lib => lib.name || '(unnamed library)');
    } catch { return []; }
}

// Swing channel-export dialog: lists the linked libraries and asks whether to
// bundle them, Yes/No/Cancel, with an "always" checkbox persisting the
// exportLibrariesWithChannels pref. Returns 'yes' | 'no' | 'cancel'.
function promptExportLibraries(names) {
    return new Promise(resolve => {
        const always = h('input', { type: 'checkbox' });
        const remember = (choice) => { if (always.checked) setPrefs({ exportLibrariesWithChannels: choice }); return choice; };
        modal({
            title: 'Export Channel',
            body: h('div',
                h('div', { class: 'mb-1.5' }, 'The following code template libraries are linked to this channel:'),
                h('div', { class: 'border border-line rounded-[4px] bg-bg1 py-1.5 px-2.5 max-h-[140px] overflow-auto' },
                    h('ul', { class: 'm-0 pl-[18px]' }, names.map(n => h('li', n)))),
                h('div', { class: 'mt-2.5 mx-0 mb-2' }, 'Do you wish to include these libraries in the channel export?'),
                h('label', { class: 'flex items-center gap-1.5 text-[12px]' },
                    always, 'Always choose this option by default in the future (may be changed in Settings)')),
            onClose: () => resolve('cancel'),
            buttons: [
                { label: 'Cancel', onClick: () => resolve('cancel') },
                { label: 'No', onClick: () => resolve(remember('no')) },
                { label: 'Yes', primary: true, onClick: () => resolve(remember('yes')) }
            ]
        });
    });
}

const CHANNEL_NAME_RE = /^[a-zA-Z_0-9\-\s]*$/;

/* Resolve a name/id collision on channel import, mirroring Swing's
   ChannelPanel.importChannel + Frame.checkChannelName: warn that the channel
   exists, then offer overwrite (reuse the existing id + revision) or create-new
   (prompt for a free name, fresh id). Returns { id, name, revision, overwrite }
   to apply to the imported channel, or null to abort. `existing` is the current
   channel list (for collision). */
async function resolveImportName(name, id, existing) {
    const tempId = uuid();
    const nameClash = (n, candidateId) => existing.some(c =>
        String(c.name || '').toLowerCase() === String(n).toLowerCase() && c.id !== candidateId);

    async function checkName(n, candidateId) {
        if (!n) { await alertWarning('Channel name cannot be empty.'); return false; }
        if (n.length > 40) { await alertWarning('Channel name cannot be longer than 40 characters.'); return false; }
        if (!CHANNEL_NAME_RE.test(n)) { await alertWarning('Channel name cannot have special characters besides hyphen, underscore, and space.'); return false; }
        if (nameClash(n, candidateId)) { await alertWarning(`Channel "${n}" already exists.`); return false; }
        return true;
    }

    if (!(await checkName(name, tempId))) {
        if (!(await optionYesNo('Import Channel', "Would you like to overwrite the existing channel?  Choose 'No' to create a new channel."))) {
            let newName = name;
            do {
                newName = await promptDialog('Import Channel', 'Please enter a new name for the channel.', newName);
                if (newName == null) return null;             // Cancel → abort
            } while (!(await checkName(newName, tempId)));
            return { id: tempId, name: newName, revision: 0, overwrite: false };
        }
        const match = existing.find(c => String(c.name || '').toLowerCase() === String(name).toLowerCase());
        return { id: match ? match.id : id, name, revision: match ? (Number(match.revision) || 0) : 0, overwrite: true };
    }
    // No name collision — make sure the id is free too.
    const idClash = existing.some(c => c.id === id);
    return { id: idClash ? tempId : id, name, revision: 0, overwrite: false };
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

// Import a channel XML export: resolve a name/id collision (warn + overwrite or
// rename), handle bundled libraries, then create or overwrite. Returns false if
// the user cancelled. `existing` is the current channel list (for collision).
async function importChannelXml(xml, existing) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'channel') {
        throw new Error('Not a valid channel XML file');
    }
    const channelEl = doc.documentElement;
    // Swing promptObjectMigration: block newer-than-server exports (alertInformation),
    // confirm the automatic conversion for older/unknown ones (Yes/No "Select an
    // Option"), import same-version silently.
    const verdict = checkImportVersion(channelEl.getAttribute('version'), 'channel');
    if (verdict.action === 'block') {
        await alertInformation(verdict.message);
        return false;
    }
    if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) {
        return false;
    }
    const directChild = (tag) => [...channelEl.children].find(c => c.tagName === tag);
    const setChild = (tag, value) => {
        let el = directChild(tag);
        if (!el) { el = doc.createElement(tag); channelEl.appendChild(el); }
        el.textContent = value;
    };

    const name = directChild('name')?.textContent || '';
    const id = directChild('id')?.textContent || '';

    const resolved = await resolveImportName(name, id, existing);
    if (!resolved) return false;

    if (resolved.id !== id) {
        // Re-point bundled libraries from the old channel id to the new one.
        for (const enabled of channelEl.querySelectorAll('exportData > codeTemplateLibraries > codeTemplateLibrary > enabledChannelIds')) {
            [...enabled.children].forEach(s => { if (s.tagName === 'string' && s.textContent === id) s.remove(); });
            const s = doc.createElement('string'); s.textContent = resolved.id; enabled.appendChild(s);
        }
        setChild('id', resolved.id);
    }
    if (resolved.name !== name) setChild('name', resolved.name);
    setChild('revision', String(resolved.revision));

    const libsContainer = channelEl.querySelector('exportData > codeTemplateLibraries');
    const bundled = libsContainer ? [...libsContainer.children].filter(c => c.tagName === 'codeTemplateLibrary') : [];
    if (bundled.length) {
        const choice = await promptImportLibraries(resolved.name, bundled.length);
        if (choice === 'cancel') return false;
        if (choice === 'yes') await importLibraryElementsXml(bundled);
    }
    // The engine ignores bundled libraries on create; strip them from the channel.
    if (libsContainer && libsContainer.parentNode) libsContainer.parentNode.removeChild(libsContainer);

    const body = new XMLSerializer().serializeToString(doc);
    if (resolved.overwrite) await api.putXml(`/channels/${encodeURIComponent(resolved.id)}`, body, { override: true });
    else await api.post('/channels', body, { contentType: 'application/xml' });
    return true;
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

function ChannelsView() {
    const [, forceRender] = useReducer((x) => x + 1, 0);

    // Working state read by callbacks captured at mount — kept in refs.
    const channelsRef = useRef([]);
    const tagsRef = useRef([]);
    const groupsRef = useRef([]);
    const statusByIdRef = useRef({});        // channelId -> dashboardStatus
    const selectedRef = useRef(new Set());   // channel ids
    const lastClickedRef = useRef(null);     // for shift-range selection
    const lastGroupIdRef = useRef(null);     // last-clicked group row (for Delete Group)
    const collapsedRef = useRef(new Set());  // group ids (default expanded)
    const filterTextRef = useRef('');

    /* updateTasks/updateGroupTasks in the legacy toggled .hidden classes
       imperatively; here the task panes are React, so the selection-gated
       buttons re-render on a force-update. */
    function refreshTasks() { forceRender(); }

    /* ---- grouping --------------------------------------------------------- */

    /* Returns [{ id, name, description, group?, channels: [...] }] — every
       real group plus the synthetic default group for unreferenced channels. */
    function groupedChannels() {
        const channels = channelsRef.current;
        const groups = groupsRef.current;
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
        return tagsRef.current.filter(t => api.asList(t.channelIds, 'string').includes(channel.id));
    }

    function matchesFilter(channel) {
        const needle = filterTextRef.current.trim().toLowerCase();
        if (!needle) return true;
        if (String(channel.name || '').toLowerCase().includes(needle)) return true;
        return channelTags(channel).some(t => String(t.name || '').toLowerCase().includes(needle));
    }

    /* ---- table (Swing channel group tree-table, now <TreeTable>) ----------- */

    // The tree is now the declarative <TreeTable> in the render below; renderTable()
    // just triggers a React re-render (legacy call sites are unchanged).
    function renderTable() { forceRender(); }

    function descriptionCell(text) {
        return (
            <span className="inline-block max-w-[320px] truncate align-bottom">
                {firstLine(text)}
            </span>
        );
    }

    function statusCell(channel) {
        if (isInvalid(channel)) return <span className="status-cell"><span className="pip err" />Invalid</span>;
        return isEnabled(channel)
            ? <span className="status-cell"><span className="pip ok" />Enabled</span>
            : <span className="status-cell"><span className="pip" /><span className="text-text-dim">Disabled</span></span>;
    }

    // Channel name + tag chips. The depth indent + twisty are supplied by the
    // TreeTable tree column, so (unlike the legacy) no manual paddingLeft here.
    function nameCell(channel) {
        const chips = channelTags(channel);
        // Single line, never wrapping: the name always shows in full; extra tags
        // run out to the edge of the (fixed-layout) Name column and clip there via
        // the cell's own overflow:hidden — no premature inner width cap.
        return (
            <span className="inline-flex items-center gap-1.5 flex-nowrap align-middle">
                <span className="shrink-0">{channel.name || ''}</span>
                {chips.length
                    ? <span className="inline-flex gap-1.5 flex-nowrap">
                        {chips.map((tag) => {
                            const color = tagColor(tag);
                            return <span key={tag.name} className="tag shrink-0" style={color ? { background: color } : {}}>{tag.name}</span>;
                        })}
                    </span>
                    : null}
            </span>
        );
    }

    // The revision-delta cell: a flagged badge when out of sync, '--' when there
    // is no status, '0' otherwise (Swing parity).
    function revDeltaCell(channel) {
        const status = statusByIdRef.current[channel.id];
        const delta = status ? Number(status.deployedRevisionDelta) || 0 : null;
        // A channel is out of sync (needs redeploy) when its saved revision is
        // ahead of the deployed one OR its code templates changed since deploy —
        // so the delta can read 0 yet still be flagged (matches the engine).
        const ctChanged = !!status && (status.codeTemplatesChanged === true || status.codeTemplatesChanged === 'true');
        const outOfSync = delta > 0 || ctChanged;
        if (delta === null) return '--';
        if (!outOfSync) return '0';
        const revTitle = delta > 0 && ctChanged ? 'Channel and code templates changed since last deployment'
            : delta > 0 ? 'Channel changed since last deployment'
                : 'Code templates changed since last deployment';
        return <span className="cell-flag" title={revTitle}>{String(delta)}</span>;
    }

    /* Cell CONTENT for each column, for both group rows and channel rows. The
       TreeTable supplies the <td> (with mono/align), the depth indent, and the
       twisty on the tree column. The leading Status column carries the twisty +
       indent (mirroring the legacy's dedicated leftmost twisty column), which
       keeps the Name cell text clean ('[Default Group]' / the channel name). */
    function treeColumns() {
        return CHANNEL_COLUMNS.map((c) => ({
            key: c.key, label: c.label, align: c.key === 'revDelta' ? 'right' : undefined,
            mono: c.key === 'id', tree: c.key === 'status',
            render: (n) => {
                const isGroup = n.kind === 'group';
                switch (c.key) {
                    case 'status': return isGroup ? '' : statusCell(n.channel);
                    case 'dataType': return isGroup ? '' : (n.channel.sourceConnector?.transformer?.inboundDataType || '');
                    case 'name': return isGroup
                        ? <span className="font-bold">{`[${n.group.name}]`}</span>
                        : nameCell(n.channel);
                    case 'id': return isGroup
                        ? <span className="text-text-faint">{n.group.id === DEFAULT_GROUP_ID ? 'Default Group' : (n.group.id || '--')}</span>
                        : <span className="text-text-faint">{n.channel.id || ''}</span>;
                    case 'description': return isGroup
                        ? <span className="text-text-dim">{descriptionCell(n.group.description)}</span>
                        : descriptionCell(n.channel.description);
                    case 'revDelta': return isGroup ? '--' : revDeltaCell(n.channel);
                    case 'lastDeployed': return isGroup ? '--'
                        : (statusByIdRef.current[n.channel.id] ? fmtDate(statusByIdRef.current[n.channel.id].deployedDate) : '--');
                    case 'lastModified': return isGroup ? '--' : fmtDate(n.channel.exportData?.metadata?.lastModified);
                    default: return '';
                }
            }
        }));
    }

    // A click on a group row selects the group (mutually exclusive with channel
    // selection), matching the legacy selectGroup().
    function selectGroup(group) {
        lastGroupIdRef.current = group.id;
        selectedRef.current = new Set();
        lastClickedRef.current = null;
        refreshTasks();
    }

    // A click on a channel row: ctrl/meta toggles, shift extends the range over
    // the visible (expanded, filtered, sorted) channels, plain selects one — and
    // clears any group selection (mutually exclusive). Mirrors the legacy click.
    function selectChannel(channel, e) {
        const selected = selectedRef.current;
        if (e.metaKey || e.ctrlKey) {
            selected.has(channel.id) ? selected.delete(channel.id) : selected.add(channel.id);
        } else if (e.shiftKey && lastClickedRef.current) {
            const visible = visibleChannelIds();
            const a = visible.indexOf(lastClickedRef.current), b = visible.indexOf(channel.id);
            if (a !== -1 && b !== -1) selectedRef.current = new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
            else selectedRef.current = new Set([channel.id]);
        } else {
            selectedRef.current = new Set([channel.id]);
        }
        lastClickedRef.current = channel.id;
        lastGroupIdRef.current = null;
        refreshTasks();
    }

    function onRowSelect(node, e) {
        if (node.kind === 'group') selectGroup(node.group);
        else selectChannel(node.channel, e);
    }

    function onRowActivate(node) {
        // Double-click: a group toggles its collapse; a channel opens the editor.
        if (node.kind === 'group') {
            const collapsed = collapsedRef.current;
            collapsed.has(node.group.id) ? collapsed.delete(node.group.id) : collapsed.add(node.group.id);
            forceRender();
        } else {
            router.navigate(`/channels/${node.channel.id}/edit`);
        }
    }

    // Right-click on blank space (empty list, or below the rows): clear any
    // selection and offer the channel-panel background actions — the Swing
    // MirthTree background popup, so New Channel is reachable when the list is empty.
    function onEmptyMenu(e) {
        e.preventDefault();
        if (selectedRef.current.size || lastGroupIdRef.current) {
            selectedRef.current = new Set();
            lastClickedRef.current = null;
            lastGroupIdRef.current = null;
            refreshTasks();
        }
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
            '-',
            { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() },
            { label: 'Import Channel', icon: 'import', task: 'doImportChannel', group: 'channel', onClick: () => importTask() },
            { label: 'Export All Channels', icon: 'export', task: 'doExportAllChannels', group: 'channel', onClick: () => exportAllTask() },
            '-',
            { label: 'New Group', icon: 'plus', task: 'doNewGroup', group: 'channelGroup', onClick: () => newGroupTask() },
            { label: 'Import Group', icon: 'import', task: 'doImportGroup', group: 'channelGroup', onClick: () => importGroupTask() },
            { label: 'Export All Groups', icon: 'export', task: 'doExportAllGroups', group: 'channelGroup', onClick: () => exportGroupsTask() },
            '-',
            { label: 'Edit Global Scripts', icon: 'scripts', task: 'doEditGlobalScripts', group: 'channel', onClick: () => router.navigate('/global-scripts') },
            { label: 'Edit Code Templates', icon: 'code', task: 'doEditCodeTemplates', group: 'channel', onClick: () => router.navigate('/code-templates') }
        ]);
    }

    function onRowMenu(node, e) {
        e.preventDefault();
        if (node.kind === 'group') {
            selectGroup(node.group);
            const isRealGroup = node.group.id !== DEFAULT_GROUP_ID;
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
                '-',
                { label: 'New Group', icon: 'plus', task: 'doNewGroup', group: 'channelGroup', onClick: () => newGroupTask() },
                { label: 'Edit Group Details', icon: 'edit', task: 'doEditGroupDetails', group: 'channelGroup', hidden: !isRealGroup, onClick: () => editGroupTask() },
                { label: 'Delete Group', icon: 'trash', danger: true, task: 'doDeleteGroup', group: 'channelGroup', hidden: !isRealGroup, onClick: () => deleteGroupTask() },
                '-',
                { label: 'Import Group', icon: 'import', task: 'doImportGroup', group: 'channelGroup', onClick: () => importGroupTask() },
                { label: 'Export Group', icon: 'export', task: 'doExportGroup', group: 'channelGroup', hidden: !isRealGroup, onClick: () => exportGroupTask() },
                { label: 'Export All Groups', icon: 'export', task: 'doExportAllGroups', group: 'channelGroup', onClick: () => exportGroupsTask() },
                '-',
                { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() }
            ]);
            return;
        }
        const channel = node.channel;
        if (!selectedRef.current.has(channel.id)) {
            selectedRef.current = new Set([channel.id]);
            lastClickedRef.current = channel.id;
            lastGroupIdRef.current = null;
            refreshTasks();
        }
        // Plugin-contributed per-channel actions (platform.registerChannelAction),
        // e.g. "View History". Shown for a single-channel selection unless the
        // action supplies its own isEnabled. Mirrors Swing's ChannelPanelPlugin tasks.
        const actionCtx = { platform, channel, selectedIds: new Set(selectedRef.current) };
        const singleSel = selectedRef.current.size === 1;
        const pluginItems = platform.channelActions()
            .filter((a) => (a.isEnabled ? a.isEnabled(actionCtx) : singleSel))
            .map((a) => ({
                label: a.label, icon: a.icon, task: a.task, group: a.group || 'channel',
                onClick: () => a.onInvoke(channel, actionCtx)
            }));
        // Full Swing channelPopupMenu (ChannelPanel) — the whole Channel Tasks list.
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
            { label: 'Redeploy All', icon: 'deploy', task: 'doRedeployAll', group: 'channel', onClick: () => redeployAllTask() },
            '-',
            { label: 'Edit Global Scripts', icon: 'scripts', task: 'doEditGlobalScripts', group: 'channel', onClick: () => router.navigate('/global-scripts') },
            { label: 'Edit Code Templates', icon: 'code', task: 'doEditCodeTemplates', group: 'channel', onClick: () => router.navigate('/code-templates') },
            '-',
            { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() },
            { label: 'Import Channel', icon: 'import', task: 'doImportChannel', group: 'channel', onClick: () => importTask() },
            { label: 'Export All Channels', icon: 'export', task: 'doExportAllChannels', group: 'channel', onClick: () => exportAllTask() },
            '-',
            { label: 'Edit Channel', icon: 'edit', task: 'doEditChannel', group: 'channel', onClick: () => router.navigate(`/channels/${channel.id}/edit`) },
            { label: 'View Messages', icon: 'messages', task: 'doViewMessages', group: 'channel', onClick: () => messagesTask() },
            '-',
            { label: 'Deploy Channel', icon: 'deploy', task: 'doDeployChannel', group: 'channel', onClick: () => deployTask() },
            { label: 'Enable Channel', icon: 'check', task: 'doEnableChannel', group: 'channel', onClick: () => setEnabledTask(true) },
            { label: 'Disable Channel', icon: 'x', task: 'doDisableChannel', group: 'channel', onClick: () => setEnabledTask(false) },
            '-',
            { label: 'Clone Channel', icon: 'copy', task: 'doCloneChannel', group: 'channel', onClick: () => cloneTask() },
            { label: 'Export Channel', icon: 'export', task: 'doExportChannel', group: 'channel', onClick: () => exportTask() },
            { label: 'Move to Group…', icon: 'folder', task: 'doAssignChannelToGroup', group: 'channelGroup', onClick: () => moveToGroupTask() },
            ...(pluginItems.length ? ['-', ...pluginItems] : []),
            '-',
            { label: 'Delete Channel', icon: 'trash', danger: true, task: 'doDeleteChannel', group: 'channel', onClick: () => deleteTask() }
        ]);
    }

    // Drop a dragged channel onto a group row to re-group it. The whole current
    // channel selection moves when the dragged channel is part of it (legacy
    // dragstart behavior); otherwise just the dragged channel.
    async function onRowDrop(fromKey, toNode) {
        if (toNode.kind !== 'group') return;
        const id = String(fromKey || '').replace(/^ch:/, '');
        if (!id) return;
        const ids = selectedRef.current.has(id) ? new Set(selectedRef.current) : new Set([id]);
        const names = channelsRef.current.filter(c => ids.has(c.id)).map(c => c.name).join(', ');
        if (await confirmDialog('Move to Group',
            `Move ${ids.size === 1 ? `"${names}"` : ids.size + ' channels'} to [${toNode.group.name}]?`,
            { okLabel: 'Move' })) {
            await moveChannelsToGroup(ids, toNode.group.id);
        }
    }

    function visibleChannelIds() {
        return groupedChannels()
            .filter(g => !collapsedRef.current.has(g.id))
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
            channelsRef.current = channelList.filter(c => c && c.id);
            groupsRef.current = groupList.filter(g => g && g.id);
            tagsRef.current = tagList;
            const statusById = {};
            for (const st of statusList) {
                if (st && st.channelId) statusById[st.channelId] = st;
            }
            statusByIdRef.current = statusById;
            const ids = new Set(channelsRef.current.map(c => c.id));
            const selected = selectedRef.current;
            for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
            // Drop a stale group selection (group deleted/renamed away).
            if (lastGroupIdRef.current && lastGroupIdRef.current !== DEFAULT_GROUP_ID && !groupsRef.current.some(g => g.id === lastGroupIdRef.current)) lastGroupIdRef.current = null;
            renderTable();
            refreshTasks();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ---- selection helpers ---------------------------------------------------- */

    function selectedChannels() {
        return channelsRef.current.filter(c => selectedRef.current.has(c.id));
    }

    // Channels an action targets: the selected channels, or — when a group row is
    // selected — that group's channels (so Deploy/Enable/Disable work on a group).
    function effectiveChannels() {
        if (selectedRef.current.size) return selectedChannels();
        if (lastGroupIdRef.current) {
            const g = groupedChannels().find(x => x.id === lastGroupIdRef.current);
            return g ? g.channels : [];
        }
        return [];
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

    // Classic path: seed a blank channel and open the tabbed editor on the Summary
    // tab with the Name field focused (the editor focuses it when isNew).
    function startClassicChannel() {
        const channel = newChannel('', store.getState('serverVersion') || '4.5.2');
        store.setState('editingChannel', channel);
        router.navigate(`/channels/${channel.id}/edit?new=1`);
    }

    const startGuidedChannel = () => router.navigate('/channels/new/guided');

    // New Channel: honor the saved default builder (Settings → Administrator), or
    // show a chooser when the default is "Ask each time". The chooser's "Remember
    // my choice" writes the picked builder to that default so it stops asking.
    function newTask() {
        const pref = getPref('newChannelDefault');
        if (pref === 'classic') return startClassicChannel();
        if (pref === 'guided') return startGuidedChannel();
        openNewChannelChooser();
    }

    function openNewChannelChooser() {
        let remember = false;
        const card = (mode, iconName, title, desc) => h('button', {
            class: 'panel !mt-0 appearance-none text-[var(--text)] text-left p-3 flex gap-3 items-start cursor-pointer w-full hover:border-accent',
            style: { font: 'inherit' },
            onClick: () => {
                if (remember) setPrefs({ newChannelDefault: mode });
                m.close();
                if (mode === 'guided') startGuidedChannel(); else startClassicChannel();
            }
        }, icon(iconName, 20),
            h('div', h('div', { class: 'font-semibold' }, title), h('div.hint', desc)));
        const m = modal({
            title: 'New Channel',
            body: h('div', { class: 'flex flex-col gap-2.5 min-w-[440px]' },
                card('classic', 'edit', 'Classic editor', 'The full tabbed editor — every option on one screen.'),
                card('guided', 'wand', 'Wizard', 'A step-by-step guided builder: dependencies, options, source, destinations, filters and transforms.'),
                h('label', { class: 'flex items-center gap-2 mt-2 text-text-dim' },
                    h('input', { type: 'checkbox', onChange: (e) => { remember = e.target.checked; } }),
                    'Remember my choice (set as default)')),
            buttons: [{ label: 'Cancel' }]
        });
    }

    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                // XML export — name/id collision flow + bundled libraries.
                if (await importChannelXml(content, channelsRef.current) === false) return;
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.channel) obj = obj.channel;
                const resolved = await resolveImportName(obj.name || '', obj.id || '', channelsRef.current);
                if (!resolved) return;   // cancelled
                // JSON bundle (web-admin native): merge bundled libraries as objects.
                const bundled = api.asList(obj.exportData && obj.exportData.codeTemplateLibraries, 'codeTemplateLibrary')
                    .filter(l => l && typeof l === 'object' && l.id);
                if (resolved.id !== obj.id) {
                    // Re-point bundled libraries from the old channel id to the new one.
                    for (const lib of bundled) {
                        const ids = new Set(api.asList(lib.enabledChannelIds, 'string').map(String));
                        ids.delete(String(obj.id)); ids.add(resolved.id);
                        lib.enabledChannelIds = { string: [...ids] };
                    }
                    obj.id = resolved.id;
                }
                obj.name = resolved.name;
                obj.revision = resolved.revision;
                if (bundled.length) {
                    const choice = await promptImportLibraries(resolved.name, bundled.length);
                    if (choice === 'cancel') return;
                    if (choice === 'yes') {
                        const existing = await api.codeTemplates.libraries(true);
                        await api.codeTemplates.updateLibraries(mergeImportedLibraries(existing, bundled, obj.id));
                    }
                }
                // Libraries are saved separately; strip them before saving the channel.
                if (obj.exportData) delete obj.exportData.codeTemplateLibraries;
                if (resolved.overwrite) await api.channels.update(obj.id, obj);
                else await api.channels.create(obj);
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
        // Ask up front (before the save dialog) whether to bundle code template
        // libraries — only when the channel actually has linked ones. saveFile
        // falls back to a normal download if the native picker can't engage
        // outside the click gesture.
        const pref = getPref('exportLibrariesWithChannels');
        let includeLibs;
        if (pref === 'yes' || pref === 'no') {
            includeLibs = pref === 'yes';
        } else {
            const linked = await linkedLibraryNames(channel.id);
            if (!linked.length) {
                includeLibs = false;   // nothing to bundle — no prompt
            } else {
                const choice = await promptExportLibraries(linked);
                if (choice === 'cancel') return;   // abort the export
                includeLibs = choice === 'yes';
            }
        }
        try {
            await saveFile(`${channel.name || channel.id}.xml`, 'application/xml',
                () => api.getXml(`/channels/${channel.id}`, includeLibs ? { includeCodeTemplateLibraries: true } : undefined));
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function exportAllTask() {
        if (!channelsRef.current.length) { toast('No channels to export', 'warn'); return; }
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
        const rows = effectiveChannels();
        if (!rows.length) { toast('Select a channel or group first', 'warn'); return; }
        for (const channel of rows) {
            try { await api.channels.setEnabled(channel.id, enabled); } catch (e) { toast(e.message, 'error'); }
        }
        refresh();
    }

    async function deployTask() {
        const rows = effectiveChannels();
        if (!rows.length) { toast('Select a channel or group first', 'warn'); return; }
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
        router.navigate(`/messages/${channel.id}`);
    }

    /* Move channels between groups (used by the modal task and drag/drop).
       targetId DEFAULT_GROUP_ID means "remove from all groups". */
    async function moveChannelsToGroup(ids, targetId) {
        const updated = structuredClone(groupsRef.current);
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
             ...groupsRef.current.map(g => ({ value: g.id, label: g.name }))],
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
        const updated = structuredClone(groupsRef.current);
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
        const lastGroupId = lastGroupIdRef.current;
        if (!lastGroupId || lastGroupId === DEFAULT_GROUP_ID) {
            toast('Select a group row first', 'warn');
            return null;
        }
        const group = groupsRef.current.find(g => g.id === lastGroupId);
        if (!group) toast('Select a group row first', 'warn');
        return group || null;
    }

    async function deleteGroupTask() {
        const group = lastClickedGroup();
        if (!group) return;
        if (!await confirmDialog('Delete Group', `Delete group "${group.name}"? Its channels move to the Default Group.`, { danger: true, okLabel: 'Delete' })) return;
        const remaining = structuredClone(groupsRef.current.filter(g => g.id !== group.id));
        try {
            await api.channelGroups.bulkUpdate(remaining, [group.id]);
            toast(`Deleted group ${group.name}`);
            lastGroupIdRef.current = null;
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
                        const updated = structuredClone(groupsRef.current);
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
            // Swing promptObjectMigration("group"): block newer exports, confirm
            // conversion of older/unknown ones.
            const verdict = checkImportVersionFromDoc(
                new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml'), 'group');
            if (verdict.action === 'block') { await alertInformation(verdict.message); return; }
            if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return;
            const imported = parseGroupXml(file.content);
            const importedIds = new Set(imported.map(g => g.id));
            const importedChannelIds = new Set(imported.flatMap(g =>
                api.asList(g.channels, 'channel').map(ref => ref.id)));
            // Replace same-id groups and pull imported channels out of other
            // groups (a channel may only belong to one group).
            const updated = structuredClone(groupsRef.current.filter(g => !importedIds.has(g.id)));
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

    // Click on empty space (not a row) clears the selection, dismissing the
    // contextual task buttons. Wired to the grid wrapper so a click below the
    // (short) tree bubbles up here.
    function onEmptyClick(e) {
        if (e.target.closest('tr')) return;
        if (!selectedRef.current.size && !lastGroupIdRef.current) return;
        selectedRef.current = new Set();
        lastClickedRef.current = null;
        lastGroupIdRef.current = null;
        refreshTasks();
    }

    /* ---- mount: load ---- */

    useEffect(() => {
        refresh();
        // A plugin that mutates a channel out-of-band (e.g. history revert) emits
        // this so the list reflects the change immediately (Swing doRefreshChannels).
        const off = platform.events.on('channels:changed', () => refresh());
        return off;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ---- task panes (Swing parity, selection-gated) ----
       Channel Tasks: deployable = a channel selected OR a group row selected;
       Group Tasks: realGroup = a real (non-default) group row selected. */
    const eff = effectiveChannels();
    const channelSel = selectedRef.current.size > 0;
    const singleChannel = selectedRef.current.size === 1;
    const deployable = channelSel || !!lastGroupIdRef.current;
    const showDeploy = deployable;
    const showExport = channelSel;
    const showDelete = channelSel;
    const showClone = singleChannel;
    const showEdit = singleChannel;
    const showEnable = deployable && eff.some(c => !isEnabled(c));
    const showDisable = deployable && eff.some(c => isEnabled(c));
    const showMessages = singleChannel;

    const lastGroupId = lastGroupIdRef.current;
    const realGroup = !!lastGroupId && lastGroupId !== DEFAULT_GROUP_ID && groupsRef.current.some(g => g.id === lastGroupId);
    const showAssign = channelSel;
    const showGroupEdit = realGroup;
    const showGroupExport = realGroup;
    const showGroupDelete = realGroup;

    /* ---- tree data + filter + counts for the <TreeTable> ---- */
    const hasFilter = !!filterTextRef.current.trim();
    // Group nodes with their (name-sorted) channel children. When there are no
    // channels at all we pass [] so TreeTable shows its empty state (Swing parity:
    // the synthetic Default Group row is not drawn over an empty engine).
    const treeData = channelsRef.current.length
        ? groupedChannels().map((g) => ({
            kind: 'group', id: g.id, group: g,
            // Children are wrapped channel nodes (sorted by name) so getChildren()
            // hands TreeTable the same node shape rowKey/columns/onSelect expect.
            children: [...g.channels]
                .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
                .map((channel) => ({ kind: 'channel', channel }))
        }))
        : [];
    // Filter: groups don't self-match (legacy filters channels); a group is kept
    // by TreeTable when a descendant channel matches.
    const treeMatches = hasFilter
        ? (n) => (n.kind === 'group' ? false : matchesFilter(n.channel))
        : undefined;
    // Collapsed groups, keyed by the channel-tree rowKey ('grp:<id>').
    const collapsedKeys = new Set([...collapsedRef.current].map((id) => 'grp:' + id));

    // Counts bar: groups shown / channels shown / enabled (after the filter, and
    // dropping empty groups only while filtering — matching the legacy).
    const shownGroups = treeData
        .map((g) => ({ group: g.group, channels: g.group.channels.filter((c) => !hasFilter || matchesFilter(c)) }))
        .filter((g) => g.channels.length > 0 || !hasFilter);
    const shownChannels = shownGroups.flatMap((g) => g.channels);
    const enabledCount = shownChannels.filter(isEnabled).length;
    const countsText = `${shownGroups.length} Group${shownGroups.length === 1 ? '' : 's'}, `
        + `${shownChannels.length} Channel${shownChannels.length === 1 ? '' : 's'}, `
        + `${enabledCount} Enabled`;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Channel Tasks" paneKey="tasks:Channel Tasks" group="channel">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshChannels" onClick={() => refresh()} />
                        <TaskButton label="Redeploy All" icon="deploy" task="doRedeployAll" onClick={redeployAllTask} />
                        {showDeploy && <TaskButton label="Deploy Channel" icon="deploy" task="doDeployChannel" onClick={deployTask} />}
                        <TaskButton label="Edit Global Scripts" icon="scripts" task="doEditGlobalScripts" onClick={() => router.navigate('/global-scripts')} />
                        <TaskButton label="Edit Code Templates" icon="code" task="doEditCodeTemplates" onClick={() => router.navigate('/code-templates')} />
                        <TaskButton label="New Channel" icon="plus" primary task="doNewChannel" onClick={newTask} />
                        <TaskButton label="Import Channel" icon="import" task="doImportChannel" onClick={importTask} />
                        {showExport && <TaskButton label="Export Channel" icon="export" task="doExportChannel" onClick={exportTask} />}
                        {showDelete && <TaskButton label="Delete Channel" icon="trash" danger task="doDeleteChannel" onClick={deleteTask} />}
                        {showClone && <TaskButton label="Clone Channel" icon="copy" task="doCloneChannel" onClick={cloneTask} />}
                        {showEdit && <TaskButton label="Edit Channel" icon="edit" task="doEditChannel" onClick={() => { const c = single(); if (c) router.navigate(`/channels/${c.id}/edit`); }} />}
                        {showEnable && <TaskButton label="Enable Channel" icon="check" task="doEnableChannel" onClick={() => setEnabledTask(true)} />}
                        {showDisable && <TaskButton label="Disable Channel" icon="x" task="doDisableChannel" onClick={() => setEnabledTask(false)} />}
                        {showMessages && <TaskButton label="View Messages" icon="messages" task="doViewMessages" onClick={messagesTask} />}
                        {singleChannel && (() => {
                            // Get the selected channel WITHOUT single(), which toasts a
                            // warning on a non-single selection (it's meant for click handlers).
                            const c = selectedChannels()[0];
                            const ctx = { platform, channel: c, selectedIds: new Set(selectedRef.current) };
                            return platform.channelActions()
                                .filter((a) => (a.isEnabled ? a.isEnabled(ctx) : true))
                                .map((a) => <TaskButton key={a.id || a.label} label={a.label} icon={a.icon} task={a.task}
                                    onClick={() => a.onInvoke(c, ctx)} />);
                        })()}
                    </div>
                </RailPane>
                <RailPane title="Group Tasks" paneKey="tasks:Group Tasks" group="channelGroup">
                    <div className="taskbar" data-pane-title="Group Tasks">
                        {showAssign && <TaskButton label="Assign To Group" icon="folder" task="doAssignChannelToGroup" onClick={moveToGroupTask} />}
                        <TaskButton label="New Group" icon="plus" task="doNewGroup" onClick={newGroupTask} />
                        {showGroupEdit && <TaskButton label="Edit Group Details" icon="edit" task="doEditGroupDetails" onClick={editGroupTask} />}
                        <TaskButton label="Import Group" icon="import" task="doImportGroup" onClick={importGroupTask} />
                        <TaskButton label="Export All Groups" icon="export" task="doExportAllGroups" onClick={exportGroupsTask} />
                        {showGroupExport && <TaskButton label="Export Group" icon="export" task="doExportGroup" onClick={exportGroupTask} />}
                        {showGroupDelete && <TaskButton label="Delete Group" icon="trash" danger task="doDeleteGroup" onClick={deleteGroupTask} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col overflow-hidden">
                {/* Grid so the TreeTable's own .dt-wrap stretches to fill the
                    region (a flex child wouldn't grow on the main axis); this
                    leaves clickable empty space below a short tree for
                    click-to-clear, matching the legacy flex:1 grid host. */}
                <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)]" onClick={onEmptyClick}>
                    <TreeTable
                        data={treeData}
                        columns={treeColumns()}
                        getChildren={(n) => (n.kind === 'group' ? n.children : null)}
                        rowKey={(n) => (n.kind === 'group' ? 'grp:' + n.id : 'ch:' + n.channel.id)}
                        rowClassName={(n) => (n.kind === 'group' ? 'group-row' : '')}
                        selectedKeys={channelSel
                            ? new Set([...selectedRef.current].map((id) => 'ch:' + id))
                            : (lastGroupId ? new Set(['grp:' + lastGroupId]) : new Set())}
                        onSelect={onRowSelect}
                        onActivate={onRowActivate}
                        onRowContextMenu={onRowMenu}
                        onEmptyContextMenu={onEmptyMenu}
                        matches={treeMatches}
                        collapsedKeys={collapsedKeys}
                        onToggleCollapse={(key) => {
                            const id = key.replace(/^grp:/, '');
                            const s = collapsedRef.current;
                            s.has(id) ? s.delete(id) : s.add(id);
                            forceRender();
                        }}
                        rowDraggable={(n) => n.kind === 'channel'}
                        onRowDrop={onRowDrop}
                        columnsKey="channels"
                        columnWidths={CHANNEL_COL_WIDTHS}
                        pinnedKeys={['name']}
                        emptyText={(
                            <>
                                <div className="empty-icon"><Icon name="channels" size={30} /></div>
                                <div>No channels</div>
                                <div className="text-text-faint mt-[14px]">Create a channel with &quot;New Channel&quot; in the Channels Tasks pane.</div>
                            </>
                        )} />
                </div>
                <div className="filterbar">
                    <label>Filter:</label>
                    <input type="text" placeholder="Enter channel tag or name"
                        onInput={(e) => { filterTextRef.current = e.target.value; renderTable(); }} />
                    <span className="counts">{countsText}</span>
                </div>
            </div>
        </div>
    );
}
