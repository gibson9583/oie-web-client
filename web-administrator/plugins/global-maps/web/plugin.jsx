/*
 * Global Maps — web admin plugin (React).
 *
 * Web counterpart of com.mirth.connect.plugins.globalmapviewer: a dashboard tab
 * with a single flat table — Server Id | Channel | Key | Value — showing the
 * global map (Channel = "<Global Map>") and each channel's global channel map,
 * via POST /extensions/globalmapviewer/maps/_getAllMaps (channel id set in the
 * body, includeGlobalMap=true). Response shape:
 *   Map<serverId, Map<channelId|null, Map<key, xstream-serialized value>>>
 *
 * Context sensitive: when channels are selected in the dashboard table above,
 * the channel-map rows are filtered to that selection (the global map always
 * shows). Selection arrives via the tab component's `selection` prop (an array
 * of selected status rows; a single connector row carries metaDataId).
 */

import { platform } from '@oie/web-shell';
const React = platform.React;

const GLOBAL_MAP_LABEL = '<Global Map>';

export function register(platform) {
    const { h, modal } = platform.ui;
    const api = platform.api;

    /* XStream map JSON entries arrive as {entry:[...]} with a singleton as a
       bare object. Each entry is either {string:[k,v]} (string→string pair)
       or {<keyType>:k, <valueType>:v} — including {null:null, map:{...}} for
       the global map's null key. */
    function mapEntries(value) {
        const out = [];
        for (const entry of api.asList(value?.entry)) {
            if (entry === null || typeof entry !== 'object') continue;
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

    /* Values are serialized with XStream ("<string>THIS</string>") — show the
       payload, not the wrapper. */
    function displayValue(value) {
        if (value === null || value === undefined) return '';
        const s = String(value);
        if (s.trim().startsWith('<')) {
            try {
                const parsed = api.parseBody(s);
                if (parsed === null || parsed === undefined) return s;
                return typeof parsed === 'object' ? JSON.stringify(parsed, null, 1) : String(parsed);
            } catch (e) { /* show raw */ }
        }
        return s;
    }

    /* Click-to-view full value — imperative dialog via platform.ui.modal. The
       modal body is built with platform.ui.h (an imperative helper, not the
       React tree), matching the original. */
    function showValue(row) {
        modal({
            title: 'Global Map Value',
            size: 'wide',
            body: h('div', { class: 'flex flex-col gap-2 min-w-[620px]' },
                h('div', { class: 'flex gap-[14px] flex-wrap text-[12px]' },
                    h('span.mono.text-text-faint', `Server ${row.serverId}`),
                    h('span.mono', row.channel),
                    h('span.mono', { class: 'font-[650]' }, row.key)),
                h('pre', {
                    class: 'm-0 whitespace-pre-wrap [word-break:break-word] max-h-[60vh] overflow-x-hidden overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]'
                }, row.value)),
            buttons: [{ label: 'Close', primary: true }]
        });
    }

    /* Fetch the global + per-channel maps once and return flat rows:
       { serverId, channelId, channel, key, value }. */
    async function fetchRows() {
        const idPairs = mapEntries(await api.channels.idsAndNames().catch(() => null));
        const idsAndNames = new Map(idPairs.map(([id, name]) => [String(id), String(name)]));
        const channelIds = [...idsAndNames.keys()];

        const all = await api.post(
            '/extensions/globalmapviewer/maps/_getAllMaps',
            { set: { string: channelIds } },
            { params: { includeGlobalMap: true } });

        const rows = [];
        for (const [serverId, serverMaps] of mapEntries(all)) {
            for (const [channelId, map] of mapEntries(serverMaps)) {
                const isGlobal = channelId === null || channelId === undefined || channelId === 'null';
                const chId = isGlobal ? null : String(channelId);
                const channel = isGlobal ? GLOBAL_MAP_LABEL : (idsAndNames.get(chId) || chId);
                for (const [k, v] of mapEntries(map)) {
                    rows.push({ serverId: String(serverId), channelId: chId, channel, key: String(k), value: displayValue(v) });
                }
            }
        }
        return rows;
    }

    /* Dashboard tab component. Owns its data fetch + 10s poll; filters rows to
       the dashboard selection on every render (global map always shows). */
    function GlobalMapsTab({ selection }) {
        const [rows, setRows] = React.useState([]);
        const [error, setError] = React.useState(null);
        const mountedRef = React.useRef(true);

        // Selected channel ids from the dashboard selection above (a single
        // connector row carries metaDataId but still a channelId).
        const selectedIds = React.useMemo(
            () => new Set((selection || []).map(s => String(s.channelId))),
            [selection]);

        // Fetch once on mount and poll every 10s; self-stops on unmount.
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
                if (mountedRef.current) timer = setTimeout(refresh, 10000);
            };
            refresh();
            return () => { mountedRef.current = false; if (timer) clearTimeout(timer); };
        }, []);

        // Global map always shows; channel maps filter to the dashboard
        // selection (all channels when nothing is selected).
        const filtered = rows.filter(r =>
            r.channelId === null || !selectedIds.size || selectedIds.has(String(r.channelId)));

        let body;
        if (error) {
            body = (
                <tr><td colSpan={4} className="text-text-faint p-3">
                    {`Global maps unavailable: ${error}`}
                </td></tr>
            );
        } else if (!filtered.length) {
            body = (
                <tr><td colSpan={4} className="text-text-faint p-3">
                    No global map variables are set.
                </td></tr>
            );
        } else {
            body = filtered.map((r, i) => {
                const value = r.value.replace(/\s+/g, ' ').trim();
                return (
                    <tr key={`${r.serverId}|${r.channelId}|${r.key}|${i}`}
                        className="cursor-pointer" title="Double-click for the full value"
                        onDoubleClick={() => showValue(r)}>
                        <td className="mono text-text-faint">{r.serverId}</td>
                        <td>{r.channel}</td>
                        <td className="mono font-semibold">{r.key}</td>
                        <td className="mono text-[12px]">{value}</td>
                    </tr>
                );
            });
        }

        return (
            <div className="dt-wrap min-h-0">
                <table className="dt global-maps">
                    <thead>
                        <tr>
                            <th>Server Id</th>
                            <th>Channel</th>
                            <th>Key</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>{body}</tbody>
                </table>
            </div>
        );
    }

    platform.registerDashboardTab({
        id: 'global-maps',
        label: 'Global Maps',
        order: 30,
        component: GlobalMapsTab
    });
}
