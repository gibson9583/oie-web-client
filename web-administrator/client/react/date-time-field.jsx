/*
 * Date + time field, replacing <input type="datetime-local">.
 *
 * The native control paints its own panel from the browser's chrome: it can't
 * take the app's tokens, it renders differently in every browser, and — the part
 * that actually matters here — it can't say which timezone the value is read in.
 * Every timestamp in this app is timezone-sensitive and the top bar cycles
 * Server/Local/UTC for DISPLAY, while these criteria are always sent in the
 * browser's own zone (see toCalendarParam). The footer says so.
 *
 * The value contract is deliberately unchanged — the same `YYYY-MM-DDTHH:mm`
 * string the native input produced — so the search code around it is untouched.
 *
 * Radix Popover supplies the placement, dismissal and focus return; the calendar
 * is react-day-picker, styled from our tokens (see .rdp-root in app.css); the
 * time half is a pair of spinners, because react-day-picker is date-only and a
 * native <input type=time> would put the browser's chrome right back.
 */

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { Icon } from './bridges.jsx';

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` → parts. Anything unparseable reads as empty. */
function parseValue(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
    if (!m) return { date: null, hour: 0, minute: 0 };
    return {
        date: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
        hour: Number(m[4]),
        minute: Number(m[5])
    };
}

function formatValue(date, hour, minute) {
    if (!date) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(hour)}:${pad(minute)}`;
}

/* What the trigger reads. Matches the tables' timestamp shape rather than a
   locale format, so a criterion and the rows it filters look alike. */
function displayValue(value) {
    const { date, hour, minute } = parseValue(value);
    if (!date) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(hour)}:${pad(minute)}`;
}

/** The browser's own zone, which is the one these criteria are sent in. */
function localZoneAbbr() {
    try {
        const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
        return parts.find((p) => p.type === 'timeZoneName')?.value || 'local';
    } catch { return 'local'; }
}

/* One half of the clock. A spinner rather than a scrolling list: a 60-item
   minute column needed a scrollbar to be usable at all, and two of those sat in
   the popover looking like furniture. This types, steps on Up/Down, and wraps. */
function TimePart({ label, value, max, onChange }) {
    const [draft, setDraft] = useState(null);       // non-null only while typing
    const step = (by) => onChange((value + by + (max + 1)) % (max + 1));
    const commit = (text) => {
        setDraft(null);
        const n = parseInt(text, 10);
        if (!Number.isNaN(n)) onChange(Math.max(0, Math.min(max, n)));
    };
    return (
        <span className="dtf-part">
            <button type="button" className="dtf-step" tabIndex={-1}
                aria-label={`${label} up`} onClick={() => step(1)}>▲</button>
            <input className="dtf-num" inputMode="numeric" aria-label={label}
                value={draft ?? pad(value)}
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); setDraft(null); step(1); }
                    else if (e.key === 'ArrowDown') { e.preventDefault(); setDraft(null); step(-1); }
                    else if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
                }} />
            <button type="button" className="dtf-step" tabIndex={-1}
                aria-label={`${label} down`} onClick={() => step(-1)}>▼</button>
        </span>
    );
}

export function DateTimeField({ value, onChange, label, placeholder = 'yyyy-mm-dd hh:mm' }) {
    const [open, setOpen] = useState(false);
    const { date, hour, minute } = parseValue(value);
    const shown = displayValue(value);

    // Editing the time before a day is picked implies today, so the field can't
    // hold a time that belongs to no date.
    const commit = (nextDate, nextHour, nextMinute) =>
        onChange(formatValue(nextDate || new Date(), nextHour, nextMinute));

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button type="button" className={'dtf-trigger' + (shown ? '' : ' empty')} aria-label={label}>
                    <span className="dtf-value">{shown || placeholder}</span>
                    <Icon name="calendar" size={14} />
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content className="dtf-pop" align="start" sideOffset={4} collisionPadding={8}>
                    <div className="dtf-body">
                        <DayPicker
                            mode="single"
                            selected={date || undefined}
                            month={date || undefined}
                            onSelect={(picked) => { if (picked) commit(picked, hour, minute); }}
                            showOutsideDays />
                        <div className="dtf-time">
                            <div className="dtf-time-head">Time</div>
                            <div className="dtf-clock">
                                <TimePart label="Hour" value={hour} max={23}
                                    onChange={(h) => commit(date, h, minute)} />
                                <span className="dtf-colon" aria-hidden="true">:</span>
                                <TimePart label="Minute" value={minute} max={59}
                                    onChange={(m) => commit(date, hour, m)} />
                            </div>
                        </div>
                    </div>
                    <div className="dtf-foot">
                        <span className="dtf-zone">Entered in {localZoneAbbr()}</span>
                        <span className="dtf-actions">
                            <button type="button" className="dtf-link"
                                onClick={() => { onChange(''); setOpen(false); }}>Clear</button>
                            <button type="button" className="dtf-link" onClick={() => {
                                const now = new Date();
                                onChange(formatValue(now, now.getHours(), now.getMinutes()));
                                setOpen(false);
                            }}>Now</button>
                        </span>
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
