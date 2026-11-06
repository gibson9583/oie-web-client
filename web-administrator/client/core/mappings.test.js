import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinationMappingsFor, DESTINATION_MAPPINGS } from './mappings.js';
import { generateElementScript } from './step-script.js';
import { elementsToArray } from './oie.js';

const JS = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE = 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
const classes = {
    js: 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties',
    jdbc: 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties',
    file: 'com.mirth.connect.connectors.file.FileDispatcherProperties'
};
const properties = (type = 'file', extra = {}) => ({ '@class': classes[type], destinationConnectorProperties: {}, ...extra });
const stage = (script, type = JS) => ({ elements: { [type]: { enabled: true, sequenceNumber: 0, script } } });
const connector = (name, metaDataId, extra = {}) => ({ name, metaDataId, properties: properties(), ...extra });
const channel = (destinations, sourceConnector = {}) => ({ sourceConnector, destinationConnectors: { connector: destinations } });
const dynamic = (ch, dest) => destinationMappingsFor(dest.properties, ch, dest).filter(([label]) => !DESTINATION_MAPPINGS.some(([builtIn]) => builtIn === label));
const labels = (ch, dest) => dynamic(ch, dest).map(([label]) => label);

test('destination transfer modes keep built-ins, Message Hash and Date in Swing order', () => {
    for (const input of [undefined, null, '', 5, {}, { '@class': classes.js }, { sourceConnectorProperties: {} }]) {
        assert.deepEqual(destinationMappingsFor(input), []);
    }
    for (const input of [properties(), properties('jdbc'), properties('jdbc', { useScript: false }), properties('jdbc', { useScript: 'false' })]) {
        const refs = destinationMappingsFor(input);
        assert.deepEqual(refs, DESTINATION_MAPPINGS);
        assert.deepEqual(refs.slice(8, 11), [
            ['Message Version', '${mirth_version}'], ['Message Hash', '${HASH}'], ['Date', '${DATE}']
        ]);
        const tokens = new Map(refs);
        assert.equal(tokens.get('Message Source'), '${mirth_source}');
        assert.equal(tokens.get('Message Type'), '${mirth_type}');
        assert.equal(tokens.get('Message Version'), '${mirth_version}');
    }
    for (const input of [properties('js'), properties('jdbc', { useScript: true }), properties('jdbc', { useScript: 'true' })]) {
        const refs = new Map(destinationMappingsFor(input));
        assert.equal(refs.get('Message Hash'), 'HashUtil.generate(connectorMessage.getEncodedData())');
        assert.equal(refs.get('Count'), undefined);
        assert.equal(refs.get('Channel ID'), 'channelId');
        assert.equal(refs.get('Channel Name'), 'channelName');
    }
});

test('channel scope and ordering match ChannelSetup rule-set then step-set aggregation', () => {
    const source = {
        filter: stage("$c('sourceRule', 1); $co('sourceLocal', 1);", RULE),
        transformer: stage("$gc('sourceStep', 1); $co('sourceStepLocal', 1);")
    };
    const earlier = connector('Get data from database', 4, {
        enabled: false, // Swing scans enabled elements even in disabled destinations.
        filter: stage("$g('earlierRule', 1); $co('earlierLocal', 1);", RULE),
        transformer: stage("$c('earlierStep', 1); $co('earlierStepLocal', 1);"),
        responseTransformer: stage("$r('earlierResponse', 1); $co('earlierResponseLocal', 1);")
    });
    const selected = connector('Send', 9, {
        filter: stage("$c('selectedRule', 1); $co('selectedLocal', 1);", RULE),
        transformer: stage("$c('selectedStep', 1); $co('selectedStepLocal', 1); $c('sourceRule', 2);"),
        responseTransformer: stage("$c('selectedResponse', 1); $co('selectedResponseLocal', 1);")
    });
    const later = connector('Later', 12, { filter: stage("$c('laterRule',1);", RULE), transformer: stage("$c('laterStep',1);") });
    const ch = channel([earlier, selected, later], source);
    assert.deepEqual(labels(ch, selected), [
        'sourceRule', 'earlierRule', 'Get data from database', 'selectedRule', 'selectedLocal',
        'sourceStep', 'earlierStep', 'earlierResponse', 'selectedStep', 'selectedStepLocal'
    ]);
    assert.equal(new Map(dynamic(ch, selected)).get('Get data from database'), '${d4.message}');
    assert.deepEqual(labels(ch, earlier), ['sourceRule', 'earlierRule', 'earlierLocal', 'sourceStep', 'earlierStep', 'earlierStepLocal']);
    assert.ok(labels(ch, later).includes('selectedResponse'));
    assert.ok(!labels(ch, later).includes('selectedStepLocal'));
});

test('map forms, comments, helper getters and boundaries match VariableListUtil', () => {
    const selected = connector('Selected', 1, { transformer: stage(`
        channelMap . put ( 'channel', 1); globalMap.put("global", 1); globalChannelMap.put('globalChannel', 1); responseMap.put('response', 1);
        connectorMap.put('connector', 1); sourceMap.put('source', 1); configurationMap.put('config', 1);
        $c('shortC', 1); $g('shortG', 1); $gc('shortGC', 1); $r('shortR', 1); $co('shortCO', 1); $s('shortS', 1); $cfg('shortCfg', 1);
        $c('getter'); channelMap.get('anotherGetter'); channelMap.put('onearg');
        mychannelMap.put('prefix', 1); x$c('suffix', 1); _$c('underscored', 1); obj.channelMap.put('member', 1);
        // $c('comment', 1);
        /* $c('block', 1);
        $g('alsoBlock', 1); */ $r('afterBlock', 1);
        var url = 'http://example.test'; $c('afterURL', 1);
        $c('nextLine', 1); $c('channel', 2);
    `) });
    assert.deepEqual(labels(channel(selected), selected), [
        'channel', 'global', 'globalChannel', 'response', 'connector', 'shortC', 'shortG', 'shortGC', 'shortR', 'shortCO',
        'onearg', 'member', 'afterBlock', 'nextLine'
    ]);
});

test('literal decoding and transfer quoting match installed Swing binaries', () => {
    // These results intentionally follow Commons Text, including its \x / \v
    // handling, rather than interpreting a key with eval or a Rhino parser.
    const literals = [
        [String.raw`unicode\u0041`, 'unicodeA'], [String.raw`octal\101`, 'octalA'],
        [String.raw`hex\x41`, 'hexx41'], [String.raw`control\b\f\n\r\t\v`, 'control\b\f\n\r\tv'],
        [String.raw`slash\\path\/end`, 'slash\\path/end'], [String.raw`quote\'`, "quote'"],
        [String.raw`double\"quote`, 'double"quote'], [String.raw`other\q\8\9`, 'otherq89'],
        ['valid_name-1', 'valid_name-1'], ['_leading', '_leading'], ['1leading', '1leading'], ['日本語', '日本語'], ['', '']
    ];
    const selected = connector('Selected', 1, { transformer: stage(literals.map(([literal]) => `$c('${literal}', 1);`).join('\n')) });
    const ch = channel(selected);
    const expected = literals.map(([, key]) => {
        const quote = key.includes("'") ? '"' : "'";
        return [key, /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) ? `\${${key}}` : `\${maps.get(${quote}${key}${quote})}`];
    });
    assert.deepEqual(dynamic(ch, selected), expected);
    selected.properties = properties('js');
    assert.deepEqual(dynamic(ch, selected), literals.map(([, key]) => [key, key.includes("'") ? `$("${key}")` : `$('${key}')`]));
});

test('enabled wire elements and getScript(false) include Mapper expressions and other shipped plugins', () => {
    const selected = connector('Selected', '9', { transformer: { elements: {
        [JS]: [
            { sequenceNumber: '5', script: "$c('last', 1);", enabled: true },
            { sequenceNumber: '0', script: "$c('disabled', 1);", enabled: false },
            { sequenceNumber: '1', script: "$c('disabledString', 1);", enabled: 'false' }
        ],
        [MAPPER]: { sequenceNumber: '2', enabled: 'true', variable: 'patID', mapping: "$c('sideEffect', 1)", defaultValue: "$g('defaultKey', 1)", scope: 'CHANNEL' },
        'com.mirth.connect.plugins.xsltstep.XsltStep': { sequenceNumber: '3', enabled: true, resultVariable: 'xmlResult', sourceXml: "$c('xmlInput', 1)", template: "''" },
        'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': { sequenceNumber: '4', enabled: true, messageSegment: 'tmp', mapping: "$r('builder', 1)", replacements: { 'org.apache.commons.lang3.tuple.ImmutablePair': { left: { '@class': 'string', $: "$gc('replacement', 1)" }, right: { '@class': 'string', $: "''" } } } },
        'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep': { sequenceNumber: '6', enabled: true, scriptPath: "$c('pathIsOnlyAComment', 1)" }
    } }, filter: { elements: {
        'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': { enabled: true, condition: 'EQUALS', field: "$c('ruleField', 1)", values: { string: "$g('ruleValue', 1)" } }
    } } });
    assert.deepEqual(labels(channel(selected), selected), ['ruleField', 'ruleValue', 'sideEffect', 'patID', 'defaultKey', 'xmlInput', 'xmlResult', 'builder', 'replacement', 'last']);
    for (const scope of ['CHANNEL', 'GLOBAL', 'GLOBAL_CHANNEL', 'RESPONSE', 'CONNECTOR']) {
        selected.transformer.elements = { [MAPPER]: { variable: scope, scope, mapping: '1', enabled: true } };
        assert.ok(labels(channel(selected), selected).includes(scope));
    }
});

test('nested iterators retain generated-script ordering and ignore disabled descendants', () => {
    const nested = { enabled: true, properties: { target: 'msg', indexVariable: 'j', children: {
        [MAPPER]: { enabled: true, variable: 'nestedMap', scope: 'CHANNEL', mapping: "$c('nestedExpression', 1)" },
        [JS]: { enabled: 'false', script: "$c('disabledChild', 1);" }
    } } };
    const iterator = { __type: ITERATOR, enabled: true, properties: { target: 'msg', children: {
        [ITERATOR]: nested,
        [JS]: { enabled: true, sequenceNumber: 1, script: "$c('afterNestedIteration',1);" },
        [MAPPER]: { enabled: true, sequenceNumber: 2, variable: 'outerMap', mapping: '1', scope: 'CONNECTOR' }
    } } };
    const script = generateElementScript(iterator, el => elementsToArray(el.properties.children));
    assert.ok(script.indexOf('var _nestedMap') < script.indexOf('for (var i'));
    assert.ok(script.indexOf("channelMap.put('nestedMap'") > script.indexOf("$c('afterNestedIteration'"));
    const selected = connector('Selected', 9, { transformer: { elements: { [ITERATOR]: iterator } } });
    assert.deepEqual(labels(channel(selected), selected), ['nestedExpression', 'afterNestedIteration', 'nestedMap', 'outerMap']);
});

test('deduplicate labels and resolve any destination-name collision through metadata IDs', () => {
    const earlier = connector('Send', 42, { filter: stage("$c('Raw Data',1); $c('Channel ID',1); $c('Send',1);", RULE) });
    const selected = connector('Selected', 9, { transformer: stage("$c('d42',1); $c('Later',1); $c('Count',1);") });
    const ch = channel([earlier, selected, connector('Later', 99)]);
    const refs = destinationMappingsFor(selected.properties, ch, selected);
    assert.equal(refs.filter(([label]) => label === 'Raw Data').length, 1);
    assert.equal(refs.filter(([label]) => label === 'Channel ID').length, 1);
    assert.equal(refs.filter(([label]) => label === 'Send').length, 1);
    assert.equal(new Map(refs).get('Later'), '${d99.message}');
    selected.properties = properties('js');
    const jsRefs = new Map(destinationMappingsFor(selected.properties, ch, selected));
    assert.equal(jsRefs.get('Send'), "$('d42')");
    assert.equal(jsRefs.get('d42'), "$('d42')");
    assert.equal(jsRefs.get('Count'), "$('Count')");
});

test('recompute mutations, selection and ordering without executing scripts or retaining regex state', () => {
    const earlier = connector('Earlier', 4, { transformer: stage("$c('before', globalThis.__mappingScriptExecuted = true);") });
    const selected = connector('Selected', 9);
    const ch = channel([earlier, selected]);
    const original = destinationMappingsFor(selected.properties, ch, selected);
    assert.equal(globalThis.__mappingScriptExecuted, undefined);
    earlier.transformer = stage("$c('after',1);");
    earlier.name = 'Renamed';
    const next = dynamic(ch, { ...selected });
    assert.deepEqual(next, [['Renamed', '${d4.message}'], ['after', '${after}']]);
    assert.ok(original.some(([label]) => label === 'before'));
    assert.deepEqual(dynamic(ch, selected), next);
    ch.destinationConnectors.connector.reverse();
    assert.deepEqual(dynamic(ch, selected), []);
    assert.deepEqual(destinationMappingsFor(selected.properties, ch), destinationMappingsFor(selected.properties, ch, selected));
    assert.deepEqual(destinationMappingsFor(selected.properties, ch, { metaDataId: 100 }), DESTINATION_MAPPINGS);
    assert.deepEqual(destinationMappingsFor(selected.properties, { destinationConnectors: '' }), DESTINATION_MAPPINGS);
});

test('reserved transfer labels take precedence without adding fixed rows', () => {
    const earlier = connector('Server ID', 4);
    const selected = connector('Selected', 9, { transformer: stage("$c('Message with Attachments', 1); $c('Formatted Message Date', 1); $c('Formatted Current Date', 1);") });
    const ch = channel([earlier, selected]);
    let refs = new Map(dynamic(ch, selected));
    assert.equal(refs.get('Server ID'), '${message.serverId}');
    assert.equal(refs.get('Formatted Message Date'), "${date.format('yyyy-MM-dd',$message.getConnectorMessages().get(0).getReceivedDate())}");
    assert.equal(refs.get('Formatted Current Date'), "${date.get('yyyy-MM-dd')}");
    assert.equal(refs.get('Message with Attachments'), "${maps.get('Message with Attachments')}");
    selected.properties = properties('js');
    refs = new Map(dynamic(ch, selected));
    assert.equal(refs.get('Message with Attachments'), 'var rawData = AttachmentUtil.reAttachMessage(connectorMessage)');
    assert.equal(refs.get('Server ID'), "$('d4')");
    assert.equal(refs.get('Formatted Current Date'), "$('Formatted Current Date')");
    for (const props of [properties(), properties('js')]) {
        assert.ok(!destinationMappingsFor(props).some(([label]) => refs.has(label)));
    }
});
