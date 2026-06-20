import { React } from "./react-platform.js";
import { checkbox } from "@oie/web-ui";
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
    const serverMode = (p) => p.serverMode !== false;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(TransmissionModePanel, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Listener Settings" },
      { key: "serverMode", label: "Mode", type: "radio", refresh: true, options: [
        { value: true, label: "Server" },
        { value: false, label: "Client" }
      ] },
      { key: "remoteAddress", label: "Remote Address", type: "text", width: "200px", disabled: serverMode },
      { key: "remotePort", label: "Remote Port", type: "number", width: "90px", disabled: serverMode },
      { key: "overrideLocalBinding", label: "Override Local Binding", type: "radio", options: YES_NO, disabled: serverMode },
      { key: "reconnectInterval", label: "Reconnect Interval (ms)", type: "number", width: "90px", disabled: serverMode },
      { key: "maxConnections", label: "Max Connections", type: "number", width: "90px", disabled: (p) => p.serverMode === false },
      { key: "receiveTimeout", label: "Receive Timeout (ms)", type: "number", width: "90px", tooltip: "0 = never time out" },
      { key: "bufferSize", label: "Buffer Size (bytes)", type: "number", width: "90px" },
      { key: "keepConnectionOpen", label: "Keep Connection Open", type: "radio", options: YES_NO },
      {
        key: "dataTypeBinary",
        label: "Data Type",
        type: "radio",
        refresh: true,
        // Binary disables Encoding and forces it back to the default (Swing setSelectedIndex(0)).
        onSet: (p) => {
          if (asBool(p.dataTypeBinary)) p.charsetEncoding = "DEFAULT_ENCODING";
        },
        options: [
          { value: true, label: "Binary" },
          { value: false, label: "Text" }
        ]
      },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px", disabled: (p) => asBool(p.dataTypeBinary) },
      {
        key: "respondOnNewConnection",
        label: "Respond on New Connection",
        type: "radio",
        refresh: true,
        options: [
          { value: 1, label: "Yes" },
          { value: 0, label: "No" },
          { value: 2, label: "Message Recovery" }
        ]
      },
      { key: "responseAddress", label: "Response Address", type: "text", width: "200px", disabled: (p) => Number(p.respondOnNewConnection) === 0 },
      { key: "responsePort", label: "Response Port", type: "number", width: "90px", disabled: (p) => Number(p.respondOnNewConnection) === 0 }
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
    const serverMode = (p) => p.serverMode === true;
    const localBindingDisabled = (p) => p.serverMode !== true && !asBool(p.overrideLocalBinding);
    const sendDisabled = (p) => p.serverMode === true || !asBool(p.keepConnectionOpen);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(TransmissionModePanel, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      // Swing initLayout adds modeClientRadio then modeServerRadio
      // (TcpSender.java:654-655), so on-screen order is Client, Server.
      { key: "serverMode", label: "Mode", type: "radio", refresh: true, options: [
        { value: false, label: "Client" },
        { value: true, label: "Server" }
      ] },
      {
        key: "remoteAddress",
        label: "Remote Address",
        type: "text",
        width: "200px",
        disabled: serverMode,
        append: () => connectorTestButton({ path: "/connectors/tcp/_testConnection", channel, properties })
      },
      { key: "remotePort", label: "Remote Port", type: "number", width: "90px", disabled: serverMode },
      { key: "overrideLocalBinding", label: "Override Local Binding", type: "radio", options: YES_NO, refresh: true, disabled: serverMode },
      { key: "localAddress", label: "Local Address", type: "text", width: "200px", disabled: localBindingDisabled },
      { key: "localPort", label: "Local Port", type: "number", width: "90px", append: () => portsInUseButton(), disabled: localBindingDisabled },
      { key: "maxConnections", label: "Max Connections", type: "number", width: "90px", disabled: (p) => p.serverMode !== true },
      { key: "keepConnectionOpen", label: "Keep Connection Open", type: "radio", options: YES_NO, refresh: true, disabled: serverMode },
      { key: "checkRemoteHost", label: "Check Remote Host", type: "radio", options: YES_NO, disabled: sendDisabled },
      { key: "sendTimeout", label: "Send Timeout (ms)", type: "number", width: "90px", disabled: sendDisabled },
      { key: "bufferSize", label: "Buffer Size (bytes)", type: "number", width: "90px" },
      {
        key: "responseTimeout",
        label: "Response Timeout (ms)",
        type: "number",
        width: "90px",
        // Swing pairs the Ignore Response checkbox inline with Response Timeout;
        // it gates Queue on Response Timeout below.
        append: (p, ctx) => checkbox("Ignore Response", asBool(p.ignoreResponse), {
          onChange: (e) => {
            p.ignoreResponse = e.target.checked;
            ctx.onChange();
          }
        }).el
      },
      { key: "queueOnResponseTimeout", label: "Queue on Response Timeout", type: "radio", options: YES_NO, disabled: (p) => asBool(p.ignoreResponse) },
      {
        key: "dataTypeBinary",
        label: "Data Type",
        type: "radio",
        refresh: true,
        // Binary disables Encoding and forces it back to the default (Swing setSelectedIndex(0)).
        onSet: (p) => {
          if (asBool(p.dataTypeBinary)) p.charsetEncoding = "DEFAULT_ENCODING";
        },
        options: [
          { value: true, label: "Binary" },
          { value: false, label: "Text" }
        ]
      },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px", disabled: (p) => asBool(p.dataTypeBinary) },
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
