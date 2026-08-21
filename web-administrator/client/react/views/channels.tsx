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
 */

import { useEffect, useRef, useState } from 'react';
import { h, icon, toast, confirmDialog, promptDialog, contextMenu, modal, errorModal, select, field, textInput, saveFile, pickFile, fmtDate } from '@oie/web-ui';
import api, { newChannel, uuid } from '@oie/web-api';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { createZip } from '../../core/zip.js';
import { getPref, setPrefs } from '../../core/prefs.js';
import { checkImportVersion, checkImportVersionFromDoc } from '../../core/import-guard.js';
import { alertInformation, optionYesNo, resolveImportName as resolveImportIdentity } from './import-dialogs.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { xmlToJson } from './code-template-xml.js';
import { withDependencies } from './channel-lifecycle.js';


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

// "Channel X has code template libraries included — import them?" — Yes/No/Cancel
// with an "always" checkbox that persists the importLibrariesWithChannels pref.
// Returns 'yes' | 'no' | 'cancel'.
function promptImportLibraries(channelName: any, count: any) {
    const pref = getPref('importLibrariesWithChannels');
    if (pref === 'yes') return Promise.resolve('yes');
    if (pref === 'no') return Promise.resolve('no');
    const plural = count === 1 ? 'y' : 'ies';
    const them = count === 1 ? 'it' : 'them';
    return new Promise(resolve => {
        const always = h('input', { type: 'checkbox' });
        const remember = (choice: any) => { if ((always as any).checked) setPrefs({ importLibrariesWithChannels: choice }); return choice; };
        modal({
            title: 'Import Channel',
            body: h('div',
                h('div', { class: 'mb-2.5' },
                    `Channel "${channelName}" has code template librar${plural} included with it. Would you like to import ${them}?`),
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

// Code template library names linked to any of these channels (same predicate as
// the Set Dependencies modal): enabled for the channel, or include-new and not
// disabled. A group export asks about the union over the group's channels, so
// one call answers for the whole export.
async function linkedLibraryNames(channelIds: any) {
    try {
        const libs = await api.codeTemplates.libraries(false);
        const idSet = (v: any) => api.asList(v, 'string').map(String);
        const cids = [...new Set(api.asList(channelIds).map(String))];
        return libs.filter(lib => cids.some(cid =>
            idSet(lib.enabledChannelIds).includes(cid) ||
            (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(cid))))
            .map(lib => lib.name || '(unnamed library)');
    } catch { return []; }
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

/* Ask — once, up front, before any save dialog — whether an export should bundle
   the code template libraries linked to `channelIds`, honoring/persisting the
   exportLibrariesWithChannels pref. Swing asks this for channel AND group
   exports, so both paths run through here. Returns true/false, or null when the
   user cancelled the export outright. Nothing linked means nothing to ask. */
async function promptIncludeLibraries(channelIds: any) {
    const pref = getPref('exportLibrariesWithChannels');
    if (pref === 'yes' || pref === 'no') return pref === 'yes';
    const linked = await linkedLibraryNames(channelIds);
    if (!linked.length) return false;
    const choice = await promptExportLibraries(linked);
    if (choice === 'cancel') return null;
    return choice === 'yes';
}

/* ---- per-object export files (Swing writes one file per object) -------------
   Swing's "Export All" asks for a DIRECTORY and drops one <channel>/<channelGroup>
   file into it; the engine's combined <list> response is not a document any
   importer deserializes. The web client has no directory to write into, so the
   per-object files go into a ZIP instead. */

/* Split an engine <list> response into standalone per-object elements. XStream
   stamps the version attribute on whatever element it serialized as the root, so
   a child lifted out of a <list> can carry none — inherit the list's, or the
   file reads as "unknown version" and prompts for migration on import. */
function detachListElements(doc: any, tag: any) {
    const root = doc.documentElement;
    if (!root) return [];
    if (root.tagName === tag) return [root];
    const els = [...root.querySelectorAll(`:scope > ${tag}`)];
    const version = root.getAttribute('version');
    if (version) for (const el of els) if (!el.getAttribute('version')) el.setAttribute('version', version);
    return els;
}

/* Name one ZIP entry after the object it holds, the way Swing names the files it
   writes into an export directory. Characters no filesystem accepts are folded
   to '_', and collisions are numbered — two channels may share a name (they only
   have to differ in id), and ZIP readers silently keep just one of two identical
   entry names. Matched case-insensitively: Windows/macOS would collide anyway. */
function exportEntryName(name: any, fallback: any, used: Set<string>) {
    const base = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '_')
        || String(fallback || 'export');
    let entry = `${base}.xml`;
    for (let n = 2; used.has(entry.toLowerCase()); n++) entry = `${base} (${n}).xml`;
    used.add(entry.toLowerCase());
    return entry;
}

const CHANNEL_NAME_RE = /^[a-zA-Z_0-9\-\s]*$/;

/* Channel naming rules on import (Swing Frame.checkChannelName), handed to the
   shared collision resolver in import-dialogs. */
const CHANNEL_IMPORT_RULES = {
    title: 'Import Channel',
    noun: 'Channel',
    validate: (n: string) => {
        if (n.length > 40) return 'Channel name cannot be longer than 40 characters.';
        if (!CHANNEL_NAME_RE.test(n)) return 'Channel name cannot have special characters besides hyphen, underscore, and space.';
        return null;
    }
};

const resolveImportName = (name: any, id: any, existing: any) =>
    resolveImportIdentity(name, id, existing, CHANNEL_IMPORT_RULES);

// Bundled libraries are a multi-object write: the rewritten library references
// and every new full template must land in the same _bulkUpdate transaction.
// This is shared by XML and JSON channel imports so neither path can leave a
// half-imported code-template graph after a mid-sequence failure.
async function saveImportedLibraries(existing: any, imported: any, channelId: any) {
    const version = store.getState('serverVersion') || '4.5.2';
    const templatesOf = (lib: any) => api.asList(lib.codeTemplates, 'codeTemplate')
        .filter((template: any) => template && typeof template === 'object' && template.id);
    const existingTemplateIds = new Set(existing.flatMap(templatesOf).map((template: any) => String(template.id)));
    const updatedTemplates: any[] = [];
    for (const library of imported) for (const original of templatesOf(library)) {
        if (existingTemplateIds.has(String(original.id))) continue;
        existingTemplateIds.add(String(original.id));
        const properties = original.properties && typeof original.properties === 'object'
            ? { '@version': original.properties['@version'] || version, ...original.properties }
            : original.properties;
        updatedTemplates.push({ '@version': original['@version'] || version, ...original, properties });
    }

    const merged = mergeImportedLibraries(structuredClone(existing), structuredClone(imported), channelId);
    const libraryPayload = merged.map((library: any) => {
        const templates = templatesOf(library);
        return {
            '@version': library['@version'] || version,
            ...library,
            codeTemplates: templates.length
                ? { codeTemplate: templates.map((template: any) => ({ '@version': template['@version'] || version, id: template.id })) }
                : null
        };
    });
    const result: any = await api.codeTemplates.bulkUpdate(libraryPayload, updatedTemplates, [], [], true);
    if (result && typeof result === 'object' && String(result.librariesSuccess) === 'false') {
        throw new Error(result.cause?.message || result.cause?.localizedMessage || 'the code-template libraries could not be saved');
    }
    const templateFailures: string[] = [];
    const scan = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(scan); return; }
        if (String(node.success) === 'false') {
            templateFailures.push(node.cause?.message || node.cause?.localizedMessage || 'a code template could not be saved');
        } else Object.values(node).forEach(scan);
    };
    scan(result?.codeTemplateResults);
    if (templateFailures.length) throw new Error(templateFailures.join('; '));
}

async function importLibraryElementsXml(bundledEls: any, channelId: any) {
    const existing = await api.codeTemplates.libraries(true);
    await saveImportedLibraries(existing, bundledEls.map((element: any) => xmlToJson(element)), channelId);
}

/* Take the deploy/start edges out of a channel export and rewrite them against
   the channel's final id.

   A channel export carries its edges in exportData.dependencyIds (channels this
   one waits for) and exportData.dependentIds (channels that wait for this one).
   The engine applies only metadata and tags from exportData on create/update, so
   an importer that ignores these drops the channel's ordering silently. Swing
   (ChannelPanel.importChannel) merges them into the global dependency set and
   PUTs it, which is what mergeChannelDependencies below does.

   The elements are stripped either way: the engine ignores them, and leaving
   them in the uploaded XML would contradict the set we are about to PUT. */
function takeDependencyEdges(channelEl: any, channelId: any) {
    const holder = (tag: any) => channelEl.querySelector(`:scope > exportData > ${tag}`);
    const idsIn = (tag: any) => {
        const el = holder(tag);
        return el ? [...el.children].filter((c: any) => c.tagName === 'string')
            .map((c: any) => String(c.textContent || '').trim()).filter(Boolean) : [];
    };
    const dependencyIds = idsIn('dependencyIds');
    const dependentIds = idsIn('dependentIds');
    for (const tag of ['dependencyIds', 'dependentIds']) {
        const el = holder(tag);
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
    return [
        ...dependencyIds.map((id: any) => ({ dependentId: String(channelId), dependencyId: id })),
        ...dependentIds.map((id: any) => ({ dependentId: id, dependencyId: String(channelId) }))
    ].filter(e => e.dependentId !== e.dependencyId);
}

// A multi-channel import cannot finalize an edge when only one endpoint has
// been collision-resolved. Defer the dependency PUT until every source id has
// a final target id, then rewrite BOTH sides of every edge.
function rewriteDependencyEdges(edges: any[], resolvedIds: Map<any, any>) {
    return edges.map(edge => ({
        dependentId: String(resolvedIds.get(String(edge.dependentId)) || edge.dependentId),
        dependencyId: String(resolvedIds.get(String(edge.dependencyId)) || edge.dependencyId)
    })).filter(edge => edge.dependentId !== edge.dependencyId);
}

function importedIdentity(result: any) {
    const { sourceId: _sourceId, dependencyEdges: _dependencyEdges, ...identity } = result;
    return identity;
}

/* Add edges to the server's dependency set, keeping what is already there.
   Edges naming a channel that isn't on this server yet are kept rather than
   dropped: a group import creates its channels one at a time, so an edge
   between two of them is dangling until the second one lands. The merge is
   additive and keyed, so importing in any order converges on the same set. */
async function mergeChannelDependencies(edges: any[]) {
    if (!edges.length) return;
    const key = (d: any) => `${d.dependentId}|${d.dependencyId}`;
    const existing = await api.server.channelDependencies();
    const merged = new Map(existing.map((d: any) => [key(d), { dependentId: String(d.dependentId), dependencyId: String(d.dependencyId) }]));
    let added = 0;
    for (const e of edges) if (!merged.has(key(e))) { merged.set(key(e), e); added++; }
    if (!added) return;
    await api.server.setChannelDependencies([...merged.values()]);
}

/* Re-point library resource assignments at the target server's resources.

   Channel and connector `resourceIds` are id→name maps. A channel moved between
   servers keeps the source server's resource UUIDs, which mean nothing here, so
   it deploys without its libraries. Swing (Frame.updateResourceNames) re-points
   any id the target doesn't know by matching the resource NAME. An id that
   matches no name is left as-is, as in Swing — the assignment is visibly wrong
   in the editor rather than silently dropped. */
async function remapImportedResourceIds(channelEl: any) {
    const maps = [...channelEl.querySelectorAll('resourceIds')];
    if (!maps.length) return;

    let raw: any;
    try { raw = await api.server.resources(); }
    catch (e: any) {
        toast(`Could not check library resources: ${e.message}. Imported resource assignments were left unchanged.`, 'warn');
        return;
    }
    const resources: any[] = [];
    if (Array.isArray(raw)) resources.push(...raw.filter((o: any) => o && typeof o === 'object'));
    else for (const [className, value] of Object.entries(raw || {})) {
        if (className.startsWith('@')) continue;
        for (const obj of api.asList(value)) if (obj && typeof obj === 'object') resources.push(obj);
    }

    const knownIds = new Set(resources.map((r: any) => String(r.id || '')).filter(Boolean));
    const idByName = new Map<string, string>();
    for (const r of resources) {
        const name = String(r.name ?? '').trim();
        if (name && r.id && !idByName.has(name)) idByName.set(name, String(r.id));
    }

    let remapped = 0;
    const unmatched = new Set<string>();
    for (const map of maps) {
        for (const entry of [...map.children].filter((c: any) => c.tagName === 'entry')) {
            const strings = [...entry.children].filter((c: any) => c.tagName === 'string');
            if (strings.length < 2) continue;
            const id = String(strings[0].textContent || '').trim();
            const name = String(strings[1].textContent || '').trim();
            if (!id || knownIds.has(id)) continue;
            const targetId = idByName.get(name);
            if (targetId) { strings[0].textContent = targetId; remapped++; }
            else unmatched.add(name || id);
        }
    }
    if (remapped) toast(`Re-mapped ${remapped} library resource assignment(s) to this server`);
    if (unmatched.size) {
        toast(`No library resource named ${[...unmatched].map(n => `"${n}"`).join(', ')} on this server — the channel will deploy without it.`, 'warn');
    }
}

// Import ONE channel document: resolve a name/id collision (warn + overwrite or
// rename), handle bundled libraries, then create or overwrite. Returns the final
// channel identity (which may change during collision resolution), or false if the
// user cancelled. `existing` is the current channel list (for collision). `doc`
// must have a <channel> root — it is serialized WHOLE as the upload body, which
// is why a channel lifted out of a <list> gets a document of its own. Group and
// list imports already perform migration confirmation for the enclosing document,
// so they can disable the otherwise-standard per-channel version check.
async function importChannelDoc(doc: any, existing: any, { checkVersion = true, deferDependencies = false }: any = {}) {
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
    const directChild = (tag: any) => [...channelEl.children].find(c => c.tagName === tag);
    const setChild = (tag: any, value: any) => {
        let el = directChild(tag);
        if (!el) { el = doc.createElement(tag); channelEl.appendChild(el!); }
        el!.textContent = value;
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
        if (choice === 'yes') await importLibraryElementsXml(bundled, resolved.id);
    }
    // The engine ignores bundled libraries on create; strip them from the channel.
    if (libsContainer && libsContainer.parentNode) libsContainer.parentNode.removeChild(libsContainer);

    await remapImportedResourceIds(channelEl);
    const dependencyEdges = takeDependencyEdges(channelEl, resolved.id);

    const body = new XMLSerializer().serializeToString(doc);
    if (resolved.overwrite) await api.putXml(`/channels/${encodeURIComponent(resolved.id)}`, body, { override: true });
    else await api.post('/channels', body, { contentType: 'application/xml' });

    const result = { ...resolved, sourceId: String(id), dependencyEdges };
    if (deferDependencies) return result;

    // A dependency PUT that fails must not report the channel upload itself as
    // failed. Multi-channel callers defer this until all identities resolve.
    try { await mergeChannelDependencies(dependencyEdges); }
    catch (e: any) { toast(`Channel imported, but its deploy/start dependencies could not be saved: ${e.message}`, 'warn'); }
    return result;
}

/* Import a channel XML file. Accepts BOTH shapes the engine and the Swing client
   produce: a single <channel> root, and the <list> of <channel> elements that
   GET /channels returns (what our own Export All used to write, and what a Swing
   user gets by feeding the endpoint straight to a file). Every channel in a list
   goes through the single-channel path, so collision resolution, bundled
   libraries, resource re-mapping and dependency edges behave identically.

   Returns the resolved identity for a single channel, an { list, imported,
   skipped } summary for a list, or false when the user cancelled outright. */
async function importChannelXml(xml: any, existing: any, { checkVersion = true, deferDependencies = false }: any = {}): Promise<any> {
    const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
    if (doc.querySelector('parsererror') || !doc.documentElement) throw new Error('Not a valid channel XML file');
    const root = doc.documentElement;
    if (root.nodeName === 'channel') return importChannelDoc(doc, existing, { checkVersion, deferDependencies });
    if (root.nodeName !== 'list') throw new Error('Not a valid channel XML file');

    // XStream stamps the version on the element it serialized as the root, so a
    // <list> carries ONE version for the whole file — prompt for migration here,
    // once, and let the per-channel path skip its own check (as group imports do).
    if (checkVersion) {
        const verdict = checkImportVersion(root.getAttribute('version'), 'channel');
        if (verdict.action === 'block') { await alertInformation(verdict.message); return false; }
        if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return false;
    }
    const channelEls = detachListElements(doc, 'channel');
    if (!channelEls.length) throw new Error('No <channel> elements found in the file');

    /* Collisions are resolved against the channels already on the server PLUS the
       ones this file has just created — a list may well contain two channels with
       the same name, and the second must not silently overwrite the first.
       Cancelling or failing ONE channel skips it and keeps going: the alternative
       is abandoning a 200-channel import halfway with no way to resume. */
    const known = structuredClone(existing);
    const resolvedIds = new Map<string, string>();
    const dependencyEdges: any[] = [];
    let imported = 0;
    let skipped = 0;
    for (const channelEl of channelEls) {
        const single = doc.implementation.createDocument(null, null, null);
        single.appendChild(single.importNode(channelEl, true));
        let resolved: any;
        try {
            resolved = await importChannelDoc(single, known, { checkVersion: false, deferDependencies: true });
        } catch (e: any) {
            toast(`Could not import channel: ${e.message}`, 'warn');
            skipped++;
            continue;
        }
        if (resolved === false) { skipped++; continue; }
        imported++;
        resolvedIds.set(String(resolved.sourceId), String(resolved.id));
        dependencyEdges.push(...resolved.dependencyEdges);
        const identity = importedIdentity(resolved);
        const match = known.find((c: any) => c.id === identity.id);
        if (match) Object.assign(match, identity);
        else known.push(identity);
    }
    try { await mergeChannelDependencies(rewriteDependencyEdges(dependencyEdges, resolvedIds)); }
    catch (e: any) { toast(`Channels imported, but their deploy/start dependencies could not be saved: ${e.message}`, 'warn'); }
    return { list: true, imported, skipped };
}

// Merge bundled libraries into the existing server set (port of
// ChannelPanel.importChannel): dedupe code templates by id, union the
// enabled/disabled channel ids, and ensure the imported channel is enabled.
function mergeImportedLibraries(existing: any, imported: any, channelId: any) {
    const templatesOf = (lib: any) => api.asList(lib.codeTemplates, 'codeTemplate').filter(t => t && t.id);
    const stringsOf = (v: any) => api.asList(v, 'string').map(String);
    const byId = new Map(existing.map((l: any) => [l.id, l]));
    const seen = new Set();
    for (const lib of existing) for (const t of templatesOf(lib)) seen.add(t.id);

    for (const lib of imported) {
        if (!lib || !lib.id) continue;
        const match = byId.get(lib.id);
        if (match) {
            const merged = templatesOf(match).slice();
            for (const t of templatesOf(lib)) if (seen.add(t.id)) merged.push(t);
            (match as any).codeTemplates = { codeTemplate: merged };
            const enabled = new Set([...stringsOf((match as any).enabledChannelIds), ...stringsOf(lib.enabledChannelIds), channelId]);
            const disabled = new Set([...stringsOf((match as any).disabledChannelIds), ...stringsOf(lib.disabledChannelIds)]);
            for (const id of enabled) disabled.delete(id);
            (match as any).enabledChannelIds = { string: [...enabled] };
            (match as any).disabledChannelIds = { string: [...disabled] };
        } else {
            const tpls: any[] = [];
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
function isEnabled(channel: any) {
    return channel?.exportData?.metadata?.enabled !== false;
}

function isInvalid(channel: any) {
    return String(channel?.['@class'] || '').includes('InvalidChannel');
}

function tagColor(tag: any) {
    const c = tag?.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined && c.green !== undefined && c.blue !== undefined) {
        return `rgba(${c.red}, ${c.green}, ${c.blue}, 0.26)`;
    }
    return null;
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
    const [tags, setTags] = useState([] as any[]);
    const [groups, setGroups] = useState([] as any[]);
    const [statusById, setStatusById] = useState({} as any);        // channelId -> dashboardStatus
    // Set when a secondary load (groups/tags/states) failed while the channel
    // list itself succeeded — the view still works, but it is not showing
    // everything, and that has to be visible.
    const [partialLoadError, setPartialLoadError] = useState<any>(null);
    const [selected, setSelected] = useState(() => new Set());   // channel ids
    const lastClickedRef = useRef<any>(null);                     // shift-range anchor (interaction-only)
    const [lastGroupId, setLastGroupId] = useState<any>(null);    // last-clicked group row (for Delete Group)
    const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());   // group ids (default expanded)
    const [filterText, setFilterText] = useState('');

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

    // Channel name + tag chips. The depth indent + twisty are supplied by the
    // TreeTable tree column, so (unlike the legacy) no manual paddingLeft here.
    function nameCell(channel: any) {
        const chips = channelTags(channel);
        // Single line, never wrapping: the name always shows in full; extra tags
        // run out to the edge of the (fixed-layout) Name column and clip there via
        // the cell's own overflow:hidden — no premature inner width cap.
        return (
            <span className="inline-flex items-center gap-1.5 flex-nowrap align-middle">
                <span className="shrink-0">{channel.name || ''}</span>
                {chips.length
                    ? <span className="inline-flex gap-1.5 flex-nowrap">
                        {chips.map((tag: any) => {
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
        contextMenu(e.clientX, e.clientY, [
            { label: 'Refresh', icon: 'refresh', task: 'doRefreshChannels', group: 'channel', onClick: () => refresh() },
            '-',
            { label: 'New Channel', icon: 'plus', task: 'doNewChannel', group: 'channel', onClick: () => newTask() },
            { label: 'Import Channel', icon: 'import', task: 'doImportChannel', group: 'channel', onClick: () => importTask() },
            { label: 'Export All Channels', icon: 'export', task: 'doExportAllChannels', group: 'channel', onClick: () => exportAllTask() },
            '-',
            { label: 'New Group', icon: 'plus', task: 'doNewGroup', group: 'channelGroup', onClick: () => newGroupTask() },
            { label: 'Import Group', icon: 'import', task: 'doImportGroup', group: 'channelGroup', onClick: () => importGroupTask() },
            { label: 'Export All Groups', icon: 'export', task: 'doExportAllGroups', group: 'channelGroup', onClick: () => exportGroupsTask() }
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
                { label: 'Export Group', icon: 'export', task: 'doExportGroup', group: 'channelGroup', hidden: !isRealGroup, onClick: () => exportGroupTask(group) },
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
        // Full Swing channelPopupMenu (ChannelPanel) — the whole Channel Tasks list.
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
            { label: 'Deploy Channel', icon: 'deploy', task: 'doDeployChannel', group: 'channel', onClick: () => deployTask(rows) },
            { label: 'Enable Channel', icon: 'check', task: 'doEnableChannel', group: 'channel', onClick: () => setEnabledTask(true, rows) },
            { label: 'Disable Channel', icon: 'x', task: 'doDisableChannel', group: 'channel', onClick: () => setEnabledTask(false, rows) },
            '-',
            { label: 'Clone Channel', icon: 'copy', task: 'doCloneChannel', group: 'channel', onClick: () => cloneTask(rows) },
            { label: 'Export Channel', icon: 'export', task: 'doExportChannel', group: 'channel', onClick: () => exportTask(rows) },
            { label: 'Move to Group…', icon: 'folder', task: 'doAssignChannelToGroup', group: 'channelGroup', onClick: () => moveToGroupTask(rows) },
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

    function visibleChannelIds() {
        return groupedChannels()
            .filter(g => !collapsedGroups.has(g.id))
            .flatMap(g => [...g.channels]
                .filter(matchesFilter)
                .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                .map(c => c.id));
    }

    /* ---- data --------------------------------------------------------------- */

    /* Reads nothing (only fetches + functional setState), so the mount-captured
       channels:changed listener can safely call the first render's closure. */
    async function refresh() {
        try {
            /* The three secondary loads used to swallow their failure into an empty
               list, so a 403 for a restricted user or a 500 rendered as "this
               server has no groups / no tags / no deployed channels" — wrong
               answers that look exactly like right ones. Keep the view usable on
               whichever ones did load, and say which did not. The global 401
               handler fires ahead of these, so session expiry is not what lands
               here; 403 and 5xx are. */
            const failures: string[] = [];
            const orEmpty = (label: string) => (e: any) => {
                failures.push(`${label} (${e?.message || e})`);
                return [] as any[];
            };
            const [channelList, groupList, tagList, statusList] = await Promise.all([
                api.channels.list(),
                api.channelGroups.list().catch(orEmpty('groups')),
                api.server.channelTags().catch(orEmpty('tags')),
                api.status.list().catch(orEmpty('channel states'))
            ]);
            setPartialLoadError(failures.length ? `Could not load ${failures.join(', ')}.` : null);
            const nextChannels = channelList.filter(c => c && c.id);
            const nextGroups = groupList.filter(g => g && g.id);
            const byId: any = {};
            for (const st of statusList) {
                if (st && st.channelId) byId[st.channelId] = st;
            }
            setChannels(nextChannels);
            setGroups(nextGroups);
            setTags(tagList);
            setStatusById(byId);
            // Prune a selection the reload invalidated (channel/group deleted).
            const ids = new Set(nextChannels.map(c => c.id));
            setSelected(prev => {
                const next = new Set([...prev].filter((id: any) => ids.has(id)));
                return next.size === prev.size ? prev : next;
            });
            setLastGroupId((prev: any) => (prev && prev !== DEFAULT_GROUP_ID && !nextGroups.some(g => g.id === prev) ? null : prev));
        } catch (e: any) {
            toast(e.message, 'error');
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
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                // XML export — name/id collision flow + bundled libraries. A
                // <list> file imports every channel in it, so it reports a tally
                // (some may have been cancelled or failed) rather than a name.
                const result = await importChannelXml(content, channels);
                if (result === false) return;
                if (result.list) {
                    toast(`Imported ${result.imported} channel(s) from ${file.name}`
                        + (result.skipped ? `, skipped ${result.skipped}` : ''),
                        result.imported ? undefined : 'warn');
                    refresh();
                    return;
                }
            } else {
                let obj = JSON.parse(content);
                if (obj && typeof obj === 'object' && obj.channel) obj = obj.channel;
                const resolved = await resolveImportName(obj.name || '', obj.id || '', channels);
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
                        await saveImportedLibraries(existing, bundled, obj.id);
                    }
                }
                // Libraries are saved separately; strip them before saving the channel.
                if (obj.exportData) delete obj.exportData.codeTemplateLibraries;
                if (resolved.overwrite) await api.channels.update(obj.id, obj);
                else await api.channels.create(obj);
            }
            toast(`Imported ${file.name}`);
            refresh();
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    /* Exports use the engine's own XStream XML (Accept: application/xml) so the
       files are interchangeable with the Swing Administrator. The engine bundles
       the channel's code template libraries into exportData when asked
       (includeCodeTemplateLibraries) — same format the Swing client produces. */
    async function exportTask(rows: any) {
        const channel = requireSingle(rows);
        if (!channel) return;
        // Ask up front (before the save dialog) whether to bundle code template
        // libraries — only when the channel actually has linked ones. saveFile
        // falls back to a normal download if the native picker can't engage
        // outside the click gesture.
        const includeLibs = await promptIncludeLibraries(channel.id);
        if (includeLibs === null) return;   // cancelled the export
        try {
            await saveFile(`${channel.name || channel.id}.xml`, 'application/xml',
                () => api.getXml(`/channels/${channel.id}`, includeLibs ? { includeCodeTemplateLibraries: true } : undefined));
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    /* Export All writes ONE FILE PER CHANNEL into a ZIP. The engine's combined
       <list> we used to save is a document no importer deserializes — Swing
       reads a single Channel, and our own Import Channel rejected the file it
       had just written. Swing's Export All picks a directory and drops a file
       per channel into it; a ZIP is the browser's version of that directory. */
    async function exportAllTask() {
        if (!channels.length) { toast('No channels to export', 'warn'); return; }
        const includeLibs = await promptIncludeLibraries(channels.map((c: any) => c.id));
        if (includeLibs === null) return;   // cancelled the export
        try {
            await saveFile('channels.zip', 'application/zip', async () => {
                // Serializing every channel takes the engine minutes on a big
                // server — no client ceiling (timeoutMs: null).
                const xml = await api.getXml('/channels',
                    includeLibs ? { includeCodeTemplateLibraries: true } : undefined, { timeoutMs: null });
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Engine returned invalid channel XML');
                const els = detachListElements(doc, 'channel');
                if (!els.length) throw new Error('No channels to export');
                const zip = createZip();
                const used = new Set<string>();
                for (const el of els) {
                    const child = (tag: any) => [...el.children].find((c: any) => c.tagName === tag)?.textContent;
                    zip.add(exportEntryName(child('name'), child('id'), used),
                        new XMLSerializer().serializeToString(el));
                }
                return zip.blob();
            });
        } catch (e: any) {
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
            const selectedIds = rows.map((channel: any) => channel.id);
            const nameById = new Map(channels.map((channel: any) => [String(channel.id), channel.name]));
            const targets = await withDependencies(
                selectedIds,
                'dependencies',
                'Deploy',
                (id: any) => nameById.get(String(id)) || id
            );
            if (targets === null) return;
            await api.engine.deployMany(targets);
            // Move to the Dashboard to watch deployment (matches Swing).
            toast(targets.length === 1 ? `Deploying ${rows[0].name}` : `Deploying ${targets.length} channels`);
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

    /* Group MUTATIONS build on the latest-known group list, not a render-time
       snapshot: bulkUpdate replaces the whole set, so acting on a stale copy
       could resurrect a deleted group. The mirror tracks state each render and
       is read only at mutation time (the legacy ref semantics, scoped down). */
    const groupsNowRef = useRef(groups);
    groupsNowRef.current = groups;

    /* Move channels between groups (used by the modal task and drag/drop).
       targetId DEFAULT_GROUP_ID means "remove from all groups". */
    async function moveChannelsToGroup(ids: any, targetId: any) {
        const updated = structuredClone(groupsNowRef.current);
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
        const updated = structuredClone(groupsNowRef.current);
        updated.push({ id: uuid(), name: name.trim(), revision: 0, description: '', channels: null });
        try {
            await api.channelGroups.bulkUpdate(updated, []);
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
        const remaining = structuredClone(groupsNowRef.current.filter(x => x.id !== group.id));
        try {
            await api.channelGroups.bulkUpdate(remaining, [group.id]);
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
                        const updated = structuredClone(groupsNowRef.current);
                        const target = updated.find(g => g.id === group.id);
                        target.name = name;
                        target.description = (descArea as any).value;
                        try {
                            await api.channelGroups.bulkUpdate(updated, []);
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
            const embeddedChannels = [...el.querySelectorAll(':scope > channels > channel')]
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
        const file = await pickFile('.xml');
        if (!file) return;
        try {
            // Swing promptObjectMigration("group"): block newer exports, confirm
            // conversion of older/unknown ones.
            const verdict = checkImportVersionFromDoc(
                new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml'), 'group');
            if (verdict.action === 'block') { await alertInformation(verdict.message); return; }
            if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return;
            const parsed = parseGroupXml(file.content);
            const knownChannels = structuredClone(channels);
            const resolvedChannelIds = new Map();
            const dependencyEdges: any[] = [];
            const imported = [];

            // Match Swing's ChannelPanel.importGroup ordering: import every full
            // channel first, then save the group set using the final IDs produced
            // by channel name/id collision handling. ID-only channel entries are
            // already-existing membership references and do not need re-importing.
            for (const { group, embeddedChannels } of parsed) {
                const refs = [];
                for (const embedded of embeddedChannels) {
                    let finalId = resolvedChannelIds.get(embedded.id) || embedded.id;
                    if (embedded.isDefinition && !resolvedChannelIds.has(embedded.id)) {
                        const resolved = await importChannelXml(embedded.xml, knownChannels, {
                            checkVersion: false,
                            deferDependencies: true
                        });
                        if (resolved === false) return;
                        finalId = resolved.id;
                        resolvedChannelIds.set(embedded.id, finalId);
                        dependencyEdges.push(...resolved.dependencyEdges);

                        const identity = importedIdentity(resolved);
                        const existing = knownChannels.find((channel: any) => channel.id === finalId);
                        if (existing) Object.assign(existing, identity);
                        else knownChannels.push(identity);
                    }
                    refs.push({ id: finalId });
                }
                group.channels = refs.length ? { channel: refs } : null;
                imported.push(group);
            }
            try {
                await mergeChannelDependencies(rewriteDependencyEdges(dependencyEdges, resolvedChannelIds));
            } catch (e: any) {
                toast(`Channels imported, but their deploy/start dependencies could not be saved: ${e.message}`, 'warn');
            }
            const importedIds = new Set(imported.map(g => g.id));
            const importedChannelIds = new Set(imported.flatMap(g =>
                api.asList(g.channels, 'channel').map(ref => ref.id)));
            // Replace same-id groups and pull imported channels out of other
            // groups (a channel may only belong to one group).
            const updated = structuredClone(groupsNowRef.current.filter(g => !importedIds.has(g.id)));
            for (const group of updated) {
                const members = api.asList(group.channels, 'channel')
                    .filter(ref => ref && ref.id && !importedChannelIds.has(ref.id));
                group.channels = members.length ? { channel: members } : null;
            }
            await api.channelGroups.bulkUpdate(updated.concat(imported), []);
            toast(`Imported ${imported.length} group(s) from ${file.name}`);
            refresh();
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    /* GET /channelgroups returns membership references, while Swing's exported
       ChannelGroup contains complete Channel objects. Hydrate those references
       from GET /channels so an export can recreate both the group and its
       channels when imported on another server. Returns the ready-to-serialize
       <channelGroup> elements (one file each), all of them or just `groupId`. */
    async function hydratedGroupElements(groupId?: any, includeLibs?: any) {
        const groupsXml = await api.getXml('/channelgroups', undefined, { timeoutMs: null });
        const groupsDoc = new DOMParser().parseFromString(groupsXml, 'text/xml');
        if (groupsDoc.querySelector('parsererror')) throw new Error('Engine returned invalid channel group XML');

        const allGroups = detachListElements(groupsDoc, 'channelGroup');
        const exportGroups = groupId == null
            ? allGroups
            : allGroups.filter(groupEl =>
                [...groupEl.children].find(c => c.tagName === 'id')?.textContent === groupId);
        if (groupId != null && !exportGroups.length) throw new Error('Channel group not found in the engine XML');

        const refsByGroup = new Map<any, { container: any; refs: string[] }>();
        const channelIds = new Set<string>();
        for (const groupEl of exportGroups) {
            const container = [...groupEl.children].find(c => c.tagName === 'channels');
            const refs = container
                ? [...container.children]
                    .filter(c => c.tagName === 'channel')
                    .map(c => [...c.children].find(x => x.tagName === 'id')?.textContent || '')
                    .filter(Boolean)
                : [];
            refsByGroup.set(groupEl, { container, refs });
            refs.forEach(id => channelIds.add(id));
        }

        const channelById = new Map<string, Element>();
        if (channelIds.size) {
            const params: any = { channelId: [...channelIds] };
            if (includeLibs) params.includeCodeTemplateLibraries = true;
            const channelsXml = await api.getXml('/channels', params, { timeoutMs: null });
            const channelsDoc = new DOMParser().parseFromString(channelsXml, 'text/xml');
            if (channelsDoc.querySelector('parsererror')) throw new Error('Engine returned invalid channel XML');
            for (const channelEl of detachListElements(channelsDoc, 'channel')) {
                const id = [...channelEl.children].find(c => c.tagName === 'id')?.textContent;
                if (id) channelById.set(id, channelEl);
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
                if (channelEl) container.appendChild(groupsDoc.importNode(channelEl, true));
            }
        }

        return exportGroups;
    }

    // The channels a group export will carry, for the "include libraries?" prompt.
    const groupChannelIds = (list: any[]) => list.flatMap((g: any) =>
        api.asList(g.channels, 'channel').map((ref: any) => ref && ref.id).filter(Boolean));

    async function exportGroupTask(g: any) {
        const group = requireGroup(g);
        if (!group) return;
        // Swing asks about bundling linked libraries for a GROUP export too — the
        // group's channels are exported whole, so they carry (or don't) the same
        // exportData the single-channel export does.
        const includeLibs = await promptIncludeLibraries(groupChannelIds([group]));
        if (includeLibs === null) return;
        try {
            await saveFile(`${group.name || group.id}.xml`, 'application/xml', async () => {
                const els = await hydratedGroupElements(group.id, includeLibs);
                return new XMLSerializer().serializeToString(els[0]);
            });
        } catch (e: any) {
            toast(e.message, 'error');
        }
    }

    /* Export All Groups, like Export All Channels, writes one file per group into
       a ZIP: a <list> of <channelGroup> is not a document Swing can read back. */
    async function exportGroupsTask() {
        const includeLibs = await promptIncludeLibraries(groupChannelIds(groups));
        if (includeLibs === null) return;
        try {
            await saveFile('channel-groups.zip', 'application/zip', async () => {
                const els = await hydratedGroupElements(undefined, includeLibs);
                if (!els.length) throw new Error('No channel groups to export');
                const zip = createZip();
                const used = new Set<string>();
                for (const el of els) {
                    const child = (tag: any) => [...el.children].find((c: any) => c.tagName === tag)?.textContent;
                    zip.add(exportEntryName(child('name'), child('id'), used),
                        new XMLSerializer().serializeToString(el));
                }
                return zip.blob();
            });
        } catch (e: any) {
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
       Channel Tasks: deployable = a channel selected OR a group row selected;
       Group Tasks: realGroup = a real (non-default) group row selected. */
    const eff = effectiveChannels();
    const channelSel = selected.size > 0;
    const singleChannel = selected.size === 1;
    const deployable = channelSel || !!lastGroupId;
    const showDeploy = deployable;
    const showExport = channelSel;
    const showDelete = channelSel;
    const showClone = singleChannel;
    const showEdit = singleChannel;
    const showEnable = deployable && eff.some((c: any) => !isEnabled(c));
    const showDisable = deployable && eff.some((c: any) => isEnabled(c));
    const showMessages = singleChannel;

    const realGroup = !!lastGroupId && lastGroupId !== DEFAULT_GROUP_ID && groups.some(g => g.id === lastGroupId);
    const currentGroup = realGroup ? groups.find(g => g.id === lastGroupId) : null;
    const showAssign = channelSel;
    const showGroupEdit = realGroup;
    const showGroupExport = realGroup;
    const showGroupDelete = realGroup;

    /* ---- tree data + filter + counts for the <TreeTable> ---- */
    const hasFilter = !!filterText.trim();
    // Group nodes with their (name-sorted) channel children. When there are no
    // channels at all we pass [] so TreeTable shows its empty state (Swing parity:
    // the synthetic Default Group row is not drawn over an empty engine).
    const treeData = channels.length
        ? groupedChannels().map((g: any) => ({
            kind: 'group', id: g.id, group: g,
            // Children are wrapped channel nodes (sorted by name) so getChildren()
            // hands TreeTable the same node shape rowKey/columns/onSelect expect.
            children: [...g.channels]
                .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                .map((channel: any) => ({ kind: 'channel', channel }))
        }))
        : [];
    // Filter: groups don't self-match (legacy filters channels); a group is kept
    // by TreeTable when a descendant channel matches.
    const treeMatches = hasFilter
        ? (n: any) => (n.kind === 'group' ? false : matchesFilter(n.channel))
        : undefined;
    // Collapsed groups, keyed by the channel-tree rowKey ('grp:<id>').
    const collapsedKeys = new Set([...collapsedGroups].map((id: any) => 'grp:' + id));

    // Counts bar: groups shown / channels shown / enabled (after the filter, and
    // dropping empty groups only while filtering — matching the legacy).
    const shownGroups = treeData
        .map((g: any) => ({ group: g.group, channels: g.group.channels.filter((c: any) => !hasFilter || matchesFilter(c)) }))
        .filter((g: any) => g.channels.length > 0 || !hasFilter);
    const shownChannels = shownGroups.flatMap((g: any) => g.channels);
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
                <RailPane title="Group Tasks" paneKey="tasks:Group Tasks" group="channelGroup">
                    <div className="taskbar" data-pane-title="Group Tasks">
                        {showAssign && <TaskButton label="Assign To Group" icon="folder" task="doAssignChannelToGroup" onClick={() => moveToGroupTask(selectedChannels())} />}
                        <TaskButton label="New Group" icon="plus" task="doNewGroup" onClick={newGroupTask} />
                        {showGroupEdit && <TaskButton label="Edit Group Details" icon="edit" task="doEditGroupDetails" onClick={() => editGroupTask(currentGroup)} />}
                        <TaskButton label="Import Group" icon="import" task="doImportGroup" onClick={importGroupTask} />
                        <TaskButton label="Export All Groups" icon="export" task="doExportAllGroups" onClick={exportGroupsTask} />
                        {showGroupExport && <TaskButton label="Export Group" icon="export" task="doExportGroup" onClick={() => exportGroupTask(currentGroup)} />}
                        {showGroupDelete && <TaskButton label="Delete Group" icon="trash" danger task="doDeleteGroup" onClick={() => deleteGroupTask(currentGroup)} />}
                    </div>
                </RailPane>
            </ViewTasks>
            <div className="view-body flush flex flex-col overflow-hidden">
                {partialLoadError && (
                    <div className="mx-[13px] mt-3 text-[11px]" style={{ color: 'var(--err)' }} role="status">
                        {partialLoadError} Groups, tags and channel states may be incomplete.
                    </div>
                )}
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
                        rowDraggable={(n: any) => n.kind === 'channel'}
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
                </div>
            </div>
        </div>
    );
}
