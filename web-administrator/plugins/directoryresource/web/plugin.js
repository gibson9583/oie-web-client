// plugins/directoryresource/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var DIRECTORY_RESOURCE_CLASS = "com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties";
function register(platform2) {
  function LoadedLibraries({ entry, api }) {
    const [state, setState] = React.useState({ phase: "loading", libs: [] });
    const id = entry.obj.id;
    React.useEffect(() => {
      let cancelled = false;
      setState({ phase: "loading", libs: [] });
      (async () => {
        try {
          const raw = await api.get(`/extensions/directoryresource/resources/${encodeURIComponent(id)}/libraries`);
          const libs = api.asList(raw, "string").map(String).filter((s) => s !== "");
          if (cancelled) return;
          setState({ phase: "ready", libs });
        } catch (e) {
          if (cancelled) return;
          setState({ phase: "error", libs: [] });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id]);
    if (state.phase === "loading") {
      return /* @__PURE__ */ React.createElement("div", { className: "loading-block" }, /* @__PURE__ */ React.createElement("div", { className: "spinner" }), "Loading libraries\u2026");
    }
    if (state.phase === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "faint" }, "Library list unavailable");
    }
    if (!state.libs.length) {
      return /* @__PURE__ */ React.createElement("div", { className: "faint" }, "No libraries loaded");
    }
    return /* @__PURE__ */ React.createElement("ul", { style: {
      margin: "0",
      paddingLeft: "18px",
      maxHeight: "180px",
      overflow: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: "12px"
    } }, state.libs.map((l, i) => /* @__PURE__ */ React.createElement("li", { key: `${i}-${l}` }, l)));
  }
  function DirectoryDetail({ entry, locked, platform: platform3, refreshTable }) {
    const obj = entry.obj;
    const [name, setName] = React.useState(obj.name || "");
    const [directory, setDirectory] = React.useState(obj.directory || "");
    const [recursion, setRecursion] = React.useState(obj.directoryRecursion !== false);
    const [description, setDescription] = React.useState(obj.description || "");
    return /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Name"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: name,
        disabled: locked,
        onInput: (e) => {
          obj.name = e.target.value;
          setName(e.target.value);
        },
        onChange: (e) => {
          obj.name = e.target.value;
          setName(e.target.value);
        },
        onBlur: () => {
          if (refreshTable) refreshTable();
        }
      }
    ), locked ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, "The Default Resource cannot be renamed") : null), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Directory"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        value: directory,
        disabled: locked,
        onInput: (e) => {
          obj.directory = e.target.value;
          setDirectory(e.target.value);
        },
        onChange: (e) => {
          obj.directory = e.target.value;
          setDirectory(e.target.value);
        }
      }
    ), locked ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, "The Default Resource directory cannot be changed") : null), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Subdirectories"), /* @__PURE__ */ React.createElement("label", { className: "check" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: recursion,
        onChange: (e) => {
          obj.directoryRecursion = e.target.checked;
          setRecursion(e.target.checked);
        }
      }
    ), "Include All Subdirectories")), /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "Description"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        value: description,
        onInput: (e) => {
          obj.description = e.target.value;
          setDescription(e.target.value);
        },
        onChange: (e) => {
          obj.description = e.target.value;
          setDescription(e.target.value);
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "Loaded Libraries"), /* @__PURE__ */ React.createElement(LoadedLibraries, { entry, api: platform3.api })));
  }
  platform2.registerResourceType("Directory", {
    type: "Directory",
    label: "Directory",
    propertiesClass: DIRECTORY_RESOURCE_CLASS,
    detailHeader: "Directory Settings",
    /* New directory resource. ctx: { version, containerIsArray } — version
       mirrors an existing entry so the engine doesn't migrate from scratch;
       the @class is only needed for the array-shaped container. */
    create({ version, containerIsArray }) {
      const obj = {};
      if (version) obj["@version"] = version;
      if (containerIsArray) obj["@class"] = DIRECTORY_RESOURCE_CLASS;
      obj.pluginPointName = "Directory Resource";
      obj.type = "Directory";
      obj.id = crypto.randomUUID();
      obj.name = "";
      obj.description = "";
      obj.includeWithGlobalScripts = false;
      obj.loadParentFirst = false;
      obj.directory = "";
      obj.directoryRecursion = true;
      return obj;
    },
    // The detail editor is now a React component (was renderDetail(host, ctx));
    // the Resources panel renders <def.component {...ctx}/> via <PluginSlot>.
    component: DirectoryDetail
  });
}
export {
  register
};
