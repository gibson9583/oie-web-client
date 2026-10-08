import assert from 'node:assert/strict';
import { channelResponseVariables, loadCustomResponseVariables } from './channel-response.js';
import { discardEngineResponses } from './engine-fetch.js';

const mapper = 'com.mirth.connect.plugins.mapper.MapperStep';
const step = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const rule = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const script = key => ({ script: `responseMap.put('${key}', response);` });
const channel = {
    sourceConnector: {
        filter: { elements: { [rule]: script('sourceRule'), 'example.Rule': { enabled: true, key: 'customRule' } } },
        transformer: { elements: {
            [mapper]: [{ variable: 'mapped', scope: 'RESPONSE' }, { variable: 'ignored', scope: 'CHANNEL' }],
            [step]: [{ ...script('sourceStep'), enabled: true }, { ...script('disabled'), enabled: 'false' }],
            'example.Step': [{ enabled: false, key: 'disabledCustom' }, { enabled: true, sequenceNumber: '7', key: 'customStep' }],
            'com.mirth.connect.model.IteratorStep': { properties: { children: {} } }
        } }
    },
    destinationConnectors: { connector: [{
        transportName: 'JavaScript Writer', properties: script('writer'),
        filter: { elements: { [rule]: { ...script('destRule'), enabled: false }, 'example.Rule': { enabled: false, key: 'disabledDest' } } },
        transformer: { elements: { [step]: script('destStep') } },
        responseTransformer: { elements: { [mapper]: { scope: 'RESPONSE', variable: 'mapped' }, 'example.Step': { key: 'customResponse' } } }
    }] },
    preprocessingScript: "$r('pre', response); $r('getter');",
    postprocessingScript: String.raw`responseMap.put('post\u002dresponse', response);`
};
const before = JSON.stringify(channel);
const found = channelResponseVariables(channel);
assert.deepEqual(found.variables, ['sourceRule', 'mapped', 'sourceStep', 'writer', 'destRule', 'destStep', 'pre', 'post-response']);
const wire = JSON.parse(found.customRequest);
assert.deepEqual(wire.list['example.Rule'], [{ enabled: true, key: 'customRule' }, { enabled: false, key: 'disabledDest' }]);
assert.deepEqual(wire.list['example.Step'], [{ enabled: true, sequenceNumber: '7', key: 'customStep' }, { key: 'customResponse' }]);
assert.equal(wire.list[mapper], undefined, 'bundled discovery stays local');
assert.equal(JSON.stringify(channel), before, 'discovery does not mutate the editor model');
assert.deepEqual(channelResponseVariables(channel), found, 'repeated discovery is idempotent');
channel.sourceConnector.filter.elements['example.Rule'].key = 'unsavedEdit';
assert.notEqual(channelResponseVariables(channel).customRequest, found.customRequest);
assert.equal(wire.list['example.Rule'][0].key, 'customRule', 'request represents one immutable draft');
assert.deepEqual(channelResponseVariables({}), { variables: [], customRequest: '' });
assert.deepEqual(channelResponseVariables({ preprocessingScript: "$r('only', response);" }), { variables: ['only'], customRequest: '' });
for (const useScript of [true, 'true', false, 'false']) {
    const database = { transportName: 'Database Writer', properties: { useScript, query: "responseMap.put('db', response);" } };
    for (const destinationConnectors of [database, [database], { connector: database }, { connector: [database] }]) {
        assert.deepEqual(channelResponseVariables({ destinationConnectors }).variables, useScript === true || useScript === 'true' ? ['db'] : []);
    }
}

let releaseProbe;
const probe = new Promise(resolve => { releaseProbe = resolve; });
const submitted = [];
let reply = () => Response.json({ responseVariables: ['custom', 'custom', ''] });
globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/webplugins')) { await probe; return Response.json([]); }
    submitted.push({ url: String(url), body: JSON.parse(init.body) });
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    assert.ok(init.signal, 'request has a timeout');
    return reply(String(url));
};
const obsoleteProbe = loadCustomResponseVariables(found.customRequest);
discardEngineResponses();
releaseProbe();
await assert.rejects(obsoleteProbe, /previous session/);
assert.equal(submitted.length, 0, 'a capability probe cannot submit after logout');
assert.deepEqual(await loadCustomResponseVariables(found.customRequest), ['custom', '']);
assert.deepEqual(submitted[0].body, wire, 'custom provider receives unsaved fields and original sequence numbers');

for (const result of [null, [], {}, { responseVariables: null }, { responseVariables: ['valid', 1] }]) {
    reply = () => Response.json(result);
    await assert.rejects(loadCustomResponseVariables(found.customRequest), /invalid response variables/);
}
reply = () => new Response('invalid JSON');
await assert.rejects(loadCustomResponseVariables(found.customRequest), SyntaxError);
for (const status of [401, 403, 422, 500, 503]) {
    reply = () => new Response('failure', { status });
    const count = submitted.length;
    await assert.rejects(loadCustomResponseVariables(found.customRequest));
    assert.equal(submitted.length, count + 1, 'only a missing native route permits fallback');
}
reply = () => { throw new TypeError('network down'); };
await assert.rejects(loadCustomResponseVariables(found.customRequest), /network down/);
for (const status of [404, 405]) {
    reply = url => url.includes('/extensions/websupport/')
        ? Response.json({ responseVariables: ['extensionKey'] }) : new Response('', { status });
    assert.deepEqual(await loadCustomResponseVariables(found.customRequest), ['extensionKey'], 'new extension supplements older native helpers');
}
reply = () => new Response('', { status: 404 });
await assert.rejects(loadCustomResponseVariables(found.customRequest), /Update the Web Support extension/);
reply = () => Response.json({ responseVariables: [] });
assert.deepEqual(await loadCustomResponseVariables(found.customRequest), [], 'failures remain retryable');

let complete;
reply = () => new Promise(resolve => { complete = resolve; });
const obsoleteRequest = loadCustomResponseVariables(found.customRequest);
await new Promise(resolve => setImmediate(resolve));
discardEngineResponses();
complete(Response.json({ responseVariables: ['oldSession'] }));
await assert.rejects(obsoleteRequest, /previous session/);
console.log('channel-response: built-in and custom eligibility, immutable drafts, validation, fallback, retries and session fencing passed');
