// plugins/transformer-steps/web/plugin.jsx
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
  { value: "REMOVE", label: "Remove the following destinations" },
  { value: "REMOVE_ALL_EXCEPT", label: "Remove all except the following destinations" },
  { value: "REMOVE_ALL", label: "Remove all destinations" }
];
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
function intListToText(value) {
  if (!value || typeof value !== "object") return "";
  const list = value.int;
  if (list === null || list === void 0) return "";
  return (Array.isArray(list) ? list : [list]).join(", ");
}
function textToIntList(text) {
  const ids = String(text || "").split(/[,\s]+/).map((s) => s.trim()).filter((s) => s !== "" && !isNaN(Number(s))).map((s) => String(parseInt(s, 10)));
  return ids.length ? { int: ids } : "";
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
    ))), /* @__PURE__ */ React.createElement("div", { className: "text-text-faint pt-2.5 px-0 pb-0 text-[11px]" }, `Child ${childNoun}s appear nested under this Iterator in the ${childNoun} list. Add a ${childNoun} while a child is selected, or right-click a ${childNoun} and choose "Assign To Iterator".`));
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
      placeholder: "msg['MSH']['MSH.3']['MSH.3.1'].toString()",
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
function DestinationSetFilterEditor({ element, onChange }) {
  const force = useRerender();
  return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Behavior" }, /* @__PURE__ */ React.createElement(
    Select,
    {
      options: BEHAVIORS,
      value: element.behavior || "REMOVE",
      onChange: (e) => {
        element.behavior = e.target.value;
        onChange();
        force();
      }
    }
  )), /* @__PURE__ */ React.createElement(
    Field,
    {
      label: "Destination Meta Data Ids",
      hint: "Comma-separated destination metaDataIds this filter applies to"
    },
    /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        placeholder: "e.g. 1, 2",
        value: intListToText(element.metaDataIds),
        onChange: (e) => {
          element.metaDataIds = textToIntList(e.target.value);
          onChange();
          force();
        }
      }
    )
  ), /* @__PURE__ */ React.createElement(Field, { label: "Field" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
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
    component: ScriptPathEditor
  });
  platform2.registerRuleType("com.mirth.connect.model.IteratorRule", makeIteratorEditor(true));
}
export {
  register
};
