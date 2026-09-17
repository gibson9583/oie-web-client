import assert from 'node:assert/strict';
import { librarySelection, dependencySelection, hasLibraryChanges, hasDependencyChanges,
    persistLibraryAssociations, persistChannelDependencies, channelDependencyState,
    copyLibrarySelection, copyDependencySelection, refreshLibraryChoices, refreshDependencyChoices } from './channel-dependencies.js';

const library = (id, extra = {}) => ({ '@version': '4.6.0', id, name: id, revision: 1,
    includeNewChannels: false, codeTemplates: { codeTemplate: [{ id: `${id}-template`, '@version': '4.6.0' }] }, ...extra });
const channel = { id: 'editing' };
const original = [library('shared')];
let latest = [library('shared', { name: 'Swing rename', revision: 5, enabledChannelIds: { string: ['other-channel'] } }), library('concurrent-add')];
let accepted = true;
let readFails = false;
const writes = [];
let graph = [], graphReadFails = false, graphWriteFails = false, graphIgnoresWrite = false;
let graphVerifyFails = false, graphLosesResponse = false, graphMalformed = false;
globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/server/channelDependencies')) {
        if (init.method === 'GET') {
            if (graphReadFails) return new Response('graph offline', { status: 503 });
            return Response.json(graphMalformed ? { set: {} } : { set: { channelDependency: graph } });
        }
        assert.equal(init.method, 'PUT');
        const payload = JSON.parse(init.body).set.channelDependency;
        writes.push({ url, payload });
        if (graphWriteFails) return new Response('graph forbidden', { status: 403 });
        if (!graphIgnoresWrite) graph = structuredClone(payload);
        if (graphVerifyFails) graphReadFails = true;
        if (graphLosesResponse) throw new Error('lost graph response');
        return new Response(null, { status: 204 });
    }
    if (init.method === 'GET') {
        assert.match(String(url), /\/codeTemplateLibraries\?/);
        return readFails ? new Response('offline', { status: 503 }) : Response.json({ list: { codeTemplateLibrary: latest } });
    }
    if (String(url).includes('/codeTemplateLibraries/_bulkUpdate')) {
        const payload = JSON.parse(await init.body.get('libraries').text()).list.codeTemplateLibrary;
        writes.push({ url, payload });
        for (const part of ['updatedCodeTemplates', 'removedLibraryIds', 'removedCodeTemplateIds']) {
            assert.equal(JSON.stringify(JSON.parse(await init.body.get(part).text())).includes('[]'), true);
        }
        return Response.json({ codeTemplateBulkUpdateResult: { librariesSuccess: accepted, overrideNeeded: !accepted } });
    }
    assert.fail(`Unexpected endpoint: ${init.method} ${url}`);
};
const libs = { current: librarySelection(original, channel.id) };
libs.current.checked.set('shared', true);
readFails = true;
await assert.rejects(persistLibraryAssociations(channel, libs, '4.6.0'), /offline/);
assert.equal(writes.length, 0);
readFails = false;
accepted = false;
await assert.rejects(persistLibraryAssociations(channel, libs, '4.6.0'), /changed while saving/);
assert.equal(hasLibraryChanges(libs.current), true);
assert.deepEqual(original, [library('shared')], 'failed save must not mutate the opening snapshot');
accepted = true;
await persistLibraryAssociations(channel, libs, '4.6.0');
assert.equal(hasLibraryChanges(libs.current), false);
assert.equal(writes.length, 2);
const saved = writes[1];
assert.match(saved.url, /override=false$/);
assert.deepEqual(saved.payload.map(l => l.id), ['shared', 'concurrent-add']);
assert.equal(saved.payload[0].name, 'Swing rename');
assert.equal(saved.payload[0].revision, 5);
assert.deepEqual(saved.payload[0].enabledChannelIds.string, ['other-channel', 'editing']);
assert.deepEqual(saved.payload[0].codeTemplates.codeTemplate, [{ '@version': '4.6.0', id: 'shared-template' }]);
await persistLibraryAssociations(channel, libs, '4.6.0');
assert.equal(writes.length, 2, 'checkpointed stage does not write twice');

libs.current.checked.set('shared', false);
latest = [library('concurrent-add')];
await assert.rejects(persistLibraryAssociations(channel, libs, '4.6.0'), /removed/);
assert.equal(writes.length, 2);
assert.equal(hasLibraryChanges(libs.current), true);

// Restore Swing's explicit overwrite/cancel choice without losing new libraries.
const overwriteLibs = { current: librarySelection([library('shared')], channel.id) };
overwriteLibs.current.checked.set('shared', true);
latest = [library('shared')];
accepted = false;
assert.equal(await persistLibraryAssociations(channel, overwriteLibs, '4.6.0', async () => false), false);
assert.equal(hasLibraryChanges(overwriteLibs.current), true);
assert.equal(await persistLibraryAssociations(channel, overwriteLibs, '4.6.0', async () => {
    latest = [library('shared', { revision: 9, enabledChannelIds: { string: ['other-channel'] } }), library('during-prompt')];
    accepted = true;
    return true;
}), true);
assert.match(writes.at(-1).url, /override=true$/);
assert.deepEqual(writes.at(-1).payload.map(l => l.id), ['shared', 'during-prompt']);
assert.deepEqual(writes.at(-1).payload[0].enabledChannelIds.string, ['other-channel', 'editing']);
assert.equal(hasLibraryChanges(overwriteLibs.current), false);
latest = structuredClone(writes.at(-1).payload); // Accepted server state for the next edit.
overwriteLibs.current.checked.set('shared', false);
accepted = false;
await assert.rejects(persistLibraryAssociations(channel, overwriteLibs, '4.6.0', async () => true), /changed while saving/);
assert.equal(hasLibraryChanges(overwriteLibs.current), true, 'a rejected override cannot checkpoint memberships');
accepted = true;

const old = { dependentId: 'editing', dependencyId: 'old' };
const added = { dependentId: 'editing', dependencyId: 'root' };
const concurrent = { dependentId: 'swing', dependencyId: 'root' };
const deps = { current: dependencySelection([old]) };
deps.current.all = [added];
graph = [old, concurrent];
const pendingSnapshot = structuredClone(deps.current);
const beforeGraph = writes.length;
graphReadFails = true;
await assert.rejects(persistChannelDependencies(deps), /graph offline/);
assert.equal(writes.length, beforeGraph, 'a failed current read must never replace the graph');
graphReadFails = false;
graphMalformed = true;
await assert.rejects(persistChannelDependencies(deps), /invalid channel dependencies/);
assert.equal(writes.length, beforeGraph, 'a malformed current graph must not become an empty graph');
graphMalformed = false;
graphWriteFails = true;
await assert.rejects(persistChannelDependencies(deps), /graph forbidden/);
assert.deepEqual(deps.current, pendingSnapshot);
graphWriteFails = false;
graphIgnoresWrite = true; // Core setter logs/rejects cycles but still returns 204.
await assert.rejects(persistChannelDependencies(deps), /did not persist/);
assert.deepEqual(deps.current, pendingSnapshot);
graphIgnoresWrite = false;
await persistChannelDependencies(deps);
assert.deepEqual(writes.at(-1).payload, [concurrent, added]);
assert.equal(hasDependencyChanges(deps.current), false);
assert.deepEqual(deps.current.all, [concurrent, added], 'keep the Swing edge added after opening the editor');
let count = writes.length;
await persistChannelDependencies(deps);
assert.equal(writes.length, count, 'checkpointed graph does not write twice');

// A confirmed write with a failed read-back remains pending; retry reconciles it.
const third = { dependentId: 'third', dependencyId: 'root' };
deps.current.all.push(third);
graphVerifyFails = true;
await assert.rejects(persistChannelDependencies(deps), /graph offline/);
assert.equal(hasDependencyChanges(deps.current), true);
count = writes.length;
graphVerifyFails = graphReadFails = false;
await persistChannelDependencies(deps);
assert.equal(writes.length, count, 'retry sees its already-applied intent and skips PUT');
assert.equal(hasDependencyChanges(deps.current), false);

// A lost PUT response gets the same reconciliation, including removal-only saves.
deps.current.all = [];
graphLosesResponse = true;
await assert.rejects(persistChannelDependencies(deps), /lost graph response/);
assert.equal(hasDependencyChanges(deps.current), true);
assert.deepEqual(graph, []);
count = writes.length;
graphLosesResponse = false;
await persistChannelDependencies(deps);
assert.equal(writes.length, count);
assert.equal(hasDependencyChanges(deps.current), false);
assert.deepEqual(deps.current.initial, []);
console.log('channel-dependencies: Swing GET/PUT, fresh merges, read/write failures, silent rejection and retry reconciliation passed');

const retained = channelDependencyState(channel);
retained.libraries.current = librarySelection([library('pending'), library('unchanged')], channel.id);
retained.libraries.current.checked.set('pending', true);
assert.equal(channelDependencyState(channel), retained, 'handoff follows model identity');
const dialog = copyLibrarySelection(retained.libraries.current);
dialog.checked.set('pending', false);
assert.equal(retained.libraries.current.checked.get('pending'), true, 'dialog cancel cannot erase earlier pending work');
refreshLibraryChoices(retained.libraries.current, [library('new', { includeNewChannels: true }), library('unchanged', { includeNewChannels: true })], channel.id);
assert.equal(retained.libraries.current.checked.get('pending'), true, 'removed library with pending intent stays visible');
assert.equal(retained.libraries.current.checked.get('new'), true, 'new choices use current membership rules');
assert.equal(retained.libraries.current.checked.get('unchanged'), true, 'unmodified choices follow the refresh');
assert.deepEqual(retained.libraries.current.libraries.map(l => l.id), ['new', 'unchanged', 'pending']);
console.log('channel-dependencies: handoff, dialog cancellation and refreshed choices preserve pending intents');

const removedElsewhere = { dependentId: 'editing', dependencyId: 'removed-elsewhere' };
const cleanGraph = dependencySelection([removedElsewhere]);
refreshDependencyChoices(cleanGraph, [concurrent]);
assert.deepEqual(cleanGraph.all, [concurrent], 'a clean graph follows external additions and removals');
assert.equal(hasDependencyChanges(cleanGraph), false);

const draftGraph = dependencySelection([old, removedElsewhere]);
draftGraph.all = [removedElsewhere, added]; // Explicitly remove old and add root.
const draftBeforeDialog = structuredClone(draftGraph);
const graphDialog = copyDependencySelection(draftGraph);
refreshDependencyChoices(graphDialog, [old, concurrent]);
assert.deepEqual(graphDialog.all, [concurrent, added], 'refresh preserves local add/remove intents and adopts unrelated external changes');
assert.deepEqual(graphDialog.initial, [old, concurrent]);
assert.equal(hasDependencyChanges(graphDialog), true);
assert.deepEqual(draftGraph, draftBeforeDialog, 'refreshing a dialog copy cannot change the cancelled draft');
refreshDependencyChoices(graphDialog, [concurrent, added]);
assert.equal(hasDependencyChanges(graphDialog), false, 'already applied local intents become clean when refreshed');
assert.deepEqual(graphDialog.all, [concurrent, added]);
console.log('channel-dependencies: refreshed graph snapshots retain local intent and isolate Cancel');
