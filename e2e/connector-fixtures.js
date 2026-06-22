/*
 * Fixtures for the per-connector round-trip tests (connector-roundtrip.spec.js).
 *
 * Each CASE is a connector `properties` block shaped like a real engine export —
 * correct @class, the nested *ConnectorProperties, the resourceIds linked-hash-map,
 * and the fields the React panel manages. makeChannel() drops the connector into a
 * minimal FULL_CHANNEL-shaped channel (the same shape channel-roundtrip.spec.js
 * proved round-trips) as either the source or the single destination, with a plain
 * VM connector on the other side.
 *
 * The test opens the connector's panel and Saves; a correct panel renders the
 * loaded properties without mutating them, so the PUT body's connector properties
 * must deep-equal the fixture. A failure means the panel dropped/renamed/reordered
 * or normalized a field on load — exactly the regression class the parity work risks.
 *
 * Property blocks are factories (return a fresh object) so one test can't mutate
 * another's expected value.
 */

const V = '4.5.0';
const RESOURCE_IDS = () => ({ '@class': 'linked-hash-map', entry: { string: ['Default Resource', '[Default Resource]'] } });

// The common source/destination wrapper every connector's properties embed
// (mirrors forms.js defaultSource/DestinationProperties; `overrides` matches the
// per-connector tweaks, e.g. TCP's responseVariable / validateResponse).
export const sourceConnectorProperties = (overrides = {}) => ({
    '@version': V, responseVariable: 'None', respondAfterProcessing: true, processBatch: false,
    firstResponse: false, processingThreads: 1, queueBufferSize: 1000, resourceIds: RESOURCE_IDS(), ...overrides
});

export const destinationConnectorProperties = (overrides = {}) => ({
    '@version': V, queueEnabled: false, sendFirst: false, retryIntervalMillis: 10000,
    regenerateTemplate: false, retryCount: 0, rotate: false, includeFilterTransformer: false,
    threadCount: 1, threadAssignmentVariable: null, validateResponse: false, reattachAttachments: true,
    resourceIds: RESOURCE_IDS(), queueBufferSize: 1000, ...overrides
});

// Other shared sub-objects (forms.js defaultListener/Poll, react-forms defaultFrameMode, jms.jsx jmsConnectorDefaults).
const listenerProps = (port) => ({ '@version': V, host: '0.0.0.0', port: String(port) });
const pollProps = () => ({
    '@version': V, pollingType: 'INTERVAL', pollOnStart: false, pollingFrequency: 5000,
    pollingHour: 0, pollingMinute: 0, cronJobs: null,
    pollConnectorPropertiesAdvanced: {
        weekly: true, inactiveDays: { boolean: [false, false, false, false, false, false, false, false] },
        dayOfMonth: 1, allDay: true, startingHour: 8, startingMinute: 0, endingHour: 17, endingMinute: 0
    }
});
const frameMode = () => ({
    '@class': 'com.mirth.connect.model.transmission.framemode.FrameModeProperties',
    pluginPointName: 'MLLP', startOfMessageBytes: '0B', endOfMessageBytes: '1C0D'
});
const jmsConnection = () => ({
    useJndi: false, jndiProviderUrl: '', jndiInitialContextFactory: '', jndiConnectionFactoryName: '',
    connectionFactoryClass: '', connectionProperties: { '@class': 'linked-hash-map' },
    username: '', password: '', destinationName: '', topic: false, clientId: ''
});

/* ---- per-connector property blocks ---- */

const vmReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties', '@version': V,
    pluginProperties: null, sourceConnectorProperties: sourceConnectorProperties()
});

const vmDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties', '@version': V,
    pluginProperties: null, destinationConnectorProperties: destinationConnectorProperties(),
    channelId: 'none', channelTemplate: '${message.encodedData}'
});

const httpReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.http.HttpReceiverProperties', '@version': V, pluginProperties: null,
    listenerConnectorProperties: listenerProps('80'), sourceConnectorProperties: sourceConnectorProperties(),
    xmlBody: false, parseMultipart: true, includeMetadata: false,
    binaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*', binaryMimeTypesRegex: true,
    responseContentType: 'text/plain', responseDataTypeBinary: false, responseStatusCode: '',
    responseHeaders: { '@class': 'linked-hash-map' }, responseHeadersVariable: '', useResponseHeadersVariable: false,
    charset: 'UTF-8', contextPath: '', timeout: '30000', staticResources: { '@class': 'java.util.ArrayList' }
});
const httpDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    host: '', useProxyServer: false, proxyAddress: '', proxyPort: '', method: 'post',
    headers: { '@class': 'linked-hash-map' }, parameters: { '@class': 'linked-hash-map' },
    useHeadersVariable: false, headersVariable: '', useParametersVariable: false, parametersVariable: '',
    responseXmlBody: false, responseParseMultipart: true, responseIncludeMetadata: false,
    responseBinaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*', responseBinaryMimeTypesRegex: true,
    multipart: false, useAuthentication: false, authenticationType: 'Basic', usePreemptiveAuthentication: false,
    username: '', password: '', content: '', contentType: 'text/plain', dataTypeBinary: false, charset: 'UTF-8', socketTimeout: '30000'
});

const tcpReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.tcp.TcpReceiverProperties', '@version': V, pluginProperties: null,
    listenerConnectorProperties: listenerProps('6661'),
    sourceConnectorProperties: sourceConnectorProperties({ responseVariable: 'Auto-generate (After source transformer)', firstResponse: true }),
    transmissionModeProperties: frameMode(),
    serverMode: true, remoteAddress: '', remotePort: '', overrideLocalBinding: false, reconnectInterval: '5000',
    receiveTimeout: '0', bufferSize: '65536', maxConnections: '10', keepConnectionOpen: true,
    dataTypeBinary: false, charsetEncoding: 'DEFAULT_ENCODING', respondOnNewConnection: 0,
    responseAddress: '', responsePort: '', responseConnectorPluginProperties: null
});
const tcpDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties({ validateResponse: true }),
    transmissionModeProperties: frameMode(),
    serverMode: false, remoteAddress: '127.0.0.1', remotePort: '6660', overrideLocalBinding: false,
    localAddress: '0.0.0.0', localPort: '0', sendTimeout: '5000', bufferSize: '65536', maxConnections: '10',
    keepConnectionOpen: false, checkRemoteHost: false, responseTimeout: '5000', ignoreResponse: false,
    queueOnResponseTimeout: true, dataTypeBinary: false, charsetEncoding: 'DEFAULT_ENCODING', template: '${message.encodedData}'
});

const fileReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.file.FileReceiverProperties', '@version': V, pluginProperties: null,
    pollConnectorProperties: pollProps(), sourceConnectorProperties: sourceConnectorProperties(),
    scheme: 'FILE', schemeProperties: null, host: '', fileFilter: '*', regex: false, directoryRecursion: false,
    ignoreDot: true, anonymous: true, username: '', password: '', timeout: '10000', secure: true, passive: true,
    validateConnection: true, afterProcessingAction: 'NONE', moveToDirectory: '', moveToFileName: '',
    errorReadingAction: 'NONE', errorResponseAction: 'AFTER_PROCESSING', errorMoveToDirectory: '', errorMoveToFileName: '',
    checkFileAge: true, fileAge: '1000', fileSizeMinimum: '0', fileSizeMaximum: '', ignoreFileSizeMaximum: true,
    sortBy: 'date', binary: false, charsetEncoding: 'DEFAULT_ENCODING'
});
const fileDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.file.FileDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    scheme: 'FILE', schemeProperties: null, host: '', outputPattern: '', anonymous: true, username: '', password: '',
    timeout: '10000', keepConnectionOpen: true, maxIdleTime: '0', secure: true, passive: true, validateConnection: true,
    outputAppend: true, errorOnExists: false, temporary: false, binary: false, charsetEncoding: 'DEFAULT_ENCODING', template: ''
});

const dbReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', '@version': V, pluginProperties: null,
    pollConnectorProperties: pollProps(), sourceConnectorProperties: sourceConnectorProperties(),
    driver: 'Please Select One', url: '', username: '', password: '', select: '', update: '', useScript: false,
    aggregateResults: false, cacheResults: true, keepConnectionOpen: true, updateMode: 1, retryCount: '3',
    retryInterval: '10000', fetchSize: '1000', encoding: 'DEFAULT_ENCODING'
});
const dbDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    driver: 'Please Select One', url: '', username: '', password: '', query: '', parameters: null, useScript: false
});

const jmsReceiver = () => Object.assign({
    '@class': 'com.mirth.connect.connectors.jms.JmsReceiverProperties', '@version': V, pluginProperties: null,
    sourceConnectorProperties: sourceConnectorProperties(), selector: '', reconnectIntervalMillis: '10000', durableTopic: false
}, jmsConnection());
const jmsDispatcher = () => Object.assign({
    '@class': 'com.mirth.connect.connectors.jms.JmsDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(), template: '${message.encodedData}'
}, jmsConnection());

/* The table the spec iterates. `properties` is a factory. `name` is the connector's
   transportName (what registerConnectorPanel keys on); `class` is the expected @class. */
export const CASES = [
    { name: 'Channel Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.vm.VmReceiverProperties', properties: vmReceiver },
    { name: 'Channel Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.vm.VmDispatcherProperties', properties: vmDispatcher },
    { name: 'HTTP Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.http.HttpReceiverProperties', properties: httpReceiver },
    { name: 'HTTP Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.http.HttpDispatcherProperties', properties: httpDispatcher },
    { name: 'TCP Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.tcp.TcpReceiverProperties', properties: tcpReceiver },
    { name: 'TCP Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties', properties: tcpDispatcher },
    { name: 'File Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.file.FileReceiverProperties', properties: fileReceiver },
    { name: 'File Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.file.FileDispatcherProperties', properties: fileDispatcher },
    { name: 'Database Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', properties: dbReceiver },
    { name: 'Database Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', properties: dbDispatcher },
    { name: 'JMS Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.jms.JmsReceiverProperties', properties: jmsReceiver },
    { name: 'JMS Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.jms.JmsDispatcherProperties', properties: jmsDispatcher },
];

/* Build a channel with `conn` ({ transportName, properties }) plugged in as the
   source or single destination; the other side is a plain VM connector. */
export function makeChannel(id, { source, destination } = {}) {
    const src = source || { transportName: 'Channel Reader', properties: vmReceiver() };
    const dst = destination || { transportName: 'Channel Writer', properties: vmDispatcher() };
    return {
        '@version': V, id, nextMetaDataId: 2, name: `RT ${id}`, description: 'desc', revision: 3,
        sourceConnector: {
            '@version': V, metaDataId: 0, name: 'sourceConnector', properties: src.properties,
            transformer: { '@version': V, elements: '', inboundTemplate: '', outboundTemplate: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
            filter: { '@version': V, elements: '' },
            transportName: src.transportName, mode: 'SOURCE', enabled: true, waitForPrevious: true
        },
        destinationConnectors: { connector: [{
            '@version': V, metaDataId: 1, name: 'Destination 1', properties: dst.properties,
            transformer: { '@version': V, elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
            responseTransformer: { '@version': V, elements: '', inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null },
            filter: { '@version': V, elements: '' },
            transportName: dst.transportName, mode: 'DESTINATION', enabled: true, waitForPrevious: true
        }] },
        preprocessingScript: 'return message;', postprocessingScript: 'return;', deployScript: 'return;', undeployScript: 'return;',
        properties: {
            '@version': V, clearGlobalChannelMap: true, messageStorageMode: 'DEVELOPMENT', encryptData: false,
            removeContentOnCompletion: false, removeOnlyFilteredOnCompletion: false, removeAttachmentsOnCompletion: false,
            storeAttachments: false, metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] },
            attachmentProperties: { '@version': V, type: 'None', properties: null }, resourceIds: RESOURCE_IDS(), initialState: 'STARTED'
        }
    };
}
