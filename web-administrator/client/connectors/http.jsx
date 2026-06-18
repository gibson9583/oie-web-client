/*
 * HTTP Listener (HttpReceiverProperties) / HTTP Sender (HttpDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas,
 * the httpUrl display computation, and defaults are reused VERBATIM. The
 * portsInUseButton / connectorTestButton / 'Regular Expression' checkbox keep
 * their imperative DOM nodes, mounted through the form's `append`.
 */

import { React } from './react-platform.js';
import { checkbox } from '@oie/web-ui';
import {
    ConnectorForm, connectorTestButton, portsInUseButton, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, CHARSETS
} from './react-forms.js';

const HTTP_CHARSETS = CHARSETS.filter((c) => c.value !== 'DEFAULT_ENCODING');

function httpUrl(p) {
    const listener = p.listenerConnectorProperties || {};
    const rawHost = String(listener.host ?? '').trim();
    const host = !rawHost || rawHost === '0.0.0.0' ? window.location.hostname : rawHost;
    let contextPath = String(p.contextPath ?? '').trim();
    if (contextPath && !contextPath.startsWith('/')) contextPath = '/' + contextPath;
    if (!contextPath.endsWith('/')) contextPath += '/';
    return `http://${host}:${listener.port ?? ''}${contextPath}`;
}

const httpListener = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.http.HttpReceiverProperties',
            '@version': version,
            pluginProperties: null,
            listenerConnectorProperties: defaultListenerProperties(version, '80'),
            sourceConnectorProperties: defaultSourceProperties(version),
            xmlBody: false,
            parseMultipart: true,
            includeMetadata: false,
            binaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*',
            binaryMimeTypesRegex: true,
            responseContentType: 'text/plain',
            responseDataTypeBinary: false,
            responseStatusCode: '',
            responseHeaders: { '@class': 'linked-hash-map' },
            responseHeadersVariable: '',
            useResponseHeadersVariable: false,
            charset: 'UTF-8',
            contextPath: '',
            timeout: '30000',
            staticResources: { '@class': 'java.util.ArrayList' }
        };
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Listener Settings' },
                { key: 'listenerConnectorProperties.host', label: 'Local Address', type: 'text', width: '200px' },
                { key: 'listenerConnectorProperties.port', label: 'Local Port', type: 'number', width: '90px', append: () => portsInUseButton() },
                // HTTP authentication is provided by the httpauth connector-properties
                // plugin (renders as a separate "Authentication" panel).
                { section: 'HTTP Listener Settings' },
                { key: 'contextPath', label: 'Base Context Path', type: 'text', width: '320px', placeholder: '/' },
                { key: 'timeout', label: 'Receive Timeout (ms)', type: 'number', width: '120px' },
                { key: 'xmlBody', label: 'Message Content', type: 'radio', options: [
                    { value: false, label: 'Plain Body' },
                    { value: true, label: 'XML Body' }
                ] },
                { key: 'parseMultipart', label: 'Parse Multipart', type: 'radio', options: YES_NO },
                { key: 'includeMetadata', label: 'Include Metadata', type: 'radio', options: YES_NO },
                {
                    key: 'binaryMimeTypes', label: 'Binary MIME Types', type: 'text', width: '320px',
                    append: (p, ctx) => checkbox('Regular Expression', asBool(p.binaryMimeTypesRegex), {
                        onChange: (e) => { p.binaryMimeTypesRegex = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { type: 'display', label: 'HTTP URL', compute: httpUrl },
                { key: 'responseContentType', label: 'Response Content Type', type: 'text', width: '220px' },
                { key: 'responseDataTypeBinary', label: 'Response Data Type', type: 'radio', options: [
                    { value: true, label: 'Binary' },
                    { value: false, label: 'Text' }
                ] },
                { key: 'charset', label: 'Charset Encoding', type: 'select', options: HTTP_CHARSETS, width: '160px' },
                { key: 'responseStatusCode', label: 'Response Status Code', type: 'text', width: '120px', placeholder: 'Default (200/500)' },
                { key: 'responseHeaders', label: 'Response Headers', type: 'keyvalue', mapShape: 'list' }
            ]} />
        );
    }
};

const httpSender = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            host: '',
            useProxyServer: false,
            proxyAddress: '',
            proxyPort: '',
            method: 'post',
            headers: { '@class': 'linked-hash-map' },
            parameters: { '@class': 'linked-hash-map' },
            useHeadersVariable: false,
            headersVariable: '',
            useParametersVariable: false,
            parametersVariable: '',
            responseXmlBody: false,
            responseParseMultipart: true,
            responseIncludeMetadata: false,
            responseBinaryMimeTypes: 'application/.*(?<!json|xml)$|image/.*|video/.*|audio/.*',
            responseBinaryMimeTypesRegex: true,
            multipart: false,
            useAuthentication: false,
            authenticationType: 'Basic',
            usePreemptiveAuthentication: false,
            username: '',
            password: '',
            content: '',
            contentType: 'text/plain',
            dataTypeBinary: false,
            charset: 'UTF-8',
            socketTimeout: '30000'
        };
    },
    component({ properties, channel, onChange }) {
        const usingAuth = (p) => asBool(p.useAuthentication);
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Connection Settings' },
                {
                    key: 'host', label: 'URL', type: 'text', width: '420px', placeholder: 'https://host:port/path',
                    append: () => connectorTestButton({ path: '/connectors/http/_testConnection', channel, properties })
                },
                { key: 'method', label: 'Method', type: 'radio', options: [
                    { value: 'get', label: 'GET' },
                    { value: 'post', label: 'POST' },
                    { value: 'put', label: 'PUT' },
                    { value: 'delete', label: 'DELETE' },
                    { value: 'patch', label: 'PATCH' }
                ] },
                { key: 'socketTimeout', label: 'Send Timeout (ms)', type: 'number', width: '120px' },
                { key: 'responseXmlBody', label: 'Response Content', type: 'radio', options: [
                    { value: false, label: 'Plain Body' },
                    { value: true, label: 'XML Body' }
                ] },
                { section: 'HTTP Authentication' },
                { key: 'useAuthentication', label: 'Use Authentication', type: 'radio', options: YES_NO, refresh: true },
                { key: 'authenticationType', label: 'Authentication Type', type: 'radio', options: ['Basic', 'Digest'], visible: usingAuth },
                { key: 'usePreemptiveAuthentication', label: 'Preemptive', type: 'checkbox', visible: usingAuth },
                { key: 'username', label: 'Username', type: 'text', width: '220px', visible: usingAuth },
                { key: 'password', label: 'Password', type: 'password', width: '220px', visible: usingAuth },
                { section: 'Request Settings' },
                { key: 'parameters', label: 'Query Parameters', type: 'keyvalue', mapShape: 'list' },
                { key: 'headers', label: 'Headers', type: 'keyvalue', mapShape: 'list' },
                { key: 'contentType', label: 'Content Type', type: 'text', width: '220px' },
                { key: 'dataTypeBinary', label: 'Data Type', type: 'radio', options: [
                    { value: true, label: 'Binary' },
                    { value: false, label: 'Text' }
                ] },
                { key: 'charset', label: 'Charset Encoding', type: 'select', options: HTTP_CHARSETS, width: '160px' },
                { key: 'content', label: 'Content', type: 'textarea', rows: 8, placeholder: '${message.encodedData}' }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('HTTP Listener', 'SOURCE', httpListener);
    platform.registerConnectorPanel('HTTP Sender', 'DESTINATION', httpSender);
}
