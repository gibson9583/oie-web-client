/*
 * Web Service Listener (WebServiceReceiverProperties) /
 * Web Service Sender (WebServiceDispatcherProperties).
 *
 * The sender drives the engine's /connectors/ws servlet the same way the
 * Swing client does:
 *   Get Operations    POST _cacheWsdlFromUrl (properties body, channelId/Name
 *                     query params), then POST _getDefinition (form params) to
 *                     retrieve the DefinitionServiceMap.
 *   Generate Envelope POST _isWsdlCached, then _generateEnvelope and
 *                     _getSoapAction (form params, text/plain responses).
 *   Test Connection   POST _testConnection (properties body) — the engine
 *                     tests the Location URI if set, otherwise the WSDL URL.
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. ALL data logic
 * (parseDefinitionMap, the servlet handlers, the combo/attachment editors) is
 * reused VERBATIM; only the form rendering becomes the React <ConnectorForm>.
 * `services` is recomputed from properties.wsdlDefinitionMap on each render
 * (which getOperations mutates, then repaints) — equivalent to the imperative
 * closure var that was reassigned + repainted.
 */

import { React } from './react-platform.js';
import { h, clear, textInput, select, icon, toast, taskButton, confirmDialog } from '@oie/web-ui';
import * as api from '../core/api.js';
import {
    ConnectorForm, portsInUseButton, listenerAddressField, postConnectorProperties, successToast, apiErrorMessage,
    YES_NO, defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, asBool, requireFields
} from './react-forms.js';

// The Listener's "Web Service:" Default/Custom selector has no backing property in
// either Swing or web; Swing derives "Default" from className == DefaultAcceptMessage
// and force-resets className/method text on selection. Mirrored here as a derived
// (unpersisted) radio that gates classNameField + the Method display.
const WS_DEFAULT_CLASSNAME = 'com.mirth.connect.connectors.ws.DefaultAcceptMessage';
const wsIsDefaultClassName = (p) => String(p.className ?? '') === WS_DEFAULT_CLASSNAME;

// Generated WSDL URL display: http(s)://<server>:<port>/services/<serviceName>?wsdl.
function wsdlUrlDisplay(p) {
    const listener = p.listenerConnectorProperties || {};
    const rawHost = String(listener.host ?? '').trim();
    const host = !rawHost || rawHost === '0.0.0.0' ? window.location.hostname : rawHost;
    return `http://${host}:${listener.port ?? ''}/services/${p.serviceName ?? ''}?wsdl`;
}

const wsListener = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.ws.WebServiceReceiverProperties',
            '@version': version,
            pluginProperties: null,
            listenerConnectorProperties: defaultListenerProperties(version, '8081'),
            sourceConnectorProperties: defaultSourceProperties(version),
            className: 'com.mirth.connect.connectors.ws.DefaultAcceptMessage',
            serviceName: 'OIE',
            soapBinding: 'DEFAULT'
        };
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Listener Settings' },
                listenerAddressField('listenerConnectorProperties.host', 'Local Address'),
                { key: 'listenerConnectorProperties.port', label: 'Local Port', type: 'number', width: '90px', refresh: true, append: () => portsInUseButton() },
                { section: 'Web Service Listener Settings' },
                {
                    // Swing "Web Service:" Default/Custom selector — no backing property in
                    // either Swing or web; the selected state is derived from className.
                    // Default service forces className to DefaultAcceptMessage (and disables
                    // Service Class Name + shows the default Method); Custom service enables
                    // the field. Because the selection is derived purely from className (no
                    // phantom property), Custom must clear className off the default so the
                    // radio sticks — Swing keeps the default text but tracks the radio in its
                    // own ButtonGroup, which the web has no property to persist.
                    type: 'custom', label: 'Web Service', refresh: true,
                    render: (p, ctx) => {
                        const name = `ws-classname-source-${++uidCounter}`;
                        const isDefault = wsIsDefaultClassName(p);
                        const mk = (label, checked, onSelect) => h('label.check',
                            h('input', { type: 'radio', name, checked, onChange: onSelect }), label);
                        return h('div.radio-group.inline-row',
                            mk('Default service', isDefault, () => { p.className = WS_DEFAULT_CLASSNAME; onChange(); ctx.repaint(); }),
                            mk('Custom service', !isDefault, () => { if (wsIsDefaultClassName(p)) { p.className = ''; } onChange(); ctx.repaint(); }));
                    }
                },
                { key: 'className', label: 'Service Class Name', type: 'text', width: '420px', refresh: true, disabled: wsIsDefaultClassName },
                { key: 'serviceName', label: 'Service Name', type: 'text', width: '220px', refresh: true },
                { key: 'soapBinding', label: 'Binding', type: 'radio', options: [
                    { value: 'DEFAULT', label: 'Default' },
                    { value: 'SOAP11HTTP', label: 'SOAP 1.1' },
                    { value: 'SOAP12HTTP', label: 'SOAP 1.2' }
                ] },
                { type: 'display', label: 'WSDL URL', compute: wsdlUrlDisplay, width: '420px' },
                {
                    type: 'display', label: 'Method', width: '320px',
                    compute: (p) => wsIsDefaultClassName(p) ? 'String acceptMessage(String message)' : '<Custom Web Service Methods>'
                }
            ]} />
        );
    },
    // Swing ListenerSettingsPanel.checkProperties: Local Address + Local Port always
    // required. WebServiceListener.checkProperties: Service Class Name + Service Name.
    validate(properties) {
        return requireFields(properties, [
            { key: 'listenerConnectorProperties.host', label: 'Local Address' },
            { key: 'listenerConnectorProperties.port', label: 'Local Port' },
            { key: 'className', label: 'Service Class Name' },
            { key: 'serviceName', label: 'Service Name' }
        ]);
    }
};

/* ---- Web Service Sender --------------------------------------------------- */

const WS_DEFAULT_OPERATION = 'Press Get Operations';

const isTrue = (v) => v === true || v === 'true';
const usingAuth = (p) => isTrue(p.useAuthentication);

function asArray(value) {
    if (value === null || value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
}

/* XStream List<String>: { '@class': 'java.util.ArrayList', string: [...] } */
function stringList(list) {
    if (!list || typeof list !== 'object') return [];
    return asArray(list.string).map((v) => String(v ?? ''));
}

function writeStringList(list, values) {
    const target = list && typeof list === 'object' ? list : {};
    if (!target['@class']) target['@class'] = 'java.util.ArrayList';
    if (values.length) target.string = values;
    else delete target.string;
    return target;
}

/* The first non-attribute, non-'string' key of a map entry holds the value
   object (its key is the value's class name, e.g. '...DefinitionPortMap'). */
function entryValue(entry) {
    for (const key of Object.keys(entry)) {
        if (key !== 'string' && !key.startsWith('@')) return entry[key];
    }
    return null;
}

function entryKey(entry) {
    return Array.isArray(entry.string) ? String(entry.string[0] ?? '') : String(entry.string ?? '');
}

/* DefinitionServiceMap -> Map(service -> Map(port -> { operations, actions, locationURI })) */
function parseDefinitionMap(def) {
    const services = new Map();
    if (!def || typeof def !== 'object') return services;
    for (const entry of asArray(def.map && def.map.entry)) {
        if (!entry || typeof entry !== 'object') continue;
        const portMapObj = entryValue(entry);
        const ports = new Map();
        for (const portEntry of asArray(portMapObj && portMapObj.map && portMapObj.map.entry)) {
            if (!portEntry || typeof portEntry !== 'object') continue;
            const info = entryValue(portEntry) || {};
            ports.set(entryKey(portEntry), {
                operations: stringList(info.operations),
                actions: stringList(info.actions),
                locationURI: typeof info.locationURI === 'string' ? info.locationURI : ''
            });
        }
        services.set(entryKey(entry), ports);
    }
    return services;
}

/* Form-urlencoded body shared by _isWsdlCached/_getDefinition/_generateEnvelope/_getSoapAction. */
function wsFormBody(properties, channel, extra) {
    const form = new URLSearchParams({
        channelId: channel ? channel.id : '',
        channelName: channel && channel.name !== undefined ? channel.name : '',
        wsdlUrl: properties.wsdlUrl ?? '',
        username: properties.username ?? '',
        password: properties.password ?? ''
    });
    for (const [key, value] of Object.entries(extra || {})) form.set(key, value);
    return form.toString();
}

/* Swing's two "Test Connection" buttons (testConnectionButtonActionPerformed):
   each blanks the OTHER URL property on a COPY of the props so only the targeted
   field is exercised by the servlet (the engine tests Location URI if set, else
   WSDL URL). canTestConnection guards on the targeted field being non-blank.
   wsdlUrl=true tests the WSDL URL (blanks locationURI); wsdlUrl=false tests the
   Location URI (blanks wsdlUrl). connectorTestButton posts its `properties`
   object verbatim by reference, so a clone is built fresh at CLICK time (not at
   render time, to capture in-progress edits) — hence a small DOM button that
   posts the clone directly rather than connectorTestButton({ properties:{...} }). */
function wsTestConnectionButton(properties, channel, wsdlUrl) {
    const btn = taskButton('Test Connection', 'link', async () => {
        const target = wsdlUrl ? properties.wsdlUrl : properties.locationURI;
        if (!String(target ?? '').trim()) {
            toast(wsdlUrl ? 'WSDL URL is blank.' : 'Location URI is blank.', 'warn');
            return;
        }
        const props = Object.assign({}, properties);
        if (wsdlUrl) props.locationURI = ''; else props.wsdlUrl = '';
        btn.disabled = true;
        try {
            const result = await postConnectorProperties('/connectors/ws/_testConnection', props, channel);
            const type = result && typeof result === 'object' ? String(result.type ?? '') : '';
            const message = (result && typeof result === 'object' && result.message) || type || 'No response received';
            if (type === 'SUCCESS') successToast(message);
            else toast(message, 'error');
        } catch (e) {
            toast(apiErrorMessage(e), 'error');
        } finally {
            btn.disabled = false;
        }
    });
    return btn;
}

let uidCounter = 0;

/* Editable text input with datalist suggestions (combo box stand-in). */
function comboInput(value, options, { placeholder, onInput, onCommit } = {}) {
    const id = `ws-list-${++uidCounter}`;
    return h('div',
        h('input', { type: 'text', value: value ?? '', list: id, placeholder, onInput, onChange: onCommit }),
        h('datalist', { id }, options.map((o) => h('option', { value: o }))));
}

function attachmentsTable(properties, onChange, disabled) {
    const wrap = h('div');
    const names = stringList(properties.attachmentNames);
    const contents = stringList(properties.attachmentContents);
    const types = stringList(properties.attachmentTypes);
    const rows = [];
    for (let i = 0; i < Math.max(names.length, contents.length, types.length); i++) {
        rows.push([names[i] ?? '', contents[i] ?? '', types[i] ?? '']);
    }
    const commit = () => {
        const clean = rows.filter((r) => r[0] !== '' || r[1] !== '' || r[2] !== '');
        properties.attachmentNames = writeStringList(properties.attachmentNames, clean.map((r) => r[0]));
        properties.attachmentContents = writeStringList(properties.attachmentContents, clean.map((r) => r[1]));
        properties.attachmentTypes = writeStringList(properties.attachmentTypes, clean.map((r) => r[2]));
        onChange();
    };
    function paint() {
        clear(wrap);
        rows.forEach((row, i) => {
            wrap.appendChild(h('div', { class: 'flex gap-1.5 mb-1.5' },
                textInput(row[0], { placeholder: 'ID', disabled, class: 'flex-1', onInput: (e) => { row[0] = e.target.value; commit(); } }),
                textInput(row[1], { placeholder: 'Content', disabled, class: 'flex-[2]', onInput: (e) => { row[1] = e.target.value; commit(); } }),
                textInput(row[2], { placeholder: 'MIME Type', disabled, class: 'flex-1', onInput: (e) => { row[2] = e.target.value; commit(); } }),
                h('button.icon-btn', { type: 'button', title: 'Remove', disabled, onClick: () => { rows.splice(i, 1); commit(); paint(); } }, icon('x'))));
        });
        wrap.appendChild(h('button.btn', { type: 'button', disabled, onClick: () => { rows.push(['', '', '']); paint(); } }, 'Add'));
    }
    paint();
    return wrap;
}

const wsSender = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.ws.WebServiceDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            wsdlUrl: '',
            service: '',
            port: '',
            operation: WS_DEFAULT_OPERATION,
            locationURI: '',
            socketTimeout: '30000',
            useAuthentication: false,
            username: '',
            password: '',
            envelope: '',
            oneWay: false,
            headers: { '@class': 'linked-hash-map' },
            headersVariable: '',
            isUseHeadersVariable: false,
            useMtom: false,
            attachmentNames: { '@class': 'java.util.ArrayList' },
            attachmentContents: { '@class': 'java.util.ArrayList' },
            attachmentTypes: { '@class': 'java.util.ArrayList' },
            attachmentsVariable: '',
            isUseAttachmentsVariable: false,
            soapAction: '',
            wsdlDefinitionMap: { map: { '@class': 'linked-hash-map' } }
        };
    },
    component({ properties, channel, onChange }) {
        // `services` is derived LIVE from properties.wsdlDefinitionMap inside each
        // field's render() (called on every ConnectorForm repaint) and inside the
        // handlers — so after getOperations rewrites the definition map and
        // repaints, the dropdowns reflect the new operations without needing the
        // connector component itself to re-run. This mirrors the imperative
        // closure var that was reassigned then repainted.
        const getServices = () => parseDefinitionMap(properties.wsdlDefinitionMap);

        const currentPortInfo = () => {
            const ports = getServices().get(String(properties.service ?? ''));
            return ports ? ports.get(String(properties.port ?? '')) : undefined;
        };

        async function getOperations(btn, repaint) {
            if (!String(properties.wsdlUrl ?? '').trim()) {
                toast('WSDL URL is blank', 'warn');
                return;
            }
            // Swing getOperationsButtonActionPerformed confirms before replacing
            // an existing service/port/location/operation set.
            const hasOps = [properties.service, properties.port, properties.locationURI].some((v) => String(v ?? '').trim())
                || (String(properties.operation ?? '') && properties.operation !== WS_DEFAULT_OPERATION);
            if (hasOps && !(await confirmDialog('Get Operations',
                'This will replace your current service, port, location URI, and operation list. Press OK to continue.'))) return;
            btn.disabled = true;
            toast('Downloading and caching WSDL — this may take a moment…');
            try {
                await postConnectorProperties('/connectors/ws/_cacheWsdlFromUrl', properties, channel);
                const definition = await api.post('/connectors/ws/_getDefinition', wsFormBody(properties, channel), {
                    contentType: 'application/x-www-form-urlencoded'
                });
                properties.wsdlDefinitionMap = definition && typeof definition === 'object'
                    ? definition : { map: { '@class': 'linked-hash-map' } };
                const nextServices = parseDefinitionMap(properties.wsdlDefinitionMap);

                const firstService = nextServices.keys().next().value ?? '';
                properties.service = firstService;
                const ports = nextServices.get(firstService) || new Map();
                const firstPort = ports.keys().next().value ?? '';
                properties.port = firstPort;
                const info = ports.get(firstPort);
                properties.locationURI = info && info.locationURI ? info.locationURI : '';
                const ops = info ? info.operations : [];
                properties.operation = ops.length ? ops[0] : WS_DEFAULT_OPERATION;
                properties.soapAction = (ops.length && info.actions.length) ? (info.actions[0] ?? '') : '';
                onChange();
                repaint();
                successToast(`Retrieved ${ops.length} operation${ops.length === 1 ? '' : 's'}`);
            } catch (e) {
                toast('Error caching WSDL. Please check the WSDL URL and authentication settings.\n' + apiErrorMessage(e), 'error');
            } finally {
                btn.disabled = false;
            }
        }

        async function generateEnvelope(btn, repaint) {
            const operation = String(properties.operation ?? '');
            if (!String(properties.wsdlUrl ?? '').trim()) {
                toast('WSDL URL is blank', 'warn');
                return;
            }
            if (!operation || operation === WS_DEFAULT_OPERATION) {
                toast('Press Get Operations and select an operation first', 'warn');
                return;
            }
            // Swing generateEnvelope confirms before overwriting an existing envelope/action.
            if ((String(properties.envelope ?? '').trim() || String(properties.soapAction ?? '').trim())
                && !(await confirmDialog('Generate Envelope',
                'This will replace your current SOAP envelope and SOAP action. Press OK to continue.'))) return;
            btn.disabled = true;
            try {
                const cached = await api.post('/connectors/ws/_isWsdlCached', wsFormBody(properties, channel), {
                    contentType: 'application/x-www-form-urlencoded'
                });
                if (!isTrue(cached)) {
                    toast('The WSDL is no longer cached on the server. Press "Get Operations" to fetch the latest WSDL.', 'warn');
                    return;
                }
                const opParams = {
                    service: properties.service ?? '',
                    port: properties.port ?? '',
                    operation
                };
                const envelope = await api.post('/connectors/ws/_generateEnvelope',
                    wsFormBody(properties, channel, Object.assign({ buildOptional: true }, opParams)),
                    { contentType: 'application/x-www-form-urlencoded', raw: true });
                if (envelope !== null && envelope !== undefined) properties.envelope = envelope;
                try {
                    const soapAction = await api.post('/connectors/ws/_getSoapAction',
                        wsFormBody(properties, channel, opParams),
                        { contentType: 'application/x-www-form-urlencoded', raw: true });
                    if (soapAction) properties.soapAction = soapAction;
                } catch (e) {
                    toast('There was an error retrieving the SOAP action.\n' + apiErrorMessage(e), 'warn');
                }
                onChange();
                repaint();
                successToast('SOAP envelope generated');
            } catch (e) {
                toast('There was an error generating the envelope.\n' + apiErrorMessage(e), 'error');
            } finally {
                btn.disabled = false;
            }
        }

        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Web Service Sender Settings' },
                {
                    type: 'custom', label: 'WSDL URL', span: true,
                    render: (p, ctx) => {
                        const input = textInput(p.wsdlUrl ?? '', {
                            class: 'flex-1',
                            onInput: (e) => { p.wsdlUrl = e.target.value; onChange(); }
                        });
                        const getOpsBtn = taskButton('Get Operations', 'refresh', () => getOperations(getOpsBtn, ctx.repaint));
                        // Swing testConnectionButtonActionPerformed(true): blanks locationURI
                        // on a copy so only the WSDL URL is tested.
                        const testBtn = wsTestConnectionButton(p, channel, true);
                        return h('div', { class: 'flex gap-1.5' }, input, getOpsBtn, testBtn);
                    }
                },
                {
                    type: 'custom', label: 'Service', width: '320px',
                    render: (p, ctx) => comboInput(p.service, [...getServices().keys()], {
                        onInput: (e) => { p.service = e.target.value; onChange(); },
                        onCommit: () => ctx.repaint()
                    })
                },
                {
                    type: 'custom', label: 'Port / Endpoint', width: '320px',
                    render: (p, ctx) => {
                        const ports = getServices().get(String(p.service ?? ''));
                        return comboInput(p.port, ports ? [...ports.keys()] : [], {
                            onInput: (e) => { p.port = e.target.value; onChange(); },
                            onCommit: () => {
                                const info = currentPortInfo();
                                if (info && info.locationURI) { p.locationURI = info.locationURI; onChange(); }
                                ctx.repaint();
                            }
                        });
                    }
                },
                {
                    // Swing initLayout: add(locationURIComboBox, "split 2"); add(locationURITestConnectionButton).
                    // The second Test Connection button blanks wsdlUrl on a copy so only the
                    // Location URI is tested (testConnectionButtonActionPerformed(false)).
                    type: 'custom', label: 'Location URI', span: true,
                    render: (p) => {
                        const info = currentPortInfo();
                        const combo = comboInput(p.locationURI, info && info.locationURI ? [info.locationURI] : [], {
                            placeholder: 'Optional override of the endpoint address',
                            onInput: (e) => { p.locationURI = e.target.value; onChange(); }
                        });
                        combo.style.flex = '1';
                        const testBtn = wsTestConnectionButton(p, channel, false);
                        return h('div', { class: 'flex gap-1.5' }, combo, testBtn);
                    }
                },
                { key: 'socketTimeout', label: 'Socket Timeout (ms)', type: 'number', width: '120px', tooltip: '0 = no timeout' },
                {
                    key: 'useAuthentication', label: 'Authentication', type: 'radio', options: YES_NO, refresh: true,
                    onSet: (p, v) => { if (!v) { p.username = ''; p.password = ''; } }
                },
                { key: 'username', label: 'Username', type: 'text', width: '220px', disabled: (p) => !usingAuth(p) },
                { key: 'password', label: 'Password', type: 'password', width: '220px', disabled: (p) => !usingAuth(p) },
                // Swing initLayout order: invocationOneWayRadio then invocationTwoWayRadio
                // (One-Way, Two-Way left-to-right). Match that option order.
                { key: 'oneWay', label: 'Invocation Type', type: 'radio', options: [
                    { value: true, label: 'One-Way' },
                    { value: false, label: 'Two-Way' }
                ] },
                {
                    // Swing places the Generate Envelope button inline on the Operation
                    // row (add(operationComboBox,"split 2"); add(generateEnvelopeButton)).
                    // The button is disabled until real operations are loaded
                    // (updateGenerateEnvelopeButtonEnabled -> !isDefaultOperations()).
                    type: 'custom', label: 'Operation', span: true,
                    render: (p, ctx) => {
                        const info = currentPortInfo();
                        const ops = info ? [...info.operations] : [];
                        const current = String(p.operation ?? '');
                        if (!ops.includes(current)) ops.unshift(current || WS_DEFAULT_OPERATION);
                        const combo = select(ops.map((o) => ({ value: o, label: o })), current, {
                            class: 'w-[320px]',
                            onChange: (e) => {
                                p.operation = e.target.value;
                                const index = info ? info.operations.indexOf(e.target.value) : -1;
                                p.soapAction = (index >= 0 && index < (info.actions || []).length) ? (info.actions[index] ?? '') : '';
                                onChange();
                                ctx.repaint();
                            }
                        });
                        const btn = taskButton('Generate Envelope', 'code', () => generateEnvelope(btn, ctx.repaint), {
                            title: 'Regenerates the SOAP Envelope from the cached WSDL schema and populates the SOAP Action, if available'
                        });
                        if (!current || current === WS_DEFAULT_OPERATION) btn.disabled = true;
                        return h('div', { class: 'flex gap-1.5 items-center' }, combo, btn);
                    }
                },
                { key: 'soapAction', label: 'SOAP Action', type: 'text', width: '320px' },
                { key: 'envelope', label: 'SOAP Envelope', type: 'code', language: 'xml', minHeight: '220px' },
                { section: 'Headers' },
                { key: 'isUseHeadersVariable', label: 'Headers Source', type: 'radio', refresh: true, options: [
                    { value: false, label: 'Use Table' },
                    { value: true, label: 'Use Map' }
                ] },
                { key: 'headersVariable', label: 'Headers Map Variable', type: 'text', width: '220px', disabled: (p) => !isTrue(p.isUseHeadersVariable) },
                { key: 'headers', label: 'Headers', type: 'keyvalue', mapShape: 'list', disabled: (p) => isTrue(p.isUseHeadersVariable) },
                { section: 'Attachments' },
                { key: 'useMtom', label: 'Use MTOM', type: 'radio', options: YES_NO, refresh: true },
                {
                    // Swing keeps the whole attachments block VISIBLE but disables it
                    // when MTOM=No (useMtomNoRadioActionPerformed). The source radio,
                    // variable field, and table are gated on useMtom + the sub-selection.
                    key: 'isUseAttachmentsVariable', label: 'Attachments Source', type: 'radio', refresh: true,
                    disabled: (p) => !isTrue(p.useMtom),
                    options: [
                        { value: false, label: 'Use Table' },
                        { value: true, label: 'Use List' }
                    ]
                },
                {
                    key: 'attachmentsVariable', label: 'Attachments List Variable', type: 'text', width: '220px',
                    disabled: (p) => !(isTrue(p.useMtom) && isTrue(p.isUseAttachmentsVariable))
                },
                {
                    type: 'custom', label: 'Attachments', span: true,
                    render: (p) => attachmentsTable(p, onChange, !(isTrue(p.useMtom) && !isTrue(p.isUseAttachmentsVariable)))
                }
            ]} />
        );
    },
    // Swing WebServiceSender.checkProperties: WSDL URL, Service, Port/Endpoint, Socket
    // Timeout and SOAP Envelope always required; Headers Map Variable required when
    // "Use Map" is selected; Attachments List Variable required when MTOM + "Use List".
    // (DestinationSettingsPanel.checkProperties returns true — no destination-level
    // required fields.)
    validate(properties) {
        return requireFields(properties, [
            { key: 'wsdlUrl', label: 'WSDL URL' },
            { key: 'service', label: 'Service' },
            { key: 'port', label: 'Port / Endpoint' },
            { key: 'socketTimeout', label: 'Socket Timeout (ms)' },
            { key: 'envelope', label: 'SOAP Envelope' },
            { key: 'headersVariable', label: 'Headers Map Variable', when: (p) => asBool(p.isUseHeadersVariable) },
            { key: 'attachmentsVariable', label: 'Attachments List Variable', when: (p) => asBool(p.useMtom) && asBool(p.isUseAttachmentsVariable) }
        ]);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Web Service Listener', 'SOURCE', wsListener);
    platform.registerConnectorPanel('Web Service Sender', 'DESTINATION', wsSender);
}
