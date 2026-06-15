/*
 * TCP Listener (TcpReceiverProperties) / TCP Sender (TcpDispatcherProperties).
 */

import { h, select, icon } from '../core/ui.js';
import { platform } from '../core/platform.js';
import {
    buildForm, connectorTestButton, portsInUseButton, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, CHARSETS
} from './forms.js';

function defaultFrameMode() {
    return {
        '@class': 'com.mirth.connect.model.transmission.framemode.FrameModeProperties',
        pluginPointName: 'MLLP',
        startOfMessageBytes: '0B',
        endOfMessageBytes: '1C0D'
    };
}

/* Transmission Mode is a plugin point (TransmissionModePlugin): the mode list
   and each mode's settings come from platform.transmissionModes() — Basic is
   built in (connectors/index.js); MLLP ships as the mllpmode plugin. The
   '@class' is never changed here (a mode subclass with extra fields must
   round-trip); each mode's apply() only touches pluginPointName + its fields. */
function transmissionModePanel(properties, onChange) {
    const host = h('div', { style: { marginBottom: '16px' } });
    if (!properties.transmissionModeProperties || typeof properties.transmissionModeProperties !== 'object') {
        properties.transmissionModeProperties = defaultFrameMode();
    }
    const tm = properties.transmissionModeProperties;
    const modes = platform.transmissionModes();
    if (!tm.pluginPointName && modes[0]) tm.pluginPointName = modes[0].name;
    const modeOf = () => modes.find(m => m.name === tm.pluginPointName);

    const sampleEl = h('span.mono.faint', { style: { fontSize: '12px' } });
    const refreshSample = () => {
        const mode = modeOf();
        sampleEl.textContent = mode && mode.sampleFrame ? mode.sampleFrame(tm) : '<Message Data>';
    };

    // The wrench opens the active mode's settings dialog (frame bytes, etc.).
    const settingsBtn = h('button.icon-btn', {
        type: 'button', title: 'Transmission Mode Settings',
        onClick: () => { const mode = modeOf(); if (mode && mode.openSettings) mode.openSettings(tm, () => { onChange(); refreshSample(); }); }
    }, icon('settings'));

    const modeSel = select(modes.map(m => ({ value: m.name, label: m.label })), tm.pluginPointName, {
        onChange: (e) => {
            tm.pluginPointName = e.target.value;
            const mode = modeOf();
            if (mode && mode.apply) mode.apply(tm);
            onChange();
            refreshSample();
            settingsBtn.style.display = (mode && mode.openSettings) ? '' : 'none';
        }
    });
    modeSel.style.width = '180px';
    refreshSample();
    const m0 = modeOf();
    if (!(m0 && m0.openSettings)) settingsBtn.style.display = 'none';

    host.appendChild(h('div.cform',
        h('div.cform-section',
            h('div.cform-section-title', 'Transmission Mode'),
            h('div.cform-grid',
                h('label.cform-label', 'Transmission Mode:'),
                h('div.cform-control', h('div.flex', { style: { gap: '6px', alignItems: 'center' } }, modeSel, settingsBtn)),
                h('label.cform-label', 'Sample Frame:'),
                h('div.cform-control', sampleEl)))));
    return host;
}

const tcpListener = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.tcp.TcpReceiverProperties',
            '@version': version,
            pluginProperties: null,
            listenerConnectorProperties: defaultListenerProperties(version, '6661'),
            sourceConnectorProperties: defaultSourceProperties(version, {
                responseVariable: 'Auto-generate (After source transformer)',
                firstResponse: true
            }),
            transmissionModeProperties: defaultFrameMode(),
            serverMode: true,
            remoteAddress: '',
            remotePort: '',
            overrideLocalBinding: false,
            reconnectInterval: '5000',
            receiveTimeout: '0',
            bufferSize: '65536',
            maxConnections: '10',
            keepConnectionOpen: true,
            dataTypeBinary: false,
            charsetEncoding: 'DEFAULT_ENCODING',
            respondOnNewConnection: 0,
            responseAddress: '',
            responsePort: '',
            responseConnectorPluginProperties: null
        };
    },
    render(host, { properties, onChange }) {
        host.appendChild(transmissionModePanel(properties, onChange));
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [
            { section: 'Listener Settings' },
            // Mode: Server binds and listens locally; Client connects out to a
            // remote address (with optional local-binding override).
            { key: 'serverMode', label: 'Mode', type: 'radio', refresh: true, options: [
                { value: true, label: 'Server' },
                { value: false, label: 'Client' }
            ] },
            { key: 'remoteAddress', label: 'Remote Address', type: 'text', width: '200px', visible: (p) => p.serverMode === false },
            { key: 'remotePort', label: 'Remote Port', type: 'number', width: '90px', visible: (p) => p.serverMode === false },
            { key: 'overrideLocalBinding', label: 'Override Local Binding', type: 'radio', options: YES_NO, refresh: true, visible: (p) => p.serverMode === false },
            { key: 'listenerConnectorProperties.host', label: 'Local Address', type: 'text', width: '200px', visible: (p) => p.serverMode !== false || asBool(p.overrideLocalBinding) },
            { key: 'listenerConnectorProperties.port', label: 'Local Port', type: 'number', width: '90px', append: () => portsInUseButton(), visible: (p) => p.serverMode !== false || asBool(p.overrideLocalBinding) },
            { section: 'TCP Listener Settings' },
            { key: 'maxConnections', label: 'Max Connections', type: 'number', width: '110px' },
            { key: 'receiveTimeout', label: 'Receive Timeout (ms)', type: 'number', width: '120px', tooltip: '0 = never time out' },
            { key: 'bufferSize', label: 'Buffer Size (bytes)', type: 'number', width: '120px' },
            { key: 'keepConnectionOpen', label: 'Keep Connection Open', type: 'radio', options: YES_NO },
            { key: 'dataTypeBinary', label: 'Data Type', type: 'radio', options: [
                { value: true, label: 'Binary' },
                { value: false, label: 'Text' }
            ] },
            { key: 'charsetEncoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px' },
            { section: 'Response Settings' },
            {
                key: 'respondOnNewConnection', label: 'Respond on', type: 'radio', refresh: true,
                options: [
                    { value: 0, label: 'Same Connection' },
                    { value: 1, label: 'New Connection' },
                    { value: 2, label: 'New Connection on Recovery' }
                ]
            },
            { key: 'responseAddress', label: 'Response Address', type: 'text', width: '200px', visible: (p) => Number(p.respondOnNewConnection) > 0 },
            { key: 'responsePort', label: 'Response Port', type: 'number', width: '90px', visible: (p) => Number(p.respondOnNewConnection) > 0 }
        ], onChange);
    }
};

const tcpSender = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version, { validateResponse: true }),
            transmissionModeProperties: defaultFrameMode(),
            serverMode: false,
            remoteAddress: '127.0.0.1',
            remotePort: '6660',
            overrideLocalBinding: false,
            localAddress: '0.0.0.0',
            localPort: '0',
            sendTimeout: '5000',
            bufferSize: '65536',
            maxConnections: '10',
            keepConnectionOpen: false,
            checkRemoteHost: false,
            responseTimeout: '5000',
            ignoreResponse: false,
            queueOnResponseTimeout: true,
            dataTypeBinary: false,
            charsetEncoding: 'DEFAULT_ENCODING',
            template: '${message.encodedData}'
        };
    },
    render(host, { properties, channel, onChange }) {
        host.appendChild(transmissionModePanel(properties, onChange));
        const formHost = h('div');
        host.appendChild(formHost);
        buildForm(formHost, properties, [
            { section: 'Connection Settings' },
            {
                key: 'remoteAddress', label: 'Remote Address', type: 'text', width: '200px',
                append: () => connectorTestButton({ path: '/connectors/tcp/_testConnection', channel, properties })
            },
            { key: 'remotePort', label: 'Remote Port', type: 'number', width: '90px' },
            { key: 'overrideLocalBinding', label: 'Override Local Binding', type: 'radio', options: YES_NO, refresh: true },
            { key: 'localAddress', label: 'Local Address', type: 'text', width: '200px', visible: (p) => asBool(p.overrideLocalBinding) },
            { key: 'localPort', label: 'Local Port', type: 'number', width: '90px', visible: (p) => asBool(p.overrideLocalBinding) },
            { section: 'TCP Sender Settings' },
            { key: 'sendTimeout', label: 'Send Timeout (ms)', type: 'number', width: '120px' },
            { key: 'responseTimeout', label: 'Response Timeout (ms)', type: 'number', width: '120px' },
            { key: 'queueOnResponseTimeout', label: 'Queue on Response Timeout', type: 'checkbox' },
            { key: 'ignoreResponse', label: 'Ignore Response', type: 'radio', options: YES_NO },
            { key: 'bufferSize', label: 'Buffer Size (bytes)', type: 'number', width: '120px' },
            { key: 'maxConnections', label: 'Max Connections', type: 'number', width: '110px' },
            { key: 'keepConnectionOpen', label: 'Keep Connection Open', type: 'radio', options: YES_NO },
            { key: 'checkRemoteHost', label: 'Check Remote Host', type: 'radio', options: YES_NO },
            { key: 'dataTypeBinary', label: 'Data Type', type: 'radio', options: [
                { value: true, label: 'Binary' },
                { value: false, label: 'Text' }
            ] },
            { key: 'charsetEncoding', label: 'Encoding', type: 'select', options: CHARSETS, width: '160px' },
            { section: 'Template' },
            { key: 'template', label: 'Template', type: 'code', minHeight: '140px' }
        ], onChange);
    }
};

export function register(platform) {
    platform.registerConnectorPanel('TCP Listener', 'SOURCE', tcpListener);
    platform.registerConnectorPanel('TCP Sender', 'DESTINATION', tcpSender);
}
