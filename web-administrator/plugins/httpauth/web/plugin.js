// plugins/httpauth/web/plugin.jsx
import { platform } from "@oie/web-shell";
import { DESTINATION_MAPPINGS } from "@oie/web-ui";
var React = platform.React;
var AUTH_TYPE_OPTIONS = [
  { value: "NONE", label: "None" },
  { value: "BASIC", label: "Basic Authentication" },
  { value: "DIGEST", label: "Digest Authentication" },
  { value: "JAVASCRIPT", label: "JavaScript" },
  { value: "CUSTOM", label: "Custom Java Class" },
  { value: "OAUTH2_VERIFICATION", label: "OAuth 2.0 Token Verification" }
];
var AUTH_CLASSES = {
  NONE: "com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties",
  BASIC: "com.mirth.connect.plugins.httpauth.basic.BasicHttpAuthProperties",
  DIGEST: "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties",
  JAVASCRIPT: "com.mirth.connect.plugins.httpauth.javascript.JavaScriptHttpAuthProperties",
  CUSTOM: "com.mirth.connect.plugins.httpauth.custom.CustomHttpAuthProperties",
  OAUTH2_VERIFICATION: "com.mirth.connect.plugins.httpauth.oauth2.OAuth2HttpAuthProperties"
};
var DIGEST_ALGORITHM_CLASS = "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-Algorithm";
var DIGEST_QOP_CLASS = "com.mirth.connect.plugins.httpauth.digest.DigestHttpAuthProperties_-QOPMode";
var DEFAULT_AUTH_SCRIPT = "// Return an AuthenticationResult object to authenticate users.\n// Boolean return values may also be used.\n// You have access to the source map here.\n\nreturn AuthenticationResult.Success();";
function asBool(value) {
  return value === true || value === "true";
}
function findAuthEntry(properties) {
  const pp = properties.pluginProperties;
  if (!pp || typeof pp !== "object") return null;
  for (const [key, value] of Object.entries(pp)) {
    if (!key.toLowerCase().includes("httpauth")) continue;
    const entry = Array.isArray(value) ? value[0] : value;
    if (entry && typeof entry === "object" && entry.authType) {
      return { key, entry };
    }
  }
  return null;
}
function currentAuthType(properties) {
  const state = findAuthEntry(properties);
  return state ? String(state.entry.authType) : "NONE";
}
function defaultAuthProperties(type, version) {
  const base = { "@version": version, authType: type };
  switch (type) {
    case "BASIC":
      return Object.assign(base, {
        realm: "My Realm",
        credentials: { "@class": "linked-hash-map" },
        isUseCredentialsVariable: false,
        credentialsVariable: ""
      });
    case "DIGEST":
      return Object.assign(base, {
        realm: "My Realm",
        algorithms: { "@class": "linked-hash-set", [DIGEST_ALGORITHM_CLASS]: ["MD5", "MD5_SESS"] },
        qopModes: { "@class": "linked-hash-set", [DIGEST_QOP_CLASS]: ["AUTH", "AUTH_INT"] },
        opaque: "${UUID}",
        credentials: { "@class": "linked-hash-map" },
        isUseCredentialsVariable: false,
        credentialsVariable: ""
      });
    case "JAVASCRIPT":
      return Object.assign(base, { script: DEFAULT_AUTH_SCRIPT });
    case "CUSTOM":
      return Object.assign(base, {
        authenticatorClass: "",
        properties: { "@class": "linked-hash-map" }
      });
    case "OAUTH2_VERIFICATION":
      return Object.assign(base, {
        tokenLocation: "HEADER",
        locationKey: "Authorization",
        verificationURL: ""
      });
    default:
      return base;
  }
}
function setAuthType(properties, type) {
  const state = findAuthEntry(properties);
  if (state && String(state.entry.authType) === type) return;
  if (!state && type === "NONE") return;
  if (!properties.pluginProperties || typeof properties.pluginProperties !== "object") {
    properties.pluginProperties = {};
  }
  if (state) delete properties.pluginProperties[state.key];
  properties.pluginProperties[AUTH_CLASSES[type]] = defaultAuthProperties(type, properties["@version"]);
}
function mapRows(map) {
  const out = [];
  if (!map || typeof map !== "object") return out;
  let entries = map.entry;
  if (entries === null || entries === void 0 || entries === "") return out;
  if (!Array.isArray(entries)) entries = [entries];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.string)) out.push([String(entry.string[0] ?? ""), String(entry.string[1] ?? "")]);
    else if (entry.string !== void 0) out.push([String(entry.string), ""]);
  }
  return out;
}
function writeMapRows(rows) {
  const target = { "@class": "linked-hash-map" };
  const clean = rows.filter(([k]) => k !== "" && k !== null && k !== void 0);
  if (clean.length) target.entry = clean.map(([k, v]) => ({ string: [k, v] }));
  return target;
}
function register(platform2) {
  function CodeField({ value, language, minHeight, onChange }) {
    const hostRef = React.useRef(null);
    const editorRef = React.useRef(null);
    const onChangeRef = React.useRef(onChange);
    onChangeRef.current = onChange;
    React.useEffect(() => {
      const editor = platform2.createCodeEditor({
        value: value === null || value === void 0 ? "" : String(value),
        language: language || "text",
        minHeight: minHeight || "240px",
        popoutable: true,
        // dedicated full-screen code view
        popoutTitle: "Script",
        popoutVars: DESTINATION_MAPPINGS,
        // connector settings context
        onChange: (v) => onChangeRef.current(v)
      });
      editorRef.current = editor;
      if (hostRef.current) hostRef.current.appendChild(editor.el);
      return () => {
        if (editor.destroy) editor.destroy();
        if (hostRef.current) hostRef.current.replaceChildren();
      };
    }, []);
    return /* @__PURE__ */ React.createElement("div", { ref: hostRef });
  }
  function KeyValueField({ entry, fieldKey, onChange }) {
    const [rows, setRows] = React.useState(() => mapRows(entry[fieldKey]));
    const commit = (next) => {
      entry[fieldKey] = writeMapRows(next);
      setRows(next);
      onChange();
    };
    return /* @__PURE__ */ React.createElement("div", null, rows.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "flex gap-1.5 mb-1.5" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "Name",
        className: "flex-1",
        value: row[0],
        onInput: (e) => {
          const next = rows.slice();
          next[i] = [e.target.value, row[1]];
          commit(next);
        },
        onChange: (e) => {
          const next = rows.slice();
          next[i] = [e.target.value, row[1]];
          commit(next);
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "Value",
        className: "flex-[2]",
        value: row[1],
        onInput: (e) => {
          const next = rows.slice();
          next[i] = [row[0], e.target.value];
          commit(next);
        },
        onChange: (e) => {
          const next = rows.slice();
          next[i] = [row[0], e.target.value];
          commit(next);
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "icon-btn",
        title: "Remove",
        onClick: () => {
          const next = rows.slice();
          next.splice(i, 1);
          commit(next);
        }
      },
      /* @__PURE__ */ React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: "16",
          height: "16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.7",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
        /* @__PURE__ */ React.createElement("path", { d: "M6 6l12 12M18 6L6 18" })
      )
    ))), /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn",
        onClick: () => commit([...rows, ["", ""]])
      },
      "Add"
    ));
  }
  function EnumSetField({ entry, fieldKey, elementClass, options, onChange }) {
    const read = () => {
      const set = entry[fieldKey];
      let values = set && typeof set === "object" ? set[elementClass] : null;
      if (values === null || values === void 0 || values === "") values = [];
      if (!Array.isArray(values)) values = [values];
      return values.map(String);
    };
    const [selected, setSelected] = React.useState(read);
    const toggle = (optValue, checked) => {
      let next = selected.filter((v) => v !== optValue);
      if (checked) next.push(optValue);
      const ordered = options.map((o) => o.value).filter((v) => next.includes(v));
      entry[fieldKey] = { "@class": "linked-hash-set", [elementClass]: ordered };
      setSelected(ordered);
      onChange();
    };
    return /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, options.map((opt) => /* @__PURE__ */ React.createElement("label", { className: "check", key: opt.value }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: selected.includes(opt.value),
        onChange: (e) => toggle(opt.value, e.target.checked)
      }
    ), opt.label)));
  }
  function CformRow({ label, top, children }) {
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("label", { className: "cform-label" + (top ? " top" : "") }, label ? `${label}:` : ""), /* @__PURE__ */ React.createElement("div", { className: "cform-control" + (top ? " wide" : "") }, children));
  }
  function TextRow({ label, entry, fieldKey, width, placeholder, onChange }) {
    return /* @__PURE__ */ React.createElement(CformRow, { label }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder,
        style: { width: width || "320px" },
        value: entry[fieldKey] == null ? "" : String(entry[fieldKey]),
        onInput: (e) => {
          entry[fieldKey] = e.target.value;
          onChange();
        },
        onChange: (e) => {
          entry[fieldKey] = e.target.value;
          onChange();
        }
      }
    ));
  }
  function CredentialFields({ entry, onChange }) {
    const [useVar, setUseVar] = React.useState(asBool(entry.isUseCredentialsVariable));
    const name = React.useMemo(() => "httpauth-cred-" + Math.random().toString(36).slice(2), []);
    const setUse = (v) => {
      entry.isUseCredentialsVariable = v;
      setUseVar(v);
      onChange();
    };
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(CformRow, { label: "Use Credentials" }, /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement("input", { type: "radio", name, checked: !useVar, onChange: () => setUse(false) }), " Table"), /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement("input", { type: "radio", name, checked: useVar, onChange: () => setUse(true) }), " Variable"))), !useVar && /* @__PURE__ */ React.createElement(CformRow, { label: "Credentials (user / password)", top: true }, /* @__PURE__ */ React.createElement(KeyValueField, { entry, fieldKey: "credentials", onChange })), useVar && /* @__PURE__ */ React.createElement(
      TextRow,
      {
        label: "Credentials Variable",
        entry,
        fieldKey: "credentialsVariable",
        width: "220px",
        onChange
      }
    ));
  }
  function AuthEditor({ entry, onChange }) {
    switch (String(entry.authType)) {
      case "BASIC":
        return /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement(TextRow, { label: "Realm", entry, fieldKey: "realm", width: "220px", onChange }), /* @__PURE__ */ React.createElement(CredentialFields, { entry, onChange }))));
      case "DIGEST":
        return /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement(TextRow, { label: "Realm", entry, fieldKey: "realm", width: "220px", onChange }), /* @__PURE__ */ React.createElement(CformRow, { label: "Algorithms" }, /* @__PURE__ */ React.createElement(
          EnumSetField,
          {
            entry,
            fieldKey: "algorithms",
            elementClass: DIGEST_ALGORITHM_CLASS,
            options: [{ value: "MD5", label: "MD5" }, { value: "MD5_SESS", label: "MD5-sess" }],
            onChange
          }
        )), /* @__PURE__ */ React.createElement(CformRow, { label: "QOP Modes" }, /* @__PURE__ */ React.createElement(
          EnumSetField,
          {
            entry,
            fieldKey: "qopModes",
            elementClass: DIGEST_QOP_CLASS,
            options: [{ value: "AUTH", label: "auth" }, { value: "AUTH_INT", label: "auth-int" }],
            onChange
          }
        )), /* @__PURE__ */ React.createElement(TextRow, { label: "Opaque", entry, fieldKey: "opaque", width: "220px", onChange }), /* @__PURE__ */ React.createElement(CredentialFields, { entry, onChange }))));
      case "JAVASCRIPT":
        return /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement(CformRow, { label: "Script", top: true }, /* @__PURE__ */ React.createElement(
          CodeField,
          {
            value: entry.script,
            language: "javascript",
            minHeight: "200px",
            onChange: (v) => {
              entry.script = v;
              onChange();
            }
          }
        )))));
      case "CUSTOM":
        return /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement(
          TextRow,
          {
            label: "Class Name",
            entry,
            fieldKey: "authenticatorClass",
            width: "420px",
            placeholder: "com.example.MyAuthenticator",
            onChange
          }
        ), /* @__PURE__ */ React.createElement(CformRow, { label: "Properties", top: true }, /* @__PURE__ */ React.createElement(KeyValueField, { entry, fieldKey: "properties", onChange })))));
      case "OAUTH2_VERIFICATION":
        return /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement(CformRow, { label: "Token Location" }, /* @__PURE__ */ React.createElement(
          "select",
          {
            className: "w-[160px]",
            value: entry.tokenLocation == null ? "" : String(entry.tokenLocation),
            onChange: (e) => {
              entry.tokenLocation = e.target.value;
              onChange();
            }
          },
          /* @__PURE__ */ React.createElement("option", { value: "HEADER" }, "Request Header"),
          /* @__PURE__ */ React.createElement("option", { value: "QUERY" }, "Query Parameter")
        )), /* @__PURE__ */ React.createElement(TextRow, { label: "Token Field Name", entry, fieldKey: "locationKey", width: "220px", onChange }), /* @__PURE__ */ React.createElement(TextRow, { label: "Verification URL", entry, fieldKey: "verificationURL", width: "420px", onChange }))));
      default:
        return /* @__PURE__ */ React.createElement("div", null);
    }
  }
  function HttpAuthPanel({ connector, onChange }) {
    const [, force] = React.useReducer((x) => x + 1, 0);
    if (!connector || !connector.properties) return null;
    const properties = connector.properties;
    const type = currentAuthType(properties);
    const state = findAuthEntry(properties);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Authentication Type"), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "w-[220px]",
        value: type,
        onChange: (e) => {
          setAuthType(properties, e.target.value);
          onChange();
          force();
        }
      },
      AUTH_TYPE_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))
    )), type !== "NONE" && state && /* @__PURE__ */ React.createElement(AuthEditor, { key: state.key, entry: state.entry, onChange }));
  }
  platform2.registerConnectorPropertiesPanel({
    id: "httpauth",
    title: "Authentication",
    // A truthy fqcn so the channel editor renders this panel; the auth type
    // (and thus the stored class) is managed inside the component via pluginProperties.
    propertiesClass: (transportName, mode, connector) => AUTH_CLASSES[currentAuthType(connector && connector.properties || {})] || AUTH_CLASSES.NONE,
    // Engine parity: HttpAuthConnectorPropertiesPlugin.isConnectorPropertiesPluginSupported
    // attaches to these source listeners.
    isSupported: (transportName, mode) => mode === "SOURCE" && [
      "HTTP Listener",
      "Web Service Listener",
      "FHIR Listener",
      "Health Data Hub Listener"
    ].includes(transportName),
    component: HttpAuthPanel
  });
}
export {
  register
};
