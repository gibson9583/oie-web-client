/*
 * Message-search DLM — Deterministic Language Model for the Message Browser's
 * free-typed Text Search.
 *
 * The engine's `textSearch` query is a wildcard: it walks message content,
 * maps, and related stores in one shot and is expensive on busy channels.
 * After the user enters a phrase (e.g. "123456") and presses Search, the
 * companion prompt (promptDlmSearchScope) asks for a *scope* via typeahead
 * and dlmBuildDecision builds an isolated query from the scoped params the
 * servlet already exposes (rawContentSearch, sourceMapContentSearch,
 * metaDataSearch, message-id bounds, …) — never inventing a server API.
 *
 * Same input + same chosen scopes → same params. No LLM, no sampling.
 */

/** One selectable search scope the DLM can turn into engine query params. */
export interface DlmScope {
    id: string;
    /** UI grouping. */
    group: 'Identifiers' | 'Message content' | 'Maps' | 'Errors' | 'Metadata' | 'Legacy';
    label: string;
    kind: 'message_id' | 'content' | 'metadata' | 'legacy_text';
    /** Engine query param for content scopes (e.g. rawContentSearch). */
    param?: string;
    /** Soft suggestion weight — higher = pre-checked when the phrase fits. */
    suggestWeight?: number;
    /** Extra typeahead needles (aliases). */
    keywords?: string[];
}

export interface DlmMetaColumn {
    name?: string | null;
}

export interface DlmBuildOptions {
    /** Selected scope ids from the prompt. */
    scopes: string[];
    /** Metadata column names when the metadata scope is selected. */
    metaColumns?: string[];
    /** Operator used for metadata CONTAINS-style searches. */
    metaOperator?: string;
    /** Case-insensitive metadata search. */
    metaIgnoreCase?: boolean;
    /** Only used when the legacy textSearch escape hatch is chosen. */
    textSearchRegex?: boolean;
}

export interface DlmDecision {
    raw: string;
    normalized: string;
    operation: 'SCOPED_SEARCH' | 'MESSAGE_ID' | 'LEGACY_TEXT' | 'UNSUPPORTED';
    scopes: string[];
    metaColumns: string[];
    /** Ready-to-merge query params for GET /channels/{id}/messages. */
    params: Record<string, unknown>;
    /** Human summary fragments for the Current Search box. */
    summary: string[];
    confidence: number;
}

export interface DlmPromptOptions {
    text: string;
    metaDataColumns?: DlmMetaColumn[];
    textSearchRegex?: boolean;
    /** Previously chosen scopes to restore (prefs). */
    initialScopes?: string[];
    initialMetaColumns?: string[];
}

/** Catalog of scopes — phrasing suggestions are signals; this list is the product. */
export const DLM_SCOPES: DlmScope[] = [
    { id: 'message_id', group: 'Identifiers', label: 'Message Id (exact)', kind: 'message_id', suggestWeight: 40, keywords: ['id', 'msgid'] },
    { id: 'raw', group: 'Message content', label: 'Raw', kind: 'content', param: 'rawContentSearch', suggestWeight: 20 },
    { id: 'processed_raw', group: 'Message content', label: 'Processed Raw', kind: 'content', param: 'processedRawContentSearch', keywords: ['processed'] },
    { id: 'transformed', group: 'Message content', label: 'Transformed', kind: 'content', param: 'transformedContentSearch', suggestWeight: 15 },
    { id: 'encoded', group: 'Message content', label: 'Encoded', kind: 'content', param: 'encodedContentSearch' },
    { id: 'sent', group: 'Message content', label: 'Sent', kind: 'content', param: 'sentContentSearch' },
    { id: 'response', group: 'Message content', label: 'Response', kind: 'content', param: 'responseContentSearch', keywords: ['ack'] },
    { id: 'response_transformed', group: 'Message content', label: 'Response Transformed', kind: 'content', param: 'responseTransformedContentSearch' },
    { id: 'processed_response', group: 'Message content', label: 'Processed Response', kind: 'content', param: 'processedResponseContentSearch' },
    { id: 'source_map', group: 'Maps', label: 'Source Map', kind: 'content', param: 'sourceMapContentSearch', suggestWeight: 25, keywords: ['sourcemap', 'source'] },
    { id: 'channel_map', group: 'Maps', label: 'Channel Map', kind: 'content', param: 'channelMapContentSearch', keywords: ['channelmap'] },
    { id: 'connector_map', group: 'Maps', label: 'Connector Map', kind: 'content', param: 'connectorMapContentSearch' },
    { id: 'response_map', group: 'Maps', label: 'Response Map', kind: 'content', param: 'responseMapContentSearch' },
    { id: 'processing_error', group: 'Errors', label: 'Processing Error', kind: 'content', param: 'processingErrorContentSearch', keywords: ['error'] },
    { id: 'postprocessor_error', group: 'Errors', label: 'Postprocessor Error', kind: 'content', param: 'postprocessorErrorContentSearch' },
    { id: 'response_error', group: 'Errors', label: 'Response Error', kind: 'content', param: 'responseErrorContentSearch' },
    { id: 'metadata', group: 'Metadata', label: 'Custom Metadata column(s)', kind: 'metadata', suggestWeight: 15, keywords: ['meta', 'column'] },
    {
        id: 'legacy_text',
        group: 'Legacy',
        label: 'All content (engine textSearch — slow)',
        kind: 'legacy_text',
        suggestWeight: 0,
        keywords: ['wildcard', 'all', 'everything']
    }
];

export function dlmNormalize(raw: string): string {
    return String(raw || '').replace(/\s+/g, ' ').trim();
}

/** True when the phrase looks like a message id the user probably wants exact. */
export function dlmLooksLikeMessageId(text: string): boolean {
    return /^\d{1,18}$/.test(text.trim());
}

/**
 * Suggest which scopes to pre-check. Purely deterministic heuristics — the
 * user still confirms in the prompt.
 */
export function dlmSuggestScopeIds(text: string, metaColumns: DlmMetaColumn[] = []): string[] {
    const t = dlmNormalize(text);
    if (!t) return [];
    if (dlmLooksLikeMessageId(t)) return ['message_id'];
    const out: string[] = ['raw', 'source_map'];
    if (metaColumns.some((c) => c && c.name)) out.push('metadata');
    return out;
}

/** Filter the catalog for typeahead — label, group, keywords, id. */
export function dlmFilterScopes(needle: string, available: DlmScope[]): DlmScope[] {
    const q = needle.trim().toLowerCase();
    if (!q) return available.slice();
    return available.filter((s) => {
        const hay = [s.id, s.label, s.group, ...(s.keywords || [])]
            .join(' ')
            .toLowerCase();
        return hay.includes(q) || q.split(/\s+/).every((w) => hay.includes(w));
    });
}

/**
 * Turn (phrase + chosen scopes) into engine query params.
 * Never emits `textSearch` unless the legacy scope is explicitly selected alone.
 */
export function dlmBuildDecision(raw: string, opts: DlmBuildOptions): DlmDecision {
    const normalized = dlmNormalize(raw);
    const scopes = [...new Set(opts.scopes || [])];
    const metaColumns = [...new Set((opts.metaColumns || []).map((n) => String(n || '').trim()).filter(Boolean))];
    const empty: DlmDecision = {
        raw: String(raw || ''),
        normalized,
        operation: 'UNSUPPORTED',
        scopes: [],
        metaColumns: [],
        params: {},
        summary: [],
        confidence: 0
    };
    if (!normalized || !scopes.length) return empty;

    const params: Record<string, unknown> = {};
    const summary: string[] = [];
    let operation: DlmDecision['operation'] = 'SCOPED_SEARCH';
    let confidence = 50;

    // Legacy textSearch is exclusive: if the user also picked a real scope,
    // prefer the isolated params and drop the wildcard.
    if (scopes.includes('legacy_text') && scopes.length === 1) {
        params.textSearch = normalized;
        if (opts.textSearchRegex) params.textSearchRegex = true;
        summary.push(`Text Search: "${normalized}"${opts.textSearchRegex ? ' (regex)' : ''} (legacy)`);
        return {
            raw: String(raw || ''),
            normalized,
            operation: 'LEGACY_TEXT',
            scopes: ['legacy_text'],
            metaColumns: [],
            params,
            summary,
            confidence: 40
        };
    }
    const activeScopes = scopes.filter((id) => id !== 'legacy_text');

    if (activeScopes.includes('message_id')) {
        if (dlmLooksLikeMessageId(normalized)) {
            params.minMessageId = normalized;
            params.maxMessageId = normalized;
            summary.push(`Message Id: ${normalized}`);
            operation = activeScopes.length === 1 ? 'MESSAGE_ID' : 'SCOPED_SEARCH';
            confidence = 90;
        }
    }

    const byId = new Map(DLM_SCOPES.map((s) => [s.id, s]));
    for (const id of activeScopes) {
        const scope = byId.get(id);
        if (!scope || scope.kind !== 'content' || !scope.param) continue;
        const key = scope.param;
        const list = (params[key] as string[] | undefined) || [];
        list.push(normalized);
        params[key] = list;
        summary.push(`${scope.label} contains "${normalized}"`);
        confidence = Math.max(confidence, 70);
    }

    if (activeScopes.includes('metadata')) {
        const op = opts.metaOperator || 'CONTAINS';
        const key = opts.metaIgnoreCase === false ? 'metaDataSearch' : 'metaDataCaseInsensitiveSearch';
        if (metaColumns.length) {
            const list = (params[key] as string[] | undefined) || [];
            for (const col of metaColumns) {
                list.push(`${col} ${op} ${normalized}`);
                summary.push(`${col} ${op} ${normalized}${opts.metaIgnoreCase === false ? '' : ' (ignore case)'}`);
            }
            params[key] = list;
            confidence = Math.max(confidence, 65);
        }
    }

    if (!Object.keys(params).length) return empty;

    return {
        raw: String(raw || ''),
        normalized,
        operation,
        scopes: activeScopes,
        metaColumns,
        params,
        summary,
        confidence
    };
}

/**
 * Stepwise scope prompt — typeahead chips, not a checkbox wall.
 * Resolves to a DlmDecision on Search, or null on cancel.
 */
export async function promptDlmSearchScope(opts: DlmPromptOptions): Promise<DlmDecision | null> {
    const { h, modal } = await import('./ui.js');
    const text = dlmNormalize(opts.text);
    const metaCols = (opts.metaDataColumns || []).map((c) => String(c?.name || '').trim()).filter(Boolean);
    const available = DLM_SCOPES.filter((s) => !(s.kind === 'metadata' && !metaCols.length));
    const byId = new Map(available.map((s) => [s.id, s]));

    const selected = new Set(
        (opts.initialScopes?.length ? opts.initialScopes : dlmSuggestScopeIds(text, opts.metaDataColumns || []))
            .filter((id) => byId.has(id))
    );
    const selectedMeta = new Set(
        opts.initialMetaColumns?.length
            ? opts.initialMetaColumns.filter((n) => metaCols.includes(n))
            : (selected.has('metadata') ? metaCols.slice() : [])
    );

    return new Promise((resolve) => {
        let settled = false;
        const finish = (decision: DlmDecision | null) => {
            if (settled) return;
            settled = true;
            resolve(decision);
        };

        const body = h('div.dlm-scope-prompt');
        body.appendChild(h('p', { class: 'mb-2' },
            'Text Search walks every content store (wildcard) and is expensive. ',
            'Type a scope to add — keep the query isolated.'));
        body.appendChild(h('p', { class: 'mb-3 text-text-dim' },
            'Searching for: ', h('strong', text)));

        const chipHost = h('div.dlm-chips', {
            class: 'flex flex-wrap gap-1 mb-2 min-h-[28px]',
            'aria-label': 'Selected scopes'
        });
        const input = h('input', {
            type: 'search',
            placeholder: 'Type scope — raw, source map, metadata…',
            autocomplete: 'off',
            class: 'w-full',
            'aria-autocomplete': 'list',
            'aria-controls': 'dlm-scope-list'
        }) as HTMLInputElement;
        const list = h('div#dlm-scope-list', {
            role: 'listbox',
            class: 'dlm-scope-list max-h-[220px] overflow-auto border border-[var(--line)] rounded mt-1'
        });
        const metaHost = h('div.dlm-meta-block', { class: 'mt-3 hidden' });
        metaHost.appendChild(h('div', { class: 'text-text-dim mb-1' }, 'Metadata columns'));
        const metaChipHost = h('div', { class: 'flex flex-wrap gap-1 mb-1 min-h-[24px]' });
        const metaInput = h('input', {
            type: 'search',
            placeholder: 'Type a metadata column…',
            autocomplete: 'off',
            class: 'w-full'
        }) as HTMLInputElement;
        const metaList = h('div', {
            role: 'listbox',
            class: 'max-h-[140px] overflow-auto border border-[var(--line)] rounded mt-1'
        });
        metaHost.append(metaChipHost, metaInput, metaList);

        let active = 0;
        let filtered: DlmScope[] = [];

        const showWarn = (msg: string) => {
            const warn = body.querySelector('.dlm-scope-warn') as HTMLElement | null;
            if (warn) warn.remove();
            body.insertBefore(h('p.dlm-scope-warn', { class: 'text-err mb-2' }, msg), body.firstChild);
        };

        const renderChips = () => {
            chipHost.replaceChildren();
            for (const id of selected) {
                const scope = byId.get(id);
                if (!scope) continue;
                const btn = h('button', {
                    type: 'button',
                    class: 'btn',
                    title: 'Remove',
                    onClick: () => {
                        selected.delete(id);
                        if (id === 'metadata') selectedMeta.clear();
                        renderChips();
                        renderList();
                        renderMeta();
                        input.focus();
                    }
                }, `${scope.label} ×`);
                chipHost.appendChild(btn);
            }
            if (!selected.size) {
                chipHost.appendChild(h('span', { class: 'text-text-faint' }, 'No scopes yet — type below'));
            }
        };

        const renderList = () => {
            const needle = input.value;
            filtered = dlmFilterScopes(needle, available.filter((s) => !selected.has(s.id)));
            if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
            list.replaceChildren();
            if (!filtered.length) {
                list.appendChild(h('div', { class: 'p-2 text-text-faint' },
                    needle.trim() ? 'No matching scopes' : 'All scopes already added'));
                return;
            }
            filtered.forEach((scope, i) => {
                const row = h('div', {
                    role: 'option',
                    'aria-selected': String(i === active),
                    class: `px-2 py-1.5 cursor-pointer ${i === active ? 'bg-[var(--bg3)]' : ''}`,
                    onMouseEnter: () => { active = i; renderList(); },
                    onMouseDown: (e: MouseEvent) => { e.preventDefault(); addScope(scope.id); }
                },
                    h('div', scope.label),
                    h('div', { class: 'text-text-faint text-[10px]' }, scope.group)
                );
                list.appendChild(row);
            });
        };

        const addScope = (id: string) => {
            if (!byId.has(id) || selected.has(id)) return;
            selected.add(id);
            if (id === 'metadata' && !selectedMeta.size) {
                for (const c of metaCols) selectedMeta.add(c);
            }
            input.value = '';
            active = 0;
            renderChips();
            renderList();
            renderMeta();
            input.focus();
        };

        const renderMeta = () => {
            const on = selected.has('metadata');
            metaHost.classList.toggle('hidden', !on);
            if (!on) return;
            metaChipHost.replaceChildren();
            for (const name of selectedMeta) {
                metaChipHost.appendChild(h('button', {
                    type: 'button',
                    class: 'btn',
                    onClick: () => {
                        selectedMeta.delete(name);
                        renderMeta();
                        metaInput.focus();
                    }
                }, `${name} ×`));
            }
            const q = metaInput.value.trim().toLowerCase();
            const opts = metaCols.filter((n) => !selectedMeta.has(n) && (!q || n.toLowerCase().includes(q)));
            metaList.replaceChildren();
            for (const name of opts) {
                metaList.appendChild(h('div', {
                    class: 'px-2 py-1 cursor-pointer hover:bg-[var(--bg3)]',
                    onMouseDown: (e: MouseEvent) => {
                        e.preventDefault();
                        selectedMeta.add(name);
                        metaInput.value = '';
                        renderMeta();
                        metaInput.focus();
                    }
                }, name));
            }
            if (!opts.length) {
                metaList.appendChild(h('div', { class: 'p-2 text-text-faint' },
                    q ? 'No matching columns' : 'All columns selected'));
            }
        };

        input.addEventListener('input', () => { active = 0; renderList(); });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filtered.length) { active = (active + 1) % filtered.length; renderList(); }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (filtered.length) { active = (active - 1 + filtered.length) % filtered.length; renderList(); }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[active]) addScope(filtered[active].id);
            } else if (e.key === 'Backspace' && !input.value && selected.size) {
                const last = [...selected].pop();
                if (last) {
                    selected.delete(last);
                    if (last === 'metadata') selectedMeta.clear();
                    renderChips();
                    renderList();
                    renderMeta();
                }
            }
        });
        metaInput.addEventListener('input', () => renderMeta());
        metaInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = metaInput.value.trim().toLowerCase();
                const hit = metaCols.find((n) => !selectedMeta.has(n) && n.toLowerCase().includes(q));
                if (hit) {
                    selectedMeta.add(hit);
                    metaInput.value = '';
                    renderMeta();
                }
            }
        });

        body.append(chipHost, input, list, metaHost);
        renderChips();
        renderList();
        renderMeta();

        modal({
            title: 'Focus search scope',
            size: 'md',
            body,
            onClose: () => finish(null),
            buttons: [
                { label: 'Cancel', onClick: () => { finish(null); return true; } },
                {
                    label: 'Search',
                    primary: true,
                    onClick: () => {
                        if (!selected.size) {
                            showWarn('Add at least one scope.');
                            input.focus();
                            return false;
                        }
                        if (selected.has('metadata') && !selectedMeta.size) {
                            showWarn('Add at least one metadata column.');
                            metaInput.focus();
                            return false;
                        }
                        const decision = dlmBuildDecision(text, {
                            scopes: [...selected],
                            metaColumns: [...selectedMeta],
                            metaIgnoreCase: true,
                            textSearchRegex: !!opts.textSearchRegex
                        });
                        if (decision.operation === 'UNSUPPORTED') {
                            showWarn('That scope cannot be applied to this phrase (e.g. Message Id needs digits).');
                            return false;
                        }
                        finish(decision);
                        return true;
                    }
                }
            ]
        });

        setTimeout(() => input.focus(), 0);
    });
}
