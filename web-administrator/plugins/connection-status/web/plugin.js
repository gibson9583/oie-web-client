/*
 * Connection Status — web admin plugin.
 *
 * Web counterpart of com.mirth.connect.plugins.dashboardstatus:
 *   - "Connection" dashboard column showing each channel's connector state
 *     (Idle, Connected, ...) from GET /extensions/dashboardstatus/connectorStates
 *   - "Connection Log" dashboard tab from GET /extensions/dashboardstatus/connectionLogs
 */

export function register(platform) {
    const { h, fmtNumber } = platform.ui;

    /* connectorStates is a Map<"channelId_metaDataId", Object[]> where the
       array holds a color name and a state label. Normalized defensively. */
    let states = new Map();
    let polling = false;
    let lastError = null;

    function stateOf(value) {
        // value may be ['black', 'Idle'], {string: ['black','Idle']}, or similar.
        const flat = [];
        (function walk(v) {
            if (v === null || v === undefined) return;
            if (Array.isArray(v)) { v.forEach(walk); return; }
            if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
            flat.push(String(v));
        })(value);
        return flat[flat.length - 1] || '';
    }

    async function poll() {
        try {
            const map = await platform.api.get('/extensions/dashboardstatus/connectorStates');
            const next = new Map();
            for (const entry of platform.api.asList(map?.entry)) {
                const values = Object.values(entry);
                const key = values.find(v => typeof v === 'string');
                if (key !== undefined) {
                    const value = values.find(v => v !== key);
                    next.set(key, stateOf(value));
                }
            }
            states = next;
            lastError = null;
        } catch (e) {
            lastError = e.message;
        }
    }

    function ensurePolling() {
        if (polling) return;
        polling = true;
        poll();
        setInterval(poll, 5000);
    }

    const dotColor = (state) => {
        const s = state.toLowerCase();
        if (!s || s === 'idle') return 'var(--idle)';
        if (s.includes('connect') || s.includes('receiv') || s.includes('send') || s.includes('read') || s.includes('writ') || s.includes('poll')) return 'var(--ok)';
        if (s.includes('wait')) return 'var(--warn)';
        return 'var(--busy)';
    };

    const cell = (state) => state
        ? h('span.status-cell',
            h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', background: dotColor(state), display: 'inline-block' } }),
            state)
        : '';

    platform.registerDashboardColumn({
        id: 'connection',
        label: 'Connection',
        order: 10,
        render(status) {
            ensurePolling();
            // Channel-level: show the source connector (metaDataId 0) state.
            return cell(states.get(`${status.channelId}_0`) || '');
        },
        renderConnector(child) {
            ensurePolling();
            return cell(states.get(`${child.channelId}_${child.metaDataId}`) || '');
        }
    });

    /* ---- Connection Log tab ---------------------------------------------------- */

    platform.registerDashboardTab({
        id: 'connection-log',
        label: 'Connection Log',
        order: 20,
        render(host, { selection }) {
            const table = h('table.dt');
            const wrap = h('div.dt-wrap', { style: { maxHeight: '260px' } }, table);
            host.appendChild(wrap);

            const CLOG_COLS = ['logId', 'timestamp', 'channel', 'connector', 'event', 'information'];
            const colMgr = platform.columns.createColumnManager('connection-log', {
                logId: 80, timestamp: 180, channel: 170, connector: 130, event: 110, information: 260
            });

            let timer = null;
            let started = false;
            async function refresh() {
                // Allow the first run even if rendered pre-attach; stop once removed.
                if (started && !host.isConnected) { clearTimeout(timer); return; }
                started = true;
                try {
                    const channelId = selection && selection.length === 1 ? selection[0].channelId : null;
                    const path = channelId
                        ? `/extensions/dashboardstatus/connectionLogs/${channelId}`
                        : '/extensions/dashboardstatus/connectionLogs';
                    const items = platform.api.asList(
                        await platform.api.get(path, { fetchSize: 100 }), 'connectionLogItem');
                    table.textContent = '';
                    table.appendChild(h('thead', h('tr',
                        h('th', 'Id'), h('th', 'Timestamp'), h('th', 'Channel'),
                        h('th', 'Connector'), h('th', 'Event'), h('th', 'Information'))));
                    const tbody = h('tbody');
                    for (const item of items) {
                        tbody.appendChild(h('tr',
                            h('td.num', fmtNumber(item.logId)),
                            h('td.mono', String(item.dateAdded ?? '')),
                            h('td', String(item.channelName ?? '')),
                            h('td', String(item.connectorType ?? '')),
                            h('td', cell(String(item.eventState ?? ''))),
                            h('td.mono', String(item.information ?? ''))));
                    }
                    table.appendChild(tbody);
                    platform.columns.decorateColumns(table, { manager: colMgr, presentKeys: CLOG_COLS, onChange: refresh });
                    if (!items.length) {
                        table.appendChild(h('caption', { style: { captionSide: 'bottom', padding: '14px', color: 'var(--text-faint)' } },
                            lastError ? `Connection log unavailable: ${lastError}` : 'No connection events yet.'));
                    }
                } catch (e) {
                    table.textContent = '';
                    table.appendChild(h('caption', { style: { padding: '14px', color: 'var(--text-faint)' } },
                        `Connection log unavailable: ${e.message}`));
                }
                timer = setTimeout(refresh, 5000);
            }
            refresh();
        }
    });
}
