import { React } from "./react-platform.js";
import { ConnectorForm, ConnectorTestButton, asBool, YES_NO, defaultDestinationProperties, CHARSETS } from "./react-forms.js";
const usingAuth = (p) => asBool(p.authentication);
const smtpSender = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.smtp.SmtpDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      smtpHost: "",
      smtpPort: "25",
      overrideLocalBinding: false,
      localAddress: "0.0.0.0",
      localPort: "0",
      timeout: "5000",
      encryption: "none",
      authentication: false,
      username: "",
      password: "",
      to: "",
      from: "",
      cc: "",
      bcc: "",
      replyTo: "",
      headers: { "@class": "linked-hash-map" },
      headersVariable: "",
      isUseHeadersVariable: false,
      subject: "",
      charsetEncoding: "DEFAULT_ENCODING",
      html: false,
      body: "",
      attachments: { "@class": "java.util.ArrayList" },
      attachmentsVariable: "",
      isUseAttachmentsVariable: false
    };
  },
  component({ properties, channel, onChange }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Connection Settings" },
      { key: "smtpHost", label: "SMTP Host", type: "text", width: "220px" },
      { key: "smtpPort", label: "SMTP Port", type: "number", width: "90px" },
      { key: "timeout", label: "Send Timeout (ms)", type: "number", width: "120px" },
      { key: "encryption", label: "Encryption", type: "radio", options: [
        { value: "none", label: "None" },
        { value: "TLS", label: "STARTTLS" },
        { value: "SSL", label: "SSL" }
      ] },
      { key: "authentication", label: "Use Authentication", type: "radio", options: YES_NO, refresh: true },
      { key: "username", label: "Username", type: "text", width: "220px", visible: usingAuth },
      { key: "password", label: "Password", type: "password", width: "220px", visible: usingAuth },
      { section: "Email Settings" },
      { key: "from", label: "From", type: "text", width: "220px" },
      { key: "to", label: "To", type: "text", tooltip: "Comma-separated addresses" },
      { key: "cc", label: "Cc", type: "text" },
      { key: "bcc", label: "Bcc", type: "text" },
      { key: "replyTo", label: "Reply-To", type: "text", width: "220px" },
      { key: "subject", label: "Subject", type: "text" },
      { key: "charsetEncoding", label: "Charset Encoding", type: "select", options: CHARSETS, width: "160px" },
      { key: "html", label: "HTML Body", type: "radio", options: YES_NO },
      { key: "headers", label: "Headers", type: "keyvalue", mapShape: "string" },
      { key: "body", label: "Body", type: "code", minHeight: "180px" }
    ] }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "10px" } }, /* @__PURE__ */ React.createElement(ConnectorTestButton, { label: "Send Test Email", icon: "mail", path: "/connectors/smtp/_sendTestEmail", channel, properties })));
  }
};
function register(platform) {
  platform.registerConnectorPanel("SMTP Sender", "DESTINATION", smtpSender);
}
export {
  register
};
