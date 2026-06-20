import { React } from "./react-platform.js";
import {
  ConnectorForm,
  PollSection,
  defaultSourceProperties,
  defaultDestinationProperties,
  defaultPollProperties
} from "./react-forms.js";
const javascriptReader = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.js.JavaScriptReceiverProperties",
      "@version": version,
      pluginProperties: null,
      pollConnectorProperties: defaultPollProperties(version),
      sourceConnectorProperties: defaultSourceProperties(version),
      script: ""
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(PollSection, { properties, onChange }), /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "JavaScript Reader Settings" },
      {
        key: "script",
        label: "JavaScript",
        type: "code",
        language: "javascript",
        minHeight: "260px",
        placeholder: "// Return one or more messages to be processed"
      }
    ] }));
  }
};
const javascriptWriter = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.js.JavaScriptDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      script: ""
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "JavaScript Writer Settings" },
      {
        key: "script",
        label: "JavaScript",
        type: "code",
        language: "javascript",
        minHeight: "300px",
        placeholder: "// Write your script here. Return a Response or a status to set the message status."
      }
    ] });
  }
};
function register(platform) {
  platform.registerConnectorPanel("JavaScript Reader", "SOURCE", javascriptReader);
  platform.registerConnectorPanel("JavaScript Writer", "DESTINATION", javascriptWriter);
}
export {
  register
};
