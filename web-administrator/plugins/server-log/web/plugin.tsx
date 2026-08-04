/*
 * Server Log — web admin plugin (React).
 *
 * Adds a "Server Log" tab to the dashboard, streaming the engine's log via the
 * bundled Server Log extension REST endpoint (GET /extensions/serverlog). Web
 * counterpart of com.mirth.connect.plugins.serverlog, presented as three
 * sortable columns — Timestamp | Level | Message (scope + message + collapsed
 * stack trace, truncated with an ellipsis) — defaulting to newest-first.
 * Level sorts by severity rank, not alphabetically. Double-clicking a row
 * opens the full entry, including the complete stack trace. A thin bottom
 * toolbar (pause, clear, log size) sticks to the bottom; the header sticks
 * to the top.
 *
 * React port: the tab is a {component} (useEffect polling, JSX table). The
 * fetch + newest-first sort + size-cap + level/scope normalization are reused
 * VERBATIM; only the rendering became React/JSX. The detail dialog stays an
 * imperative platform.ui.modal (built with platform.ui.h), which the contract
 * allows for imperative helpers.
 */

import { platform } from '@oie/web-shell';
import type { Platform } from '@oie/web-shell';
const React = platform.React;

const DEFAULT_LOG_SIZE = 100;
const POLL_MS = 5000;

const api = platform.api;
const { h, modal, toast } = platform.ui;

/* Date arrives as an XStream java.util.Date — a {time} object, an epoch
   number, or a string. Normalize to "yyyy-MM-dd HH:mm:ss.SSS". */
function formatLogDate(value: any) {
    if (value === null || value === undefined || value === '') return '';
    let millis = value;
    if (typeof value === 'object') millis = value.time ?? value.timestamp ?? null;
    const d = millis !== null && !isNaN(Number(millis)) ? new Date(Number(millis)) : new Date(String(value));
    if (isNaN(d.getTime())) return String(value);
    const p = (x: any, n = 2) => String(x).padStart(n, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
        `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/* Severity → token color (shared by the JSX row pill and the modal pill). */
function levelColor(level: any) {
    const lvl = String(level || '').toUpperCase();
    return lvl === 'ERROR' || lvl === 'FATAL' ? 'var(--err)'
        : lvl === 'WARN' ? 'var(--warn)'
            : lvl === 'INFO' ? 'var(--accent)'
                : 'var(--text-dim)';
}

/* JSX severity pill (used in the log rows). */
function LevelTag({ level, style }: any) {
    const lvl = String(level || '').toUpperCase();
    const color = levelColor(level);
    return <span className="tag font-[650]" style={{ color, borderColor: color, ...style }}>{lvl || '—'}</span>;
}

/* DOM severity pill (used inside the imperative detail modal via platform.ui.h). */
function levelTagDom(level: any) {
    const lvl = String(level || '').toUpperCase();
    const color = levelColor(level);
    return h('span.tag', { class: 'font-[650]', style: { color, borderColor: color } }, lvl || '—');
}

/* (category) or (category:lineNumber) — Swing ServerLogItem.toString. */
function scopeLabel(item: any) {
    const cat = String(item.category ?? '').trim();
    const line = String(item.lineNumber ?? '').trim();
    if (!cat) return '';
    return `(${cat}${line ? ':' + line : ''})`;
}

/* Raw epoch millis for the Timestamp column's sort (same normalization as
   formatLogDate). */
function logDateMillis(value: any) {
    if (value === null || value === undefined || value === '') return 0;
    let millis = value;
    if (typeof value === 'object') millis = value.time ?? value.timestamp ?? null;
    if (millis !== null && !isNaN(Number(millis))) return Number(millis);
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* Severity rank for the Level column's sort (severity order, not alphabetical). */
const LEVEL_RANK: Record<string, number> = { FATAL: 5, ERROR: 4, WARN: 3, INFO: 2, DEBUG: 1, TRACE: 0 };

/* The one-line remainder of an entry: scope + message + collapsed stack trace. */
function restText(item: any) {
    const stack = item.throwableInformation && String(item.throwableInformation).trim();
    return (`${scopeLabel(item)}: ${item.message ?? ''}`
        + (stack ? '  ' + stack : '')).replace(/\s+/g, ' ').trim();
}

/* The full single-string form Swing renders for one entry. */
function fullText(item: any) {
    let s = `[${formatLogDate(item.date)}]  ${String(item.level || '').toUpperCase()}  (${String(item.category ?? '')}`;
    const line = String(item.lineNumber ?? '').trim();
    if (line) s += ':' + line;
    s += `): ${item.message ?? ''}`;
    if (item.throwableInformation && String(item.throwableInformation).trim()) {
        s += '\n' + item.throwableInformation;
    }
    return s;
}

function copyText(text: any) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
            toast('Copied to clipboard');
            return;
        }
    } catch (e: any) { /* fall through */ }
    toast('Clipboard unavailable', 'warn');
}

function showDetail(item: any) {
    const stack = item.throwableInformation && String(item.throwableInformation).trim();
    // Theme tokens (not hardcoded colors) so the modal works in dark mode.
    const preClass = 'm-0 whitespace-pre-wrap [word-break:break-word] overflow-x-hidden overflow-y-auto bg-bg0 text-text border border-[var(--bg3)] p-2 rounded-[4px]';
    modal({
        title: 'Server Log Entry',
        size: 'wide',
        body: h('div', { class: 'flex flex-col gap-2 min-w-[558px]' },
            h('div', { class: 'flex gap-[13px] items-center flex-wrap' },
                levelTagDom(item.level),
                h('span.mono.text-text-faint', formatLogDate(item.date)),
                h('span.mono', scopeLabel(item))),
            h('div', { class: 'font-semibold' }, 'Message'),
            h('pre', { class: preClass + ' max-h-[30vh]' }, String(item.message ?? '')),
            stack ? h('div', { class: 'font-semibold' }, 'Stack Trace') : null,
            stack ? h('pre', { class: preClass + ' max-h-[60vh] text-[11px]' }, String(item.throwableInformation)) : null),
        buttons: [
            { label: 'Copy', onClick: () => { copyText(fullText(item)); return false; } },
            { label: 'Close', primary: true }
        ]
    });
}

/* One log row: Timestamp | Level | Message (scope, message + trace on one
   line, truncated with an ellipsis). */
function LogRow({ item }: any) {
    return (
        <tr className="cursor-pointer" title="Double-click for the full entry"
            onDoubleClick={() => showDetail(item)}>
            <td className="mono text-text-faint whitespace-nowrap text-[11px] w-[160px]">{formatLogDate(item.date)}</td>
            <td className="whitespace-nowrap w-[76px]"><LevelTag level={item.level} style={{ verticalAlign: 'middle' }} /></td>
            <td className="max-w-0 truncate text-[11px]">{restText(item)}</td>
        </tr>
    );
}

/* The polled Server Log tab. Owns its fetch loop (useEffect) + state. */
function ServerLogTab() {
    const [items, setItems] = React.useState([] as any[]);     // newest first
    const [paused, setPaused] = React.useState(false);
    const [logSize, setLogSize] = React.useState(DEFAULT_LOG_SIZE);
    const [sizeText, setSizeText] = React.useState(String(DEFAULT_LOG_SIZE));
    const [error, setError] = React.useState(null as any);
    // Column sort — timestamp-desc is the classic newest-first default.
    const [sort, setSort] = React.useState({ key: 'timestamp', dir: -1 });

    // Refs so the single poll loop reads live values without re-arming on
    // every state change (closures stay correct across the setTimeout chain).
    const itemsRef = React.useRef(items);
    const lastLogIdRef = React.useRef(null as any);
    const pausedRef = React.useRef(paused);
    const logSizeRef = React.useRef(logSize);
    const aliveRef = React.useRef(true);
    const timerRef = React.useRef(null as any);

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
                    fresh.sort((a: any, b: any) => Number(b.id) - Number(a.id));
                    lastLogIdRef.current = Number(fresh[0].id);
                    setItems((prev: any) => fresh.concat(prev).slice(0, logSizeRef.current));
                    setError(null);
                } else {
                    setError(null);   // reachable + empty: clear any prior error
                }
            } catch (e: any) {
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
        setPaused((prev: any) => {
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
        setItems((prev: any) => prev.length > n ? prev.slice(0, n) : prev);
    }

    const btnClass = 'py-[1px] px-1.5 h-[20px] leading-none';

    // Same header-sort convention as the core tables: click toggles direction
    // on the current column, else sorts the new column ascending.
    function handleSort(key: any) {
        setSort((s: any) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
    }
    const sortedItems = React.useMemo(() => {
        const val = (item: any) => sort.key === 'timestamp' ? logDateMillis(item.date)
            : sort.key === 'level' ? (LEVEL_RANK[String(item.level || '').toUpperCase()] ?? -1)
                : restText(item).toLowerCase();
        return [...items].sort((a: any, b: any) => {
            const va = val(a), vb = val(b);
            const cmp = (typeof va === 'number' && typeof vb === 'number')
                ? va - vb : String(va).localeCompare(String(vb));
            // Tiebreak on the log id so equal values keep a stable order.
            return (cmp || (Number(a.id) - Number(b.id))) * sort.dir;
        });
    }, [items, sort]);

    const headerTh = (key: any, label: any, extra = '') => (
        <th className={'sortable sticky top-0 z-[1] bg-bg2 text-left ' + extra} onClick={() => handleSort(key)}>
            {label}
            {sort.key === key ? <span className="sort-arrow">{sort.dir > 0 ? '▲' : '▼'}</span> : null}
        </th>
    );

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* scrollable log table */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                <table className="dt server-log w-full">
                    <thead>
                        <tr>
                            {headerTh('timestamp', 'Timestamp', 'w-[160px]')}
                            {headerTh('level', 'Level', 'w-[76px]')}
                            {headerTh('message', 'Message')}
                        </tr>
                    </thead>
                    <tbody>
                        {error && !items.length ? (
                            <tr><td colSpan={3} className="text-text-faint p-3">{`Server Log unavailable: ${error}`}</td></tr>
                        ) : !items.length ? (
                            <tr><td colSpan={3} className="text-text-faint p-3">No server log entries yet.</td></tr>
                        ) : (
                            sortedItems.map((item: any) => <LogRow key={item.id} item={item} />)
                        )}
                    </tbody>
                </table>
            </div>
            {/* thin sticky bottom toolbar: pause | clear | … | Log Size */}
            <div className="taskbar flex items-center gap-1.5 py-[3px] px-2 flex-none text-[11px] z-[2] bg-bg2 border-t border-[var(--bg3)]">
                <button className={"icon-btn " + btnClass} title="Pause or resume the live log" onClick={togglePause}>
                    <span className="text-[11.5px] leading-none">{paused ? '⏵' : '⏸'}</span>
                </button>
                <button className={"icon-btn " + btnClass} title="Clear the displayed log" onClick={clearLog}>
                    <span className="text-err font-bold">✕</span>
                </button>
                <span className="flex-1" />
                <label className="text-text-faint mr-0.5">Log Size:</label>
                <input type="number" min="1" max="99999" value={sizeText}
                    className="w-[54px] h-[20px] py-0 px-1 text-[11px]"
                    onChange={(e: any) => setSizeText(e.target.value)}
                    onBlur={applySize}
                    onKeyDown={(e: any) => { if (e.key === 'Enter') applySize(); }} />
                <button className={"icon-btn " + btnClass} title="Apply log size" onClick={applySize}>
                    <span className="text-ok font-bold">✓</span>
                </button>
            </div>
        </div>
    );
}

export function register(platform: Platform) {
    platform.registerDashboardTab({
        id: 'server-log',
        label: 'Server Log',
        order: 10,
        component: ServerLogTab
    });
}
