import { t } from '../core/i18n.js';
/*
 * TCP Listener (TcpReceiverProperties) / TCP Sender (TcpDispatcherProperties).
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas
 * and defaults reused VERBATIM. The transmission-mode block (a plugin point:
 * Basic built-in + MLLP plugin) is the React <TransmissionModePanel>; the
 * connector test button keeps its imperative DOM node via the form's `append`.
 */

import { React } from './react-platform.js';
import { checkbox } from '@oie/web-ui';
import {
    ConnectorForm, TransmissionModePanel, connectorTestButton, portsInUseButton, listenerAddressField, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties, CHARSETS, requireFields
} from './react-forms.js';

function defaultFrameMode() {
    return {
        '@class': 'com.mirth.connect.model.transmission.framemode.FrameModeProperties',
        pluginPointName: 'MLLP',
        startOfMessageBytes: '0B',
        endOfMessageBytes: '1C0D'
    };
}

const tcpListener = {
    defaults(version: any) {
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
    component({ properties, onChange }: any) {
        // Server binds and listens locally; Client connects out to a remote
        // address. Swing's modeServer/modeClientRadioActionPerformed keep all the
        // mode-specific fields visible but toggle their enabled state.
        // asBool, not a strict compare: the engine wire shape can deliver
        // "true"/"false" strings, which a strict !== false read as Server mode
        // while validate() below read them as Client — an unresolvable save.
        const serverMode = (p: any) => asBool(p.serverMode);
        return (
            // Match the inter-section spacing a single ConnectorForm gives
            // (.cform gap), since this panel stacks two forms + the transmission
            // mode block.
            <div className="flex flex-col gap-4">
                {/* Local bind (listenerConnectorProperties) — the listening
                    address/port, shown at the top like every other listener
                    (HTTP/WS/DICOM) and the Swing TCP Listener. */}
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: t("Listener Settings") },
                    listenerAddressField('listenerConnectorProperties.host', t("Local Address")),
                    { key: 'listenerConnectorProperties.port', label: t("Local Port"), type: 'number', width: '90px', append: () => portsInUseButton() }
                ]} />
                <TransmissionModePanel properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: t("TCP Listener Settings") },
                    { key: 'serverMode', label: t("Mode"), type: 'radio', refresh: true, options: [
                        { value: true, label: t("Server") },
                        { value: false, label: t("Client") }
                    ] },
                    { key: 'remoteAddress', label: t("Remote Address"), type: 'text', width: '200px', disabled: serverMode },
                    { key: 'remotePort', label: t("Remote Port"), type: 'number', width: '90px', disabled: serverMode },
                    { key: 'overrideLocalBinding', label: t("Override Local Binding"), type: 'radio', options: YES_NO, disabled: serverMode },
                    { key: 'reconnectInterval', label: t("Reconnect Interval (ms)"), type: 'number', width: '90px', disabled: serverMode },
                    { key: 'maxConnections', label: t("Max Connections"), type: 'number', width: '90px', disabled: (p: any) => !asBool(p.serverMode) },
                    { key: 'receiveTimeout', label: t("Receive Timeout (ms)"), type: 'number', width: '90px', tooltip: t("0 = never time out") },
                    { key: 'bufferSize', label: t("Buffer Size (bytes)"), type: 'number', width: '90px' },
                    { key: 'keepConnectionOpen', label: t("Keep Connection Open"), type: 'radio', options: YES_NO },
                    {
                        key: 'dataTypeBinary', label: t("Data Type"), type: 'radio', refresh: true,
                        // Binary disables Encoding and forces it back to the default (Swing setSelectedIndex(0)).
                        onSet: (p: any) => { if (asBool(p.dataTypeBinary)) p.charsetEncoding = 'DEFAULT_ENCODING'; },
                        options: [
                            { value: true, label: t("Binary") },
                            { value: false, label: t("Text") }
                        ]
                    },
                    { key: 'charsetEncoding', label: t("Encoding"), type: 'select', options: CHARSETS, width: '160px', disabled: (p: any) => asBool(p.dataTypeBinary) },
                    {
                        key: 'respondOnNewConnection', label: t("Respond on New Connection"), type: 'radio', refresh: true,
                        options: [
                            { value: 1, label: t("Yes") },
                            { value: 0, label: t("No") },
                            { value: 2, label: t("Message Recovery") }
                        ]
                    },
                    { key: 'responseAddress', label: t("Response Address"), type: 'text', width: '200px', disabled: (p: any) => Number(p.respondOnNewConnection) === 0 },
                    { key: 'responsePort', label: t("Response Port"), type: 'number', width: '90px', disabled: (p: any) => Number(p.respondOnNewConnection) === 0 }
                ]} />
            </div>
        );
    },
    // Shared ListenerSettingsPanel.checkProperties: Local Address + Local Port always
    // required. TcpListener.checkProperties: Remote Address/Port + Reconnect Interval
    // required in Client mode (!serverMode); Receive Timeout, Buffer Size and Max
    // Connections always required; Response Address/Port required unless Respond on
    // New Connection is No (0). Numeric/range checks (e.g. maxConnections > 0) skipped.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'listenerConnectorProperties.host', label: t("Local Address") },
            { key: 'listenerConnectorProperties.port', label: t("Local Port") },
            { key: 'remoteAddress', label: t("Remote Address"), when: (p: any) => !asBool(p.serverMode) },
            { key: 'remotePort', label: t("Remote Port"), when: (p: any) => !asBool(p.serverMode) },
            { key: 'reconnectInterval', label: t("Reconnect Interval (ms)"), when: (p: any) => !asBool(p.serverMode) },
            { key: 'receiveTimeout', label: t("Receive Timeout (ms)") },
            { key: 'bufferSize', label: t("Buffer Size (bytes)") },
            { key: 'maxConnections', label: t("Max Connections") },
            { key: 'responseAddress', label: t("Response Address"), when: (p: any) => Number(p.respondOnNewConnection) !== 0 },
            { key: 'responsePort', label: t("Response Port"), when: (p: any) => Number(p.respondOnNewConnection) !== 0 }
        ]);
    }
};

const tcpSender = {
    defaults(version: any) {
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
    component({ properties, channel, onChange }: any) {
        // Server binds and listens locally; Client connects out to a remote host.
        // Swing's modeServer/modeClientRadioActionPerformed keep every field
        // visible but toggle enabled state, then re-apply the override-binding and
        // keep-connection-open sub-gating in Client mode.
        const serverMode = (p: any) => asBool(p.serverMode);
        const localBindingDisabled = (p: any) => !asBool(p.serverMode) && !asBool(p.overrideLocalBinding);
        const sendDisabled = (p: any) => asBool(p.serverMode) || !asBool(p.keepConnectionOpen);
        return (
            <div>
                <TransmissionModePanel properties={properties} onChange={onChange} />
                <ConnectorForm properties={properties} onChange={onChange} fields={[
                    { section: t("Connection Settings") },
                    // Swing initLayout adds modeClientRadio then modeServerRadio
                    // (TcpSender.java:654-655), so on-screen order is Client, Server.
                    { key: 'serverMode', label: t("Mode"), type: 'radio', refresh: true, options: [
                        { value: false, label: t("Client") },
                        { value: true, label: t("Server") }
                    ] },
                    {
                        key: 'remoteAddress', label: t("Remote Address"), type: 'text', width: '200px', disabled: serverMode,
                        // Test Connection greys in Server mode (TcpSender.modeServerRadioActionPerformed).
                        append: (p: any) => connectorTestButton({ path: '/connectors/tcp/_testConnection', channel, properties, disabled: serverMode(p) })
                    },
                    { key: 'remotePort', label: t("Remote Port"), type: 'number', width: '90px', disabled: serverMode },
                    { key: 'overrideLocalBinding', label: t("Override Local Binding"), type: 'radio', options: YES_NO, refresh: true, disabled: serverMode },
                    { key: 'localAddress', label: t("Local Address"), type: 'text', width: '200px', disabled: localBindingDisabled },
                    // Ports in Use follows the Local Port field: on in Server mode or Client+Override.
                    { key: 'localPort', label: t("Local Port"), type: 'number', width: '90px', append: (p: any) => portsInUseButton({ disabled: localBindingDisabled(p) }), disabled: localBindingDisabled },
                    { key: 'maxConnections', label: t("Max Connections"), type: 'number', width: '90px', disabled: (p: any) => !asBool(p.serverMode) },
                    { key: 'keepConnectionOpen', label: t("Keep Connection Open"), type: 'radio', options: YES_NO, refresh: true, disabled: serverMode },
                    { key: 'checkRemoteHost', label: t("Check Remote Host"), type: 'radio', options: YES_NO, disabled: sendDisabled },
                    { key: 'sendTimeout', label: t("Send Timeout (ms)"), type: 'number', width: '90px', disabled: sendDisabled },
                    { key: 'bufferSize', label: t("Buffer Size (bytes)"), type: 'number', width: '90px' },
                    {
                        key: 'responseTimeout', label: t("Response Timeout (ms)"), type: 'number', width: '90px',
                        // Swing pairs the Ignore Response checkbox inline with Response Timeout;
                        // it gates Queue on Response Timeout below.
                        append: (p: any, ctx: any) => checkbox(t("Ignore Response"), asBool(p.ignoreResponse), {
                            onChange: (e: any) => { p.ignoreResponse = e.target.checked; ctx.onChange(); }
                        }).el
                    },
                    { key: 'queueOnResponseTimeout', label: t("Queue on Response Timeout"), type: 'radio', options: YES_NO, disabled: (p: any) => asBool(p.ignoreResponse) },
                    {
                        key: 'dataTypeBinary', label: t("Data Type"), type: 'radio', refresh: true,
                        // Binary disables Encoding and forces it back to the default (Swing setSelectedIndex(0)).
                        onSet: (p: any) => { if (asBool(p.dataTypeBinary)) p.charsetEncoding = 'DEFAULT_ENCODING'; },
                        options: [
                            { value: true, label: t("Binary") },
                            { value: false, label: t("Text") }
                        ]
                    },
                    { key: 'charsetEncoding', label: t("Encoding"), type: 'select', options: CHARSETS, width: '160px', disabled: (p: any) => asBool(p.dataTypeBinary) },
                    { section: t("Template") },
                    { key: 'template', label: t("Template"), type: 'code', minHeight: '260px' }
                ]} />
            </div>
        );
    },
    // Swing TcpSender.checkProperties: Remote Address/Port required in Client mode
    // (!serverMode); Local Address/Port required in Server mode or when Override Local
    // Binding is on; Max Connections required in Server mode; Send Timeout required in
    // Client mode with Keep Connection Open; Buffer Size, Response Timeout and Template
    // always required. Numeric/range checks (e.g. maxConnections > 0) skipped.
    validate(properties: any) {
        return requireFields(properties, [
            { key: 'remoteAddress', label: t("Remote Address"), when: (p: any) => !asBool(p.serverMode) },
            { key: 'remotePort', label: t("Remote Port"), when: (p: any) => !asBool(p.serverMode) },
            { key: 'localAddress', label: t("Local Address"), when: (p: any) => asBool(p.serverMode) || asBool(p.overrideLocalBinding) },
            { key: 'localPort', label: t("Local Port"), when: (p: any) => asBool(p.serverMode) || asBool(p.overrideLocalBinding) },
            { key: 'maxConnections', label: t("Max Connections"), when: (p: any) => asBool(p.serverMode) },
            { key: 'sendTimeout', label: t("Send Timeout (ms)"), when: (p: any) => !asBool(p.serverMode) && asBool(p.keepConnectionOpen) },
            { key: 'bufferSize', label: t("Buffer Size (bytes)") },
            { key: 'responseTimeout', label: t("Response Timeout (ms)") },
            { key: 'template', label: t("Template") }
        ]);
    }
};

export function register(platform: any) {
    platform.registerConnectorPanel('TCP Listener', 'SOURCE', tcpListener);
    platform.registerConnectorPanel('TCP Sender', 'DESTINATION', tcpSender);
}
