import assert from 'node:assert/strict';
import { channelEditState, loadChannelForEdit, saveChannelModel } from './channel-save.js';

const file = (transportName, scheme, anonymous, username, password) => ({
    transportName, properties: { scheme, anonymous, username, password },
});
let server = {
    id: 'file-repair', name: 'File repair', revision: 1,
    sourceConnector: file('File Reader', 'FTP', 'true', '', ''),
    destinationConnectors: { connector: [
        file('File Writer', 'WEBDAV', true, '', ''),
        file('File Writer', 'SFTP', true, 'named-user', 'named-password'),
        file('File Writer', 'WEBDAV', 'true', 'anonymous', 'contact@example.test'),
        file('HTTP Sender', 'FTP', true, '', ''),
    ] },
};
const writes = [];
let fail = false;
let loseCreate = false;
let duringPut = null;
globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') return Response.json({ channel: server });
    const submitted = JSON.parse(init.body).channel;
    writes.push(structuredClone(submitted));
    if (duringPut) { const edit = duringPut; duringPut = null; edit(); }
    if (loseCreate) {
        loseCreate = false;
        server = structuredClone(submitted);
        throw new Error('lost create response');
    }
    if (fail) throw new Error('write failed');
    server = structuredClone(submitted);
    return Response.json(true);
};
const options = { userId: 1, skipUnchanged: true, confirmConflict: async () => true };
const channel = await loadChannelForEdit('file-repair');
assert.equal(await saveChannelModel(channel, options), true, 'legacy credentials bypass the unchanged-save shortcut');
assert.equal(writes.length, 1);
assert.deepEqual(writes[0].sourceConnector.properties, {
    scheme: 'FTP', anonymous: 'true', username: 'anonymous', password: 'anonymous',
});
const [webdav, sftp, custom, unrelated] = writes[0].destinationConnectors.connector.map(c => c.properties);
assert.deepEqual(webdav, { scheme: 'WEBDAV', anonymous: true, username: 'anonymous', password: 'anonymous' });
assert.deepEqual(sftp, { scheme: 'SFTP', anonymous: false, username: 'named-user', password: 'named-password' });
assert.deepEqual(custom, { scheme: 'WEBDAV', anonymous: 'true', username: 'anonymous', password: 'contact@example.test' });
assert.deepEqual(unrelated, { scheme: 'FTP', anonymous: true, username: '', password: '' });
assert.equal(channel.sourceConnector.properties.username, 'anonymous', 'accepted repair updates the working model');
await saveChannelModel(channel, options);
assert.equal(writes.length, 1, 'a second unchanged save is idempotent');

server = { id: 'file-retry', name: 'File retry', revision: 1,
    sourceConnector: file('File Reader', 'FTP', true, '', '') };
const retry = await loadChannelForEdit('file-retry');
fail = true;
await assert.rejects(saveChannelModel(retry, options), /write failed/);
assert.equal(retry.sourceConnector.properties.username, '', 'a failed repair leaves the working model alone');
fail = false;
assert.equal(await saveChannelModel(retry, options), true);
assert.equal(writes.at(-1).sourceConnector.properties.username, 'anonymous');

server = { id: 'file-concurrent', name: 'File concurrent', revision: 1,
    sourceConnector: file('File Reader', 'FTP', true, '', '') };
const concurrent = await loadChannelForEdit('file-concurrent');
duringPut = () => { concurrent.sourceConnector.properties.password = 'edited-during-save'; };
assert.equal(await saveChannelModel(concurrent, options), true);
assert.equal(concurrent.sourceConnector.properties.username, '', 'accepted repair does not overwrite a newer draft');
assert.equal(concurrent.sourceConnector.properties.password, 'edited-during-save');
assert.equal(writes.at(-1).sourceConnector.properties.password, 'anonymous', 'the first PUT used its captured snapshot');
assert.equal(await saveChannelModel(concurrent, options), true);
assert.equal(writes.at(-1).sourceConnector.properties.password, 'edited-during-save', 'the newer edit remains eligible for Save');

const created = { id: 'file-lost-create', name: 'File lost create',
    sourceConnector: file('File Reader', 'FTP', true, '', '') };
channelEditState(created, true);
loseCreate = true;
await assert.rejects(saveChannelModel(created, options), /lost create response/);
const createdWrites = writes.length;
assert.equal(await saveChannelModel(created, options), true);
assert.equal(writes.length, createdWrites, 'verified creation does not send a duplicate repair');
assert.equal(created.sourceConnector.properties.username, 'anonymous', 'recovered draft matches the saved credentials');
console.log('channel-save File: legacy repair, stale flags, custom values, retry, concurrency and idempotence passed');
