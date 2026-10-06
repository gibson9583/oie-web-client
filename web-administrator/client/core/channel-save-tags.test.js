import assert from 'node:assert/strict';
import api from './api.js';
import { channelEditState, loadChannelForEdit, saveChannelModel } from './channel-save.js';
import { discardEngineResponses } from './engine-fetch.js';

const exact = [{ id: 'negative-zero', name: '-0' }, { id: 'null', name: 'null' }];
let server, known, assigned, lookupFailure, fallbackFailure, writeFailure, expired;
const writes = [], reads = [];
api.channels.get = async () => structuredClone(server);
api.server.channelTags = async () => {
    reads.push('all');
    if (expired === 'all') discardEngineResponses();
    if (lookupFailure) throw new Error('Tags unavailable');
    return structuredClone(known);
};
api.channels.tags = async () => {
    reads.push('assigned');
    if (expired === 'assigned') discardEngineResponses();
    if (fallbackFailure) throw new Error('Channel tags unavailable');
    return structuredClone(assigned);
};
api.channels.update = async (_id, channel) => {
    writes.push(structuredClone(channel));
    if (writeFailure) throw new Error('Write failed');
    server = structuredClone(channel);
    // Reproduce the engine's lossy JSON readback after an exact-text write.
    for (const tag of server.exportData.channelTags.channelTag) {
        try { tag.name = JSON.parse(tag.name); } catch { /* ordinary text */ }
    }
    return true;
};
api.channels.create = async channel => {
    if (writeFailure) { writes.push(structuredClone(channel)); return false; }
    return api.channels.update(channel.id, channel);
};
const options = { skipUnchanged: true, confirmConflict: async () => { throw new Error('Unexpected conflict'); } };

for (const fallback of [false, true]) {
    server = { id: 'one', name: 'Original', revision: 1, exportData: { channelTags: { channelTag: [
        { id: 'negative-zero', name: 0 }, { id: 'null', name: null }
    ] } } };
    known = structuredClone(exact); assigned = structuredClone(exact);
    lookupFailure = fallback; fallbackFailure = writeFailure = expired = false;
    writes.length = reads.length = 0;
    const channel = await loadChannelForEdit('one');
    assert.deepEqual(channel.exportData.channelTags.channelTag, exact, 'all editor surfaces share exact names');
    await saveChannelModel(channel, options);
    assert.equal(writes.length, 0, 'normalizing the draft must not dirty it or cause a conflict');

    channel.name = 'Retained edit';
    lookupFailure = fallbackFailure = true;
    await assert.rejects(saveChannelModel(channel, options), /Channel tags unavailable/);
    assert.equal(writes.length, 0, 'failed prerequisites must never write');
    assert.equal(channel.name, 'Retained edit');
    fallbackFailure = false; assigned = [];
    await assert.rejects(saveChannelModel(channel, options), /Cannot verify channel tag names/);
    assert.equal(writes.length, 0, 'fallback must resolve every assigned identity');
    assigned = structuredClone(exact); lookupFailure = fallback;

    known[0].name = assigned[0].name = 'Renamed since opening';
    writeFailure = true;
    await assert.rejects(saveChannelModel(channel, options), /Write failed/);
    writeFailure = false;
    await saveChannelModel(channel, options);
    assert.deepEqual(writes.at(-1).exportData.channelTags.channelTag, known, 'retry uses current names with the original identities');
    const count = writes.length;
    await saveChannelModel(channel, options);
    assert.equal(writes.length, count, 'accepted saves remain idempotent despite lossy JSON readback');

    channel.description = 'Unsaved';
    for (const stage of ['all', 'assigned']) {
        expired = stage; lookupFailure = true; reads.length = 0;
        await assert.rejects(saveChannelModel(channel, options), /previous session/);
        assert.deepEqual(reads, stage === 'all' ? ['all'] : ['all', 'assigned']);
        assert.equal(writes.length, count, 'session expiry must prevent subsequent requests and writes');
    }
    expired = lookupFailure = false; known = [];
    channel.exportData.channelTags.channelTag[0].name = 0;
    await assert.rejects(saveChannelModel(channel, options), /Cannot verify channel tag names/);
    assert.equal(writes.length, count, 'an unknown primitive name cannot be reconstructed');
    channel.exportData.channelTags.channelTag[0].name = 'New exact name';
    await saveChannelModel(channel, options);
    assert.equal(writes.at(-1).exportData.channelTags.channelTag[0].name, 'New exact name', 'new or imported exact strings remain saveable');
    channel.exportData.channelTags.channelTag[0] = { id: 123, name: 0 };
    known = [{ id: '123', name: '-0' }];
    await saveChannelModel(channel, options);
    assert.equal(writes.at(-1).exportData.channelTags.channelTag[0].name, '-0', 'string and JSON-coerced IDs retain their existing matching behavior');
}

for (const initial of ['new', 'untagged', 'tagged']) {
    server = { id: 'one', name: 'Original', revision: 1, exportData: { channelTags: {
        channelTag: initial === 'tagged' ? [{ id: 'negative-zero', name: 0 }] : []
    } } };
    known = []; assigned = initial === 'tagged' ? [structuredClone(exact[0])] : [];
    lookupFailure = true; fallbackFailure = initial !== 'tagged'; writeFailure = expired = false;
    writes.length = reads.length = 0;
    const channel = initial === 'new' ? structuredClone(server) : await loadChannelForEdit('one');
    if (initial === 'new') { channelEditState(channel, true); server = null; }
    const added = { id: 'local-tag', name: '1e5', channelIds: { string: ['one'] } };
    channel.exportData.channelTags.channelTag.push(added);

    added.name = 100000;
    await assert.rejects(saveChannelModel(channel, options), /Cannot verify channel tag names|Channel tags unavailable/);
    assert.equal(writes.length, 0, 'an unverified new primitive must still block the save');
    added.name = '1e5';
    expired = 'all'; reads.length = 0;
    await assert.rejects(saveChannelModel(channel, options), /previous session/);
    assert.deepEqual(reads, ['all']);
    assert.equal(writes.length, 0, 'new local tags must not bypass session fencing');
    expired = false; writeFailure = true; reads.length = 0;
    await assert.rejects(saveChannelModel(channel, options), /Write failed|did not confirm/);
    assert.equal(channel.exportData.channelTags.channelTag.at(-1), added, 'failed saves retain the authored tag');
    writeFailure = false;
    if (assigned.length) assigned[0].name = 'Renamed since opening';
    await saveChannelModel(channel, options);
    assert.deepEqual(writes.at(-1).exportData.channelTags.channelTag, [...assigned, added],
        'new exact names remain saveable while assigned tags use current engine names');
    assert.equal(writes.length, 2, 'a failed write can be retried once');
    assert.deepEqual(reads, initial === 'tagged' ? ['all', 'assigned', 'all', 'assigned'] : ['all', 'all'],
        'only already assigned tags need a channel XML fallback');
    await saveChannelModel(channel, options);
    assert.equal(writes.length, 2, 'accepted local-tag saves remain idempotent');
}
console.log('channel-save tags: shared exact names, permissions, raw baselines, failed prerequisites, retries, renames, idempotence and session fencing passed');
