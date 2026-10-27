import assert from 'node:assert/strict';
import { inspectChannel, mapKeysIn, hasCode } from './channel-inspector.js';

const JS_STEP = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
const RULE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const DSF = 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep';

const destination = (metaDataId, name, extra = {}) => ({
    metaDataId, name, transportName: 'TCP Sender', enabled: true, waitForPrevious: true,
    properties: {
        remoteAddress: 'ehr.example', remotePort: '2575', serverMode: false, keepConnectionOpen: true,
        transmissionModeProperties: { pluginPointName: 'MLLP' },
        destinationConnectorProperties: { queueEnabled: false, retryCount: 0, retryIntervalMillis: 10000 }
    },
    filter: { elements: null }, transformer: { elements: null }, responseTransformer: { elements: null },
    ...extra
});

const channel = {
    id: 'c1', name: 'Labs', description: '  Lab results  ', revision: 12,
    deployScript: '// This script executes once when the channel is deployed\nreturn;',
    undeployScript: "globalChannelMap.remove('cache');\nreturn;",
    preprocessingScript: '// Modify the message variable below to pre process data\nreturn message;',
    postprocessingScript: "if ($c('ackCode') !== 'AA') logger.error('rejected');\nreturn;",
    sourceConnector: {
        transportName: 'TCP Listener',
        properties: {
            listenerConnectorProperties: { host: '0.0.0.0', port: '6663' }, serverMode: true,
            transmissionModeProperties: { pluginPointName: 'MLLP' },
            sourceConnectorProperties: { responseVariable: 'd2', respondAfterProcessing: true, processBatch: false, processingThreads: 1 }
        },
        filter: { elements: { [RULE]: [
            { name: 'Results only', sequenceNumber: '0', field: "msg['MSH']['MSH.9']['MSH.9.1']", condition: 'EQUALS', values: { string: "'ORU'" }, operator: 'NONE', enabled: true },
            { name: 'Has OBX', sequenceNumber: '1', field: "msg['OBX']", condition: 'EXISTS', values: null, operator: 'OR', enabled: true }
        ] } },
        transformer: {
            inboundDataType: 'HL7V2', outboundDataType: 'HL7V2',
            elements: {
                [MAPPER]: { name: 'Patient', sequenceNumber: '0', variable: 'patientId', mapping: "msg['PID']['PID.3']", scope: 'CHANNEL', enabled: true },
                [ITERATOR]: { name: 'Each OBX', sequenceNumber: '1', enabled: true, properties: { target: "msg['OBX']", indexVariable: 'i', children: {
                    [BUILDER]: [
                        { name: 'Status', sequenceNumber: '0', messageSegment: "msg['OBX'][i]['OBX.11']", mapping: "'F'", enabled: 'false' },
                        { name: 'Code', sequenceNumber: '1', messageSegment: "msg['OBX'][i]['OBX.3']", mapping: "$c('codeMap')", enabled: true }
                    ]
                } } },
                [JS_STEP]: { name: 'Route', sequenceNumber: '2', script: "if ($c('facility') == 'T') destinationSet.remove(3);\nconnectorMap.put('x', 1);", enabled: true },
                [DSF]: { name: 'Drop training', sequenceNumber: '3', behavior: 'REMOVE', metaDataIds: { int: [3] }, field: "$c('facility')", condition: 'EQUALS', values: { string: "'T'" }, enabled: true }
            }
        }
    },
    destinationConnectors: { connector: [
        destination(1, 'Clinical store', { transportName: 'Database Writer', waitForPrevious: false, properties: { driver: 'org.postgresql.Driver', url: 'jdbc:postgresql://db/labs', useScript: true, query: "var rows = $co('rows');\nreturn;", destinationConnectorProperties: {} } }),
        destination(2, 'EHR delivery', { responseTransformer: { elements: { [MAPPER]: { name: 'Ack', sequenceNumber: '0', variable: 'ackCode', mapping: "msg['MSA']['MSA.1']", scope: 'CHANNEL', enabled: true } } } }),
        destination(3, 'Analytics', { waitForPrevious: false, transportName: 'HTTP Sender', properties: { host: 'https://analytics.example/r', method: 'post', destinationConnectorProperties: { queueEnabled: true, sendFirst: true, retryCount: 0, retryIntervalMillis: 60000, threadCount: 2 } } }),
        destination(4, 'Legacy', { enabled: false })
    ] },
    properties: { messageStorageMode: 'PRODUCTION', encryptData: true, metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', mappingName: 'mirth_source' }] } },
    exportData: { metadata: { pruningSettings: { pruneMetaDataDays: 90 } } }
};

const before = JSON.stringify(channel);
const r = inspectChannel(channel);
assert.equal(JSON.stringify(channel), before, 'inspection must not change the channel');

// Header and source.
assert.equal(r.description, 'Lab results');
assert.equal(r.revision, 12);
assert.equal(r.source.endpoint, '0.0.0.0:6663');
assert.deepEqual(r.source.settings.find(f => f[0] === 'Source queue'), ['Source queue', 'Off · respond after processing']);
assert.deepEqual(r.source.settings.find(f => f[0] === 'Transmission mode'), ['Transmission mode', 'MLLP']);

// Default scripts are not reported; real code is.
assert.deepEqual(r.deploy.map(e => e.name), ['Undeploy script']);
assert.deepEqual(r.preprocessor, []);
assert.equal(r.postprocessor.length, 1);

// Rules: operators and Rule Builder text.
assert.deepEqual(r.sourceFilter.map(e => e.operator), ['', 'OR']);
assert.equal(r.sourceFilter[0].detail, "msg['MSH']['MSH.9']['MSH.9.1'] equals 'ORU'");
assert.equal(r.sourceFilter[1].detail, "msg['OBX'] exists");

// Steps: iterator children are nested and disabled steps are kept.
assert.deepEqual(r.sourceTransformer.map(e => [e.name, e.depth, e.enabled]), [
    ['Patient', 0, true], ['Each OBX', 0, true], ['Status', 1, false], ['Code', 1, true], ['Route', 0, true], ['Drop training', 0, true]
]);
assert.equal(r.sourceTransformer[0].detail, "patientId ← msg['PID']['PID.3']\nMap: channelMap");
assert.equal(r.sourceTransformer[1].detail, "For each msg['OBX'] · index variable i");
assert.ok(r.sourceTransformer[4].routing && r.sourceTransformer[5].routing && !r.sourceTransformer[0].routing);
assert.equal(r.sourceTransformer[5].detail, "Remove destinations D3\nwhen $c('facility') equals 'T'");

// Chains follow the engine: a new chain unless waitForPrevious; disabled are skipped.
assert.deepEqual(r.chains.map(c => c.map(d => d.label)), [['D1', 'D2'], ['D3']]);
assert.equal(r.destinations[3].enabled, false);
assert.equal(r.destinations[1].endpoint, 'ehr.example:2575');
assert.deepEqual(r.destinations[2].queue.slice(0, 3), [['Queue', 'On failure'], ['Retry count', '0'], ['Retry interval', '60 s']]);
assert.ok(r.destinations[2].queued && !r.destinations[1].queued);
assert.deepEqual(r.destinations[2].settings.find(f => f[0] === 'Method'), ['Method', 'POST']);
assert.deepEqual(r.destinations[0].send.map(e => e.name), ['Database script']);

// Response from a destination.
assert.equal(r.response.destination?.name, 'EHR delivery');
assert.equal(r.response.label, 'D2 EHR delivery');

// Storage.
assert.deepEqual(r.storage.slice(0, 2), [['Storage mode', 'Production'], ['Encrypt data', 'Yes']]);
assert.deepEqual(r.storage.find(f => f[0] === 'Prune metadata after'), ['Prune metadata after', '90 days']);
assert.deepEqual(r.storage.find(f => f[0] === 'Prune content after'), ['Prune content after', 'Never']);
assert.deepEqual(r.metadataColumns, [['SOURCE', 'mirth_source']]);

// Map usage: writers and readers by element; disabled elements are ignored.
const usage = Object.fromEntries(r.maps.map(m => [`${m.map}.${m.key}`, m]));
assert.deepEqual(usage['channelMap.ackCode'].writers.map(id => r.owners[id]), ['D2 EHR delivery response · Ack']);
assert.deepEqual(usage['channelMap.ackCode'].readers.map(id => r.owners[id]), ['Postprocessor · Postprocessor']);
assert.deepEqual(usage['channelMap.patientId'].readers, []);
assert.ok(usage['channelMap.codeMap'] && usage['channelMap.codeMap'].writers.length === 0);
assert.ok(usage['connectorMap.x'] && usage['connectorMap.rows']);
assert.ok(usage['globalChannelMap.cache'].writers.length === 1);

// Script scanning.
assert.deepEqual(mapKeysIn("$c('a'); $c(\"b\", 1); channelMap.put('c', 2); $gc('d'); globalMap.get('e'); $co ('f', 3); $c(key);"), {
    reads: [{ map: 'globalMap', key: 'e' }, { map: 'channelMap', key: 'a' }, { map: 'globalChannelMap', key: 'd' }],
    writes: [{ map: 'channelMap', key: 'c' }, { map: 'channelMap', key: 'b' }, { map: 'connectorMap', key: 'f' }]
});
assert.equal(hasCode('// c\n/* d */\n  return;  '), false);
assert.equal(hasCode('return message;'), false);
assert.equal(hasCode("logger.info('x');\nreturn;"), true);

// The API restores these Java String bodies from XML before inspection.
// Empty source remains distinct from the literal "null".
for (const type of [JS_STEP, 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule']) {
    for (const script of ['false', 'true', '123', 'null', '']) {
        const rule = type.includes('javascriptrule');
        const sourceConnector = { [rule ? 'filter' : 'transformer']: { elements: { [type]: { script, enabled: true } } } };
        const inspected = inspectChannel({ sourceConnector });
        const literal = (rule ? inspected.sourceFilter : inspected.sourceTransformer)[0];
        assert.equal(literal.isScript, true);
        assert.equal(literal.detail, String(script));
    }
}
assert.equal(inspectChannel({ deployScript: 'null' }).deploy[0].detail, 'null');
assert.equal(inspectChannel({ deployScript: '' }).deploy.length, 0);

// JSON imports follow the engine's primitive-to-String conversion, without
// inventing "null" source for an empty imported script.
for (const script of [false, true, 123, null]) {
    const literal = inspectChannel({ sourceConnector: { transformer: { elements: { [JS_STEP]: { script } } } } }).sourceTransformer[0];
    assert.equal(literal.isScript, true);
    assert.equal(literal.detail, script === null ? '' : String(script));
}
for (const type of [MAPPER, 'com.mirth.connect.plugins.xsltstep.XsltStep']) {
    for (const key of [0, false]) {
        const el = type === MAPPER ? { variable: key, mapping: '1' } : { resultVariable: key, template: "'<stylesheet/>'" };
        const usage = inspectChannel({ sourceConnector: { transformer: { elements: { [type]: el } } } }).maps;
        assert.deepEqual(usage.map(m => [m.map, m.key, m.writers.length]), [['channelMap', String(key), 1]]);
    }
}
const fileWriter = inspectChannel({ destinationConnectors: { connector: destination(1, 'File', { transportName: 'File Writer', properties: { host: '/drop', outputPattern: 0 } }) } });
assert.equal(fileWriter.destinations[0].endpoint, 'file:///drop/0');

// Literal-looking calls in comments and strings are not map usage.
assert.deepEqual(mapKeysIn('// $c("comment")\n/* channelMap.put("comment2", 1) */\nvar x = "$c(\'string\')"; $c("real");'), {
    reads: [{ map: 'channelMap', key: 'real' }], writes: []
});

// A disabled iterator skips every nested step, including map reads/writes.
const disabledIterator = structuredClone(channel);
disabledIterator.sourceConnector.transformer.elements[ITERATOR].enabled = false;
const disabled = inspectChannel(disabledIterator);
assert.equal(disabled.sourceTransformer.find(el => el.name === 'Code').skippedByParent, true);
assert.equal(disabled.maps.some(m => m.key === 'codeMap'), false);
const disabledDestination = structuredClone(channel);
disabledDestination.destinationConnectors.connector[1].enabled = false;
assert.equal(inspectChannel(disabledDestination).maps.find(m => m.key === 'ackCode').writers.length, 0);

// Global hooks surround the channel hooks in execution order.
const withGlobals = inspectChannel(channel, {
    Deploy: "$g('deploy', true);", Undeploy: "$g('undeploy', true);",
    Preprocessor: "$g('incoming', message); return message;", Postprocessor: "$g('outgoing', 1);"
});
assert.deepEqual(withGlobals.deploy.map(e => e.name), ['Global deploy script', 'Undeploy script', 'Global undeploy script']);
assert.deepEqual(withGlobals.preprocessor.map(e => e.name), ['Global preprocessor']);
assert.deepEqual(withGlobals.postprocessor.map(e => e.name), ['Postprocessor', 'Global postprocessor']);
assert.ok(withGlobals.maps.find(m => m.map === 'globalMap' && m.key === 'incoming'));
assert.deepEqual(withGlobals.sourceTransformer.map(e => e.id), r.sourceTransformer.map(e => e.id), 'global loading cannot move the open channel rows');

// Database Reader script mode uses select, not a nonexistent script field.
const database = inspectChannel({ sourceConnector: { transportName: 'Database Reader', properties: { useScript: true, select: 'return [];', sourceConnectorProperties: { respondAfterProcessing: false } } } });
assert.equal(database.source.poll[0].detail, 'return [];');
assert.equal(database.source.respondAfterProcessing, false);

// A minimal channel never throws.
const empty = inspectChannel({ name: 'x', sourceConnector: {}, destinationConnectors: '' });
assert.deepEqual([empty.destinations, empty.chains, empty.maps, empty.response.label], [[], [], [], 'No response']);

console.log('channel-inspector: ok');
