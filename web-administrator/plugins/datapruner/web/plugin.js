// plugins/datapruner/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var PRUNER_STATUS_ORDER = ["currentState", "currentProcess", "lastProcess", "nextProcess", "isRunning"];
function childEl(root, name) {
  if (!root) return null;
  for (const c of root.children) if (c.tagName === name) return c;
  return null;
}
function setChild(doc, root, name, value) {
  let el = childEl(root, name);
  if (value === null || value === void 0) {
    if (el) root.removeChild(el);
    return;
  }
  if (!el) {
    el = doc.createElement(name);
    root.appendChild(el);
  }
  el.textContent = String(value);
}
var elText = (el) => el ? el.textContent : "";
var elBool = (el) => el ? (el.textContent || "").trim() === "true" : false;
var UNIT_MS = { milliseconds: 1, seconds: 1e3, minutes: 6e4, hours: 36e5 };
function msToFreq(ms) {
  if (ms > 0 && ms % 36e5 === 0) return { val: ms / 36e5, unit: "hours" };
  if (ms > 0 && ms % 6e4 === 0) return { val: ms / 6e4, unit: "minutes" };
  if (ms > 0 && ms % 1e3 === 0) return { val: ms / 1e3, unit: "seconds" };
  return { val: ms || "", unit: "milliseconds" };
}
var CONTENT_OPTIONS = [
  { key: "xml", label: "XML serialized message", contentType: null, dest: false },
  { key: "src-RAW", label: "Source - Raw", contentType: "RAW", dest: false },
  { key: "src-PROCESSED_RAW", label: "Source - Processed raw", contentType: "PROCESSED_RAW", dest: false },
  { key: "src-TRANSFORMED", label: "Source - Transformed", contentType: "TRANSFORMED", dest: false },
  { key: "src-ENCODED", label: "Source - Encoded", contentType: "ENCODED", dest: false },
  { key: "src-RESPONSE", label: "Source - Response", contentType: "RESPONSE", dest: false },
  { key: "dst-RAW", label: "Destination - Raw", contentType: "RAW", dest: true },
  { key: "dst-TRANSFORMED", label: "Destination - Transformed", contentType: "TRANSFORMED", dest: true },
  { key: "dst-ENCODED", label: "Destination - Encoded", contentType: "ENCODED", dest: true },
  { key: "dst-SENT", label: "Destination - Sent", contentType: "SENT", dest: true },
  { key: "dst-RESPONSE", label: "Destination - Response", contentType: "RESPONSE", dest: true },
  { key: "dst-PROCESSED_RESPONSE", label: "Destination - Processed response", contentType: "PROCESSED_RESPONSE", dest: true },
  { key: "map-SOURCE_MAP", label: "Source map", contentType: "SOURCE_MAP", dest: false },
  { key: "map-CHANNEL_MAP", label: "Channel map", contentType: "CHANNEL_MAP", dest: false },
  { key: "map-RESPONSE_MAP", label: "Response map", contentType: "RESPONSE_MAP", dest: false }
];
var COMPRESS_OPTIONS = [
  { key: "none", label: "none", archive: null, compress: null },
  { key: "zip", label: "zip", archive: "zip", compress: null },
  { key: "tar.gz", label: "tar.gz", archive: "tar", compress: "gz" },
  { key: "tar.bz2", label: "tar.bz2", archive: "tar", compress: "bzip2" }
];
var ENCRYPTION_OPTIONS = [
  { value: "STANDARD", label: "Standard" },
  { value: "AES128", label: "AES-128" },
  { value: "AES256", label: "AES-256" }
];
var ARCHIVE_VARS = [
  { label: "Message ID", token: "${message.messageId}" },
  { label: "Server ID", token: "${message.serverId}" },
  { label: "Channel ID", token: "${message.channelId}" },
  { label: "Original File Name", token: "${originalFilename}" },
  { label: "Formatted Message Date", token: "${date.format('yyyy-MM-dd',$message.getConnectorMessages().get(0).getReceivedDate())}" },
  { label: "Formatted Current Date", token: "${date.get('yyyy-MM-dd')}" },
  { label: "Timestamp", token: "${SYSTIME}" },
  { label: "Unique ID", token: "${UUID}" },
  { label: "Count", token: "${COUNT}" }
];
var ARCHIVE_VAR_MIME = "application/x-oie-archivevar";
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
    return /* @__PURE__ */ React.createElement("div", { className: "radio-group inline-row" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement(
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
    const archiverRef = React.useRef(null);
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
    const [pollTime, setPollTime] = React.useState("00:00");
    const [cronJobs, setCronJobs] = React.useState([]);
    const [scheduleDirty, setScheduleDirty] = React.useState(false);
    const [hasSchedule, setHasSchedule] = React.useState(false);
    const [contentKey, setContentKey] = React.useState("xml");
    const [encrypt, setEncrypt] = React.useState(false);
    const [compressKey, setCompressKey] = React.useState("none");
    const [passwordEnabled, setPasswordEnabled] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [encryptionType, setEncryptionType] = React.useState("AES128");
    const [rootFolder, setRootFolder] = React.useState("");
    const [filePattern, setFilePattern] = React.useState("");
    const rootInputRef = React.useRef(null);
    const patternInputRef = React.useRef(null);
    const lastVarTargetRef = React.useRef(null);
    const insertArchiveVar = (input, token) => {
      if (!input || input.disabled) return;
      const setter = input === rootInputRef.current ? setRootFolder : setFilePattern;
      const s = input.selectionStart ?? input.value.length;
      const e = input.selectionEnd ?? input.value.length;
      setter(input.value.slice(0, s) + token + input.value.slice(e));
      setArchiverDirty(true);
      const pos = s + token.length;
      requestAnimationFrame(() => {
        input.focus();
        try {
          input.setSelectionRange(pos, pos);
        } catch {
        }
      });
    };
    const onArchiveVarDragOver = (ev) => {
      if (!ev.currentTarget.disabled && Array.from(ev.dataTransfer.types).includes(ARCHIVE_VAR_MIME)) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
      }
    };
    const onArchiveVarDrop = (ev) => {
      const token = ev.dataTransfer.getData(ARCHIVE_VAR_MIME);
      if (!token || ev.currentTarget.disabled) return;
      ev.preventDefault();
      insertArchiveVar(ev.currentTarget, token);
    };
    const [archiverDirty, setArchiverDirty] = React.useState(false);
    const [hasArchiver, setHasArchiver] = React.useState(false);
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
      const root = doc.documentElement;
      const typeEl = childEl(root, "pollingType");
      if (!typeEl) return false;
      scheduleRef.current = { doc, root };
      setScheduleType((typeEl.textContent || "").trim() || "INTERVAL");
      const freqMs = parseInt(elText(childEl(root, "pollingFrequency")), 10) || 0;
      const f = msToFreq(freqMs);
      setFreqValue(f.val);
      setFreqUnit(f.unit);
      const hour = parseInt(elText(childEl(root, "pollingHour")), 10) || 0;
      const minute = parseInt(elText(childEl(root, "pollingMinute")), 10) || 0;
      setPollTime(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
      const jobs = [];
      const cronEl = childEl(root, "cronJobs");
      if (cronEl) {
        for (const cp of cronEl.children) {
          if (cp.tagName !== "cronProperty") continue;
          jobs.push({
            expression: elText(childEl(cp, "expression")),
            description: elText(childEl(cp, "description"))
          });
        }
      }
      setCronJobs(jobs);
      setScheduleDirty(false);
      return true;
    }
    function buildArchiver() {
      archiverRef.current = null;
      const xml = getProp("archiverOptions");
      if (!xml || xml.trim() === "" || xml.trim()[0] !== "<") return false;
      let doc = null;
      try {
        doc = new DOMParser().parseFromString(xml, "text/xml");
      } catch (e) {
        return false;
      }
      if (!doc || doc.querySelector("parsererror")) return false;
      const root = doc.documentElement;
      archiverRef.current = { doc, root };
      const ctVal = (elText(childEl(root, "contentType")) || "").trim() || null;
      const dest = elBool(childEl(root, "destinationContent"));
      let ckey = "xml";
      if (ctVal) {
        const opt = CONTENT_OPTIONS.find((o) => o.contentType === ctVal && o.dest === dest);
        ckey = opt ? opt.key : "xml";
      }
      setContentKey(ckey);
      setEncrypt(elBool(childEl(root, "encrypt")));
      const af = (elText(childEl(root, "archiveFormat")) || "").trim() || null;
      const cf = (elText(childEl(root, "compressFormat")) || "").trim() || null;
      const copt = COMPRESS_OPTIONS.find((o) => o.archive === af && o.compress === cf);
      setCompressKey(copt ? copt.key : "none");
      setPasswordEnabled(elBool(childEl(root, "passwordEnabled")));
      setPassword(elText(childEl(root, "password")));
      setEncryptionType((elText(childEl(root, "encryptionType")) || "").trim() || "AES128");
      setRootFolder(elText(childEl(root, "rootFolder")));
      setFilePattern(elText(childEl(root, "filePattern")));
      setArchiverDirty(false);
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
      setHasArchiver(buildArchiver());
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
        const effIncludeAttachments = contentKey === "xml" ? includeAttachments : false;
        if (includeAttachments !== null) {
          setProp("includeAttachments", `<boolean>${effIncludeAttachments}</boolean>`);
        }
        const schedule = scheduleRef.current;
        if (schedule && scheduleDirty) {
          const { doc, root } = schedule;
          setChild(doc, root, "pollingType", scheduleType);
          if (scheduleType === "INTERVAL") {
            const ms = Math.round((parseFloat(freqValue) || 0) * (UNIT_MS[freqUnit] || 6e4));
            if (ms > 0) setChild(doc, root, "pollingFrequency", String(ms));
          } else if (scheduleType === "TIME") {
            const [hh, mm] = String(pollTime || "00:00").split(":");
            setChild(doc, root, "pollingHour", String(parseInt(hh, 10) || 0));
            setChild(doc, root, "pollingMinute", String(parseInt(mm, 10) || 0));
          } else if (scheduleType === "CRON") {
            let cronEl = childEl(root, "cronJobs");
            if (!cronEl) {
              cronEl = doc.createElement("cronJobs");
              root.appendChild(cronEl);
            }
            while (cronEl.firstChild) cronEl.removeChild(cronEl.firstChild);
            for (const job of cronJobs) {
              if (!job.expression || !job.expression.trim()) continue;
              const cp = doc.createElement("cronProperty");
              const desc = doc.createElement("description");
              desc.textContent = job.description || "";
              const expr = doc.createElement("expression");
              expr.textContent = job.expression;
              cp.appendChild(desc);
              cp.appendChild(expr);
              cronEl.appendChild(cp);
            }
          }
          setProp("pollingProperties", new XMLSerializer().serializeToString(doc));
        }
        const archiver = archiverRef.current;
        if (archiver && archiverDirty) {
          const { doc, root } = archiver;
          const cOpt = CONTENT_OPTIONS.find((o) => o.key === contentKey) || CONTENT_OPTIONS[0];
          setChild(doc, root, "contentType", cOpt.contentType);
          setChild(doc, root, "destinationContent", String(!!cOpt.dest));
          setChild(doc, root, "encrypt", String(encrypt));
          if (includeAttachments !== null) {
            setChild(doc, root, "includeAttachments", String(effIncludeAttachments));
          }
          const zOpt = COMPRESS_OPTIONS.find((o) => o.key === compressKey) || COMPRESS_OPTIONS[0];
          setChild(doc, root, "archiveFormat", zOpt.archive);
          setChild(doc, root, "compressFormat", zOpt.compress);
          const passwordActive = compressKey === "zip" && passwordEnabled;
          setChild(doc, root, "passwordEnabled", String(passwordActive));
          setChild(doc, root, "password", passwordActive ? password : "");
          setChild(doc, root, "encryptionType", encryptionType);
          setChild(doc, root, "rootFolder", rootFolder);
          setChild(doc, root, "filePattern", filePattern);
          setProp("archiverOptions", new XMLSerializer().serializeToString(doc));
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
      pollTime,
      cronJobs,
      scheduleDirty,
      contentKey,
      encrypt,
      compressKey,
      passwordEnabled,
      password,
      encryptionType,
      rootFolder,
      filePattern,
      archiverDirty
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
      )), /* @__PURE__ */ React.createElement("div", null, "Failed to load"), /* @__PURE__ */ React.createElement("div", { className: "text-text-faint mt-[14px]" }, errorMessage));
    }
    const attachmentsEnabled = archiveEnabled && contentKey === "xml";
    const passwordSectionEnabled = archiveEnabled && compressKey === "zip";
    const updateCronJob = (idx, key, value) => {
      setCronJobs(cronJobs.map((job, i) => i === idx ? { ...job, [key]: value } : job));
      setScheduleDirty(true);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Status"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, statusState.phase === "loading" && /* @__PURE__ */ React.createElement(Loading, { text: "Loading status\u2026" }), statusState.phase === "error" && /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, statusState.message), statusState.phase === "ready" && (statusState.pairs.length ? /* @__PURE__ */ React.createElement("dl", { className: "kv" }, statusState.pairs.map(([k, v], i) => /* @__PURE__ */ React.createElement(React.Fragment, { key: `${k}-${i}` }, /* @__PURE__ */ React.createElement("dt", null, labelCase(k)), /* @__PURE__ */ React.createElement("dd", null, v)))) : /* @__PURE__ */ React.createElement("div", { className: "text-text-faint" }, "No status reported")))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Schedule"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Enable"), /* @__PURE__ */ React.createElement(YesNo, { value: enabled, onChange: setEnabled })), hasSchedule ? /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Schedule Type" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: scheduleType,
        disabled: !enabled,
        onChange: (e) => {
          setScheduleType(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "INTERVAL" }, "Interval"),
      /* @__PURE__ */ React.createElement("option", { value: "TIME" }, "Time"),
      /* @__PURE__ */ React.createElement("option", { value: "CRON" }, "Cron")
    )), scheduleType === "INTERVAL" && /* @__PURE__ */ React.createElement(Field, { label: "Interval", hint: "Must be between 1 and 24 hours when converted to milliseconds." }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "0",
        step: "any",
        className: "max-w-[120px]",
        value: freqValue,
        disabled: !enabled,
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
        className: "max-w-[140px]",
        value: freqUnit,
        disabled: !enabled,
        onChange: (e) => {
          setFreqUnit(e.target.value);
          setScheduleDirty(true);
        }
      },
      /* @__PURE__ */ React.createElement("option", { value: "milliseconds" }, "milliseconds"),
      /* @__PURE__ */ React.createElement("option", { value: "seconds" }, "seconds"),
      /* @__PURE__ */ React.createElement("option", { value: "minutes" }, "minutes"),
      /* @__PURE__ */ React.createElement("option", { value: "hours" }, "hours")
    ))), scheduleType === "TIME" && /* @__PURE__ */ React.createElement(Field, { label: "Time", hint: "Prune once a day at this time of day." }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "time",
        className: "max-w-[140px]",
        value: pollTime,
        disabled: !enabled,
        onInput: (e) => {
          setPollTime(e.target.value);
          setScheduleDirty(true);
        },
        onChange: (e) => {
          setPollTime(e.target.value);
          setScheduleDirty(true);
        }
      }
    )), scheduleType === "CRON" && /* @__PURE__ */ React.createElement("div", { className: "field span-2" }, /* @__PURE__ */ React.createElement("label", null, "Cron Jobs"), /* @__PURE__ */ React.createElement("div", { className: "dt-wrap" }, /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Expression"), /* @__PURE__ */ React.createElement("th", null, "Description"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, cronJobs.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: "3", className: "text-text-faint" }, "No cron jobs defined.")), cronJobs.map((job, idx) => /* @__PURE__ */ React.createElement("tr", { key: idx }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "w-full",
        value: job.expression,
        disabled: !enabled,
        placeholder: "0 0 */1 * * ?",
        onInput: (e) => updateCronJob(idx, "expression", e.target.value),
        onChange: (e) => updateCronJob(idx, "expression", e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "text",
        className: "w-full",
        value: job.description,
        disabled: !enabled,
        onInput: (e) => updateCronJob(idx, "description", e.target.value),
        onChange: (e) => updateCronJob(idx, "description", e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-sm btn-danger",
        disabled: !enabled,
        onClick: () => {
          setCronJobs(cronJobs.filter((_, i) => i !== idx));
          setScheduleDirty(true);
        }
      },
      "Delete"
    ))))))), /* @__PURE__ */ React.createElement("div", { className: "mt-[8px]" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        className: "btn btn-sm",
        disabled: !enabled,
        onClick: () => {
          setCronJobs([...cronJobs, { expression: "", description: "" }]);
          setScheduleDirty(true);
        }
      },
      "Add"
    )), /* @__PURE__ */ React.createElement("div", { className: "hint mt-[6px]" }, "Quartz cron expressions with at least 6 fields (seconds minutes hours day-of-month month day-of-week [year])."))) : /* @__PURE__ */ React.createElement("div", { className: "hint" }, "The polling schedule (pollingProperties) could not be parsed; it will be preserved unchanged."))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Prune Settings"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "form-grid" }, /* @__PURE__ */ React.createElement(Field, { label: "Block Size" }, /* @__PURE__ */ React.createElement(
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
    ))), hasArchiver ? /* @__PURE__ */ React.createElement("div", { className: "form-grid mt-[12px]" }, /* @__PURE__ */ React.createElement(Field, { label: "Content" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: contentKey,
        disabled: !archiveEnabled,
        onChange: (e) => {
          const key = e.target.value;
          setContentKey(key);
          if (key !== "xml" && includeAttachments !== null) setIncludeAttachments(false);
          setArchiverDirty(true);
        }
      },
      CONTENT_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.key, value: o.key }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Encrypt"), /* @__PURE__ */ React.createElement("label", { className: "inline-flex items-center gap-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: encrypt,
        disabled: !archiveEnabled,
        onChange: (e) => {
          setEncrypt(e.target.checked);
          setArchiverDirty(true);
        }
      }
    ), "Encrypt exported content")), includeAttachments !== null && /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Include Attachments"), /* @__PURE__ */ React.createElement(
      YesNo,
      {
        value: includeAttachments,
        disabled: !attachmentsEnabled,
        onChange: (v) => {
          setIncludeAttachments(v);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "Compression" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: compressKey,
        disabled: !archiveEnabled,
        onChange: (e) => {
          setCompressKey(e.target.value);
          setArchiverDirty(true);
        }
      },
      COMPRESS_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.key, value: o.key }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "field" }, /* @__PURE__ */ React.createElement("label", null, "Password Protect"), /* @__PURE__ */ React.createElement(
      YesNo,
      {
        value: passwordEnabled,
        disabled: !passwordSectionEnabled,
        onChange: (v) => {
          setPasswordEnabled(v);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "Password" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "password",
        value: password,
        disabled: !passwordSectionEnabled || !passwordEnabled,
        onInput: (e) => {
          setPassword(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setPassword(e.target.value);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "Encryption" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: encryptionType,
        disabled: !passwordSectionEnabled || !passwordEnabled,
        onChange: (e) => {
          setEncryptionType(e.target.value);
          setArchiverDirty(true);
        }
      },
      ENCRYPTION_OPTIONS.map((o) => /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))
    )), /* @__PURE__ */ React.createElement("div", { className: "span-2 flex gap-3 items-stretch" }, /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-w-0 flex flex-col gap-2" }, /* @__PURE__ */ React.createElement(Field, { label: "Root Path" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: rootInputRef,
        type: "text",
        value: rootFolder,
        disabled: !archiveEnabled,
        onFocus: () => {
          lastVarTargetRef.current = rootInputRef.current;
        },
        onDragOver: onArchiveVarDragOver,
        onDrop: onArchiveVarDrop,
        onInput: (e) => {
          setRootFolder(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setRootFolder(e.target.value);
          setArchiverDirty(true);
        }
      }
    )), /* @__PURE__ */ React.createElement(Field, { label: "File Pattern", hint: "Folder/filename pattern for written messages (supports ${message.*} variables)." }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: patternInputRef,
        type: "text",
        value: filePattern,
        disabled: !archiveEnabled,
        onFocus: () => {
          lastVarTargetRef.current = patternInputRef.current;
        },
        onDragOver: onArchiveVarDragOver,
        onDrop: onArchiveVarDrop,
        onInput: (e) => {
          setFilePattern(e.target.value);
          setArchiverDirty(true);
        },
        onChange: (e) => {
          setFilePattern(e.target.value);
          setArchiverDirty(true);
        }
      }
    ))), /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "border border-line rounded-[4px] py-1 min-w-[180px] max-w-[230px] bg-bg1 overflow-auto self-stretch",
        style: { opacity: archiveEnabled ? 1 : 0.5 },
        title: "Drag a variable into Root Path / File Pattern, or click to insert it at the last-focused one"
      },
      ARCHIVE_VARS.map((v) => /* @__PURE__ */ React.createElement(
        "div",
        {
          key: v.label,
          draggable: archiveEnabled,
          className: "py-[3px] px-3 text-[12px] select-none cursor-grab hover:bg-bg2",
          onClick: () => archiveEnabled && insertArchiveVar(lastVarTargetRef.current || rootInputRef.current, v.token),
          onDragStart: (ev) => {
            ev.dataTransfer.clearData();
            ev.dataTransfer.setData(ARCHIVE_VAR_MIME, v.token);
            ev.dataTransfer.effectAllowed = "copy";
          }
        },
        v.label
      ))
    ))) : /* @__PURE__ */ React.createElement("div", { className: "hint mt-[12px]" }, "Advanced archiver options (archiverOptions) could not be parsed; they will be preserved unchanged."))));
  }
  platform2.registerSettingsPanel({
    label: "Data Pruner",
    component: DataPrunerPanel
  });
}
export {
  register
};
