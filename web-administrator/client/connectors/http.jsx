/*
 * HTTP Listener (HttpReceiverProperties) / HTTP Sender (HttpDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas,
 * the httpUrl display computation, and defaults are reused VERBATIM. The
 * portsInUseButton / connectorTestButton / 'Regular Expression' checkbox keep
 * their imperative DOM nodes, mounted through the form's `append`.
 */

import { React } from './react-platform.js';
import { checkbox, h, clear, textInput, select, icon } from '@oie/web-ui';
import {
    ConnectorForm, connectorTestButton, portsInUseButton, listenerAddressField, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, CHARSETS, requireFields
} from './react-forms.js';

// Swing charset combos always include "default" (index 0 -> DEFAULT_ENCODING);
// the binary-data reset paths select index 0, so the option must be reachable.
const HTTP_CHARSETS = CHARSETS;
const DEFAULT_CHARSET = 'DEFAULT_ENCODING';

// XStream serializes a List<HttpStaticResource> with no @XStreamAlias under the
// element's fully-qualified class name; a single element renders as a bare
// object rather than an array. resourceType is the enum name() (FILE/DIRECTORY/
// CUSTOM); Swing displays the WordUtils-capitalized toString() (File/Directory/
// Custom).
const STATIC_RESOURCE_CLASS = 'com.mirth.connect.connectors.http.HttpStaticResource';
const RESOURCE_TYPES = [
    { value: 'FILE', label: 'File' },
    { value: 'DIRECTORY', label: 'Directory' },
    { value: 'CUSTOM', label: 'Custom' }
];

function asArray(value) {
    if (value === null || value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function readStaticResources(list) {
    if (!list || typeof list !== 'object') return [];
    return asArray(list[STATIC_RESOURCE_CLASS]).map((r) => ({
        contextPath: String((r && r.contextPath) ?? ''),
        resourceType: String((r && r.resourceType) ?? 'FILE'),
        value: String((r && r.value) ?? ''),
        contentType: String((r && r.contentType) ?? '')
    }));
}

function writeStaticResources(list, rows) {
    const target = list && typeof list === 'object' ? list : {};
    if (!target['@class']) target['@class'] = 'java.util.ArrayList';
    if (rows.length) {
        target[STATIC_RESOURCE_CLASS] = rows.map((r) => ({
            contextPath: r.contextPath,
            resourceType: r.resourceType,
            value: r.value,
            contentType: r.contentType
        }));
    } else {
        delete target[STATIC_RESOURCE_CLASS];
    }
    return target;
}

// Static Resources table: Context Path / Resource Type / Value / Content Type,
// with New/Delete — the last Swing row of the HTTP Listener panel.
function staticResourcesTable(properties, onChange) {
    const wrap = h('div');
    const rows = readStaticResources(properties.staticResources);
    const commit = () => {
        properties.staticResources = writeStaticResources(properties.staticResources, rows);
        onChange();
    };
    function paint() {
        clear(wrap);
        const table = h('table.dt');
        table.appendChild(h('thead', h('tr',
            h('th', 'Context Path'), h('th', 'Resource Type'), h('th', 'Value'), h('th', 'Content Type'), h('th'))));
        const body = h('tbody');
        rows.forEach((row, i) => {
            body.appendChild(h('tr',
                // Commit (and thus repaint, which rebuilds this island) on blur, not
                // per keystroke — committing on every keystroke replaces the focused
                // input and drops focus. onInput keeps the row model live in between.
                h('td', textInput(row.contextPath, { class: 'w-full', onInput: (e) => { row.contextPath = e.target.value; }, onChange: (e) => { row.contextPath = e.target.value; commit(); } })),
                h('td', select(RESOURCE_TYPES, row.resourceType, { onChange: (e) => { row.resourceType = e.target.value; commit(); } })),
                h('td', textInput(row.value, { class: 'w-full', onInput: (e) => { row.value = e.target.value; }, onChange: (e) => { row.value = e.target.value; commit(); } })),
                h('td', textInput(row.contentType, { class: 'w-full', onInput: (e) => { row.contentType = e.target.value; }, onChange: (e) => { row.contentType = e.target.value; commit(); } })),
                h('td', h('button.icon-btn', { type: 'button', title: 'Delete', onClick: () => { rows.splice(i, 1); commit(); paint(); } }, icon('x')))));
        });
        table.appendChild(body);
        wrap.appendChild(table);
        wrap.appendChild(h('button.btn', { type: 'button', onClick: () => {
            let n = 1;
            const taken = new Set(rows.map((r) => r.contextPath));
            while (taken.has('path' + n)) n++;
            rows.push({ contextPath: 'path' + n, resourceType: 'FILE', value: '', contentType: 'text/plain' });
            paint();
        } }, 'New'));
    }
    paint();
    return wrap;
}

// Both HTTP connectors let headers / query parameters be entered as a Name/Value
// table OR resolved at runtime from a single map variable — the Swing "Use Table
// / Use Map" toggle (useXVariable=false → the table map; true → the variable name).
const USE_TABLE_MAP = [{ value: false, label: 'Use Table' }, { value: true, label: 'Use Map' }];

// HTTP Sender content gating, mirroring HttpSender.checkMultipartEnabled /
// checkContentEnabled: only POST/PUT/PATCH carry a request body, and a
// form-urlencoded content type disables Multipart + the Data Type / Content.
const httpHasBody = (p) => ['post', 'put', 'patch'].includes(String(p.method));
const httpFormUrlEncoded = (p) => String(p.contentType || '').toLowerCase().startsWith('application/x-www-form-urlencoded');

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
                listenerAddressField('listenerConnectorProperties.host', 'Local Address'),
                { key: 'listenerConnectorProperties.port', label: 'Local Port', type: 'number', width: '90px', append: () => portsInUseButton() },
                // HTTP authentication is provided by the httpauth connector-properties
                // plugin (renders as a separate "Authentication" panel).
                { section: 'HTTP Listener Settings' },
                { key: 'contextPath', label: 'Base Context Path', type: 'text', width: '320px', placeholder: '/' },
                { key: 'timeout', label: 'Receive Timeout (ms)', type: 'number', width: '120px' },
                { key: 'xmlBody', label: 'Message Content', type: 'radio', refresh: true, options: [
                    { value: false, label: 'Plain Body' },
                    { value: true, label: 'XML Body' }
                ] },
                { key: 'parseMultipart', label: 'Parse Multipart', type: 'radio', options: YES_NO, disabled: (p) => !asBool(p.xmlBody) },
                { key: 'includeMetadata', label: 'Include Metadata', type: 'radio', options: YES_NO, disabled: (p) => !asBool(p.xmlBody) },
                {
                    key: 'binaryMimeTypes', label: 'Binary MIME Types', type: 'text', width: '320px',
                    append: (p, ctx) => checkbox('Regular Expression', asBool(p.binaryMimeTypesRegex), {
                        onChange: (e) => { p.binaryMimeTypesRegex = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { type: 'display', label: 'HTTP URL', compute: httpUrl },
                { key: 'responseContentType', label: 'Response Content Type', type: 'text', width: '220px' },
                {
                    // Swing forces the charset combo back to "default" (index 0)
                    // whenever Binary is selected.
                    key: 'responseDataTypeBinary', label: 'Response Data Type', type: 'radio', refresh: true,
                    onSet: (p) => { if (asBool(p.responseDataTypeBinary)) p.charset = DEFAULT_CHARSET; },
                    options: [
                        { value: true, label: 'Binary' },
                        { value: false, label: 'Text' }
                    ]
                },
                { key: 'charset', label: 'Charset Encoding', type: 'select', options: HTTP_CHARSETS, width: '160px', disabled: (p) => asBool(p.responseDataTypeBinary) },
                { key: 'responseStatusCode', label: 'Response Status Code', type: 'text', width: '120px', placeholder: 'Default (200/500)' },
                { key: 'useResponseHeadersVariable', label: 'Response Headers', type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useResponseHeadersVariableFieldsEnabled() greys (setEnabled) both controls while
                // leaving both visible: the table is disabled when Use Map is selected, the variable field
                // when Use Table is selected. Grey-both, not swap-hide.
                { key: 'responseHeaders', type: 'keyvalue', mapShape: 'list', disabled: (p) => asBool(p.useResponseHeadersVariable) },
                { key: 'responseHeadersVariable', label: 'Map Variable', type: 'text', width: '320px', placeholder: 'e.g. RESTResponseHeaders', disabled: (p) => !asBool(p.useResponseHeadersVariable) },
                { type: 'custom', label: 'Static Resources', span: true, render: (p, ctx) => staticResourcesTable(p, ctx.onChange) }
            ]} />
        );
    },
    // Swing ListenerSettingsPanel.checkProperties: Local Address + Local Port always required.
    // HttpListener.checkProperties: Receive Timeout always required; Response Content Type
    // required unless the source Response variable is "None"; the response-headers Map
    // Variable required when Use Map is selected (isUseHeadersVariable + blank variable).
    validate(properties) {
        return requireFields(properties, [
            { key: 'listenerConnectorProperties.host', label: 'Local Address' },
            { key: 'listenerConnectorProperties.port', label: 'Local Port' },
            { key: 'timeout', label: 'Receive Timeout' },
            { key: 'responseContentType', label: 'Response Content Type', when: (p) => String((p.sourceConnectorProperties || {}).responseVariable || '').toLowerCase() !== 'none' },
            { key: 'responseHeadersVariable', label: 'Response Headers Map Variable', when: (p) => asBool(p.useResponseHeadersVariable) }
        ]);
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
                { section: 'HTTP Sender Settings' },
                {
                    key: 'host', label: 'URL', type: 'text', width: '420px', placeholder: 'https://host:port/path',
                    append: () => connectorTestButton({ path: '/connectors/http/_testConnection', channel, properties })
                },
                { key: 'useProxyServer', label: 'Use Proxy Server', type: 'radio', refresh: true, options: YES_NO },
                { key: 'proxyAddress', label: 'Proxy Address', type: 'text', width: '320px', disabled: (p) => !asBool(p.useProxyServer) },
                { key: 'proxyPort', label: 'Proxy Port', type: 'number', width: '90px', disabled: (p) => !asBool(p.useProxyServer) },
                {
                    // Method=POST is the only one that allows Multipart; switching
                    // away forces it off, matching the Swing checkMultipartEnabled.
                    key: 'method', label: 'Method', type: 'radio', refresh: true,
                    onSet: (p) => { if (String(p.method) !== 'post') p.multipart = false; },
                    options: [
                        { value: 'post', label: 'POST' },
                        { value: 'get', label: 'GET' },
                        { value: 'put', label: 'PUT' },
                        { value: 'delete', label: 'DELETE' },
                        { value: 'patch', label: 'PATCH' }
                    ]
                },
                { key: 'multipart', label: 'Multipart', type: 'radio', options: YES_NO, disabled: (p) => String(p.method) !== 'post' || httpFormUrlEncoded(p) },
                { key: 'socketTimeout', label: 'Send Timeout (ms)', type: 'number', width: '120px' },
                {
                    key: 'responseXmlBody', label: 'Response Content', type: 'radio', refresh: true,
                    options: [
                        { value: false, label: 'Plain Body' },
                        { value: true, label: 'XML Body' }
                    ]
                },
                { key: 'responseParseMultipart', label: 'Parse Multipart', type: 'radio', options: YES_NO, disabled: (p) => !asBool(p.responseXmlBody) },
                { key: 'responseIncludeMetadata', label: 'Include Metadata', type: 'radio', options: YES_NO, disabled: (p) => !asBool(p.responseXmlBody) },
                {
                    key: 'responseBinaryMimeTypes', label: 'Binary MIME Types', type: 'text', width: '320px',
                    append: (p, ctx) => checkbox('Regular Expression', asBool(p.responseBinaryMimeTypesRegex), {
                        onChange: (e) => { p.responseBinaryMimeTypesRegex = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { section: 'HTTP Authentication' },
                {
                    // Swing's setAuthenticationEnabled(false) blanks the
                    // username/password fields in addition to disabling them.
                    key: 'useAuthentication', label: 'Authentication', type: 'radio', options: YES_NO, refresh: true,
                    onSet: (p) => { if (!asBool(p.useAuthentication)) { p.username = ''; p.password = ''; } }
                },
                {
                    // Swing adds authenticationPreemptiveCheckBox inline on the Authentication Type row
                    // (add(basicRadio,"split 3"); add(digestRadio); add(preemptiveCheckBox)). Mirror that as
                    // an appended checkbox rather than a separate row.
                    key: 'authenticationType', label: 'Authentication Type', type: 'radio', options: ['Basic', 'Digest'], disabled: (p) => !usingAuth(p),
                    append: (p, ctx) => checkbox('Preemptive', asBool(p.usePreemptiveAuthentication), {
                        disabled: !usingAuth(p),
                        onChange: (e) => { p.usePreemptiveAuthentication = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { key: 'username', label: 'Username', type: 'text', width: '220px', disabled: (p) => !usingAuth(p) },
                { key: 'password', label: 'Password', type: 'password', width: '220px', disabled: (p) => !usingAuth(p) },
                { section: 'Request Settings' },
                { key: 'useParametersVariable', label: 'Query Parameters', type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useQueryParamsVariableFieldsEnabled() greys (setEnabled) both controls while leaving
                // both visible: table disabled at Use Map, variable field disabled at Use Table. Grey-both.
                { key: 'parameters', type: 'keyvalue', mapShape: 'list', disabled: (p) => asBool(p.useParametersVariable) },
                { key: 'parametersVariable', label: 'Map Variable', type: 'text', width: '320px', placeholder: 'e.g. RESTParams', disabled: (p) => !asBool(p.useParametersVariable) },
                { key: 'useHeadersVariable', label: 'Headers', type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useHeadersVariableFieldsEnabled() greys both, same as query parameters above.
                { key: 'headers', type: 'keyvalue', mapShape: 'list', disabled: (p) => asBool(p.useHeadersVariable) },
                { key: 'headersVariable', label: 'Map Variable', type: 'text', width: '320px', placeholder: 'e.g. RESTHeaders', disabled: (p) => !asBool(p.useHeadersVariable) },
                {
                    key: 'contentType', label: 'Content Type', type: 'text', width: '220px', refresh: true,
                    disabled: (p) => !httpHasBody(p),
                    // A form-urlencoded body is built from the query-parameter map,
                    // so Swing forces Multipart off + Data Type to Text here.
                    onSet: (p) => { if (httpFormUrlEncoded(p)) { p.multipart = false; p.dataTypeBinary = false; } }
                },
                {
                    // Swing forces the charset combo back to "default" (index 0)
                    // whenever Data Type=Binary is selected.
                    key: 'dataTypeBinary', label: 'Data Type', type: 'radio', refresh: true,
                    disabled: (p) => !httpHasBody(p) || httpFormUrlEncoded(p),
                    onSet: (p) => { if (asBool(p.dataTypeBinary)) p.charset = DEFAULT_CHARSET; },
                    options: [
                        { value: true, label: 'Binary' },
                        { value: false, label: 'Text' }
                    ]
                },
                // Charset applies to the form-urlencoded body too (HttpDispatcher
                // builds the UrlEncodedFormEntity with it), so keep it settable for
                // form-urlencoded — only disable with no body or Binary data type
                // (matching Swing's dataTypeTextRadioActionPerformed re-enable).
                { key: 'charset', label: 'Charset Encoding', type: 'select', options: HTTP_CHARSETS, width: '160px', disabled: (p) => !httpHasBody(p) || asBool(p.dataTypeBinary) },
                { key: 'content', label: 'Content', type: 'textarea', rows: 8, tooltip: 'The HTTP message body.', disabled: (p) => !httpHasBody(p) || httpFormUrlEncoded(p) }
            ]} />
        );
    },
    // Swing HttpSender.checkProperties: URL + Send Timeout always required; proxy
    // address/port required when Use Proxy Server is on.
    validate(properties) {
        return requireFields(properties, [
            { key: 'host', label: 'URL' },
            { key: 'socketTimeout', label: 'Send Timeout' },
            { key: 'proxyAddress', label: 'Proxy Address', when: (p) => asBool(p.useProxyServer) },
            { key: 'proxyPort', label: 'Proxy Port', when: (p) => asBool(p.useProxyServer) }
        ]);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('HTTP Listener', 'SOURCE', httpListener);
    platform.registerConnectorPanel('HTTP Sender', 'DESTINATION', httpSender);
}
