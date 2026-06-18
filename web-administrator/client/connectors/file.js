import { React } from "./react-platform.js";
import { h } from "@oie/web-ui";
import {
  ConnectorForm,
  PollSection,
  ConnectorTestButton as TestButton,
  asBool,
  YES_NO,
  defaultSourceProperties,
  defaultDestinationProperties,
  defaultPollProperties,
  CHARSETS
} from "./react-forms.js";
const SCHEMES = [
  { value: "FILE", label: "File" },
  { value: "FTP", label: "FTP" },
  { value: "SFTP", label: "SFTP" },
  { value: "S3", label: "Amazon S3" },
  { value: "SMB", label: "SMB" },
  { value: "WEBDAV", label: "WebDAV" }
];
const notLocalFile = (p) => p.scheme !== "FILE";
const SCHEME_PROPERTY_CLASSES = {
  FTP: "com.mirth.connect.connectors.file.FTPSchemeProperties",
  SFTP: "com.mirth.connect.connectors.file.SftpSchemeProperties",
  S3: "com.mirth.connect.connectors.file.S3SchemeProperties",
  SMB: "com.mirth.connect.connectors.file.SmbSchemeProperties"
};
const SMB_VERSIONS = [
  { value: "SMB1", label: "SMB v1" },
  { value: "SMB202", label: "SMB v2.0.2" },
  { value: "SMB210", label: "SMB v2.1" },
  { value: "SMB300", label: "SMB v3.0" },
  { value: "SMB302", label: "SMB v3.0.2" },
  { value: "SMB311", label: "SMB v3.1.1" }
];
function defaultSchemeProperties(scheme) {
  switch (scheme) {
    case "FTP":
      return {
        "@class": SCHEME_PROPERTY_CLASSES.FTP,
        initialCommands: null
      };
    case "SFTP":
      return {
        "@class": SCHEME_PROPERTY_CLASSES.SFTP,
        passwordAuth: true,
        keyAuth: false,
        keyFile: "",
        passPhrase: "",
        hostKeyChecking: "ask",
        knownHostsFile: "",
        configurationSettings: { "@class": "linked-hash-map" }
      };
    case "S3":
      return {
        "@class": SCHEME_PROPERTY_CLASSES.S3,
        useDefaultCredentialProviderChain: true,
        useTemporaryCredentials: false,
        duration: 7200,
        region: "us-east-1",
        customHeaders: { "@class": "linked-hash-map" }
      };
    case "SMB":
      return {
        "@class": SCHEME_PROPERTY_CLASSES.SMB,
        smbMinVersion: "SMB202",
        smbMaxVersion: "SMB311"
      };
    default:
      return null;
  }
}
function ensureSchemeProperties(properties) {
  const cls = SCHEME_PROPERTY_CLASSES[properties.scheme];
  if (!cls) return;
  const sp = properties.schemeProperties;
  if (!sp || typeof sp !== "object" || sp["@class"] !== cls) {
    properties.schemeProperties = defaultSchemeProperties(properties.scheme);
  }
}
function onSchemeChange(properties) {
  if (SCHEME_PROPERTY_CLASSES[properties.scheme]) {
    ensureSchemeProperties(properties);
  } else {
    properties.schemeProperties = null;
  }
}
function ftpInitialCommandsField() {
  return {
    label: "Initial Commands",
    type: "custom",
    span: true,
    visible: (p) => p.scheme === "FTP",
    render: (p, { onChange }) => {
      const sp = p.schemeProperties || {};
      let lines = sp.initialCommands && typeof sp.initialCommands === "object" ? sp.initialCommands.string : null;
      if (lines === null || lines === void 0 || lines === "") lines = [];
      if (!Array.isArray(lines)) lines = [lines];
      const area = h("textarea", {
        rows: 3,
        placeholder: "One FTP command per line, sent after connecting",
        onInput: (e) => {
          const values = e.target.value.split("\n").map((s) => s.trim()).filter((s) => s !== "");
          sp.initialCommands = values.length ? { string: values } : null;
          onChange();
        }
      }, lines.map(String).join("\n"));
      return area;
    }
  };
}
function schemeSettingsFields() {
  const sftp = (p) => p.scheme === "SFTP";
  const s3 = (p) => p.scheme === "S3";
  return [
    { section: "FTP Settings", visible: (p) => p.scheme === "FTP" },
    ftpInitialCommandsField(),
    { section: "SFTP Settings", visible: sftp },
    { key: "schemeProperties.passwordAuth", label: "Password Authentication", type: "radio", options: YES_NO, visible: sftp },
    { key: "schemeProperties.keyAuth", label: "Public Key Authentication", type: "radio", options: YES_NO, refresh: true, visible: sftp },
    { key: "schemeProperties.keyFile", label: "Public Key File", type: "text", width: "320px", visible: (p) => sftp(p) && asBool(p.schemeProperties && p.schemeProperties.keyAuth) },
    { key: "schemeProperties.passPhrase", label: "Passphrase", type: "password", width: "220px", visible: (p) => sftp(p) && asBool(p.schemeProperties && p.schemeProperties.keyAuth) },
    { key: "schemeProperties.hostKeyChecking", label: "Host Key Checking", type: "select", width: "120px", visible: sftp, options: [
      { value: "ask", label: "Ask" },
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" }
    ] },
    { key: "schemeProperties.knownHostsFile", label: "Known Hosts File", type: "text", width: "320px", visible: sftp },
    { key: "schemeProperties.configurationSettings", label: "Configuration Options", type: "keyvalue", visible: sftp },
    { section: "Amazon S3 Settings", visible: s3 },
    {
      key: "schemeProperties.useDefaultCredentialProviderChain",
      label: "Use Default Credential Provider Chain",
      type: "radio",
      options: YES_NO,
      refresh: true,
      visible: s3,
      tooltip: "When No, the Username/Password above are used as the AWS access key ID / secret access key"
    },
    { key: "schemeProperties.useTemporaryCredentials", label: "Use Temporary Credentials", type: "radio", options: YES_NO, refresh: true, visible: s3 },
    { key: "schemeProperties.duration", label: "Duration (s)", type: "number", numeric: true, width: "110px", visible: (p) => s3(p) && asBool(p.schemeProperties && p.schemeProperties.useTemporaryCredentials) },
    { key: "schemeProperties.region", label: "Region", type: "text", width: "160px", visible: s3, placeholder: "us-east-1" },
    { key: "schemeProperties.customHeaders", label: "Custom HTTP Headers", type: "keyvalue", mapShape: "list", visible: s3 },
    { section: "SMB Settings", visible: (p) => p.scheme === "SMB" },
    { key: "schemeProperties.smbMinVersion", label: "SMB Minimum Version", type: "select", options: SMB_VERSIONS, width: "140px", visible: (p) => p.scheme === "SMB" },
    { key: "schemeProperties.smbMaxVersion", label: "SMB Maximum Version", type: "select", options: SMB_VERSIONS, width: "140px", visible: (p) => p.scheme === "SMB" }
  ];
}
const fileReader = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.file.FileReceiverProperties",
      "@version": version,
      pluginProperties: null,
      pollConnectorProperties: defaultPollProperties(version),
      sourceConnectorProperties: defaultSourceProperties(version),
      scheme: "FILE",
      schemeProperties: null,
      host: "",
      fileFilter: "*",
      regex: false,
      directoryRecursion: false,
      ignoreDot: true,
      anonymous: true,
      username: "anonymous",
      password: "anonymous",
      timeout: "10000",
      secure: true,
      passive: true,
      validateConnection: true,
      afterProcessingAction: "NONE",
      moveToDirectory: "",
      moveToFileName: "",
      errorReadingAction: "NONE",
      errorResponseAction: "AFTER_PROCESSING",
      errorMoveToDirectory: "",
      errorMoveToFileName: "",
      checkFileAge: true,
      fileAge: "1000",
      fileSizeMinimum: "0",
      fileSizeMaximum: "",
      ignoreFileSizeMaximum: true,
      sortBy: "date",
      binary: false,
      charsetEncoding: "DEFAULT_ENCODING"
    };
  },
  component({ properties, channel, onChange }) {
    ensureSchemeProperties(properties);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { key: "scheme", label: "Method", type: "select", options: SCHEMES, refresh: true, width: "160px", onSet: onSchemeChange },
      { key: "host", label: "Directory", type: "text", width: "420px", placeholder: properties.scheme === "FILE" ? "/path/to/directory" : "host/path" },
      { key: "username", label: "Username", type: "text", width: "220px", visible: notLocalFile },
      { key: "password", label: "Password", type: "password", width: "220px", visible: notLocalFile },
      { key: "fileFilter", label: "Filename Filter Pattern", type: "text", width: "220px" },
      { key: "regex", label: "Filter is Regular Expression", type: "radio", options: YES_NO },
      { key: "directoryRecursion", label: "Include All Subdirectories", type: "radio", options: YES_NO },
      { key: "ignoreDot", label: "Ignore Files Beginning with .", type: "radio", options: YES_NO },
      ...schemeSettingsFields(),
      { section: "File Reader Settings" },
      { key: "binary", label: "File Type", type: "radio", options: [
        { value: true, label: "Binary" },
        { value: false, label: "Text" }
      ] },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px" },
      { key: "checkFileAge", label: "Check File Age", type: "radio", options: YES_NO, refresh: true },
      { key: "fileAge", label: "File Age (ms)", type: "number", width: "120px", visible: (p) => asBool(p.checkFileAge) },
      { key: "fileSizeMinimum", label: "File Size Minimum (bytes)", type: "number", width: "120px" },
      { key: "ignoreFileSizeMaximum", label: "Ignore File Size Maximum", type: "radio", options: YES_NO, refresh: true },
      { key: "fileSizeMaximum", label: "File Size Maximum (bytes)", type: "number", width: "120px", visible: (p) => !asBool(p.ignoreFileSizeMaximum) },
      { key: "sortBy", label: "Sort Files By", type: "radio", options: [
        { value: "date", label: "Date" },
        { value: "name", label: "Name" },
        { value: "size", label: "Size" }
      ] },
      { section: "After Processing" },
      { key: "afterProcessingAction", label: "After Processing Action", type: "radio", refresh: true, options: [
        { value: "NONE", label: "None" },
        { value: "MOVE", label: "Move" },
        { value: "DELETE", label: "Delete" }
      ] },
      { key: "moveToDirectory", label: "Move-to Directory", type: "text", visible: (p) => p.afterProcessingAction === "MOVE" },
      { key: "moveToFileName", label: "Move-to File Name", type: "text", width: "220px", visible: (p) => p.afterProcessingAction === "MOVE" },
      { key: "errorReadingAction", label: "Error Reading Action", type: "radio", refresh: true, options: [
        { value: "NONE", label: "None" },
        { value: "MOVE", label: "Move" },
        { value: "DELETE", label: "Delete" }
      ] },
      { key: "errorResponseAction", label: "Error in Response Action", type: "radio", refresh: true, options: [
        { value: "AFTER_PROCESSING", label: "After Processing Action" },
        { value: "MOVE", label: "Move" },
        { value: "DELETE", label: "Delete" }
      ] },
      {
        key: "errorMoveToDirectory",
        label: "Error Move-to Directory",
        type: "text",
        visible: (p) => p.errorReadingAction === "MOVE" || p.errorResponseAction === "MOVE"
      }
    ] }), /* @__PURE__ */ React.createElement(PollSection, { properties, onChange }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "10px" } }, /* @__PURE__ */ React.createElement(TestButton, { label: "Test Read", icon: "folder", path: "/connectors/file/_testRead", channel, properties })));
  }
};
const fileWriter = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.file.FileDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      scheme: "FILE",
      schemeProperties: null,
      host: "",
      outputPattern: "",
      anonymous: true,
      username: "anonymous",
      password: "anonymous",
      timeout: "10000",
      keepConnectionOpen: true,
      maxIdleTime: "0",
      secure: true,
      passive: true,
      validateConnection: true,
      outputAppend: true,
      errorOnExists: false,
      temporary: false,
      binary: false,
      charsetEncoding: "DEFAULT_ENCODING",
      template: ""
    };
  },
  component({ properties, channel, onChange }) {
    ensureSchemeProperties(properties);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { key: "scheme", label: "Method", type: "select", options: SCHEMES, refresh: true, width: "160px", onSet: onSchemeChange },
      { key: "host", label: "Directory", type: "text", width: "420px", placeholder: properties.scheme === "FILE" ? "/path/to/directory" : "host/path" },
      { key: "outputPattern", label: "File Name", type: "text", width: "220px", placeholder: "${message.messageId}.txt" },
      { key: "username", label: "Username", type: "text", width: "220px", visible: notLocalFile },
      { key: "password", label: "Password", type: "password", width: "220px", visible: notLocalFile },
      ...schemeSettingsFields(),
      { section: "File Writer Settings" },
      { key: "outputAppend", label: "File Exists", type: "radio", options: [
        { value: true, label: "Append" },
        { value: false, label: "Overwrite" }
      ] },
      { key: "errorOnExists", label: "Error if File Exists", type: "radio", options: YES_NO },
      { key: "temporary", label: "Write to Temporary File First", type: "radio", options: YES_NO },
      { key: "binary", label: "File Type", type: "radio", options: [
        { value: true, label: "Binary" },
        { value: false, label: "Text" }
      ] },
      { key: "charsetEncoding", label: "Encoding", type: "select", options: CHARSETS, width: "160px" },
      { section: "Template" },
      { key: "template", label: "Template", type: "code", minHeight: "140px", placeholder: "${message.encodedData}" }
    ] }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "10px" } }, /* @__PURE__ */ React.createElement(TestButton, { label: "Test Write", icon: "folder", path: "/connectors/file/_testWrite", channel, properties })));
  }
};
function register(platform) {
  platform.registerConnectorPanel("File Reader", "SOURCE", fileReader);
  platform.registerConnectorPanel("File Writer", "DESTINATION", fileWriter);
}
export {
  register
};
