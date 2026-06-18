// plugins/server-log/web/plugin.jsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var DEFAULT_LOG_SIZE = 100;
var POLL_MS = 5e3;
var api = platform.api;
var { h, modal, toast } = platform.ui;
function formatLogDate(value) {
  if (value === null || value === void 0 || value === "") return "";
  let millis = value;
  if (typeof value === "object") millis = value.time ?? value.timestamp ?? null;
  const d = millis !== null && !isNaN(Number(millis)) ? new Date(Number(millis)) : new Date(String(value));
  if (isNaN(d.getTime())) return String(value);
  const p = (x, n = 2) => String(x).padStart(n, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function levelColor(level) {
  const lvl = String(level || "").toUpperCase();
  return lvl === "ERROR" || lvl === "FATAL" ? "var(--err)" : lvl === "WARN" ? "var(--warn)" : lvl === "INFO" ? "var(--accent)" : "var(--text-dim)";
}
function LevelTag({ level, style }) {
  const lvl = String(level || "").toUpperCase();
  const color = levelColor(level);
  return /* @__PURE__ */ React.createElement("span", { className: "tag", style: { color, borderColor: color, fontWeight: "650", ...style } }, lvl || "\u2014");
}
function levelTagDom(level) {
  const lvl = String(level || "").toUpperCase();
  const color = levelColor(level);
  return h("span.tag", { style: { color, borderColor: color, fontWeight: "650" } }, lvl || "\u2014");
}
function scopeLabel(item) {
  const cat = String(item.category ?? "").trim();
  const line = String(item.lineNumber ?? "").trim();
  if (!cat) return "";
  return `(${cat}${line ? ":" + line : ""})`;
}
function fullText(item) {
  let s = `[${formatLogDate(item.date)}]  ${String(item.level || "").toUpperCase()}  (${String(item.category ?? "")}`;
  const line = String(item.lineNumber ?? "").trim();
  if (line) s += ":" + line;
  s += `): ${item.message ?? ""}`;
  if (item.throwableInformation && String(item.throwableInformation).trim()) {
    s += "\n" + item.throwableInformation;
  }
  return s;
}
function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
      return;
    }
  } catch (e) {
  }
  toast("Clipboard unavailable", "warn");
}
function showDetail(item) {
  const stack = item.throwableInformation && String(item.throwableInformation).trim();
  const preStyle = {
    margin: "0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflowX: "hidden",
    overflowY: "auto",
    background: "var(--bg0)",
    color: "var(--text)",
    border: "1px solid var(--bg3)",
    padding: "8px",
    borderRadius: "4px"
  };
  modal({
    title: "Server Log Entry",
    size: "wide",
    body: h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "8px", minWidth: "620px" } },
      h(
        "div",
        { style: { display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" } },
        levelTagDom(item.level),
        h("span.mono.faint", formatLogDate(item.date)),
        h("span.mono", scopeLabel(item))
      ),
      h("div", { style: { fontWeight: "600" } }, "Message"),
      h("pre", { style: { ...preStyle, maxHeight: "30vh" } }, String(item.message ?? "")),
      stack ? h("div", { style: { fontWeight: "600" } }, "Stack Trace") : null,
      stack ? h("pre", { style: { ...preStyle, maxHeight: "60vh", fontSize: "12px" } }, String(item.throwableInformation)) : null
    ),
    buttons: [
      { label: "Copy", onClick: () => {
        copyText(fullText(item));
        return false;
      } },
      { label: "Close", primary: true }
    ]
  });
}
function LogRow({ item }) {
  const stack = item.throwableInformation && String(item.throwableInformation).trim();
  const rest = (`${scopeLabel(item)}: ${item.message ?? ""}` + (stack ? "  " + stack : "")).replace(/\s+/g, " ").trim();
  return /* @__PURE__ */ React.createElement(
    "tr",
    {
      style: { cursor: "pointer" },
      title: "Double-click for the full entry",
      onDoubleClick: () => showDetail(item)
    },
    /* @__PURE__ */ React.createElement("td", { style: { maxWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "12px" } }, /* @__PURE__ */ React.createElement("span", { className: "mono faint", style: { marginRight: "8px" } }, "[", formatLogDate(item.date), "]"), /* @__PURE__ */ React.createElement(LevelTag, { level: item.level, style: { verticalAlign: "middle", marginRight: "8px" } }), rest)
  );
}
function ServerLogTab() {
  const [items, setItems] = React.useState([]);
  const [paused, setPaused] = React.useState(false);
  const [logSize, setLogSize] = React.useState(DEFAULT_LOG_SIZE);
  const [sizeText, setSizeText] = React.useState(String(DEFAULT_LOG_SIZE));
  const [error, setError] = React.useState(null);
  const itemsRef = React.useRef(items);
  const lastLogIdRef = React.useRef(null);
  const pausedRef = React.useRef(paused);
  const logSizeRef = React.useRef(logSize);
  const aliveRef = React.useRef(true);
  const timerRef = React.useRef(null);
  itemsRef.current = items;
  pausedRef.current = paused;
  logSizeRef.current = logSize;
  const poll = React.useCallback(async function poll2() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!aliveRef.current) return;
    if (!pausedRef.current) {
      try {
        const raw = await api.get("/extensions/serverlog", { fetchSize: logSizeRef.current, lastLogId: lastLogIdRef.current });
        if (!aliveRef.current) return;
        const fresh = api.asList(raw, "serverLogItem");
        if (fresh.length) {
          fresh.sort((a, b) => Number(b.id) - Number(a.id));
          lastLogIdRef.current = Number(fresh[0].id);
          setItems((prev) => fresh.concat(prev).slice(0, logSizeRef.current));
          setError(null);
        } else {
          setError(null);
        }
      } catch (e) {
        if (!itemsRef.current.length) setError(e.message);
      }
    }
    if (aliveRef.current) timerRef.current = setTimeout(poll2, POLL_MS);
  }, []);
  React.useEffect(() => {
    aliveRef.current = true;
    poll();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [poll]);
  function togglePause() {
    setPaused((prev) => {
      const next = !prev;
      pausedRef.current = next;
      if (!next) poll();
      return next;
    });
  }
  function clearLog() {
    setItems([]);
    setError(null);
  }
  function applySize() {
    const n = Math.max(1, Math.min(99999, parseInt(sizeText, 10) || DEFAULT_LOG_SIZE));
    logSizeRef.current = n;
    setLogSize(n);
    setSizeText(String(n));
    setItems((prev) => prev.length > n ? prev.slice(0, n) : prev);
  }
  const btnStyle = { padding: "1px 6px", height: "22px", lineHeight: "1" };
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: "0" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "1", minHeight: "0", overflowY: "auto", overflowX: "hidden" } }, /* @__PURE__ */ React.createElement("table", { className: "dt server-log", style: { width: "100%" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { textAlign: "center", position: "sticky", top: "0", zIndex: "1", background: "var(--bg1)" } }, "Log Information"))), /* @__PURE__ */ React.createElement("tbody", null, error && !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "faint", style: { padding: "12px" } }, `Server Log unavailable: ${error}`)) : !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "faint", style: { padding: "12px" } }, "No server log entries yet.")) : items.map((item) => /* @__PURE__ */ React.createElement(LogRow, { key: item.id, item }))))), /* @__PURE__ */ React.createElement("div", { className: "taskbar", style: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 8px",
    flex: "none",
    fontSize: "12px",
    zIndex: "2",
    background: "var(--bg1)",
    borderTop: "1px solid var(--bg3)"
  } }, /* @__PURE__ */ React.createElement("button", { className: "icon-btn", title: "Pause or resume the live log", style: btnStyle, onClick: togglePause }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: "13px", lineHeight: "1" } }, paused ? "\u23F5" : "\u23F8")), /* @__PURE__ */ React.createElement("button", { className: "icon-btn", title: "Clear the displayed log", style: btnStyle, onClick: clearLog }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--err)", fontWeight: "700" } }, "\u2715")), /* @__PURE__ */ React.createElement("span", { style: { flex: "1" } }), /* @__PURE__ */ React.createElement("label", { className: "faint", style: { marginRight: "2px" } }, "Log Size:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "1",
      max: "99999",
      value: sizeText,
      style: { width: "60px", height: "22px", padding: "0 4px", fontSize: "12px" },
      onChange: (e) => setSizeText(e.target.value),
      onBlur: applySize,
      onKeyDown: (e) => {
        if (e.key === "Enter") applySize();
      }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "icon-btn", title: "Apply log size", style: btnStyle, onClick: applySize }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--ok)", fontWeight: "700" } }, "\u2713"))));
}
function register(platform2) {
  platform2.registerDashboardTab({
    id: "server-log",
    label: "Server Log",
    order: 10,
    component: ServerLogTab
  });
}
export {
  register
};
