/* Regression coverage for the engine's order-sensitive JSON -> XML reader. */
import assert from 'node:assert/strict';
import api from './api.js';

let request;
globalThis.fetch = async (url, init) => {
    request = { url: String(url), ...init };
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

function assertAttributesFirst(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(assertAttributesFirst);
    let hasContent = false;
    for (const [key, value] of Object.entries(node)) {
        if (key.startsWith('@')) assert.ok(!hasContent, `${key} follows element content: ${JSON.stringify(node)}`);
        else hasContent = true;
        assertAttributesFirst(value);
    }
}

function freezeTree(node) {
    if (node && typeof node === 'object') {
        Object.values(node).forEach(freezeTree);
        Object.freeze(node);
    }
    return node;
}

// 4.5.2 supplies properties without @version. The editor appends that missing
// attribute after type/code; inside list.codeTemplate[] the server's reorder
// fallback cannot fix it. Scripts must remain byte-for-byte unchanged.
const template = freezeTree({
    '@version': '4.5.2', id: 'template-1', name: 'Delivery status', revision: 1,
    lastModified: { time: 1787852094591, timezone: 'UTC' },
    contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER', 'DESTINATION_DISPATCHER'] } },
    properties: {
        '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties',
        type: 'FUNCTION',
        code: '/** delivery — café */\nfunction status() { return $("ETOR.Id") + "<>&\\\""; }\r\n',
        '@version': '4.5.2'
    }
});
const libraries = freezeTree([{
    id: 'library-1', name: 'Library', revision: 1, description: null,
    includeNewChannels: false, enabledChannelIds: { string: 'channel-1' },
    disabledChannelIds: { string: ['channel-2', 'channel-3'] },
    codeTemplates: { codeTemplate: [{ id: template.id, '@version': '4.5.2' }] },
    '@version': '4.5.2'
}, {
    id: 'library-2', codeTemplates: null, enabledChannelIds: '', disabledChannelIds: { string: [] },
    '@version': '4.5.2'
}]);
const original = JSON.stringify({ libraries, template });
const part = async name => {
    const blob = request.body.get(name);
    assert.equal(blob.type, 'application/json');
    const value = JSON.parse(await blob.text());
    assertAttributesFirst(value);
    return value;
};

let firstParts;
for (const override of [false, true, false]) {
    await api.codeTemplates.bulkUpdate(libraries, [template], ['removed-library'], ['removed-template'], override);
    assert.ok(request.url.endsWith(`/codeTemplateLibraries/_bulkUpdate?override=${override}`));
    assert.ok(request.body instanceof FormData);
    assert.equal(new Headers(request.headers).has('Content-Type'), false); // browser supplies multipart boundary
    const parts = {};
    for (const name of ['libraries', 'updatedCodeTemplates', 'removedLibraryIds', 'removedCodeTemplateIds']) {
        parts[name] = await part(name);
    }
    assert.deepEqual(parts, {
        libraries: { list: { codeTemplateLibrary: libraries } },
        updatedCodeTemplates: { list: { codeTemplate: [template] } },
        removedLibraryIds: { set: { string: ['removed-library'] } },
        removedCodeTemplateIds: { set: { string: ['removed-template'] } }
    });
    const bytes = await Promise.all([...request.body.values()].map(blob => blob.text()));
    if (firstParts) assert.deepEqual(bytes, firstParts, 'conflict and network retries serialize identically');
    else firstParts = bytes;
}
assert.equal(JSON.stringify({ libraries, template }), original, 'serialization preserves editor snapshots and insertion order');

await api.codeTemplates.bulkUpdate([]);
assert.deepEqual(await part('libraries'), { list: { codeTemplateLibrary: [] } });
assert.deepEqual(await part('updatedCodeTemplates'), { list: { codeTemplate: [] } });
assert.deepEqual(await part('removedLibraryIds'), { set: { string: [] } });
assert.deepEqual(await part('removedCodeTemplateIds'), { set: { string: [] } });

// The ordinary JSON and multipart group APIs share the same engine contract.
const envelope = { list: { codeTemplateLibrary: libraries } };
for (const send of [
    () => api.post('/wire-test', envelope),
    () => api.put('/wire-test', envelope),
    () => api.post('/wire-test', envelope.list, { wrapKey: 'list' }),
    () => api.codeTemplates.updateLibraries(libraries, false)
]) {
    await send();
    const value = JSON.parse(request.body);
    assertAttributesFirst(value);
    assert.deepEqual(value, envelope);
}
await api.codeTemplates.update(template.id, template, false);
assertAttributesFirst(JSON.parse(request.body));
assert.deepEqual(JSON.parse(request.body), { codeTemplate: template });
const groups = freezeTree([{
    id: 'group-1', name: 'Group', revision: 1,
    channels: { channel: [{ id: 'channel-1', '@version': '4.5.2' }] }, '@version': '4.5.2'
}]);
await api.channelGroups.bulkUpdate(groups, ['removed-group']);
assert.deepEqual(await part('channelGroups'), { set: { channelGroup: groups } });
assert.deepEqual(await part('removedChannelGroupIds'), { set: { string: ['removed-group'] } });

// The existing Swing endpoint must retain null/all versus empty/none, and
// preserve source-map values (including whitespace and embedded equals signs).
for (const selection of [null, [], [3, 7], undefined]) {
    await api.messages.processNew('test/channel', 'MSH|<>&\r\n', selection,
        ['origin=first', 'origin=last', 'spacing= value=kept ', 'invalid']);
    assert.ok(request.url.endsWith('/channels/test%2Fchannel/messagesWithObj'));
    const raw = JSON.parse(request.body)['com.mirth.connect.donkey.model.message.RawMessage'];
    assert.equal(raw.rawData, 'MSH|<>&\r\n');
    assert.equal(raw.binary, false);
    if (selection === null) assert.equal(Object.hasOwn(raw, 'destinationMetaDataIds'), false);
    else assert.deepEqual(raw.destinationMetaDataIds, { '@class': 'list', int: selection || [] });
    assert.deepEqual(raw.sourceMap, { '@class': 'map', entry: [
        { string: ['origin', 'last'] }, { string: ['spacing', ' value=kept '] }
    ] });
    assertAttributesFirst(raw);
}

// Preserve content order, repeated elements, all attribute names, text nodes,
// JSON escaping, and normal JSON.stringify handling of dates/undefined values.
const mixed = freezeTree({
    list: { item: [
        { z: 0, '@class': 'Example', a: false, '@version': '4.5.2', text: '', '@custom': 'kept' },
        { '$': 'text <>&', '@xmlns': 'urn:test', '@reference': '../item' },
        { nested: [[{ child: null, '@serialization': 'custom' }]], omitted: undefined },
        null, '', false, 0, new Date('2026-09-16T15:37:26Z')
    ] }
});
await api.post('/wire-test', mixed);
const mixedValue = JSON.parse(request.body);
assertAttributesFirst(mixedValue);
assert.deepEqual(mixedValue, JSON.parse(JSON.stringify(mixed)));
assert.deepEqual(Object.keys(mixedValue.list.item[0]).filter(key => !key.startsWith('@')), ['z', 'a', 'text']);

// Reordering arbitrary JSON keys must not invoke the legacy __proto__ setter,
// drop own properties, or turn script-looking text into executable content.
const unusualKeys = freezeTree(JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"text":"</script><script>throw 1</script>","@class":"Example"}'));
await api.post('/wire-test', unusualKeys);
assert.deepEqual(JSON.parse(request.body), unusualKeys);
assert.equal(Object.getPrototypeOf(unusualKeys), Object.prototype);
assert.equal({}.polluted, undefined);
assert.equal(new Headers(request.headers).get('Content-Type'), 'application/json');
assert.equal(new Headers(request.headers).get('X-Requested-With'), 'OpenIntegrationEngine-WebAdmin');
assert.equal(request.credentials, 'same-origin');
assert.equal(request.cache, 'no-store');

// Raw XML, pre-serialized strings, and caller-supplied multipart bodies bypass
// JSON encoding. Their bytes/boundaries must not be altered by the serializer.
for (const send of [api.post, api.put]) {
    const xml = '<list><string>&lt;@version&gt;</string></list>';
    await send('/wire-test', xml, { contentType: 'application/xml' });
    assert.equal(request.body, xml);
    const json = '{"raw":{"text":"unchanged","@version":"4.5.2"}}';
    await send('/wire-test', json);
    assert.equal(request.body, json);
    await send('/wire-test', null);
    assert.equal(request.body, null);
}
const form = new FormData();
form.append('file', new Blob(['unchanged']), 'test.txt');
await api.post('/wire-test', form);
assert.equal(request.body, form);

const cyclic = { child: null, '@version': '4.5.2' };
cyclic.child = cyclic;
assert.throws(() => api.post('/wire-test', cyclic), { name: 'TypeError', message: /circular/i });

console.log('api-xstream.test: passed (bulk saves/retries, JSON writes, groups, nested arrays, raw bodies)');
