import { React } from "./react-platform.js";
import {
  ConnectorForm,
  portsInUseButton,
  YES_NO,
  defaultSourceProperties,
  defaultDestinationProperties,
  defaultListenerProperties
} from "./react-forms.js";
const TLS_OPTIONS = [
  { value: "notls", label: "No TLS" },
  { value: "3des", label: "3DES" },
  { value: "aes", label: "AES" },
  { value: "without", label: "Without" }
];
const tlsEnabled = (p) => p.tls !== "notls";
function tlsFields() {
  return [
    { section: "TLS Settings" },
    { key: "tls", label: "TLS", type: "select", options: TLS_OPTIONS, width: "120px", refresh: true },
    { key: "noClientAuth", label: "Client Authentication TLS", type: "radio", options: [
      { value: false, label: "Yes" },
      { value: true, label: "No" }
    ], visible: tlsEnabled },
    { key: "nossl2", label: "Accept ssl v2 TLS handshake", type: "radio", options: [
      { value: false, label: "Yes" },
      { value: true, label: "No" }
    ], visible: tlsEnabled },
    { key: "keyStore", label: "Keystore", type: "text", width: "320px", visible: tlsEnabled },
    { key: "keyStorePW", label: "Keystore Password", type: "password", width: "220px", visible: tlsEnabled },
    { key: "keyPW", label: "Key Password", type: "password", width: "220px", visible: tlsEnabled },
    { key: "trustStore", label: "Trust Store", type: "text", width: "320px", visible: tlsEnabled },
    { key: "trustStorePW", label: "Trust Store Password", type: "password", width: "220px", visible: tlsEnabled }
  ];
}
const dicomListener = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.dimse.DICOMReceiverProperties",
      "@version": version,
      pluginProperties: null,
      listenerConnectorProperties: defaultListenerProperties(version, "104"),
      sourceConnectorProperties: defaultSourceProperties(version),
      applicationEntity: "",
      localHost: "",
      localPort: "",
      localApplicationEntity: "",
      soCloseDelay: "50",
      releaseTo: "5",
      requestTo: "5",
      idleTo: "60",
      reaper: "10",
      rspDelay: "0",
      pdv1: false,
      sndpdulen: "16",
      rcvpdulen: "16",
      async: "0",
      bigEndian: false,
      bufSize: "1",
      defts: false,
      dest: "",
      nativeData: false,
      sorcvbuf: "0",
      sosndbuf: "0",
      tcpDelay: true,
      keyPW: "",
      keyStore: "",
      keyStorePW: "",
      noClientAuth: true,
      nossl2: true,
      tls: "notls",
      trustStore: "",
      trustStorePW: ""
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { key: "listenerConnectorProperties.host", label: "Listener Address", type: "text", width: "200px" },
      { key: "listenerConnectorProperties.port", label: "Listener Port", type: "number", width: "90px", append: () => portsInUseButton() },
      { key: "applicationEntity", label: "Application Entity", type: "text", width: "220px" },
      { key: "localHost", label: "Local Host", type: "text", width: "200px" },
      { key: "localPort", label: "Local Port", type: "number", width: "90px" },
      { key: "localApplicationEntity", label: "Local Application Entity", type: "text", width: "220px" },
      { section: "Storage Settings" },
      { key: "dest", label: "Store Received Files To", type: "text", width: "320px", tooltip: "Leave blank to not store received DICOM files" },
      { key: "nativeData", label: "Native Data with Attachments", type: "radio", options: YES_NO },
      { key: "bigEndian", label: "Accept Big Endian Transfer Syntax", type: "radio", options: YES_NO },
      { key: "defts", label: "Only Accept Default Transfer Syntax", type: "radio", options: YES_NO },
      ...tlsFields(),
      { section: "Timeout Settings" },
      { key: "soCloseDelay", label: "Socket Close Delay (ms)", type: "number", width: "110px" },
      { key: "releaseTo", label: "A-RELEASE Timeout (s)", type: "number", width: "110px" },
      { key: "requestTo", label: "A-ASSOCIATE-RQ Timeout (s)", type: "number", width: "110px" },
      { key: "idleTo", label: "DIMSE-RSP Idle Timeout (s)", type: "number", width: "110px" },
      { key: "reaper", label: "Association Reaper Period (s)", type: "number", width: "110px" },
      { key: "rspDelay", label: "DIMSE-RSP Delay (ms)", type: "number", width: "110px" },
      { section: "Advanced Settings" },
      { key: "async", label: "Max Async Operations", type: "number", width: "110px" },
      { key: "pdv1", label: "Pack PDV", type: "radio", options: YES_NO },
      { key: "sndpdulen", label: "P-DATA-TF PDUs Max Length Sent (KB)", type: "number", width: "110px" },
      { key: "rcvpdulen", label: "P-DATA-TF PDUs Max Length Received (KB)", type: "number", width: "110px" },
      { key: "bufSize", label: "Transcoder Buffer Size (KB)", type: "number", width: "110px" },
      { key: "sorcvbuf", label: "Receive Socket Buffer Size (KB)", type: "number", width: "110px" },
      { key: "sosndbuf", label: "Send Socket Buffer Size (KB)", type: "number", width: "110px" },
      { key: "tcpDelay", label: "TCP Delay", type: "radio", options: YES_NO }
    ] });
  }
};
const dicomSender = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.dimse.DICOMDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      host: "127.0.0.1",
      port: "104",
      applicationEntity: "",
      localHost: "",
      localPort: "",
      localApplicationEntity: "",
      template: "${DICOMMESSAGE}",
      acceptTo: "5000",
      async: "0",
      bufSize: "1",
      connectTo: "0",
      priority: "med",
      passcode: "",
      pdv1: false,
      rcvpdulen: "16",
      reaper: "10",
      releaseTo: "5",
      rspTo: "60",
      shutdownDelay: "1000",
      sndpdulen: "16",
      soCloseDelay: "50",
      sorcvbuf: "0",
      sosndbuf: "0",
      stgcmt: false,
      tcpDelay: true,
      ts1: false,
      uidnegrsp: false,
      username: "",
      keyPW: "",
      keyStore: "",
      keyStorePW: "",
      noClientAuth: true,
      nossl2: true,
      tls: "notls",
      trustStore: "",
      trustStorePW: ""
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { key: "host", label: "Remote Host", type: "text", width: "200px" },
      { key: "port", label: "Remote Port", type: "number", width: "90px" },
      { key: "applicationEntity", label: "Remote Application Entity", type: "text", width: "220px" },
      { key: "localHost", label: "Local Host", type: "text", width: "200px" },
      { key: "localPort", label: "Local Port", type: "number", width: "90px" },
      { key: "localApplicationEntity", label: "Local Application Entity", type: "text", width: "220px" },
      { key: "username", label: "Username", type: "text", width: "220px" },
      { key: "passcode", label: "Pass Code", type: "password", width: "220px" },
      { key: "priority", label: "Priority", type: "radio", options: [
        { value: "high", label: "High" },
        { value: "med", label: "Medium" },
        { value: "low", label: "Low" }
      ] },
      ...tlsFields(),
      { section: "Timeout Settings" },
      { key: "connectTo", label: "TCP Connection Timeout (ms)", type: "number", width: "110px" },
      { key: "acceptTo", label: "A-ASSOCIATE-AC Timeout (ms)", type: "number", width: "110px" },
      { key: "releaseTo", label: "A-RELEASE-RP Timeout (s)", type: "number", width: "110px" },
      { key: "rspTo", label: "DIMSE-RSP Timeout (s)", type: "number", width: "110px" },
      { key: "reaper", label: "Association Reaper Period (s)", type: "number", width: "110px" },
      { key: "soCloseDelay", label: "Socket Close Delay (ms)", type: "number", width: "110px" },
      { key: "shutdownDelay", label: "Shutdown Delay (ms)", type: "number", width: "110px" },
      { section: "Advanced Settings" },
      { key: "async", label: "Max Async Operations", type: "number", width: "110px" },
      { key: "pdv1", label: "Pack PDV", type: "radio", options: YES_NO },
      { key: "sndpdulen", label: "P-DATA-TF PDUs Max Length Sent (KB)", type: "number", width: "110px" },
      { key: "rcvpdulen", label: "P-DATA-TF PDUs Max Length Received (KB)", type: "number", width: "110px" },
      { key: "bufSize", label: "Transcoder Buffer Size (KB)", type: "number", width: "110px" },
      { key: "sorcvbuf", label: "Receive Socket Buffer Size (KB)", type: "number", width: "110px" },
      { key: "sosndbuf", label: "Send Socket Buffer Size (KB)", type: "number", width: "110px" },
      { key: "tcpDelay", label: "TCP Delay", type: "radio", options: YES_NO },
      { key: "stgcmt", label: "Request Storage Commitment", type: "radio", options: YES_NO },
      { key: "ts1", label: "Default Presentation Syntax Only", type: "radio", options: YES_NO },
      { key: "uidnegrsp", label: "Request Positive User Identity Response", type: "radio", options: YES_NO },
      { section: "Template" },
      { key: "template", label: "Template", type: "code", minHeight: "120px" }
    ] });
  }
};
function register(platform) {
  platform.registerConnectorPanel("DICOM Listener", "SOURCE", dicomListener);
  platform.registerConnectorPanel("DICOM Sender", "DESTINATION", dicomSender);
}
export {
  register
};
