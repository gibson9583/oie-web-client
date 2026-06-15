/*
 * Engine model helpers.
 *
 * The engine serializes its Java model with XStream, so the JSON we receive
 * has some conventions to deal with:
 *   - "@class"/"@version" keys are XML attributes and MUST round-trip on save
 *   - polymorphic collections (filter rules, transformer steps) arrive as an
 *     object keyed by Java class name: { "com.x.JavaScriptStep": {...}|[...] }
 *   - single-element lists arrive as a bare object instead of an array
 */

export function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/* ---- polymorphic element collections (filter rules / transformer steps) ---- */

export function elementsToArray(elements) {
    if (!elements || typeof elements !== 'object') return [];
    const out = [];
    for (const [type, value] of Object.entries(elements)) {
        if (type.startsWith('@')) continue;
        for (const item of Array.isArray(value) ? value : [value]) {
            if (item && typeof item === 'object') out.push({ __type: type, ...item });
        }
    }
    out.sort((a, b) => Number(a.sequenceNumber ?? 0) - Number(b.sequenceNumber ?? 0));
    return out;
}

export function arrayToElements(items) {
    if (!items || !items.length) return null;
    const elements = {};
    items.forEach((item, index) => {
        const { __type, ...rest } = item;
        rest.sequenceNumber = String(index);
        // Attribute keys ('@class'/'@version') MUST be the first keys: the
        // engine converts this JSON to XML and cannot place an attribute after
        // child elements, and its reorder fallback does not descend into arrays
        // (these objects live in arrays). Out-of-order attributes either drop
        // the element or fail the whole channel ("Cannot read attribute").
        const ordered = {};
        for (const k of Object.keys(rest)) if (k.startsWith('@')) ordered[k] = rest[k];
        for (const k of Object.keys(rest)) if (!k.startsWith('@')) ordered[k] = rest[k];
        (elements[__type] = elements[__type] || []).push(ordered);
    });
    return elements;
}

/* ---- channel / connector state ------------------------------------------------ */

export const CHANNEL_STATES = ['STARTED', 'STARTING', 'STOPPED', 'STOPPING', 'PAUSED', 'PAUSING', 'UNDEPLOYED', 'DEPLOYING', 'UNDEPLOYING', 'SYNCING', 'UNKNOWN'];

export function statePip(state) {
    switch (state) {
        case 'STARTED': return 'ok';
        case 'PAUSED': return 'warn';
        case 'STOPPED': return 'err';
        case 'STARTING': case 'STOPPING': case 'PAUSING':
        case 'DEPLOYING': case 'UNDEPLOYING': case 'SYNCING': return 'busy';
        default: return '';
    }
}

export function stateLabel(state) {
    if (!state) return 'Unknown';
    return state.charAt(0) + state.slice(1).toLowerCase();
}

export const MESSAGE_STATUSES = ['RECEIVED', 'FILTERED', 'TRANSFORMED', 'SENT', 'QUEUED', 'ERROR', 'PENDING'];

export function messageStatusTag(status) {
    switch (status) {
        case 'SENT': case 'TRANSFORMED': return 'accent';
        case 'ERROR': return 'red';
        case 'QUEUED': case 'PENDING': return 'blue';
        case 'FILTERED': return 'amber';
        default: return '';
    }
}

/* Data types are no longer listed here — each ships as a web plugin
   (plugins/datatype-*) and is read from the platform registry via
   datatypes/index.js (dataTypeDef / dataTypeList). */

/* ---- filter / transformer element types ---------------------------------------------- */

export const STEP_TYPES = {
    'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': { label: 'JavaScript' },
    'com.mirth.connect.plugins.mapper.MapperStep': { label: 'Mapper' },
    'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': { label: 'Message Builder' },
    'com.mirth.connect.plugins.xsltstep.XsltStep': { label: 'XSLT Step' },
    'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep': { label: 'Destination Set Filter' },
    'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep': { label: 'External Script' },
    'com.mirth.connect.model.IteratorStep': { label: 'Iterator' }
};

export const RULE_TYPES = {
    'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': { label: 'JavaScript' },
    'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': { label: 'Rule Builder' },
    'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule': { label: 'External Script' },
    'com.mirth.connect.model.IteratorRule': { label: 'Iterator' }
};

export function elementTypeLabel(type) {
    const known = STEP_TYPES[type] || RULE_TYPES[type];
    if (known) return known.label;
    return type.split('.').pop();
}

/* ---- new-channel factory ----------------------------------------------------------------
 * Builds a complete default channel (Channel Reader source → one Channel
 * Writer destination, Raw data types) matching the engine's serialized model.
 * `version` should be the engine version string (fetched at login) so the
 * server-side migration accepts the object as current.
 */

const DEFAULT_RESOURCE = {
    '@class': 'linked-hash-map',
    entry: [{ string: ['Default Resource', '[Default Resource]'] }]
};

function rawDataTypeProperties(version) {
    return {
        '@class': 'com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties',
        '@version': version,
        batchProperties: {
            '@class': 'com.mirth.connect.plugins.datatypes.raw.RawBatchProperties',
            '@version': version,
            splitType: 'JavaScript',
            batchScript: null
        }
    };
}

export function emptyTransformer(version) {
    return {
        '@version': version,
        elements: null,
        inboundDataType: 'RAW',
        outboundDataType: 'RAW',
        inboundProperties: rawDataTypeProperties(version),
        outboundProperties: rawDataTypeProperties(version)
    };
}

export function emptyFilter(version) {
    return { '@version': version, elements: null };
}

export function defaultSourceConnector(version) {
    return {
        '@version': version,
        metaDataId: 0,
        name: 'sourceConnector',
        properties: {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: {
                '@version': version,
                responseVariable: 'None',
                respondAfterProcessing: true,
                processBatch: false,
                firstResponse: false,
                processingThreads: 1,
                resourceIds: DEFAULT_RESOURCE,
                queueBufferSize: 1000
            }
        },
        transformer: emptyTransformer(version),
        filter: emptyFilter(version),
        transportName: 'Channel Reader',
        mode: 'SOURCE',
        enabled: true,
        waitForPrevious: true
    };
}

export function defaultDestinationConnector(version, metaDataId = 1, name = 'Destination 1') {
    return {
        '@version': version,
        metaDataId,
        name,
        properties: {
            '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: {
                '@version': version,
                queueEnabled: false,
                sendFirst: false,
                retryIntervalMillis: 10000,
                regenerateTemplate: false,
                retryCount: 0,
                rotate: false,
                includeFilterTransformer: false,
                threadCount: 1,
                threadAssignmentVariable: null,
                validateResponse: false,
                resourceIds: DEFAULT_RESOURCE,
                queueBufferSize: 1000,
                reattachAttachments: true
            },
            channelId: 'none',
            channelTemplate: '${message.encodedData}',
            mapVariables: null
        },
        transformer: emptyTransformer(version),
        responseTransformer: emptyTransformer(version),
        filter: emptyFilter(version),
        transportName: 'Channel Writer',
        mode: 'DESTINATION',
        enabled: true,
        waitForPrevious: true
    };
}

export function newChannel(name, version) {
    return {
        '@version': version,
        id: uuid(),
        nextMetaDataId: 2,
        name: name || 'New Channel',
        description: '',
        revision: 0,
        sourceConnector: defaultSourceConnector(version),
        destinationConnectors: { connector: [defaultDestinationConnector(version)] },
        preprocessingScript: '// Modify the message variable below to pre process data\nreturn message;',
        postprocessingScript: '// This script executes once after a message has been processed\n// Responses returned from here will be stored as "Postprocessor" in the response map\nreturn;',
        deployScript: '// This script executes once when the channel is deployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;',
        undeployScript: '// This script executes once when the channel is undeployed\n// You only have access to the globalMap and globalChannelMap here to persist data\nreturn;',
        properties: {
            '@version': version,
            clearGlobalChannelMap: true,
            messageStorageMode: 'DEVELOPMENT',
            encryptData: false,
            encryptAttachments: false,
            encryptCustomMetaData: false,
            removeContentOnCompletion: false,
            removeOnlyFilteredOnCompletion: false,
            removeAttachmentsOnCompletion: false,
            initialState: 'STARTED',
            storeAttachments: false,
            // Default custom metadata columns, matching the engine's
            // ServerSettings.defaultMetaDataColumns (SOURCE + TYPE).
            metaDataColumns: {
                metaDataColumn: [
                    { name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' },
                    { name: 'TYPE', type: 'STRING', mappingName: 'mirth_type' }
                ]
            },
            attachmentProperties: { '@version': version, type: 'None', properties: null },
            resourceIds: DEFAULT_RESOURCE
        },
        exportData: {
            metadata: {
                enabled: true,
                pruningSettings: { archiveEnabled: true }
            }
        }
    };
}

/* ---- misc -------------------------------------------------------------------------------- */

export function destinationsOf(channel) {
    if (!channel || !channel.destinationConnectors) return [];
    const list = channel.destinationConnectors.connector ?? channel.destinationConnectors;
    return Array.isArray(list) ? list : (list ? [list] : []);
}

export function setDestinations(channel, destinations) {
    channel.destinationConnectors = { connector: destinations };
}

/* Structural validation run before any create/save/deploy so the web admin can
   never persist a channel the engine would fail to deploy (e.g. a connector
   with null properties). Returns an array of human-readable problems; empty
   means OK. A connector's properties must be an object carrying its '@class'
   (the polymorphic type the engine needs to construct the connector). */
function connectorProblems(connector, label, problems) {
    if (!connector || typeof connector !== 'object') {
        problems.push(`${label} is missing`);
        return;
    }
    if (!connector.transportName) problems.push(`${label} type is not set`);
    const p = connector.properties;
    if (!p || typeof p !== 'object' || !p['@class']) {
        problems.push(`${label} has no connector settings (properties are missing)`);
    }
}

export function validateChannel(channel) {
    const problems = [];
    if (!channel || typeof channel !== 'object') return ['Channel is empty'];
    if (!channel.name || !String(channel.name).trim()) problems.push('Channel name is required');
    connectorProblems(channel.sourceConnector, 'Source connector', problems);
    const dests = destinationsOf(channel);
    if (!dests.length) problems.push('At least one destination connector is required');
    dests.forEach((d, i) => connectorProblems(d, d && (d.name || `Destination ${d.metaDataId ?? i + 1}`), problems));
    return problems;
}
