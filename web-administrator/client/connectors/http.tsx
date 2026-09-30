import { t } from '../core/i18n.js';
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
    { value: 'FILE', label: t("File") },
    { value: 'DIRECTORY', label: t("Directory") },
    { value: 'CUSTOM', label: t("Custom") }
];

function asArray(value: any) {
    if (value === null || value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

function readStaticResources(list: any) {
    if (!list || typeof list !== 'object') return [];
    return asArray(list[STATIC_RESOURCE_CLASS]).map((r: any) => ({
        contextPath: String((r && r.contextPath) ?? ''),
        resourceType: String((r && r.resourceType) ?? 'FILE'),
        value: String((r && r.value) ?? ''),
        contentType: String((r && r.contentType) ?? '')
    }));
}

function writeStaticResources(list: any, rows: any) {
    const target = list && typeof list === 'object' ? list : {};
    if (!target['@class']) target['@class'] = 'java.util.ArrayList';
    if (rows.length) {
        target[STATIC_RESOURCE_CLASS] = rows.map((r: any) => ({
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
function staticResourcesTable(properties: any, onChange: any) {
    const wrap = h('div');
    const rows = readStaticResources(properties.staticResources);
    const commit = () => {
        properties.staticResources = writeStaticResources(properties.staticResources, rows);
        onChange();
    };
    function paint() {
        clear(wrap);
        // min-width so the four inputs stay usable; the .dt-wrap below scrolls it
        // horizontally on a narrow panel instead of overflowing (or crushing).
        const table = h('table.dt', { style: { minWidth: '520px' } });
        table.appendChild(h('thead', h('tr',
            h('th', t("Context Path")), h('th', t("Resource Type")), h('th', t("Value")), h('th', t("Content Type")), h('th'))));
        const body = h('tbody');
        rows.forEach((row: any, i: number) => {
            body.appendChild(h('tr',
                // Commit (and thus repaint, which rebuilds this island) on blur, not
                // per keystroke — committing on every keystroke replaces the focused
                // input and drops focus. onInput keeps the row model live in between.
                h('td', textInput(row.contextPath, { class: 'w-full', onInput: (e: any) => { row.contextPath = e.target.value; }, onChange: (e: any) => { row.contextPath = e.target.value; commit(); } })),
                h('td', select(RESOURCE_TYPES, row.resourceType, { onChange: (e: any) => { row.resourceType = e.target.value; commit(); } })),
                h('td', textInput(row.value, { class: 'w-full', onInput: (e: any) => { row.value = e.target.value; }, onChange: (e: any) => { row.value = e.target.value; commit(); } })),
                h('td', textInput(row.contentType, { class: 'w-full', onInput: (e: any) => { row.contentType = e.target.value; }, onChange: (e: any) => { row.contentType = e.target.value; commit(); } })),
                h('td', h('button.icon-btn', { type: 'button', title: t("Delete"), onClick: () => { rows.splice(i, 1); commit(); paint(); } }, icon('x')))));
        });
        table.appendChild(body);
        wrap.appendChild(h('div.dt-wrap', table));
        wrap.appendChild(h('button.btn', { type: 'button', onClick: () => {
            let n = 1;
            const taken = new Set(rows.map((r: any) => r.contextPath));
            while (taken.has('path' + n)) n++;
            rows.push({ contextPath: 'path' + n, resourceType: 'FILE', value: '', contentType: 'text/plain' });
            paint();
        } }, t("New")));
    }
    paint();
    return wrap;
}

// Both HTTP connectors let headers / query parameters be entered as a Name/Value
// table OR resolved at runtime from a single map variable — the Swing "Use Table
// / Use Map" toggle (useXVariable=false → the table map; true → the variable name).
const USE_TABLE_MAP = [{ value: false, label: t("Use Table") }, { value: true, label: t("Use Map") }];

// HTTP Sender content gating, mirroring HttpSender.checkMultipartEnabled /
// checkContentEnabled: only POST/PUT/PATCH carry a request body, and a
// form-urlencoded content type disables Multipart + the Data Type / Content.
const httpHasBody = (p: any) => ['post', 'put', 'patch'].includes(String(p.method));
const httpFormUrlEncoded = (p: any) => String(p.contentType || '').toLowerCase().startsWith('application/x-www-form-urlencoded');

function httpUrl(p: any) {
    const listener = p.listenerConnectorProperties || {};
    const rawHost = String(listener.host ?? '').trim();
    const host = !rawHost || rawHost === '0.0.0.0' ? window.location.hostname : rawHost;
    let contextPath = String(p.contextPath ?? '').trim();
    if (contextPath && !contextPath.startsWith('/')) contextPath = '/' + contextPath;
    if (!contextPath.endsWith('/')) contextPath += '/';
    return `http://${host}:${listener.port ?? ''}${contextPath}`;
}

const httpListener = {
    defaults(version: any) {
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
    component({ properties, onChange }: any) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: t("Listener Settings") },
                listenerAddressField('listenerConnectorProperties.host', t("Local Address")),
                { key: 'listenerConnectorProperties.port', label: t("Local Port"), type: 'number', width: '90px', append: () => portsInUseButton() },
                // HTTP authentication is provided by the httpauth connector-properties
                // plugin (renders as a separate "Authentication" panel).
                { section: t("HTTP Listener Settings") },
                { key: 'contextPath', label: t("Base Context Path"), type: 'text', width: '320px', placeholder: '/' },
                { key: 'timeout', label: t("Receive Timeout (ms)"), type: 'number', width: '120px' },
                { key: 'xmlBody', label: t("Message Content"), type: 'radio', refresh: true, options: [
                    { value: false, label: t("Plain Body") },
                    { value: true, label: t("XML Body") }
                ] },
                { key: 'parseMultipart', label: t("Parse Multipart"), type: 'radio', options: YES_NO, disabled: (p: any) => !asBool(p.xmlBody) },
                { key: 'includeMetadata', label: t("Include Metadata"), type: 'radio', options: YES_NO, disabled: (p: any) => !asBool(p.xmlBody) },
                {
                    key: 'binaryMimeTypes', label: t("Binary MIME Types"), type: 'text', width: '320px',
                    append: (p: any, ctx: any) => checkbox(t("Regular Expression"), asBool(p.binaryMimeTypesRegex), {
                        onChange: (e: any) => { p.binaryMimeTypesRegex = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { type: 'display', label: t("HTTP URL"), compute: httpUrl },
                { key: 'responseContentType', label: t("Response Content Type"), type: 'text', width: '220px' },
                {
                    // Swing forces the charset combo back to "default" (index 0)
                    // whenever Binary is selected.
                    key: 'responseDataTypeBinary', label: t("Response Data Type"), type: 'radio', refresh: true,
                    onSet: (p: any) => { if (asBool(p.responseDataTypeBinary)) p.charset = DEFAULT_CHARSET; },
                    options: [
                        { value: true, label: t("Binary") },
                        { value: false, label: t("Text") }
                    ]
                },
                { key: 'charset', label: t("Charset Encoding"), type: 'select', options: HTTP_CHARSETS, width: '160px', disabled: (p: any) => asBool(p.responseDataTypeBinary) },
                { key: 'responseStatusCode', label: t("Response Status Code"), type: 'text', width: '120px', placeholder: t("Default (200/500)") },
                { key: 'useResponseHeadersVariable', label: t("Response Headers"), type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useResponseHeadersVariableFieldsEnabled() greys (setEnabled) both controls while
                // leaving both visible: the table is disabled when Use Map is selected, the variable field
                // when Use Table is selected. Grey-both, not swap-hide.
                { key: 'responseHeaders', type: 'keyvalue', mapShape: 'list', disabled: (p: any) => asBool(p.useResponseHeadersVariable) },
                { key: 'responseHeadersVariable', label: t("Map Variable"), type: 'text', width: '320px', placeholder: t("e.g. RESTResponseHeaders"), disabled: (p: any) => !asBool(p.useResponseHeadersVariable) },
                { type: 'custom', label: t("Static Resources"), span: true, render: (p: any, ctx: any) => staticResourcesTable(p, ctx.onChange) }
            ]} />
        );
    },
    // Swing ListenerSettingsPanel.checkProperties: Local Address + Local Port always required.
    // HttpListener.checkProperties: Receive Timeout always required; Response Content Type
    // required unless the source Response variable is "None"; the response-headers Map
    // Variable required when Use Map is selected (isUseHeadersVariable + blank variable).
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'listenerConnectorProperties.host', label: t("Local Address") },
            { key: 'listenerConnectorProperties.port', label: t("Local Port") },
            { key: 'timeout', label: t("Receive Timeout") },
            { key: 'responseContentType', label: t("Response Content Type"), when: (p: any) => String((p.sourceConnectorProperties || {}).responseVariable || '').toLowerCase() !== 'none' },
            { key: 'responseHeadersVariable', label: t("Response Headers Map Variable"), when: (p: any) => asBool(p.useResponseHeadersVariable) }
        ]);
    }
};

const httpSender = {
    defaults(version: any) {
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
    component({ properties, channel, onChange }: any) {
        const usingAuth = (p: any) => asBool(p.useAuthentication);
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: t("HTTP Sender Settings") },
                {
                    key: 'host', label: t("URL"), type: 'text', width: '420px', placeholder: 'https://host:port/path',
                    append: () => connectorTestButton({ path: '/connectors/http/_testConnection', channel, properties })
                },
                { key: 'useProxyServer', label: t("Use Proxy Server"), type: 'radio', refresh: true, options: YES_NO },
                { key: 'proxyAddress', label: t("Proxy Address"), type: 'text', width: '320px', disabled: (p: any) => !asBool(p.useProxyServer) },
                { key: 'proxyPort', label: t("Proxy Port"), type: 'number', width: '90px', disabled: (p: any) => !asBool(p.useProxyServer) },
                {
                    // Method=POST is the only one that allows Multipart; switching
                    // away forces it off, matching the Swing checkMultipartEnabled.
                    key: 'method', label: t("Method"), type: 'radio', refresh: true,
                    onSet: (p: any) => { if (String(p.method) !== 'post') p.multipart = false; },
                    options: [
                        { value: 'post', label: t("POST") },
                        { value: 'get', label: t("GET") },
                        { value: 'put', label: t("PUT") },
                        { value: 'delete', label: t("DELETE") },
                        { value: 'patch', label: t("PATCH") }
                    ]
                },
                { key: 'multipart', label: t("Multipart"), type: 'radio', options: YES_NO, disabled: (p: any) => String(p.method) !== 'post' || httpFormUrlEncoded(p) },
                { key: 'socketTimeout', label: t("Send Timeout (ms)"), type: 'number', width: '120px' },
                {
                    key: 'responseXmlBody', label: t("Response Content"), type: 'radio', refresh: true,
                    options: [
                        { value: false, label: t("Plain Body") },
                        { value: true, label: t("XML Body") }
                    ]
                },
                { key: 'responseParseMultipart', label: t("Parse Multipart"), type: 'radio', options: YES_NO, disabled: (p: any) => !asBool(p.responseXmlBody) },
                { key: 'responseIncludeMetadata', label: t("Include Metadata"), type: 'radio', options: YES_NO, disabled: (p: any) => !asBool(p.responseXmlBody) },
                {
                    key: 'responseBinaryMimeTypes', label: t("Binary MIME Types"), type: 'text', width: '320px',
                    append: (p: any, ctx: any) => checkbox(t("Regular Expression"), asBool(p.responseBinaryMimeTypesRegex), {
                        onChange: (e: any) => { p.responseBinaryMimeTypesRegex = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { section: t("HTTP Authentication") },
                {
                    // Swing's setAuthenticationEnabled(false) blanks the
                    // username/password fields in addition to disabling them.
                    key: 'useAuthentication', label: t("Authentication"), type: 'radio', options: YES_NO, refresh: true,
                    onSet: (p: any) => { if (!asBool(p.useAuthentication)) { p.username = ''; p.password = ''; } }
                },
                {
                    // Swing adds authenticationPreemptiveCheckBox inline on the Authentication Type row
                    // (add(basicRadio,"split 3"); add(digestRadio); add(preemptiveCheckBox)). Mirror that as
                    // an appended checkbox rather than a separate row.
                    key: 'authenticationType', label: t("Authentication Type"), type: 'radio', options: [{ value: 'Basic', label: t("Basic") }, { value: 'Digest', label: t("Digest") }], disabled: (p: any) => !usingAuth(p),
                    append: (p: any, ctx: any) => checkbox(t("Preemptive"), asBool(p.usePreemptiveAuthentication), {
                        disabled: !usingAuth(p),
                        onChange: (e: any) => { p.usePreemptiveAuthentication = e.target.checked; ctx.onChange(); }
                    }).el
                },
                { key: 'username', label: t("Username"), type: 'text', width: '220px', disabled: (p: any) => !usingAuth(p) },
                { key: 'password', label: t("Password"), type: 'password', width: '220px', disabled: (p: any) => !usingAuth(p) },
                { section: t("Request Settings") },
                { key: 'useParametersVariable', label: t("Query Parameters"), type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useQueryParamsVariableFieldsEnabled() greys (setEnabled) both controls while leaving
                // both visible: table disabled at Use Map, variable field disabled at Use Table. Grey-both.
                { key: 'parameters', type: 'keyvalue', mapShape: 'list', disabled: (p: any) => asBool(p.useParametersVariable) },
                { key: 'parametersVariable', label: t("Map Variable"), type: 'text', width: '320px', placeholder: t("e.g. RESTParams"), disabled: (p: any) => !asBool(p.useParametersVariable) },
                { key: 'useHeadersVariable', label: t("Headers"), type: 'radio', refresh: true, options: USE_TABLE_MAP },
                // Swing useHeadersVariableFieldsEnabled() greys both, same as query parameters above.
                { key: 'headers', type: 'keyvalue', mapShape: 'list', disabled: (p: any) => asBool(p.useHeadersVariable) },
                { key: 'headersVariable', label: t("Map Variable"), type: 'text', width: '320px', placeholder: t("e.g. RESTHeaders"), disabled: (p: any) => !asBool(p.useHeadersVariable) },
                {
                    key: 'contentType', label: t("Content Type"), type: 'text', width: '220px', refresh: true,
                    disabled: (p: any) => !httpHasBody(p),
                    // A form-urlencoded body is built from the query-parameter map,
                    // so Swing forces Multipart off + Data Type to Text here.
                    onSet: (p: any) => { if (httpFormUrlEncoded(p)) { p.multipart = false; p.dataTypeBinary = false; } }
                },
                {
                    // Swing forces the charset combo back to "default" (index 0)
                    // whenever Data Type=Binary is selected.
                    key: 'dataTypeBinary', label: t("Data Type"), type: 'radio', refresh: true,
                    disabled: (p: any) => !httpHasBody(p) || httpFormUrlEncoded(p),
                    onSet: (p: any) => { if (asBool(p.dataTypeBinary)) p.charset = DEFAULT_CHARSET; },
                    options: [
                        { value: true, label: t("Binary") },
                        { value: false, label: t("Text") }
                    ]
                },
                // Charset applies to the form-urlencoded body too (HttpDispatcher
                // builds the UrlEncodedFormEntity with it), so keep it settable for
                // form-urlencoded — only disable with no body or Binary data type
                // (matching Swing's dataTypeTextRadioActionPerformed re-enable).
                { key: 'charset', label: t("Charset Encoding"), type: 'select', options: HTTP_CHARSETS, width: '160px', disabled: (p: any) => !httpHasBody(p) || asBool(p.dataTypeBinary) },
                { key: 'content', label: t("Content"), type: 'textarea', rows: 8, tooltip: t("The HTTP message body."), disabled: (p: any) => !httpHasBody(p) || httpFormUrlEncoded(p) }
            ]} />
        );
    },
    // Swing HttpSender.checkProperties: URL + Send Timeout always required; proxy
    // address/port required when Use Proxy Server is on.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'host', label: t("URL") },
            { key: 'socketTimeout', label: t("Send Timeout") },
            { key: 'proxyAddress', label: t("Proxy Address"), when: (p: any) => asBool(p.useProxyServer) },
            { key: 'proxyPort', label: t("Proxy Port"), when: (p: any) => asBool(p.useProxyServer) }
        ]);
    }
};

export function register(platform: any) {
    platform.registerConnectorPanel('HTTP Listener', 'SOURCE', httpListener);
    platform.registerConnectorPanel('HTTP Sender', 'DESTINATION', httpSender);
}
