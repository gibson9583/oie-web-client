/*
 * DICOM Listener (DICOMReceiverProperties) / DICOM Sender (DICOMDispatcherProperties).
 * Field names and defaults mirror server/src/com/mirth/connect/connectors/dimse.
 *
 * React port: def.render(host, ctx) -> def.component(ctx) => JSX. Field schemas,
 * the shared TLS-field block, and defaults are reused VERBATIM. The 'Ports in
 * Use' button is the original imperative portsInUseButton() DOM node, mounted
 * via the form's `append`.
 *
 * Field order, labels and gating mirror the Swing DICOMListener.java (GroupLayout)
 * and DICOMSender.java (MigLayout) panels.
 */

import { React } from './react-platform.js';
import {
    ConnectorForm, portsInUseButton, listenerAddressField, asBool, YES_NO,
    defaultSourceProperties, defaultDestinationProperties, defaultListenerProperties
} from './react-forms.js';

const TLS_OPTIONS = [
    { value: 'notls', label: 'No TLS' },
    { value: '3des', label: '3DES' },
    { value: 'aes', label: 'AES' },
    { value: 'without', label: 'Without' }
];

// Swing tlsNoRadioActionPerformed greys (setEnabled(false)) the whole keystore /
// client-auth / accept-ssl-v2 block when TLS = "No TLS"; the 3DES/AES/Without
// handlers re-enable it. Fields stay visible, just disabled.
const tlsDisabled = (p) => p.tls === 'notls';

/* TLS / keystore fields shared by listener and sender (same Java fields). */
function tlsFields() {
    return [
        { section: 'TLS Settings' },
        { key: 'tls', label: 'TLS', type: 'select', options: TLS_OPTIONS, width: '120px', refresh: true },
        { key: 'noClientAuth', label: 'Client Authentication TLS', type: 'radio', options: [
            { value: false, label: 'Yes' },
            { value: true, label: 'No' }
        ], disabled: tlsDisabled },
        { key: 'nossl2', label: 'Accept ssl v2 TLS handshake', type: 'radio', options: [
            { value: false, label: 'Yes' },
            { value: true, label: 'No' }
        ], disabled: tlsDisabled },
        { key: 'keyStore', label: 'Keystore', type: 'text', width: '320px', disabled: tlsDisabled },
        { key: 'keyStorePW', label: 'Keystore Password', type: 'password', width: '220px', disabled: tlsDisabled },
        { key: 'trustStore', label: 'Trust Store', type: 'text', width: '320px', disabled: tlsDisabled },
        { key: 'trustStorePW', label: 'Trust Store Password', type: 'password', width: '220px', disabled: tlsDisabled },
        { key: 'keyPW', label: 'Key Password', type: 'password', width: '220px', disabled: tlsDisabled }
    ];
}

// DICOMListener mutual gating (bigendian/defts/native action handlers):
//   - defts=Yes disables AND forces bigEndian=No + nativeData=No.
//   - bigEndian=Yes disables defts AND forces defts=No.
//   - nativeData=Yes disables defts AND forces defts=No.
//   - defts is enabled only when bigEndian=No AND nativeData=No.
//   - bigEndian / nativeData are disabled when defts=Yes.
const deftsLocked = (p) => asBool(p.bigEndian) || asBool(p.nativeData);
const transferSyntaxLocked = (p) => asBool(p.defts);

const dicomListener = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.dimse.DICOMReceiverProperties',
            '@version': version,
            pluginProperties: null,
            listenerConnectorProperties: defaultListenerProperties(version, '104'),
            sourceConnectorProperties: defaultSourceProperties(version),
            applicationEntity: '',
            localHost: '',
            localPort: '',
            localApplicationEntity: '',
            soCloseDelay: '50',
            releaseTo: '5',
            requestTo: '5',
            idleTo: '60',
            reaper: '10',
            rspDelay: '0',
            pdv1: false,
            sndpdulen: '16',
            rcvpdulen: '16',
            async: '0',
            bigEndian: false,
            bufSize: '1',
            defts: false,
            dest: '',
            nativeData: false,
            sorcvbuf: '0',
            sosndbuf: '0',
            tcpDelay: true,
            keyPW: '',
            keyStore: '',
            keyStorePW: '',
            noClientAuth: true,
            nossl2: true,
            tls: 'notls',
            trustStore: '',
            trustStorePW: ''
        };
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Connection Settings' },
                listenerAddressField('listenerConnectorProperties.host', 'Listener Address'),
                { key: 'listenerConnectorProperties.port', label: 'Listener Port', type: 'number', width: '90px', append: () => portsInUseButton() },
                { key: 'applicationEntity', label: 'Application Entity', type: 'text', width: '220px' },
                { key: 'async', label: 'Max Async operations', type: 'number', width: '110px' },
                { key: 'pdv1', label: 'Pack PDV', type: 'radio', options: YES_NO },
                { key: 'reaper', label: 'DIMSE-RSP interval period (s)', type: 'number', width: '110px' },
                { key: 'releaseTo', label: 'A-RELEASE-RP timeout (s)', type: 'number', width: '110px' },
                { key: 'soCloseDelay', label: 'Socket Close Delay After A-ABORT (ms)', type: 'number', width: '110px' },
                { key: 'requestTo', label: 'ASSOCIATE-RQ timeout (ms)', type: 'number', width: '110px' },
                { key: 'idleTo', label: 'DIMSE-RQ timeout (ms)', type: 'number', width: '110px' },
                { key: 'rspDelay', label: 'DIMSE-RSP delay (ms)', type: 'number', width: '110px' },
                { key: 'sndpdulen', label: 'P-DATA-TF PDUs max length sent (KB)', type: 'number', width: '110px' },
                { key: 'rcvpdulen', label: 'P-DATA-TF PDUs max length received (KB)', type: 'number', width: '110px' },
                { key: 'sosndbuf', label: 'Send Socket Buffer Size (KB)', type: 'number', width: '110px' },
                { key: 'sorcvbuf', label: 'Receive Socket Buffer Size (KB)', type: 'number', width: '110px' },
                { key: 'bufSize', label: 'Transcoder Buffer Size (KB)', type: 'number', width: '110px' },
                {
                    key: 'bigEndian', label: 'Accept Explict VR Big Endian', type: 'radio', options: YES_NO, refresh: true,
                    disabled: transferSyntaxLocked,
                    onSet: (p) => { if (asBool(p.bigEndian)) p.defts = false; }
                },
                {
                    key: 'defts', label: 'Only Accept Default Transfer Syntax', type: 'radio', options: YES_NO, refresh: true,
                    disabled: deftsLocked,
                    onSet: (p) => { if (asBool(p.defts)) { p.bigEndian = false; p.nativeData = false; } }
                },
                {
                    key: 'nativeData', label: 'Only Uncompressed Pixel Data', type: 'radio', options: YES_NO, refresh: true,
                    disabled: transferSyntaxLocked,
                    onSet: (p) => { if (asBool(p.nativeData)) p.defts = false; }
                },
                { key: 'tcpDelay', label: 'TCP Delay', type: 'radio', options: YES_NO },
                { key: 'dest', label: 'Store Received Objects in Directory', type: 'text', width: '320px' },
                ...tlsFields()
            ]} />
        );
    }
};

const dicomSender = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.dimse.DICOMDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            host: '127.0.0.1',
            port: '104',
            applicationEntity: '',
            localHost: '',
            localPort: '',
            localApplicationEntity: '',
            template: '${DICOMMESSAGE}',
            acceptTo: '5000',
            async: '0',
            bufSize: '1',
            connectTo: '0',
            priority: 'med',
            passcode: '',
            pdv1: false,
            rcvpdulen: '16',
            reaper: '10',
            releaseTo: '5',
            rspTo: '60',
            shutdownDelay: '1000',
            sndpdulen: '16',
            soCloseDelay: '50',
            sorcvbuf: '0',
            sosndbuf: '0',
            stgcmt: false,
            tcpDelay: true,
            ts1: false,
            uidnegrsp: false,
            username: '',
            keyPW: '',
            keyStore: '',
            keyStorePW: '',
            noClientAuth: true,
            nossl2: true,
            tls: 'notls',
            trustStore: '',
            trustStorePW: ''
        };
    },
    component({ properties, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Connection Settings' },
                { key: 'host', label: 'Remote Host', type: 'text', width: '200px' },
                { key: 'localHost', label: 'Local Host', type: 'text', width: '200px' },
                { key: 'port', label: 'Remote Port', type: 'number', width: '90px' },
                { key: 'localPort', label: 'Local Port', type: 'number', width: '90px', append: () => portsInUseButton() },
                { key: 'applicationEntity', label: 'Remote Application Entity', type: 'text', width: '220px' },
                { key: 'localApplicationEntity', label: 'Local Application Entity', type: 'text', width: '220px' },
                { key: 'async', label: 'Max Async operations', type: 'number', width: '110px' },
                { key: 'priority', label: 'Priority', type: 'radio', options: [
                    { value: 'high', label: 'High' },
                    { value: 'med', label: 'Medium' },
                    { value: 'low', label: 'Low' }
                ] },
                { key: 'stgcmt', label: 'Request Storage Commitment', type: 'radio', options: YES_NO },
                { key: 'username', label: 'User Name', type: 'text', width: '220px' },
                { key: 'passcode', label: 'Pass Code', type: 'password', width: '220px' },
                { section: 'Settings' },
                { key: 'uidnegrsp', label: 'Request Positive User Identity Response', type: 'radio', options: YES_NO },
                { key: 'pdv1', label: 'Pack PDV', type: 'radio', options: YES_NO },
                { key: 'reaper', label: 'DIMSE-RSP interval period (s)', type: 'number', width: '110px' },
                { key: 'sndpdulen', label: 'P-DATA-TF PDUs max length sent (KB)', type: 'number', width: '110px' },
                { key: 'releaseTo', label: 'A-RELEASE-RP timeout (s)', type: 'number', width: '110px' },
                { key: 'rcvpdulen', label: 'P-DATA-TF PDUs  max length received (KB)', type: 'number', width: '110px' },
                { key: 'rspTo', label: 'DIMSE-RSP timeout (s)', type: 'number', width: '110px' },
                { key: 'sosndbuf', label: 'Send Socket Buffer Size (KB)', type: 'number', width: '110px' },
                { key: 'shutdownDelay', label: 'Shutdown delay (ms)', type: 'number', width: '110px' },
                { key: 'sorcvbuf', label: 'Receive Socket Buffer Size (KB)', type: 'number', width: '110px' },
                { key: 'soCloseDelay', label: 'Socket Close Delay After A-ABORT (ms)', type: 'number', width: '110px' },
                { key: 'bufSize', label: 'Transcoder Buffer Size (KB)', type: 'number', width: '110px' },
                { key: 'acceptTo', label: 'Timeout A-ASSOCIATE-AC (ms)', type: 'number', width: '110px' },
                { key: 'connectTo', label: 'TCP Connection Timeout (ms)', type: 'number', width: '110px' },
                { key: 'tcpDelay', label: 'TCP Delay', type: 'radio', options: YES_NO },
                { key: 'ts1', label: 'Default Presentation Syntax', type: 'radio', options: YES_NO },
                ...tlsFields(),
                { section: 'Template' },
                { key: 'template', label: 'Template', type: 'code', minHeight: '120px' }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('DICOM Listener', 'SOURCE', dicomListener);
    platform.registerConnectorPanel('DICOM Sender', 'DESTINATION', dicomSender);
}
