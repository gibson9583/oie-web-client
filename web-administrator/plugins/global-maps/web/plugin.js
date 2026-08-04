// plugins/global-maps/web/plugin.tsx
import { platform } from "@oie/web-shell";
var React = platform.React;
var GLOBAL_MAP_LABEL = "<Global Map>";
function register(platform2) {
  const { h, modal } = platform2.ui;
  const api = platform2.api;
  function mapEntries(value) {
    const out = [];
    for (const entry of api.asList(value?.entry)) {
      if (entry === null || typeof entry !== "object") continue;
      const keys = Object.keys(entry);
      if (keys.length === 1 && Array.isArray(entry[keys[0]])) {
        const pair = entry[keys[0]];
        out.push([pair[0], pair.length > 1 ? pair[1] : null]);
        continue;
      }
      const values = Object.values(entry);
      if (values.length >= 1) out.push([values[0], values.length > 1 ? values[1] : null]);
    }
    return out;
  }
  function displayValue(value) {
    if (value === null || value === void 0) return "";
    const s = String(value);
    if (s.trim().startsWith("<")) {
      try {
        const parsed = api.parseBody(s);
        if (parsed === null || parsed === void 0) return s;
        return typeof parsed === "object" ? JSON.stringify(parsed, null, 1) : String(parsed);
      } catch (e) {
      }
    }
    return s;
  }
  function showValue(row) {
    modal({
      title: "Global Map Value",
      size: "wide",
      body: h(
        "div",
        { class: "flex flex-col gap-2 min-w-[558px]" },
        h(
          "div",
          { class: "flex gap-[13px] flex-wrap text-[11px]" },
          h("span.mono.text-text-faint", `Server ${row.serverId}`),
          h("span.mono", row.channel),
          h("span.mono", { class: "font-[650]" }, row.key)
        ),
        h("pre", {
          class: "m-0 whitespace-pre-wrap [word-break:break-word] max-h-[60vh] overflow-x-hidden overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]"
        }, row.value)
      ),
      buttons: [{ label: "Close", primary: true }]
    });
  }
  async function fetchRows() {
    const idPairs = mapEntries(await api.channels.idsAndNames().catch(() => null));
    const idsAndNames = new Map(idPairs.map(([id, name]) => [String(id), String(name)]));
    const channelIds = [...idsAndNames.keys()];
    const all = await api.post(
      "/extensions/globalmapviewer/maps/_getAllMaps",
      { set: { string: channelIds } },
      { params: { includeGlobalMap: true } }
    );
    const rows = [];
    for (const [serverId, serverMaps] of mapEntries(all)) {
      for (const [channelId, map] of mapEntries(serverMaps)) {
        const isGlobal = channelId === null || channelId === void 0 || channelId === "null";
        const chId = isGlobal ? null : String(channelId);
        const channel = isGlobal ? GLOBAL_MAP_LABEL : idsAndNames.get(chId) || chId;
        for (const [k, v] of mapEntries(map)) {
          rows.push({ serverId: String(serverId), channelId: chId, channel, key: String(k), value: displayValue(v) });
        }
      }
    }
    return rows;
  }
  function GlobalMapsTab({ selection }) {
    const [rows, setRows] = React.useState([]);
    const [error, setError] = React.useState(null);
    const mountedRef = React.useRef(true);
    const selectedIds = React.useMemo(
      () => new Set((selection || []).map((s) => String(s.channelId))),
      [selection]
    );
    React.useEffect(() => {
      mountedRef.current = true;
      let timer = null;
      const refresh = async () => {
        try {
          const next = await fetchRows();
          if (!mountedRef.current) return;
          setRows(next);
          setError(null);
        } catch (e) {
          if (!mountedRef.current) return;
          setError(e.message);
        }
        if (mountedRef.current) timer = setTimeout(refresh, 1e4);
      };
      refresh();
      return () => {
        mountedRef.current = false;
        if (timer) clearTimeout(timer);
      };
    }, []);
    const filtered = rows.filter((r) => r.channelId === null || !selectedIds.size || selectedIds.has(String(r.channelId)));
    const [sort, setSort] = React.useState({ key: null, dir: 1 });
    const sorted = React.useMemo(() => {
      if (!sort.key) return filtered;
      const val = (r) => String((sort.key === "channel" ? r.channel : r[sort.key]) ?? "").toLowerCase();
      return [...filtered].sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
    }, [filtered, sort]);
    const toggleSort = (key) => setSort((s) => s.key === key ? { key, dir: -s.dir } : { key, dir: 1 });
    const arrow = (key) => sort.key === key ? sort.dir > 0 ? " \u25B2" : " \u25BC" : "";
    let body;
    if (error) {
      body = /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "text-text-faint p-3" }, `Global maps unavailable: ${error}`));
    } else if (!filtered.length) {
      body = /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "text-text-faint p-3" }, "No global map variables are set."));
    } else {
      body = sorted.map((r, i) => {
        const value = r.value.replace(/\s+/g, " ").trim();
        return /* @__PURE__ */ React.createElement(
          "tr",
          {
            key: `${r.serverId}|${r.channelId}|${r.key}|${i}`,
            className: "cursor-pointer",
            title: "Double-click for the full value",
            onDoubleClick: () => showValue(r)
          },
          /* @__PURE__ */ React.createElement("td", { className: "mono text-text-faint" }, r.serverId),
          /* @__PURE__ */ React.createElement("td", null, r.channel),
          /* @__PURE__ */ React.createElement("td", { className: "mono font-semibold" }, r.key),
          /* @__PURE__ */ React.createElement("td", { className: "mono text-[11px]" }, value)
        );
      });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "dt-wrap min-h-0" }, /* @__PURE__ */ React.createElement("table", { className: "dt global-maps" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("serverId") }, "Server Id", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("serverId"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("channel") }, "Channel", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("channel"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("key") }, "Key", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("key"))), /* @__PURE__ */ React.createElement("th", { className: "sortable", style: { cursor: "pointer" }, onClick: () => toggleSort("value") }, "Value", /* @__PURE__ */ React.createElement("span", { className: "sort-arrow" }, arrow("value"))))), /* @__PURE__ */ React.createElement("tbody", null, body)));
  }
  platform2.registerDashboardTab({
    id: "global-maps",
    label: "Global Maps",
    order: 30,
    component: GlobalMapsTab
  });
}
export {
  register
};
