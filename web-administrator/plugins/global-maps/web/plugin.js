/*
 * Global Maps — web admin plugin.
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
 * shows). Selection changes arrive via the 'dashboard:selection' event.
 */

const GLOBAL_MAP_LABEL = '<Global Map>';

export function register(platform) {
    const { h, clear, modal } = platform.ui;
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

    function showValue(row) {
        modal({
            title: 'Global Map Value',
            size: 'wide',
            body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '620px' } },
                h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px' } },
                    h('span.mono.faint', `Server ${row.serverId}`),
                    h('span.mono', row.channel),
                    h('span.mono', { style: { fontWeight: '650' } }, row.key)),
                h('pre', {
                    style: {
                        margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        maxHeight: '60vh', overflowX: 'hidden', overflowY: 'auto',
                        background: 'var(--bg0)', color: 'var(--text)', border: '1px solid var(--bg3)',
                        padding: '8px', borderRadius: '4px'
                    }
                }, row.value)),
            buttons: [{ label: 'Close', primary: true }]
        });
    }

    platform.registerDashboardTab({
        id: 'global-maps',
        label: 'Global Maps',
        order: 30,
        render(host, ctx) {
            let rows = [];                       // flat: { serverId, channelId, channel, key, value }
            let selectedIds = new Set((ctx && ctx.selection || []).map(s => String(s.channelId)));
            let timer = null;
            let started = false;
            let unsub = () => {};

            const table = h('table.dt.global-maps');
            host.appendChild(h('div', { style: { minHeight: '0' } }, table));

            const GM_COLS = ['serverId', 'channel', 'key', 'value'];
            const colMgr = platform.columns.createColumnManager('global-maps',
                { serverId: 180, channel: 180, key: 220, value: 300 });

            // Rebuild the whole table (header + body) so column order/widths
            // re-apply cleanly, then make the columns resizable/reorderable.
            function renderRows() {
                clear(table);
                const thead = h('thead', h('tr',
                    h('th', 'Server Id'), h('th', 'Channel'), h('th', 'Key'), h('th', 'Value')));
                const tbody = h('tbody');
                // Global map always shows; channel maps filter to the dashboard
                // selection (all channels when nothing is selected).
                const filtered = rows.filter(r =>
                    r.channelId === null || !selectedIds.size || selectedIds.has(String(r.channelId)));
                if (!filtered.length) {
                    tbody.appendChild(h('tr', h('td', { colSpan: 4, class: 'faint', style: { padding: '12px' } },
                        'No global map variables are set.')));
                } else {
                    for (const r of filtered) {
                        const value = r.value.replace(/\s+/g, ' ').trim();
                        tbody.appendChild(h('tr', {
                            style: { cursor: 'pointer' }, title: 'Double-click for the full value',
                            ondblclick: () => showValue(r)
                        },
                            h('td.mono.faint', r.serverId),
                            h('td', r.channel),
                            h('td.mono', { style: { fontWeight: '600' } }, r.key),
                            h('td.mono', { style: { fontSize: '12px' } }, value)));
                    }
                }
                table.appendChild(thead);
                table.appendChild(tbody);
                platform.columns.decorateColumns(table, { manager: colMgr, presentKeys: GM_COLS, onChange: renderRows });
            }

            async function refresh() {
                if (started && !host.isConnected) { clearTimeout(timer); unsub(); return; }
                started = true;
                try {
                    const idPairs = mapEntries(await api.channels.idsAndNames().catch(() => null));
                    const idsAndNames = new Map(idPairs.map(([id, name]) => [String(id), String(name)]));
                    const channelIds = [...idsAndNames.keys()];

                    const all = await api.post(
                        '/extensions/globalmapviewer/maps/_getAllMaps',
                        { set: { string: channelIds } },
                        { params: { includeGlobalMap: true } });

                    rows = [];
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
                    renderRows();
                } catch (e) {
                    clear(tbody);
                    tbody.appendChild(h('tr', h('td', { colSpan: 4, class: 'faint', style: { padding: '12px' } },
                        `Global maps unavailable: ${e.message}`)));
                }
                timer = setTimeout(refresh, 10000);
            }

            // Re-filter (no refetch) when the channel selection above changes.
            unsub = platform.events.on('dashboard:selection', (sel) => {
                if (!host.isConnected) { unsub(); return; }
                selectedIds = new Set((sel || []).map(s => String(s.channelId)));
                renderRows();
            });

            refresh();
        }
    });
}
