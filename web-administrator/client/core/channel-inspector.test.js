import assert from 'node:assert/strict';
import { inspectChannel, mapKeysIn, hasCode } from './channel-inspector.js';

const JS_STEP = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const BUILDER = 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
const RULE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const JS_RULE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const ITERATOR_RULE = 'com.mirth.connect.model.IteratorRule';
const DSF = 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep';
const XSLT = 'com.mirth.connect.plugins.xsltstep.XsltStep';
const PAIR = 'org.apache.commons.lang3.tuple.ImmutablePair';

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

// Configured source remains inspectable, including default script bodies.
assert.deepEqual(r.deploy.map(e => e.name), ['Deploy script', 'Undeploy script']);
assert.equal(r.deploy[0].detail, channel.deployScript);
assert.deepEqual(r.preprocessor.map(e => e.detail), [channel.preprocessingScript]);
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
assert.equal(hasCode('// c\n/* d */\n  return;  '), true);
assert.equal(hasCode('return message;'), true);
assert.equal(hasCode("logger.info('x');\nreturn;"), true);
for (const script of [undefined, null]) assert.equal(hasCode(script), false);
for (const script of ['', ' \t\r\n']) assert.equal(hasCode(script), true);

// A bare return and a line break after return change the message in the shipped
// preprocessor/attachment engine paths, as do empty and whitespace-only bodies.
// Preserve configured source in every context without inferring a no-op.
function allScriptContexts(script) {
    return {
        globals: { Deploy: script, Undeploy: script, Preprocessor: script, Postprocessor: script },
        draft: {
            deployScript: script, undeployScript: script, preprocessingScript: script, postprocessingScript: script,
            properties: { attachmentProperties: { type: 'JavaScript', properties: script == null ? null : { entry: { string: ['javascript.script', script] } } } },
            sourceConnector: { transportName: 'Database Reader', properties: { useScript: true, select: script, updateMode: 2, update: script } },
            destinationConnectors: { connector: [
                destination(1, 'JavaScript', { transportName: 'JavaScript Writer', properties: { script } }),
                destination(2, 'Database', { transportName: 'Database Writer', properties: { useScript: true, query: script } }),
                destination(3, 'Disabled JavaScript', { enabled: false, transportName: 'JavaScript Writer', properties: { script } }),
                destination(4, 'Disabled database', { enabled: 'false', transportName: 'Database Writer', properties: { useScript: true, query: script } })
            ] }
        }
    };
}
for (const script of [
    'return;', 'return\nmessage;', 'return\r\nmessage;', 'return\u2028message;', 'return\u2029message;',
    'return/*\n*/message;', 'return// comment\nmessage;', ' \nreturn message;\r\n ',
    '// default comment\nreturn;', "/* $g('commentOnly') */", '// comment only',
    false, 0, 'null', undefined, null, '', ' \t\r\n'
]) {
    const { draft, globals } = allScriptContexts(script);
    const original = structuredClone({ draft, globals });
    const inspected = inspectChannel(draft, globals);
    const rows = [...inspected.deploy, ...inspected.preprocessor, ...inspected.postprocessor,
        ...inspected.source.attachment, ...inspected.source.poll, ...inspected.source.postprocess,
        ...inspected.destinations.flatMap(d => d.send)];
    const present = script != null;
    assert.equal(rows.length, present ? 15 : 0);
    for (const row of rows) {
        assert.equal(row.detail, String(script));
        assert.equal(row.isScript, true);
    }
    const reader = inspectChannel({ sourceConnector: { transportName: 'JavaScript Reader', properties: { script } } });
    assert.deepEqual(reader.source.poll.map(el => el.detail), present ? [String(script)] : []);
    assert.deepEqual(inspected.maps, [], 'comment text must not create active map references');
    assert.deepEqual({ draft, globals }, original);
    assert.deepEqual(inspectChannel(draft, globals), inspected);
}
const withScriptReferences = allScriptContexts("/* $g('commentOnly') */\n$g('read'); $g('write', 1); return;");
const referencedScripts = inspectChannel(withScriptReferences.draft, withScriptReferences.globals);
assert.deepEqual(referencedScripts.maps.map(m => [m.key, m.readers.length, m.writers.length]), [['read', 13, 0], ['write', 0, 13]]);
const disabledScriptIds = referencedScripts.destinations.filter(d => !d.enabled).flatMap(d => d.send.map(el => el.id));
assert.equal(referencedScripts.maps.some(m => [...m.readers, ...m.writers].some(id => disabledScriptIds.includes(id))), false);

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
assert.equal(inspectChannel({ deployScript: '' }).deploy[0].detail, '');

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

// Built-in senders show the payload the engine sends and their request settings.
// HTTP content is sent only for POST, PUT and PATCH; credential-named headers are redacted.
const sender = (metaDataId, transportName, properties) => destination(metaDataId, transportName, { transportName, properties: { ...properties, destinationConnectorProperties: {} } });
const senders = inspectChannel({ destinationConnectors: { connector: [
    sender(1, 'HTTP Sender', { method: 'post', content: '{"id":"${msgId}"}', multipart: false,
        headers: { '@class': 'linked-hash-map', entry: [{ string: 'Accept', list: { string: ['a', 'b'] } }, { string: 'X-Api-Key', list: { string: 'secret' } }] },
        useParametersVariable: true, parametersVariable: 'query', useAuthentication: true, authenticationType: 'Basic', usePreemptiveAuthentication: true }),
    sender(2, 'HTTP Sender', { method: 'GET', content: 'ignored by the engine' }),
    sender(3, 'TCP Sender', { template: 'MSH|${message.encodedData}', ignoreResponse: true }),
    sender(4, 'SMTP Sender', { to: 'a@example', cc: 'cc@example', html: true, body: '<p>${message}</p>',
        headers: { entry: { string: ['X-Token', 'secret'] } },
        attachments: { '@class': 'java.util.ArrayList', 'com.mirth.connect.connectors.smtp.Attachment': { name: 'msg.hl7', content: '${message.encodedData}', mimeType: 'text/plain' } } }),
    sender(5, 'SMTP Sender', { body: 'b', isUseAttachmentsVariable: true, attachmentsVariable: 'files',
        attachments: { 'com.mirth.connect.connectors.smtp.Attachment': { name: 'skipped', content: 'skipped' } } }),
    sender(6, 'Web Service Sender', { envelope: '<soap:Envelope/>', soapAction: 'urn:send', oneWay: true,
        attachmentNames: { string: ['a', 'b'] }, attachmentContents: { string: ['A', 'B'] }, attachmentTypes: { string: 'text/xml' } })
] } });
const sent = senders.destinations.map(d => ({ settings: Object.fromEntries(d.settings), send: d.send.map(el => [el.name, el.detail, el.typeLabel]) }));
assert.equal(sent[0].settings.Headers, 'Accept: a\nAccept: b\nX-Api-Key: [redacted]');
assert.equal(sent[0].settings['Query parameters'], 'From map variable query');
assert.equal(sent[0].settings.Authentication, 'Basic · preemptive');
assert.equal(sent[0].settings.Multipart, 'No');
assert.deepEqual(sent[0].send, [['Request body', '{"id":"${msgId}"}', 'Template']]);
assert.deepEqual(sent[1].send, []);
assert.equal(sent[1].settings.Multipart, undefined);
assert.deepEqual(sent[2].send, [['Template', 'MSH|${message.encodedData}', 'Template']]);
assert.equal(sent[2].settings['Ignore response'], 'Yes');
assert.equal(sent[3].settings.CC, 'cc@example');
assert.equal(sent[3].settings.Headers, 'X-Token: [redacted]');
assert.equal(sent[3].settings['Body format'], 'HTML');
assert.deepEqual(sent[3].send, [['Body', '<p>${message}</p>', 'Template'], ['Attachment msg.hl7 · text/plain', '${message.encodedData}', 'Template']]);
assert.equal(sent[4].settings.Attachments, 'From list variable files');
assert.deepEqual(sent[4].send.map(([name]) => name), ['Body']);
assert.equal(sent[5].settings['SOAP action'], 'urn:send');
assert.equal(sent[5].settings.Invocation, 'One-way');
assert.deepEqual(sent[5].send, [['SOAP envelope', '<soap:Envelope/>', 'Template'], ['Attachment a · text/xml', 'A', 'Template'], ['Attachment b', 'B', 'Template']]);
// Payload templates are not JavaScript: no map claims and no routing.
assert.equal(senders.maps.length, 0);

// Enabled destinations write d<metaDataId>; ResponseMap.get also resolves their names.
// Disabled destinations write nothing, so their keys keep the no-writer warning.
const responseReads = inspectChannel({
    postprocessingScript: "$r('d1'); responseMap.get('Lab'); $r('d2'); $r('Off'); $r('custom');",
    destinationConnectors: { connector: [destination(1, 'Lab'), destination(2, 'Off', { enabled: false })] }
});
const responseWriters = Object.fromEntries(responseReads.maps.map(m => [m.key, m.writers.map(id => responseReads.owners[id])]));
assert.deepEqual(responseWriters, { custom: [], d1: ['D1 Lab · destination response'], d2: [], Lab: ['D1 Lab · destination response'], Off: [] });
assert.equal(responseReads.maps.find(m => m.key === 'd1').writers[0], 'ci-dest-1');
assert.equal(Object.hasOwn(inspectChannel({ destinationConnectors: { connector: destination(1, 'Lab') } }).owners, 'ci-dest-1'), false);

// Poll schedules follow TriggerFactory: interval or daily time limited by the day calendar; cron alone.
const poll = (pollConnectorProperties) => Object.fromEntries(inspectChannel({ sourceConnector: { transportName: 'File Reader', properties: { pollConnectorProperties } } }).source.settings);
const advanced = (extra = {}) => ({ weekly: true, inactiveDays: { boolean: [false, true, false, false, false, false, false, true] }, dayOfMonth: 1, allDay: false, startingHour: 8, startingMinute: 0, endingHour: 17, endingMinute: 30, ...extra });
assert.deepEqual(['Poll', 'Poll on start', 'Poll days', 'Poll hours'].map(k => poll({ pollingType: 'INTERVAL', pollingFrequency: 5000, pollOnStart: true, pollConnectorPropertiesAdvanced: advanced() })[k]),
    ['Every 5 s', 'Yes', 'Every day except Sun, Sat', '08:00 to 17:30']);
assert.deepEqual(['Poll', 'Poll days', 'Poll hours'].map(k => poll({ pollingType: 'TIME', pollingHour: 6, pollingMinute: 5, pollConnectorPropertiesAdvanced: advanced({ weekly: false, dayOfMonth: 15 }) })[k]),
    ['Daily at 06:05', 'Day 15 of each month', undefined]);
assert.equal(poll({ pollingType: 'INTERVAL', pollingFrequency: 250, pollConnectorPropertiesAdvanced: advanced({ allDay: true, inactiveDays: { boolean: Array(8).fill(false) } }) })['Poll hours'], 'All day');
const cron = poll({ pollingType: 'CRON', cronJobs: { cronProperty: [{ description: 'Nightly', expression: '0 0 2 * * ?' }, { expression: '0 */5 * * * ?' }] }, pollConnectorPropertiesAdvanced: advanced() });
assert.equal(cron.Poll, '0 0 2 * * ? · Nightly\n0 */5 * * * ?');
assert.equal(cron['Poll days'], undefined);
assert.equal(poll(undefined).Poll, undefined);

// Attachment storage and pruning flags are part of the storage story.
const storage = Object.fromEntries(inspectChannel({ properties: { storeAttachments: true, removeAttachmentsOnCompletion: true },
    exportData: { metadata: { pruningSettings: { pruneMetaDataDays: 30, archiveEnabled: true, pruneErroredMessages: false } } } }).storage);
assert.deepEqual([storage['Store attachments'], storage['Remove attachments on completion'], storage['Archive before pruning'], storage['Prune errored messages']], ['Yes', 'Yes', 'Yes', 'No']);

// Destination and response data type properties are retained for display.
const typed = inspectChannel({ destinationConnectors: { connector: destination(1, 'Typed', {
    transformer: { elements: null, inboundDataType: 'HL7V2', outboundDataType: 'XML', inboundProperties: { a: 1 }, outboundProperties: { b: 2 } },
    responseTransformer: { elements: null, inboundDataType: 'XML', outboundDataType: 'HL7V2', inboundProperties: { c: 3 }, outboundProperties: { d: 4 } } }) } }).destinations[0];
assert.deepEqual([typed.inboundProperties, typed.outboundProperties, typed.responseInboundType, typed.responseOutboundType, typed.responseInboundProperties, typed.responseOutboundProperties],
    [{ a: 1 }, { b: 2 }, 'XML', 'HL7V2', { c: 3 }, { d: 4 }]);

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

// Iterator rules expose the two settings that change acceptance and child-rule
// execution. New rules explicitly serialize any + early termination; omitted
// imported boolean fields become false in the shipped serializer.
for (const [intersectIterations, acceptance, earlyStop] of [
    [false, 'Any iteration passes', 'On first passing iteration'],
    ['false', 'Any iteration passes', 'On first passing iteration'],
    [true, 'All iterations pass', 'On first failing iteration'],
    ['true', 'All iterations pass', 'On first failing iteration'],
    [undefined, 'Any iteration passes', 'On first passing iteration'],
    [null, 'Any iteration passes', 'On first passing iteration']
]) {
    for (const [breakEarly, stop] of [
        [true, earlyStop], ['true', earlyStop],
        [false, 'No · evaluate every iteration'], ['false', 'No · evaluate every iteration'],
        [undefined, 'No · evaluate every iteration'], [null, 'No · evaluate every iteration']
    ]) {
        const filter = { elements: { [ITERATOR_RULE]: { name: 'Same custom name', properties: {
            target: 'values', indexVariable: 'i', intersectIterations, breakEarly
        } } } };
        const draft = {
            sourceConnector: { filter: structuredClone(filter) },
            destinationConnectors: { connector: destination(1, 'Filter', { filter: structuredClone(filter) }) }
        };
        const original = structuredClone(draft);
        const inspected = inspectChannel(draft);
        for (const rows of [inspected.sourceFilter, inspected.destinations[0].filter]) {
            assert.equal(rows[0].detail, `For each values · index variable i\nAccept if: ${acceptance}\nStop early: ${stop}`);
        }
        assert.deepEqual(draft, original, 'describing default settings must not populate the draft');
        assert.deepEqual(inspectChannel(draft), inspected);
    }
}

// Nested and disabled rules retain their settings, without making skipped map
// access appear active. Destination disablement also excludes the whole tree.
for (const enabled of [true, false, 'false']) {
    const filter = { elements: { [ITERATOR_RULE]: { name: 'Outer', enabled, properties: {
        target: "$c('outerRows')", indexVariable: 'i', intersectIterations: false, breakEarly: false,
        children: { [ITERATOR_RULE]: { name: 'Inner', enabled: true, properties: {
            target: "$c('innerRows')", indexVariable: 'j', intersectIterations: 'true', breakEarly: 'true',
            children: { [JS_RULE]: { name: 'Leaf', enabled: true, script: "return $c('leafRead');" } }
        } } }
    } } } };
    const draft = {
        sourceConnector: { filter: structuredClone(filter) },
        destinationConnectors: { connector: [
            destination(1, 'Enabled', { filter: structuredClone(filter) }),
            destination(2, 'Disabled', { enabled: false, filter: structuredClone(filter) })
        ] }
    };
    const original = structuredClone(draft);
    const inspected = inspectChannel(draft);
    for (const rows of [inspected.sourceFilter, ...inspected.destinations.map(d => d.filter)]) {
        assert.deepEqual(rows.map(el => el.depth), [0, 1, 2]);
        assert.deepEqual(rows.map(el => el.enabled), Array(3).fill(enabled === true));
        assert.deepEqual(rows.map(el => el.skippedByParent), [false, enabled !== true, enabled !== true]);
        assert.ok(rows[0].detail.endsWith('Accept if: Any iteration passes\nStop early: No · evaluate every iteration'));
        assert.ok(rows[1].detail.endsWith('Accept if: All iterations pass\nStop early: On first failing iteration'));
    }
    assert.deepEqual(inspected.maps.map(m => [m.key, m.readers.length]), enabled === true ? [['innerRows', 2], ['leafRead', 2], ['outerRows', 2]] : []);
    assert.deepEqual(draft, original);
}
const stepWithRuleFields = inspectChannel({ sourceConnector: { transformer: { elements: { [ITERATOR]: {
    properties: { target: 'values', indexVariable: 'i', intersectIterations: true, breakEarly: false }
} } } } });
assert.equal(stepWithRuleFields.sourceTransformer[0].detail, 'For each values · index variable i', 'rule-only settings must not describe IteratorStep');

// Global hooks surround the channel hooks in execution order.
const withGlobals = inspectChannel(channel, {
    Deploy: "$g('deploy', true);", Undeploy: "$g('undeploy', true);",
    Preprocessor: "$g('incoming', message); return message;", Postprocessor: "$g('outgoing', 1);"
});
assert.deepEqual(withGlobals.deploy.map(e => e.name), ['Global deploy script', 'Deploy script', 'Undeploy script', 'Global undeploy script']);
assert.deepEqual(withGlobals.preprocessor.map(e => e.name), ['Global preprocessor', 'Preprocessor']);
assert.deepEqual(withGlobals.postprocessor.map(e => e.name), ['Postprocessor', 'Global postprocessor']);
assert.ok(withGlobals.maps.find(m => m.map === 'globalMap' && m.key === 'incoming'));
assert.deepEqual(withGlobals.sourceTransformer.map(e => e.id), r.sourceTransformer.map(e => e.id), 'global loading cannot move the open channel rows');

// Database Reader script mode uses select, not a nonexistent script field.
const database = inspectChannel({ sourceConnector: { transportName: 'Database Reader', properties: { useScript: true, select: 'return [];', sourceConnectorProperties: { respondAfterProcessing: false } } } });
assert.equal(database.source.poll[0].detail, 'return [];');
assert.equal(database.source.respondAfterProcessing, false);

// Outbound templates drive output even with zero steps. Their literal contents
// are not executed as JavaScript or counted as map access.
for (const value of ['SOURCE_TEMPLATE', '0', 'false', "literal $c('notACall')", ' \n<root>π</root>\n ']) {
    const draft = structuredClone(channel);
    draft.sourceConnector.transformer = { elements: '', outboundTemplate: value };
    draft.destinationConnectors.connector[0].transformer = { elements: '', outboundTemplate: value };
    draft.destinationConnectors.connector[0].responseTransformer = { elements: '', outboundTemplate: value };
    const beforeTemplates = JSON.stringify(draft);
    const inspected = inspectChannel(draft);
    assert.equal(JSON.stringify(draft), beforeTemplates);
    for (const list of [inspected.source.outboundTemplate, inspected.destinations[0].outboundTemplate, inspected.destinations[0].responseTemplate]) {
        assert.equal(list[0].detail, value);
        assert.equal(list[0].typeLabel, 'Template');
        assert.deepEqual([list[0].reads, list[0].writes], [[], []]);
    }
    assert.equal(inspected.maps.some(m => m.key === 'notACall'), false);
}
assert.deepEqual(inspectChannel({ sourceConnector: { transformer: { outboundTemplate: ' \r\n\t' } } }).source.outboundTemplate, []);

// Database post-processing follows updateMode, including imported string enums.
for (const mode of [1, 2, 3, '2', '3']) {
    for (const aggregateResults of [true, false]) {
        const draft = { sourceConnector: { transportName: 'Database Reader', properties: {
            useScript: true, updateMode: mode, aggregateResults,
            select: 'return new java.util.ArrayList();',
            update: "globalChannelMap.put('processedRows', 1);"
        } } };
        const beforeDatabase = JSON.stringify(draft);
        const inspected = inspectChannel(draft);
        assert.equal(JSON.stringify(draft), beforeDatabase);
        assert.equal(inspected.source.postprocessMode, Number(mode));
        assert.equal(inspected.source.aggregateResults, aggregateResults);
        assert.equal(inspected.source.postprocess.length, Number(mode) === 1 ? 0 : 1);
        assert.equal(inspected.maps.some(m => m.key === 'processedRows'), Number(mode) !== 1);
    }
}
const sql = inspectChannel({ sourceConnector: { transportName: 'Database Reader', properties: {
    useScript: false, updateMode: 3, update: "UPDATE work SET state = 'processed' WHERE id = 42"
} } });
assert.equal(sql.source.postprocess[0].typeLabel, 'SQL');
assert.equal(sql.source.postprocess[0].isScript, false);
assert.equal(sql.source.postprocess[0].detail, "UPDATE work SET state = 'processed' WHERE id = 42");
assert.deepEqual(sql.maps, []);

// Every transform surface reads the same complete built-in configuration.
// Native replacement pairs are typed scalar wrappers, not a map: order matters.
function stepEverywhere(type, element) {
    const transformer = { elements: { [type]: { enabled: true, ...element } } };
    return {
        sourceConnector: { transformer: structuredClone(transformer) },
        destinationConnectors: { connector: [
            destination(1, 'Enabled', { transformer: structuredClone(transformer), responseTransformer: structuredClone(transformer) }),
            destination(2, 'Disabled', { enabled: false, transformer: structuredClone(transformer), responseTransformer: structuredClone(transformer) })
        ] }
    };
}
const nativePair = (left, right) => ({ left: { '@class': 'string', $: left }, right: { '@class': 'string', $: right } });
for (const type of [MAPPER, BUILDER]) {
    const draft = stepEverywhere(type, {
        variable: 'normalized', messageSegment: "msg['account']", mapping: "'123-45'", scope: 'CHANNEL',
        replacements: { [PAIR]: [nativePair("'-'", "''"), nativePair("$c('pattern')", "$gc('replacement')")] }
    });
    const original = JSON.stringify(draft);
    const inspected = inspectChannel(draft);
    for (const list of [inspected.sourceTransformer, inspected.destinations[0].transformer, inspected.destinations[0].response, inspected.destinations[1].transformer]) {
        assert.ok(list[0].detail.endsWith("Replacements (in order):\n1. '-' → ''\n2. $c('pattern') → $gc('replacement')"));
        assert.deepEqual(list[0].reads, [{ map: 'channelMap', key: 'pattern' }, { map: 'globalChannelMap', key: 'replacement' }]);
    }
    assert.equal(inspected.maps.find(m => m.key === 'pattern').readers.length, 3, 'disabled destinations do not contribute replacement readers');
    if (type === MAPPER) assert.equal(inspected.maps.find(m => m.key === 'normalized').writers.length, 3);
    assert.equal(JSON.stringify(draft), original);
}
for (const replacements of [
    { [PAIR]: nativePair('false', 'null') },
    { entry: { left: 'false', right: 'null' } },
    [{ string: ['false', 'null'] }]
]) {
    assert.ok(inspectChannel(stepEverywhere(MAPPER, { replacements })).sourceTransformer[0].detail.endsWith('1. false → null'));
}
for (const [left, right] of [['0', 'false'], ['null', ''], [0, false], [null, null]]) {
    const draft = stepEverywhere(MAPPER, { replacements: { [PAIR]: nativePair(left, right) } });
    const original = JSON.stringify(draft);
    const inspected = inspectChannel(draft);
    assert.ok(inspected.sourceTransformer[0].detail.endsWith(`1. ${String(left)} → ${String(right)}`));
    assert.equal(JSON.stringify(draft), original);
}
const expressionWrite = inspectChannel(stepEverywhere(BUILDER, { replacements: { [PAIR]: nativePair("'-'", "($c('replacementUsed', true), '')") } }));
assert.equal(expressionWrite.maps.find(m => m.key === 'replacementUsed').writers.length, 3);
const nestedReplacement = inspectChannel({ sourceConnector: { transformer: { elements: {
    [ITERATOR]: { enabled: false, properties: { children: { [MAPPER]: { enabled: true, replacements: { [PAIR]: nativePair("$c('hiddenPattern')", "''") } } } } }
} } } });
assert.deepEqual(nestedReplacement.maps, []);

for (const useCustomFactory of [true, 'true', false, 'false']) {
    const draft = stepEverywhere(XSLT, { sourceXml: "$c('payload')", resultVariable: 'converted', template: "$gc('stylesheet')", useCustomFactory, customFactory: 'example.TransformerFactory' });
    const original = JSON.stringify(draft);
    const inspected = inspectChannel(draft);
    for (const list of [inspected.sourceTransformer, inspected.destinations[0].transformer, inspected.destinations[0].response]) {
        assert.ok(list[0].detail.startsWith("Source XML: $c('payload')\nResult variable: converted"));
        assert.ok(list[0].detail.endsWith("Template:\n$gc('stylesheet')"));
        assert.equal(list[0].detail.includes('Custom factory: example.TransformerFactory'), useCustomFactory === true || useCustomFactory === 'true');
    }
    assert.equal(inspected.maps.find(m => m.key === 'payload').readers.length, 3);
    assert.equal(inspected.maps.find(m => m.key === 'stylesheet').readers.length, 3);
    assert.equal(inspected.maps.find(m => m.key === 'converted').writers.length, 3);
    assert.equal(JSON.stringify(draft), original);
}

// Effective queue behavior follows the engine guard, including retained inactive
// settings and imported string booleans. Queue labels must agree with the flags.
for (const queueEnabled of [false, true]) for (const regenerateTemplate of [false, true]) {
    for (const includeFilterTransformer of [false, true]) for (const sendFirst of [false, true]) {
        for (const encode of [v => v, v => String(v)]) {
            const q = Object.fromEntries(Object.entries({ queueEnabled, regenerateTemplate, includeFilterTransformer, sendFirst }).map(([k, v]) => [k, encode(v)]));
            const draft = { destinationConnectors: { connector: destination(1, 'Queue', { properties: { destinationConnectorProperties: q } }) } };
            const original = JSON.stringify(draft);
            const inspected = inspectChannel(draft);
            const d = inspected.destinations[0];
            const effective = queueEnabled && regenerateTemplate && includeFilterTransformer;
            assert.equal(d.filterTransformerInQueue, effective);
            assert.equal(d.sendFirst, sendFirst);
            assert.deepEqual(d.queue.find(f => f[0] === 'Include filter/transformer'), queueEnabled ? ['Include filter/transformer', effective ? 'Yes' : 'No'] : undefined);
            assert.equal(JSON.stringify(draft), original);
            assert.deepEqual(inspectChannel(draft), inspected);
        }
    }
}

// A JavaScript attachment handler precedes preprocessing and participates in
// references; stale properties on another handler type must not be treated as code.
const attachmentScript = "globalChannelMap.put('attachmentSeen', true); return 'sanitized';";
const withAttachment = structuredClone(channel);
withAttachment.properties.attachmentProperties = { type: 'JavaScript', properties: { entry: { string: ['javascript.script', attachmentScript] } } };
assert.deepEqual(inspectChannel(withAttachment).sourceTransformer.map(el => el.id), r.sourceTransformer.map(el => el.id), 'attachment source cannot move existing channel rows');
for (const entry of [{ string: ['javascript.script', attachmentScript] }, [{ string: ['other', 'ignored'] }, { string: ['javascript.script', attachmentScript] }]]) {
    const draft = { properties: { attachmentProperties: { type: 'JavaScript', properties: { entry } } } };
    const original = JSON.stringify(draft);
    const inspected = inspectChannel(draft);
    assert.equal(inspected.source.attachment[0].detail, attachmentScript);
    assert.equal(inspected.source.attachment[0].name, 'Attachment handler script');
    assert.deepEqual(inspected.maps.find(m => m.key === 'attachmentSeen').writers, [inspected.source.attachment[0].id]);
    assert.equal(JSON.stringify(draft), original);
    draft.properties.attachmentProperties.type = 'None';
    assert.deepEqual(inspectChannel(draft).source.attachment, []);
    assert.deepEqual(inspectChannel(draft).maps, []);
}
for (const script of ['false', 'null', '123', 'return message;', '']) {
    const inspected = inspectChannel({ properties: { attachmentProperties: { type: 'JavaScript', properties: { entry: { string: ['javascript.script', script] } } } } });
    assert.deepEqual(inspected.source.attachment.map(el => el.detail), [script]);
}
for (const useScript of [false, true, 'false', 'true']) {
    const inspected = inspectChannel({ sourceConnector: { transportName: 'Database Reader', properties: { useScript, aggregateResults: true, updateMode: 2, update: 'UPDATE work SET polled = 1' } } });
    assert.equal(inspected.source.useScript, useScript === true || useScript === 'true');
    assert.equal(inspected.source.aggregateResults, true);
    assert.equal(inspected.source.postprocessMode, 2);
}

// A minimal channel never throws.
const empty = inspectChannel({ name: 'x', sourceConnector: {}, destinationConnectors: '' });
assert.deepEqual([empty.destinations, empty.chains, empty.maps, empty.response.label], [[], [], [], 'No response']);

console.log('channel-inspector: ok');
