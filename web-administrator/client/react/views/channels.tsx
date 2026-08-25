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
import { checkImportVersion, checkImportVersionFromDoc, checkImportVersionForElements } from '../../core/import-guard.js';
import { alertInformation, assertImportIdentityCurrent, optionYesNo, resolveImportName as resolveImportIdentity } from './import-dialogs.js';
import { ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { TreeTable } from '../tree-table.jsx';
import { Icon } from '../bridges.jsx';
import { platform } from '@oie/web-shell';
import { xmlToJson, needsOverride, verifySaveResult } from './code-template-xml.js';
import { saveChannelDependencyEdits, submitDeployment, withDependencies } from './channel-lifecycle.js';
import { strictWireList } from '../../core/wire-safety.js';


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
    const libs = await api.codeTemplates.libraries(false);
    const idSet = (v: any) => api.asList(v, 'string').map(String);
    const cids = [...new Set(api.asList(channelIds).map(String))];
    return libs.filter(lib => cids.some(cid =>
        idSet(lib.enabledChannelIds).includes(cid) ||
        (lib.includeNewChannels === true && !idSet(lib.disabledChannelIds).includes(cid))))
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

/* Split an engine <list> response into standalone per-object elements.
   XStream stamps the version attribute on each OBJECT it serializes, so the
   children already carry theirs and the <list> wrapper carries none (verified
   against a 4.6.0 engine for channels, groups, alerts and code templates alike).
   The copy-down below is therefore a no-op on engine output; it exists for a
   hand-written or hand-merged list whose children lost their stamp, which would
   otherwise read as "unknown version" and prompt for migration on import. */
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

async function readCurrentChannelIdentities(rendered: any[] = []) {
    const wire: any = await api.channels.idsAndNames();
    const byId = new Map(rendered.map((channel: any) => [String(channel.id), channel]));
    const entries = strictWireList<any>(wire, 'entry', 'current channel identity list');
    const out: any[] = [];
    for (const entry of entries) {
        const pair = api.asList((entry as any)?.string);
        if (pair.length < 2 || !String(pair[0] || '') || !String(pair[1] || '')) {
            throw new Error('the current channel identity list could not be verified — import cancelled');
        }
        const id = String(pair[0]);
        out.push({ id, name: String(pair[1]), revision: (byId.get(id) as any)?.revision ?? 0 });
    }
    return out;
}

// Group identity clashes get the same explicit decision channels get.
const GROUP_IMPORT_RULES = { title: 'Import Group', noun: 'Group' };

// Bundled libraries are a multi-object write: the rewritten library references
// and every new full template must land in the same _bulkUpdate request, whose
// per-object results are verified. Takes SETS ({libraries, channelId}) so a
// group import saves once for every embedded channel instead of once each.
async function saveImportedLibraries(existing: any, sets: { libraries: any[], channelId: any }[]) {
    const version = store.getState('serverVersion') || '4.5.2';
    const templatesOf = (lib: any) => api.asList(lib.codeTemplates, 'codeTemplate')
        .filter((template: any) => template && typeof template === 'object' && template.id);
    const existingLibraryRevisions = new Map(existing
        .filter((library: any) => library?.id)
        .map((library: any) => [String(library.id), library.revision]));
    const existingTemplateById = new Map<string, any>(existing.flatMap(templatesOf).map((template: any) => [String(template.id), template]));

    /* An imported template whose id already exists here with DIFFERENT code is
       an identity collision, not a duplicate. Keeping the target's body silently
       links the channel to unrelated code; overwriting silently swaps the body
       under every channel already using it. Swing forces the decision
       (CodeTemplateImportDialog) — so do we, once per import. */
    const signature = (template: any) => JSON.stringify({ n: template.name, p: template.properties });
    const incomingById = new Map<string, string>();
    const conflictsById = new Map<string, any>();
    for (const set of sets) for (const library of set.libraries) for (const tpl of templatesOf(library)) {
        const id = String(tpl.id);
        const body = signature(tpl);
        const prior = incomingById.get(id);
        if (prior !== undefined && prior !== body) {
            throw new Error(`Bundled code template ${tpl.name || id} has conflicting definitions under the same id`);
        }
        incomingById.set(id, body);
        const current = existingTemplateById.get(id);
        if (current && signature(current) !== body) conflictsById.set(id, tpl);
    }
    const conflicts = [...conflictsById.values()];
    if (conflicts.length) {
        const choice = await new Promise<any>(resolve => modal({
            title: 'Import Code Templates',
            body: h('div',
                h('div.mb-[13px]', `${conflicts.length} bundled code template(s) already exist on this server with different code:`),
                h('ul', { class: 'mb-[13px] pl-[18px] list-disc max-h-[180px] overflow-auto' },
                    conflicts.map((t: any) => h('li', String(t.name || t.id)))),
                h('div', 'Overwrite the existing code, or import as new copies?')),
            onClose: () => resolve(null),
            buttons: [
                { label: 'Cancel', onClick: () => resolve(null) },
                { label: 'Import as New', onClick: () => resolve('new') },
                { label: 'Overwrite', primary: true, onClick: () => resolve('overwrite') }
            ]
        }));
        if (!choice) throw new Error('Code-template library import cancelled');
        if (choice === 'new') {
            // One source template can be bundled once per channel/library. Mint
            // ONE replacement identity per source id and rewrite every copy;
            // minting per occurrence splits a shared template into duplicates.
            const replacements = new Map<string, string>(
                [...conflictsById.keys()].map(id => [id, uuid()]));
            for (const set of sets) for (const library of set.libraries) for (const tpl of templatesOf(library)) {
                const replacement = replacements.get(String(tpl.id));
                if (replacement) tpl.id = replacement;
            }
        }
    }

    const updatedTemplates: any[] = [];
    const pushedIds = new Set<string>();
    for (const set of sets) for (const library of set.libraries) for (const original of templatesOf(library)) {
        const id = String(original.id);
        if (pushedIds.has(id)) continue;
        const current = existingTemplateById.get(id);
        // Identical body already here → nothing to write. Different body only
        // survives to this point when Overwrite was chosen above.
        if (current && JSON.stringify({ n: current.name, p: current.properties })
            === JSON.stringify({ n: original.name, p: original.properties })) continue;
        pushedIds.add(id);
        const properties = original.properties && typeof original.properties === 'object'
            ? { '@version': original.properties['@version'] || version, ...original.properties }
            : original.properties;
        // A source-server revision has no meaning here: new templates start at
        // the engine's new-object baseline, an overwrite uses the target's own
        // revision as the concurrency guard.
        updatedTemplates.push({ '@version': original['@version'] || version, ...original,
            revision: current ? (Number(current.revision) || 0) : 0, properties });
    }

    let merged = structuredClone(existing);
    for (const set of sets) merged = mergeImportedLibraries(merged, structuredClone(set.libraries), set.channelId);
    const libraryPayload = merged.map((library: any) => {
        const templates = templatesOf(library);
        return {
            '@version': library['@version'] || version,
            ...library,
            revision: existingLibraryRevisions.get(String(library.id)) ?? 0,
            codeTemplates: templates.length
                ? { codeTemplate: templates.map((template: any) => ({ '@version': template['@version'] || version, id: template.id })) }
                : null
        };
    });
    // Use the revisions fetched immediately before this merge as an optimistic
    // concurrency guard. A newer server revision must be acknowledged instead
    // of being silently overwritten just because this is an import path.
    let result: any = await api.codeTemplates.bulkUpdate(libraryPayload, updatedTemplates, [], [], false);
    if (needsOverride(result)) {
        const overwrite = await confirmDialog('Code Template Libraries Modified',
            'One or more code template libraries changed while the channel import was being prepared. Overwrite those newer changes?',
            { danger: true, okLabel: 'Overwrite' });
        if (!overwrite) throw new Error('Code-template library import cancelled — refresh and try again');
        result = await api.codeTemplates.bulkUpdate(libraryPayload, updatedTemplates, [], [], true);
        if (needsOverride(result)) throw new Error('the server still requires an override after confirmation');
    }
    // Same reader as the Code Templates view, hardened: an engine-side failure
    // never reaches the HTTP status, and the engine applies objects one by one
    // with no rollback — every attempted template must be confirmed, and a
    // malformed/empty 200 is an unknown outcome, not a success.
    const failure = verifySaveResult(result, updatedTemplates.map((t: any) => String(t.id)), []);
    if (failure) throw new Error(failure);
}

async function importLibraryElementsXml(bundledEls: any, channelId: any) {
    const existing = await api.codeTemplates.libraries(true);
    await saveImportedLibraries(existing, [{ libraries: bundledEls.map((element: any) => xmlToJson(element)), channelId }]);
}

// The group-import form: every embedded channel's bundled libraries in ONE
// merge and ONE bulk save, after the single prompt.
async function importLibrarySetsXml(sets: { els: any[], channelId: any }[]) {
    const existing = await api.codeTemplates.libraries(true);
    await saveImportedLibraries(existing,
        sets.map(set => ({ libraries: set.els.map((element: any) => xmlToJson(element)), channelId: set.channelId })));
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
    const { sourceId: _sourceId, dependencyEdges: _dependencyEdges, bundledLibraries: _bundledLibraries, ...identity } = result;
    return identity;
}

/* Add edges to the server's dependency set, keeping what is already there.
   Edges naming a channel that isn't on this server yet are kept rather than
   dropped: a group import creates its channels one at a time, so an edge
   between two of them is dangling until the second one lands. The merge is
   additive and keyed, so importing in any order converges on the same set. */
async function mergeChannelDependencies(edges: any[]) {
    if (!edges.length) return;
    // Import edges are additions relative to an empty baseline. The helper
    // re-reads at commit time and overlays only those additions.
    await saveChannelDependencyEdits([], edges);
}

/* Re-point library resource assignments at the target server's resources.

   Channel and connector `resourceIds` are id→name maps. A channel moved between
   servers keeps the source server's resource UUIDs, which mean nothing here, so
   it deploys without its libraries. Swing (Frame.updateResourceNames) re-points
   any id the target doesn't know by matching the resource NAME. An id that
   matches no name is left as-is, as in Swing — the assignment is visibly wrong
   in the editor rather than silently dropped. */
async function loadResourceIndex() {
    let raw: any;
    try { raw = await api.server.resources(); }
    catch (e: any) {
        toast(`Could not check library resources: ${e.message}. Imported resource assignments were left unchanged.`, 'warn');
        return null;
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
    return { knownIds, idByName };
}

// One remap over any representation: each map is its entries as {id, name, set}.
function applyResourceRemap(maps: any[][], idx: any) {
    let remapped = 0;
    const unmatched = new Set<string>();
    for (const entries of maps) {
        // The ids this one holder already assigns. Swing checks this before
        // re-pointing (`!resourceIds.containsKey(resource.getId())`): two entries
        // under one key collapse to one when the engine reads the map back, so a
        // blind remap would DROP an assignment rather than fix one.
        const assigned = new Set(entries.map((en: any) => en.id));
        for (const en of entries) {
            if (!en.id || idx.knownIds.has(en.id)) continue;
            const targetId = idx.idByName.get(en.name);
            if (!targetId) { unmatched.add(en.name || en.id); continue; }
            // Already assigned under its correct id here — the stale duplicate is
            // the engine's to ignore, and nothing is lost by leaving it.
            if (assigned.has(targetId)) continue;
            en.set(targetId);
            assigned.delete(en.id); assigned.add(targetId);
            remapped++;
        }
    }
    if (remapped) toast(`Re-mapped ${remapped} library resource assignment(s) to this server`);
    if (unmatched.size) {
        toast(`No library resource named ${[...unmatched].map(n => `"${n}"`).join(', ')} on this server — the channel will deploy without it.`, 'warn');
    }
}

async function remapImportedResourceIds(channelEl: any) {
    const maps = [...channelEl.querySelectorAll('resourceIds')].map((map: any) =>
        [...map.children].filter((c: any) => c.tagName === 'entry')
            .map((entry: any) => [...entry.children].filter((c: any) => c.tagName === 'string'))
            .filter((strings: any[]) => strings.length >= 2)
            .map((strings: any[]) => ({
                id: String(strings[0].textContent || '').trim(),
                name: String(strings[1].textContent || '').trim(),
                set: (v: string) => { strings[0].textContent = v; }
            })));
    if (!maps.length) return;
    const idx = await loadResourceIndex();
    if (idx) applyResourceRemap(maps, idx);
}

/* The JSON twins. The web editor's own channel export is JSON straight off
   GET /channels/{id}, which carries the same exportData dependency edges and
   resourceIds maps as the XML export — importing a .json must not lose what
   the XML path preserves. */

function jsonResourceMaps(node: any, out: any[] = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { for (const item of node) jsonResourceMaps(item, out); return out; }
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@')) continue;
        if (key === 'resourceIds' && value && typeof value === 'object') {
            out.push(api.asList((value as any).entry)
                .filter((en: any) => en && Array.isArray(en.string) && en.string.length >= 2)
                .map((en: any) => ({
                    id: String(en.string[0] ?? '').trim(),
                    name: String(en.string[1] ?? '').trim(),
                    set: (v: string) => { en.string[0] = v; }
                })));
        } else {
            jsonResourceMaps(value, out);
        }
    }
    return out;
}

async function remapImportedResourceIdsJson(channel: any) {
    const maps = jsonResourceMaps(channel).filter((entries: any[]) => entries.length);
    if (!maps.length) return;
    const idx = await loadResourceIndex();
    if (idx) applyResourceRemap(maps, idx);
}

function takeDependencyEdgesJson(channel: any, channelId: any) {
    const ex = channel && channel.exportData;
    if (!ex || typeof ex !== 'object') return [];
    const ids = (v: any) => api.asList(v, 'string').map((s: any) => String(s).trim()).filter(Boolean);
    const dependencyIds = ids(ex.dependencyIds);
    const dependentIds = ids(ex.dependentIds);
    delete ex.dependencyIds;
    delete ex.dependentIds;
    return [
        ...dependencyIds.map((id: any) => ({ dependentId: String(channelId), dependencyId: id })),
        ...dependentIds.map((id: any) => ({ dependentId: id, dependencyId: String(channelId) }))
    ].filter(e => e.dependentId !== e.dependencyId);
}

// Import ONE channel document: resolve a name/id collision (warn + overwrite or
// rename), handle bundled libraries, then create or overwrite. Returns the final
// channel identity (which may change during collision resolution), or false if the
// user cancelled. `existing` is the current channel list (for collision). `doc`
// must have a <channel> root — it is serialized WHOLE as the upload body, which
// is why a channel lifted out of a <list> gets a document of its own. Group and
// list imports already perform migration confirmation for the enclosing document,
// so they can disable the otherwise-standard per-channel version check.
async function importChannelDoc(doc: any, existing: any, { checkVersion = true, deferDependencies = false, deferLibraries = false, presetIdentity = null }: any = {}) {
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

    // A group import resolves every identity BEFORE anything is created (its
    // decisions phase) and hands the result in here.
    const resolved = presetIdentity || await resolveImportName(name, id, existing);
    if (!resolved) return false;

    // Validate before any bundled-library side effect, then again immediately
    // before the channel request below (the library dialog/save can itself take
    // long enough for the target identity to change).
    assertImportIdentityCurrent(resolved, await readCurrentChannelIdentities(existing), CHANNEL_IMPORT_RULES);

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
    let bundledLibraries: any[] = [];
    if (bundled.length) {
        if (deferLibraries) {
            // A group import prompts ONCE for the whole file and saves once —
            // hand the (already id-re-pointed) elements back to the caller.
            bundledLibraries = bundled.map((el: any) => el.cloneNode(true));
        } else {
            const choice = await promptImportLibraries(resolved.name, bundled.length);
            if (choice === 'cancel') return false;
            if (choice === 'yes') await importLibraryElementsXml(bundled, resolved.id);
        }
    }
    // The engine ignores bundled libraries on create; strip them from the channel.
    if (libsContainer && libsContainer.parentNode) libsContainer.parentNode.removeChild(libsContainer);

    await remapImportedResourceIds(channelEl);
    const dependencyEdges = takeDependencyEdges(channelEl, resolved.id);

    /* The endpoint's contract is an explicit boolean: FALSE is a server-side
       conflict the collision dialog could not see, and anything that is not
       TRUE (empty, malformed) is an unknown outcome — neither may report as an
       import. */
    const body = new XMLSerializer().serializeToString(doc);
    assertImportIdentityCurrent(resolved, await readCurrentChannelIdentities(existing), CHANNEL_IMPORT_RULES);
    const accepted = resolved.overwrite
        ? await api.putXml(`/channels/${encodeURIComponent(resolved.id)}`, body, { override: true })
        : await api.post('/channels', body, { contentType: 'application/xml' });
    if (String(accepted) === 'false') {
        throw new Error(`the engine rejected channel "${resolved.name}" (a conflicting channel may already exist there)`);
    }
    if (String(accepted) !== 'true') {
        throw new Error(`the engine did not confirm channel "${resolved.name}" — the import may not have been applied; Refresh before retrying`);
    }

    const result = { ...resolved, sourceId: String(id), dependencyEdges, bundledLibraries };
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
async function importChannelXml(xml: any, existing: any, { checkVersion = true, deferDependencies = false, deferLibraries = false }: any = {}): Promise<any> {
    const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
    if (doc.querySelector('parsererror') || !doc.documentElement) throw new Error('Not a valid channel XML file');
    const root = doc.documentElement;
    if (root.nodeName === 'channel') return importChannelDoc(doc, existing, { checkVersion, deferDependencies, deferLibraries });
    if (root.nodeName !== 'list') throw new Error('Not a valid channel XML file');

    const channelEls = detachListElements(doc, 'channel');
    if (!channelEls.length) throw new Error('No <channel> elements found in the file');

    /* Migration gate once for the whole file, and let the per-channel path skip
       its own check (as group imports do). The versions live on the <channel>
       children, NOT on the <list>: XStream stamps each object it serializes and
       the list wrapper the engine emits carries none. Reading the root saw
       "unknown" every time, so importing a list this very engine had just
       exported always asked to convert it. */
    if (checkVersion) {
        const verdict = checkImportVersionForElements(channelEls, 'channel');
        if (verdict.action === 'block') { await alertInformation(verdict.message); return false; }
        if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return false;
    }

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
        const refreshEpoch = ++groupsRefreshEpochRef.current;
        // A whole-set mutation must not race the initial/replacement baseline.
        // The lock is cleared only after a validated group result is committed
        // below; a different Promise.all member failing must leave it locked.
        groupsLoadFailedRef.current = true;
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
                // The failure is not merely rendered (the banner below) — it also
                // LOCKS group mutations, which rebuild the complete set and would
                // otherwise rebuild it from this empty stand-in (see saveGroups).
                api.get('/channelgroups')
                    .then((raw: any) => {
                        /* STRICT: '' is the engine's real empty <list>. Anything
                           else must carry channelGroup, or this load FAILED — a
                           malformed {} read as "no groups" arms the full-set
                           rebuild that deletes every existing group (and the
                           Overwrite retry would commit it). */
                        const decoded = strictWireList<any>(raw, 'channelGroup', 'channel group list');
                        const ids = new Set<string>();
                        const names = new Set<string>();
                        const memberOwners = new Map<string, string>();
                        for (const group of decoded) {
                            if (!group || typeof group !== 'object'
                                || typeof group.id !== 'string' || !group.id.trim() || ids.has(group.id)
                                // Swing checks blank names before
                                // updateChannelGroups, while the typed model
                                // always carries the persisted revision.
                                || typeof group.name !== 'string' || !group.name.trim() || names.has(group.name)
                                || !Number.isInteger(group.revision) || group.revision < 1) {
                                throw new Error('the engine returned an unusable channel group list');
                            }
                            ids.add(group.id);
                            names.add(group.name);

                            /* Swing receives List<ChannelGroup>, and every
                               ChannelGroup owns a typed List<Channel>. Its
                               whole-set save therefore cannot reinterpret a
                               malformed membership object as an empty list.
                               Match that guarantee before this response becomes
                               the baseline for updateChannelGroups. '' is the
                               real empty <channels/> representation; every
                               non-empty wrapper must contain id-bearing channel
                               references, with the server's one-group-per-channel
                               invariant intact. */
                            const members = strictWireList<any>(group.channels, 'channel', 'channel group membership list');
                            for (const member of members) {
                                if (!member || typeof member !== 'object' || Array.isArray(member)
                                    || typeof member.id !== 'string' || !member.id.trim()
                                    || memberOwners.has(member.id)) {
                                    throw new Error('the engine returned an unusable channel group list');
                                }
                                memberOwners.set(member.id, group.id);
                            }
                        }
                        return decoded;
                    })
                    .catch((e: any) => { orEmpty('groups')(e); return null as any[] | null; }),
                api.server.channelTags().catch(orEmpty('tags')),
                api.status.list().catch(orEmpty('channel states'))
            ]);
            // Overlapping event/manual refreshes may finish out of order. Only
            // the latest one may become the whole-set mutation baseline.
            if (refreshEpoch !== groupsRefreshEpochRef.current) return;
            setPartialLoadError(failures.length ? `Could not load ${failures.join(', ')}.` : null);
            const nextChannels = channelList.filter(c => c && c.id);
            // A successful group read was validated member-by-member above.
            // Never silently thin the complete-set baseline before saveGroups.
            const nextGroups = groupList || [];
            const byId: any = {};
            for (const st of statusList) {
                if (st && st.channelId) byId[st.channelId] = st;
            }
            setChannels(nextChannels);
            if (groupList !== null) {
                // Keep the action-time mirror and lock in sync even before
                // React commits the state update on the next render.
                groupsNowRef.current = nextGroups;
                groupsLoadFailedRef.current = false;
            }
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
            if (refreshEpoch === groupsRefreshEpochRef.current) toast(e.message, 'error');
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

    /* Collision resolution must see the server's CURRENT channels, not this
       render's: an import decided against a stale list silently overwrites
       whatever appeared since. idsAndNames is the cheap authoritative read;
       revisions ride along from the rendered copy when available (only the
       overwrite path reads them, and its PUT carries override). */
    async function freshChannelIdentities() {
        return readCurrentChannelIdentities(channels);
    }

    async function importTask() {
        const file = await pickFile('.xml,.json');
        if (!file) return;
        try {
            const known = await freshChannelIdentities();
            const content = String(file.content || '').trim();
            if (content.startsWith('<')) {
                // XML export — name/id collision flow + bundled libraries. A
                // <list> file imports every channel in it, so it reports a tally
                // (some may have been cancelled or failed) rather than a name.
                const result = await importChannelXml(content, known);
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
                // Same version gate as the XML path — the .json extension must
                // not bypass it. Engine JSON carries the stamp as '@version'.
                const verdict = checkImportVersion(obj['@version'], 'channel');
                if (verdict.action === 'block') { await alertInformation(verdict.message); return; }
                if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return;
                const resolved = await resolveImportName(obj.name || '', obj.id || '', known);
                if (!resolved) return;   // cancelled
                assertImportIdentityCurrent(resolved, await freshChannelIdentities(), CHANNEL_IMPORT_RULES);
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
                        await saveImportedLibraries(existing, [{ libraries: bundled, channelId: obj.id }]);
                    }
                }
                // Libraries are saved separately; strip them before saving the channel.
                if (obj.exportData) delete obj.exportData.codeTemplateLibraries;
                // Same two Swing import behaviors the XML path applies: re-point
                // resource assignments by name, and lift the dependency edges out
                // of exportData into the global set (merged after the upload).
                await remapImportedResourceIdsJson(obj);
                const dependencyEdges = takeDependencyEdgesJson(obj, obj.id);
                // Same explicit-boolean contract as the XML path: FALSE is a
                // rejection, anything that is not TRUE is an unknown outcome.
                assertImportIdentityCurrent(resolved, await freshChannelIdentities(), CHANNEL_IMPORT_RULES);
                const accepted = resolved.overwrite
                    ? await api.channels.update(obj.id, obj)
                    : await api.channels.create(obj);
                if (String(accepted) === 'false') {
                    throw new Error(`the engine rejected channel "${resolved.name}" (a conflicting channel may already exist there)`);
                }
                if (String(accepted) !== 'true') {
                    throw new Error(`the engine did not confirm channel "${resolved.name}" — the import may not have been applied; Refresh before retrying`);
                }
                try { await mergeChannelDependencies(dependencyEdges); }
                catch (e: any) { toast(`Channel imported, but its deploy/start dependencies could not be saved: ${e.message}`, 'warn'); }
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
        try {
            // Ask up front (before the save dialog) whether to bundle code
            // template libraries. A failed lookup aborts visibly: treating it
            // as "none linked" would create a valid-looking incomplete export.
            const includeLibs = await promptIncludeLibraries(channel.id);
            if (includeLibs === null) return;   // cancelled the export
            await saveFile(`${channel.name || channel.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/channels/${channel.id}`, includeLibs ? { includeCodeTemplateLibraries: true } : undefined);
                /* An empty or wrong answer must not become a downloaded "backup":
                   the file has to be the requested channel, verified by id. */
                const doc = new DOMParser().parseFromString(String(xml || ''), 'text/xml');
                const root = doc.documentElement;
                const exportedId = root && root.nodeName === 'channel'
                    ? [...root.children].find((c: any) => c.tagName === 'id')?.textContent : null;
                if (doc.querySelector('parsererror') || exportedId !== channel.id) {
                    throw new Error(`the engine did not return channel "${channel.name || channel.id}" — export aborted rather than writing an empty or wrong file`);
                }
                return xml;
            });
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    /* Export All writes ONE FILE PER CHANNEL into a ZIP. The engine's combined
       <list> we used to save is a document no importer deserializes — Swing
       reads a single Channel, and our own Import Channel rejected the file it
       had just written. Swing's Export All picks a directory and drops a file
       per channel into it; a ZIP is the browser's version of that directory. */
    async function exportAllTask() {
        if (!channels.length) { toast('No channels to export', 'warn'); return; }
        try {
            const includeLibs = await promptIncludeLibraries(channels.map((c: any) => c.id));
            if (includeLibs === null) return;   // cancelled the export
            await saveFile('channels.zip', 'application/zip', async () => {
                // Serializing every channel takes the engine minutes on a big
                // server — no client ceiling (timeoutMs: null).
                const xml = await api.getXml('/channels',
                    includeLibs ? { includeCodeTemplateLibraries: true } : undefined, { timeoutMs: null });
                const doc = new DOMParser().parseFromString(xml, 'text/xml');
                if (doc.querySelector('parsererror')) throw new Error('Engine returned invalid channel XML');
                const els = detachListElements(doc, 'channel');
                if (!els.length) throw new Error('No channels to export');
                /* "Export All" must actually be all: a channel this view shows
                   but the engine did not return (concurrent deletion, RBAC
                   filtering, partial response) makes a valid-LOOKING backup that
                   is silently missing channels. */
                const returned = new Set(els.map((el: any) =>
                    [...el.children].find((c: any) => c.tagName === 'id')?.textContent));
                const absent = channels.filter((c: any) => !returned.has(c.id)).map((c: any) => c.name || c.id);
                if (absent.length) {
                    throw new Error(`the engine did not return ${absent.length} channel(s) shown here `
                        + `(${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', …' : ''}) `
                        + '— export aborted rather than writing an incomplete backup');
                }
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
            toast(`Export failed: ${e.message}`, 'error');
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
                'deploy',
                'Deploy',
                (id: any) => nameById.get(String(id)) || id
            );
            if (targets === null) return;
            await submitDeployment('deploy', targets);
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
    // Set by the loader; read at mutation time by saveGroups.
    const groupsLoadFailedRef = useRef(true);
    const groupsRefreshEpochRef = useRef(0);

    /* Every group mutation rebuilds the COMPLETE set, which makes two failure
       modes catastrophic rather than cosmetic:
       - a FAILED groups load leaves [] standing in for the set, so any mutation
         would "rebuild" from nothing and delete every other group — mutations
         are refused until a load succeeds;
       - a CONCURRENT edit would be silently reverted by override=true, so the
         set goes out with override=false first and a conflict is confirmed. */
    async function saveGroups(updated: any[], removedIds: any[] = []) {
        if (groupsLoadFailedRef.current) {
            throw new Error('the group list failed to load — Refresh before changing groups '
                + '(rebuilding the set from an empty copy would delete every other group)');
        }
        // AFFIRMATIVE acceptance: the engine answers boolean true. false is the
        // stale-set conflict; anything else (empty, malformed) is an unknown
        // outcome that must not read as saved.
        const accepted = await api.channelGroups.bulkUpdate(updated, removedIds, false);
        if (String(accepted) === 'false') {
            const overwrite = await confirmDialog('Channel Groups Modified',
                'The channel groups changed on the server while this change was being prepared. Overwrite those newer changes?',
                { danger: true, okLabel: 'Overwrite' });
            if (!overwrite) throw new Error('Group change cancelled — Refresh to load the latest groups');
            const retried = await api.channelGroups.bulkUpdate(updated, removedIds, true);
            if (String(retried) !== 'true') throw new Error('the engine did not confirm the group save — Refresh before retrying');
        } else if (String(accepted) !== 'true') {
            throw new Error('the engine did not confirm the group save — Refresh before retrying');
        }
    }

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
            await saveGroups(updated);
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
            await saveGroups(updated);
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
            await saveGroups(remaining, [group.id]);
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
                            await saveGroups(updated);
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
            /* Swing promptObjectMigration("group"): block newer exports, confirm
               conversion of older/unknown ones. A single <channelGroup> file
               carries its version on the root; a <list> of them carries it on the
               children, so judge whichever this file is by its objects. */
            const groupDoc = new DOMParser().parseFromString(String(file.content || '').trim(), 'text/xml');
            const groupRoot = groupDoc.documentElement;
            const verdict = groupRoot && groupRoot.nodeName === 'list'
                ? checkImportVersionForElements(detachListElements(groupDoc, 'channelGroup'), 'group')
                : checkImportVersionFromDoc(groupDoc, 'group');
            if (verdict.action === 'block') { await alertInformation(verdict.message); return; }
            if (verdict.action === 'confirm' && !await optionYesNo('Select an Option', verdict.message)) return;
            const parsed = parseGroupXml(file.content);
            /* The library decision is taken BEFORE anything is created: a
               Cancel after channels were already posted cannot be honored (there
               is no rollback), which used to mean it was silently ignored. */
            const bundledCount = parsed.flatMap((p: any) => p.embeddedChannels)
                .filter((e: any) => e.isDefinition)
                .reduce((n: number, e: any) => n + (String(e.xml).match(/<codeTemplateLibrary[\s>]/g) || []).length, 0);
            let libraryChoice: any = 'no';
            if (bundledCount) {
                libraryChoice = await promptImportLibraries('the imported channels', bundledCount);
                if (libraryChoice === 'cancel') return;
            }
            const knownChannels = await freshChannelIdentities();
            const knownGroups = groupsNowRef.current.map((g: any) => ({ id: g.id, name: g.name }));
            const resolvedChannelIds = new Map();
            const dependencyEdges: any[] = [];
            const bundledSets: { els: any[], channelId: any }[] = [];
            const imported = [];
            let importedChannels = 0;
            let skippedChannels = 0;

            /* PHASE 1 — decisions only, nothing written. Every identity (groups
               and channels) is resolved and every bundled library is extracted
               and re-pointed here, so a cancel — or a failed library save in
               phase 2 — aborts with the server untouched. Swing orders its
               group import the same way (libraries before channels,
               ChannelPanel.importGroup). */
            const plans: any[] = [];
            for (const { group, embeddedChannels } of parsed) {
                const groupIdentity = await resolveImportIdentity(
                    group.name || '', group.id || '', knownGroups, GROUP_IMPORT_RULES);
                if (!groupIdentity) {
                    skippedChannels += embeddedChannels.filter((e: any) => e.isDefinition).length;
                    continue;
                }
                group.id = groupIdentity.id;
                group.name = groupIdentity.name;
                knownGroups.push({ id: groupIdentity.id, name: groupIdentity.name });
                const members: any[] = [];
                for (const embedded of embeddedChannels) {
                    if (!embedded.isDefinition || resolvedChannelIds.has(embedded.id)) {
                        members.push({ ref: resolvedChannelIds.get(embedded.id) || embedded.id });
                        continue;
                    }
                    const doc = new DOMParser().parseFromString(String(embedded.xml || ''), 'text/xml');
                    const channelEl = doc.documentElement;
                    if (doc.querySelector('parsererror') || !channelEl || channelEl.nodeName !== 'channel') {
                        toast('Could not import channel: not a valid channel definition', 'warn');
                        skippedChannels++;
                        continue;
                    }
                    const childOf = (tag: any) => [...channelEl.children].find((c: any) => c.tagName === tag);
                    const sourceId = childOf('id')?.textContent || '';
                    const resolved = await resolveImportName(
                        childOf('name')?.textContent || '', sourceId, knownChannels);
                    if (!resolved) { skippedChannels++; continue; }
                    // Bundled libraries leave the document NOW, re-pointed at the
                    // final channel id, so phase 2 can save them before any
                    // channel exists.
                    const libsContainer = channelEl.querySelector('exportData > codeTemplateLibraries');
                    if (libsContainer) {
                        const els = [...libsContainer.children]
                            .filter((c: any) => c.tagName === 'codeTemplateLibrary')
                            .map((el: any) => el.cloneNode(true));
                        if (resolved.id !== sourceId) {
                            for (const el of els) for (const enabled of (el as any).querySelectorAll('enabledChannelIds')) {
                                [...enabled.children].forEach((str: any) => {
                                    if (str.tagName === 'string' && str.textContent === sourceId) str.remove();
                                });
                                const str = doc.createElement('string');
                                str.textContent = resolved.id;
                                enabled.appendChild(str);
                            }
                        }
                        if (els.length) bundledSets.push({ els, channelId: resolved.id });
                        libsContainer.parentNode!.removeChild(libsContainer);
                    }
                    resolvedChannelIds.set(embedded.id, resolved.id);
                    knownChannels.push({ id: resolved.id, name: resolved.name, revision: resolved.revision });
                    members.push({ plan: { doc, resolved } });
                }
                plans.push({ group, members });
            }

            /* PHASE 2 — libraries FIRST. A failure here aborts the whole import
               with zero channels created, instead of leaving channels that
               reference templates that never arrived. */
            const identitiesBeforeLibraries = await freshChannelIdentities();
            for (const plan of plans) for (const member of plan.members) if (member.plan) {
                assertImportIdentityCurrent(member.plan.resolved, identitiesBeforeLibraries, CHANNEL_IMPORT_RULES);
            }
            if (libraryChoice === 'yes' && bundledSets.length) {
                await importLibrarySetsXml(bundledSets);
            }

            /* PHASE 3 — channels, one failure skips only itself (Swing retains
               partial results); the dependency edges collected so far are
               flushed however the loop ends. */
            const flushDependencyEdges = async () => {
                try {
                    await mergeChannelDependencies(rewriteDependencyEdges(dependencyEdges, resolvedChannelIds));
                } catch (e: any) {
                    toast(`Channels imported, but their deploy/start dependencies could not be saved: ${e.message}`, 'warn');
                }
            };
            /* Every planned definition is created FIRST, then every group's
               membership is built from actual OUTCOMES: a reference resolved in
               phase 1 must not survive into a group when its channel's creation
               failed — that is a phantom member pointing at nothing. */
            const plannedIds = new Set<string>();
            const createdIds = new Set<string>();
            for (const plan of plans) for (const member of plan.members) {
                if (member.plan) plannedIds.add(String(member.plan.resolved.id));
            }
            try {
                for (const plan of plans) {
                    for (const member of plan.members) {
                        if (!member.plan) continue;
                        let outcome: any;
                        try {
                            outcome = await importChannelDoc(member.plan.doc, [], {
                                checkVersion: false,
                                deferDependencies: true,
                                presetIdentity: member.plan.resolved
                            });
                        } catch (e: any) {
                            toast(`Could not import channel: ${e.message}`, 'warn');
                            skippedChannels++;
                            continue;
                        }
                        importedChannels++;
                        dependencyEdges.push(...outcome.dependencyEdges);
                        createdIds.add(String(outcome.id));
                    }
                }
            } finally {
                await flushDependencyEdges();
            }
            for (const plan of plans) {
                const refs = plan.members
                    .map((member: any) => String(member.ref ?? member.plan.resolved.id))
                    // A membership reference to a channel this file DEFINED is
                    // only real if that channel was actually created; references
                    // to channels that already exist on the server pass through.
                    .filter((id: string) => !plannedIds.has(id) || createdIds.has(id))
                    .map((id: string) => ({ id }));
                plan.group.channels = refs.length ? { channel: refs } : null;
                imported.push(plan.group);
            }
            if (!imported.length) {
                toast(`Imported 0 group(s) from ${file.name}` + (skippedChannels ? `, skipped ${skippedChannels} channel(s)` : ''), 'warn');
                refresh();
                return;
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
            // Groups are written for every SUCCESSFUL channel even when some
            // were skipped — partial results are kept, like Swing keeps them.
            await saveGroups(updated.concat(imported));
            toast(`Imported ${imported.length} group(s), ${importedChannels} channel(s) from ${file.name}`
                + (skippedChannels ? `, skipped ${skippedChannels}` : ''),
                importedChannels || imported.length ? undefined : 'warn');
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
            /* Every referenced channel must actually be in the answer — a
               concurrent deletion, RBAC filtering, or a partial engine response
               would otherwise produce a valid-LOOKING export that is silently
               missing channels, which is the worst kind of backup. */
            const missing = [...channelIds].filter(id => !channelById.has(id));
            if (missing.length) {
                throw new Error(`the engine did not return ${missing.length} channel(s) referenced by the group(s)`
                    + ` (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''})`
                    + ' — export aborted rather than writing an incomplete backup');
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
        try {
            // Swing asks about bundling linked libraries for a GROUP export too —
            // the group's channels are exported whole, so they carry (or don't)
            // the same exportData the single-channel export does.
            const includeLibs = await promptIncludeLibraries(groupChannelIds([group]));
            if (includeLibs === null) return;
            await saveFile(`${group.name || group.id}.xml`, 'application/xml', async () => {
                const els = await hydratedGroupElements(group.id, includeLibs);
                return new XMLSerializer().serializeToString(els[0]);
            });
        } catch (e: any) {
            toast(`Export failed: ${e.message}`, 'error');
        }
    }

    /* Export All Groups, like Export All Channels, writes one file per group into
       a ZIP: a <list> of <channelGroup> is not a document Swing can read back. */
    async function exportGroupsTask() {
        try {
            const includeLibs = await promptIncludeLibraries(groupChannelIds(groups));
            if (includeLibs === null) return;
            await saveFile('channel-groups.zip', 'application/zip', async () => {
                const els = await hydratedGroupElements(undefined, includeLibs);
                if (!els.length) throw new Error('No channel groups to export');
                /* Same completeness rule as inside the groups: a GROUP this view
                   shows that the engine's answer omitted entirely must abort the
                   export, not silently thin the backup. */
                const returnedGroups = new Set(els.map((el: any) =>
                    [...el.children].find((c: any) => c.tagName === 'id')?.textContent));
                const absentGroups = groupsNowRef.current
                    .filter((g: any) => !returnedGroups.has(g.id)).map((g: any) => g.name || g.id);
                if (absentGroups.length) {
                    throw new Error(`the engine did not return ${absentGroups.length} group(s) shown here `
                        + `(${absentGroups.slice(0, 3).join(', ')}${absentGroups.length > 3 ? ', …' : ''}) `
                        + '— export aborted rather than writing an incomplete backup');
                }
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
            toast(`Export failed: ${e.message}`, 'error');
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
