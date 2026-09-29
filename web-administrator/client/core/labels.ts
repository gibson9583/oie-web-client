// Explicit labels for built-in ids. Never use these to translate arbitrary user data.
import { t } from './i18n.js';

export function wizardStepLabel(value: string): string {
    switch (value) {
        case "Basics": return t("Basics");
        case "Dependencies": return t("Dependencies");
        case "Channel Options": return t("Channel Options");
        case "Source": return t("Source");
        case "Destinations": return t("Destinations");
        case "Scripts": return t("Scripts");
        case "Review": return t("Review");
        case "Trigger": return t("Trigger");
        case "Channels": return t("Channels");
        case "Actions": return t("Actions");
        default: return value;
    }
}

export function channelTabLabel(value: string): string {
    switch (value) {
        case "Summary": return t("Summary");
        case "Source": return t("Source");
        case "Destinations": return t("Destinations");
        case "Scripts": return t("Scripts");
        default: return value;
    }
}

export function connectorTabLabel(value: string): string {
    switch (value) {
        case "Settings": return t("Settings");
        case "Filter": return t("Filter");
        case "Transformer": return t("Transformer");
        case "Response": return t("Response");
        default: return value;
    }
}

export function referenceTabLabel(value: string): string {
    switch (value) {
        case "Reference": return t("Reference");
        case "Message Trees": return t("Message Trees");
        case "Message Templates": return t("Message Templates");
        default: return value;
    }
}

export function navigationSectionLabel(value: string): string {
    switch (value) {
        case "Monitor": return t("Monitor");
        case "Design": return t("Design");
        case "Manage": return t("Manage");
        case "Create": return t("Create");
        case "Settings": return t("Settings");
        case "Session": return t("Session");
        case "Other": return t("Other");
        case "Plugins": return t("Plugins");
        case "Views": return t("Views");
        case "Commands": return t("Commands");
        case "Channels": return t("Channels");
        case "Recent": return t("Recent");
        default: return value;
    }
}

export function eventLevelLabel(value: string): string {
    switch (value) {
        case "TRACE": return t("Trace");
        case "DEBUG": return t("Debug");
        case "INFO": return t("Info");
        case "WARN": return t("Warn");
        case "ERROR": return t("Error");
        case "FATAL": return t("Fatal");
        default: return value;
    }
}

export function alertEventTypeLabel(value: string): string {
    switch (value) {
        case "ANY": return t("Any");
        case "SOURCE_CONNECTOR": return t("Source Connector");
        case "DESTINATION_CONNECTOR": return t("Destination Connector");
        case "SERIALIZER": return t("Serializer");
        case "FILTER": return t("Filter");
        case "TRANSFORMER": return t("Transformer");
        case "USER_DEFINED_TRANSFORMER": return t("User Defined Transformer");
        case "RESPONSE_VALIDATION": return t("Response Validation");
        case "RESPONSE_TRANSFORMER": return t("Response Transformer");
        case "ATTACHMENT_HANDLER": return t("Attachment Handler");
        case "DEPLOY_SCRIPT": return t("Deploy Script");
        case "PREPROCESSOR_SCRIPT": return t("Preprocessor Script");
        case "POSTPROCESSOR_SCRIPT": return t("Postprocessor Script");
        case "UNDEPLOY_SCRIPT": return t("Undeploy Script");
        default: return value;
    }
}

export function messageStatusLabel(value: string): string {
    switch (value) {
        case "RECEIVED": return t("RECEIVED");
        case "FILTERED": return t("FILTERED");
        case "TRANSFORMED": return t("TRANSFORMED");
        case "SENT": return t("SENT");
        case "QUEUED": return t("QUEUED");
        case "ERROR": return t("ERROR");
        case "PENDING": return t("PENDING");
        default: return value;
    }
}

export function wireTransportLabel(value: string): string {
    switch (value) {
        case "TCP Listener": return t("TCP Listener");
        case "TCP Sender": return t("TCP Sender");
        case "Database Reader": return t("Database Reader");
        case "Database Writer": return t("Database Writer");
        case "DICOM Listener": return t("DICOM Listener");
        case "DICOM Sender": return t("DICOM Sender");
        case "Document Writer": return t("Document Writer");
        case "File Reader": return t("File Reader");
        case "File Writer": return t("File Writer");
        case "HTTP Listener": return t("HTTP Listener");
        case "HTTP Sender": return t("HTTP Sender");
        case "JavaScript Reader": return t("JavaScript Reader");
        case "JavaScript Writer": return t("JavaScript Writer");
        case "JMS Listener": return t("JMS Listener");
        case "JMS Sender": return t("JMS Sender");
        case "SMTP Sender": return t("SMTP Sender");
        case "Channel Reader": return t("Channel Reader");
        case "Channel Writer": return t("Channel Writer");
        case "Web Service Listener": return t("Web Service Listener");
        case "Web Service Sender": return t("Web Service Sender");
        default: return value;
    }
}

/** Translate only the Node proxy's machine codes; keep engine-provided prose intact. */
export function proxyErrorLabel(code: unknown, fallback: string): string {
    switch (code) {
        case 'SESSION_CHANGED': return t('The browser session changed. Reload to continue.');
        case 'ENGINE_UNKNOWN': return t('The selected engine is no longer available. Choose an engine and sign in again.');
        case 'ENGINE_UNREACHABLE': return t('Could not reach the Open Integration Engine.');
        case 'CSRF': return t('Missing X-Requested-With header');
        case 'NO_SESSION': return t('No engine session');
        case 'EMPTY': return t('No upload received');
        case 'NO_PATH': return t('Extension path is required');
        default: return fallback;
    }
}
