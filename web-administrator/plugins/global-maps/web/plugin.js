// plugins/global-maps/web/plugin.jsx
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
        { style: { display: "flex", flexDirection: "column", gap: "8px", minWidth: "620px" } },
        h(
          "div",
          { style: { display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "12px" } },
          h("span.mono.faint", `Server ${row.serverId}`),
          h("span.mono", row.channel),
          h("span.mono", { style: { fontWeight: "650" } }, row.key)
        ),
        h("pre", {
          style: {
            margin: "0",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "60vh",
            overflowX: "hidden",
            overflowY: "auto",
            background: "var(--bg0)",
            color: "var(--text)",
            border: "1px solid var(--bg3)",
            padding: "8px",
            borderRadius: "4px"
          }
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
    let body;
    if (error) {
      body = /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "faint", style: { padding: "12px" } }, `Global maps unavailable: ${error}`));
    } else if (!filtered.length) {
      body = /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 4, className: "faint", style: { padding: "12px" } }, "No global map variables are set."));
    } else {
      body = filtered.map((r, i) => {
        const value = r.value.replace(/\s+/g, " ").trim();
        return /* @__PURE__ */ React.createElement(
          "tr",
          {
            key: `${r.serverId}|${r.channelId}|${r.key}|${i}`,
            style: { cursor: "pointer" },
            title: "Double-click for the full value",
            onDoubleClick: () => showValue(r)
          },
          /* @__PURE__ */ React.createElement("td", { className: "mono faint" }, r.serverId),
          /* @__PURE__ */ React.createElement("td", null, r.channel),
          /* @__PURE__ */ React.createElement("td", { className: "mono", style: { fontWeight: "600" } }, r.key),
          /* @__PURE__ */ React.createElement("td", { className: "mono", style: { fontSize: "12px" } }, value)
        );
      });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "dt-wrap", style: { minHeight: "0" } }, /* @__PURE__ */ React.createElement("table", { className: "dt global-maps" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Server Id"), /* @__PURE__ */ React.createElement("th", null, "Channel"), /* @__PURE__ */ React.createElement("th", null, "Key"), /* @__PURE__ */ React.createElement("th", null, "Value"))), /* @__PURE__ */ React.createElement("tbody", null, body)));
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
