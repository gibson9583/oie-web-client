import { React, useRef, useEffect } from "./react-platform.js";
import { toast, createCodeEditor } from "@oie/web-ui";
import { frameModeSampleFrame, frameModeSettingsDialog } from "./forms.js";
function GenericPanel({ properties, onChange }) {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  useEffect(() => {
    const editor = createCodeEditor({
      value: JSON.stringify(properties, null, 2),
      language: "text",
      minHeight: "320px"
    });
    editorRef.current = editor;
    hostRef.current.appendChild(editor.el);
    return () => {
      try {
        editor.dispose && editor.dispose();
      } catch {
      }
      editorRef.current = null;
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, []);
  const apply = () => {
    let parsed;
    try {
      parsed = JSON.parse(editorRef.current.getValue());
    } catch (e) {
      toast("Invalid JSON: " + e.message, "error");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      toast("Properties must be a JSON object", "error");
      return;
    }
    for (const key of Object.keys(properties)) {
      if (!(key in parsed)) delete properties[key];
    }
    Object.assign(properties, parsed);
    onChange();
    toast("Properties applied");
  };
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "hint", style: { marginBottom: "6px" } }, 'No dedicated editor for this connector type \u2014 edit the raw properties JSON. "@class" and "@version" must be preserved.'), /* @__PURE__ */ React.createElement("div", { ref: hostRef }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "8px" } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: apply }, "Apply")));
}
function genericPanel() {
  return {
    defaults(version) {
      return { "@version": version };
    },
    component: GenericPanel
  };
}
function register(platform) {
  platform.registerConnectorPanel("*", "SOURCE", genericPanel());
  platform.registerConnectorPanel("*", "DESTINATION", genericPanel());
  platform.registerTransmissionMode("Basic", {
    label: "Basic TCP",
    order: 20,
    apply(tm) {
      tm.pluginPointName = "Basic";
      tm.startOfMessageBytes = "";
      tm.endOfMessageBytes = "";
    },
    sampleFrame: frameModeSampleFrame,
    openSettings: frameModeSettingsDialog
  });
}
export {
  register
};
