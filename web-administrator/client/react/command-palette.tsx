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
 *   Channels  the TanStack cache       — dashboard status plus optional names;
 *                                        reverse library links refresh names
 *                                        on each opening
 *   Suggested mounted view context    — selected channels, related libraries
 *                                        and templates; separate from recents
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
import { allCommands, commandPermissions, fuzzyMatch } from '../core/commands.js';
import { checkTask } from '../core/authorization.js';
import { BUILTIN_SETTINGS_LABELS, canViewSettingsTab, settingsTabId } from '../core/settings-navigation.js';
import { getPref, setPrefs } from '../core/prefs.js';
import * as router from '../core/router.js';
import { queryClient } from './queries.js';
import { Icon, useStoreKey } from './bridges.jsx';
import { canBrowseTemplates, channelPaletteEntries, contextSuggestions, entryAllowed, templatePaletteEntries } from '../core/command-suggestions.js';
import { useCurrentPaletteContext } from './palette-context.js';

/* Enough that scoping to a kind (`/` for views) lists all of them rather than
   truncating, while still keeping an unscoped search scannable. */
const MAX_RESULTS = 20;
const MAX_RECENT = 5;
const MAX_SUGGESTED = 6;

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

function permitted(entry: any) {
    return entryAllowed(entry, checkTask) && (!entry.allowed || entry.allowed());
}

function viewEntries() {
    return platform.navItems()
        .map((item: any) => ({
            kind: 'view', id: 'view:' + item.id, label: item.label, icon: item.icon || 'chevR',
            group: 'Views', hint: item.path || '', path: item.path, run: item.action,
            permissions: item.task ? [[item.rbac || 'view', item.task]] : [],
            allowed: () => !item.visible || item.visible()
        }))
        .filter(permitted);
}

function commandEntries() {
    const commands = allCommands();
    const ids = new Set(commands.map(command => command.id));
    // Derive plugin destinations from the current panel registry. Recovery adds
    // them to an already-open palette without accumulating registrations.
    for (const panel of platform.settingsPanels()) {
        const label = panel.label;
        const id = 'settings-' + settingsTabId(label);
        if (ids.has(id) || BUILTIN_SETTINGS_LABELS.includes(label)) continue;
        ids.add(id);
        commands.push({
            id, label: 'Settings: ' + label, icon: 'settings', section: 'Settings',
            order: BUILTIN_SETTINGS_LABELS.length, keywords: label,
            task: 'doShowSettings', rbac: 'view', path: '/settings?tab=' + encodeURIComponent(label),
            visible: () => canViewSettingsTab(platform, label)
                && platform.settingsPanels().some(current => current.label === label)
        });
    }
    return commands
        .sort((a, b) => String(a.section || '').localeCompare(String(b.section || ''))
            || (a.order ?? 100) - (b.order ?? 100) || String(a.label).localeCompare(String(b.label)))
        .map((c: any) => ({
            kind: 'command', id: 'cmd:' + c.id, label: c.label, icon: c.icon || 'chevR',
            group: c.section || 'Commands', hint: c.hint || '', path: c.path, run: c.run,
            keywords: c.keywords || '', permissions: commandPermissions(c),
            allowed: () => !c.visible || c.visible()
        }))
        .filter(permitted);
}

/* Channels come from whatever the dashboard has already polled — the
   ['statuses','dashboard'] query react/queries.ts maintains; reading the cache
   directly (rather than subscribing) avoids a separate status request. */
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

/* ---- the component ---------------------------------------------------------- */

export function CommandPalette({ ready }: { ready: boolean }) {
    const permissions = useStoreKey('webPlugins');
    // Keep the shortcut listener available as soon as the shell mounts, but
    // reveal nothing and make no requests before access controls are ready.
    const [openRequested, setOpen] = useState(false);
    const open = ready && openRequested;
    const readyRef = useRef(ready);
    readyRef.current = ready;
    const mountedRef = useRef(true);
    const [query, setQuery] = useState('');
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const [fallbackChannels, setFallbackChannels] = useState([] as any[]);
    // An old ordinary search must not hide newer Dashboard rows if the first
    // reverse lookup fails. After one succeeds, keep its snapshot current with
    // every successful full name read; null is unread and [] is confirmed empty.
    const [reverseChannels, setReverseChannels] = useState<any[] | null>(null);
    const [fetchedLibraries, setFetchedLibraries] = useState([] as any[]);
    const context = useCurrentPaletteContext();
    const channelContext = context?.kind === 'channel' && context.channelIds.length > 0;
    const templateContext = context?.kind === 'templates';
    const listRef = useRef<any>(null);
    const pointerRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

    // ⌘K / Ctrl+K anywhere. Capture phase so a focused editor can't swallow it.
    useEffect(() => {
        mountedRef.current = true;
        const onKey = (e: any) => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen((v: any) => !v);
            } else if (e.key === 'Escape' && !readyRef.current) {
                setOpen(false);
            }
        };
        // WebKit emits stationary mousemoves when results move under the pointer.
        const onMouseMove = (e: MouseEvent) => {
            const previous = pointerRef.current;
            pointerRef.current = { x: e.clientX, y: e.clientY,
                moved: !!previous && (previous.x !== e.clientX || previous.y !== e.clientY) };
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousemove', onMouseMove, true);
        return () => {
            mountedRef.current = false;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousemove', onMouseMove, true);
        };
    }, []);

    // Ordinary search reuses known channels. Reverse library links need a fresh
    // inventory on each opening, including channels created since the last one.
    useEffect(() => {
        if (!open || (!templateContext && (cachedChannels().length || fallbackChannels.length))) return;
        if (!checkTask('view', 'doShowChannel') && !checkTask('view', 'doShowMessages')) return;
        let cancelled = false;
        api.channels.idsAndNames()
            .then((map: any) => {
                if (cancelled) return;
                // idsAndNames is an XStream Map<String,String>, not an ID-keyed
                // object. One entry is a singleton; two string children form a
                // pair. Ignore malformed entries without losing valid siblings.
                const rows = api.asList(map?.entry).flatMap((entry: any) => {
                    const pair = entry?.string;
                    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0].trim()) return [];
                    const [id, name] = pair;
                    if (name != null && !['string', 'number', 'boolean'].includes(typeof name)) return [];
                    return [{ id, name: name == null ? id : String(name) || id }];
                });
                setFallbackChannels(rows);
                setReverseChannels(previous => templateContext || previous !== null ? rows : null);
            })
            .catch(() => { /* the palette is still useful without channels */ });
        return () => { cancelled = true; };
    }, [open, templateContext, permissions]); // eslint-disable-line react-hooks/exhaustive-deps -- recheck access on permission changes; do not refetch when the response changes fallbackChannels

    useEffect(() => { if (open) { setQuery(''); setActiveKey(null); } }, [open]);

    // Fetch related content only when useful. Reopening retries failed reads;
    // closing or changing context discards late responses. The template editor
    // publishes its working libraries, including unsaved association changes.
    useEffect(() => {
        setFetchedLibraries([]);
        const recent = getPref('paletteRecent') || [];
        if (!open || templateContext || !canBrowseTemplates(checkTask)
            || (!channelContext && !recent.some((id: string) => /^(template|library):/.test(id)))) return;
        let request = 0;
        const refresh = () => {
            const current = ++request;
            if (!canBrowseTemplates(checkTask)) { setFetchedLibraries([]); return; }
            api.codeTemplates.libraries(true).then(libraries => {
                if (current === request) setFetchedLibraries(canBrowseTemplates(checkTask) ? libraries : []);
            }).catch(() => { /* retain usable results when a refresh fails */ });
        };
        // A dependency save may finish after navigation to Messages. Refresh
        // committed data without replacing any editor's working selections.
        const off = platform.events.on('codeTemplateLibraries:associationsSaved', refresh);
        refresh();
        return () => { request++; off(); };
    }, [open, channelContext, templateContext, permissions]);

    const libraries = templateContext ? context.libraries : fetchedLibraries;
    const channels = useMemo(() => {
        const cached = cachedChannels();
        const cachedById = new Map<string, any>();
        // Parent statuses precede connector children; retain the parent's state.
        for (const channel of cached) if (!cachedById.has(channel.id)) cachedById.set(channel.id, channel);
        // Reverse links use the last successful inventory, including an empty
        // one. Dashboard contributes runtime state, never obsolete IDs/names.
        // Other views still follow their newer Dashboard cache and selection.
        const source = templateContext && reverseChannels !== null
            ? reverseChannels.map(channel => ({ ...channel, state: cachedById.get(channel.id)?.state }))
            : [...cached, ...fallbackChannels.filter(channel => !cachedById.has(channel.id))];
        if (context?.kind !== 'channel') return source;
        // Current view fields win, while cached metadata (such as runtime
        // status) remains available when the view only supplies ID and name.
        const current = context.channelIds.map(id => ({
            id, name: id,
            ...source.find(c => c.id === id),
            ...context.channels?.find(c => c.id === id)
        }));
        const ids = new Set(current.map(c => c.id));
        return [...current, ...source.filter(c => !ids.has(c.id))];
    }, [open, fallbackChannels, reverseChannels, context]); // eslint-disable-line react-hooks/exhaustive-deps -- read cache on each open

    const suggested = useMemo(() => open
        ? contextSuggestions(context, channels, libraries, checkTask).slice(0, MAX_SUGGESTED) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the controller reads its permission snapshot outside React
    [open, context, channels, libraries, permissions]);

    const entries = useMemo(
        () => (open ? [...viewEntries(), ...commandEntries(), ...channelPaletteEntries(channels, checkTask),
            ...templatePaletteEntries(libraries, checkTask)] : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the controller reads its permission snapshot outside React
        [open, channels, libraries, permissions]
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
            // Recents keep their own section even when a destination is also
            // suggested. Suggestions never overwrite the user's history.
            return [...suggested, ...(found.length ? found : pool.filter((e: any) => e.kind === 'view').slice(0, MAX_RESULTS - suggested.length))];
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
    }, [entries, query, suggested]);

    const resultKey = (entry: any) => entry.group + ':' + entry.id;
    // Async suggestions may arrive above a recent entry. Track identity so an
    // ArrowDown followed by Enter cannot silently execute a different action.
    // If that entry disappears, require a new selection instead of substituting
    // the first result. Only an untouched selection defaults to the first row.
    const cursor = activeKey === null ? 0 : results.findIndex((entry: any) => resultKey(entry) === activeKey);
    const setCursor = (index: number) => setActiveKey(results[index] ? resultKey(results[index]) : null);
    useEffect(() => { setActiveKey(null); }, [query]);

    const run = useCallback((entry: any) => {
        if (!mountedRef.current || !readyRef.current || !entry || !permitted(entry)) return;
        setOpen(false);
        const recent = [entry.id, ...(getPref('paletteRecent') || []).filter((id: any) => id !== entry.id)];
        setPrefs({ paletteRecent: recent.slice(0, MAX_RECENT) });
        // After the dialog has closed, so focus restore doesn't fight the view swap.
        setTimeout(() => {
            if (!mountedRef.current || !readyRef.current || !permitted(entry)) return;
            if (entry.run) entry.run();
            else if (entry.path) router.navigate(entry.path);
        }, 0);
    }, []);

    const onKeyDown = (e: any) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(cursor + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(Math.max(cursor - 1, 0)); }
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
                                placeholder="Search views, channels, templates and commands…"
                                value={query}
                                role="combobox"
                                aria-expanded="true"
                                aria-controls="cmdk-results"
                                aria-autocomplete="list"
                                aria-activedescendant={results[cursor] ? 'cmdk-opt-' + cursor : undefined}
                                aria-label="Search views, channels, templates and commands"
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
                                    <div key={resultKey(entry)}>
                                        {head && <div className="cmdk-group">{head}</div>}
                                        <div id={'cmdk-opt-' + i} role="option" aria-selected={i === cursor}
                                            className="cmdk-opt" data-group={entry.group}
                                            onMouseMove={() => { if (pointerRef.current?.moved) setCursor(i); }}
                                            onClick={() => run(entry)}>
                                            {entry.kind === 'channel'
                                                ? <span className={'cmdk-pip ' + stateClass(entry.state)} />
                                                : <Icon name={entry.icon} size={14} />}
                                            <span className="cmdk-label">
                                                <Highlight text={entry.label} hits={entry.hits} />
                                            </span>
                                            {entry.hint && <span className="cmdk-hint" title={entry.hint}>{entry.hint}</span>}
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
