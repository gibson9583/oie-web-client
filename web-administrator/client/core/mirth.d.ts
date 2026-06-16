export function uuid(): string;
export function elementsToArray(elements: any): any[];
export function arrayToElements(items: any): {} | null;
export function statePip(state: any): "" | "ok" | "warn" | "err" | "busy";
export function stateLabel(state: any): any;
export function messageStatusTag(status: any): "" | "accent" | "red" | "blue" | "amber";
export function elementTypeLabel(type: any): any;
export function emptyTransformer(version: any): {
    '@version': any;
    elements: null;
    inboundDataType: string;
    outboundDataType: string;
    inboundProperties: {
        '@class': string;
        '@version': any;
        batchProperties: {
            '@class': string;
            '@version': any;
            splitType: string;
            batchScript: null;
        };
    };
    outboundProperties: {
        '@class': string;
        '@version': any;
        batchProperties: {
            '@class': string;
            '@version': any;
            splitType: string;
            batchScript: null;
        };
    };
};
export function emptyFilter(version: any): {
    '@version': any;
    elements: null;
};
export function defaultSourceConnector(version: any): {
    '@version': any;
    metaDataId: number;
    name: string;
    properties: {
        '@class': string;
        '@version': any;
        pluginProperties: null;
        sourceConnectorProperties: {
            '@version': any;
            responseVariable: string;
            respondAfterProcessing: boolean;
            processBatch: boolean;
            firstResponse: boolean;
            processingThreads: number;
            resourceIds: {
                '@class': string;
                entry: {
                    string: string[];
                }[];
            };
            queueBufferSize: number;
        };
    };
    transformer: {
        '@version': any;
        elements: null;
        inboundDataType: string;
        outboundDataType: string;
        inboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
        outboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
    };
    filter: {
        '@version': any;
        elements: null;
    };
    transportName: string;
    mode: string;
    enabled: boolean;
    waitForPrevious: boolean;
};
export function defaultDestinationConnector(version: any, metaDataId?: number, name?: string): {
    '@version': any;
    metaDataId: number;
    name: string;
    properties: {
        '@class': string;
        '@version': any;
        pluginProperties: null;
        destinationConnectorProperties: {
            '@version': any;
            queueEnabled: boolean;
            sendFirst: boolean;
            retryIntervalMillis: number;
            regenerateTemplate: boolean;
            retryCount: number;
            rotate: boolean;
            includeFilterTransformer: boolean;
            threadCount: number;
            threadAssignmentVariable: null;
            validateResponse: boolean;
            resourceIds: {
                '@class': string;
                entry: {
                    string: string[];
                }[];
            };
            queueBufferSize: number;
            reattachAttachments: boolean;
        };
        channelId: string;
        channelTemplate: string;
        mapVariables: null;
    };
    transformer: {
        '@version': any;
        elements: null;
        inboundDataType: string;
        outboundDataType: string;
        inboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
        outboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
    };
    responseTransformer: {
        '@version': any;
        elements: null;
        inboundDataType: string;
        outboundDataType: string;
        inboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
        outboundProperties: {
            '@class': string;
            '@version': any;
            batchProperties: {
                '@class': string;
                '@version': any;
                splitType: string;
                batchScript: null;
            };
        };
    };
    filter: {
        '@version': any;
        elements: null;
    };
    transportName: string;
    mode: string;
    enabled: boolean;
    waitForPrevious: boolean;
};
export function newChannel(name: any, version: any): {
    '@version': any;
    id: string;
    nextMetaDataId: number;
    name: any;
    description: string;
    revision: number;
    sourceConnector: {
        '@version': any;
        metaDataId: number;
        name: string;
        properties: {
            '@class': string;
            '@version': any;
            pluginProperties: null;
            sourceConnectorProperties: {
                '@version': any;
                responseVariable: string;
                respondAfterProcessing: boolean;
                processBatch: boolean;
                firstResponse: boolean;
                processingThreads: number;
                resourceIds: {
                    '@class': string;
                    entry: {
                        string: string[];
                    }[];
                };
                queueBufferSize: number;
            };
        };
        transformer: {
            '@version': any;
            elements: null;
            inboundDataType: string;
            outboundDataType: string;
            inboundProperties: {
                '@class': string;
                '@version': any;
                batchProperties: {
                    '@class': string;
                    '@version': any;
                    splitType: string;
                    batchScript: null;
                };
            };
            outboundProperties: {
                '@class': string;
                '@version': any;
                batchProperties: {
                    '@class': string;
                    '@version': any;
                    splitType: string;
                    batchScript: null;
                };
            };
        };
        filter: {
            '@version': any;
            elements: null;
        };
        transportName: string;
        mode: string;
        enabled: boolean;
        waitForPrevious: boolean;
    };
    destinationConnectors: {
        connector: {
            '@version': any;
            metaDataId: number;
            name: string;
            properties: {
                '@class': string;
                '@version': any;
                pluginProperties: null;
                destinationConnectorProperties: {
                    '@version': any;
                    queueEnabled: boolean;
                    sendFirst: boolean;
                    retryIntervalMillis: number;
                    regenerateTemplate: boolean;
                    retryCount: number;
                    rotate: boolean;
                    includeFilterTransformer: boolean;
                    threadCount: number;
                    threadAssignmentVariable: null;
                    validateResponse: boolean;
                    resourceIds: {
                        '@class': string;
                        entry: {
                            string: string[];
                        }[];
                    };
                    queueBufferSize: number;
                    reattachAttachments: boolean;
                };
                channelId: string;
                channelTemplate: string;
                mapVariables: null;
            };
            transformer: {
                '@version': any;
                elements: null;
                inboundDataType: string;
                outboundDataType: string;
                inboundProperties: {
                    '@class': string;
                    '@version': any;
                    batchProperties: {
                        '@class': string;
                        '@version': any;
                        splitType: string;
                        batchScript: null;
                    };
                };
                outboundProperties: {
                    '@class': string;
                    '@version': any;
                    batchProperties: {
                        '@class': string;
                        '@version': any;
                        splitType: string;
                        batchScript: null;
                    };
                };
            };
            responseTransformer: {
                '@version': any;
                elements: null;
                inboundDataType: string;
                outboundDataType: string;
                inboundProperties: {
                    '@class': string;
                    '@version': any;
                    batchProperties: {
                        '@class': string;
                        '@version': any;
                        splitType: string;
                        batchScript: null;
                    };
                };
                outboundProperties: {
                    '@class': string;
                    '@version': any;
                    batchProperties: {
                        '@class': string;
                        '@version': any;
                        splitType: string;
                        batchScript: null;
                    };
                };
            };
            filter: {
                '@version': any;
                elements: null;
            };
            transportName: string;
            mode: string;
            enabled: boolean;
            waitForPrevious: boolean;
        }[];
    };
    preprocessingScript: string;
    postprocessingScript: string;
    deployScript: string;
    undeployScript: string;
    properties: {
        '@version': any;
        clearGlobalChannelMap: boolean;
        messageStorageMode: string;
        encryptData: boolean;
        encryptAttachments: boolean;
        encryptCustomMetaData: boolean;
        removeContentOnCompletion: boolean;
        removeOnlyFilteredOnCompletion: boolean;
        removeAttachmentsOnCompletion: boolean;
        initialState: string;
        storeAttachments: boolean;
        metaDataColumns: {
            metaDataColumn: {
                name: string;
                type: string;
                mappingName: string;
            }[];
        };
        attachmentProperties: {
            '@version': any;
            type: string;
            properties: null;
        };
        resourceIds: {
            '@class': string;
            entry: {
                string: string[];
            }[];
        };
    };
    exportData: {
        metadata: {
            enabled: boolean;
            pruningSettings: {
                archiveEnabled: boolean;
            };
        };
    };
};
export function destinationsOf(channel: any): any[];
export function setDestinations(channel: any, destinations: any): void;
export function validateChannel(channel: any): string[];
export const CHANNEL_STATES: string[];
export const MESSAGE_STATUSES: string[];
export const STEP_TYPES: {
    'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
        label: string;
    };
    'com.mirth.connect.plugins.mapper.MapperStep': {
        label: string;
    };
    'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': {
        label: string;
    };
    'com.mirth.connect.plugins.xsltstep.XsltStep': {
        label: string;
    };
    'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep': {
        label: string;
    };
    'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep': {
        label: string;
    };
    'com.mirth.connect.model.IteratorStep': {
        label: string;
    };
};
export const RULE_TYPES: {
    'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': {
        label: string;
    };
    'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': {
        label: string;
    };
    'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule': {
        label: string;
    };
    'com.mirth.connect.model.IteratorRule': {
        label: string;
    };
};
