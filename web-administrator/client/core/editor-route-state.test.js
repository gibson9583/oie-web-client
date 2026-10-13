import assert from 'node:assert/strict';
import { channelEditState, isNewChannelDraft, saveChannelModel } from './channel-save.js';
import { isNewChannelRoute, isNewAlertRoute, isNewAlertDraft, markNewAlertDraft, markAlertPersisted } from './editor-route-state.js';

for (const resolve of [isNewChannelRoute, isNewAlertRoute]) {
    assert.equal(resolve('existing', null), false, 'a cold classic route requires edit rights');
    assert.equal(resolve(undefined, null, true), true, 'literal new wizard has no id param');
    assert.equal(resolve('new', null, true), true, 'encoded new wizard has the decoded new param');
    assert.equal(resolve('existing', null, true), false, 'an existing wizard must load an existing model');
    assert.equal(resolve('missing', { id: 'other' }), false, 'unrelated stored data cannot authorize a draft');
}

const channel = { id: 'draft', name: 'Draft', sourceConnector: {} };
assert.equal(isNewChannelRoute(channel.id, channel), false, 'unknown model identity is not proof of creation');
channelEditState(channel, true);
assert.equal(isNewChannelRoute(channel.id, channel), true, 'creation provenance follows a classic draft without its query');
assert.equal(isNewChannelRoute(channel.id, channel, true), true, 'matching wizard handoff retains draft mode');
assert.equal(isNewChannelRoute('other', channel), false, 'a real draft cannot authorize a different ID');
assert.equal(isNewChannelRoute(channel.id, structuredClone(channel)), false, 'copying an ID does not copy draft provenance');

// Channel creation becomes authoritative before later readback/dependency/UI
// stages complete. Route checks must ignore any stale presentation flag then.
let releaseReadback;
const readback = new Promise(resolve => { releaseReadback = resolve; });
let readbackStarted;
const reading = new Promise(resolve => { readbackStarted = resolve; });
let writes = 0;
globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') {
        readbackStarted();
        await readback;
        return Response.json({ channel });
    }
    assert.equal(init.method, 'POST');
    writes++;
    return Response.json(true);
};
const save = saveChannelModel(channel, { confirmConflict: async () => true });
await reading;
assert.equal(isNewChannelDraft(channel), false, 'accepted creation changes mode while readback remains pending');
assert.equal(isNewChannelRoute(channel.id, channel), false, 'returning classic route now requires edit permission');
assert.equal(isNewChannelRoute('new', channel, true), false, 'new wizard URL resuming the persisted model requires edit permission');
assert.equal(isNewChannelRoute('new', channel, true, true), true, 'an explicit New wizard builds a new model instead of resuming a persisted one');
assert.equal(isNewChannelRoute(channel.id, channel, true, true), false, 'fresh is not an edit-route permission bypass');
assert.equal(channelEditState(channel, true).isNew, false, 'a stale new hint cannot reclassify accepted creation');
releaseReadback();
assert.equal(await save, true);
assert.equal(writes, 1);

const alert = markNewAlertDraft({ id: 'alert-draft', trigger: {} });
assert.equal(isNewAlertDraft(alert), true);
assert.equal(isNewAlertRoute(alert.id, alert), true);
assert.equal(isNewAlertRoute('different-alert', alert), false);
assert.equal(isNewAlertRoute(alert.id, structuredClone(alert)), false);
assert.equal(isNewAlertRoute('new', alert, true), true);
markAlertPersisted(alert);
assert.equal(isNewAlertDraft(alert), false);
assert.equal(isNewAlertRoute(alert.id, alert), false);
assert.equal(isNewAlertRoute(undefined, alert, true), false, 'persisted alert handoff must use edit permission even at the literal new wizard');
assert.equal(isNewAlertRoute(undefined, alert, true, true), true, 'an explicit New alert builds a fresh model');
assert.equal(isNewAlertRoute(alert.id, alert, true, true), false, 'fresh cannot disguise an existing alert edit');

console.log('editor-route-state: trusted draft identity, decoded wizard mode, and partial creation checks passed');
