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
 * <TaskButton>s gated on the selection state. Selection, collapse, filter and
 * the loaded data are all React state; menu/task actions take EXPLICIT
 * rows/groups computed where they are offered, so a context menu can never act
 * on a stale selection. New Channel seeds store.editingChannel and navigates to
 * the channel editor — a React view registered at /channels/:channelId/edit.
 *
 * The filter bar carries Swing's two display toggles, shared with the Dashboard
 * (views/channel-display.jsx): Group view / Channel view (a flat channel list —
 * no group rows, no Group Tasks pane, no drag-to-regroup) and Tags as
 * names / icons / off.
 */

import { useEffect, useRef, useState } from 'react';
import { h, icon, toast, confirmDialog, promptDialog, contextMenu, modal, errorModal, select, field, textInput, saveFile, pickFile, fmtDate } from '@oie/web-ui';
import api, { newChannel, uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { updateChannelWithConflict } from '../../core/channel-save.js';
import { confirmChannelOverwrite } from '../channel-persistence.js';
import * as router from '../../core/router.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { checkImportVersion, checkImportVersionFromDoc } from '../../core/import-guard.js';
import { createZip } from '../../core/zip.js';
import { mutateChannelGroups } from '../../core/channel-groups.js';
import { saveDependencyChanges } from '../../core/channel-dependencies.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton, SegPill } from '../ui.jsx';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { parseLibraryImport, prepareLibraryImport } from './code-template-import.js';
import { libraryImportCallbacks } from './code-template-import-dialogs.js';
import { applyGroupImports, bundledLibrarySaveError, consolidateBundledLibraries, resolveGroupImport } from './channel-import.js';
import { invalidate as invalidateCompletions } from '../../core/script-completions.js';
import { runLifecycle } from './channel-lifecycle.js';
import {
    loadViewMode, saveViewMode, loadTagMode, saveTagMode,
    VIEW_MODE_OPTIONS, TAG_MODE_OPTIONS, tagRgb, tagIcon
} from './channel-display.jsx';
import type { ViewMode, TagMode } from './channel-display.jsx';


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
const ENGINE_DEFAULT_GROUP_ID = 'Default Group';
const ENGINE_DEFAULT_GROUP_NAME = '[Default Group]';

/* ---- code template library bundling (Swing "import/export libraries with channels") ----
   Export uses the engine (includeCodeTemplateLibraries) to bundle libraries into the
   channel XML. Import must merge those libraries itself — the engine doesn't auto-import
   exportData.codeTemplateLibraries on channel create (ChannelPanel does it client-side). */

// OK-only warning (Swing alertWarning).
function alertWarning(message: any) {
    return new Promise(resolve => modal({
        title: 'Warning', body: h('div', String(message)), onClose: resolve as any,
        buttons: [{ label: 'OK', primary: true, onClick: resolve as any }]
    }));
}

// OK-only info (Swing alertInformation, title "Information"). pre-line renders the
// message's \n line breaks the way JOptionPane does.
function alertInformation(message: any) {
    return new Promise(resolve => modal({
        title: 'Information',
        body: h('div', { style: 'white-space: pre-line' }, String(message)),
        onClose: resolve as any,
        buttons: [{ label: 'OK', primary: true, onClick: resolve as any }]
    }));
}

// Yes / No option (Swing alertOption): resolves true on Yes, false on No/closed.
function optionYesNo(title: any, message: any) {
    return new Promise(resolve => modal({
        title, body: h('div', { style: 'white-space: pre-line' }, String(message)), onClose: () => resolve(false),
        buttons: [
            { label: 'No', onClick: () => resolve(false) },
            { label: 'Yes', primary: true, onClick: () => resolve(true) }
        ]
    }));
}

// "Channel/Group X has code template libraries included — import them?" — Yes/No/Cancel
// with an "always" checkbox that persists the importLibrariesWithChannels pref.
// Returns 'yes' | 'no' | 'cancel'.
function promptImportLibraries(objectName: any, count: any, objectType = 'Channel') {
    const pref = getPref('importLibrariesWithChannels');
    if (pref === 'yes') return Promise.resolve('yes');
    if (pref === 'no') return Promise.resolve('no');
    const plural = count === 1 ? 'y' : 'ies';
    const them = count === 1 ? 'it' : 'them';
    return new Promise(resolve => {
        const always = h('input', { type: 'checkbox' });
        const remember = (choice: any) => { if ((always as any).checked) setPrefs({ importLibrariesWithChannels: choice }); return choice; };
        modal({
            title: `Import ${objectType}`,
            body: h('div',
                h('div', { class: 'mb-2.5' },
                    `${objectType} "${objectName}" has code template librar${plural} included with it. Would you like to import ${them}?`),
                h('label', { class: 'flex items-center gap-1.5 text-[11px]' },
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
async function linkedLibraryNames(channelIds: any[]) {
    const libs = await api.codeTemplates.libraries(false);
    const idSet = (v: any) => api.asList(v, 'string').map(String);
    const ids = channelIds.map(String);
    return libs.filter(lib => {
        const enabled = new Set(idSet(lib.enabledChannelIds));
        const disabled = new Set(idSet(lib.disabledChannelIds));
        return ids.some(id => enabled.has(id) || (lib.includeNewChannels === true && !disabled.has(id)));
    })
        .map(lib => lib.name || '(unnamed library)');
}

// Swing channel-export dialog: lists the linked libraries and asks whether to
// bundle them, Yes/No/Cancel, with an "always" checkbox persisting the
// exportLibrariesWithChannels pref. Returns 'yes' | 'no' | 'cancel'.
function promptExportLibraries(names: any) {
    return new Promise(resolve => {
        const always = h('input', { type: 'checkbox' });
        const remember = (choice: any) => { if ((always as any).checked) setPrefs({ exportLibrariesWithChannels: choice }); return choice; };
        modal({
            title: 'Export Channel',
            body: h('div',
                h('div', { class: 'mb-1.5' }, 'The following code template libraries are linked to this channel:'),
                h('div', { class: 'border border-line rounded-[4px] bg-bg1 py-1.5 px-2.5 max-h-[126px] overflow-auto' },
                    h('ul', { class: 'm-0 pl-[16px]' }, names.map((n: any) => h('li', n)))),
                h('div', { class: 'mt-2.5 mx-0 mb-2' }, 'Do you wish to include these libraries in the channel export?'),
                h('label', { class: 'flex items-center gap-1.5 text-[11px]' },
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

async function chooseExportLibraries(channelIds: any[], assertSession: () => void) {
    assertSession();
    const pref = getPref('exportLibrariesWithChannels');
    if (pref === 'yes' || pref === 'no') return pref === 'yes';
    let names: any[];
    try {
        names = [...new Set(await linkedLibraryNames(channelIds))];
        assertSession();
    } catch (e: any) {
        assertSession();
        // Code-template viewing is independently authorized. Swing consults its
        // cache and still exports the channel when that data is unavailable; keep
        // the backup usable while making the omitted libraries explicit.
        toast(`Could not check linked code template libraries: ${e.message || e}. Exporting without them.`, 'warn');
        return false;
    }
    if (!names.length) return false;
    const choice = await promptExportLibraries(names);
    assertSession();
    return choice === 'cancel' ? null : choice === 'yes';
}

function exportFileName(name: any, fallback: string, used: Set<string>) {
    const base = String(name || fallback).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || fallback;
    let candidate = `${base}.xml`;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++) candidate = `${base} (${suffix}).xml`;
    used.add(candidate.toLowerCase());
    return candidate;
}

const CHANNEL_NAME_RE = /^[a-zA-Z_0-9\-\s]*$/;

/* Resolve a name/id collision on channel import, mirroring Swing's
   ChannelPanel.importChannel + Frame.checkChannelName: warn that the channel
   exists, then offer overwrite (reuse the existing id + revision) or create-new
   (prompt for a free name, fresh id). Returns { id, name, revision, overwrite }
   to apply to the imported channel, or null to abort. `existing` is the current
   channel list (for collision). */
async function resolveImportName(name: any, id: any, existing: any, assertSession: () => void, importIds?: Map<string, string>) {
    assertSession();
    let tempId = uuid();
    if (importIds) {
        let suffix = 0;
        let key = `channel:${id}:${suffix}`;
        while (importIds.has(key) && existing.some((channel: any) => channel.id === importIds.get(key))) key = `channel:${id}:${++suffix}`;
        if (!importIds.has(key)) importIds.set(key, tempId);
        tempId = importIds.get(key)!;
    }
    const nameClash = (n: any, candidateId: any) => existing.some((c: any) =>
        String(c.name || '').toLowerCase() === String(n).toLowerCase() && c.id !== candidateId);

    async function checkName(n: any, candidateId: any) {
        if (!n) { await alertWarning('Channel name cannot be empty.'); assertSession(); return false; }
        if (n.length > 40) { await alertWarning('Channel name cannot be longer than 40 characters.'); assertSession(); return false; }
        if (!CHANNEL_NAME_RE.test(n)) { await alertWarning('Channel name cannot have special characters besides hyphen, underscore, and space.'); assertSession(); return false; }
        if (nameClash(n, candidateId)) { await alertWarning(`Channel "${n}" already exists.`); assertSession(); return false; }
        return true;
    }

    const validName = await checkName(name, tempId);
    assertSession();
    if (!validName) {
        const overwrite = await optionYesNo('Import Channel', "Would you like to overwrite the existing channel?  Choose 'No' to create a new channel.");
        assertSession();
        if (!overwrite) {
            let newName = name;
            do {
                newName = await promptDialog('Import Channel', 'Please enter a new name for the channel.', newName);
                assertSession();
                if (newName == null) return null;             // Cancel → abort
            } while (!(await checkName(newName, tempId)));
            return { id: tempId, name: newName, revision: 0, overwrite: false };
        }
        const match = existing.find((c: any) => String(c.name || '').toLowerCase() === String(name).toLowerCase());
        return { id: match ? match.id : id, name, revision: match ? (Number(match.revision) || 0) : 0, overwrite: true };
    }
    // No name collision — make sure the id is free too.
    const idClash = existing.some((c: any) => c.id === id);
    return { id: idClash ? tempId : id, name, revision: 0, overwrite: false };
}

function bundledLibrariesFromXml(elements: Element[]) {
    const version = store.getState('serverVersion') || '4.5.2';
    return elements.flatMap(element => parseLibraryImport(new XMLSerializer().serializeToString(element), version));
}

// Bundled exports use the same conflict choices and merge rules as Import Libraries.
async function importLibraryElementsXml(bundledEls: Element[], channelId: string, assertSession: () => void, ids: Map<string, string>) {
    const imported = bundledLibrariesFromXml(bundledEls);
    return importLibraryObjectsJson(consolidateBundledLibraries([{ libraries: imported, channelId }]), assertSession, ids);
}

function resourceList(resourcesRaw: any) {
    const resources: any[] = [];
    const seen = new Set<string>();
    const list = resourcesRaw && typeof resourcesRaw === 'object'
        ? (typeof resourcesRaw.list === 'object' ? resourcesRaw.list : resourcesRaw) : null;
    if (!list) return resources;
    for (const [key, value] of Object.entries(list)) {
        if (key.startsWith('@')) continue;
        for (const item of api.asList(value)) {
            if (item && typeof item === 'object' && item.id && item.name && !seen.has(String(item.id))) {
                seen.add(String(item.id));
                resources.push({ id: String(item.id), name: String(item.name) });
            }
        }
    }
    return resources;
}

function remapResourceIds(channelEl: Element, resourcesRaw: any) {
    const resources = resourceList(resourcesRaw);
    const byId = new Map(resources.map(resource => [resource.id, resource]));
    for (const mapEl of [...channelEl.querySelectorAll('resourceIds')]
        .filter(el => !el.closest('exportData'))) {
        const entries = [...mapEl.children].filter(el => el.tagName === 'entry');
        const currentIds = new Set(entries.map(entry =>
            [...entry.children].find(el => el.tagName === 'string')?.textContent || ''));
        for (const entry of entries) {
            const strings = [...entry.children].filter(el => el.tagName === 'string');
            if (strings.length < 2) continue;
            const oldId = strings[0].textContent || '';
            const oldName = strings[1].textContent || '';
            const exact = byId.get(oldId);
            if (exact) {
                strings[1].textContent = exact.name;
                continue;
            }
            const nameMatch = resources.find(resource => resource.name === oldName && !currentIds.has(resource.id));
            if (nameMatch) {
                currentIds.delete(oldId);
                currentIds.add(nameMatch.id);
                strings[0].textContent = nameMatch.id;
                strings[1].textContent = nameMatch.name;
            }
        }
    }
}

// Import a channel XML export: resolve a name/id collision (warn + overwrite or
// rename), handle bundled libraries, then create or overwrite. Returns the final
// channel identity (which may change during collision resolution), or false if the
// user cancelled. `existing` is the current channel list (for collision). Group
// imports already perform migration confirmation for the enclosing document, so
// they can disable the otherwise-standard per-channel version check.
async function importChannelXml(xml: any, existing: any, { checkVersion = true, importLibraries = true, assertSession = captureEngineSession(), importIds = new Map<string, string>(), resolvedIdentity }: any = {}) {
    assertSession();
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'channel') {
        throw new Error('Not a valid channel XML file');
    }
    const channelEl = doc.documentElement;
    // Swing promptObjectMigration: block newer-than-server exports (alertInformation),
    // confirm the automatic conversion for older/unknown ones (Yes/No "Select an
    // Option"), import same-version silently.
    if (checkVersion) {
        const verdict = checkImportVersion(channelEl.getAttribute('version'), 'channel');
        if (verdict.action === 'block') {
            await alertInformation(verdict.message);
            return false;
        }
        if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) {
            return false;
        }
    }
    assertSession();
    const directChild = (tag: any) => [...channelEl.children].find(c => c.tagName === tag);
    const setChild = (tag: any, value: any) => {
        let el = directChild(tag);
        if (!el) { el = doc.createElement(tag); channelEl.appendChild(el!); }
        el!.textContent = value;
    };

    const name = directChild('name')?.textContent || '';
    const id = directChild('id')?.textContent || '';

    const resolved = resolvedIdentity || await resolveImportName(name, id, existing, assertSession, importIds);
    assertSession();
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
    if (bundled.length && importLibraries) {
        const choice = await promptImportLibraries(resolved.name, bundled.length);
        assertSession();
        if (choice === 'cancel') return false;
        if (choice === 'yes') await importLibraryElementsXml(bundled, resolved.id, assertSession, importIds);
        assertSession();
    }
    // The engine ignores bundled libraries on create; strip them from the channel.
    if (libsContainer && libsContainer.parentNode) libsContainer.parentNode.removeChild(libsContainer);

    const exportData = directChild('exportData');
    const dependentIdsEl = exportData && [...exportData.children].find(c => c.tagName === 'dependentIds');
    const dependencyIdsEl = exportData && [...exportData.children].find(c => c.tagName === 'dependencyIds');
    const strings = (el: any) => el ? [...el.children]
        .filter(c => c.tagName === 'string')
        .map(c => String(c.textContent || '').trim())
        .filter(Boolean) : [];
    const dependentIds = strings(dependentIdsEl);
    const dependencyIds = strings(dependencyIdsEl);
    if (dependentIds.length || dependencyIds.length) {
        const dependencies = new Map<string, any>();
        const add = (dependentId: any, dependencyId: any) => {
            dependentId = String(dependentId || '').trim();
            dependencyId = String(dependencyId || '').trim();
            if (!dependentId || !dependencyId || dependentId === dependencyId) return;
            dependencies.set(`${dependentId}>${dependencyId}`, { dependentId, dependencyId });
        };
        for (const dependentId of dependentIds) add(dependentId, resolved.id);
        for (const dependencyId of dependencyIds) add(resolved.id, dependencyId);
        try {
            // Merge imported edges into a fresh graph using Swing's core setter.
            assertSession();
            await saveDependencyChanges([...dependencies.values()], []);
            assertSession();
        } catch (e: any) {
            assertSession();
            // Swing reports this failure but still allows the channel import to
            // continue, so retain that partial-completion behavior explicitly.
            toast(`Unable to save channel dependencies: ${e.message || e}`, 'error');
        }
    }
    dependentIdsEl?.remove();
    dependencyIdsEl?.remove();

    // Resource IDs are server-specific. Swing first refreshes names for IDs that
    // still exist, then falls back to a same-name resource when an ID is stale.
    // Do not make an unrelated resource API failure block channels that have no
    // resource assignments to remap.
    const hasResourceAssignments = [...channelEl.querySelectorAll('resourceIds')]
        .some(element => !element.closest('exportData') && element.children.length > 0);
    if (hasResourceAssignments) {
        const resources = await api.server.resources();
        assertSession();
        remapResourceIds(channelEl, resources);
    }
    assertSession();

    const body = new XMLSerializer().serializeToString(doc);
    // Omit startEdit so the engine supplies its own clock. PUT also accepts
    // new IDs; a reported conflict follows the editor's Swing-style choices.
    const saved = await updateChannelWithConflict(resolved.id,
        override => api.putXml(`/channels/${encodeURIComponent(resolved.id)}`, body, { override }),
        { userId: store.getState('user')?.id, confirmConflict: confirmChannelOverwrite, assertSession });
    return saved ? resolved : false;
}

async function importLibraryObjectsJson(imported: any[], assertSession: () => void, ids: Map<string, string>) {
    if (!imported.length) return;
    assertSession();
    const existing = await api.codeTemplates.libraries(true);
    assertSession();
    const version = store.getState('serverVersion') || '4.5.2';
    const payload = await prepareLibraryImport(existing, imported, version, libraryImportCallbacks(assertSession, ids));
    assertSession();
    // Closing the template-selection dialog in Swing leaves the channel import
    // available; the outer Yes/No/Cancel prompt is what cancels the whole import.
    if (!payload) return;
    let couldHaveSaved = true;
    try {
        const result = await api.codeTemplates.bulkUpdate(payload.libraries, payload.templates, [], [], false);
        assertSession();
        couldHaveSaved = String(result?.overrideNeeded) !== 'true';
        const error = bundledLibrarySaveError(result);
        if (error) throw new Error(error);
    } catch (error: any) {
        assertSession();
        if (!couldHaveSaved) throw error;
        // The library set may have committed before an individual template
        // failed. Reconcile the cache and retain generated IDs for a safe retry.
        invalidateCompletions();
        try { await api.codeTemplates.libraries(true); } catch { /* Preserve the original save failure. */ }
        assertSession();
        throw new Error(`${error.message || error}. Code template libraries may have been partly saved; review them before retrying.`);
    }
    invalidateCompletions();
}

/* Enabled flag lives at channel.exportData.metadata.enabled (ChannelMetadata,
   defaults true). Be defensive: InvalidChannel instances may lack exportData. */
function isEnabled(channel: any) {
    return channel?.exportData?.metadata?.enabled !== false;
}

function isInvalid(channel: any) {
    return String(channel?.['@class'] || '').includes('InvalidChannel');
}

function isChannelXmlElement(element: Element) {
    return element.tagName === 'channel' || element.tagName.endsWith('.InvalidChannel');
}

// Depending on the engine serializer path, an InvalidChannel inside a list may
// retain its concrete class name instead of the normal "channel" alias. Treat it
// as a channel and normalize the standalone export root so the backup remains
// directly importable if the missing extension is later restored.
function channelXmlElements(root: Element) {
    const elements = isChannelXmlElement(root)
        ? [root]
        : [...root.children].filter(isChannelXmlElement);
    return elements.map(element => {
        if (element.tagName === 'channel') return element;
        const channel = element.ownerDocument!.createElement('channel');
        for (const attribute of [...element.attributes]) channel.setAttribute(attribute.name, attribute.value);
        for (const child of [...element.childNodes]) channel.appendChild(child.cloneNode(true));
        return channel;
    });
}

function firstLine(text: any) {
    return String(text || '').split('\n')[0].trim();
}

export function ChannelsView() {
    /* Server data + UI state — React state driving the declarative <TreeTable>,
       the task panes, and the filter bar. Loaded by refresh() (an explicit
       command: mount, manual Refresh, post-action, and the channels:changed
       plugin event — this view does not poll, so it is not a query hook).
       Menu/task actions take EXPLICIT rows/ids computed where they are offered,
       so a context menu can never act on a stale selection. */
    const [channels, setChannels] = useState([] as any[]);
    const importBusyRef = useRef(false);
    const pendingImportRef = useRef<{ content: string; ids: Map<string, string> } | null>(null);
    function importIdsFor(content: string) {
        if (pendingImportRef.current?.content !== content) pendingImportRef.current = { content, ids: new Map() };
        return pendingImportRef.current.ids;
    }
    const [tags, setTags] = useState([] as any[]);
    const [groups, setGroups] = useState([] as any[]);
    const [statusById, setStatusById] = useState({} as any);        // channelId -> dashboardStatus
    const [loadError, setLoadError] = useState<string | null>(null);
    const refreshGenRef = useRef(0);
    const [selected, setSelected] = useState(() => new Set());   // channel ids
    const lastClickedRef = useRef<any>(null);                     // shift-range anchor (interaction-only)
    const [lastGroupId, setLastGroupId] = useState<any>(null);    // last-clicked group row (for Delete Group)
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());   // group ids (default expanded)
    const [filterText, setFilterText] = useState('');
    // Groups/Channels arrangement + tag display: Swing's filter-bar toggles,
    // one preference shared with the Dashboard.
    const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);
    const [tagMode, setTagModeState] = useState<TagMode>(loadTagMode);
    const groupView = viewMode === 'group';

    function setViewMode(mode: ViewMode) {
        setViewModeState(mode);
        saveViewMode(mode);
        // Channel view has no group rows, so a group selection cannot survive it.
        if (mode === 'channel') setLastGroupId(null);
    }

    function setTagMode(mode: TagMode) {
        setTagModeState(mode);
        saveTagMode(mode);
    }

    /* ---- grouping --------------------------------------------------------- */

    /* Returns [{ id, name, description, group?, channels: [...] }] — every
       real group plus the synthetic default group for unreferenced channels. */
    function groupedChannels() {
        const byId = new Map(channels.map(c => [c.id, c]));
        const claimed = new Set();
        const rows: any[] = [];
        for (const group of groups) {
            const members: any[] = [];
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

    function channelTags(channel: any) {
        return tags.filter(t => api.asList(t.channelIds, 'string').includes(channel.id));
    }

    function matchesFilter(channel: any) {
        const needle = filterText.trim().toLowerCase();
        if (!needle) return true;
        if (String(channel.name || '').toLowerCase().includes(needle)) return true;
        return channelTags(channel).some(t => String(t.name || '').toLowerCase().includes(needle));
    }

    /* ---- table (Swing channel group tree-table, the declarative <TreeTable>) -- */

    function descriptionCell(text: any) {
        return (
            <span className="inline-block max-w-[288px] truncate align-bottom">
                {firstLine(text)}
            </span>
        );
    }

    function statusCell(channel: any) {
        if (isInvalid(channel)) return <span className="status-cell"><span className="pip err" />Invalid</span>;
        return isEnabled(channel)
            ? <span className="status-cell"><span className="pip ok" />Enabled</span>
            : <span className="status-cell"><span className="pip" /><span className="text-text-dim">Disabled</span></span>;
    }

    // Channel name + tag chips (names, icons, or none per the Tags toggle). The
    // depth indent + twisty are supplied by the TreeTable tree column, so (unlike
    // the legacy) no manual paddingLeft here.
    function nameCell(channel: any) {
        const chips = tagMode === 'off' ? [] : channelTags(channel);
        // Single line, never wrapping: the name always shows in full; extra tags
        // run out to the edge of the (fixed-layout) Name column and clip there via
        // the cell's own overflow:hidden — no premature inner width cap.
        return (
            <span className="inline-flex items-center gap-1.5 flex-nowrap align-middle">
                <span className="shrink-0">{channel.name || ''}</span>
                {chips.length
                    ? <span className="inline-flex gap-1.5 flex-nowrap">
                        {chips.map((tag: any) => {
                            if (tagMode === 'icons') return tagIcon(tag, tag.name);
                            const color = tagRgb(tag, 0.26);
                            return <span key={tag.name} className="tag shrink-0" style={color ? { background: color } : {}}>{tag.name}</span>;
                        })}
                    </span>
                    : null}
            </span>
        );
    }

    // The revision-delta cell: a flagged badge when out of sync, '--' when there
    // is no status, '0' otherwise (Swing parity).
    function revDeltaCell(channel: any) {
        const status = statusById[channel.id];
        const delta = status ? Number(status.deployedRevisionDelta) || 0 : null;
        // A channel is out of sync (needs redeploy) when its saved revision is
        // ahead of the deployed one OR its code templates changed since deploy —
        // so the delta can read 0 yet still be flagged (matches the engine).
        const ctChanged = !!status && (status.codeTemplatesChanged === true || status.codeTemplatesChanged === 'true');
        const outOfSync = delta! > 0 || ctChanged;
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
        return CHANNEL_COLUMNS.map((c: any) => ({
            key: c.key, label: c.label, align: c.key === 'revDelta' ? 'right' : undefined,
            mono: c.key === 'id', tree: c.key === 'status',
            // Raw comparable per column (mirrors render's displayed value). Group rows
            // return null for columns they leave blank/'--' so those sort last.
            sortValue: (n: any) => {
                const isGroup = n.kind === 'group';
                switch (c.key) {
                    case 'status': {
                        if (isGroup) return null;
                        const ch = n.channel;
                        return isInvalid(ch) ? 'invalid' : (isEnabled(ch) ? 'enabled' : 'disabled');
                    }
                    case 'dataType': return isGroup ? null
                        : String(n.channel.sourceConnector?.transformer?.inboundDataType || '').toLowerCase();
                    case 'name': return isGroup
                        ? String(n.group.name || '').toLowerCase()
                        : String(n.channel.name || '').toLowerCase();
                    case 'id': return isGroup
                        ? String(n.group.id === DEFAULT_GROUP_ID ? 'Default Group' : (n.group.id || '')).toLowerCase()
                        : String(n.channel.id || '').toLowerCase();
                    case 'description': return isGroup
                        ? String(firstLine(n.group.description) || '').toLowerCase()
                        : String(firstLine(n.channel.description) || '').toLowerCase();
                    case 'revDelta': {
                        if (isGroup) return null;
                        const status = statusById[n.channel.id];
                        return status ? Number(status.deployedRevisionDelta) || 0 : null;
                    }
                    case 'lastDeployed': {
                        if (isGroup) return null;
                        const status = statusById[n.channel.id];
                        return status ? (status.deployedDate?.time ?? 0) : null;
                    }
                    case 'lastModified': return isGroup ? null
                        : (n.channel.exportData?.metadata?.lastModified?.time ?? 0);
                    default: return null;
                }
            },
            render: (n: any) => {
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
                        : (statusById[n.channel.id] ? fmtDate(statusById[n.channel.id].deployedDate) : '--');
                    case 'lastModified': return isGroup ? '--' : fmtDate(n.channel.exportData?.metadata?.lastModified);
                    default: return '';
                }
            }
        }));
    }

    // A click on a group row selects the group (mutually exclusive with channel
    // selection), matching the legacy selectGroup().
    function selectGroup(group: any) {
        setLastGroupId(group.id);
        setSelected(new Set());
        lastClickedRef.current = null;
    }

    // A click on a channel row: ctrl/meta toggles, shift extends the range over
    // the visible (expanded, filtered, sorted) channels, plain selects one — and
    // clears any group selection (mutually exclusive). Mirrors the legacy click.
    function selectChannel(channel: any, e: any) {
        let next: any;
        if (e.metaKey || e.ctrlKey) {
            next = new Set(selected);
            next.has(channel.id) ? next.delete(channel.id) : next.add(channel.id);
        } else if (e.shiftKey && lastClickedRef.current) {
            const visible = visibleChannelIds();
            const a = visible.indexOf(lastClickedRef.current), b = visible.indexOf(channel.id);
            next = (a !== -1 && b !== -1)
                ? new Set(visible.slice(Math.min(a, b), Math.max(a, b) + 1))
                : new Set([channel.id]);
        } else {
            next = new Set([channel.id]);
        }
        lastClickedRef.current = channel.id;
        setSelected(next);
        setLastGroupId(null);
    }

    function onRowSelect(node: any, e: any) {
        if (node.kind === 'group') selectGroup(node.group);
        else selectChannel(node.channel, e);
    }

    function toggleGroupCollapse(groupId: any) {
        setCollapsedGroups(prev => {
            const next = new Set(prev);
            next.has(groupId) ? next.delete(groupId) : next.add(groupId);
            return next;
        });
    }

    function onRowActivate(node: any) {
        // Double-click: a group toggles its collapse; a channel opens the editor.
        if (node.kind === 'group') toggleGroupCollapse(node.group.id);
        else router.navigate(`/channels/${node.channel.id}/edit`);
    }

    // Right-click on blank space (empty list, or below the rows): clear any
    // selection and offer the channel-panel background actions — the Swing
    // MirthTree background popup, so New Channel is reachable when the list is empty.
    function onEmptyMenu(e: any) {
        e.preventDefault();
        if (selected.size || lastGroupId) {
            setSelected(new Set());
            lastClickedRef.current = null;
            setLastGroupId(null);
        }
        // Group tasks exist only in Group view (Swing drops the Group Tasks pane
        // in channel mode).
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
            '-',
            { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() },
            { label: 'Import Channel', icon: 'import', task: 'doImportChannel', group: 'channel', onClick: () => importTask() },
            { label: 'Export All Channels', icon: 'export', task: 'doExportAllChannels', group: 'channel', onClick: () => exportAllTask() },
            ...(groupView ? [
                '-' as const,
                { label: 'New Group', icon: 'plus', task: 'doNewGroup', group: 'channelGroup', onClick: () => newGroupTask() },
                { label: 'Import Group', icon: 'import', task: 'doImportGroup', group: 'channelGroup', onClick: () => importGroupTask() },
                { label: 'Export All Groups', icon: 'export', task: 'doExportAllGroups', group: 'channelGroup', onClick: () => exportGroupsTask() }
            ] : [])
        ]);
    }

    function onRowMenu(node: any, e: any) {
        e.preventDefault();
        if (node.kind === 'group') {
            selectGroup(node.group);
            const isRealGroup = node.group.id !== DEFAULT_GROUP_ID;
            const group = node.group.group || node.group;   // the raw engine group object
            contextMenu(e.clientX, e.clientY, [
                { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
                '-',
                { label: 'New Group', icon: 'plus', task: 'doNewGroup', group: 'channelGroup', onClick: () => newGroupTask() },
                { label: 'Edit Group Details', icon: 'edit', task: 'doEditGroupDetails', group: 'channelGroup', hidden: !isRealGroup, onClick: () => editGroupTask(group) },
                { label: 'Delete Group', icon: 'trash', danger: true, task: 'doDeleteGroup', group: 'channelGroup', hidden: !isRealGroup, onClick: () => deleteGroupTask(group) },
                '-',
                { label: 'Import Group', icon: 'import', task: 'doImportGroup', group: 'channelGroup', onClick: () => importGroupTask() },
                { label: 'Export Group', icon: 'export', task: 'doExportGroup', group: 'channelGroup', onClick: () => exportGroupTask(group) },
                { label: 'Export All Groups', icon: 'export', task: 'doExportAllGroups', group: 'channelGroup', onClick: () => exportGroupsTask() },
                '-',
                { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() }
            ]);
            return;
        }
        const channel = node.channel;
        // The menu acts on the selection that includes this row, else on just this
        // row (which also becomes the selection) — computed HERE so the menu items
        // can never read a stale selection after the setState.
        const rows = selected.has(channel.id)
            ? channels.filter(c => selected.has(c.id))
            : [channel];
        if (!selected.has(channel.id)) {
            lastClickedRef.current = channel.id;
            setSelected(new Set([channel.id]));
            setLastGroupId(null);
        }
        // Plugin-contributed per-channel actions (platform.registerChannelAction),
        // e.g. "View History". Shown for a single-channel selection unless the
        // action supplies its own isEnabled. Mirrors Swing's ChannelPanelPlugin tasks.
        const actionCtx = { platform, channel, selectedIds: new Set(rows.map(c => c.id)) };
        const singleSel = rows.length === 1;
        const pluginItems = platform.channelActions()
            .filter((a: any) => (a.isEnabled ? a.isEnabled(actionCtx) : singleSel))
            .map((a: any): any => ({
                label: a.label, icon: a.icon, task: a.task, group: a.group || 'channel',
                onClick: () => a.onInvoke(channel, actionCtx)
            }));
        // Full Swing channelPopupMenu (ChannelPanel) — the whole Channel Tasks
        // list, with Swing's visibility rules: Deploy needs at least one enabled
        // channel in the selection (disabled channels are never deployed), Enable
        // needs a disabled one, Disable an enabled one, and Move to Group exists
        // only in Group view.
        const anyEnabled = rows.some(isEnabled);
        const anyDisabled = rows.some((c: any) => !isEnabled(c));
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
            { label: 'Redeploy All', icon: 'deploy', task: 'doRedeployAll', group: 'channel', onClick: () => redeployAllTask() },
            '-',
            { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() },
            { label: 'Import Channel', icon: 'import', task: 'doImportChannel', group: 'channel', onClick: () => importTask() },
            { label: 'Export All Channels', icon: 'export', task: 'doExportAllChannels', group: 'channel', onClick: () => exportAllTask() },
            '-',
            { label: 'Edit Channel', icon: 'edit', task: 'doEditChannel', group: 'channel', onClick: () => router.navigate(`/channels/${channel.id}/edit`) },
            { label: 'View Messages', icon: 'messages', task: 'doViewMessages', group: 'channel', onClick: () => messagesTask(rows) },
            '-',
            { label: 'Deploy Channel', icon: 'deploy', task: 'doDeployChannel', group: 'channel', hidden: !anyEnabled, onClick: () => deployTask(rows) },
            { label: 'Enable Channel', icon: 'check', task: 'doEnableChannel', group: 'channel', hidden: !anyDisabled, onClick: () => setEnabledTask(true, rows) },
            { label: 'Disable Channel', icon: 'x', task: 'doDisableChannel', group: 'channel', hidden: !anyEnabled, onClick: () => setEnabledTask(false, rows) },
            '-',
            { label: 'Clone Channel', icon: 'copy', task: 'doCloneChannel', group: 'channel', onClick: () => cloneTask(rows) },
            { label: 'Export Channel', icon: 'export', task: 'doExportChannel', group: 'channel', onClick: () => exportTask(rows) },
            { label: 'Move to Group…', icon: 'folder', task: 'doAssignChannelToGroup', group: 'channelGroup', hidden: !groupView, onClick: () => moveToGroupTask(rows) },
            ...(pluginItems.length ? ['-', ...pluginItems] : []),
            '-',
            { label: 'Delete Channel', icon: 'trash', danger: true, task: 'doDeleteChannel', group: 'channel', onClick: () => deleteTask(rows) }
        ]);
    }

    // Drop a dragged channel onto a group row to re-group it. The whole current
    // channel selection moves when the dragged channel is part of it (legacy
    // dragstart behavior); otherwise just the dragged channel.
    async function onRowDrop(fromKey: any, toNode: any) {
        if (toNode.kind !== 'group') return;
        const id = String(fromKey || '').replace(/^ch:/, '');
        if (!id) return;
        const ids = selected.has(id) ? new Set(selected) : new Set([id]);
        const names = channels.filter(c => ids.has(c.id)).map(c => c.name).join(', ');
        if (await confirmDialog('Move to Group',
            `Move ${ids.size === 1 ? `"${names}"` : ids.size + ' channels'} to [${toNode.group.name}]?`,
            { okLabel: 'Move' })) {
            await moveChannelsToGroup(ids, toNode.group.id);
        }
    }

    const byName = (a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''));

    function visibleChannelIds() {
        if (!groupView) return [...channels].filter(matchesFilter).sort(byName).map(c => c.id);
        return groupedChannels()
            .filter(g => !collapsedGroups.has(g.id))
            .flatMap(g => [...g.channels].filter(matchesFilter).sort(byName).map(c => c.id));
    }

    /* ---- data --------------------------------------------------------------- */

    /* Reads nothing (only fetches + functional setState), so the mount-captured
       channels:changed listener can safely call the first render's closure. */
    async function refresh() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const gen = ++refreshGenRef.current;
        const results: any[] = await Promise.allSettled([
            api.channels.list(),
            api.channelGroups.list(),
            api.server.channelTags(),
            api.status.list()
        ]);
        try { assertSession(); } catch { return; }
        if (gen !== refreshGenRef.current) return;
        const [channelResult, groupResult, tagResult, statusResult] = results;
        const failures = [
            ['channels', channelResult],
            ['groups', groupResult],
            ['tags', tagResult],
            ['statuses', statusResult]
        ].filter(([, result]: any) => result.status === 'rejected')
            .map(([label, result]: any) => `${label}: ${result.reason?.message || result.reason}`);

        if (channelResult.status === 'fulfilled') {
            const channelList = channelResult.value;
            const nextChannels = channelList.filter((c: any) => c && c.id);
            setChannels(nextChannels);
            // Prune only when the authoritative channel request succeeded.
            const ids = new Set(nextChannels.map((c: any) => c.id));
            setSelected(prev => {
                const next = new Set([...prev].filter((id: any) => ids.has(id)));
                return next.size === prev.size ? prev : next;
            });
        }
        if (groupResult.status === 'fulfilled') {
            const nextGroups = groupResult.value.filter((g: any) => g && g.id);
            setGroups(nextGroups);
            setLastGroupId((prev: any) => (prev && prev !== DEFAULT_GROUP_ID && !nextGroups.some((g: any) => g.id === prev) ? null : prev));
        }
        if (tagResult.status === 'fulfilled') setTags(tagResult.value);
        if (statusResult.status === 'fulfilled') {
            const byId: any = {};
            for (const st of statusResult.value) {
                if (st && st.channelId) byId[st.channelId] = st;
            }
            setStatusById(byId);
        }

        if (failures.length) {
            const message = failures.join('; ');
            setLoadError(message);
            toast(`Failed to load ${message}`, 'error');
        } else {
            setLoadError(null);
        }
    }

    /* ---- selection helpers ---------------------------------------------------- */

    function selectedChannels() {
        return channels.filter(c => selected.has(c.id));
    }

    // Channels an action targets: the selected channels, or — when a group row is
    // selected — that group's channels (so Deploy/Enable/Disable work on a group).
    function effectiveChannels() {
        if (selected.size) return selectedChannels();
        if (lastGroupId) {
            const g = groupedChannels().find(x => x.id === lastGroupId);
            return g ? g.channels : [];
        }
        return [];
    }

    const requireSingle = (rows: any) => {
        if (rows.length !== 1) { toast('Select a single channel', 'warn'); return null; }
        return rows[0];
    };

    const requireAny = (rows: any) => {
        if (!rows.length) { toast('Select a channel first', 'warn'); return null; }
        return rows;
    };

    /* ---- channel tasks ----------------------------------------------------------- */

    async function redeployAllTask() {
        if (!await confirmDialog('Redeploy All', 'Undeploy and redeploy all channels?', { okLabel: 'Redeploy' })) return;
        try {
            await api.engine.redeployAll();
            toast('Redeploying all channels');
            router.navigate('/dashboard');
        } catch (e: any) {
            errorModal('Redeploy Failed', e);
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
        const card = (mode: any, iconName: any, title: any, desc: any) => h('button', {
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
            body: h('div', { class: 'flex flex-col gap-2.5 min-w-[396px]' },
                card('classic', 'edit', 'Classic editor', 'The full tabbed editor — every option on one screen.'),
                card('guided', 'wand', 'Wizard', 'A step-by-step guided builder: dependencies, options, source, destinations, filters and transforms.'),
                h('label', { class: 'flex items-center gap-2 mt-2 text-text-dim' },
                    h('input', { type: 'checkbox', onChange: (e: any) => { remember = e.target.checked; } }),
                    'Remember my choice (set as default)')),
            buttons: [{ label: 'Cancel' }]
        });
    }

    async function importTask() {
        if (importBusyRef.current) return;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        importBusyRef.current = true;
        try {
            const file = await pickFile('.xml,.json');
            assertSession();
            if (!file) return;
            const content = String(file.content || '').trim();
            const importIds = importIdsFor(content);
            const existingChannels = await api.channels.list();
            assertSession();
            if (content.startsWith('<')) {
                if (await importChannelXml(content, existingChannels, { assertSession, importIds }) === false) return;
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.channel) obj = obj.channel;
                const resolved = await resolveImportName(obj.name || '', obj.id || '', existingChannels, assertSession, importIds);
                assertSession();
                if (!resolved) return;
                const bundled = api.asList(obj.exportData && obj.exportData.codeTemplateLibraries, 'codeTemplateLibrary')
                    .filter(l => l && typeof l === 'object' && l.id);
                if (resolved.id !== obj.id) {
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
                    assertSession();
                    if (choice === 'cancel') return;
                    if (choice === 'yes') await importLibraryObjectsJson(
                        consolidateBundledLibraries([{ libraries: bundled, channelId: obj.id }]), assertSession, importIds);
                }
                if (obj.exportData) delete obj.exportData.codeTemplateLibraries;
                assertSession();
                const saved = await updateChannelWithConflict(obj.id,
                    override => api.channels.update(obj.id, obj, override),
                    { userId: store.getState('user')?.id, confirmConflict: confirmChannelOverwrite, assertSession });
                if (!saved) return;
            }
            pendingImportRef.current = null;
            toast(`Imported ${file.name}`);
            await refresh();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(e.message, 'error');
            await refresh();
        } finally { importBusyRef.current = false; }
    }

    /* Exports use the engine's own XStream XML (Accept: application/xml) so the
       files are interchangeable with the Swing Administrator. The engine bundles
       the channel's code template libraries into exportData when asked
       (includeCodeTemplateLibraries) — same format the Swing client produces. */
    async function exportTask(rows: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        const channel = requireSingle(rows);
        if (!channel) return;
        // Ask up front (before the save dialog) whether to bundle code template
        // libraries — only when the channel actually has linked ones. saveFile
        // falls back to a normal download if the native picker can't engage
        // outside the click gesture.
        try {
            const includeLibs = await chooseExportLibraries([channel.id], assertSession);
            assertSession();
            if (includeLibs == null) return;
            await saveFile(`${channel.name || channel.id}.xml`, 'application/xml',
                () => api.getXml(`/channels/${channel.id}`, includeLibs ? { includeCodeTemplateLibraries: true } : undefined), assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(e.message, 'error');
        }
    }

    async function exportAllTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        if (!channels.length) { toast('No channels to export', 'warn'); return; }
        try {
            const includeLibs = await chooseExportLibraries(channels.map(channel => channel.id), assertSession);
            assertSession();
            if (includeLibs == null) return;
            await saveFile('channels.zip', 'application/zip', async () => {
                const xml = await api.getXml('/channels', includeLibs ? { includeCodeTemplateLibraries: true } : undefined, { timeoutMs: null });
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Engine returned invalid channel XML');
                const root = doc.documentElement;
                const elements = channelXmlElements(root);
                const returnedIds = new Set(elements.map(element =>
                    [...element.children].find(c => c.tagName === 'id')?.textContent).filter(Boolean));
                const missing = channels.filter(channel => !returnedIds.has(String(channel.id)));
                if (missing.length) throw new Error(`The engine omitted ${missing.length} channel${missing.length === 1 ? '' : 's'} from the export`);
                const zip = createZip();
                const used = new Set<string>();
                for (const element of elements) {
                    const direct = (tag: string) => [...element.children].find(c => c.tagName === tag)?.textContent;
                    zip.add(exportFileName(direct('name'), direct('id') || 'channel', used), new XMLSerializer().serializeToString(element));
                }
                return zip.blob();
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(e.message, 'error');
        }
    }

    async function cloneTask(rows: any) {
        const channel = requireSingle(rows);
        if (!channel) return;
        try {
            const copy = structuredClone(channel);
            copy.id = uuid();
            copy.name = `${channel.name} copy`;
            copy.revision = 0;
            await api.channels.create(copy);
            toast(`Cloned ${channel.name}`);
            refresh();
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    async function deleteTask(selRows: any) {
        const rows = requireAny(selRows);
        if (!rows) return;
        if (!await confirmDialog('Delete channels', `Permanently delete ${rows.length} channel(s)? This cannot be undone.`, { danger: true, okLabel: 'Delete' })) return;
        for (const channel of rows) {
            try { await api.channels.remove(channel.id); } catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }

    async function setEnabledTask(enabled: any, rows: any) {
        if (!rows.length) { toast('Select a channel or group first', 'warn'); return; }
        for (const channel of rows) {
            try { await api.channels.setEnabled(channel.id, enabled); } catch (e: any) { toast(e.message, 'error'); }
        }
        refresh();
    }

    async function deployTask(rows: any) {
        if (!rows.length) { toast('Select a channel or group first', 'warn'); return; }
        try {
            if (!await runLifecycle('deploy', rows.map((c: any) => c.id))) return;
            // Move to the Dashboard to watch deployment (matches Swing).
            toast(rows.length === 1 ? `Deploying ${rows[0].name}` : `Deploying ${rows.length} channels`);
            router.navigate('/dashboard');
        } catch (e: any) {
            // Deploy compile failures return the engine's full exception — show it
            // in the readable/copyable detail modal, not a giant corner toast.
            errorModal('Channel Deployment Failed', e,
                rows.length === 1 ? rows[0].name : `${rows.length} channels`);
            refresh();
        }
    }

    function messagesTask(rows: any) {
        const channel = requireSingle(rows);
        if (!channel) return;
        router.navigate(`/messages/${channel.id}`);
    }

    function saveGroupChanges(change: (groups: any[]) => any[], removedIds: string[] = [], expectedGroup?: any) {
        return mutateChannelGroups(change, removedIds, { expectedGroup,
            confirmOverwrite: () => confirmDialog('Channel Groups Modified',
                'One or more channel groups have been modified since you last refreshed. Do you want to overwrite the changes?',
                { danger: true, okLabel: 'Overwrite' }) });
    }

    /* Move channels between groups (used by the modal task and drag/drop).
       targetId DEFAULT_GROUP_ID means "remove from all groups". */
    async function moveChannelsToGroup(ids: any, targetId: any) {
        try {
            if (!await saveGroupChanges((updated: any[]) => {
                if (targetId !== DEFAULT_GROUP_ID && !updated.some(g => g.id === targetId)) {
                    throw new Error('The destination group was removed. Refresh and choose another group.');
                }
                for (const group of updated) {
                    let members = api.asList(group.channels, 'channel').filter(m => m && m.id && !ids.has(m.id));
                    if (group.id === targetId) members = members.concat([...ids].map(id => ({ id })));
                    group.channels = members.length ? { channel: members } : null;
                }
                return updated;
            })) return false;
            toast('Channels moved');
            refresh();
            return true;
        } catch (e: any) {
            toast(e.message, 'error');
            return false;
        }
    }

    function moveToGroupTask(selRows: any) {
        const rows = requireAny(selRows);
        if (!rows) return;
        const ids = new Set(rows.map((c: any) => c.id));
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
        try {
            const created = { id: uuid(), name: name.trim(), revision: 0, description: '', channels: null };
            if (!await saveGroupChanges((updated: any[]) => [...updated, created])) return;
            toast(`Created group ${name.trim()}`);
            refresh();
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    /* Group tasks take the target group explicitly (the task pane passes the
       render-resolved current group; the context menu passes its row's group).
       The synthetic Default Group never reaches them — its items are hidden. */
    const requireGroup = (group: any) => {
        if (!group || group.id === DEFAULT_GROUP_ID) { toast('Select a group row first', 'warn'); return null; }
        return group;
    };

    async function deleteGroupTask(g: any) {
        const group = requireGroup(g);
        if (!group) return;
        if (!await confirmDialog('Delete Group', `Delete group "${group.name}"? Its channels move to the Default Group.`, { danger: true, okLabel: 'Delete' })) return;
        try {
            if (!await saveGroupChanges((updated: any[]) => updated.filter(x => x.id !== group.id), [group.id], group)) return;
            toast(`Deleted group ${group.name}`);
            setLastGroupId(null);
            refresh();
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    function editGroupTask(g: any) {
        const group = requireGroup(g);
        if (!group) return;
        const nameInput = textInput(group.name || '');
        const descArea = h('textarea', { rows: 4 });
        (descArea as any).value = group.description || '';
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
                        try {
                            if (!await saveGroupChanges((updated: any[]) => {
                                const target = updated.find(current => current.id === group.id);
                                target.name = name;
                                target.description = (descArea as any).value;
                                return updated;
                            }, [], group)) return false;
                            toast(`Group "${name}" updated`);
                            refresh();
                        } catch (e: any) {
                            toast(e.message, 'error');
                            return false;
                        }
                    }
                }
            ]
        });
    }

    /* The engine has no direct group import endpoint (only the multipart
       _bulkUpdate), so Swing-format group XML is parsed client-side. Swing group
       exports embed complete <channel> objects; keep those objects available for
       import instead of reducing them to group membership references. */
    function parseGroupXml(text: any) {
        const doc = new DOMParser().parseFromString(String(text || '').trim(), 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('Not a valid XML file');
        const root = doc.documentElement;
        const els = root.tagName === 'channelGroup'
            ? [root]
            : [...root.querySelectorAll(':scope > channelGroup')];
        if (!els.length) throw new Error('No <channelGroup> elements found in the file');
        return els.map(el => {
            const childText = (tag: any) => {
                const child = [...el.children].find(c => c.tagName === tag);
                return child ? child.textContent : '';
            };
            const channelContainer = [...el.children].find(child => child.tagName === 'channels');
            const embeddedChannels = (channelContainer ? channelXmlElements(channelContainer) : [])
                .map(channelEl => {
                    const child = (tag: any) => [...channelEl.children].find(x => x.tagName === tag);
                    return {
                        id: child('id')?.textContent || '',
                        // Group records returned by the engine can contain id-only
                        // references. A Swing export has a direct <name> and the
                        // rest of the complete channel definition.
                        isDefinition: Boolean(child('name')),
                        xml: new XMLSerializer().serializeToString(channelEl)
                    };
                })
                .filter(channel => channel.id);
            const group: any = {
                id: childText('id') || uuid(),
                name: childText('name') || 'Imported Group',
                revision: 0,
                description: childText('description'),
                channels: null
            };
            return { group, embeddedChannels };
        });
    }

    async function importGroupTask() {
        if (importBusyRef.current) return;
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        importBusyRef.current = true;
        let importedChannelCount = 0;
        let failedChannelCount = 0;
        try {
            const file = await pickFile('.xml');
            assertSession();
            if (!file) return;
            const content = String(file.content || '').trim();
            const importIds = importIdsFor(content);
            const verdict = checkImportVersionFromDoc(new DOMParser().parseFromString(content, 'text/xml'), 'group');
            if (verdict.action === 'block') { await alertInformation(verdict.message); return; }
            if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return;
            assertSession();
            const parsed = parseGroupXml(content);
            // All prerequisite reads finish before any library or channel write.
            const [baselineGroups, knownChannels] = await Promise.all([api.channelGroups.list(), api.channels.list()]);
            assertSession();
            const resolvedChannelIds = new Map<string, string>();
            const failedChannelIds = new Set<string>();
            // Resolve imported channel identities before saving library bindings.
            // Swing saves libraries first, but then changing a channel ID would
            // leave those bindings on the old channel. All writes still happen
            // library-first; only the conflict decisions happen beforehand.
            const preparedChannels = new Map<string, any>();
            const reservedChannels = structuredClone(knownChannels);
            for (const { embeddedChannels } of parsed) {
                for (const embedded of embeddedChannels) {
                    if (!embedded.isDefinition || preparedChannels.has(embedded.id) || failedChannelIds.has(embedded.id)) continue;
                    const channelDoc = new DOMParser().parseFromString(embedded.xml, 'text/xml');
                    const name = [...channelDoc.documentElement.children].find(child => child.tagName === 'name')?.textContent || '';
                    const resolved = await resolveImportName(name, embedded.id, reservedChannels, assertSession, importIds);
                    assertSession();
                    if (!resolved) { failedChannelIds.add(embedded.id); failedChannelCount++; continue; }
                    preparedChannels.set(embedded.id, resolved);
                    const previous = reservedChannels.find(channel => channel.id === resolved.id);
                    if (previous) Object.assign(previous, resolved);
                    else reservedChannels.push(resolved);
                }
            }
            const imported: { group: any; replacedId?: string }[] = [];
            let plannedGroups: any[] = structuredClone(baselineGroups);

            const bundles: { libraries: any[]; channelId: string }[] = [];
            for (const { embeddedChannels } of parsed) {
                for (const embedded of embeddedChannels) {
                    if (!embedded.isDefinition || failedChannelIds.has(embedded.id)) continue;
                    const channelDoc = new DOMParser().parseFromString(embedded.xml, 'text/xml');
                    const elements = [...channelDoc.querySelectorAll('exportData > codeTemplateLibraries > codeTemplateLibrary')];
                    const libraries = bundledLibrariesFromXml(elements);
                    for (const library of libraries) {
                        const enabled = api.asList(library.enabledChannelIds, 'string').map(id => preparedChannels.get(String(id))?.id || String(id));
                        library.enabledChannelIds = enabled.length ? { string: [...new Set(enabled)] } : '';
                    }
                    bundles.push({ libraries, channelId: preparedChannels.get(embedded.id)?.id || embedded.id });
                }
            }
            const bundledLibraries = consolidateBundledLibraries(bundles);
            if (bundledLibraries.length) {
                const groupName = parsed.length === 1 ? parsed[0].group.name : file.name;
                const choice = await promptImportLibraries(groupName, bundledLibraries.length, 'Group');
                assertSession();
                if (choice === 'cancel') return;
                if (choice === 'yes') await importLibraryObjectsJson(bundledLibraries, assertSession, importIds);
                assertSession();
            }

            // Import definitions first, so an ID-only reference preceding its
            // definition in a later exported group cannot suppress that import.
            for (const { embeddedChannels } of parsed) {
                for (const embedded of embeddedChannels) {
                    if (!embedded.isDefinition || failedChannelIds.has(embedded.id) || resolvedChannelIds.has(embedded.id)) continue;
                    let resolved: any;
                    try {
                        resolved = await importChannelXml(embedded.xml, knownChannels, {
                            checkVersion: false, importLibraries: false, assertSession, importIds,
                            resolvedIdentity: preparedChannels.get(embedded.id)
                        });
                        assertSession();
                    } catch (e: any) {
                        assertSession();
                        failedChannelIds.add(embedded.id);
                        failedChannelCount++;
                        toast(`Error importing channel: ${e.message || e}`, 'error');
                        continue;
                    }
                    if (resolved === false) {
                        failedChannelIds.add(embedded.id);
                        failedChannelCount++;
                        continue;
                    }
                    importedChannelCount++;
                    resolvedChannelIds.set(embedded.id, resolved.id);
                    const previous = knownChannels.find((channel: any) => channel.id === resolved.id);
                    if (previous) Object.assign(previous, resolved);
                    else knownChannels.push(resolved);
                }
            }
            for (const { group, embeddedChannels } of parsed) {
                const refs = new Map<string, { id: string }>();
                for (const embedded of embeddedChannels) {
                    if (failedChannelIds.has(embedded.id)) continue;
                    const finalId = resolvedChannelIds.get(embedded.id) || embedded.id;
                    if (!knownChannels.some(channel => channel.id === finalId)) {
                        failedChannelIds.add(embedded.id);
                        failedChannelCount++;
                        continue;
                    }
                    refs.set(finalId, { id: finalId });
                }
                group.channels = refs.size ? { channel: [...refs.values()] } : null;
                // The default group transports ungrouped channels and is never persisted.
                if (group.id === ENGINE_DEFAULT_GROUP_ID || group.name === ENGINE_DEFAULT_GROUP_NAME) continue;
                let generatedIds = 0;
                const resolved = await resolveGroupImport(plannedGroups, group, {
                    overwrite: async () => {
                        const result = await optionYesNo('Import Group', "Would you like to overwrite the existing group? Choose 'No' to create a new group.");
                        assertSession();
                        return Boolean(result);
                    },
                    rename: async name => {
                        const result = await promptDialog('Import Group', 'Please enter a new name for the group.', name);
                        assertSession();
                        return result;
                    },
                    newId: () => {
                        const key = `group:${imported.length}:${group.id}:${generatedIds++}`;
                        if (!importIds.has(key)) importIds.set(key, uuid());
                        return importIds.get(key)!;
                    }
                });
                assertSession();
                if (!resolved) {
                    toast(`Group import cancelled. ${importedChannelCount} channel(s) already imported have been kept.`, 'warn');
                    return;
                }
                imported.push(resolved);
                plannedGroups = applyGroupImports(baselineGroups, baselineGroups, imported).groups;
            }
            if (imported.length) {
                const latest = await api.channelGroups.list();
                assertSession();
                const payload = applyGroupImports(latest, baselineGroups, imported);
                const result = await api.channelGroups.bulkUpdate(payload.groups, payload.removedIds, false);
                assertSession();
                if (result !== true && result !== 'true') throw new Error('Channel groups changed during import or the engine did not confirm the save. Import again to review the latest groups.');
            }
            pendingImportRef.current = null;
            if (failedChannelCount) toast(`Imported ${parsed.length} group(s) from ${file.name}; ${failedChannelCount} channel(s) were skipped or failed.`, 'warn');
            else toast(`Imported ${parsed.length} group(s) from ${file.name}`);
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(`${e.message}${importedChannelCount ? ` ${importedChannelCount} channel(s) already imported have been kept.` : ''}`, 'error');
        } finally {
            importBusyRef.current = false;
            try { assertSession(); await refresh(); } catch { /* A changed session owns its own refresh. */ }
        }
    }

    /* GET /channelgroups returns membership references, while Swing's exported
       ChannelGroup contains complete Channel objects. Hydrate those references
       from GET /channels before serializing so this file can recreate both the
       group and its channels when imported on another server. */
    async function channelGroupExportXml(groupId: any, includeCodeTemplateLibraries: boolean, assertSession: () => void) {
        assertSession();
        const groupsXml = await api.getXml('/channelgroups', undefined, { timeoutMs: null });
        assertSession();
        const groupsDoc = new DOMParser().parseFromString(groupsXml, 'text/xml');
        if (groupsDoc.querySelector('parsererror')) throw new Error('Engine returned invalid channel group XML');

        const groupsRoot = groupsDoc.documentElement;
        const allGroups = groupsRoot.tagName === 'channelGroup'
            ? [groupsRoot]
            : [...groupsRoot.querySelectorAll(':scope > channelGroup')];
        const wantsDefault = groupId == null || groupId === DEFAULT_GROUP_ID;
        const exportGroups = groupId == null
            ? allGroups
            : groupId === DEFAULT_GROUP_ID
                ? []
                : allGroups.filter(groupEl =>
                    [...groupEl.children].find(c => c.tagName === 'id')?.textContent === groupId);
        if (groupId != null && groupId !== DEFAULT_GROUP_ID && !exportGroups.length) {
            throw new Error('Channel group not found in the engine XML');
        }

        const refsByGroup = new Map<any, { container: any; refs: string[] }>();
        const channelIds = new Set<string>();
        const assignedIds = new Set<string>();
        for (const groupEl of allGroups) {
            const container = [...groupEl.children].find(c => c.tagName === 'channels');
            for (const ref of container ? channelXmlElements(container) : []) {
                const id = [...ref.children].find(x => x.tagName === 'id')?.textContent;
                if (id) assignedIds.add(id);
            }
        }
        for (const groupEl of exportGroups) {
            const container = [...groupEl.children].find(c => c.tagName === 'channels');
            const refs = container
                ? channelXmlElements(container)
                    .map(c => [...c.children].find(x => x.tagName === 'id')?.textContent || '')
                    .filter(Boolean)
                : [];
            refsByGroup.set(groupEl, { container, refs });
            refs.forEach(id => channelIds.add(id));
        }

        const channelById = new Map<string, Element>();
        if (channelIds.size || wantsDefault) {
            const channelParams = wantsDefault
                ? (includeCodeTemplateLibraries ? { includeCodeTemplateLibraries: true } : undefined)
                : {
                    channelId: [...channelIds],
                    ...(includeCodeTemplateLibraries ? { includeCodeTemplateLibraries: true } : {})
                };
            const channelsXml = await api.getXml('/channels', channelParams, { timeoutMs: null });
            assertSession();
            const channelsDoc = new DOMParser().parseFromString(channelsXml, 'text/xml');
            if (channelsDoc.querySelector('parsererror')) throw new Error('Engine returned invalid channel XML');
            const channelsRoot = channelsDoc.documentElement;
            const fullChannels = channelXmlElements(channelsRoot);
            for (const channelEl of fullChannels) {
                const id = [...channelEl.children].find(c => c.tagName === 'id')?.textContent;
                if (id) channelById.set(id, channelEl);
            }
            if (wantsDefault) {
                const missing = channels.filter(channel => !channelById.has(String(channel.id)));
                if (missing.length) throw new Error(`The engine omitted ${missing.length} channel${missing.length === 1 ? '' : 's'} from the group export`);
            }
        }

        for (const groupEl of exportGroups) {
            const entry = refsByGroup.get(groupEl)!;
            let container = entry.container;
            if (!container) {
                container = groupsDoc.createElement('channels');
                groupEl.appendChild(container);
            }
            container.replaceChildren();
            for (const id of entry.refs) {
                const channelEl = channelById.get(id);
                if (!channelEl) throw new Error(`Channel ${id} was not returned while exporting its group`);
                container.appendChild(groupsDoc.importNode(channelEl, true));
            }
        }

        let defaultGroup: Element | null = null;
        if (wantsDefault) {
            defaultGroup = groupsDoc.createElement('channelGroup');
            defaultGroup.setAttribute('version', store.getState('serverVersion') || '4.5.2');
            const add = (tag: string, value: string) => {
                const child = groupsDoc.createElement(tag);
                child.textContent = value;
                defaultGroup!.appendChild(child);
            };
            add('id', ENGINE_DEFAULT_GROUP_ID);
            add('name', ENGINE_DEFAULT_GROUP_NAME);
            add('description', 'Channels not part of a group will appear here.');
            const container = groupsDoc.createElement('channels');
            for (const [id, channelEl] of channelById) {
                if (!assignedIds.has(id)) container.appendChild(groupsDoc.importNode(channelEl, true));
            }
            defaultGroup.appendChild(container);
        }

        if (groupId === DEFAULT_GROUP_ID) return new XMLSerializer().serializeToString(defaultGroup!);
        if (groupId != null) return new XMLSerializer().serializeToString(exportGroups[0]);
        const output = document.implementation.createDocument(null, 'list');
        for (const groupEl of exportGroups) output.documentElement.appendChild(output.importNode(groupEl, true));
        if (defaultGroup) output.documentElement.appendChild(output.importNode(defaultGroup, true));
        return new XMLSerializer().serializeToString(output);
    }

    async function exportGroupTask(g: any) {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        if (!g) { toast('Select a group row first', 'warn'); return; }
        const group = g.id === DEFAULT_GROUP_ID ? g : requireGroup(g);
        if (!group) return;
        try {
            const ids = api.asList(group.channels, 'channel').map((channel: any) => channel && channel.id).filter(Boolean);
            const includeLibs = await chooseExportLibraries(ids, assertSession);
            assertSession();
            if (includeLibs == null) return;
            await saveFile(`${group.name || group.id}.xml`, 'application/xml', () => channelGroupExportXml(group.id, includeLibs, assertSession), assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(e.message, 'error');
        }
    }

    async function exportGroupsTask() {
        let assertSession: () => void;
        try { assertSession = captureEngineSession(); } catch { return; }
        try {
            const includeLibs = await chooseExportLibraries(channels.map(channel => channel.id), assertSession);
            assertSession();
            if (includeLibs == null) return;
            await saveFile('channel-groups.zip', 'application/zip', async () => {
                const xml = await channelGroupExportXml(undefined, includeLibs, assertSession);
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Engine returned invalid channel group XML');
                const root = doc.documentElement;
                const elements = root.tagName === 'channelGroup' ? [root] : [...root.querySelectorAll(':scope > channelGroup')];
                const zip = createZip();
                const used = new Set<string>();
                for (const element of elements) {
                    const direct = (tag: string) => [...element.children].find(c => c.tagName === tag)?.textContent;
                    zip.add(exportFileName(direct('name'), direct('id') || 'channel-group', used), new XMLSerializer().serializeToString(element));
                }
                return zip.blob();
            }, assertSession);
            assertSession();
        } catch (e: any) {
            try { assertSession(); } catch { return; }
            toast(e.message, 'error');
        }
    }

    // Click on empty space (not a row) clears the selection, dismissing the
    // contextual task buttons. Wired to the grid wrapper so a click below the
    // (short) tree bubbles up here.
    function onEmptyClick(e: any) {
        if (e.target.closest('tr')) return;
        if (!selected.size && !lastGroupId) return;
        setSelected(new Set());
        lastClickedRef.current = null;
        setLastGroupId(null);
    }

    /* ---- mount: load ---- */

    useEffect(() => {
        refresh();
        // A plugin that mutates a channel out-of-band (e.g. history revert) emits
        // this so the list reflects the change immediately (Swing doRefreshChannels).
        const off = platform.events.on('channels:changed', () => refresh());
        return off;
    }, []);

    /* ---- task panes (Swing parity, selection-gated) ----
       Channel Tasks: deployable = a channel selected OR a group row selected, and
       Deploy shows only when that selection holds an enabled channel — disabled
       channels are never deployed, so Swing hides the task when all of them are. */
    const eff = effectiveChannels();
    const channelSel = selected.size > 0;
    const singleChannel = selected.size === 1;
    const deployable = channelSel || !!lastGroupId;
    const showDeploy = deployable && eff.some(isEnabled);
    const showExport = channelSel;
    const showDelete = channelSel;
    const showClone = singleChannel;
    const showEdit = singleChannel;
    const showEnable = deployable && eff.some((c: any) => !isEnabled(c));
    const showDisable = deployable && eff.some((c: any) => isEnabled(c));
    const showMessages = singleChannel;

    const selectedGroup = lastGroupId ? groupedChannels().find(group => group.id === lastGroupId) : null;
    const realGroup = !!selectedGroup && selectedGroup.id !== DEFAULT_GROUP_ID;
    const currentGroup = selectedGroup ? (selectedGroup.group || selectedGroup) : null;
    const showAssign = channelSel;
    const showGroupEdit = realGroup;
    const showGroupExport = !!selectedGroup;
    const showGroupDelete = realGroup;

    /* ---- tree data + filter + counts for the <TreeTable> ---- */
    const hasFilter = !!filterText.trim();
    // Children are wrapped channel nodes (sorted by name) so getChildren() hands
    // TreeTable the same node shape rowKey/columns/onSelect expect.
    const channelNodes = (list: any[]) => [...list].sort(byName).map((channel: any) => ({ kind: 'channel', channel }));
    // Group view: group nodes with their channel children. Channel view: the flat
    // channel list (Swing's channel table mode). When there are no channels at
    // all we pass [] so TreeTable shows its empty state (Swing parity: the
    // synthetic Default Group row is not drawn over an empty engine).
    const grouped = channels.length ? groupedChannels() : [];
    const treeData = groupView
        ? grouped.map((g: any) => ({ kind: 'group', id: g.id, group: g, children: channelNodes(g.channels) }))
        : channelNodes(channels);
    // Filter: groups don't self-match (legacy filters channels); a group is kept
    // by TreeTable when a descendant channel matches.
    const treeMatches = hasFilter
        ? (n: any) => (n.kind === 'group' ? false : matchesFilter(n.channel))
        : undefined;
    // Collapsed groups, keyed by the channel-tree rowKey ('grp:<id>').
    const collapsedKeys = new Set([...collapsedGroups].map((id: any) => 'grp:' + id));

    // Counts bar: groups shown (Group view only, as in Swing) / channels shown /
    // enabled — after the filter, and dropping empty groups only while
    // filtering, matching the legacy.
    const shownGroups = grouped
        .map((g: any) => ({ group: g, channels: g.channels.filter((c: any) => !hasFilter || matchesFilter(c)) }))
        .filter((g: any) => g.channels.length > 0 || !hasFilter);
    const shownChannels = channels.filter((c: any) => !hasFilter || matchesFilter(c));
    const enabledCount = shownChannels.filter(isEnabled).length;
    const countsText = (groupView ? `${shownGroups.length} Group${shownGroups.length === 1 ? '' : 's'}, ` : '')
        + `${shownChannels.length} Channel${shownChannels.length === 1 ? '' : 's'}, `
        + `${enabledCount} Enabled`;

    return (
        <div className="view">
            <ViewTasks>
                <RailPane title="Channel Tasks" paneKey="tasks:Channel Tasks" group="channel">
                    <div className="taskbar" data-pane-title="Channel Tasks">
                        <TaskButton label="Refresh" icon="refresh" task="doRefreshChannels" onClick={() => refresh()} />
                        <TaskButton label="Redeploy All" icon="deploy" task="doRedeployAll" onClick={redeployAllTask} />
                        {showDeploy && <TaskButton label="Deploy Channel" icon="deploy" task="doDeployChannel" onClick={() => deployTask(effectiveChannels())} />}
                        <TaskButton label="New Channel" icon="plus" primary task="doNewChannel" onClick={newTask} />
                        <TaskButton label="Import Channel" icon="import" task="doImportChannel" onClick={importTask} />
                        {showExport && <TaskButton label="Export Channel" icon="export" task="doExportChannel" onClick={() => exportTask(selectedChannels())} />}
                        {showDelete && <TaskButton label="Delete Channel" icon="trash" danger task="doDeleteChannel" onClick={() => deleteTask(selectedChannels())} />}
                        {showClone && <TaskButton label="Clone Channel" icon="copy" task="doCloneChannel" onClick={() => cloneTask(selectedChannels())} />}
                        {showEdit && <TaskButton label="Edit Channel" icon="edit" task="doEditChannel" onClick={() => { const c = requireSingle(selectedChannels()); if (c) router.navigate(`/channels/${c.id}/edit`); }} />}
                        {showEnable && <TaskButton label="Enable Channel" icon="check" task="doEnableChannel" onClick={() => setEnabledTask(true, effectiveChannels())} />}
                        {showDisable && <TaskButton label="Disable Channel" icon="x" task="doDisableChannel" onClick={() => setEnabledTask(false, effectiveChannels())} />}
                        {showMessages && <TaskButton label="View Messages" icon="messages" task="doViewMessages" onClick={() => messagesTask(selectedChannels())} />}
                        {singleChannel && (() => {
                            const c = selectedChannels()[0];
                            const ctx = { platform, channel: c, selectedIds: new Set(selected) };
                            return platform.channelActions()
                                .filter((a: any) => (a.isEnabled ? a.isEnabled(ctx) : true))
                                .map((a: any) => <TaskButton key={a.id || a.label} label={a.label} icon={a.icon} task={a.task}
                                    onClick={() => a.onInvoke(c, ctx)} />);
                        })()}
                    </div>
                </RailPane>
                {/* Swing shows the Group Tasks pane only in Group view. */}
                {groupView && <RailPane title="Group Tasks" paneKey="tasks:Group Tasks" group="channelGroup">
                    <div className="taskbar" data-pane-title="Group Tasks">
                        {showAssign && <TaskButton label="Assign To Group" icon="folder" task="doAssignChannelToGroup" onClick={() => moveToGroupTask(selectedChannels())} />}
                        <TaskButton label="New Group" icon="plus" task="doNewGroup" onClick={newGroupTask} />
                        {showGroupEdit && <TaskButton label="Edit Group Details" icon="edit" task="doEditGroupDetails" onClick={() => editGroupTask(currentGroup)} />}
                        <TaskButton label="Import Group" icon="import" task="doImportGroup" onClick={importGroupTask} />
                        <TaskButton label="Export All Groups" icon="export" task="doExportAllGroups" onClick={exportGroupsTask} />
                        {showGroupExport && <TaskButton label="Export Group" icon="export" task="doExportGroup" onClick={() => exportGroupTask(currentGroup)} />}
                        {showGroupDelete && <TaskButton label="Delete Group" icon="trash" danger task="doDeleteGroup" onClick={() => deleteGroupTask(currentGroup)} />}
                    </div>
                </RailPane>}
            </ViewTasks>
            <div className="view-body flush flex flex-col overflow-hidden">
                {loadError && <div className="mx-[13px] mt-3 panel border-danger text-danger" role="alert">
                    Failed to load channels: {loadError}
                </div>}
                {/* Grid so the TreeTable's own .dt-wrap stretches to fill the
                    region (a flex child wouldn't grow on the main axis); this
                    leaves clickable empty space below a short tree for
                    click-to-clear, matching the legacy flex:1 grid host. */}
                <div className="oie-tablecard flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] px-[13px] pt-3 pb-3" onClick={onEmptyClick}>
                    <TreeTable
                        data={treeData}
                        columns={treeColumns()}
                        getChildren={(n: any) => (n.kind === 'group' ? n.children : null)}
                        rowKey={(n: any) => (n.kind === 'group' ? 'grp:' + n.id : 'ch:' + n.channel.id)}
                        rowClassName={(n: any) => (n.kind === 'group' ? 'group-row' : '')}
                        selectedKeys={channelSel
                            ? new Set([...selected].map((id: any) => 'ch:' + id))
                            : (lastGroupId ? new Set(['grp:' + lastGroupId]) : new Set())}
                        onSelect={onRowSelect}
                        onActivate={onRowActivate}
                        onRowContextMenu={onRowMenu}
                        onEmptyContextMenu={onEmptyMenu}
                        matches={treeMatches}
                        collapsedKeys={collapsedKeys}
                        onToggleCollapse={(key: any) => toggleGroupCollapse(key.replace(/^grp:/, ''))}
                        rowDraggable={(n: any) => groupView && n.kind === 'channel'}
                        onRowDrop={onRowDrop}
                        columnsKey="channels"
                        columnWidths={CHANNEL_COL_WIDTHS}
                        pinnedKeys={['status', 'name']}
                        emptyText={(
                            <>
                                <div className="empty-icon"><Icon name="channels" size={30} /></div>
                                <div>No channels</div>
                                <div className="text-text-faint mt-[13px]">Create a channel with &quot;New Channel&quot; in the Channels Tasks pane.</div>
                            </>
                        )} />
                </div>
                <div className="filterbar panel overflow-visible mx-[13px] mb-3">
                    <label>Filter:</label>
                    <input type="text" placeholder="Enter channel tag or name" value={filterText}
                        onChange={(e: any) => setFilterText(e.target.value)} />
                    <span className="counts">{countsText}</span>
                    {/* The same View / Tags toggles as the Dashboard filter bar. */}
                    <div className="flex items-center gap-x-3.5 gap-y-1.5 flex-wrap ml-auto">
                        <SegPill value={viewMode} onChange={setViewMode} label="Row grouping" options={VIEW_MODE_OPTIONS} />
                        <span className="inline-flex items-center gap-[4px]">
                            <span className="text-text-faint text-[10px]">Tags:</span>
                            <SegPill value={tagMode} onChange={setTagMode} label="Tag display" options={TAG_MODE_OPTIONS} />
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
