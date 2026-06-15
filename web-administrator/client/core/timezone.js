/*
 * Timestamp time zone (ported from oie-browser). Every timestamp the admin
 * displays is rendered in the resolved zone, so an operator in one region can
 * read an engine running in another. Mode cycles Server -> Local -> UTC:
 *   - server : the engine's configured zone (GET /server/timezone)
 *   - local  : this browser's zone
 *   - utc    : UTC
 * The chosen mode is persisted per-browser in localStorage. fmtDate() (core/ui)
 * formats through formatInZone() below, so changing the mode and re-rendering a
 * view restamps every date at once.
 */

import { server } from './api.js';

const MODE_KEY = 'webadmin-tz-mode';
const MODES = ['server', 'local', 'utc'];
const LOCAL_TZ = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (e) { return 'UTC'; }
})();

let mode = (() => {
    let v = null;
    try { v = localStorage.getItem(MODE_KEY); } catch (e) { /* private mode */ }
    return MODES.includes(v) ? v : 'server';
})();
// The engine's GET /server/timezone returns a DISPLAY string built from the
// server JVM's default zone, e.g. "EDT (UTC -4)" or "GMT (UTC +0)" — NOT an IANA
// zone id. So we parse the (integer-hour) UTC offset out of it and render Server
// mode at that fixed offset via an Etc/GMT zone (sign inverted: Etc/GMT+4 = UTC-4).
// `serverZone` is that fixed-offset zone; `serverLabel` keeps the engine's short
// name (e.g. "EDT") for the toggle. Caveat: the engine truncates to whole hours,
// so half-hour zones (e.g. UTC+5:30) are shown at the truncated hour.
let serverZone = '';        // 'UTC' | 'Etc/GMT±N' — populated async
let serverLabel = '';       // engine short name for display, e.g. "EDT"
let fetched = false;
const listeners = new Set();

/** Subscribe to mode/server-zone changes. Returns an unsubscribe function. */
export function onTimezoneChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit() { for (const cb of listeners) { try { cb(); } catch (e) { /* listener error */ } } }

export function timezoneMode() { return mode; }
export function serverTimezone() { return serverLabel || serverZone; }

export function setTimezoneMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    mode = next;
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
    emit();
}

export function cycleTimezone() {
    setTimezoneMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
}

/** The zone the current mode resolves to (server mode falls back to UTC). */
export function resolvedZone() {
    if (mode === 'utc') return 'UTC';
    if (mode === 'local') return LOCAL_TZ;
    return serverZone || 'UTC';
}

/** Short zone abbreviation for a label, e.g. "EST", "PDT", "UTC". */
export function tzAbbr(zone = resolvedZone()) {
    if (zone === 'UTC') return 'UTC';
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date());
        return parts.find(p => p.type === 'timeZoneName')?.value || zone;
    } catch (e) { return zone; }
}

/** Abbreviation for the current mode — uses the engine's own short name in
    Server mode (e.g. "EDT"), since the parsed Etc/GMT zone would read "GMT-4". */
export function resolvedAbbr() {
    if (mode === 'server') return serverLabel || tzAbbr(serverZone || 'UTC');
    return tzAbbr(resolvedZone());
}

// One Intl formatter per zone (constructing one per timestamp is expensive when
// a table has hundreds of rows).
const fmtCache = new Map();
function formatterFor(zone) {
    let f = fmtCache.get(zone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
        fmtCache.set(zone, f);
    }
    return f;
}

/** Render a Date as "YYYY-MM-DD HH:MM:SS" in the resolved zone. */
export function formatInZone(date, zone = resolvedZone()) {
    let parts;
    try { parts = formatterFor(zone).formatToParts(date); }
    catch (e) { parts = formatterFor('UTC').formatToParts(date); }
    const get = (t) => parts.find(p => p.type === t)?.value ?? '';
    let hh = get('hour');
    if (hh === '24') hh = '00';   // Intl hour12:false can emit "24" at midnight
    return `${get('year')}-${get('month')}-${get('day')} ${hh}:${get('minute')}:${get('second')}`;
}

/* Map an integer UTC offset (hours) to a fixed-offset IANA zone. POSIX Etc/GMT
   signs are inverted: Etc/GMT+4 is UTC-4, Etc/GMT-9 is UTC+9. */
function zoneForOffset(off) {
    if (!off) return 'UTC';
    return `Etc/GMT${off < 0 ? '+' + (-off) : '-' + off}`;
}

/** Fetch the engine's configured zone once; emits so labels/views can refresh.
    Parses the engine's "<name> (UTC <offset>)" display string. */
export async function loadServerTimezone() {
    if (fetched) return;
    fetched = true;
    try {
        // Tolerate plain text, JSON-quoted, or XStream <string>…</string> forms.
        const raw = String(await server.timezone() ?? '').trim()
            .replace(/^<string>([\s\S]*)<\/string>$/, '$1')
            .replace(/^"([\s\S]*)"$/, '$1')
            .trim();
        if (!raw) return;
        const m = raw.match(/\(UTC\s*([+-]?\d+(?::\d+)?)\)/i);
        if (!m) return;                          // unknown format — keep UTC fallback
        const off = parseInt(m[1], 10) || 0;     // whole hours (engine truncates)
        serverZone = zoneForOffset(off);
        serverLabel = raw.split('(UTC')[0].trim() || tzAbbr(serverZone);
        emit();
    } catch (e) { /* leave empty — server mode falls back to UTC */ }
}
