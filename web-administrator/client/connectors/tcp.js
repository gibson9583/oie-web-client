import { React } from "./react-platform.js";
import {
  ConnectorForm,
  TransmissionModePanel,
  connectorTestButton,
  portsInUseButton,
  asBool,
  YES_NO,
  defaultSourceProperties,
  defaultDestinationProperties,
  defaultListenerProperties,
  CHARSETS
} from "./react-forms.js";
function defaultFrameMode() {
  return {
    "@class": "com.mirth.connect.model.transmission.framemode.FrameModeProperties",
    pluginPointName: "MLLP",
    startOfMessageBytes: "0B",
    endOfMessageBytes: "1C0D"
  };
}
const tcpListener = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.tcp.TcpReceiverProperties",
      "@version": version,
      pluginProperties: null,
      listenerConnectorProperties: defaultListenerProperties(version, "6661"),
      sourceConnectorProperties: defaultSourceProperties(version, {
        responseVariable: "Auto-generate (After source transformer)",
        firstResponse: true
      }),
      transmissionModeProperties: defaultFrameMode(),
      serverMode: true,
      remoteAddress: "",
      remotePort: "",
      overrideLocalBinding: false,
      reconnectInterval: "5000",
      receiveTimeout: "0",
      bufferSize: "65536",
      maxConnections: "10",
      keepConnectionOpen: true,
      dataTypeBinary: false,
      charsetEncoding: "DEFAULT_ENCODING",
      respondOnNewConnection: 0,
      responseAddress: "",
      responsePort: "",
      responseConnectorPluginProperties: null
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(TransmissionModePanel, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Listener Settings" },
      // Mode: Server binds and listens locally; Client connects out to a
      // remote address (with optional local-binding override).
      { key: "serverMode", label: "Mode", type: "radio", refresh: true, options: [
        { value: true, label: "Server" },
        { value: false, label: "Client" }
      ] },
      { key: "remoteAddress", label: "Remote Address", type: "text", width: "200px", visible: (p) => p.serverMode === false },
      { key: "remotePort", label: "Remote Port", type: "number", width: "90px", visible: (p) => p.serverMode === false },
      { key: "overrideLocalBinding", label: "Override Local Binding", type: "radio", options: YES_NO, refresh: true, visible: (p) => p.serverMode === false },
      { key: "listenerConnectorProperties.host", label: "Local Address", type: "text", width: "200px", visible: (p) => p.serverMode !== false || asBool(p.overrideLocalBinding) },
      { key: "listenerConnectorProperties.port", label: "Local Port", type: "number", width: "90px", append: () => portsInUseButton(), visible: (p) => p.serverMode !== false || asBool(p.overrideLocalBinding) },
      { section: "TCP Listener Settings" },
      { key: "maxConnections", label: "Max Connections", type: "number", width: "110px" },
      { key: "receiveTimeout", label: "Receive Timeout (ms)", type: "number", width: "120px", tooltip: "0 = never time out" },
      { key: "bufferSize", label: "Buffer Size (bytes)", type: "number", width: "120px" },
      { key: "keepConnectionOpen", label: "Keep Connection Open", type: "radio", options: YES_NO },
      { key: "dataTypeBinary", label: "Data Type", type: "radio", options: [
        { value: true, label: "Binary" },
        { value: false, label: "Text" }
      ] },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px" },
      { section: "Response Settings" },
      {
        key: "respondOnNewConnection",
        label: "Respond on",
        type: "radio",
        refresh: true,
        options: [
          { value: 0, label: "Same Connection" },
          { value: 1, label: "New Connection" },
          { value: 2, label: "New Connection on Recovery" }
        ]
      },
      { key: "responseAddress", label: "Response Address", type: "text", width: "200px", visible: (p) => Number(p.respondOnNewConnection) > 0 },
      { key: "responsePort", label: "Response Port", type: "number", width: "90px", visible: (p) => Number(p.respondOnNewConnection) > 0 }
    ] }));
  }
};
const tcpSender = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.tcp.TcpDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version, { validateResponse: true }),
      transmissionModeProperties: defaultFrameMode(),
      serverMode: false,
      remoteAddress: "127.0.0.1",
      remotePort: "6660",
      overrideLocalBinding: false,
      localAddress: "0.0.0.0",
      localPort: "0",
      sendTimeout: "5000",
      bufferSize: "65536",
      maxConnections: "10",
      keepConnectionOpen: false,
      checkRemoteHost: false,
      responseTimeout: "5000",
      ignoreResponse: false,
      queueOnResponseTimeout: true,
      dataTypeBinary: false,
      charsetEncoding: "DEFAULT_ENCODING",
      template: "${message.encodedData}"
    };
  },
  component({ properties, channel, onChange }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(TransmissionModePanel, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      {
        key: "remoteAddress",
        label: "Remote Address",
        type: "text",
        width: "200px",
        append: () => connectorTestButton({ path: "/connectors/tcp/_testConnection", channel, properties })
      },
      { key: "remotePort", label: "Remote Port", type: "number", width: "90px" },
      { key: "overrideLocalBinding", label: "Override Local Binding", type: "radio", options: YES_NO, refresh: true },
      { key: "localAddress", label: "Local Address", type: "text", width: "200px", visible: (p) => asBool(p.overrideLocalBinding) },
      { key: "localPort", label: "Local Port", type: "number", width: "90px", visible: (p) => asBool(p.overrideLocalBinding) },
      { section: "TCP Sender Settings" },
      { key: "sendTimeout", label: "Send Timeout (ms)", type: "number", width: "120px" },
      { key: "responseTimeout", label: "Response Timeout (ms)", type: "number", width: "120px" },
      { key: "queueOnResponseTimeout", label: "Queue on Response Timeout", type: "checkbox" },
      { key: "ignoreResponse", label: "Ignore Response", type: "radio", options: YES_NO },
      { key: "bufferSize", label: "Buffer Size (bytes)", type: "number", width: "120px" },
      { key: "maxConnections", label: "Max Connections", type: "number", width: "110px" },
      { key: "keepConnectionOpen", label: "Keep Connection Open", type: "radio", options: YES_NO },
      { key: "checkRemoteHost", label: "Check Remote Host", type: "radio", options: YES_NO },
      { key: "dataTypeBinary", label: "Data Type", type: "radio", options: [
        { value: true, label: "Binary" },
        { value: false, label: "Text" }
      ] },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px" },
      { section: "Template" },
      { key: "template", label: "Template", type: "code", minHeight: "140px" }
    ] }));
  }
};
function register(platform) {
  platform.registerConnectorPanel("TCP Listener", "SOURCE", tcpListener);
  platform.registerConnectorPanel("TCP Sender", "DESTINATION", tcpSender);
}
export {
  register
};
