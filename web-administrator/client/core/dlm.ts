/*
 * Message-search DLM — Deterministic Language Model for the Message Browser's
 * free-typed Text Search.
 *
 * The engine's `textSearch` query is a wildcard: it walks message content,
 * maps, and related stores in one shot and is expensive on busy channels.
 * After the user enters a phrase (e.g. "123456") and presses Search, the
 * companion prompt (promptDlmSearchScope) asks for a *scope* and
 * dlmBuildDecision builds an isolated query from the scoped params the
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
    { id: 'message_id', group: 'Identifiers', label: 'Message Id (exact)', kind: 'message_id', suggestWeight: 40 },
    { id: 'raw', group: 'Message content', label: 'Raw', kind: 'content', param: 'rawContentSearch', suggestWeight: 20 },
    { id: 'processed_raw', group: 'Message content', label: 'Processed Raw', kind: 'content', param: 'processedRawContentSearch' },
    { id: 'transformed', group: 'Message content', label: 'Transformed', kind: 'content', param: 'transformedContentSearch', suggestWeight: 15 },
    { id: 'encoded', group: 'Message content', label: 'Encoded', kind: 'content', param: 'encodedContentSearch' },
    { id: 'sent', group: 'Message content', label: 'Sent', kind: 'content', param: 'sentContentSearch' },
    { id: 'response', group: 'Message content', label: 'Response', kind: 'content', param: 'responseContentSearch' },
    { id: 'response_transformed', group: 'Message content', label: 'Response Transformed', kind: 'content', param: 'responseTransformedContentSearch' },
    { id: 'processed_response', group: 'Message content', label: 'Processed Response', kind: 'content', param: 'processedResponseContentSearch' },
    { id: 'source_map', group: 'Maps', label: 'Source Map', kind: 'content', param: 'sourceMapContentSearch', suggestWeight: 25 },
    { id: 'channel_map', group: 'Maps', label: 'Channel Map', kind: 'content', param: 'channelMapContentSearch', suggestWeight: 10 },
    { id: 'connector_map', group: 'Maps', label: 'Connector Map', kind: 'content', param: 'connectorMapContentSearch' },
    { id: 'response_map', group: 'Maps', label: 'Response Map', kind: 'content', param: 'responseMapContentSearch' },
    { id: 'processing_error', group: 'Errors', label: 'Processing Error', kind: 'content', param: 'processingErrorContentSearch' },
    { id: 'postprocessor_error', group: 'Errors', label: 'Postprocessor Error', kind: 'content', param: 'postprocessorErrorContentSearch' },
    { id: 'response_error', group: 'Errors', label: 'Response Error', kind: 'content', param: 'responseErrorContentSearch' },
    { id: 'metadata', group: 'Metadata', label: 'Custom Metadata column(s)', kind: 'metadata', suggestWeight: 15 },
    {
        id: 'legacy_text',
        group: 'Legacy',
        label: 'All content (engine textSearch — slow)',
        kind: 'legacy_text',
        suggestWeight: 0
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
 * Stepwise scope prompt. Resolves to a DlmDecision on Search, or null on cancel.
 * Keeps the expensive wildcard (`textSearch`) behind an explicit Legacy choice.
 */
export async function promptDlmSearchScope(opts: DlmPromptOptions): Promise<DlmDecision | null> {
    const { h, modal, checkbox } = await import('./ui.js');
    const text = dlmNormalize(opts.text);
    const metaCols = (opts.metaDataColumns || []).map((c) => String(c?.name || '').trim()).filter(Boolean);
    const suggested = opts.initialScopes?.length
        ? opts.initialScopes
        : dlmSuggestScopeIds(text, opts.metaDataColumns || []);

    return new Promise((resolve) => {
        const checks = new Map<string, { input: HTMLInputElement; scope: DlmScope }>();
        const metaChecks = new Map<string, HTMLInputElement>();

        const groups = new Map<string, DlmScope[]>();
        for (const scope of DLM_SCOPES) {
            if (scope.kind === 'metadata' && !metaCols.length) continue;
            const list = groups.get(scope.group) || [];
            list.push(scope);
            groups.set(scope.group, list);
        }

        const body = h('div.dlm-scope-prompt');
        body.appendChild(h('p', { class: 'mb-2' },
            'Text Search walks every content store (wildcard) and is expensive. ',
            'Pick one or more scopes so the query stays isolated.'));
        body.appendChild(h('p', { class: 'mb-3 text-text-dim' },
            'Searching for: ', h('strong', text)));

        const metaBlock = h('div.dlm-meta-cols', { class: 'ml-5 mb-2 hidden' });
        if (metaCols.length) {
            metaBlock.appendChild(h('div', { class: 'text-text-dim mb-1' }, 'Metadata columns:'));
            const initialMeta = new Set(opts.initialMetaColumns?.length ? opts.initialMetaColumns : metaCols);
            for (const name of metaCols) {
                const row = checkbox(name, initialMeta.has(name));
                metaChecks.set(name, row.input as HTMLInputElement);
                metaBlock.appendChild(h('div', { class: 'mb-1' }, row.el));
            }
        }

        for (const [group, scopes] of groups) {
            body.appendChild(h('div', { class: 'font-medium mt-2 mb-1' }, group));
            for (const scope of scopes) {
                const checked = suggested.includes(scope.id);
                const row = checkbox(scope.label, checked);
                const input = row.input as HTMLInputElement;
                checks.set(scope.id, { input, scope });
                body.appendChild(h('div', { class: 'mb-1' }, row.el));
                if (scope.id === 'metadata') {
                    body.appendChild(metaBlock);
                    const syncMeta = () => {
                        metaBlock.classList.toggle('hidden', !input.checked);
                    };
                    input.addEventListener('change', syncMeta);
                    syncMeta();
                }
                if (scope.id === 'legacy_text') {
                    body.appendChild(h('div', { class: 'ml-5 mb-2 text-text-faint' },
                        'Uses the engine textSearch wildcard. Prefer scoped content/maps/metadata.'));
                }
            }
        }

        let settled = false;
        const finish = (decision: DlmDecision | null) => {
            if (settled) return;
            settled = true;
            resolve(decision);
        };

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
                        const selected = [...checks.entries()]
                            .filter(([, v]) => v.input.checked)
                            .map(([id]) => id);
                        if (!selected.length) {
                            const warn = body.querySelector('.dlm-scope-warn') as HTMLElement | null;
                            if (warn) warn.remove();
                            body.insertBefore(
                                h('p.dlm-scope-warn', { class: 'text-err mb-2' }, 'Choose at least one scope.'),
                                body.firstChild
                            );
                            return false;
                        }
                        const metaSelected = [...metaChecks.entries()]
                            .filter(([, input]) => input.checked)
                            .map(([name]) => name);
                        if (selected.includes('metadata') && !metaSelected.length) {
                            const warn = body.querySelector('.dlm-scope-warn') as HTMLElement | null;
                            if (warn) warn.remove();
                            body.insertBefore(
                                h('p.dlm-scope-warn', { class: 'text-err mb-2' }, 'Pick at least one metadata column.'),
                                body.firstChild
                            );
                            return false;
                        }
                        const decision = dlmBuildDecision(text, {
                            scopes: selected,
                            metaColumns: metaSelected,
                            metaIgnoreCase: true,
                            textSearchRegex: !!opts.textSearchRegex
                        });
                        if (decision.operation === 'UNSUPPORTED') {
                            const warn = body.querySelector('.dlm-scope-warn') as HTMLElement | null;
                            if (warn) warn.remove();
                            body.insertBefore(
                                h('p.dlm-scope-warn', { class: 'text-err mb-2' },
                                    'That scope cannot be applied to this phrase (e.g. Message Id needs digits).'),
                                body.firstChild
                            );
                            return false;
                        }
                        finish(decision);
                        return true;
                    }
                }
            ]
        });
    });
}
