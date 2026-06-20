import { React } from "./react-platform.js";
import { h, clear, textInput, select, icon, toast, taskButton, confirmDialog } from "@oie/web-ui";
import * as api from "../core/api.js";
import {
  ConnectorForm,
  portsInUseButton,
  listenerAddressField,
  postConnectorProperties,
  successToast,
  apiErrorMessage,
  YES_NO,
  defaultSourceProperties,
  defaultDestinationProperties,
  defaultListenerProperties
} from "./react-forms.js";
const WS_DEFAULT_CLASSNAME = "com.mirth.connect.connectors.ws.DefaultAcceptMessage";
const wsIsDefaultClassName = (p) => String(p.className ?? "") === WS_DEFAULT_CLASSNAME;
function wsdlUrlDisplay(p) {
  const listener = p.listenerConnectorProperties || {};
  const rawHost = String(listener.host ?? "").trim();
  const host = !rawHost || rawHost === "0.0.0.0" ? window.location.hostname : rawHost;
  return `http://${host}:${listener.port ?? ""}/services/${p.serviceName ?? ""}?wsdl`;
}
const wsListener = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.ws.WebServiceReceiverProperties",
      "@version": version,
      pluginProperties: null,
      listenerConnectorProperties: defaultListenerProperties(version, "8081"),
      sourceConnectorProperties: defaultSourceProperties(version),
      className: "com.mirth.connect.connectors.ws.DefaultAcceptMessage",
      serviceName: "OIE",
      soapBinding: "DEFAULT"
    };
  },
  component({ properties, onChange }) {
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Listener Settings" },
      listenerAddressField("listenerConnectorProperties.host", "Local Address"),
      { key: "listenerConnectorProperties.port", label: "Local Port", type: "number", width: "90px", refresh: true, append: () => portsInUseButton() },
      { section: "Web Service Listener Settings" },
      {
        // Swing "Web Service:" Default/Custom selector — no backing property in
        // either Swing or web; the selected state is derived from className.
        // Default service forces className to DefaultAcceptMessage (and disables
        // Service Class Name + shows the default Method); Custom service enables
        // the field. Because the selection is derived purely from className (no
        // phantom property), Custom must clear className off the default so the
        // radio sticks — Swing keeps the default text but tracks the radio in its
        // own ButtonGroup, which the web has no property to persist.
        type: "custom",
        label: "Web Service",
        refresh: true,
        render: (p, ctx) => {
          const name = `ws-classname-source-${++uidCounter}`;
          const isDefault = wsIsDefaultClassName(p);
          const mk = (label, checked, onSelect) => h(
            "label.check",
            h("input", { type: "radio", name, checked, onChange: onSelect }),
            label
          );
          return h(
            "div.radio-group.inline",
            mk("Default service", isDefault, () => {
              p.className = WS_DEFAULT_CLASSNAME;
              onChange();
              ctx.repaint();
            }),
            mk("Custom service", !isDefault, () => {
              if (wsIsDefaultClassName(p)) {
                p.className = "";
              }
              onChange();
              ctx.repaint();
            })
          );
        }
      },
      { key: "className", label: "Service Class Name", type: "text", width: "420px", refresh: true, disabled: wsIsDefaultClassName },
      { key: "serviceName", label: "Service Name", type: "text", width: "220px", refresh: true },
      { key: "soapBinding", label: "Binding", type: "radio", options: [
        { value: "DEFAULT", label: "Default" },
        { value: "SOAP11HTTP", label: "SOAP 1.1" },
        { value: "SOAP12HTTP", label: "SOAP 1.2" }
      ] },
      { type: "display", label: "WSDL URL", compute: wsdlUrlDisplay, width: "420px" },
      {
        type: "display",
        label: "Method",
        width: "320px",
        compute: (p) => wsIsDefaultClassName(p) ? "String acceptMessage(String message)" : "<Custom Web Service Methods>"
      }
    ] });
  }
};
const WS_DEFAULT_OPERATION = "Press Get Operations";
const isTrue = (v) => v === true || v === "true";
const usingAuth = (p) => isTrue(p.useAuthentication);
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
function entryValue(entry) {
  for (const key of Object.keys(entry)) {
    if (key !== "string" && !key.startsWith("@")) return entry[key];
  }
  return null;
}
function entryKey(entry) {
  return Array.isArray(entry.string) ? String(entry.string[0] ?? "") : String(entry.string ?? "");
}
function parseDefinitionMap(def) {
  const services = /* @__PURE__ */ new Map();
  if (!def || typeof def !== "object") return services;
  for (const entry of asArray(def.map && def.map.entry)) {
    if (!entry || typeof entry !== "object") continue;
    const portMapObj = entryValue(entry);
    const ports = /* @__PURE__ */ new Map();
    for (const portEntry of asArray(portMapObj && portMapObj.map && portMapObj.map.entry)) {
      if (!portEntry || typeof portEntry !== "object") continue;
      const info = entryValue(portEntry) || {};
      ports.set(entryKey(portEntry), {
        operations: stringList(info.operations),
        actions: stringList(info.actions),
        locationURI: typeof info.locationURI === "string" ? info.locationURI : ""
      });
    }
    services.set(entryKey(entry), ports);
  }
  return services;
}
function wsFormBody(properties, channel, extra) {
  const form = new URLSearchParams({
    channelId: channel ? channel.id : "",
    channelName: channel && channel.name !== void 0 ? channel.name : "",
    wsdlUrl: properties.wsdlUrl ?? "",
    username: properties.username ?? "",
    password: properties.password ?? ""
  });
  for (const [key, value] of Object.entries(extra || {})) form.set(key, value);
  return form.toString();
}
function wsTestConnectionButton(properties, channel, wsdlUrl) {
  const btn = taskButton("Test Connection", "link", async () => {
    const target = wsdlUrl ? properties.wsdlUrl : properties.locationURI;
    if (!String(target ?? "").trim()) {
      toast(wsdlUrl ? "WSDL URL is blank." : "Location URI is blank.", "warn");
      return;
    }
    const props = Object.assign({}, properties);
    if (wsdlUrl) props.locationURI = "";
    else props.wsdlUrl = "";
    btn.disabled = true;
    try {
      const result = await postConnectorProperties("/connectors/ws/_testConnection", props, channel);
      const type = result && typeof result === "object" ? String(result.type ?? "") : "";
      const message = result && typeof result === "object" && result.message || type || "No response received";
      if (type === "SUCCESS") successToast(message);
      else toast(message, "error");
    } catch (e) {
      toast(apiErrorMessage(e), "error");
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
let uidCounter = 0;
function comboInput(value, options, { placeholder, onInput, onCommit } = {}) {
  const id = `ws-list-${++uidCounter}`;
  return h(
    "div",
    h("input", { type: "text", value: value ?? "", list: id, placeholder, onInput, onChange: onCommit }),
    h("datalist", { id }, options.map((o) => h("option", { value: o })))
  );
}
function attachmentsTable(properties, onChange, disabled) {
  const wrap = h("div");
  const names = stringList(properties.attachmentNames);
  const contents = stringList(properties.attachmentContents);
  const types = stringList(properties.attachmentTypes);
  const rows = [];
  for (let i = 0; i < Math.max(names.length, contents.length, types.length); i++) {
    rows.push([names[i] ?? "", contents[i] ?? "", types[i] ?? ""]);
  }
  const commit = () => {
    const clean = rows.filter((r) => r[0] !== "" || r[1] !== "" || r[2] !== "");
    properties.attachmentNames = writeStringList(properties.attachmentNames, clean.map((r) => r[0]));
    properties.attachmentContents = writeStringList(properties.attachmentContents, clean.map((r) => r[1]));
    properties.attachmentTypes = writeStringList(properties.attachmentTypes, clean.map((r) => r[2]));
    onChange();
  };
  function paint() {
    clear(wrap);
    rows.forEach((row, i) => {
      wrap.appendChild(h(
        "div",
        { style: { display: "flex", gap: "6px", marginBottom: "6px" } },
        textInput(row[0], { placeholder: "ID", disabled, style: { flex: "1" }, onInput: (e) => {
          row[0] = e.target.value;
          commit();
        } }),
        textInput(row[1], { placeholder: "Content", disabled, style: { flex: "2" }, onInput: (e) => {
          row[1] = e.target.value;
          commit();
        } }),
        textInput(row[2], { placeholder: "MIME Type", disabled, style: { flex: "1" }, onInput: (e) => {
          row[2] = e.target.value;
          commit();
        } }),
        h("button.icon-btn", { type: "button", title: "Remove", disabled, onClick: () => {
          rows.splice(i, 1);
          commit();
          paint();
        } }, icon("x"))
      ));
    });
    wrap.appendChild(h("button.btn", { type: "button", disabled, onClick: () => {
      rows.push(["", "", ""]);
      paint();
    } }, "Add"));
  }
  paint();
  return wrap;
}
const wsSender = {
  defaults(version) {
    return {
      "@class": "com.mirth.connect.connectors.ws.WebServiceDispatcherProperties",
      "@version": version,
      pluginProperties: null,
      destinationConnectorProperties: defaultDestinationProperties(version),
      wsdlUrl: "",
      service: "",
      port: "",
      operation: WS_DEFAULT_OPERATION,
      locationURI: "",
      socketTimeout: "30000",
      useAuthentication: false,
      username: "",
      password: "",
      envelope: "",
      oneWay: false,
      headers: { "@class": "linked-hash-map" },
      headersVariable: "",
      isUseHeadersVariable: false,
      useMtom: false,
      attachmentNames: { "@class": "java.util.ArrayList" },
      attachmentContents: { "@class": "java.util.ArrayList" },
      attachmentTypes: { "@class": "java.util.ArrayList" },
      attachmentsVariable: "",
      isUseAttachmentsVariable: false,
      soapAction: "",
      wsdlDefinitionMap: { map: { "@class": "linked-hash-map" } }
    };
  },
  component({ properties, channel, onChange }) {
    const getServices = () => parseDefinitionMap(properties.wsdlDefinitionMap);
    const currentPortInfo = () => {
      const ports = getServices().get(String(properties.service ?? ""));
      return ports ? ports.get(String(properties.port ?? "")) : void 0;
    };
    async function getOperations(btn, repaint) {
      if (!String(properties.wsdlUrl ?? "").trim()) {
        toast("WSDL URL is blank", "warn");
        return;
      }
      const hasOps = [properties.service, properties.port, properties.locationURI].some((v) => String(v ?? "").trim()) || String(properties.operation ?? "") && properties.operation !== WS_DEFAULT_OPERATION;
      if (hasOps && !await confirmDialog(
        "Get Operations",
        "This will replace your current service, port, location URI, and operation list. Press OK to continue."
      )) return;
      btn.disabled = true;
      toast("Downloading and caching WSDL \u2014 this may take a moment\u2026");
      try {
        await postConnectorProperties("/connectors/ws/_cacheWsdlFromUrl", properties, channel);
        const definition = await api.post("/connectors/ws/_getDefinition", wsFormBody(properties, channel), {
          contentType: "application/x-www-form-urlencoded"
        });
        properties.wsdlDefinitionMap = definition && typeof definition === "object" ? definition : { map: { "@class": "linked-hash-map" } };
        const nextServices = parseDefinitionMap(properties.wsdlDefinitionMap);
        const firstService = nextServices.keys().next().value ?? "";
        properties.service = firstService;
        const ports = nextServices.get(firstService) || /* @__PURE__ */ new Map();
        const firstPort = ports.keys().next().value ?? "";
        properties.port = firstPort;
        const info = ports.get(firstPort);
        properties.locationURI = info && info.locationURI ? info.locationURI : "";
        const ops = info ? info.operations : [];
        properties.operation = ops.length ? ops[0] : WS_DEFAULT_OPERATION;
        properties.soapAction = ops.length && info.actions.length ? info.actions[0] ?? "" : "";
        onChange();
        repaint();
        successToast(`Retrieved ${ops.length} operation${ops.length === 1 ? "" : "s"}`);
      } catch (e) {
        toast("Error caching WSDL. Please check the WSDL URL and authentication settings.\n" + apiErrorMessage(e), "error");
      } finally {
        btn.disabled = false;
      }
    }
    async function generateEnvelope(btn, repaint) {
      const operation = String(properties.operation ?? "");
      if (!String(properties.wsdlUrl ?? "").trim()) {
        toast("WSDL URL is blank", "warn");
        return;
      }
      if (!operation || operation === WS_DEFAULT_OPERATION) {
        toast("Press Get Operations and select an operation first", "warn");
        return;
      }
      if ((String(properties.envelope ?? "").trim() || String(properties.soapAction ?? "").trim()) && !await confirmDialog(
        "Generate Envelope",
        "This will replace your current SOAP envelope and SOAP action. Press OK to continue."
      )) return;
      btn.disabled = true;
      try {
        const cached = await api.post("/connectors/ws/_isWsdlCached", wsFormBody(properties, channel), {
          contentType: "application/x-www-form-urlencoded"
        });
        if (!isTrue(cached)) {
          toast('The WSDL is no longer cached on the server. Press "Get Operations" to fetch the latest WSDL.', "warn");
          return;
        }
        const opParams = {
          service: properties.service ?? "",
          port: properties.port ?? "",
          operation
        };
        const envelope = await api.post(
          "/connectors/ws/_generateEnvelope",
          wsFormBody(properties, channel, Object.assign({ buildOptional: true }, opParams)),
          { contentType: "application/x-www-form-urlencoded", raw: true }
        );
        if (envelope !== null && envelope !== void 0) properties.envelope = envelope;
        try {
          const soapAction = await api.post(
            "/connectors/ws/_getSoapAction",
            wsFormBody(properties, channel, opParams),
            { contentType: "application/x-www-form-urlencoded", raw: true }
          );
          if (soapAction) properties.soapAction = soapAction;
        } catch (e) {
          toast("There was an error retrieving the SOAP action.\n" + apiErrorMessage(e), "warn");
        }
        onChange();
        repaint();
        successToast("SOAP envelope generated");
      } catch (e) {
        toast("There was an error generating the envelope.\n" + apiErrorMessage(e), "error");
      } finally {
        btn.disabled = false;
      }
    }
    return /* @__PURE__ */ React.createElement(ConnectorForm, { properties, onChange, fields: [
      { section: "Web Service Sender Settings" },
      {
        type: "custom",
        label: "WSDL URL",
        span: true,
        render: (p, ctx) => {
          const input = textInput(p.wsdlUrl ?? "", {
            style: { flex: "1" },
            onInput: (e) => {
              p.wsdlUrl = e.target.value;
              onChange();
            }
          });
          const getOpsBtn = taskButton("Get Operations", "refresh", () => getOperations(getOpsBtn, ctx.repaint));
          const testBtn = wsTestConnectionButton(p, channel, true);
          return h("div", { style: { display: "flex", gap: "6px" } }, input, getOpsBtn, testBtn);
        }
      },
      {
        type: "custom",
        label: "Service",
        width: "320px",
        render: (p, ctx) => comboInput(p.service, [...getServices().keys()], {
          onInput: (e) => {
            p.service = e.target.value;
            onChange();
          },
          onCommit: () => ctx.repaint()
        })
      },
      {
        type: "custom",
        label: "Port / Endpoint",
        width: "320px",
        render: (p, ctx) => {
          const ports = getServices().get(String(p.service ?? ""));
          return comboInput(p.port, ports ? [...ports.keys()] : [], {
            onInput: (e) => {
              p.port = e.target.value;
              onChange();
            },
            onCommit: () => {
              const info = currentPortInfo();
              if (info && info.locationURI) {
                p.locationURI = info.locationURI;
                onChange();
              }
              ctx.repaint();
            }
          });
        }
      },
      {
        // Swing initLayout: add(locationURIComboBox, "split 2"); add(locationURITestConnectionButton).
        // The second Test Connection button blanks wsdlUrl on a copy so only the
        // Location URI is tested (testConnectionButtonActionPerformed(false)).
        type: "custom",
        label: "Location URI",
        span: true,
        render: (p) => {
          const info = currentPortInfo();
          const combo = comboInput(p.locationURI, info && info.locationURI ? [info.locationURI] : [], {
            placeholder: "Optional override of the endpoint address",
            onInput: (e) => {
              p.locationURI = e.target.value;
              onChange();
            }
          });
          combo.style.flex = "1";
          const testBtn = wsTestConnectionButton(p, channel, false);
          return h("div", { style: { display: "flex", gap: "6px" } }, combo, testBtn);
        }
      },
      { key: "socketTimeout", label: "Socket Timeout (ms)", type: "number", width: "120px", tooltip: "0 = no timeout" },
      {
        key: "useAuthentication",
        label: "Authentication",
        type: "radio",
        options: YES_NO,
        refresh: true,
        onSet: (p, v) => {
          if (!v) {
            p.username = "";
            p.password = "";
          }
        }
      },
      { key: "username", label: "Username", type: "text", width: "220px", disabled: (p) => !usingAuth(p) },
      { key: "password", label: "Password", type: "password", width: "220px", disabled: (p) => !usingAuth(p) },
      // Swing initLayout order: invocationOneWayRadio then invocationTwoWayRadio
      // (One-Way, Two-Way left-to-right). Match that option order.
      { key: "oneWay", label: "Invocation Type", type: "radio", options: [
        { value: true, label: "One-Way" },
        { value: false, label: "Two-Way" }
      ] },
      {
        // Swing places the Generate Envelope button inline on the Operation
        // row (add(operationComboBox,"split 2"); add(generateEnvelopeButton)).
        // The button is disabled until real operations are loaded
        // (updateGenerateEnvelopeButtonEnabled -> !isDefaultOperations()).
        type: "custom",
        label: "Operation",
        span: true,
        render: (p, ctx) => {
          const info = currentPortInfo();
          const ops = info ? [...info.operations] : [];
          const current = String(p.operation ?? "");
          if (!ops.includes(current)) ops.unshift(current || WS_DEFAULT_OPERATION);
          const combo = select(ops.map((o) => ({ value: o, label: o })), current, {
            style: { width: "320px" },
            onChange: (e) => {
              p.operation = e.target.value;
              const index = info ? info.operations.indexOf(e.target.value) : -1;
              p.soapAction = index >= 0 && index < (info.actions || []).length ? info.actions[index] ?? "" : "";
              onChange();
              ctx.repaint();
            }
          });
          const btn = taskButton("Generate Envelope", "code", () => generateEnvelope(btn, ctx.repaint), {
            title: "Regenerates the SOAP Envelope from the cached WSDL schema and populates the SOAP Action, if available"
          });
          if (!current || current === WS_DEFAULT_OPERATION) btn.disabled = true;
          return h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } }, combo, btn);
        }
      },
      { key: "soapAction", label: "SOAP Action", type: "text", width: "320px" },
      { key: "envelope", label: "SOAP Envelope", type: "code", language: "xml", minHeight: "220px" },
      { section: "Headers" },
      { key: "isUseHeadersVariable", label: "Headers Source", type: "radio", refresh: true, options: [
        { value: false, label: "Use Table" },
        { value: true, label: "Use Map" }
      ] },
      { key: "headersVariable", label: "Headers Map Variable", type: "text", width: "220px", disabled: (p) => !isTrue(p.isUseHeadersVariable) },
      { key: "headers", label: "Headers", type: "keyvalue", mapShape: "list", disabled: (p) => isTrue(p.isUseHeadersVariable) },
      { section: "Attachments" },
      { key: "useMtom", label: "Use MTOM", type: "radio", options: YES_NO, refresh: true },
      {
        // Swing keeps the whole attachments block VISIBLE but disables it
        // when MTOM=No (useMtomNoRadioActionPerformed). The source radio,
        // variable field, and table are gated on useMtom + the sub-selection.
        key: "isUseAttachmentsVariable",
        label: "Attachments Source",
        type: "radio",
        refresh: true,
        disabled: (p) => !isTrue(p.useMtom),
        options: [
          { value: false, label: "Use Table" },
          { value: true, label: "Use List" }
        ]
      },
      {
        key: "attachmentsVariable",
        label: "Attachments List Variable",
        type: "text",
        width: "220px",
        disabled: (p) => !(isTrue(p.useMtom) && isTrue(p.isUseAttachmentsVariable))
      },
      {
        type: "custom",
        label: "Attachments",
        span: true,
        render: (p) => attachmentsTable(p, onChange, !(isTrue(p.useMtom) && !isTrue(p.isUseAttachmentsVariable)))
      }
    ] });
  }
};
function register(platform) {
  platform.registerConnectorPanel("Web Service Listener", "SOURCE", wsListener);
  platform.registerConnectorPanel("Web Service Sender", "DESTINATION", wsSender);
}
export {
  register
};
