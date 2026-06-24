import { React, useReducer, useRef, useEffect, useMemo } from "./react-platform.js";
import { platform } from "@oie/web-shell";
import { h, modal, toast, taskButton, icon } from "../core/ui.js";
import { createCodeEditor } from "../core/codeeditor.js";
import * as api from "../core/api.js";
import {
  getPath,
  setPath,
  mapEntries,
  writeMapEntries,
  asBool,
  postConnectorProperties,
  successToast,
  apiErrorMessage
} from "./forms.js";
function Icon({ name }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.replaceChildren(icon(name));
  }, [name]);
  return /* @__PURE__ */ React.createElement("span", { ref, style: { display: "inline-flex" } });
}
export * from "./forms.js";
const DEFAULT_WIDTHS = {
  number: "110px",
  text: "320px",
  password: "320px",
  select: "220px"
};
let cformUid = 0;
function CodeField({ value, language, minHeight, placeholder, onChange, disabled }) {
  const hostRef = useRef(null);
  const edRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const host = hostRef.current;
    const editor = createCodeEditor({
      value: value === null || value === void 0 ? "" : String(value),
      language: language || "text",
      minHeight: minHeight || "240px",
      placeholder,
      readOnly: !!disabled,
      onChange: (v) => onChangeRef.current && onChangeRef.current(v)
    });
    edRef.current = editor;
    host.appendChild(editor.el);
    return () => {
      try {
        editor.dispose && editor.dispose();
      } catch {
      }
      edRef.current = null;
      if (host) host.replaceChildren();
    };
  }, [language]);
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const next = value === null || value === void 0 ? "" : String(value);
    if (ed.getValue() !== next) ed.setValue(next);
  }, [value]);
  useEffect(() => {
    const ed = edRef.current;
    if (ed && ed.opts) ed.opts.readOnly = !!disabled;
    if (ed && ed.area) ed.area.readOnly = !!disabled;
  }, [disabled]);
  return /* @__PURE__ */ React.createElement("div", { ref: hostRef, style: disabled ? { opacity: 0.6 } : void 0 });
}
function DomNode({ node }) {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    if (node) host.appendChild(node);
    return () => {
      if (host) host.replaceChildren();
    };
  }, [node]);
  return /* @__PURE__ */ React.createElement("span", { ref, style: { display: "contents" } });
}
function KeyValueEditor({ properties, field, onChange, disabled }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const rowsRef = useRef(null);
  const lastMapRef = useRef(void 0);
  const currentMap = getPath(properties, field.key);
  if (rowsRef.current === null || currentMap !== lastMapRef.current) {
    rowsRef.current = mapEntries(currentMap);
    lastMapRef.current = currentMap;
  }
  const rows = rowsRef.current;
  const commit = () => {
    const written = writeMapEntries(getPath(properties, field.key), rows, field.mapShape || "string");
    setPath(properties, field.key, written);
    lastMapRef.current = written;
    onChange();
  };
  return /* @__PURE__ */ React.createElement("div", { style: disabled ? { opacity: 0.6 } : void 0 }, rows.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", gap: "6px", marginBottom: "6px" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: row[0],
      placeholder: "Name",
      style: { flex: "1" },
      disabled,
      onChange: (e) => {
        row[0] = e.target.value;
        tick();
        commit();
      }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: row[1],
      placeholder: "Value",
      style: { flex: "2" },
      disabled,
      onChange: (e) => {
        row[1] = e.target.value;
        tick();
        commit();
      }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "icon-btn",
      title: "Remove",
      disabled,
      onClick: () => {
        rows.splice(i, 1);
        commit();
        tick();
      }
    },
    /* @__PURE__ */ React.createElement(Icon, { name: "x" })
  ))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", disabled, onClick: () => {
    rows.push(["", ""]);
    tick();
  } }, "Add"));
}
function FieldRow({ properties, field, onChange, repaint }) {
  const f = field;
  const value = f.key === void 0 ? void 0 : getPath(properties, f.key);
  const disabled = typeof f.disabled === "function" ? f.disabled(properties) : !!f.disabled;
  const labelText = typeof f.label === "function" ? f.label(properties) : f.label;
  const set = (v) => {
    if (f.key !== void 0) setPath(properties, f.key, v);
    if (f.onSet) f.onSet(properties, v);
    onChange();
    if (repaint) repaint();
  };
  let control = null;
  let wide = f.span === true;
  const isWideType = f.type === "textarea" || f.type === "code" || f.type === "keyvalue";
  const baseWide = wide || isWideType;
  const width = !baseWide ? f.width || DEFAULT_WIDTHS[f.type || "text"] : void 0;
  const isInputType = f.type === void 0 || f.type === "text" || f.type === "password" || f.type === "number" || f.type === "select";
  const inputStyle = width && (f.width || isInputType) ? { width } : void 0;
  switch (f.type) {
    case "checkbox":
      control = /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: asBool(value), disabled, onChange: (e) => set(e.target.checked) }), f.checkLabel || "");
      break;
    case "radio": {
      const name = `cform-radio-${++cformUid}`;
      control = /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row", style: f.width ? { width: f.width } : void 0 }, (f.options || []).map((opt, i) => {
        const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
        return /* @__PURE__ */ React.createElement("label", { className: "check", key: i }, /* @__PURE__ */ React.createElement(
          "input",
          {
            type: "radio",
            name,
            disabled,
            checked: String(o.value) === String(value ?? ""),
            onChange: () => set(o.value)
          }
        ), o.label);
      }));
      break;
    }
    case "display": {
      const text = f.compute ? f.compute(properties) : getPath(properties, f.key);
      control = /* @__PURE__ */ React.createElement("span", { className: "cform-display", style: f.width ? { width: f.width } : void 0 }, text === null || text === void 0 ? "" : String(text));
      break;
    }
    case "number":
      control = /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          value: value ?? "",
          placeholder: f.placeholder,
          style: inputStyle,
          disabled,
          onChange: (e) => set(f.numeric ? parseInt(e.target.value, 10) || 0 : e.target.value)
        }
      );
      break;
    case "select":
      control = /* @__PURE__ */ React.createElement(
        "select",
        {
          value: value ?? "",
          style: inputStyle,
          disabled,
          onChange: (e) => set(f.numeric ? parseInt(e.target.value, 10) : e.target.value)
        },
        (f.options || []).map((opt, i) => {
          const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
          return /* @__PURE__ */ React.createElement("option", { key: i, value: o.value }, o.label);
        })
      );
      break;
    case "textarea":
      control = /* @__PURE__ */ React.createElement(
        "textarea",
        {
          rows: f.rows || 5,
          placeholder: f.placeholder,
          disabled,
          value: value === null || value === void 0 ? "" : String(value),
          onChange: (e) => set(e.target.value)
        }
      );
      wide = true;
      break;
    case "code":
      control = /* @__PURE__ */ React.createElement(
        CodeField,
        {
          value,
          language: typeof f.language === "function" ? f.language(properties) : f.language,
          minHeight: f.minHeight,
          placeholder: f.placeholder,
          onChange: (v) => set(v),
          disabled
        }
      );
      wide = true;
      break;
    case "keyvalue":
      control = /* @__PURE__ */ React.createElement(KeyValueEditor, { properties, field: f, onChange, disabled });
      wide = true;
      break;
    case "custom": {
      const node = f.render(properties, { onChange, repaint: repaint || (() => {
      }) });
      if (node && f.width && node.style) node.style.width = f.width;
      control = /* @__PURE__ */ React.createElement(DomNode, { node });
      break;
    }
    default:
      control = /* @__PURE__ */ React.createElement(
        "input",
        {
          type: f.type === "password" ? "password" : "text",
          value: value ?? "",
          disabled,
          placeholder: f.placeholder,
          style: inputStyle,
          onChange: (e) => set(e.target.value)
        }
      );
  }
  const appendNode = f.append ? f.append(properties, { onChange, repaint: repaint || (() => {
  }) }) : null;
  if (f.full) {
    return /* @__PURE__ */ React.createElement("div", { className: "cform-control", style: { gridColumn: "1 / -1" } }, control, appendNode ? /* @__PURE__ */ React.createElement(DomNode, { node: appendNode }) : null);
  }
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
    "label",
    {
      className: "cform-label" + (wide ? " top" : ""),
      title: f.tooltip || void 0,
      style: disabled ? { opacity: 0.5 } : void 0
    },
    labelText ? `${labelText}:` : ""
  ), /* @__PURE__ */ React.createElement("div", { className: "cform-control" + (wide ? " wide" : ""), title: f.tooltip || void 0 }, control, appendNode ? /* @__PURE__ */ React.createElement(DomNode, { node: appendNode }) : null));
}
function ConnectorForm({ properties, fields, onChange }) {
  const [, repaint] = useReducer((n) => n + 1, 0);
  const notify = () => {
    onChange();
    repaint();
  };
  const sections = [];
  let current = null;
  for (const f of fields) {
    if (f.section !== void 0) {
      if (f.visible && !f.visible(properties)) {
        current = null;
        continue;
      }
      current = { title: f.section, rows: [] };
      sections.push(current);
      continue;
    }
    if (f.visible && !f.visible(properties)) continue;
    if (!current) {
      current = { title: null, rows: [] };
      sections.push(current);
    }
    current.rows.push(f);
  }
  return /* @__PURE__ */ React.createElement("div", { className: "cform" }, sections.map((section, si) => /* @__PURE__ */ React.createElement("div", { className: "cform-section", key: si }, section.title ? /* @__PURE__ */ React.createElement("div", { className: "cform-section-title" }, section.title) : null, /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, section.rows.map((f, ri) => /* @__PURE__ */ React.createElement(
    FieldRow,
    {
      key: f.key || (typeof f.label === "string" ? f.label : "") || `row-${si}-${ri}`,
      properties,
      field: f,
      onChange: notify,
      repaint: f.refresh || f.type === "custom" ? repaint : null
    }
  ))))));
}
function PortsInUseButton() {
  const ref = useRef(null);
  useEffect(() => {
    const host = ref.current;
    const btn = taskButton("Ports in Use", "search", async () => {
      btn.disabled = true;
      try {
        const ports = await api.channels.portsInUse();
        const rows = ports.filter((p) => p && typeof p === "object").map((p) => h("tr", h("td.num", String(p.port ?? "")), h("td", String(p.name ?? ""))));
        modal({
          title: "Ports in Use",
          body: h(
            "table.dt",
            h("thead", h("tr", h("th", "Port"), h("th", "Channel Name"))),
            h("tbody", rows.length ? rows : h("tr", h("td", { colSpan: 2 }, "No listener ports in use")))
          ),
          buttons: [{ label: "Close", primary: true }]
        });
      } catch (e) {
        toast(apiErrorMessage(e), "error");
      } finally {
        btn.disabled = false;
      }
    });
    host.appendChild(btn);
    return () => {
      if (host) host.replaceChildren();
    };
  }, []);
  return /* @__PURE__ */ React.createElement("span", { ref, style: { display: "contents" } });
}
function ConnectorTestButton({ label = "Test Connection", icon: iconName = "link", path, channel, properties }) {
  const ref = useRef(null);
  const stateRef = useRef({ label, iconName, path, channel, properties });
  stateRef.current = { label, iconName, path, channel, properties };
  useEffect(() => {
    const host = ref.current;
    const btn = taskButton(stateRef.current.label, stateRef.current.iconName, async () => {
      const s = stateRef.current;
      btn.disabled = true;
      try {
        const result = await postConnectorProperties(s.path, s.properties, s.channel);
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
    host.appendChild(btn);
    return () => {
      if (host) host.replaceChildren();
    };
  }, []);
  return /* @__PURE__ */ React.createElement("span", { ref, style: { display: "contents" } });
}
function PollSection({ properties, onChange }) {
  return /* @__PURE__ */ React.createElement("div", { className: "cform-section", style: { marginTop: "16px" } }, /* @__PURE__ */ React.createElement("div", { className: "cform-section-title" }, "Polling Settings"), /* @__PURE__ */ React.createElement(PollSettings, { properties, onChange }));
}
function PollSettings({ properties, onChange }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  const notify = () => {
    onChange();
    tick();
  };
  const p = properties.pollConnectorProperties;
  function cronRows() {
    const jobs = p.cronJobs;
    let list = jobs && typeof jobs === "object" ? jobs.cronProperty : null;
    if (list === null || list === void 0 || list === "") return [];
    return Array.isArray(list) ? list : [list];
  }
  const cronRef = useRef(null);
  if (cronRef.current === null) cronRef.current = cronRows().map((job) => ({ expression: job.expression ?? "", description: job.description ?? "" }));
  const cron = cronRef.current;
  const commitCron = () => {
    p.cronJobs = cron.length ? { cronProperty: cron.map((r) => ({ description: r.description, expression: r.expression })) } : null;
    onChange();
  };
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Schedule Type"), /* @__PURE__ */ React.createElement("select", { value: p.pollingType, onChange: (e) => {
    p.pollingType = e.target.value;
    notify();
  } }, /* @__PURE__ */ React.createElement("option", { value: "INTERVAL" }, "Interval"), /* @__PURE__ */ React.createElement("option", { value: "TIME" }, "Time"), /* @__PURE__ */ React.createElement("option", { value: "CRON" }, "Cron"))), p.pollingType === "INTERVAL" && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Polling Frequency (ms)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      value: p.pollingFrequency ?? 5e3,
      onChange: (e) => {
        p.pollingFrequency = parseInt(e.target.value, 10) || 0;
        onChange();
      }
    }
  )), p.pollingType === "TIME" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Hour (0-23)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: 0,
      max: 23,
      value: p.pollingHour ?? 0,
      onChange: (e) => {
        p.pollingHour = parseInt(e.target.value, 10) || 0;
        onChange();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Minute (0-59)"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: 0,
      max: 59,
      value: p.pollingMinute ?? 0,
      onChange: (e) => {
        p.pollingMinute = parseInt(e.target.value, 10) || 0;
        onChange();
      }
    }
  ))), p.pollingType === "CRON" && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Cron Jobs"), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, cron.map((row, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", gap: "6px", marginBottom: "6px" } }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: row.expression,
      placeholder: "Cron expression (e.g. 0 */5 * ? * *)",
      style: { flex: "2" },
      onChange: (e) => {
        row.expression = e.target.value;
        tick();
        commitCron();
      }
    }
  ), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: row.description,
      placeholder: "Description",
      style: { flex: "1" },
      onChange: (e) => {
        row.description = e.target.value;
        tick();
        commitCron();
      }
    }
  ), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "icon-btn",
      title: "Remove",
      onClick: () => {
        cron.splice(i, 1);
        commitCron();
        tick();
      }
    },
    /* @__PURE__ */ React.createElement(Icon, { name: "x" })
  ))), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn", onClick: () => {
    cron.push({ expression: "", description: "" });
    tick();
  } }, "Add Cron Job"))), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "\xA0"), /* @__PURE__ */ React.createElement("div", { style: { minHeight: "34px", display: "flex", alignItems: "center" } }, /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      checked: asBool(p.pollOnStart),
      onChange: (e) => {
        p.pollOnStart = e.target.checked;
        onChange();
      }
    }
  ), "Poll Once on Start"))));
}
function defaultFrameMode() {
  return {
    "@class": "com.mirth.connect.model.transmission.framemode.FrameModeProperties",
    pluginPointName: "MLLP",
    startOfMessageBytes: "0B",
    endOfMessageBytes: "1C0D"
  };
}
function TransmissionModePanel({ properties, onChange }) {
  const [, tick] = useReducer((n) => n + 1, 0);
  if (!properties.transmissionModeProperties || typeof properties.transmissionModeProperties !== "object") {
    properties.transmissionModeProperties = defaultFrameMode();
  }
  const tm = properties.transmissionModeProperties;
  const modes = useMemo(() => platform.transmissionModes(), []);
  if (!tm.pluginPointName && modes[0]) tm.pluginPointName = modes[0].name;
  const modeOf = () => modes.find((m) => m.name === tm.pluginPointName);
  const mode = modeOf();
  const sample = mode && mode.sampleFrame ? mode.sampleFrame(tm) : "<Message Data>";
  const openSettings = () => {
    const m = modeOf();
    if (m && m.openSettings) m.openSettings(tm, () => {
      onChange();
      tick();
    });
  };
  return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: "16px" } }, /* @__PURE__ */ React.createElement("div", { className: "cform" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section" }, /* @__PURE__ */ React.createElement("div", { className: "cform-section-title" }, "Transmission Mode"), /* @__PURE__ */ React.createElement("div", { className: "cform-grid" }, /* @__PURE__ */ React.createElement("label", { className: "cform-label" }, "Transmission Mode:"), /* @__PURE__ */ React.createElement("div", { className: "cform-control" }, /* @__PURE__ */ React.createElement("div", { className: "flex", style: { gap: "6px", alignItems: "center" } }, /* @__PURE__ */ React.createElement(
    "select",
    {
      value: tm.pluginPointName,
      style: { width: "180px" },
      onChange: (e) => {
        tm.pluginPointName = e.target.value;
        const m = modeOf();
        if (m && m.apply) m.apply(tm);
        onChange();
        tick();
      }
    },
    modes.map((m) => /* @__PURE__ */ React.createElement("option", { key: m.name, value: m.name }, m.label))
  ), mode && mode.openSettings && /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "icon-btn",
      title: "Transmission Mode Settings",
      onClick: openSettings
    },
    /* @__PURE__ */ React.createElement(Icon, { name: "settings" })
  ))), /* @__PURE__ */ React.createElement("label", { className: "cform-label" }, "Sample Frame:"), /* @__PURE__ */ React.createElement("div", { className: "cform-control" }, /* @__PURE__ */ React.createElement("span", { className: "mono faint", style: { fontSize: "12px" } }, sample))))));
}
export {
  ConnectorForm,
  ConnectorTestButton,
  PollSection,
  PortsInUseButton,
  TransmissionModePanel
};
