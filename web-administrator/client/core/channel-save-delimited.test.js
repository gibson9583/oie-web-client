import assert from 'node:assert/strict';
import { channelEditState, loadChannelForEdit, saveChannelModel } from './channel-save.js';

const properties = () => ({ '@class': 'Delimited', future: 'keep', serializationProperties: { columnWidths: null, columnNames: { string: [] }, unknown: 42 }, deserializationProperties: { columnWidths: [] } });
const transformer = () => ({ inboundDataType: 'DELIMITED', outboundDataType: 'DELIMITED', inboundProperties: properties(), outboundProperties: properties() });
let server = { id: 'delimited', name: 'Delimited', revision: 1, sourceConnector: { transformer: transformer() },
    destinationConnectors: { connector: { transformer: transformer(), responseTransformer: transformer() } } };
const writes = [];
let failure = false;
globalThis.fetch = async (_url, init) => {
    if (init.method === 'GET') return Response.json({ channel: server });
    const submitted = JSON.parse(init.body).channel;
    writes.push(submitted);
    if (failure) throw new Error('write failed');
    server = structuredClone(submitted);
    return Response.json(true);
};
const options = { userId: 1, confirmConflict: async () => true };
const channel = await loadChannelForEdit('delimited');
channel.name = 'Edited';
assert.equal(await saveChannelModel(channel, options), true);
for (const connector of [server.sourceConnector, server.destinationConnectors.connector]) {
    for (const target of [connector.transformer, connector.responseTransformer].filter(Boolean)) {
        for (const side of ['inbound', 'outbound']) {
            assert.deepEqual(target[`${side}Properties`], { '@class': 'Delimited', future: 'keep', serializationProperties: { unknown: 42 }, deserializationProperties: {} });
        }
    }
}
assert.equal(channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths, null, 'save normalizes its clone, not the live draft');
const count = writes.length;
await saveChannelModel(channel, { ...options, skipUnchanged: true });
assert.equal(writes.length, count, 'normalization does not break unchanged-save idempotence');
channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths = '0';
const revision = channel.revision;
await assert.rejects(saveChannelModel(channel, options), /columnWidths/);
assert.equal(writes.length, count, 'invalid list never reaches PUT');
assert.equal(channel.revision, revision);
assert.equal(channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths, '0');
channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths = '5,3';
failure = true;
await assert.rejects(saveChannelModel(channel, options), /write failed/);
assert.equal(channel.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths, '5,3', 'failed write preserves draft');
failure = false;
assert.equal(await saveChannelModel(channel, options), true);
assert.deepEqual(server.sourceConnector.transformer.inboundProperties.serializationProperties.columnWidths, { int: [5, 3] });
assert.equal(channelEditState(channel).saving, false, 'failure releases the save gate');

const created = { id: 'create-delimited', sourceConnector: { transformer: transformer() } };
channelEditState(created, true);
created.sourceConnector.transformer.outboundProperties.deserializationProperties.columnWidths = '2147483648';
const beforeCreate = writes.length;
await assert.rejects(saveChannelModel(created, options), /columnWidths/);
assert.equal(writes.length, beforeCreate, 'invalid new channel never reaches POST');
created.sourceConnector.transformer.outboundProperties.deserializationProperties.columnWidths = { int: 5 };
await saveChannelModel(created, options);
assert.deepEqual(writes.at(-1).sourceConnector.transformer.outboundProperties.deserializationProperties.columnWidths, { int: 5 }, 'valid singleton shape is preserved');
console.log('channel-save Delimited: legacy arrays, all transformer sides, unknown fields, validation, retry, idempotence, singleton and create passed');
