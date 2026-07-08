/*
 * Connection Status — web admin plugin (React).
 *
 * Web counterpart of com.mirth.connect.plugins.dashboardstatus:
 *   - "Connection" dashboard column showing each channel's connector state
 *     (Idle, Connected, ...) from GET /extensions/dashboardstatus/connectorStates
 *   - "Connection Log" dashboard tab from GET /extensions/dashboardstatus/connectionLogs
 *
 * Authored in JSX against the host's React (platform.React) so plugin components
 * share the app's single React instance. The data-fetch + normalization logic is
 * the same as the original imperative plugin; only the rendering is React/JSX.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

export function register(platform) {
    const { fmtNumber } = platform.ui;

    /* connectorStates is a Map<"channelId_metaDataId", Object[]> where the
       array holds a color name and a state label. Normalized defensively.
       Lives at module/register scope; the 5s poll mutates it and the column
       cells read it (kicked off lazily on the first cell() call). */
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
        // Only hit the engine while the dashboard is on screen. This feeds the
        // dashboard's Connection column and tab; polling from every view would waste
        // engine calls and reset the session's inactivity timeout forever (matching
        // Swing, whose status updater also stops off the dashboard).
        const path = (platform.router && platform.router.currentPath && platform.router.currentPath()) || '';
        if (!(path === '/' || path === '/dashboard' || path.startsWith('/dashboard?') || path.startsWith('/dashboard/'))) {
            return;
        }
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

    // Cell content for a connection state (JSX): a colored dot + the state label.
    const StateCell = (state) => state
        ? (
            <span className="status-cell">
                <span className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: dotColor(state) }} />
                {state}
            </span>
        )
        : '';

    platform.registerDashboardColumn({
        id: 'connection',
        label: 'Connection',
        order: 10,
        // Channel-level: show the source connector (metaDataId 0) state.
        cell(status) {
            ensurePolling();
            return StateCell(states.get(`${status.channelId}_0`) || '');
        },
        connectorCell(child) {
            ensurePolling();
            return StateCell(states.get(`${child.channelId}_${child.metaDataId}`) || '');
        }
    });

    /* ---- Connection Log tab ---------------------------------------------------- */

    function ConnectionLogTab({ selection }) {
        const [items, setItems] = React.useState([]);
        const [error, setError] = React.useState(null);

        // selection is the dashboard's current selection (array of rows). A
        // single connector row carries metaDataId, scoping the log to it.
        const sel = selection && selection.length === 1 ? selection[0] : null;
        const channelId = sel ? sel.channelId : null;
        const metaDataId = sel && sel.metaDataId != null ? Number(sel.metaDataId) : null;

        React.useEffect(() => {
            let timer = null;
            let cancelled = false;

            async function refresh() {
                try {
                    const path = channelId
                        ? `/extensions/dashboardstatus/connectionLogs/${channelId}`
                        : '/extensions/dashboardstatus/connectionLogs';
                    let next = platform.api.asList(
                        await platform.api.get(path, { fetchSize: 100 }), 'connectionLogItem');
                    // When a single connector row is selected, scope the
                    // (per-channel) log to that connector.
                    if (metaDataId != null) next = next.filter(it => Number(it.metadataId) === metaDataId);
                    if (cancelled) return;
                    setItems(next);
                    setError(null);
                } catch (e) {
                    if (cancelled) return;
                    setItems([]);
                    setError(e.message);
                }
                if (!cancelled) timer = setTimeout(refresh, 5000);
            }
            refresh();

            return () => { cancelled = true; if (timer) clearTimeout(timer); };
            // Re-scope (and reset the poll loop) whenever the selection changes.
        }, [channelId, metaDataId]);

        return (
            <div className="dt-wrap max-h-[260px]">
                <table className="dt">
                    <thead>
                        <tr>
                            <th>Id</th>
                            <th>Timestamp</th>
                            <th>Channel</th>
                            <th>Connector</th>
                            <th>Event</th>
                            <th>Information</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, i) => (
                            <tr key={item.logId != null ? `log-${item.logId}` : `row-${i}`}>
                                <td className="num">{fmtNumber(item.logId)}</td>
                                <td className="mono">{String(item.dateAdded ?? '')}</td>
                                <td>{String(item.channelName ?? '')}</td>
                                <td>{String(item.connectorType ?? '')}</td>
                                <td>{StateCell(String(item.eventState ?? ''))}</td>
                                <td className="mono">{String(item.information ?? '')}</td>
                            </tr>
                        ))}
                    </tbody>
                    {!items.length && (
                        <caption className="[caption-side:bottom] p-3.5 text-text-faint">
                            {error
                                ? `Connection log unavailable: ${error}`
                                : (lastError ? `Connection log unavailable: ${lastError}` : 'No connection events yet.')}
                        </caption>
                    )}
                </table>
            </div>
        );
    }

    platform.registerDashboardTab({
        id: 'connection-log',
        label: 'Connection Log',
        order: 20,
        component: ConnectionLogTab
    });
}
