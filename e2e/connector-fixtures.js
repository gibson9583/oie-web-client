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
    connectionFactoryClass: 'org.example.CF', connectionProperties: { '@class': 'linked-hash-map' },
    username: '', password: '', destinationName: 'queue.test', topic: false, clientId: ''
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
    host: 'http://example.com', useProxyServer: false, proxyAddress: '', proxyPort: '', method: 'post',
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
    scheme: 'FILE', schemeProperties: null, host: '/tmp/in', fileFilter: '*', regex: false, directoryRecursion: false,
    ignoreDot: true, anonymous: true, username: '', password: '', timeout: '10000', secure: true, passive: true,
    validateConnection: true, afterProcessingAction: 'NONE', moveToDirectory: '', moveToFileName: '',
    errorReadingAction: 'NONE', errorResponseAction: 'AFTER_PROCESSING', errorMoveToDirectory: '', errorMoveToFileName: '',
    checkFileAge: true, fileAge: '1000', fileSizeMinimum: '0', fileSizeMaximum: '', ignoreFileSizeMaximum: true,
    sortBy: 'date', binary: false, charsetEncoding: 'DEFAULT_ENCODING'
});
const fileDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.file.FileDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    scheme: 'FILE', schemeProperties: null, host: '/tmp/out', outputPattern: 'out.txt', anonymous: true, username: '', password: '',
    timeout: '10000', keepConnectionOpen: true, maxIdleTime: '0', secure: true, passive: true, validateConnection: true,
    outputAppend: true, errorOnExists: false, temporary: false, binary: false, charsetEncoding: 'DEFAULT_ENCODING', template: '${message.encodedData}'
});

const dbReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', '@version': V, pluginProperties: null,
    pollConnectorProperties: pollProps(), sourceConnectorProperties: sourceConnectorProperties(),
    driver: 'Please Select One', url: 'jdbc:test', username: '', password: '', select: 'SELECT 1', update: '', useScript: false,
    aggregateResults: false, cacheResults: true, keepConnectionOpen: true, updateMode: 1, retryCount: '3',
    retryInterval: '10000', fetchSize: '1000', encoding: 'DEFAULT_ENCODING'
});
const dbDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    driver: 'Please Select One', url: 'jdbc:test', username: '', password: '', query: 'INSERT 1', parameters: null, useScript: false
});

const jmsReceiver = () => Object.assign({
    '@class': 'com.mirth.connect.connectors.jms.JmsReceiverProperties', '@version': V, pluginProperties: null,
    sourceConnectorProperties: sourceConnectorProperties(), selector: '', reconnectIntervalMillis: '10000', durableTopic: false
}, jmsConnection());
const jmsDispatcher = () => Object.assign({
    '@class': 'com.mirth.connect.connectors.jms.JmsDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(), template: '${message.encodedData}'
}, jmsConnection());

const jsReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.js.JavaScriptReceiverProperties', '@version': V, pluginProperties: null,
    pollConnectorProperties: pollProps(), sourceConnectorProperties: sourceConnectorProperties(), script: 'var x = 1;'
});
const jsDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(), script: 'var x = 1;'
});

const wsReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.ws.WebServiceReceiverProperties', '@version': V, pluginProperties: null,
    listenerConnectorProperties: listenerProps('8081'), sourceConnectorProperties: sourceConnectorProperties(),
    className: 'com.mirth.connect.connectors.ws.DefaultAcceptMessage', serviceName: 'OIE', soapBinding: 'DEFAULT'
});
const wsDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.ws.WebServiceDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    wsdlUrl: 'http://example.com/service?wsdl', service: 'ExampleService', port: 'ExamplePort', operation: 'Press Get Operations', locationURI: '', socketTimeout: '30000',
    useAuthentication: false, username: '', password: '', envelope: '<soap/>', oneWay: false,
    headers: { '@class': 'linked-hash-map' }, headersVariable: '', isUseHeadersVariable: false, useMtom: false,
    attachmentNames: { '@class': 'java.util.ArrayList' }, attachmentContents: { '@class': 'java.util.ArrayList' },
    attachmentTypes: { '@class': 'java.util.ArrayList' }, attachmentsVariable: '', isUseAttachmentsVariable: false,
    soapAction: '', wsdlDefinitionMap: { map: { '@class': 'linked-hash-map' } }
});

const dicomReceiver = () => ({
    '@class': 'com.mirth.connect.connectors.dimse.DICOMReceiverProperties', '@version': V, pluginProperties: null,
    listenerConnectorProperties: listenerProps('104'), sourceConnectorProperties: sourceConnectorProperties(),
    applicationEntity: '', localHost: '', localPort: '', localApplicationEntity: '', soCloseDelay: '50', releaseTo: '5',
    requestTo: '5', idleTo: '60', reaper: '10', rspDelay: '0', pdv1: false, sndpdulen: '16', rcvpdulen: '16', async: '0',
    bigEndian: false, bufSize: '1', defts: false, dest: '', nativeData: false, sorcvbuf: '0', sosndbuf: '0', tcpDelay: true,
    keyPW: '', keyStore: '', keyStorePW: '', noClientAuth: true, nossl2: true, tls: 'notls', trustStore: '', trustStorePW: ''
});
const dicomDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.dimse.DICOMDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    host: '127.0.0.1', port: '104', applicationEntity: '', localHost: '', localPort: '', localApplicationEntity: '',
    template: '${DICOMMESSAGE}', acceptTo: '5000', async: '0', bufSize: '1', connectTo: '0', priority: 'med', passcode: '',
    pdv1: false, rcvpdulen: '16', reaper: '10', releaseTo: '5', rspTo: '60', shutdownDelay: '1000', sndpdulen: '16',
    soCloseDelay: '50', sorcvbuf: '0', sosndbuf: '0', stgcmt: false, tcpDelay: true, ts1: false, uidnegrsp: false,
    username: '', keyPW: '', keyStore: '', keyStorePW: '', noClientAuth: true, nossl2: true, tls: 'notls', trustStore: '', trustStorePW: ''
});

const smtpDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.smtp.SmtpDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    smtpHost: 'mail.example.com', smtpPort: '25', overrideLocalBinding: false, localAddress: '0.0.0.0', localPort: '0', timeout: '5000',
    encryption: 'none', authentication: false, username: '', password: '', to: 'to@example.com', from: 'from@example.com', cc: '', bcc: '', replyTo: '',
    headers: { '@class': 'linked-hash-map' }, headersVariable: '', isUseHeadersVariable: false, subject: '',
    charsetEncoding: 'DEFAULT_ENCODING', html: false, body: '', attachments: { '@class': 'java.util.ArrayList' },
    attachmentsVariable: '', isUseAttachmentsVariable: false
});

const docDispatcher = () => ({
    '@class': 'com.mirth.connect.connectors.doc.DocumentDispatcherProperties', '@version': V, pluginProperties: null,
    destinationConnectorProperties: destinationConnectorProperties(),
    host: '/tmp/out', outputPattern: 'out.pdf', documentType: 'pdf', encrypt: false, output: 'FILE', password: '',
    pageWidth: '8.5', pageHeight: '11', pageUnit: 'INCHES', template: '${message.encodedData}'
});

/* The table the spec iterates. `properties` is a factory. `name` is the connector's
   transportName (what registerConnectorPanel keys on); `class` is the expected @class. */
// `edit` (optional) drives the write-path test (connector-roundtrip.spec.js): a
// top-level, always-enabled text/number field to change in the panel, asserting
// the new value lands in the saved properties. VM (special channel-picker panel)
// and JavaScript (code-only) connectors have no simple field, so they keep just
// the read-path round-trip.
export const CASES = [
    { name: 'Channel Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.vm.VmReceiverProperties', properties: vmReceiver },
    { name: 'Channel Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.vm.VmDispatcherProperties', properties: vmDispatcher },
    { name: 'HTTP Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.http.HttpReceiverProperties', properties: httpReceiver, edit: { key: 'contextPath', value: '/edited' } },
    { name: 'HTTP Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.http.HttpDispatcherProperties', properties: httpDispatcher, edit: { key: 'host', value: 'http://edited.example' } },
    { name: 'TCP Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.tcp.TcpReceiverProperties', properties: tcpReceiver, edit: { key: 'listenerConnectorProperties.port', value: '7777' } },
    { name: 'TCP Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties', properties: tcpDispatcher, edit: { key: 'remoteAddress', value: '10.0.0.9' } },
    { name: 'File Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.file.FileReceiverProperties', properties: fileReceiver, edit: { key: 'fileFilter', value: '*.edited' } },
    { name: 'File Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.file.FileDispatcherProperties', properties: fileDispatcher, edit: { key: 'outputPattern', value: 'edited.txt' } },
    { name: 'Database Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', properties: dbReceiver, edit: { key: 'url', value: 'jdbc:edited' } },
    { name: 'Database Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', properties: dbDispatcher, edit: { key: 'url', value: 'jdbc:edited' } },
    { name: 'JMS Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.jms.JmsReceiverProperties', properties: jmsReceiver, edit: { key: 'destinationName', value: 'editedQueue' } },
    { name: 'JMS Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.jms.JmsDispatcherProperties', properties: jmsDispatcher, edit: { key: 'destinationName', value: 'editedQueue' } },
    { name: 'JavaScript Reader', mode: 'SOURCE', class: 'com.mirth.connect.connectors.js.JavaScriptReceiverProperties', properties: jsReceiver },
    { name: 'JavaScript Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', properties: jsDispatcher },
    { name: 'Web Service Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.ws.WebServiceReceiverProperties', properties: wsReceiver, edit: { key: 'serviceName', value: 'EditedSvc' } },
    { name: 'Web Service Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.ws.WebServiceDispatcherProperties', properties: wsDispatcher, edit: { key: 'socketTimeout', value: '12345' } },
    { name: 'DICOM Listener', mode: 'SOURCE', class: 'com.mirth.connect.connectors.dimse.DICOMReceiverProperties', properties: dicomReceiver, edit: { key: 'applicationEntity', value: 'EDITAE' } },
    { name: 'DICOM Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.dimse.DICOMDispatcherProperties', properties: dicomDispatcher, edit: { key: 'host', value: '10.0.0.5' } },
    { name: 'SMTP Sender', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.smtp.SmtpDispatcherProperties', properties: smtpDispatcher, edit: { key: 'smtpHost', value: 'mail.edited' } },
    { name: 'Document Writer', mode: 'DESTINATION', class: 'com.mirth.connect.connectors.doc.DocumentDispatcherProperties', properties: docDispatcher, edit: { key: 'outputPattern', value: 'edited.pdf' } },
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
