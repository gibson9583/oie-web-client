/*
 * Command palette — ⌘K / Ctrl+K.
 *
 * One way in to every view, every channel and the commands that make sense from
 * anywhere. It is a reader of registries the app already keeps, never a second
 * source of truth:
 *
 *   Views     platform.navItems()      — the same list the rail renders, so a
 *                                        plugin's view appears here for free
 *   Commands  allCommands()            — core/commands.js (see its header for
 *                                        why this is not "every task button")
 *   Channels  the TanStack cache       — whatever the dashboard has already
 *                                        polled; fetched once on first open only
 *                                        if nothing is cached yet
 *
 * Authorization is not re-implemented: every entry carrying a `task` is filtered
 * through the SAME checkTask() the task panes and popup menus use, so the palette
 * cannot offer an action the rail would have hidden.
 *
 * A leading character scopes the search — `>` commands, `#` channels, `/` views.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import api, * as oie from '@oie/web-api';
import { platform } from '../core/platform.js';
import { allCommands, fuzzyMatch } from '../core/commands.js';
import { checkTask } from '../core/authorization.js';
import { getPref, setPrefs } from '../core/prefs.js';
import * as router from '../core/router.js';
import { queryClient } from './queries.js';
import { Icon } from './bridges.jsx';

/* Enough that scoping to a kind (`/` for views) lists all of them rather than
   truncating, while still keeping an unscoped search scannable. */
const MAX_RESULTS = 20;
const MAX_RECENT = 5;

const SCOPES = {
    '>': { kind: 'command', label: 'Commands' },
    '#': { kind: 'channel', label: 'Channels' },
    '/': { kind: 'view', label: 'Views' }
};

/* State pip colour, matching the dashboard's vocabulary. */
function stateClass(state: any) {
    const s = String(state || '').toUpperCase();
    if (s === 'STARTED') return 'ok';
    if (s === 'PAUSED') return 'warn';
    if (s === 'STOPPED') return 'err';
    return 'idle';
}

/** Split a label into matched / unmatched runs so the match is visible. */
function Highlight({ text, hits }: any) {
    if (!hits || !hits.length) return text;
    const out: any[] = [];
    let prev = 0;
    hits.forEach((h: any, i: any) => {
        if (h > prev) out.push(text.slice(prev, h));
        out.push(<b key={i}>{text[h]}</b>);
        prev = h + 1;
    });
    if (prev < text.length) out.push(text.slice(prev));
    return out;
}

/* ---- the entries ------------------------------------------------------------ */

function viewEntries() {
    return platform.navItems()
        .filter((item: any) => !item.task || checkTask(item.rbac || 'view', item.task))
        .map((item: any) => ({
            kind: 'view', id: 'view:' + item.id, label: item.label, icon: item.icon || 'chevR',
            group: 'Views', hint: item.path || '', path: item.path, run: item.action
        }));
}

function commandEntries() {
    return allCommands()
        .filter((c: any) => !c.task || checkTask(c.rbac || 'view', c.task))
        .map((c: any) => ({
            kind: 'command', id: 'cmd:' + c.id, label: c.label, icon: c.icon || 'chevR',
            group: c.section || 'Commands', hint: c.hint || '', path: c.path, run: c.run,
            keywords: c.keywords || ''
        }));
}

/* Channels come from whatever the dashboard has already polled — the
   ['statuses','dashboard'] query react/queries.ts maintains; reading the cache
   directly (rather than subscribing) keeps opening the palette free of requests. */
function cachedChannels() {
    const rows: any[] = [];
    const cached = queryClient.getQueryData(['statuses', 'dashboard']);
    const walk = (list: any) => {
        for (const row of Array.isArray(list) ? list : []) {
            if (row && row.channelId) rows.push({ id: row.channelId, name: row.name, state: row.state });
            if (row && row.childStatuses) walk(oie.asList(row.childStatuses));
        }
    };
    walk(Array.isArray(cached) ? cached : []);
    return rows;
}

function channelEntries(fallback: any) {
    const seen = new Set();
    const rows = cachedChannels();
    const source = rows.length ? rows : fallback;
    /* Two verbs per channel. A channel is a thing you either edit or watch, and
       the message browser is the more frequent of the two — but the editor is what
       "a channel" means in the Channels view, so it leads and the browser follows
       one arrow-key away. The hint says which is which. */
    return source.filter((c: any) => {
        if (!c || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    }).flatMap((c: any) => {
        const base = { kind: 'channel', label: c.name || c.id, group: 'Channels', state: c.state };
        // Gated through the same (group, task) pairs as the nav/menu twins, per
        // this file's own header contract — the palette must never surface an
        // entry RBAC hides elsewhere.
        return [
            checkTask('view', 'doShowChannel') ? { ...base, id: 'chan:' + c.id, hint: 'edit', path: '/channels/' + c.id + '/edit' } : null,
            checkTask('view', 'doShowMessages') ? { ...base, id: 'chanmsg:' + c.id, hint: 'messages', path: '/messages/' + c.id } : null
        ].filter(Boolean);
    });
}

/* ---- the component ---------------------------------------------------------- */

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [fallbackChannels, setFallbackChannels] = useState([] as any[]);
    const listRef = useRef<any>(null);

    // ⌘K / Ctrl+K anywhere. Capture phase so a focused editor can't swallow it.
    useEffect(() => {
        const onKey = (e: any) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen((v: any) => !v);
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, []);

    // Only if the dashboard has never been visited: one cheap id/name fetch, once.
    useEffect(() => {
        if (!open || cachedChannels().length || fallbackChannels.length) return;
        if (!checkTask('view', 'doShowChannel') && !checkTask('view', 'doShowMessages')) return;
        let cancelled = false;
        api.channels.idsAndNames()
            .then((map: any) => {
                if (cancelled) return;
                const rows = Object.entries(map || {}).map(([id, name]) => ({ id, name }));
                setFallbackChannels(rows);
            })
            .catch(() => { /* the palette is still useful without channels */ });
        return () => { cancelled = true; };
    }, [open, fallbackChannels.length]);

    useEffect(() => { if (open) { setQuery(''); setCursor(0); } }, [open]);

    const entries = useMemo(
        () => (open ? [...viewEntries(), ...commandEntries(), ...channelEntries(fallbackChannels)] : []),
        [open, fallbackChannels]
    );

    const results = useMemo(() => {
        const scope = (SCOPES as any)[query[0]];
        const needle = (scope ? query.slice(1) : query).trim();
        const pool = scope ? entries.filter((e: any) => e.kind === scope.kind) : entries;

        if (!needle) {
            if (scope) return pool.slice(0, MAX_RESULTS);
            const recent = getPref('paletteRecent') || [];
            const found = recent
                .map((id: any) => pool.find((e: any) => e.id === id))
                .filter(Boolean)
                .map((e: any) => ({ ...e, group: 'Recent' }));
            return found.length ? found : pool.filter((e: any) => e.kind === 'view').slice(0, MAX_RESULTS);
        }
        return pool
            .map((e: any) => {
                const labelMatch = fuzzyMatch(e.label, needle);
                const m = labelMatch || (e.keywords ? fuzzyMatch(e.keywords, needle) : null);
                // Highlight indices only apply when the LABEL matched — a
                // keywords-only match has nothing sensible to underline.
                return m ? { entry: e, score: m.score, hits: labelMatch ? m.hits : [] } : null;
            })
            .filter(Boolean)
            .sort((a: any, b: any) => a.score - b.score)
            .slice(0, MAX_RESULTS)
            .map((r: any) => ({ ...r.entry, hits: r.hits }));
    }, [entries, query]);

    useEffect(() => { setCursor(0); }, [query]);

    const run = useCallback((entry: any) => {
        if (!entry) return;
        setOpen(false);
        const recent = [entry.id, ...(getPref('paletteRecent') || []).filter((id: any) => id !== entry.id)];
        setPrefs({ paletteRecent: recent.slice(0, MAX_RECENT) });
        // After the dialog has closed, so focus restore doesn't fight the view swap.
        setTimeout(() => {
            if (entry.run) entry.run();
            else if (entry.path) router.navigate(entry.path);
        }, 0);
    }, []);

    const onKeyDown = (e: any) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c: any) => Math.min(c + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c: any) => Math.max(c - 1, 0)); }
        else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
        else if (e.key === 'End') { e.preventDefault(); setCursor(results.length - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); run(results[cursor]); }
    };

    useEffect(() => {
        const el = listRef.current?.querySelector('[aria-selected="true"]');
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [cursor, results]);

    const scope = (SCOPES as any)[query[0]];
    let lastGroup: any = null;

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Portal>
                <Dialog.Overlay className="cmdk-overlay">
                    <Dialog.Content className="cmdk" aria-describedby={undefined}
                        onOpenAutoFocus={(e: any) => {
                            // Focus the field, not the first result — typing is the point.
                            e.preventDefault();
                            listRef.current?.parentElement?.querySelector('input')?.focus();
                        }}>
                        <Dialog.Title className="cmdk-sr">Command palette</Dialog.Title>
                        <div className="cmdk-field">
                            <Icon name="search" size={15} />
                            <input type="text" autoComplete="off" spellCheck="false"
                                placeholder="Search views, channels and commands…"
                                value={query}
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="cmdk-results"
                                aria-autocomplete="list"
                                aria-activedescendant={results[cursor] ? 'cmdk-opt-' + cursor : undefined}
                                aria-label="Search views, channels and commands"
                                onChange={(e: any) => setQuery(e.target.value)}
                                onKeyDown={onKeyDown} />
                            {scope && <span className="cmdk-scope">{scope.label}</span>}
                        </div>

                        <div className="cmdk-list" id="cmdk-results" role="listbox"
                            aria-label="Results" ref={listRef}>
                            {results.length === 0 && (
                                <div className="cmdk-empty">Nothing matches “{query}”.</div>
                            )}
                            {results.map((entry: any, i: any) => {
                                const head = entry.group !== lastGroup ? (lastGroup = entry.group) : null;
                                return (
                                    <div key={entry.id}>
                                        {head && <div className="cmdk-group">{head}</div>}
                                        <div id={'cmdk-opt-' + i} role="option" aria-selected={i === cursor}
                                            className="cmdk-opt"
                                            onMouseMove={() => setCursor(i)}
                                            onClick={() => run(entry)}>
                                            {entry.kind === 'channel'
                                                ? <span className={'cmdk-pip ' + stateClass(entry.state)} />
                                                : <Icon name={entry.icon} size={14} />}
                                            <span className="cmdk-label">
                                                <Highlight text={entry.label} hits={entry.hits} />
                                            </span>
                                            {entry.hint && <span className="cmdk-hint">{entry.hint}</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="cmdk-foot">
                            <span><kbd>↑↓</kbd> move</span>
                            <span><kbd>⏎</kbd> run</span>
                            <span><kbd>esc</kbd> close</span>
                            <span className="cmdk-grammar">
                                <kbd>&gt;</kbd> commands <kbd>#</kbd> channels <kbd>/</kbd> views
                            </span>
                        </div>
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
