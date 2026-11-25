import assert from 'node:assert/strict';
import api from './api.js';
import { assignedTags, channelEditState, loadChannelForEdit, loadTagChoices, saveChannelModel, setTagMembership } from './channel-save.js';
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
    for (const tag of assignedTags(server)) {
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

// Settings changes membership independently of the channel's last saver.
{
    const alpha = { id: 'alpha', name: 'Alpha', channelIds: { string: 'one' } };
    const beta = { id: 'beta', name: 'Beta', channelIds: { string: 'one' } };
    const existing = () => ({ id: 'one', name: 'Original', revision: 1,
        exportData: { metadata: { userId: 7 }, channelTags: { channelTag: alpha } } });
    const sameUser = { ...options, userId: 7 };
    lookupFailure = fallbackFailure = writeFailure = expired = false;
    known = [alpha];
    server = existing();
    const connectorDraft = await loadChannelForEdit('one');
    server.exportData.channelTags = null; // OIE serializes <channelTags/> as JSON null.
    connectorDraft.name = 'Unrelated connector edit';
    await saveChannelModel(connectorDraft, sameUser);
    assert.deepEqual(assignedTags(writes.at(-1)), [], 'saving must preserve removal of the last server tag');

    server = existing();
    const draft = await loadChannelForEdit('one');
    const tagRead = Promise.withResolvers();
    const listTags = api.server.channelTags;
    api.server.channelTags = () => tagRead.promise;
    const refresh = loadTagChoices(draft, () => true);
    api.server.channelTags = listTags;
    server.exportData.channelTags = { channelTag: [alpha, beta] };
    known = [alpha, beta];
    draft.name = 'First edit';
    const update = api.channels.update;
    api.channels.update = async (...args) => {
        // The earlier XML response arrives while the channel PUT is pending.
        // The XML reader represents even singleton channel IDs as an array.
        tagRead.resolve([{ ...alpha, channelIds: { string: ['one'] } }]);
        await refresh;
        return update(...args);
    };
    try { await saveChannelModel(draft, sameUser); }
    finally { api.channels.update = update; }
    assert.deepEqual(assignedTags(writes.at(-1)), [alpha, beta]);
    assert.deepEqual(assignedTags(draft), [alpha, beta], 'a late tag read must not revert the acknowledged draft');
    draft.name = 'Another edit';
    await saveChannelModel(draft, sameUser);
    assert.deepEqual(assignedTags(writes.at(-1)), [alpha, beta], 'a follow-up save must retain the remote assignment');

    expired = 'all'; lookupFailure = true; reads.length = 0;
    await assert.rejects(loadTagChoices(draft, () => true), /previous session/);
    assert.deepEqual(reads, ['all'], 'a stale tag refresh cannot start a fallback read in a new session');
}
{
    const tag = (id, name) => ({ id, name, channelIds: { string: 'one' } });
    const channel = (tags) => ({ id: 'one', name: 'Original', revision: 1,
        exportData: { metadata: { userId: 7 }, channelTags: tags } });
    const sameUser = { ...options, userId: 7 };
    const production = tag('first', 'Production');
    const legacy = tag('first', 'Legacy');
    const replacement = tag('second', 'Production');
    lookupFailure = fallbackFailure = writeFailure = expired = false;

    // A singleton JSON export and the parsed XML choices describe the same tag.
    // A later dependency-only retry should skip the already-clean channel PUT.
    server = channel({ channelTag: { '@version': '4.6.0', ...production } });
    known = [{ ...production, channelIds: { string: ['one'] } }];
    const clean = await loadChannelForEdit('one');
    const originalTags = structuredClone(clean.exportData.channelTags);
    writes.length = 0;
    await loadTagChoices(clean, () => true);
    assert.deepEqual(clean.exportData.channelTags, originalTags);
    await saveChannelModel(clean, sameUser);
    assert.equal(writes.length, 0, 'looking up unchanged tags must not write the channel');

    for (const remove of [false, true]) {
        server = channel({ channelTag: production });
        known = [production];
        const draft = await loadChannelForEdit('one');
        if (remove) setTagMembership(draft, production, false, '4.6.0');
        server.exportData.channelTags = { channelTag: [legacy, replacement] };
        known = [legacy, replacement];
        await loadTagChoices(draft, () => true);
        draft.name = 'Unrelated edit';
        await saveChannelModel(draft, sameUser);
        assert.deepEqual(assignedTags(writes.at(-1)), remove ? [replacement] : [legacy, replacement],
            'reusing a renamed tag’s old name cannot remove the new identity');
    }

    // Adding a new name that Settings concurrently gave an already-assigned
    // tag converges to one membership with the existing engine ID.
    server = channel({ channelTag: production });
    known = [production];
    const renamed = await loadChannelForEdit('one');
    setTagMembership(renamed, tag('temporary', 'Legacy'), true, '4.6.0');
    server.exportData.channelTags = { channelTag: legacy };
    known = [legacy];
    await saveChannelModel(renamed, sameUser);
    assert.deepEqual(assignedTags(writes.at(-1)), [legacy]);

    for (const refresh of [false, true]) {
        const oldChoice = { ...tag('choice', 'Legacy'), channelIds: { string: ['two'] } };
        server = channel({ channelTag: production });
        known = [production, oldChoice];
        const draft = await loadChannelForEdit('one');
        setTagMembership(draft, oldChoice, true, '4.6.0');
        // The original choice still exists under its new name. Both IDs belong
        // on the channel even though the other tag now has its former name.
        known = [legacy, { ...oldChoice, name: 'Archive' }];
        server.exportData.channelTags = { channelTag: legacy };
        if (refresh) await loadTagChoices(draft, () => true);
        await saveChannelModel(draft, sameUser);
        assert.deepEqual(assignedTags(writes.at(-1)).map(t => [t.id, t.name]), [['first', 'Legacy'], ['choice', 'Archive']]);
    }

    // With Channel View alone, a typed tag may be accepted under a different
    // server ID. Its exact name may also be coerced by a JSON readback.
    for (const receipt of ['available', 'failed', 'recovered-create']) {
        server = receipt === 'recovered-create' ? null : channel(null);
        lookupFailure = true;
        assigned = [];
        const draft = server ? await loadChannelForEdit('one') : channel(null);
        if (!server) channelEditState(draft, true);
        setTagMembership(draft, { ...tag('temporary', '1e5'), backgroundColor: { red: 40 } }, true, '4.6.0');
        const engineTag = { ...tag('canonical', '1e5'), backgroundColor: { red: 180 }, channelIds: { string: ['one', 'two'] } };
        const get = api.channels.get, update = api.channels.update, create = api.channels.create;
        const accept = async (_id, submitted) => {
            server = structuredClone(submitted);
            server.exportData.channelTags = { channelTag: { ...engineTag, name: 100000 } };
            assigned = [engineTag];
            return true;
        };
        try {
            api.channels.update = accept;
            if (receipt === 'failed') {
                let read = 0;
                api.channels.get = (...args) => ++read === 2 ? Promise.reject(new Error('Readback failed')) : get(...args);
            }
            if (receipt === 'recovered-create') {
                api.channels.create = async submitted => {
                    await accept(null, submitted);
                    throw new Error('Create response lost');
                };
                await assert.rejects(saveChannelModel(draft, sameUser), /response lost/);
                setTagMembership(draft, tag('temporary', '1e5'), false, '4.6.0');
                api.channels.update = update;
                await saveChannelModel(draft, sameUser);
                assert.deepEqual(assignedTags(writes.at(-1)), [], 'create recovery keeps a removal made after the lost response');
                continue;
            }
            await saveChannelModel(draft, sameUser);
        } finally {
            api.channels.get = get;
            api.channels.update = update;
            api.channels.create = create;
        }
        if (receipt === 'available') {
            assert.deepEqual(assignedTags(draft), [engineTag]);
            const count = writes.length;
            await loadTagChoices(draft, () => true);
            await saveChannelModel(draft, sameUser);
            assert.equal(writes.length, count, 'a refresh after a canonicalized save cannot write the channel again');
            engineTag.name = 'Renamed';
            server.exportData.channelTags.channelTag.name = 'Renamed';
        }
        setTagMembership(draft, assignedTags(draft)[0], false, '4.6.0');
        await saveChannelModel(draft, sameUser);
        assert.deepEqual(assignedTags(writes.at(-1)), [], 'a canonicalized tag can be removed on the next save');
    }
}
console.log('channel-save tags: exact names, identity, permissions, retries, no-op refreshes and session fencing passed');
