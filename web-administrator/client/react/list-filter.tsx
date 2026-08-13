/*
 * Drop-in typeahead for existing .filterbar inputs — client-side only.
 *
 * Keeps the same <input type="text"> the filterbar CSS already styles; the
 * suggestion list is portaled. Typing never hits the engine: the value updates
 * eagerly, matching uses useDeferredValue so tree paints stay off the keystroke.
 */

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './bridges.jsx';

export interface ListFilterSuggestion {
    value: string;
    kind: string;
    icon?: string;
}

const SUGGEST_MAX = 12;

/** Tiny DLM: optional field:needle scopes the filter without a network round-trip. */
export function parseListFilter(raw: string): { field: string | null; needle: string } {
    const t = String(raw || '').trim();
    const m = /^(tag|name|id|lib|tpl|group|script|username|author|email|key|org):\s*(.*)$/i.exec(t);
    if (m) return { field: m[1].toLowerCase(), needle: (m[2] || '').trim().toLowerCase() };
    return { field: null, needle: t.toLowerCase() };
}

export function listFilterHaystack(...parts: unknown[]): string {
    return parts.map((p) => String(p ?? '').toLowerCase()).join(' ');
}

/** True when `raw` matches any of the named fields (supports field:needle scopes). */
export function rowMatchesFilter(raw: string, fields: Record<string, unknown>): boolean {
    const { field, needle } = parseListFilter(raw);
    if (!needle) return true;
    if (field && Object.prototype.hasOwnProperty.call(fields, field)) {
        return String(fields[field] ?? '').toLowerCase().includes(needle);
    }
    return Object.values(fields).some((v) => String(v ?? '').toLowerCase().includes(needle));
}

/** Extensions-style Search control for a .panel-header .panel-tools slot. */
export function PanelSearch({
    value,
    onChange,
    suggestions,
    placeholder = 'Name, id…',
    id = 'panel-search',
    counts
}: {
    value: string;
    onChange: (next: string) => void;
    suggestions: ListFilterSuggestion[];
    placeholder?: string;
    id?: string;
    counts?: string;
}) {
    return (
        <div className="panel-tools" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <label className="text-text-dim" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Search
            </label>
            <ListFilterTypeahead
                id={id}
                value={value}
                onChange={onChange}
                suggestions={suggestions}
                placeholder={placeholder}
                style={{ width: 220, maxWidth: '40vw' }}
            />
            {counts != null && (
                <span className="counts text-text-faint" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {counts}
                </span>
            )}
        </div>
    );
}

/** Format a picked suggestion into the filter string (scoped kinds get kind:value). */
export function formatListFilterPick(item: ListFilterSuggestion): string {
    if (item.kind === 'tag' || item.kind === 'lib' || item.kind === 'tpl'
        || item.kind === 'group' || item.kind === 'id' || item.kind === 'script'
        || item.kind === 'username' || item.kind === 'author' || item.kind === 'email'
        || item.kind === 'key' || item.kind === 'org') {
        return `${item.kind}:${item.value}`;
    }
    return item.value;
}

/**
 * Replaces a plain filterbar <input> — same type="text", same placeholder slot.
 * Parent keeps <label>Filter:</label> and <span className="counts">…</span>.
 */
export function ListFilterTypeahead({
    value,
    onChange,
    suggestions,
    placeholder = 'Filter…',
    id = 'list-filter-typeahead',
    className,
    style,
    onSubmit
}: {
    value: string;
    onChange: (next: string) => void;
    suggestions: ListFilterSuggestion[];
    placeholder?: string;
    id?: string;
    className?: string;
    style?: any;
    onSubmit?: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [index, setIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const taRef = useRef<HTMLDivElement | null>(null);
    const deferredValue = useDeferredValue(value);

    const items = useMemo(() => {
        if (!open) return [] as ListFilterSuggestion[];
        const needle = deferredValue.trim().toLowerCase();
        const out: ListFilterSuggestion[] = [];
        const seen = new Set<string>();
        for (const s of suggestions) {
            const key = `${s.kind}:${s.value}`.toLowerCase();
            if (seen.has(key)) continue;
            const hay = listFilterHaystack(s.value, s.kind);
            if (needle && !hay.includes(needle) && !s.value.toLowerCase().includes(needle)) continue;
            seen.add(key);
            out.push(s);
            if (out.length >= SUGGEST_MAX) break;
        }
        return out;
    }, [open, deferredValue, suggestions]);

    useLayoutEffect(() => {
        const ta = taRef.current, input = inputRef.current;
        if (!open || !items.length || !ta || !input) return;
        const r = input.getBoundingClientRect();
        ta.style.minWidth = `${Math.max(200, r.width)}px`;
        ta.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - ta.offsetWidth - 4))}px`;
        ta.style.top = `${r.bottom + 2}px`;
        ta.style.bottom = 'auto';
        if (ta.getBoundingClientRect().bottom > window.innerHeight - 4) {
            ta.style.top = 'auto';
            ta.style.bottom = `${window.innerHeight - r.top + 2}px`;
        }
    }, [open, items]);

    useEffect(() => {
        if (index >= 0 && taRef.current?.children[index]) {
            (taRef.current.children[index] as HTMLElement).scrollIntoView({ block: 'nearest' });
        }
    }, [index]);

    const close = () => { setOpen(false); setIndex(-1); };

    const pick = (item: ListFilterSuggestion) => {
        onChange(formatListFilterPick(item));
        close();
        inputRef.current?.focus();
    };

    const onKeyDown = (e: any) => {
        const listOpen = open && items.length > 0;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!listOpen) { setOpen(true); return; }
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            setIndex((i) => (i + delta + items.length) % items.length);
        } else if (e.key === 'Enter' && listOpen) {
            e.preventDefault();
            pick(items[index >= 0 ? index : 0]);
        } else if (e.key === 'Enter' && onSubmit) {
            e.preventDefault();
            close();
            onSubmit(value);
        } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            close();
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="text"
                placeholder={placeholder}
                autoComplete="off"
                className={className}
                style={style}
                value={value}
                role="combobox"
                aria-expanded={open && items.length > 0}
                aria-controls={id}
                aria-autocomplete="list"
                aria-activedescendant={open && index >= 0 && items[index] ? `${id}-${index}` : undefined}
                onChange={(e: any) => { onChange(e.target.value); setOpen(true); setIndex(-1); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(close, 150)}
                onKeyDown={onKeyDown}
            />
            {createPortal(
                <div ref={taRef} id={id} role="listbox" aria-label="Filter suggestions"
                    className={'typeahead' + (open && items.length ? '' : ' hidden')}>
                    {items.map((item, i) => (
                        <div key={`${item.kind}:${item.value}`}
                            id={`${id}-${i}`}
                            role="option"
                            aria-selected={i === index}
                            className={'typeahead-item' + (i === index ? ' active' : '')}
                            onMouseDown={(e: any) => e.preventDefault()}
                            onClick={() => pick(item)}>
                            <Icon name={item.icon || (item.kind === 'tag' ? 'tag' : 'search')} size={14} />
                            <span className="typeahead-label">{item.value}</span>
                            <span className="typeahead-kind">{item.kind}</span>
                        </div>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}
