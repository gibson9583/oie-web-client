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
    return <span className="tag font-[650]" style={{ color, borderColor: color, ...style }}>{lvl || '—'}</span>;
}

/* DOM severity pill (used inside the imperative detail modal via platform.ui.h). */
function levelTagDom(level) {
    const lvl = String(level || '').toUpperCase();
    const color = levelColor(level);
    return h('span.tag', { class: 'font-[650]', style: { color, borderColor: color } }, lvl || '—');
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
    const preClass = 'm-0 whitespace-pre-wrap [word-break:break-word] overflow-x-hidden overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]';
    modal({
        title: 'Server Log Entry',
        size: 'wide',
        body: h('div', { class: 'flex flex-col gap-2 min-w-[620px]' },
            h('div', { class: 'flex gap-[14px] items-center flex-wrap' },
                levelTagDom(item.level),
                h('span.mono.text-text-faint', formatLogDate(item.date)),
                h('span.mono', scopeLabel(item))),
            h('div', { class: 'font-semibold' }, 'Message'),
            h('pre', { class: preClass + ' max-h-[30vh]' }, String(item.message ?? '')),
            stack ? h('div', { class: 'font-semibold' }, 'Stack Trace') : null,
            stack ? h('pre', { class: preClass + ' max-h-[60vh] text-[12px]' }, String(item.throwableInformation)) : null),
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
        <tr className="cursor-pointer" title="Double-click for the full entry"
            onDoubleClick={() => showDetail(item)}>
            <td className="max-w-0 truncate text-[12px]">
                <span className="mono text-text-faint mr-2">[{formatLogDate(item.date)}]</span>
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

    const btnClass = 'py-[1px] px-1.5 h-[22px] leading-none';

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* scrollable log table */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <table className="dt server-log w-full">
                    <thead>
                        <tr>
                            <th className="text-center sticky top-0 z-[1] bg-bg1">
                                Log Information
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {error && !items.length ? (
                            <tr><td className="text-text-faint p-3">{`Server Log unavailable: ${error}`}</td></tr>
                        ) : !items.length ? (
                            <tr><td className="text-text-faint p-3">No server log entries yet.</td></tr>
                        ) : (
                            items.map(item => <LogRow key={item.id} item={item} />)
                        )}
                    </tbody>
                </table>
            </div>
            {/* thin sticky bottom toolbar: pause | clear | … | Log Size */}
            <div className="taskbar flex items-center gap-1.5 py-[3px] px-2 flex-none text-[12px] z-[2] bg-bg1 border-t border-[var(--bg3)]">
                <button className={"icon-btn " + btnClass} title="Pause or resume the live log" onClick={togglePause}>
                    <span className="text-[13px] leading-none">{paused ? '⏵' : '⏸'}</span>
                </button>
                <button className={"icon-btn " + btnClass} title="Clear the displayed log" onClick={clearLog}>
                    <span className="text-err font-bold">✕</span>
                </button>
                <span className="flex-1" />
                <label className="text-text-faint mr-0.5">Log Size:</label>
                <input type="number" min="1" max="99999" value={sizeText}
                    className="w-[60px] h-[22px] py-0 px-1 text-[12px]"
                    onChange={(e) => setSizeText(e.target.value)}
                    onBlur={applySize}
                    onKeyDown={(e) => { if (e.key === 'Enter') applySize(); }} />
                <button className={"icon-btn " + btnClass} title="Apply log size" onClick={applySize}>
                    <span className="text-ok font-bold">✓</span>
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
