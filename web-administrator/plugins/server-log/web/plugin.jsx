/*
 * Server Log — web admin plugin (React).
 *
 * Adds a "Server Log" tab to the dashboard, streaming the engine's log via the
 * bundled Server Log extension REST endpoint (GET /extensions/serverlog). Web
 * counterpart of com.mirth.connect.plugins.serverlog: a single "Log
 * Information" column where each row is the whole formatted entry —
 * [date] <pill> (category:lineNumber): message + stack trace — truncated with
 * an ellipsis at the right edge. Double-clicking a row opens the full entry,
 * including the complete stack trace. A thin bottom toolbar (pause, clear, log
 * size) sticks to the bottom; the header sticks to the top.
 *
 * React port: the tab is a {component} (useEffect polling, JSX table). The
 * fetch + newest-first sort + size-cap + level/scope normalization are reused
 * VERBATIM; only the rendering became React/JSX. The detail dialog stays an
 * imperative platform.ui.modal (built with platform.ui.h), which the contract
 * allows for imperative helpers.
 */

import { platform } from '@oie/web-shell';
const React = platform.React;

const DEFAULT_LOG_SIZE = 100;
const POLL_MS = 5000;

const api = platform.api;
const { h, modal, toast } = platform.ui;

/* Date arrives as an XStream java.util.Date — a {time} object, an epoch
   number, or a string. Normalize to "yyyy-MM-dd HH:mm:ss.SSS". */
function formatLogDate(value) {
    if (value === null || value === undefined || value === '') return '';
    let millis = value;
    if (typeof value === 'object') millis = value.time ?? value.timestamp ?? null;
    const d = millis !== null && !isNaN(Number(millis)) ? new Date(Number(millis)) : new Date(String(value));
    if (isNaN(d.getTime())) return String(value);
    const p = (x, n = 2) => String(x).padStart(n, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/* Severity → token color (shared by the JSX row pill and the modal pill). */
function levelColor(level) {
    const lvl = String(level || '').toUpperCase();
    return lvl === 'ERROR' || lvl === 'FATAL' ? 'var(--err)'
        : lvl === 'WARN' ? 'var(--warn)'
            : lvl === 'INFO' ? 'var(--accent)'
                : 'var(--text-dim)';
}

/* JSX severity pill (used in the log rows). */
function LevelTag({ level, style }) {
    const lvl = String(level || '').toUpperCase();
    const color = levelColor(level);
    return <span className="tag" style={{ color, borderColor: color, fontWeight: '650', ...style }}>{lvl || '—'}</span>;
}

/* DOM severity pill (used inside the imperative detail modal via platform.ui.h). */
function levelTagDom(level) {
    const lvl = String(level || '').toUpperCase();
    const color = levelColor(level);
    return h('span.tag', { style: { color, borderColor: color, fontWeight: '650' } }, lvl || '—');
}

/* (category) or (category:lineNumber) — Swing ServerLogItem.toString. */
function scopeLabel(item) {
    const cat = String(item.category ?? '').trim();
    const line = String(item.lineNumber ?? '').trim();
    if (!cat) return '';
    return `(${cat}${line ? ':' + line : ''})`;
}

/* The full single-string form Swing renders for one entry. */
function fullText(item) {
    let s = `[${formatLogDate(item.date)}]  ${String(item.level || '').toUpperCase()}  (${String(item.category ?? '')}`;
    const line = String(item.lineNumber ?? '').trim();
    if (line) s += ':' + line;
    s += `): ${item.message ?? ''}`;
    if (item.throwableInformation && String(item.throwableInformation).trim()) {
        s += '\n' + item.throwableInformation;
    }
    return s;
}

function copyText(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            toast('Copied to clipboard');
            return;
        }
    } catch (e) { /* fall through */ }
    toast('Clipboard unavailable', 'warn');
}

function showDetail(item) {
    const stack = item.throwableInformation && String(item.throwableInformation).trim();
    // Theme tokens (not hardcoded colors) so the modal works in dark mode.
    const preStyle = {
        margin: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        overflowX: 'hidden', overflowY: 'auto', background: 'var(--bg0)',
        color: 'var(--text)', border: '1px solid var(--bg3)', padding: '8px', borderRadius: '4px'
    };
    modal({
        title: 'Server Log Entry',
        size: 'wide',
        body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '620px' } },
            h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
                levelTagDom(item.level),
                h('span.mono.faint', formatLogDate(item.date)),
                h('span.mono', scopeLabel(item))),
            h('div', { style: { fontWeight: '600' } }, 'Message'),
            h('pre', { style: { ...preStyle, maxHeight: '30vh' } }, String(item.message ?? '')),
            stack ? h('div', { style: { fontWeight: '600' } }, 'Stack Trace') : null,
            stack ? h('pre', { style: { ...preStyle, maxHeight: '60vh', fontSize: '12px' } }, String(item.throwableInformation)) : null),
        buttons: [
            { label: 'Copy', onClick: () => { copyText(fullText(item)); return false; } },
            { label: 'Close', primary: true }
        ]
    });
}

/* One log row: timestamp, severity pill, then the rest of the entry (scope,
   message + trace) on one line, truncated with an ellipsis. */
function LogRow({ item }) {
    const stack = item.throwableInformation && String(item.throwableInformation).trim();
    const rest = (`${scopeLabel(item)}: ${item.message ?? ''}`
        + (stack ? '  ' + stack : '')).replace(/\s+/g, ' ').trim();
    return (
        <tr style={{ cursor: 'pointer' }} title="Double-click for the full entry"
            onDoubleClick={() => showDetail(item)}>
            <td style={{ maxWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px' }}>
                <span className="mono faint" style={{ marginRight: '8px' }}>[{formatLogDate(item.date)}]</span>
                <LevelTag level={item.level} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
                {rest}
            </td>
        </tr>
    );
}

/* The polled Server Log tab. Owns its fetch loop (useEffect) + state. */
function ServerLogTab() {
    const [items, setItems] = React.useState([]);     // newest first
    const [paused, setPaused] = React.useState(false);
    const [logSize, setLogSize] = React.useState(DEFAULT_LOG_SIZE);
    const [sizeText, setSizeText] = React.useState(String(DEFAULT_LOG_SIZE));
    const [error, setError] = React.useState(null);

    // Refs so the single poll loop reads live values without re-arming on
    // every state change (closures stay correct across the setTimeout chain).
    const itemsRef = React.useRef(items);
    const lastLogIdRef = React.useRef(null);
    const pausedRef = React.useRef(paused);
    const logSizeRef = React.useRef(logSize);
    const aliveRef = React.useRef(true);
    const timerRef = React.useRef(null);

    itemsRef.current = items;
    pausedRef.current = paused;
    logSizeRef.current = logSize;

    // Single poll loop; arms exactly one pending timer at a time. Reuses the
    // legacy fetch + newest-first sort + size cap VERBATIM.
    const poll = React.useCallback(async function poll() {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        if (!aliveRef.current) return;
        if (!pausedRef.current) {
            try {
                const raw = await api.get('/extensions/serverlog', { fetchSize: logSizeRef.current, lastLogId: lastLogIdRef.current });
                if (!aliveRef.current) return;
                const fresh = api.asList(raw, 'serverLogItem');
                if (fresh.length) {
                    // Server returns items with id > lastLogId; show newest first.
                    fresh.sort((a, b) => Number(b.id) - Number(a.id));
                    lastLogIdRef.current = Number(fresh[0].id);
                    setItems(prev => fresh.concat(prev).slice(0, logSizeRef.current));
                    setError(null);
                } else {
                    setError(null);   // reachable + empty: clear any prior error
                }
            } catch (e) {
                if (!itemsRef.current.length) setError(e.message);
            }
        }
        if (aliveRef.current) timerRef.current = setTimeout(poll, POLL_MS);
    }, []);

    React.useEffect(() => {
        aliveRef.current = true;
        poll();
        return () => {
            aliveRef.current = false;
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        };
    }, [poll]);

    function togglePause() {
        setPaused(prev => {
            const next = !prev;
            pausedRef.current = next;
            if (!next) poll();   // resume immediately
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
        setItems(prev => prev.length > n ? prev.slice(0, n) : prev);
    }

    const btnStyle = { padding: '1px 6px', height: '22px', lineHeight: '1' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' }}>
            {/* scrollable log table */}
            <div style={{ flex: '1', minHeight: '0', overflowY: 'auto', overflowX: 'hidden' }}>
                <table className="dt server-log" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ textAlign: 'center', position: 'sticky', top: '0', zIndex: '1', background: 'var(--bg1)' }}>
                                Log Information
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {error && !items.length ? (
                            <tr><td className="faint" style={{ padding: '12px' }}>{`Server Log unavailable: ${error}`}</td></tr>
                        ) : !items.length ? (
                            <tr><td className="faint" style={{ padding: '12px' }}>No server log entries yet.</td></tr>
                        ) : (
                            items.map(item => <LogRow key={item.id} item={item} />)
                        )}
                    </tbody>
                </table>
            </div>
            {/* thin sticky bottom toolbar: pause | clear | … | Log Size */}
            <div className="taskbar" style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px',
                flex: 'none', fontSize: '12px', zIndex: '2',
                background: 'var(--bg1)', borderTop: '1px solid var(--bg3)'
            }}>
                <button className="icon-btn" title="Pause or resume the live log" style={btnStyle} onClick={togglePause}>
                    <span style={{ fontSize: '13px', lineHeight: '1' }}>{paused ? '⏵' : '⏸'}</span>
                </button>
                <button className="icon-btn" title="Clear the displayed log" style={btnStyle} onClick={clearLog}>
                    <span style={{ color: 'var(--err)', fontWeight: '700' }}>✕</span>
                </button>
                <span style={{ flex: '1' }} />
                <label className="faint" style={{ marginRight: '2px' }}>Log Size:</label>
                <input type="number" min="1" max="99999" value={sizeText}
                    style={{ width: '60px', height: '22px', padding: '0 4px', fontSize: '12px' }}
                    onChange={(e) => setSizeText(e.target.value)}
                    onBlur={applySize}
                    onKeyDown={(e) => { if (e.key === 'Enter') applySize(); }} />
                <button className="icon-btn" title="Apply log size" style={btnStyle} onClick={applySize}>
                    <span style={{ color: 'var(--ok)', fontWeight: '700' }}>✓</span>
                </button>
            </div>
        </div>
    );
}

export function register(platform) {
    platform.registerDashboardTab({
        id: 'server-log',
        label: 'Server Log',
        order: 10,
        component: ServerLogTab
    });
}
