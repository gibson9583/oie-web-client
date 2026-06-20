// plugins/datapruner/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PRUNER_STATUS_ORDER = ["currentState", "currentProcess", "lastProcess", "nextProcess", "isRunning"];
function register(platform2) {
  const { taskButton, toast, confirmDialog } = platform2.ui;
  const api = platform2.api;
  function labelCase(key) {
    const s = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function propsToList(raw) {
    const list = [];
    if (!raw || typeof raw !== "object") return list;
    if (raw.property !== void 0) {
      for (const p of api.asList(raw.property)) {
        if (!p || typeof p !== "object") continue;
        list.push({ name: String(p["@name"] ?? p.name ?? ""), value: p.$ ?? p.value ?? "" });
      }
      return list;
    }
    if (raw.entry !== void 0) {
      for (const e of api.asList(raw.entry)) {
        if (!e || typeof e !== "object") continue;
        const s = e.string;
        if (Array.isArray(s)) list.push({ name: String(s[0] ?? ""), value: s.length > 1 ? s[1] : "" });
        else {
          const vals = Object.values(e);
          list.push({ name: String(vals[0] ?? ""), value: vals.length > 1 ? vals[1] : "" });
        }
      }
      return list;
    }
    for (const [name, value] of Object.entries(raw)) {
      if (name.startsWith("@")) continue;
      list.push({ name, value });
    }
    return list;
  }
  function listToProps(list) {
    return { property: list.map((p) => ({ "@name": p.name, $: String(p.value ?? "") })) };
  }
  function statusPairs(raw) {
    const pairs = [];
    if (raw && typeof raw === "object" && raw.entry !== void 0) {
      for (const e of api.asList(raw.entry)) {
        if (!e || typeof e !== "object") continue;
        const s = e.string;
        if (Array.isArray(s)) pairs.push([String(s[0] ?? ""), s.length > 1 ? String(s[1] ?? "") : ""]);
        else if (s !== void 0) pairs.push([String(s), ""]);
      }
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("@")) continue;
        pairs.push([k, String(v ?? "")]);
      }
    }
    pairs.sort((a, b) => {
      const ia = PRUNER_STATUS_ORDER.indexOf(a[0]), ib = PRUNER_STATUS_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return pairs;
  }
  function YesNo({ value, onChange, disabled }) {
    const name = React.useMemo(() => "datapruner-rg-" + Math.random().toString(36).slice(2), []);
    return /* @__PURE__ */ React.createElement("div", { className: "radio-group inline" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name,
        value: "yes",
        checked: value === true,
        disabled,
        onChange: () => onChange(true)
      }
    ), " Yes"), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "radio",
        name,
        value: "no",
        checked: value === false,
        disabled,
        onChange: () => onChange(false)
      }
    ), " No"));
  }
  function Field({ label, hint, children }) {
    return /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, label), children, hint ? /* @__PURE__ */ React.createElement("div", { className: "hint" }, hint) : null);
  }
  function Loading({ text = "Loading\u2026" }) {
    return /* @__PURE__ */ React.createElement("div", { className: "loading-block" }, /* @__PURE__ */ React.createElement("div", { className: "spinner" }), text);
  }
  function DataPrunerPanel({ platform: platform3, setTasks }) {
    const [phase, setPhase] = React.useState("loading");
    const [errorMessage, setErrorMessage] = React.useState("");
    const [statusState, setStatusState] = React.useState({ phase: "loading", pairs: [], message: "" });
    const propListRef = React.useRef([]);
    const scheduleRef = React.useRef(null);
    const [enabled, setEnabled] = React.useState(false);
    const [blockSize, setBlockSize] = React.useState("");
    const [pruneEvents, setPruneEvents] = React.useState(false);
    const [maxEventAge, setMaxEventAge] = React.useState("");
    const [archiveEnabled, setArchiveEnabled] = React.useState(false);
    const [archiverBlockSize, setArchiverBlockSize] = React.useState("");
    const [includeAttachments, setIncludeAttachments] = React.useState(null);
    const [scheduleType, setScheduleType] = React.useState("INTERVAL");
    const [freqValue, setFreqValue] = React.useState("");
    const [freqUnit, setFreqUnit] = React.useState("minutes");
    const [scheduleDirty, setScheduleDirty] = React.useState(false);
    const [hasSchedule, setHasSchedule] = React.useState(false);
    const getProp = (name, dflt = "") => {
      const p = propListRef.current.find((x) => x.name === name);
      return p === void 0 ? dflt : String(p.value ?? "");
    };
    const setProp = (name, value) => {
      const p = propListRef.current.find((x) => x.name === name);
      if (p) p.value = value;
      else propListRef.current.push({ name, value });
    };
    function buildSchedule() {
      scheduleRef.current = null;
      const xml = getProp("pollingProperties");
      if (!xml || xml.trim() === "" || xml.trim()[0] !== "<") return false;
      let doc = null;
      try {
        doc = new DOMParser().parseFromString(xml, "text/xml");
      } catch (e) {
        return false;
      }
      if (!doc || doc.querySelector("parsererror")) return false;
      const typeEl = doc.documentElement.querySelector("pollingType");
      if (!typeEl) return false;
      const freqEl = doc.documentElement.querySelector("pollingFrequency");
      const freqMs = parseInt(freqEl ? freqEl.textContent : "", 10) || 0;
      let unit = "minutes";
      let val = freqMs / 6e4;
      if (freqMs > 0 && freqMs % 36e5 === 0) {
        unit = "hours";
        val = freqMs / 36e5;
      }
      scheduleRef.current = { doc, typeEl, freqEl };
      setScheduleType(typeEl.textContent.trim());
      setFreqValue(val || "");
      setFreqUnit(unit);
      setScheduleDirty(false);
      return true;
    }
    function applyPropsToForm() {
      setEnabled(getProp("enabled") === "true");
      setBlockSize(getProp("pruningBlockSize"));
      setPruneEvents(getProp("pruneEvents") === "true");
      setMaxEventAge(getProp("maxEventAge"));
      setArchiveEnabled(getProp("archiveEnabled") === "true");
      setArchiverBlockSize(getProp("archiverBlockSize"));
      const incAttachMatch = /^<boolean>(true|false)<\/boolean>$/.exec(getProp("includeAttachments").trim());
      setIncludeAttachments(incAttachMatch ? incAttachMatch[1] === "true" : null);
      setHasSchedule(buildSchedule());
    }
    async function refreshStatus() {
      try {
        const raw = await api.get("/extensions/datapruner/status");
        setStatusState({ phase: "ready", pairs: statusPairs(raw), message: "" });
      } catch (e) {
        setStatusState({ phase: "error", pairs: [], message: `Status unavailable: ${e.message}` });
      }
    }
    async function load() {
      setPhase("loading");
      try {
        propListRef.current = propsToList(await api.extensions.properties("Data Pruner"));
      } catch (e) {
        toast(`Failed to load Data Pruner properties: ${e.message}`, "error");
        setErrorMessage(String(e.message || e));
        setPhase("error");
        return;
      }
      applyPropsToForm();
      setPhase("ready");
      refreshStatus();
    }
    async function save() {
      try {
        setProp("enabled", String(enabled));
        setProp("pruningBlockSize", blockSize);
        setProp("pruneEvents", String(pruneEvents));
        setProp("maxEventAge", maxEventAge);
        setProp("archiveEnabled", String(archiveEnabled));
        setProp("archiverBlockSize", archiverBlockSize);
        if (includeAttachments !== null) {
          setProp("includeAttachments", `<boolean>${includeAttachments}</boolean>`);
        }
        const schedule2 = scheduleRef.current;
        if (schedule2 && scheduleDirty) {
          schedule2.typeEl.textContent = scheduleType;
          if (schedule2.freqEl && scheduleType === "INTERVAL") {
            const unitMs = freqUnit === "hours" ? 36e5 : 6e4;
            const ms = Math.round((parseFloat(freqValue) || 0) * unitMs);
            if (ms > 0) schedule2.freqEl.textContent = String(ms);
          }
          setProp("pollingProperties", new XMLSerializer().serializeToString(schedule2.doc));
        }
        await api.extensions.setProperties("Data Pruner", listToProps(propListRef.current));
        toast("Data Pruner settings saved");
      } catch (e) {
        toast(`Save failed: ${e.message}`, "error");
      }
    }
    async function pruneNow() {
      if (await confirmDialog("Prune Now", "Start the Data Pruner now? Pruning may take a long time on large message stores.", { okLabel: "Start" })) {
        try {
          await api.post("/extensions/datapruner/_start");
          toast("Data Pruner started");
        } catch (e) {
          toast(`Start failed: ${e.message}`, "error");
        }
        refreshStatus();
      }
    }
    async function stopPruner() {
      try {
        await api.post("/extensions/datapruner/_stop");
        toast("Stop requested");
      } catch (e) {
        toast(`Stop failed: ${e.message}`, "error");
      }
      refreshStatus();
    }
    React.useEffect(() => {
      load();
    }, []);
    React.useEffect(() => {
      setTasks("Data Pruner Tasks", [
        taskButton("Refresh", "refresh", () => {
          load();
        }),
        taskButton("Save", "save", save, { primary: true }),
        taskButton("View Events", "events", () => platform3.router.navigate("/events")),
        taskButton("Prune Now", "play", pruneNow),
        taskButton("Stop Pruner", "stop", stopPruner, { danger: true })
      ]);
    }, [
      enabled,
      blockSize,
      pruneEvents,
      maxEventAge,
      archiveEnabled,
      archiverBlockSize,
      includeAttachments,
      scheduleType,
      freqValue,
      freqUnit,
      scheduleDirty
    ]);
    if (phase === "loading") return /* @__PURE__ */ React.createElement(Loading, null);
    if (phase === "error") {
      return /* @__PURE__ */ React.createElement("div", { className: "dt-empty" }, /* @__PURE__ */ React.createElement("div", { className: "empty-icon" }, /* @__PURE__ */ React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: "30",
          height: "30",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.7",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        },
        /* @__PURE__ */ React.createElement("path", { d: "M12 3l9 16H3zM12 10v4M12 17.5v.5" })
      )), /* @__PURE__ */ React.createElement("div", null, "Failed to load"), /* @__PURE__ */ React.createElement("div", { className: "faint mt" }, errorMessage));
    }
    const schedule = scheduleRef.current;
    const showFreq = hasSchedule && scheduleType === "INTERVAL" && schedule && schedule.freqEl;
    const showFreqHint = hasSchedule && scheduleType !== "INTERVAL";
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Status"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, statusState.phase === "loading" && /* @__PURE__ */ React.createElement(Loading, { text: "Loading status\u2026" }), statusState.phase === "error" && /* @__PURE__ */ React.createElement("div", { className: "faint" }, statusState.message), statusState.phase === "ready" && (statusState.pairs.length ? /* @__PURE__ */ React.createElement("dl", { className: "kv" }, statusState.pairs.map(([k, v], i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: `${k}-${i}` }, /* @__PURE__ */ React.createElement("dt", null, labelCase(k)), /* @__PURE__ */ React.createElement("dd", null, v)))) : /* @__PURE__ */ React.createElement("div", { className: "faint" }, "No status reported")))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Schedule"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Enable"), /* @__PURE__ */ React.createElement(YesNo, { value: enabled, onChange: setEnabled })), hasSchedule ? /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Schedule Type" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: scheduleType,
        onChange: (e) => {
          setScheduleType(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "INTERVAL" }, "Interval"),
      /* @__PURE__ */ React.createElement("option", { value: "TIME" }, "Time"),
      /* @__PURE__ */ React.createElement("option", { value: "CRON" }, "Cron")
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, showFreq && /* @__PURE__ */ React.createElement("label", null, "Frequency"), showFreq && /* @__PURE__ */ React.createElement("div", { className: "flex" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "0",
        step: "any",
        style: { maxWidth: "120px" },
        value: freqValue,
        onInput: (e) => {
          setFreqValue(e.target.value);
          setScheduleDirty(true);
        },
        onChange: (e) => {
          setFreqValue(e.target.value);
          setScheduleDirty(true);
        }
      }
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        style: { maxWidth: "120px" },
        value: freqUnit,
        onChange: (e) => {
          setFreqUnit(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "minutes" }, "minutes"),
      /* @__PURE__ */ React.createElement("option", { value: "hours" }, "hours")
    )), showFreqHint && /* @__PURE__ */ React.createElement("label", null, "Frequency"), showFreqHint && /* @__PURE__ */ React.createElement("div", { className: "hint" }, "Time/cron schedule details are preserved as configured."))) : /* @__PURE__ */ React.createElement("div", { className: "hint" }, "The polling schedule (pollingProperties) could not be parsed; it will be preserved unchanged."))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Prune Settings"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Block Size" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "50",
        value: blockSize,
        onInput: (e) => setBlockSize(e.target.value),
        onChange: (e) => setBlockSize(e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Prune Events"), /* @__PURE__ */ React.createElement(YesNo, { value: pruneEvents, onChange: setPruneEvents })), /* @__PURE__ */ React.createElement(Field, { label: "Prune Event Age (days)" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "1",
        value: maxEventAge,
        disabled: !pruneEvents,
        onInput: (e) => setMaxEventAge(e.target.value),
        onChange: (e) => setMaxEventAge(e.target.value)
      }
    ))))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Archive Settings"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Enable Archiving"), /* @__PURE__ */ React.createElement(YesNo, { value: archiveEnabled, onChange: setArchiveEnabled })), /* @__PURE__ */ React.createElement(Field, { label: "Archiver Block Size" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "1",
        value: archiverBlockSize,
        disabled: !archiveEnabled,
        onInput: (e) => setArchiverBlockSize(e.target.value),
        onChange: (e) => setArchiverBlockSize(e.target.value)
      }
    )), includeAttachments !== null && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Include Attachments"), /* @__PURE__ */ React.createElement(YesNo, { value: includeAttachments, onChange: setIncludeAttachments })), /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("div", { className: "hint" }, "Advanced archiver options (archiverOptions: content type, encryption, file patterns, compression) are preserved as configured and can be edited in the desktop Administrator."))))));
  }
  platform2.registerSettingsPanel({
    label: "Data Pruner",
    component: DataPrunerPanel
  });
}
export {
  register
};
