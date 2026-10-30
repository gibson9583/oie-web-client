// plugins/transformer-steps/web/plugin.tsx
import { platform } from "@oie/web-shell";
import { iteratorTree, iteratorSampleCount } from "/core/mapping-model.js";
import { replacementPairs, replacementsToWire } from "/core/step-replacements.js";
var React = platform.React;
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
function StringReplacementEditor({ element, onChange }) {
  const [rows, setRows] = React.useState(() => replacementPairs(element));
  const [selected, setSelected] = React.useState(-1);
  const commit = (next) => {
    element.replacements = replacementsToWire(next);
    setRows(next);
    onChange();
  };
  const edit = (index, side, value) => {
    const next = rows.map((row) => [...row]);
    next[index][side] = value;
    commit(next);
  };
  return /* @__PURE__ */ React.createElement("div", { className: "span-2 mt-2 min-w-0", role: "group", "aria-label": "String Replacement" }, /* @__PURE__ */ React.createElement(Field, { label: "String Replacement" }, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mb-1.5" }, /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm", onClick: () => {
    commit([...rows, ["", ""]]);
    setSelected(rows.length);
  } }, "New"), /* @__PURE__ */ React.createElement("button", { type: "button", className: "btn btn-sm btn-danger", disabled: selected < 0 || selected >= rows.length, onClick: () => {
    const next = rows.filter((_, i) => i !== selected);
    commit(next);
    setSelected(next.length ? Math.min(selected, next.length - 1) : -1);
  } }, "Delete")), /* @__PURE__ */ React.createElement("div", { className: "dt-wrap border border-line rounded max-h-[260px]" }, /* @__PURE__ */ React.createElement("table", { className: "dt w-full table-fixed", "aria-label": "String replacements" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Regular Expression"), /* @__PURE__ */ React.createElement("th", { scope: "col" }, "Replace With"))), /* @__PURE__ */ React.createElement("tbody", null, rows.length ? rows.map((row, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: selected === i ? "selected" : void 0, onClick: () => setSelected(i) }, row.map((value, side) => /* @__PURE__ */ React.createElement("td", { key: side }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      spellCheck: false,
      "aria-label": `${side === 0 ? "Regular Expression" : "Replace With"} ${i + 1}`,
      value,
      onFocus: () => setSelected(i),
      onChange: (e) => edit(i, side, e.target.value)
    }
  ))))) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 2 }, /* @__PURE__ */ React.createElement("span", { className: "text-text-faint" }, "No replacements \u2014 use New"))))))));
}
var mapUid = 0;
var SCOPE_CARDS = [
  { value: "CONNECTOR", label: "Connector Map", hint: "This connector, this message", read: "$co" },
  { value: "CHANNEL", label: "Channel Map", hint: "All connectors, this message", read: "$c" },
  { value: "GLOBAL_CHANNEL", label: "Global Channel Map", hint: "Shared across messages in this channel. Clearing on deploy depends on channel settings.", read: "$gc" },
  { value: "GLOBAL", label: "Global Map", hint: "Shared across channels. Clearing on server start depends on server settings.", read: "$g" },
  { value: "RESPONSE", label: "Response Map", hint: "Response variables, this message", read: "$r" }
];
var VAR_FNS = [
  { value: "$c", label: "Channel" },
  { value: "$co", label: "Connector" },
  { value: "$gc", label: "Global Channel" },
  { value: "$g", label: "Global" },
  { value: "$r", label: "Response" },
  { value: "$s", label: "Source" },
  { value: "$cfg", label: "Configuration" },
  { value: "$", label: "Any map" }
];
var VALUE_MODES = [
  { value: "field", label: "Message field" },
  { value: "text", label: "Text" },
  { value: "variable", label: "Variable" },
  { value: "js", label: "{ } JavaScript" }
];
var INBOUND_PATH_RE = /^msg(?:\[(?:'(?:[^'\\]|\\.)*'|\d+|[A-Za-z_$][\w$]*)\])+(?:\.toString\(\))?$/;
var VARIABLE_RE = /^(\$(?:gc|co|cfg|g|c|r|s)?)\(\s*'((?:[^'\\]|\\.)*)'\s*\)$/;
function literalValue(expr) {
  const m = /^(['"])((?:\\.|(?!\1)[^\\\n])*)\1$/.exec(String(expr ?? "").trim());
  if (!m) return null;
  return m[2].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_all, c) => {
    if (c[0] === "u" || c[0] === "x") return c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : c;
    return { n: "\n", t: "	", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }[c] ?? c;
  });
}
function quoted(value) {
  return `'${String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}'`;
}
function parseValue(src) {
  const s = String(src ?? "").trim();
  if (!s) return { mode: "" };
  if (INBOUND_PATH_RE.test(s)) return { mode: "field", field: s };
  const lit = literalValue(s);
  if (lit !== null) return { mode: "text", text: lit };
  const v = VARIABLE_RE.exec(s);
  if (v) return { mode: "variable", fn: v[1], name: literalValue(`'${v[2]}'`) ?? v[2] };
  return { mode: "js" };
}
function flattenTree(nodes, parent = null, out = []) {
  for (const n of nodes || []) {
    out.push({ node: n, parent });
    flattenTree(n.children, n, out);
  }
  return out;
}
function fieldLabel({ node, parent }) {
  const lone = parent?.desc && parent.children.length === 1 && node.name === `${parent.name}.1` && !node.children.length;
  return lone ? `${node.name} (${parent.desc})` : node.label;
}
function useMessageTree(messageTree, side, revision = 0) {
  const [nodes, setNodes] = React.useState(void 0);
  React.useEffect(() => {
    if (typeof messageTree !== "function") return void 0;
    let alive = true;
    setNodes(void 0);
    Promise.resolve().then(() => messageTree(side)).then((n) => {
      if (alive) setNodes(n || null);
    }, () => {
      if (alive) setNodes(null);
    });
    return () => {
      alive = false;
    };
  }, [messageTree, side, revision]);
  return nodes;
}
function PathPicker({ MessageFieldPicker, nodes, title, value, onPick, onClose, messageSide, onMessageSide, onRetry }) {
  const boxRef = React.useRef(null);
  React.useEffect(() => {
    boxRef.current.scrollIntoView({ block: "nearest" });
  }, []);
  React.useEffect(() => {
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) onClose();
    };
    const esc = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return /* @__PURE__ */ React.createElement("div", { className: "map-picker", ref: boxRef, role: "dialog", "aria-label": title }, /* @__PURE__ */ React.createElement(MessageFieldPicker, { side: messageSide, onSide: onMessageSide, nodes, value, onPick, onRetry }));
}
function FieldInput({ value, nodes, side, placeholder, ariaLabel, onValue, targetTrees, onRetry, MessageFieldPicker }) {
  const [open, setOpen] = React.useState(false);
  const targetSide = /^\s*tmp\b/.test(value) ? "outbound" : "inbound";
  const [browseSide, setBrowseSide] = React.useState(targetSide);
  const close = React.useCallback(() => setOpen(false), []);
  const selected = flattenTree((targetTrees ? targetTrees[targetSide] : nodes) || []).find(({ node }) => String(node.accessor).replace(/\.toString\(\)\s*$/, "") === String(value).replace(/\.toString\(\)\s*$/, ""));
  return /* @__PURE__ */ React.createElement("div", { className: "map-field" }, /* @__PURE__ */ React.createElement(
    "button",
    {
      type: "button",
      className: "map-field-choice",
      "aria-expanded": open,
      title: selected ? `${fieldLabel(selected)}
${value}` : value,
      "aria-label": `Browse ${targetTrees ? "target" : side} fields`,
      onClick: () => {
        if (!open) setBrowseSide(targetSide);
        setOpen((o) => !o);
      }
    },
    /* @__PURE__ */ React.createElement("span", null, selected ? `${targetTrees ? `${targetSide === "outbound" ? "tmp" : "msg"} \u203A ` : ""}${fieldLabel(selected)}` : value || "Choose a field\u2026"),
    /* @__PURE__ */ React.createElement("span", null, "Browse\u2026")
  ), /* @__PURE__ */ React.createElement("details", { className: "map-raw-path" }, /* @__PURE__ */ React.createElement("summary", null, "Edit path expression"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "mono",
      placeholder,
      "aria-label": ariaLabel,
      "data-message-target": targetTrees ? true : void 0,
      value,
      onChange: (e) => onValue(e.target.value)
    }
  )), open && MessageFieldPicker ? /* @__PURE__ */ React.createElement(
    PathPicker,
    {
      MessageFieldPicker,
      nodes: targetTrees ? targetTrees[browseSide] : nodes,
      title: targetTrees ? "Target fields" : side === "outbound" ? "Outbound fields" : "Inbound fields",
      onClose: close,
      value,
      messageSide: targetTrees ? browseSide : side,
      onMessageSide: targetTrees ? setBrowseSide : void 0,
      onRetry,
      onPick: (node) => {
        const acc = String(node.accessor);
        onValue(targetTrees || side === "outbound" ? acc.replace(/\.toString\(\)\s*$/, "") : acc);
        setOpen(false);
      }
    }
  ) : null);
}
function ValueEditor({ element, onChange, inbound, variables, defaultMode, onRetry, MessageFieldPicker }) {
  const force = useRerender();
  const initial = React.useMemo(() => parseValue(element.mapping), []);
  const [mode, setMode] = React.useState(initial.mode || defaultMode);
  const drafts = React.useRef({
    field: initial.mode === "field" ? initial.field : "",
    text: initial.mode === "text" ? initial.text : "",
    fn: initial.mode === "variable" ? initial.fn : "$c",
    name: initial.mode === "variable" ? initial.name : "",
    js: String(element.mapping ?? "")
  }).current;
  const vars = typeof variables === "function" ? variables() : [];
  const listId = React.useMemo(() => `map-vars-${++mapUid}`, []);
  const expr = (m) => {
    if (m === "field") return drafts.field;
    if (m === "text") return quoted(drafts.text);
    if (m === "variable") return drafts.name ? `${drafts.fn}(${quoted(drafts.name)})` : "";
    return drafts.js;
  };
  const write = (m) => {
    element.mapping = expr(m);
    if (m !== "js") drafts.js = element.mapping;
    onChange();
    force();
  };
  const setDraft = (key, v, m) => {
    drafts[key] = v;
    write(m);
  };
  const setters = vars.filter((v) => v.name === drafts.name);
  return /* @__PURE__ */ React.createElement("div", { className: "map-value" }, /* @__PURE__ */ React.createElement(
    "select",
    {
      "aria-label": "Value type",
      value: mode,
      onChange: (e) => {
        const m = e.target.value;
        if (m === mode) return;
        setMode(m);
        write(m);
      }
    },
    VALUE_MODES.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))
  ), mode === "field" && /* @__PURE__ */ React.createElement(
    FieldInput,
    {
      value: drafts.field,
      nodes: inbound,
      side: "inbound",
      ariaLabel: "Message field",
      onRetry,
      MessageFieldPicker,
      placeholder: "msg['PID']['PID.3']['PID.3.1'].toString()",
      onValue: (v) => setDraft("field", v, "field")
    }
  ), mode === "text" && /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      "aria-label": "Text value",
      placeholder: "Fixed text",
      value: drafts.text,
      onChange: (e) => setDraft("text", e.target.value, "text")
    }
  ), mode === "variable" && /* @__PURE__ */ React.createElement("div", { className: "map-field-row" }, /* @__PURE__ */ React.createElement("select", { "aria-label": "Map", value: drafts.fn, onChange: (e) => setDraft("fn", e.target.value, "variable") }, VAR_FNS.map((f) => /* @__PURE__ */ React.createElement("option", { key: f.value, value: f.value }, f.label))), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "mono",
      "aria-label": "Variable name",
      placeholder: "variableName",
      list: listId,
      value: drafts.name,
      onChange: (e) => setDraft("name", e.target.value, "variable")
    }
  ), /* @__PURE__ */ React.createElement("datalist", { id: listId }, [...new Set(vars.map((v) => v.name))].map((n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n })))), mode === "variable" && drafts.name && /* @__PURE__ */ React.createElement("div", { className: "hint" }, setters.length ? `Set by step ${setters.map((v) => v.step).join(", ")}` : "Not set by another step in this transformer."), mode === "js" && /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "mono",
      "aria-label": "JavaScript value",
      placeholder: "Any JavaScript expression",
      value: drafts.js,
      onChange: (e) => setDraft("js", e.target.value, "js")
    }
  ));
}
function MappingEditor({ element, onChange, messageTree, MessageFieldPicker, variables, iteratorContext, builder = false }) {
  const [, bumpRev] = React.useReducer((x) => x + 1, 0);
  const [iteratorIndices, setIndices] = React.useState({});
  const [treeRevision, reloadTrees] = React.useReducer((x) => x + 1, 0);
  const reloadFields = () => {
    reloadTrees();
    bumpRev();
  };
  const inbound = useMessageTree(messageTree, "inbound", treeRevision);
  const outbound = useMessageTree(builder ? messageTree : null, "outbound", treeRevision);
  const contexts = typeof iteratorContext === "function" ? iteratorContext() : [];
  const sampleOptions = { iteratorIndices };
  const pickedInbound = iteratorTree(inbound, contexts, sampleOptions);
  const pickedOutbound = iteratorTree(outbound, contexts, sampleOptions);
  const change = () => {
    onChange();
    bumpRev();
  };
  const name = String(element.variable ?? "");
  const scope = element.scope || "CHANNEL";
  const card = SCOPE_CARDS.find((s) => s.value === scope);
  const dupes = !builder && typeof variables === "function" && name.trim() ? variables().filter((v) => v.name === name.trim()) : [];
  const summary = [
    !builder ? card?.label || scope : "",
    replacementPairs(element).length ? `${replacementPairs(element).length} replacement(s)` : ""
  ].filter(Boolean).join(" \xB7 ");
  return /* @__PURE__ */ React.createElement("div", { className: "map-editor" }, contexts.length ? /* @__PURE__ */ React.createElement("div", { className: "map-iterator-context", "aria-label": "Iterator context" }, contexts.map((context, i) => {
    const count = iteratorSampleCount(inbound, context, contexts, sampleOptions);
    const index = iteratorIndices[context.indexVariable] ?? 0;
    return /* @__PURE__ */ React.createElement("div", { key: `${i}:${context.indexVariable}` }, /* @__PURE__ */ React.createElement("span", { title: context.target }, "Inside ", /* @__PURE__ */ React.createElement("b", null, context.name), " \xB7 index ", /* @__PURE__ */ React.createElement("code", null, context.indexVariable)), count !== null && count > 0 ? /* @__PURE__ */ React.createElement(
      "select",
      {
        "aria-label": `Sample for ${context.name}`,
        value: index,
        onChange: (e) => {
          const next = { ...iteratorIndices, [context.indexVariable]: Number(e.target.value) };
          for (const child of contexts.slice(i + 1)) delete next[child.indexVariable];
          setIndices(next);
        }
      },
      Array.from({ length: count }, (_, n) => /* @__PURE__ */ React.createElement("option", { key: n, value: n }, `Sample ${n + 1} of ${count}`))
    ) : /* @__PURE__ */ React.createElement("span", { className: "hint" }, count === 0 ? "No template repetitions" : "Sample unavailable"));
  })) : null, builder ? /* @__PURE__ */ React.createElement(Field, { label: "Step name" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      "aria-label": "Step name",
      placeholder: "Uses the target path",
      value: element.name ?? "",
      onChange: (e) => {
        element.name = e.target.value;
        change();
      }
    }
  )) : null, /* @__PURE__ */ React.createElement(Field, { label: builder ? "Target field" : "Variable name" }, builder ? /* @__PURE__ */ React.createElement(
    FieldInput,
    {
      value: element.messageSegment ?? "",
      targetTrees: { inbound: pickedInbound, outbound: pickedOutbound },
      onRetry: reloadFields,
      MessageFieldPicker,
      ariaLabel: "Message Segment",
      placeholder: "msg['PID']['PID.5']['PID.5.1']",
      onValue: (value) => {
        element.messageSegment = value;
        change();
      }
    }
  ) : /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "mono",
      "aria-label": "Variable",
      placeholder: "variableName",
      value: name,
      onChange: (e) => {
        element.variable = e.target.value;
        element.name = e.target.value;
        change();
      }
    }
  ), builder ? isBlank(element.messageSegment) ? /* @__PURE__ */ React.createElement("div", { className: "hint map-warn" }, "The message segment value cannot be blank.") : null : isBlank(name) ? /* @__PURE__ */ React.createElement("div", { className: "hint map-warn" }, "The variable name cannot be blank.") : dupes.length ? /* @__PURE__ */ React.createElement("div", { className: "hint map-warn" }, `Also set by step ${dupes.map((v) => v.step).join(", ")}.`) : null), /* @__PURE__ */ React.createElement(Field, { label: "Value" }, /* @__PURE__ */ React.createElement(ValueEditor, { element, onChange: change, inbound: pickedInbound, variables, defaultMode: "field", onRetry: reloadFields, MessageFieldPicker })), /* @__PURE__ */ React.createElement(Field, { label: "Default" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "text",
      className: "mono",
      "aria-label": "Default Value",
      value: element.defaultValue ?? "",
      onChange: (e) => {
        element.defaultValue = e.target.value;
        change();
      }
    }
  )), !builder && contexts.length ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, "This Mapper stores an array of iteration results.") : null, /* @__PURE__ */ React.createElement("details", { className: "map-more-options" }, /* @__PURE__ */ React.createElement("summary", null, "More options ", /* @__PURE__ */ React.createElement("span", { className: "hint" }, summary)), /* @__PURE__ */ React.createElement("div", { className: "map-options-body" }, !builder ? /* @__PURE__ */ React.createElement(Field, { label: "Store in" }, /* @__PURE__ */ React.createElement("select", { "aria-label": "Add to", value: scope, onChange: (e) => {
    element.scope = e.target.value;
    change();
  } }, !card ? /* @__PURE__ */ React.createElement("option", { value: scope }, scope) : null, SCOPE_CARDS.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.value, value: s.value }, s.label))), /* @__PURE__ */ React.createElement("div", { className: "hint" }, card?.hint)) : null, /* @__PURE__ */ React.createElement(StringReplacementEditor, { element, onChange: change }), /* @__PURE__ */ React.createElement("div", { className: "hint" }, "Expressions applied in order after the default. Include quotes around literal patterns and text."))));
}
function MapperEditor(props) {
  return /* @__PURE__ */ React.createElement(MappingEditor, { ...props });
}
function MessageBuilderEditor(props) {
  return /* @__PURE__ */ React.createElement(MappingEditor, { ...props, builder: true });
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
