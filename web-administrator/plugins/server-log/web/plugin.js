/*
 * Server Log — web admin plugin.
 *
 * Adds a "Server Log" tab to the dashboard, streaming the engine's log via the
 * bundled Server Log extension REST endpoint (GET /extensions/serverlog). Web
 * counterpart of com.mirth.connect.plugins.serverlog: a single "Log
 * Information" column where each row is the whole formatted entry —
 * [date] <pill> (category:lineNumber): message + stack trace — truncated with
 * an ellipsis at the right edge. Double-clicking a row opens the full entry,
 * including the complete stack trace. A thin bottom toolbar (pause, clear, log
 * size) sticks to the bottom; the header sticks to the top.
 */

const DEFAULT_LOG_SIZE = 100;
const POLL_MS = 5000;

export function register(platform) {
    const { h, clear, modal, toast } = platform.ui;
    const api = platform.api;

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

    function levelTag(level) {
        const lvl = String(level || '').toUpperCase();
        const color = lvl === 'ERROR' || lvl === 'FATAL' ? 'var(--err)'
            : lvl === 'WARN' ? 'var(--warn)'
                : lvl === 'INFO' ? 'var(--accent)'
                    : 'var(--text-dim)';
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
                    levelTag(item.level),
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

    function renderServerLog(host) {
        let items = [];          // newest first
        let lastLogId = null;
        let paused = false;
        let logSize = DEFAULT_LOG_SIZE;
        let timer = null;

        const tbody = h('tbody');

        // ---- thin sticky bottom toolbar: pause | clear | … | Log Size ----
        const btnStyle = { padding: '1px 6px', height: '22px', lineHeight: '1' };
        const pauseGlyph = h('span', { style: { fontSize: '13px', lineHeight: '1' } }, '⏸');
        const pauseBtn = h('button.icon-btn', {
            title: 'Pause or resume the live log', style: btnStyle,
            onClick: () => {
                paused = !paused;
                pauseGlyph.textContent = paused ? '⏵' : '⏸';
                if (!paused) poll();
            }
        }, pauseGlyph);
        const clearBtn = h('button.icon-btn', {
            title: 'Clear the displayed log', style: btnStyle,
            onClick: () => { items = []; renderRows(); }
        }, h('span', { style: { color: 'var(--err)', fontWeight: '700' } }, '✕'));

        const sizeInput = h('input', {
            type: 'number', min: '1', max: '99999', value: String(logSize),
            style: { width: '60px', height: '22px', padding: '0 4px', fontSize: '12px' }
        });
        const applySize = () => {
            const n = Math.max(1, Math.min(99999, parseInt(sizeInput.value, 10) || DEFAULT_LOG_SIZE));
            logSize = n; sizeInput.value = String(n);
            if (items.length > logSize) { items = items.slice(0, logSize); renderRows(); }
        };
        sizeInput.addEventListener('change', applySize);
        const applyBtn = h('button.icon-btn', { title: 'Apply log size', style: btnStyle, onClick: applySize },
            h('span', { style: { color: 'var(--ok)', fontWeight: '700' } }, '✓'));

        const toolbar = h('div.taskbar', {
            style: {
                display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px',
                flex: 'none', fontSize: '12px', zIndex: '2',
                background: 'var(--bg1)', borderTop: '1px solid var(--bg3)'
            }
        },
            pauseBtn, clearBtn,
            h('span', { style: { flex: '1' } }),
            h('label.faint', { style: { marginRight: '2px' } }, 'Log Size:'), sizeInput, applyBtn);

        // ---- single "Log Information" column ----
        const table = h('table.dt.server-log', { style: { width: '100%' } },
            h('thead', h('tr', h('th', {
                style: { textAlign: 'center', position: 'sticky', top: '0', zIndex: '1', background: 'var(--bg1)' }
            }, 'Log Information'))),
            tbody);

        function renderRows() {
            clear(tbody);
            if (!items.length) {
                tbody.appendChild(h('tr', h('td', { class: 'faint', style: { padding: '12px' } },
                    'No server log entries yet.')));
                return;
            }
            for (const item of items) {
                const stack = item.throwableInformation && String(item.throwableInformation).trim();
                // Timestamp, severity pill, then the rest of the entry (scope,
                // message + trace) on one line, truncated with an ellipsis.
                const ts = h('span.mono.faint', { style: { marginRight: '8px' } }, `[${formatLogDate(item.date)}]`);
                const pill = levelTag(item.level);
                pill.style.verticalAlign = 'middle';
                pill.style.marginRight = '8px';
                const rest = (`${scopeLabel(item)}: ${item.message ?? ''}`
                    + (stack ? '  ' + stack : '')).replace(/\s+/g, ' ').trim();
                const tr = h('tr', {
                    style: { cursor: 'pointer' },
                    title: 'Double-click for the full entry',
                    ondblclick: () => showDetail(item)
                }, h('td', { style: { maxWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '12px' } },
                    ts, pill, rest));
                tbody.appendChild(tr);
            }
        }

        async function poll() {
            if (timer) { clearTimeout(timer); timer = null; }                 // single loop only
            if (!host.isConnected && lastLogId !== null) return;              // tab unmounted (allow first run)
            if (!paused) {
                try {
                    const raw = await api.get('/extensions/serverlog', { fetchSize: logSize, lastLogId });
                    const fresh = api.asList(raw, 'serverLogItem');
                    if (fresh.length) {
                        // Server returns items with id > lastLogId; show newest first.
                        fresh.sort((a, b) => Number(b.id) - Number(a.id));
                        lastLogId = Number(fresh[0].id);
                        items = fresh.concat(items).slice(0, logSize);
                        renderRows();
                    } else if (lastLogId === null) {
                        renderRows();   // first run with no entries
                    }
                } catch (e) {
                    if (!items.length) {
                        clear(tbody);
                        tbody.appendChild(h('tr', h('td', { class: 'faint', style: { padding: '12px' } },
                            `Server Log unavailable: ${e.message}`)));
                    }
                }
            }
            timer = setTimeout(poll, POLL_MS);
        }

        renderRows();
        poll();

        // Fill the tab body as a column: the log table scrolls in the middle and
        // the toolbar stays docked at the bottom edge (matching the Swing layout),
        // so resizing the panel no longer floats the toolbar up under the rows.
        Object.assign(host.style, { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' });
        const scroll = h('div', { style: { flex: '1', minHeight: '0', overflowY: 'auto', overflowX: 'hidden' } }, table);
        host.appendChild(scroll);
        host.appendChild(toolbar);
    }

    platform.registerDashboardTab({
        id: 'server-log',
        label: 'Server Log',
        order: 10,
        render: (host) => renderServerLog(host)
    });
}
