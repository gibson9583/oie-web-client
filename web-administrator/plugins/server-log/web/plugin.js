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
  return /* @__PURE__ */ React.createElement("span", { className: "tag font-[650]", style: { color, borderColor: color, ...style } }, lvl || "\u2014");
}
function levelTagDom(level) {
  const lvl = String(level || "").toUpperCase();
  const color = levelColor(level);
  return h("span.tag", { class: "font-[650]", style: { color, borderColor: color } }, lvl || "\u2014");
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
  const preClass = "m-0 whitespace-pre-wrap [word-break:break-word] overflow-x-hidden overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]";
  modal({
    title: "Server Log Entry",
    size: "wide",
    body: h(
      "div",
      { class: "flex flex-col gap-2 min-w-[620px]" },
      h(
        "div",
        { class: "flex gap-[14px] items-center flex-wrap" },
        levelTagDom(item.level),
        h("span.mono.text-text-faint", formatLogDate(item.date)),
        h("span.mono", scopeLabel(item))
      ),
      h("div", { class: "font-semibold" }, "Message"),
      h("pre", { class: preClass + " max-h-[30vh]" }, String(item.message ?? "")),
      stack ? h("div", { class: "font-semibold" }, "Stack Trace") : null,
      stack ? h("pre", { class: preClass + " max-h-[60vh] text-[12px]" }, String(item.throwableInformation)) : null
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
      className: "cursor-pointer",
      title: "Double-click for the full entry",
      onDoubleClick: () => showDetail(item)
    },
    /* @__PURE__ */ React.createElement("td", { className: "max-w-0 truncate text-[12px]" }, /* @__PURE__ */ React.createElement("span", { className: "mono text-text-faint mr-2" }, "[", formatLogDate(item.date), "]"), /* @__PURE__ */ React.createElement(LevelTag, { level: item.level, style: { verticalAlign: "middle", marginRight: "8px" } }), rest)
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
  const btnClass = "py-[1px] px-1.5 h-[22px] leading-none";
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col h-full min-h-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-h-0 overflow-y-auto overflow-x-hidden" }, /* @__PURE__ */ React.createElement("table", { className: "dt server-log w-full" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "text-center sticky top-0 z-[1] bg-bg1" }, "Log Information"))), /* @__PURE__ */ React.createElement("tbody", null, error && !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-faint p-3" }, `Server Log unavailable: ${error}`)) : !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-faint p-3" }, "No server log entries yet.")) : items.map((item) => /* @__PURE__ */ React.createElement(LogRow, { key: item.id, item }))))), /* @__PURE__ */ React.createElement("div", { className: "taskbar flex items-center gap-1.5 py-[3px] px-2 flex-none text-[12px] z-[2] bg-bg1 border-t border-[var(--bg3)]" }, /* @__PURE__ */ React.createElement("button", { className: "icon-btn " + btnClass, title: "Pause or resume the live log", onClick: togglePause }, /* @__PURE__ */ React.createElement("span", { className: "text-[13px] leading-none" }, paused ? "\u23F5" : "\u23F8")), /* @__PURE__ */ React.createElement("button", { className: "icon-btn " + btnClass, title: "Clear the displayed log", onClick: clearLog }, /* @__PURE__ */ React.createElement("span", { className: "text-err font-bold" }, "\u2715")), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }), /* @__PURE__ */ React.createElement("label", { className: "text-text-faint mr-0.5" }, "Log Size:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "1",
      max: "99999",
      value: sizeText,
      className: "w-[60px] h-[22px] py-0 px-1 text-[12px]",
      onChange: (e) => setSizeText(e.target.value),
      onBlur: applySize,
      onKeyDown: (e) => {
        if (e.key === "Enter") applySize();
      }
    }
  ), /* @__PURE__ */ React.createElement("button", { className: "icon-btn " + btnClass, title: "Apply log size", onClick: applySize }, /* @__PURE__ */ React.createElement("span", { className: "text-ok font-bold" }, "\u2713"))));
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
