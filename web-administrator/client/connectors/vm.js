import { React } from "./react-platform.js";
import { h, clear, select, textInput, icon } from "@oie/web-ui";
import { ConnectorForm, mapEntries, defaultSourceProperties, defaultDestinationProperties } from "./react-forms.js";
function asArray(value) {
  if (value === null || value === void 0 || value === "") return [];
  return Array.isArray(value) ? value : [value];
}
function stringList(list) {
  if (!list || typeof list !== "object") return [];
  return asArray(list.string).map((v) => String(v ?? ""));
}
function writeStringList(list, values) {
  const target = list && typeof list === "object" ? list : {};
  if (!target["@class"]) target["@class"] = "java.util.ArrayList";
  if (values.length) target.string = values;
  else delete target.string;
  return target;
}
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
const NONE_LABEL = "<None>";
const MAP_VARIABLE_LABEL = "<Map Variable>";
const NOT_FOUND_LABEL = "<Channel Not Found>";
function channelControlNode(properties, platform, onChange) {
  const wrap = h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } });
  let channelList = [];
  const field = textInput(properties.channelId === "none" ? "" : properties.channelId ?? "", {
    placeholder: "<None>",
    title: "The destination channel's unique global id.",
    style: { width: "250px" }
  });
  const combo = select([{ value: NONE_LABEL, label: NONE_LABEL }], NONE_LABEL, {
    title: "Select the channel to which messages accepted by this destination's filter should be written, or none to not write the message at all.",
    style: { width: "250px" }
  });
  function syncCombo() {
    const text = String(field.value ?? "");
    let selection;
    if (text.trim() === "") {
      selection = NONE_LABEL;
    } else {
      const match = channelList.find(([, id]) => id === text);
      if (match) selection = match[0];
      else if (text.includes("$")) selection = MAP_VARIABLE_LABEL;
      else selection = NOT_FOUND_LABEL;
    }
    combo.value = selection;
  }
  field.addEventListener("input", () => {
    const text = field.value;
    properties.channelId = text.trim() === "" ? "none" : text;
    syncCombo();
    onChange();
  });
  combo.addEventListener("change", () => {
    const name = combo.value;
    let id = null;
    if (name === NONE_LABEL) id = "";
    else {
      const match = channelList.find(([n]) => n === name);
      if (match) id = match[1];
    }
    if (id !== null) {
      field.value = id;
      properties.channelId = id.trim() === "" ? "none" : id;
      onChange();
    }
    syncCombo();
  });
  wrap.appendChild(field);
  wrap.appendChild(combo);
  loadChannelNames(platform).then((map) => {
    channelList = mapEntries(map).map(([id, name]) => [name, id]).sort((a, b) => a[0].localeCompare(b[0]));
    clear(combo);
    combo.appendChild(h("option", { value: NONE_LABEL }, NONE_LABEL));
    for (const [name] of channelList) combo.appendChild(h("option", { value: name }, name));
    for (const label of [MAP_VARIABLE_LABEL, NOT_FOUND_LABEL]) {
      combo.appendChild(h("option", { value: label }, label));
    }
    syncCombo();
  }).catch(() => {
  });
  return wrap;
}
function mapVariablesTable(properties, onChange) {
  const wrap = h("div");
  const rows = stringList(properties.mapVariables);
  const commit = () => {
    properties.mapVariables = writeStringList(properties.mapVariables, rows.filter((v) => v !== ""));
    onChange();
  };
  function uniqueName() {
    for (let i = 1; i <= rows.length + 1; i++) {
      const name = "Variable " + i;
      if (!rows.some((v) => v.toLowerCase() === name.toLowerCase())) return name;
    }
    return "Variable " + (rows.length + 1);
  }
  function paint() {
    clear(wrap);
    const table = h("div", { style: { display: "flex", flexDirection: "column", gap: "4px" } });
    table.appendChild(h("div", { className: "cform-label", style: { fontWeight: "600", fontSize: "12px" } }, "Map Variable"));
    rows.forEach((value, i) => {
      const input = textInput(value, {
        placeholder: "Map Variable",
        style: { flex: "1" },
        onInput: (e) => {
          rows[i] = e.target.value;
          commit();
        }
      });
      const delBtn = h("button.icon-btn", {
        type: "button",
        title: "Delete",
        onClick: () => {
          rows.splice(i, 1);
          commit();
          paint();
        }
      }, icon("x"));
      table.appendChild(h("div", { style: { display: "flex", gap: "6px", marginBottom: "4px", alignItems: "center" } }, input, delBtn));
    });
    const newBtn = h("button.btn", {
      type: "button",
      onClick: () => {
        rows.push(uniqueName());
        commit();
        paint();
      }
    }, "New");
    wrap.appendChild(table);
    wrap.appendChild(h("div", { style: { marginTop: "6px" } }, newBtn));
  }
  paint();
  return wrap;
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
      mapVariables: { "@class": "java.util.ArrayList" }
    };
  },
  component({ properties, platform, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Channel Writer Settings" },
      {
        type: "custom",
        label: "Channel Id",
        span: true,
        tooltip: "The destination channel's unique global id. Type a raw channel id or a ${mapVariable}, or pick a channel from the dropdown to fill it.",
        render: () => channelControlNode(properties, platform, onChange)
      },
      {
        type: "custom",
        label: "Message Metadata",
        span: true,
        tooltip: 'The following map variables will be included in the source map of the destination channel\'s message. Only use the map key itself, without the "${}" syntax.',
        render: () => mapVariablesTable(properties, onChange)
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
