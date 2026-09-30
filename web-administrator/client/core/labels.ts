// Explicit labels for built-in ids. Never use these to translate arbitrary user data.
import { t } from './i18n.js';

const once = (build: () => Record<string, string>) => {
    let labels: Record<string, string> | undefined;
    return () => (labels ??= build());
};
const labelOf = (build: () => Record<string, string>) => {
    const labels = once(build);
    return (value: string): string => Object.hasOwn(labels(), value) ? labels()[value] : value;
};

export const wizardStepLabel = labelOf(() => ({
    Basics: t('Basics'),
    Dependencies: t('Dependencies'),
    'Channel Options': t('Channel Options'),
    Source: t('Source'),
    Destinations: t('Destinations'),
    Scripts: t('Scripts'),
    Review: t('Review'),
    Trigger: t('Trigger'),
    Channels: t('Channels'),
    Actions: t('Actions')
}));

export const channelTabLabel = labelOf(() => ({
    Summary: t('Summary'),
    Source: t('Source'),
    Destinations: t('Destinations'),
    Scripts: t('Scripts')
}));

export const connectorTabLabel = labelOf(() => ({
    Settings: t('Settings'),
    Filter: t('Filter'),
    Transformer: t('Transformer'),
    Response: t('Response')
}));

export const referenceTabLabel = labelOf(() => ({
    Reference: t('Reference'),
    'Message Trees': t('Message Trees'),
    'Message Templates': t('Message Templates')
}));

const builtinSections = once(() => ({
    Monitor: t('Monitor'),
    Design: t('Design'),
    Manage: t('Manage'),
    Create: t('Create'),
    Settings: t('Settings'),
    Session: t('Session'),
    Other: t('Other'),
    Plugins: t('Plugins')
}));

export function builtinSectionLabel(value: string): string | undefined {
    return Object.hasOwn(builtinSections(), value) ? builtinSections()[value] : undefined;
}

export const navigationSectionLabel = labelOf(() => ({
    ...builtinSections(),
    Views: t('Views'),
    Commands: t('Commands'),
    Channels: t('Channels'),
    Recent: t('Recent')
}));

export const eventLevelLabel = labelOf(() => ({
    TRACE: t('Trace'),
    DEBUG: t('Debug'),
    INFO: t('Info'),
    WARN: t('Warn'),
    ERROR: t('Error'),
    FATAL: t('Fatal')
}));

export const alertEventTypeLabel = labelOf(() => ({
    ANY: t('Any'),
    SOURCE_CONNECTOR: t('Source Connector'),
    DESTINATION_CONNECTOR: t('Destination Connector'),
    SERIALIZER: t('Serializer'),
    FILTER: t('Filter'),
    TRANSFORMER: t('Transformer'),
    USER_DEFINED_TRANSFORMER: t('User Defined Transformer'),
    RESPONSE_VALIDATION: t('Response Validation'),
    RESPONSE_TRANSFORMER: t('Response Transformer'),
    ATTACHMENT_HANDLER: t('Attachment Handler'),
    DEPLOY_SCRIPT: t('Deploy Script'),
    PREPROCESSOR_SCRIPT: t('Preprocessor Script'),
    POSTPROCESSOR_SCRIPT: t('Postprocessor Script'),
    UNDEPLOY_SCRIPT: t('Undeploy Script')
}));

export const messageStatusLabel = labelOf(() => ({
    RECEIVED: t('RECEIVED'),
    FILTERED: t('FILTERED'),
    TRANSFORMED: t('TRANSFORMED'),
    SENT: t('SENT'),
    QUEUED: t('QUEUED'),
    ERROR: t('ERROR'),
    PENDING: t('PENDING')
}));

export const wireTransportLabel = labelOf(() => ({
    'TCP Listener': t('TCP Listener'),
    'TCP Sender': t('TCP Sender'),
    'Database Reader': t('Database Reader'),
    'Database Writer': t('Database Writer'),
    'DICOM Listener': t('DICOM Listener'),
    'DICOM Sender': t('DICOM Sender'),
    'Document Writer': t('Document Writer'),
    'File Reader': t('File Reader'),
    'File Writer': t('File Writer'),
    'HTTP Listener': t('HTTP Listener'),
    'HTTP Sender': t('HTTP Sender'),
    'JavaScript Reader': t('JavaScript Reader'),
    'JavaScript Writer': t('JavaScript Writer'),
    'JMS Listener': t('JMS Listener'),
    'JMS Sender': t('JMS Sender'),
    'SMTP Sender': t('SMTP Sender'),
    'Channel Reader': t('Channel Reader'),
    'Channel Writer': t('Channel Writer'),
    'Web Service Listener': t('Web Service Listener'),
    'Web Service Sender': t('Web Service Sender')
}));

const proxyErrors = once(() => ({
    SESSION_CHANGED: t('The browser session changed. Reload to continue.'),
    ENGINE_UNKNOWN: t('The selected engine is no longer available. Choose an engine and sign in again.'),
    ENGINE_UNREACHABLE: t('Could not reach the Open Integration Engine.'),
    CSRF: t('Missing X-Requested-With header'),
    NO_SESSION: t('No engine session'),
    EMPTY: t('No upload received'),
    NO_PATH: t('Extension path is required')
}));

/** Translate only the Node proxy's machine codes; keep engine-provided prose intact. */
export function proxyErrorLabel(code: unknown, fallback: string): string {
    return typeof code === 'string' && Object.hasOwn(proxyErrors(), code) ? proxyErrors()[code] : fallback;
}
