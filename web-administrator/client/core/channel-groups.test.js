import assert from 'node:assert/strict';
import { mutateChannelGroups } from './channel-groups.js';

let writes = [];
let readFails = false;
let accepted = true;
let latest = [{ id: 'concurrent', name: 'Keep me', revision: 2 }];
globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') {
        return readFails ? new Response('unavailable', { status: 503 }) :
            Response.json({ list: { channelGroup: latest } });
    }
    writes.push({ url: String(url), groups: JSON.parse(await init.body.get('channelGroups').text()),
        removed: JSON.parse(await init.body.get('removedChannelGroupIds').text()) });
    return Response.json(accepted);
};
const add = groups => [...groups, { id: 'new', name: 'New group', revision: 0 }];
readFails = true;
await assert.rejects(mutateChannelGroups(add), /unavailable/);
assert.equal(writes.length, 0, 'a failed authoritative read must not replace any groups');
readFails = false;
await mutateChannelGroups(add);
assert.deepEqual(writes[0].groups.set.channelGroup.map(g => g.id), ['concurrent', 'new']);
assert.match(writes[0].url, /override=false$/);
accepted = false;
await assert.rejects(mutateChannelGroups(add), /not saved/);
assert.equal(writes.length, 2, 'a conflict must not retry with override');
accepted = true;
await mutateChannelGroups(() => [], ['concurrent']);
assert.deepEqual(writes[2].removed.set.string, ['concurrent']);
console.log('channel-groups: authoritative reads, conflict handling, and explicit removals passed');

accepted = false;
const atConflict = writes.length;
assert.equal(await mutateChannelGroups(add, [], { confirmOverwrite: async () => false }), false);
assert.equal(writes.length, atConflict + 1, 'Cancel must not send an overriding write');
const confirmOverwrite = async () => {
    latest.push({ id: 'during-prompt', name: 'Keep this too', revision: 0 });
    accepted = true;
    return true;
};
assert.equal(await mutateChannelGroups(add, [], { confirmOverwrite }), true);
assert.match(writes.at(-1).url, /override=true$/);
assert.deepEqual(writes.at(-1).groups.set.channelGroup.map(g => g.id), ['concurrent', 'during-prompt', 'new']);
const stale = { id: 'concurrent', name: 'Old', revision: 1 };
let prompts = 0;
const beforeStale = writes.length;
assert.equal(await mutateChannelGroups(groups => groups, [], { expectedGroup: stale, confirmOverwrite: async () => { prompts++; return false; } }), false);
assert.equal(writes.length, beforeStale);
assert.equal(prompts, 1);
await assert.rejects(mutateChannelGroups(groups => groups, [], { expectedGroup: stale, confirmOverwrite: async () => {
    latest = []; return true;
} }), /removed/);
assert.equal(writes.length, beforeStale, 'a removal during the overwrite prompt must not resurrect the target');
accepted = false;
await assert.rejects(mutateChannelGroups(add, [], { confirmOverwrite: async () => true }), /did not confirm/);
console.log('channel-groups: Swing overwrite/cancel, prompt-time additions, removed targets and rejected override passed');

const beforeFailedRefresh = writes.length;
await assert.rejects(mutateChannelGroups(add, [], { confirmOverwrite: async () => { readFails = true; return true; } }), /unavailable/);
assert.equal(writes.length, beforeFailedRefresh + 1, 'failed refresh after approval prevents the overriding write');
readFails = false;
