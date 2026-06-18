import { React } from "./react-platform.js";
import { h, clear, select } from "@oie/web-ui";
import { ConnectorForm, mapEntries, defaultSourceProperties, defaultDestinationProperties } from "./react-forms.js";
const channelReader = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.vm.VmReceiverProperties",
      "@version": version,
      pluginProperties: null,
      sourceConnectorProperties: defaultSourceProperties(version)
    };
  },
  component() {
    return /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section-title" }, "Channel Reader Settings"), /* @__PURE__ */ React.createElement("div", { className: "hint", style: { padding: "2px 0" } }, "Channel Reader listens for messages routed from other channels on this server. It has no connector-specific settings."));
  }
};
let channelNamesPromise = null;
function loadChannelNames(platform) {
  if (!channelNamesPromise) channelNamesPromise = platform.api.channels.idsAndNames();
  return channelNamesPromise;
}
function channelSelectNode(properties, platform, onChange) {
  const channelSelect = select([{ value: "none", label: "<None>" }], properties.channelId ?? "none", {
    onChange: (e) => {
      properties.channelId = e.target.value;
      onChange();
    }
  });
  loadChannelNames(platform).then((map) => {
    const current = String(properties.channelId ?? "none");
    const options = [["none", "<None>"], ...mapEntries(map)];
    clear(channelSelect);
    for (const [value, label] of options) {
      channelSelect.appendChild(h("option", { value, selected: value === current }, label));
    }
  }).catch(() => {
  });
  return channelSelect;
}
const channelWriter = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.vm.VmDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      channelId: "none",
      channelTemplate: "${message.encodedData}",
      mapVariables: null
    };
  },
  component({ properties, platform, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Channel Writer Settings" },
      {
        type: "custom",
        label: "Channel Id",
        width: "320px",
        tooltip: "Channel to write messages to",
        render: () => channelSelectNode(properties, platform, onChange)
      },
      { key: "channelTemplate", label: "Template", type: "code", minHeight: "340px" }
    ] });
  }
};
function register(platform) {
  platform.registerConnectorPanel("Channel Reader", "SOURCE", channelReader);
  platform.registerConnectorPanel("Channel Writer", "DESTINATION", channelWriter);
}
export {
  register
};
