import assert from 'node:assert/strict';
import { channelEditState, loadChannelForEdit, saveChannelModel } from './channel-save.js';
import { discardEngineResponses } from './engine-fetch.js';

const original = () => ({ id: 'one', name: 'Original', revision: 3, pluginField: { keep: 'untouched' },
    exportData: { metadata: { enabled: true, lastModified: { time: Date.now() + 86400000, timezone: 'UTC' }, userId: 8 } } });
let server = original(), readFails = false, writeFails = false, loseAfterWrite = false, accepted = true, retainRevision = false;
let readbackFailure = null, nextReadbackFailure = null;
const writes = [];
globalThis.fetch = async (url, init) => {
    if (init.method === 'GET') {
        const failure = nextReadbackFailure;
        nextReadbackFailure = null;
        if (failure === 'session ended') discardEngineResponses();
        return readFails || failure === 'unavailable' ? new Response('offline', { status: 503 }) : Response.json({ channel: server });
    }
    const submitted = JSON.parse(init.body).channel;
    writes.push({ url: String(url), submitted });
    if (writeFails) throw new Error('lost response');
    if (accepted) server = { ...structuredClone(submitted), revision: retainRevision ? server.revision : (server?.revision || 0) + 1 };
    if (accepted) nextReadbackFailure = readbackFailure;
    if (loseAfterWrite) throw new Error('lost create response');
    return Response.json(accepted);
};
let confirmations = 0;
const cancel = { userId: 4, confirmConflict: async () => { confirmations++; return false; } };
const allow = { userId: 4, confirmConflict: async () => { confirmations++; return true; } };

const channel = await loadChannelForEdit('one');
channel.name = 'Changed locally';
const previousStamp = server.exportData.metadata.lastModified.time;
const saveStarted = Date.now();
assert.equal(await saveChannelModel(channel, cancel), true);
assert.equal(confirmations, 0);
assert.match(writes.at(-1).url, /override=false/);
assert.ok(server.exportData.metadata.lastModified.time >= saveStarted && server.exportData.metadata.lastModified.time <= Date.now(), 'save time uses the actual clock, like Swing');
assert.ok(server.exportData.metadata.lastModified.time < previousStamp, 'a prior future timestamp must not force future metadata');
assert.equal(server.exportData.metadata.userId, 4);
assert.equal(server.pluginField.keep, 'untouched');
channel.name = 'Second save';
assert.equal(await saveChannelModel(channel, cancel), true, 'accepted save rebases across surfaces');
assert.equal(confirmations, 0);

server.name = 'Same user in Swing'; server.revision++;
assert.equal(await saveChannelModel(channel, cancel), true, 'Swing replaces a same-user conflict without prompting');
assert.equal(confirmations, 0);
server.name = 'Another user in Swing'; server.revision++; server.exportData.metadata.userId = 8;
const count = writes.length;
assert.equal(await saveChannelModel(channel, cancel), false);
assert.equal(writes.length, count, 'preflight conflict cancellation sends no write');
assert.equal(channel.name, 'Second save');
readFails = true;
await assert.rejects(saveChannelModel(channel, allow), /offline/);
assert.equal(writes.length, count, 'failed prerequisite never authorizes overwrite');
readFails = false;
assert.equal(await saveChannelModel(channel, allow), true);
assert.match(writes.at(-1).url, /override=false/, 'even confirmed preflight replacement retains the engine timestamp check');

const savedRevision = channel.revision;
const savedMetadata = JSON.stringify(channel.exportData.metadata);
channel.description = 'Unsent';
writeFails = true;
await assert.rejects(saveChannelModel(channel, allow), /lost response/);
assert.equal(channel.revision, savedRevision);
assert.equal(JSON.stringify(channel.exportData.metadata), savedMetadata, 'failure cannot publish a new clean baseline');
writeFails = false;
server.exportData.metadata.userId = 8;
accepted = false;
assert.equal(await saveChannelModel(channel, cancel), false);
await assert.rejects(saveChannelModel(channel, allow), /did not confirm/, 'a false overriding retry remains a failure');
accepted = true;
retainRevision = true;
await saveChannelModel(channel, allow);
assert.equal(channel.revision, server.revision, 'metadata-only engine saves may retain the revision');
retainRevision = false;

server = { ...original(), exportData: { metadata: { enabled: true } } };
const legacy = await loadChannelForEdit('one');
legacy.name = 'Repair missing timestamp';
await saveChannelModel(legacy, cancel);
assert.match(writes.at(-1).url, /override=false/, 'a missing timestamp must not enable unconditional override');
assert.ok(legacy.exportData.metadata.lastModified.time > 0);
await assert.rejects(saveChannelModel({ id: 'uncaptured' }, allow), /original channel/);

server = null;
const draft = { id: 'new', name: 'New', revision: 0 };
channelEditState(draft, true);
accepted = false;
await assert.rejects(saveChannelModel(draft, allow), /did not confirm/);
assert.equal(channelEditState(draft).isNew, true);
accepted = true;
await saveChannelModel(draft, allow);
assert.equal(channelEditState(draft, true).isNew, false, 'a handoff cannot turn an accepted creation into another POST');
draft.name = 'After partial save';
await saveChannelModel(draft, allow);
assert.match(writes.at(-1).url, /\/channels\/new\?/);
console.log('channel-save: shared baselines, conflicts, failed reads/writes, precision, Swing timestamps and same-user choices, legacy timestamps and create checkpoints passed');

const checkpointWrites = writes.length;
await saveChannelModel(draft, { ...allow, skipUnchanged: true });
assert.equal(writes.length, checkpointWrites, 'retrying a later stage must not save the accepted channel again');

for (const editAfterFailure of [false, true]) {
    server = null;
    const interrupted = { id: 'interrupted', name: 'Interrupted creation', revision: 0,
        properties: { metaDataColumns: { metaDataColumn: [] } } };
    channelEditState(interrupted, true);
    loseAfterWrite = true;
    const before = writes.length;
    await assert.rejects(saveChannelModel(interrupted, allow), /lost create response/);
    server.properties.metaDataColumns = null;
    if (editAfterFailure) {
        interrupted.name = 'Edited after lost response';
        interrupted.properties.metaDataColumns.metaDataColumn.push({ name: 'NEW', type: 'STRING' });
    }
    loseAfterWrite = false;
    assert.equal(await saveChannelModel(interrupted, { ...allow, skipUnchanged: true }), true);
    const attempted = writes.slice(before);
    assert.equal(attempted.filter(write => write.url.endsWith('/channels')).length, 1, 'lost create response cannot cause a second POST');
    assert.equal(attempted.length, editAfterFailure ? 2 : 1);
    assert.equal(server.name, interrupted.name);
    if (editAfterFailure) assert.deepEqual(server.properties, interrupted.properties, 'later metadata edits survive recovery');
}

server = null;
const unknown = { id: 'unknown', name: 'Unknown creation', revision: 0 };
channelEditState(unknown, true);
writeFails = true;
await assert.rejects(saveChannelModel(unknown, allow), /lost response/);
writeFails = false;
const beforeRetry = writes.length;
assert.equal(await saveChannelModel(unknown, { ...allow, confirmCreationRetry: async () => false }), false);
assert.equal(writes.length, beforeRetry, 'unknown creation needs an explicit retry when it cannot yet be found');
assert.equal(await saveChannelModel(unknown, { ...allow, confirmCreationRetry: async () => true }), true);
assert.equal(writes.length, beforeRetry + 1);
console.log('channel-save: partial-stage retry, lost creation receipt, later edits and explicit unknown-outcome retry passed');

// Engine JSON collapses singleton collection elements, without changing the
// Java model. Keep identity, timestamps, actual content and ordering strict.
for (const mismatch of [null, 'content', 'timestamp', 'identity', 'order']) {
    server = null;
    const recovered = { id: `normalized-${mismatch}`, name: 'Normalized', description: '', revision: 0,
        destinationConnectors: { connector: [{ metaDataId: 1, name: 'Destination',
            properties: { resourceIds: { entry: [{ string: ['resource-id', 'Resource'] }] } } }] },
        properties: { metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING' }] } },
        pluginField: { values: { string: ['first', 'second'] }, text: 'preserve  whitespace' } };
    channelEditState(recovered, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(recovered, allow), /lost create response/);
    loseAfterWrite = false;
    server.description = null;
    server.destinationConnectors.connector = server.destinationConnectors.connector[0];
    server.destinationConnectors.connector.properties.resourceIds.entry = server.destinationConnectors.connector.properties.resourceIds.entry[0];
    server.properties.metaDataColumns.metaDataColumn = server.properties.metaDataColumns.metaDataColumn[0];
    if (mismatch === 'content') server.pluginField.text = 'changed';
    if (mismatch === 'timestamp') server.exportData.metadata.lastModified.time++;
    if (mismatch === 'identity') server.id = 'replacement';
    if (mismatch === 'order') server.pluginField.values.string.reverse();
    const before = writes.length;
    if (mismatch) await assert.rejects(saveChannelModel(recovered, { ...allow, skipUnchanged: true }), /could not be verified/);
    else {
        assert.equal(await saveChannelModel(recovered, { ...allow, skipUnchanged: true }), true);
        assert.equal(channelEditState(recovered).isNew, false);
        assert.ok(Array.isArray(recovered.destinationConnectors.connector));
    }
    assert.equal(writes.length, before, 'recovery must not duplicate creation or overwrite an unverified model');
}
for (const field of ['dependencyIds', 'dependentIds']) {
    server = original();
    server.exportData[field] = '';
    const graphEdit = await loadChannelForEdit('one');
    server.exportData[field] = { string: 'prerequisite' };
    const before = writes.length, prompts = confirmations;
    assert.equal(await saveChannelModel(graphEdit, { ...cancel, skipUnchanged: true }), true);
    assert.equal(writes.length, before);
    assert.equal(confirmations, prompts);
    server.name = 'Real concurrent channel edit';
    assert.equal(await saveChannelModel(graphEdit, cancel), false);
    assert.equal(confirmations, prompts + 1, 'real concurrent edits still require confirmation');
}
console.log('channel-save: singleton recovery and rejection boundaries, graph-only changes and real conflicts passed');

// Empty repeated children emit no XML elements. Their containing element still
// exists, unlike a missing field or a present child with a null value.
for (const mismatch of [null, 'column', 'missing wrapper', 'null child', 'attribute', 'empty attribute', 'scalar', 'whitespace']) {
    server = null;
    const cleared = { id: `cleared-${mismatch}`, name: 'Cleared columns', revision: 0,
        properties: { metaDataColumns: { metaDataColumn: [] }, resourceIds: { '@class': 'linked-hash-map', entry: [] } },
        sourceConnector: { filter: { elements: { rule: [] } } },
        pluginField: { '@empty': '', empty: {}, items: { item: [] }, text: '  ', enabled: false, count: 0 } };
    channelEditState(cleared, true);
    const beforeDraft = structuredClone(cleared);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(cleared, allow), /lost create response/);
    loseAfterWrite = false;
    server.properties.metaDataColumns = null;
    delete server.properties.resourceIds.entry;
    server.sourceConnector.filter.elements = null;
    server.pluginField.empty = null;
    server.pluginField.items = null;
    if (mismatch === 'column') server.properties.metaDataColumns = { metaDataColumn: { name: 'CHANGED', type: 'STRING' } };
    if (mismatch === 'missing wrapper') delete server.properties.metaDataColumns;
    if (mismatch === 'null child') server.properties.metaDataColumns = { metaDataColumn: null };
    if (mismatch === 'attribute') delete server.properties.resourceIds['@class'];
    if (mismatch === 'empty attribute') server.pluginField['@empty'] = null;
    if (mismatch === 'scalar') server.pluginField.enabled = 0;
    if (mismatch === 'whitespace') server.pluginField.text = '';
    const beforeWrites = writes.length;
    if (mismatch) await assert.rejects(saveChannelModel(cleared, { ...allow, skipUnchanged: true }), /could not be verified/);
    else {
        assert.equal(await saveChannelModel(cleared, { ...allow, skipUnchanged: true }), true);
        assert.deepEqual(cleared.properties, beforeDraft.properties, 'wire comparison cannot rewrite the draft');
        assert.deepEqual(cleared.pluginField, beforeDraft.pluginField);
    }
    assert.equal(writes.length, beforeWrites, 'recovery cannot duplicate creation or write over a mismatch');
}
console.log('channel-save: empty collections, attributes and scalar/missing-field rejection boundaries passed');

// AutoPrimitiveTarget converts only exact non-attribute JSON primitive text.
// Other lexical forms must stay distinct; do not coerce with Number()/trim().
for (const [submitted, persisted] of [
    ['123', 123], ['-0', 0], ['12.50', 12.5], ['1e3', 1000], ['-2.5E-2', -0.025],
    ['true', true], ['false', false], ['null', null],
    ['first\rsecond', 'first\nsecond'], ['first\r\nsecond', 'first\nsecond'],
    ['9007199254740993', 9007199254740992],
    ...['001', '+1', '1.', 'TRUE', ' false ', 'null\n', '123\n', '123\r', 'NaN', 'Infinity', '[1]', '{"x":1}'].map(value => [value, value])
]) {
    server = null;
    const scalar = { id: `scalar-${submitted}`, name: 'Scalar text', description: submitted, revision: 0,
        pluginField: { '@text': submitted, text: submitted } };
    channelEditState(scalar, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(scalar, allow), /lost create response/);
    loseAfterWrite = false;
    server.description = persisted;
    server.pluginField.text = persisted;
    const before = writes.length;
    assert.equal(await saveChannelModel(scalar, { ...allow, skipUnchanged: true }), true, String(submitted));
    assert.equal(writes.length, before, 'scalar reconciliation sends neither create nor update');
    assert.equal(scalar.description, submitted, 'comparison leaves submitted text intact');
    assert.equal(scalar.pluginField['@text'], submitted);
}
for (const [submitted, persisted] of [['001', 1], ['+1', 1], ['123\n', 123], ['123\r', 123], ['true', false], ['null', 'Null'], ['123', 124]]) {
    server = null;
    const scalar = { id: 'changed-scalar', description: submitted, revision: 0 };
    channelEditState(scalar, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(scalar, allow), /lost create response/);
    loseAfterWrite = false;
    server.description = persisted;
    const before = writes.length;
    await assert.rejects(saveChannelModel(scalar, { ...allow, skipUnchanged: true }), /could not be verified/);
    assert.equal(writes.length, before);
}
console.log('channel-save: exact scalar text recovery and lexical/content rejection boundaries passed');

for (const changed of [false, true]) {
    server = null;
    const templateDraft = { id: 'template-scalar', revision: 0, sourceConnector: {
        transformer: { inboundTemplate: '123', outboundTemplate: 'false' } } };
    channelEditState(templateDraft, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(templateDraft, allow), /lost create response/);
    loseAfterWrite = false;
    if (changed) server.sourceConnector.transformer.inboundTemplate.$ = btoa('1.23e2');
    const before = writes.length;
    if (changed) await assert.rejects(saveChannelModel(templateDraft, { ...allow, skipUnchanged: true }), /could not be verified/);
    else assert.equal(await saveChannelModel(templateDraft, { ...allow, skipUnchanged: true }), true);
    assert.equal(writes.length, before);
    assert.equal(templateDraft.sourceConnector.transformer.inboundTemplate, '123');
}
for (const text of ['1e999', '-1e999']) {
    server = null;
    const overflow = { id: 'overflow', description: text, revision: 0 };
    channelEditState(overflow, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(overflow, allow), /lost create response/);
    loseAfterWrite = false;
    server.description = null;
    const before = writes.length;
    await assert.rejects(saveChannelModel(overflow, { ...allow, skipUnchanged: true }), /could not be verified/);
    assert.equal(writes.length, before, 'numeric overflow must not collapse into an unrelated null');
}
console.log('channel-save: encoded template identity and numeric overflow remain guarded');

for (const mode of ['unordered', 'changed value', 'ordered']) {
    server = null;
    const entry = [
        { string: ['regex.pattern0', '(first)'] }, { string: ['regex.mimetype0', 'text/plain'] },
        { string: ['regex.pattern1', '(second)'] }, { string: ['regex.mimetype1', 'application/xml'] },
        { string: ['é', 'same'] }, { string: ['e\u0301', 'same'] }
    ];
    const map = { entry, ...(mode === 'ordered' ? { '@class': 'linked-hash-map' } : {}) };
    const attachment = { id: 'attachment-map', revision: 0,
        properties: { attachmentProperties: { type: 'Regex',
            className: 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider', properties: map } } };
    channelEditState(attachment, true);
    loseAfterWrite = true;
    await assert.rejects(saveChannelModel(attachment, allow), /lost create response/);
    loseAfterWrite = false;
    server.properties.attachmentProperties.properties.entry = [entry[0], entry[3], entry[2], entry[1], entry[5], entry[4]].map(item => structuredClone(item));
    if (mode === 'changed value') server.properties.attachmentProperties.properties.entry[0].string[1] = '(changed)';
    const before = writes.length;
    if (mode === 'unordered') assert.equal(await saveChannelModel(attachment, { ...allow, skipUnchanged: true }), true);
    else await assert.rejects(saveChannelModel(attachment, { ...allow, skipUnchanged: true }), /could not be verified/);
    assert.equal(writes.length, before);
    assert.deepEqual(attachment.properties.attachmentProperties.properties.entry, entry);
}
console.log('channel-save: unordered attachment maps recover; changed values and ordered maps remain guarded');

for (const failure of ['unavailable', 'session ended']) {
    server = null;
    const acceptedDraft = { id: `readback-${failure}`, name: 'Accepted before readback', revision: 0 };
    channelEditState(acceptedDraft, true);
    readbackFailure = failure;
    const before = writes.length;
    if (failure === 'session ended') {
        await assert.rejects(saveChannelModel(acceptedDraft, allow), /previous session/);
    } else {
        assert.equal(await saveChannelModel(acceptedDraft, allow), true, 'an ordinary readback failure retains the accepted save');
    }
    assert.equal(writes.length, before + 1);
    assert.equal(server.id, acceptedDraft.id);
    assert.equal(channelEditState(acceptedDraft).isNew, false, 'session cancellation cannot erase the accepted creation checkpoint');
    readbackFailure = null;
}
console.log('channel-save: readback availability and session cancellation preserve the accepted create checkpoint');
