// plugins/server-log/web/plugin.tsx
import { platform } from "@oie/web-shell";

// plugins/server-log/web/session.ts
var POLL_MS = 5e3;
var DEFAULT_LOG_SIZE = 100;
function fingerprint(item) {
  return JSON.stringify([item.serverId, item.id, item.date, item.level, item.category, item.message]);
}
var ServerLogSession = class {
  constructor(fetchLogs) {
    this.fetchLogs = fetchLogs;
  }
  fetchLogs;
  snapshot = { items: [], paused: false, logSize: DEFAULT_LOG_SIZE, error: null };
  listeners = /* @__PURE__ */ new Set();
  lastItem = null;
  lastId = null;
  clearVersion = 0;
  baselinePending = false;
  disposed = false;
  timer = null;
  flight = null;
  getSnapshot = () => this.snapshot;
  subscribe = (listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) void this.poll();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.stopTimer();
    };
  };
  publish(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  stopTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
  clear() {
    if (this.disposed) return;
    this.clearVersion++;
    this.baselinePending = this.baselinePending || this.lastId === null || this.flight !== null;
    this.publish({ items: [], error: null });
  }
  togglePause() {
    if (this.disposed) return;
    this.publish({ paused: !this.snapshot.paused });
    this.stopTimer();
    if (!this.snapshot.paused) void this.poll();
  }
  setSize(value) {
    if (this.disposed) return;
    const logSize = Math.max(1, Math.min(99999, Math.trunc(value) || DEFAULT_LOG_SIZE));
    this.publish({ logSize, items: this.snapshot.items.slice(0, logSize) });
  }
  dispose() {
    this.disposed = true;
    this.stopTimer();
    this.lastId = null;
    this.lastItem = null;
    this.publish({ items: [], error: null, paused: false, logSize: DEFAULT_LOG_SIZE });
  }
  async receive() {
    const version = this.clearVersion;
    let fresh = await this.fetchLogs(this.snapshot.logSize, this.lastId);
    if (this.disposed) return;
    let restarted = false;
    if (!fresh.length && this.lastId !== null) {
      const [head] = await this.fetchLogs(1, null);
      if (this.disposed) return;
      if (head && (Number(head.id) < this.lastId || Number(head.id) === this.lastId && this.lastItem && fingerprint(head) !== fingerprint(this.lastItem))) {
        restarted = true;
        fresh = await this.fetchLogs(this.snapshot.logSize, null);
        if (this.disposed) return;
      }
    }
    const suppress = this.baselinePending || version !== this.clearVersion;
    if (this.snapshot.paused && !suppress) return;
    if (restarted) {
      this.lastId = null;
      this.lastItem = null;
    }
    fresh = fresh.filter((item) => Number.isFinite(Number(item.id))).sort((a, b) => Number(b.id) - Number(a.id));
    const newest = fresh[0];
    if (newest) {
      this.lastId = Number(newest.id);
      this.lastItem = newest;
    } else if (this.lastId === null) {
      this.lastId = 0;
    }
    this.baselinePending = false;
    const byId = /* @__PURE__ */ new Map();
    const previous = restarted ? [] : this.snapshot.items;
    for (const item of suppress ? previous : fresh.concat(previous)) {
      if (!byId.has(String(item.id))) byId.set(String(item.id), item);
    }
    this.publish({ items: [...byId.values()].slice(0, this.snapshot.logSize), error: null });
  }
  poll() {
    this.stopTimer();
    if (this.disposed || !this.listeners.size || this.snapshot.paused) return Promise.resolve();
    if (this.flight) return this.flight;
    this.flight = this.receive().catch((error) => {
      if (!this.disposed) this.publish({
        // Revoked log access must remove previously authorized content
        // from the session cache as well as expose the denial in the UI.
        ...error?.status === 403 ? { items: [] } : {},
        error: error instanceof Error ? error.message : String(error)
      });
    }).finally(() => {
      this.flight = null;
      if (!this.disposed && this.listeners.size && !this.snapshot.paused) {
        this.timer = setTimeout(() => {
          void this.poll();
        }, POLL_MS);
      }
    });
    return this.flight;
  }
};

// plugins/server-log/web/plugin.tsx
var React = platform.React;
var DEFAULT_LOG_SIZE2 = 100;
var api = platform.api;
var { h, modal, toast } = platform.ui;
function createSession() {
  return new ServerLogSession(async (fetchSize, lastLogId) => api.asList(await api.get("/extensions/serverlog", { fetchSize, lastLogId }), "serverLogItem"));
}
var logSession = createSession();
var userKey = (user) => user ? String(user.id ?? user.username) : null;
var currentUser = userKey(platform.store.getState("user"));
function endSession() {
  logSession.dispose();
  logSession = createSession();
}
platform.store.subscribe("user", (user) => {
  const next = userKey(user);
  if (next !== currentUser) endSession();
  currentUser = next;
});
platform.events.on("session:logout", endSession);
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
function logDateMillis(value) {
  if (value === null || value === void 0 || value === "") return 0;
  let millis = value;
  if (typeof value === "object") millis = value.time ?? value.timestamp ?? null;
  if (millis !== null && !isNaN(Number(millis))) return Number(millis);
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? 0 : d.getTime();
}
var LEVEL_RANK = { FATAL: 5, ERROR: 4, WARN: 3, INFO: 2, DEBUG: 1, TRACE: 0 };
function restText(item) {
  const stack = item.throwableInformation && String(item.throwableInformation).trim();
  return (`${scopeLabel(item)}: ${item.message ?? ""}` + (stack ? "  " + stack : "")).replace(/\s+/g, " ").trim();
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
      { class: "flex flex-col gap-2 min-w-[558px]" },
      h(
        "div",
        { class: "flex gap-[13px] items-center flex-wrap" },
        levelTagDom(item.level),
        h("span.mono.text-text-faint", formatLogDate(item.date)),
        h("span.mono", scopeLabel(item))
      ),
      h("div", { class: "font-semibold" }, "Message"),
      h("pre", { class: preClass + " max-h-[30vh]" }, String(item.message ?? "")),
      stack ? h("div", { class: "font-semibold" }, "Stack Trace") : null,
      stack ? h("pre", { class: preClass + " max-h-[60vh] text-[11px]" }, String(item.throwableInformation)) : null
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
  return /* @__PURE__ */ React.createElement(
    "tr",
    {
      className: "cursor-pointer",
      title: "Double-click for the full entry",
      onDoubleClick: () => showDetail(item)
    },
    /* @__PURE__ */ React.createElement("td", { className: "mono text-text-faint whitespace-nowrap text-[11px] w-[160px]" }, formatLogDate(item.date)),
    /* @__PURE__ */ React.createElement("td", { className: "whitespace-nowrap w-[76px]" }, /* @__PURE__ */ React.createElement(LevelTag, { level: item.level, style: { verticalAlign: "middle" } })),
    /* @__PURE__ */ React.createElement("td", { className: "max-w-0 truncate text-[11px]" }, restText(item))
  );
}
function ServerLogTab() {
  const [session] = React.useState(() => logSession);
  const { items, paused, logSize, error } = React.useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [sizeText, setSizeText] = React.useState(() => String(logSize));
  const [sort, setSort] = React.useState({ key: "timestamp", dir: -1 });
  function togglePause() {
    session.togglePause();
  }
  function clearLog() {
    session.clear();
  }
  function applySize() {
    const n = Math.max(1, Math.min(99999, parseInt(sizeText, 10) || DEFAULT_LOG_SIZE2));
    session.setSize(n);
    setSizeText(String(n));
  }
  const btnClass = "py-[1px] px-1.5 h-[20px] leading-none";
  function handleSort(key) {
    setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 });
  }
  const sortedItems = React.useMemo(() => {
    const val = (item) => sort.key === "timestamp" ? logDateMillis(item.date) : sort.key === "level" ? LEVEL_RANK[String(item.level || "").toUpperCase()] ?? -1 : restText(item).toLowerCase();
    return [...items].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return (cmp || Number(a.id) - Number(b.id)) * sort.dir;
    });
  }, [items, sort]);
  const headerTh = (key, label, extra = "") => /* @__PURE__ */ React.createElement("th", { className: "sortable sticky top-0 z-[1] bg-bg2 text-left " + extra, onClick: () => handleSort(key) }, label, sort.key === key ? /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, sort.dir > 0 ? "\u25B2" : "\u25BC") : null);
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col h-full min-h-0" }, /* @__PURE__ */ React.createElement("div", { className: "flex-1 min-h-0 overflow-y-auto overflow-x-hidden" }, /* @__PURE__ */ React.createElement("table", { className: "dt server-log w-full" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, headerTh("timestamp", "Timestamp", "w-[160px]"), headerTh("level", "Level", "w-[76px]"), headerTh("message", "Message"))), /* @__PURE__ */ React.createElement("tbody", null, error && !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3, className: "text-text-faint p-3" }, `Server Log unavailable: ${error}`)) : !items.length ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 3, className: "text-text-faint p-3" }, "No server log entries yet.")) : sortedItems.map((item) => /* @__PURE__ */ React.createElement(LogRow, { key: item.id, item }))))), /* @__PURE__ */ React.createElement("div", { className: "taskbar flex items-center gap-1.5 py-[3px] px-2 flex-none text-[11px] z-[2] bg-bg2 border-t border-[var(--bg3)]" }, /* @__PURE__ */ React.createElement("button", { className: "icon-btn " + btnClass, title: "Pause or resume the live log", onClick: togglePause }, /* @__PURE__ */ React.createElement("span", { className: "text-[11.5px] leading-none" }, paused ? "\u23F5" : "\u23F8")), /* @__PURE__ */ React.createElement("button", { className: "icon-btn " + btnClass, title: "Clear the displayed log", onClick: clearLog }, /* @__PURE__ */ React.createElement("span", { className: "text-err font-bold" }, "\u2715")), /* @__PURE__ */ React.createElement("span", { className: "flex-1" }), /* @__PURE__ */ React.createElement("label", { className: "text-text-faint mr-0.5" }, "Log Size:"), /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "number",
      min: "1",
      max: "99999",
      value: sizeText,
      className: "w-[54px] h-[20px] py-0 px-1 text-[11px]",
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
