// plugins/transformer-steps/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var SCOPES = [
  { value: "CHANNEL", label: "Channel Map" },
  { value: "CONNECTOR", label: "Connector Map" },
  { value: "GLOBAL_CHANNEL", label: "Global Channel Map" },
  { value: "GLOBAL", label: "Global Map" },
  { value: "RESPONSE", label: "Response Map" }
];
var CONDITIONS = [
  { value: "EXISTS", label: "Exists" },
  { value: "NOT_EXIST", label: "Not Exist" },
  { value: "EQUALS", label: "Equals" },
  { value: "NOT_EQUAL", label: "Not Equal" },
  { value: "CONTAINS", label: "Contains" },
  { value: "NOT_CONTAIN", label: "Not Contain" }
];
var BEHAVIORS = [
  { value: "REMOVE", label: "Remove the following" },
  { value: "REMOVE_ALL_EXCEPT", label: "Remove all except the following" },
  { value: "REMOVE_ALL", label: "Remove all" }
];
var CONDITION_USES_VALUES = /* @__PURE__ */ new Set(["EQUALS", "NOT_EQUAL", "CONTAINS", "NOT_CONTAIN"]);
var isBlank = (v) => v == null || String(v).trim() === "";
function stringListToLines(value) {
  if (!value || typeof value !== "object") return [];
  const list = value.string;
  if (list === null || list === void 0) return [];
  return (Array.isArray(list) ? list : [list]).map((v) => String(v ?? ""));
}
function linesToStringList(text) {
  const lines = String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return lines.length ? { string: lines } : "";
}
function checkedIdSet(value) {
  if (!value || typeof value !== "object") return /* @__PURE__ */ new Set();
  const list = value.int;
  if (list === null || list === void 0) return /* @__PURE__ */ new Set();
  return new Set((Array.isArray(list) ? list : [list]).map((v) => String(v)));
}
function idSetToMetaData(set, destinations) {
  const ordered = destinations.map((d) => String(d.metaDataId)).filter((id) => set.has(id));
  for (const id of set) if (!ordered.includes(id)) ordered.push(id);
  return ordered.length ? { int: ordered } : "";
}
function stringArrayToList(arr) {
  return arr.length ? { string: arr.map((s) => String(s ?? "")) } : "";
}
function Field({ label, hint, children }) {
  return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), children, hint ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, hint) : null);
}
function Select({ options, value, onChange }) {
  return /* @__PURE__ */ React.createElement("select", { value, onChange }, options.map((opt) => {
    const o = typeof opt === "object" ? opt : { value: opt, label: String(opt) };
    return /* @__PURE__ */ React.createElement("option", { key: String(o.value), value: o.value }, o.label);
  }));
}
function useRerender() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  return force;
}
function CodeEditorIsland({ value, minHeight, fill, onChange }) {
  const hostRef = React.useRef(null);
  const editorRef = React.useRef(null);
  React.useEffect(() => {
    const editor = platform.createCodeEditor({
      value: value ?? "",
      minHeight,
      popoutable: true,
      // full-screen code view; the transformer editor moves its
      popoutTitle: "JavaScript",
      // Reference/Templates/Trees panel in (oie:code-view)
      onChange
    });
    editorRef.current = editor;
    if (fill) {
      editor.el.style.flex = "1";
      editor.el.style.minHeight = "0";
    }
    hostRef.current.appendChild(editor.el);
    return () => {
      if (editor.el && editor.el.parentNode) editor.el.parentNode.removeChild(editor.el);
      editorRef.current = null;
    };
  }, []);
  return /* @__PURE__ */ React.createElement("div", { ref: hostRef, style: fill ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } : void 0 });
}
function ScriptEditor({ element, onChange }) {
  return /* @__PURE__ */ React.createElement(Field, { label: "Script" }, /* @__PURE__ */ React.createElement(
    CodeEditorIsland,
    {
      value: element.script ?? "",
      minHeight: "260px",
      fill: true,
      onChange: (value) => {
        element.script = value;
        onChange();
      }
    }
  ));
}
function ScriptPathEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement(
    Field,
    {
      label: "Script Path",
      hint: "Path to a JavaScript file on the server \u2014 its contents are loaded when the channel is deployed"
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "/opt/scripts/example.js",
        value: element.scriptPath ?? "",
        onChange: (e) => {
          element.scriptPath = e.target.value;
          onChange();
          force();
        }
      }
    )
  );
}
function emptyIteratorProperties() {
  return { target: "", indexVariable: "i", prefixSubstitutions: "", children: "" };
}
function makeIteratorEditor(isRule) {
  const type = isRule ? "com.mirth.connect.model.IteratorRule" : "com.mirth.connect.model.IteratorStep";
  const childNoun = isRule ? "rule" : "step";
  function IteratorEditor({ element, onChange }) {
    const force = useRerender();
    if (!element.properties || typeof element.properties !== "object") {
      element.properties = emptyIteratorProperties();
    }
    const props = element.properties;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(
      Field,
      {
        label: "Iterate On (target)",
        hint: "E4X XML node list or JavaScript array to iterate over"
      },
      /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "text",
          placeholder: "msg['OBX']",
          value: props.target ?? "",
          onChange: (e) => {
            props.target = e.target.value;
            onChange();
            force();
          }
        }
      )
    ), /* @__PURE__ */ React.createElement(Field, { label: "Index Variable" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: props.indexVariable ?? "i",
        onChange: (e) => {
          props.indexVariable = e.target.value;
          onChange();
          force();
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(
      Field,
      {
        label: "Prefix Substitutions",
        hint: "One prefix per line \u2014 when dragging values into children, the index variable (e.g. [i]) is injected after these prefixes"
      },
      /* @__PURE__ */ React.createElement(
        "textarea",
        {
          rows: 3,
          placeholder: "msg['OBX']",
          value: stringListToLines(props.prefixSubstitutions).join("\n"),
          onChange: (e) => {
            props.prefixSubstitutions = linesToStringList(e.target.value);
            onChange();
            force();
          }
        }
      )
    ))), /* @__PURE__ */ React.createElement("div", { className: "text-text-faint pt-2.5 px-0 pb-0 text-[10px]" }, `Child ${childNoun}s appear nested under this Iterator in the ${childNoun} list. Add a ${childNoun} while a child is selected, or right-click a ${childNoun} and choose "Assign To Iterator".`));
  }
  return {
    label: "Iterator",
    create: () => ({
      __type: type,
      name: "",
      enabled: true,
      ...isRule ? { operator: "AND" } : null,
      properties: emptyIteratorProperties()
    }),
    validate: (el) => {
      const p = el.properties || {};
      let m = "";
      if (isBlank(p.target)) m += "The iteration target expression cannot be blank.\n";
      if (isBlank(p.indexVariable)) m += "The iteration index variable cannot be blank.\n";
      return m.trim();
    },
    component: IteratorEditor
  };
}
function MapperEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Variable" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.variable ?? "",
      onChange: (e) => {
        element.variable = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "Add to" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: SCOPES,
      value: element.scope || "CHANNEL",
      onChange: (e) => {
        element.scope = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Mapping" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.mapping ?? "",
      onChange: (e) => {
        element.mapping = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Default Value" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.defaultValue ?? "",
      onChange: (e) => {
        element.defaultValue = e.target.value;
        onChange();
        force();
      }
    }
  ))));
}
function MessageBuilderEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Message Segment" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "tmp['MSH']['MSH.3']['MSH.3.1']",
      value: element.messageSegment ?? "",
      onChange: (e) => {
        element.messageSegment = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Mapping" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.mapping ?? "",
      onChange: (e) => {
        element.mapping = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Default Value" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.defaultValue ?? "",
      onChange: (e) => {
        element.defaultValue = e.target.value;
        onChange();
        force();
      }
    }
  ))));
}
function XsltEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Source XML String" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg",
      value: element.sourceXml ?? "",
      onChange: (e) => {
        element.sourceXml = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "Result Variable" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      value: element.resultVariable ?? "",
      onChange: (e) => {
        element.resultVariable = e.target.value;
        onChange();
        force();
      }
    }
  ))), /* @__PURE__ */ React.createElement(Field, { label: "XSLT Template" }, /* @__PURE__ */ React.createElement(
    CodeEditorIsland,
    {
      value: element.template ?? "",
      minHeight: "220px",
      onChange: (value) => {
        element.template = value;
        onChange();
      }
    }
  )));
}
var dsfUid = 0;
function DestinationSetFilterEditor({ element, onChange, destinations }) {
  const force = useRerender();
  const [selValue, setSelValue] = React.useState(-1);
  const uid = React.useMemo(() => ++dsfUid, []);
  const dests = Array.isArray(destinations) ? destinations : [];
  const behavior = element.behavior || "REMOVE";
  const condition = element.condition || "EXISTS";
  const checked = checkedIdSet(element.metaDataIds);
  const values = stringListToLines(element.values);
  const listDisabled = behavior === "REMOVE_ALL";
  const valuesEnabled = CONDITION_USES_VALUES.has(condition);
  const setChecked = (next) => {
    element.metaDataIds = idSetToMetaData(next, dests);
    onChange();
    force();
  };
  const toggleId = (id, on) => {
    const next = new Set(checked);
    if (on) next.add(String(id));
    else next.delete(String(id));
    setChecked(next);
  };
  const selectAll = () => setChecked(new Set(dests.map((d) => String(d.metaDataId))));
  const deselectAll = () => setChecked(/* @__PURE__ */ new Set());
  const setValues = (arr) => {
    element.values = stringArrayToList(arr);
    onChange();
    force();
  };
  const newValue = () => {
    setValues([...values, ""]);
    setSelValue(values.length);
  };
  const editValue = (i, v) => {
    const next = values.slice();
    next[i] = v;
    setValues(next);
  };
  const deleteSelected = () => {
    if (selValue < 0 || selValue >= values.length) return;
    const next = values.slice();
    next.splice(selValue, 1);
    setValues(next);
    setSelValue(next.length ? Math.min(selValue, next.length - 1) : -1);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Behavior" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: BEHAVIORS,
      value: behavior,
      onChange: (e) => {
        element.behavior = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "Field" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg['PID']['PID.3']['PID.3.1'].toString()",
      value: element.field ?? "",
      onChange: (e) => {
        element.field = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Destinations" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mb-1.5" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: listDisabled, onClick: selectAll }, "Select All"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: listDisabled, onClick: deselectAll }, "Deselect All")), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "dt-wrap border border-line rounded max-h-[162px]",
      style: listDisabled ? { opacity: 0.5, pointerEvents: "none" } : void 0
    },
    /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "w-[38px]" }), /* @__PURE__ */ React.createElement("th", null, "Name"), /* @__PURE__ */ React.createElement("th", { className: "w-[63px]" }, "Id"))), /* @__PURE__ */ React.createElement("tbody", null, dests.length ? dests.map((d) => {
      const id = String(d.metaDataId);
      return /* @__PURE__ */ React.createElement("tr", { key: id }, /* @__PURE__ */ React.createElement("td", { className: "text-center" }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: checked.has(id),
          disabled: listDisabled,
          onChange: (e) => toggleId(id, e.target.checked)
        }
      )), /* @__PURE__ */ React.createElement("td", null, d.name || `Destination ${id}`), /* @__PURE__ */ React.createElement("td", { className: "num" }, id));
    }) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3 }, /* @__PURE__ */ React.createElement("span", { className: "text-text-faint" }, "No destinations on this channel")))))
  ))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Condition" }, /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, CONDITIONS.map((opt) => /* @__PURE__ */ React.createElement("label", { className: "check", key: opt.value }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "radio",
      name: `dsf-condition-${uid}`,
      checked: condition === opt.value,
      onChange: () => {
        element.condition = opt.value;
        onChange();
        force();
      }
    }
  ), opt.label))))), /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Values" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mb-1.5" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", disabled: !valuesEnabled, onClick: newValue }, "New"), /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "btn btn-sm btn-danger",
      disabled: !valuesEnabled || selValue < 0 || selValue >= values.length,
      onClick: deleteSelected
    },
    "Delete"
  )), /* @__PURE__ */ React.createElement(
    "div",
    {
      className: "dt-wrap border border-line rounded max-h-[162px]",
      style: !valuesEnabled ? { opacity: 0.5, pointerEvents: "none" } : void 0
    },
    /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Value"))), /* @__PURE__ */ React.createElement("tbody", null, values.length ? values.map((v, i) => /* @__PURE__ */ React.createElement(
      "tr",
      {
        key: i,
        className: selValue === i ? "selected" : void 0,
        onClick: () => setSelValue(i)
      },
      /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "text",
          value: v,
          disabled: !valuesEnabled,
          onFocus: () => setSelValue(i),
          onChange: (e) => editValue(i, e.target.value)
        }
      ))
    )) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "text-text-faint" }, "No values \u2014 use New")))))
  ))));
}
function RuleBuilderEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Field" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      placeholder: "msg['MSH']['MSH.9']['MSH.9.1'].toString()",
      value: element.field ?? "",
      onChange: (e) => {
        element.field = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(Field, { label: "Condition" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: CONDITIONS,
      value: element.condition || "EXISTS",
      onChange: (e) => {
        element.condition = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement("div", { className: "span-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Values" }, /* @__PURE__ */ React.createElement(
    "textarea",
    {
      rows: 4,
      placeholder: "One value per line",
      title: "Only used by Equals / Not Equal / Contains / Not Contain",
      value: stringListToLines(element.values).join("\n"),
      onChange: (e) => {
        element.values = linesToStringList(e.target.value);
        onChange();
        force();
      }
    }
  ))));
}
function register(platform2) {
  platform2.registerStepType("com.mirth.connect.plugins.javascriptstep.JavaScriptStep", {
    label: "JavaScript",
    create: () => ({
      __type: "com.mirth.connect.plugins.javascriptstep.JavaScriptStep",
      name: "",
      enabled: true,
      script: "// Write your JavaScript here\n"
    }),
    component: ScriptEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.mapper.MapperStep", {
    label: "Mapper",
    create: () => ({
      __type: "com.mirth.connect.plugins.mapper.MapperStep",
      name: "",
      enabled: true,
      variable: "",
      mapping: "",
      defaultValue: "",
      replacements: "",
      scope: "CHANNEL"
    }),
    validate: (el) => isBlank(el.variable) ? "The variable name cannot be blank." : "",
    component: MapperEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.messagebuilder.MessageBuilderStep", {
    label: "Message Builder",
    create: () => ({
      __type: "com.mirth.connect.plugins.messagebuilder.MessageBuilderStep",
      name: "",
      enabled: true,
      messageSegment: "",
      mapping: "",
      defaultValue: "",
      replacements: ""
    }),
    validate: (el) => isBlank(el.messageSegment) ? "The message segment value cannot be blank." : "",
    component: MessageBuilderEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.xsltstep.XsltStep", {
    label: "XSLT Step",
    create: () => ({
      __type: "com.mirth.connect.plugins.xsltstep.XsltStep",
      name: "",
      enabled: true,
      sourceXml: "",
      resultVariable: "",
      template: "",
      useCustomFactory: false,
      customFactory: ""
    }),
    validate: (el) => {
      let m = "";
      if (isBlank(el.sourceXml)) m += "The source XML string cannot be blank.\n";
      if (isBlank(el.resultVariable)) m += "The result variable cannot be blank.\n";
      return m.trim();
    },
    component: XsltEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep", {
    label: "Destination Set Filter",
    // Only available on the source transformer (DestinationSetFilterPlugin
    // .onlySourceConnector()); destinations/response transformers exclude it.
    onlySource: true,
    create: () => ({
      __type: "com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep",
      name: "",
      enabled: true,
      behavior: "REMOVE",
      metaDataIds: "",
      field: "",
      condition: "EXISTS",
      values: ""
    }),
    validate: (el) => isBlank(el.field) ? "The field cannot be blank." : "",
    component: DestinationSetFilterEditor
  });
  platform2.registerStepType("com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep", {
    label: "External Script",
    create: () => ({
      __type: "com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep",
      name: "",
      enabled: true,
      scriptPath: ""
    }),
    validate: (el) => isBlank(el.scriptPath) ? "The script path cannot be blank." : "",
    component: ScriptPathEditor
  });
  platform2.registerStepType("com.mirth.connect.model.IteratorStep", makeIteratorEditor(false));
  platform2.registerRuleType("com.mirth.connect.plugins.javascriptrule.JavaScriptRule", {
    label: "JavaScript",
    create: () => ({
      __type: "com.mirth.connect.plugins.javascriptrule.JavaScriptRule",
      name: "",
      enabled: true,
      operator: "AND",
      script: "// Return true to accept the message, false to filter it\nreturn true;"
    }),
    component: ScriptEditor
  });
  platform2.registerRuleType("com.mirth.connect.plugins.rulebuilder.RuleBuilderRule", {
    label: "Rule Builder",
    create: () => ({
      __type: "com.mirth.connect.plugins.rulebuilder.RuleBuilderRule",
      name: "",
      enabled: true,
      operator: "AND",
      field: "",
      condition: "EXISTS",
      values: ""
    }),
    validate: (el) => isBlank(el.field) ? "The field cannot be blank." : "",
    component: RuleBuilderEditor
  });
  platform2.registerRuleType("com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule", {
    label: "External Script",
    create: () => ({
      __type: "com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule",
      name: "",
      enabled: true,
      operator: "AND",
      scriptPath: ""
    }),
    validate: (el) => isBlank(el.scriptPath) ? "The script path cannot be blank." : "",
    component: ScriptPathEditor
  });
  platform2.registerRuleType("com.mirth.connect.model.IteratorRule", makeIteratorEditor(true));
}
export {
  register
};
