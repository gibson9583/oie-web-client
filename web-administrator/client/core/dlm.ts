/*
 * Dashboard DLM — Deterministic Language Model for the filter bar's free-typed
 * (wildcard) search.
 *
 * The dashboard filter historically treated every keystroke as a substring of
 * channel / tag names. That is still the fallback. When the typed text looks
 * like an operational ask ("stopped", "with errors", "queued channels"), this
 * module maps it to a structured filter decision — same input, same decision,
 * no LLM, no sampling.
 *
 * Shape of a decision:
 *
 *   { operation, states?, stats?, nameNeedle, confidence, … }
 *
 * The dashboard ORs structural matches with the legacy name/tag substring so a
 * channel named "Demo Stopped" still appears when the user types "stopped", while
 * every other STOPPED channel appears too.
 */

export type DlmStatKey = 'RECEIVED' | 'FILTERED' | 'QUEUED' | 'SENT' | 'ERROR';

export interface DlmStatFilter {
    key: DlmStatKey;
    /** Inclusive lower bound; defaults to 1 (any non-zero). */
    min?: number;
}

export type DlmOperation =
    | 'FILTER_STATE'
    | 'FILTER_STAT'
    | 'FILTER_COMPOSITE'
    | 'FILTER_NAME';

export interface DlmDecision {
    raw: string;
    normalized: string;
    operation: DlmOperation;
    /** Deployed lifecycle states to keep (uppercase engine values). */
    states: string[];
    /** Statistic thresholds to keep (OR'd within the list). */
    stats: DlmStatFilter[];
    /** Legacy wildcard needle — always the normalized input when non-empty. */
    nameNeedle: string;
    confidence: number;
    /** Route ids that contributed, for tests / debug. */
    matchedRoutes: string[];
}

export interface DlmChannelContext {
    channelId: string;
    name?: string | null;
    state?: string | null;
    /** Already-parsed statistics for the active Current/Lifetime toggle. */
    stats: Partial<Record<DlmStatKey, number>>;
    /** Tag names attached to this channel (lowercased or raw — matched case-insensitively). */
    tagNames?: string[];
}

interface Route {
    id: string;
    phrases: string[];
    weight: number;
    states?: string[];
    stats?: DlmStatFilter[];
}

/* Capability catalog — phrasing is a signal; these routes are the product. */
const ROUTES: Route[] = [
    {
        id: 'STATE_STOPPED',
        phrases: ['stopped', 'not running', 'halted', 'stopped channels', 'show stopped', 'channels that are stopped'],
        weight: 20,
        states: ['STOPPED']
    },
    {
        id: 'STATE_STARTED',
        phrases: ['started', 'running', 'started channels', 'running channels', 'show running', 'channels that are running'],
        weight: 20,
        states: ['STARTED']
    },
    {
        id: 'STATE_PAUSED',
        phrases: ['paused', 'paused channels', 'show paused', 'channels that are paused'],
        weight: 20,
        states: ['PAUSED']
    },
    {
        id: 'STATE_UNDEPLOYED',
        phrases: ['undeployed', 'not deployed', 'undeployed channels', 'show undeployed'],
        weight: 20,
        states: ['UNDEPLOYED']
    },
    {
        id: 'STAT_ERROR',
        phrases: [
            'errored', 'errors', 'error', 'with errors', 'has errors', 'failing',
            'in error', 'erroring', 'show errors', 'channels with errors', 'any errors'
        ],
        weight: 20,
        stats: [{ key: 'ERROR', min: 1 }]
    },
    {
        id: 'STAT_QUEUED',
        phrases: ['queued', 'with queue', 'in queue', 'backed up', 'queued channels', 'show queued', 'has queue'],
        weight: 20,
        stats: [{ key: 'QUEUED', min: 1 }]
    },
    {
        id: 'STAT_FILTERED',
        phrases: ['filtered', 'with filtered', 'filtered messages', 'show filtered'],
        weight: 18,
        stats: [{ key: 'FILTERED', min: 1 }]
    }
];

const MIN_ROUTE_SCORE = 20;

export function dlmNormalize(raw: string): string {
    let n = String(raw || '').toLowerCase();
    n = n.replace(/[?!.,;:"']+/g, ' ');
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

/** True when every phrase word appears in order (allows fillers between words). */
export function dlmWordsOrdered(text: string, phrase: string): boolean {
    const words = phrase.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    let regex = '';
    for (const w of words) {
        if (!/^[a-z0-9_-]+$/.test(w)) continue;
        regex = regex ? `${regex}.*\\s${w}` : w;
    }
    if (!regex) return false;
    return new RegExp(regex).test(text);
}

/** Score how well `text` hits a CSV-or-array of phrases. */
export function dlmPhraseHit(text: string, phrases: string[], weight: number): number {
    let score = 0;
    for (const raw of phrases) {
        const p = String(raw || '').trim();
        if (!p) continue;
        if (text === p) {
            score += weight * 3;
        } else if (p.length <= 3) {
            // Short tokens must be whole words — avoids "err" inside unrelated ids.
            if (new RegExp(`(^|\\s)${p}($|\\s|[.,;:!?\"'\\-_/])`).test(text)) {
                score += weight;
            }
        } else if (text.includes(p)) {
            score += weight;
        } else if (dlmWordsOrdered(text, p)) {
            score += weight;
        }
    }
    return score;
}

/**
 * Map free-typed filter text to a deterministic filter decision.
 * Empty input → FILTER_NAME with empty needle (caller treats as "show all").
 */
export function dlmDecide(raw: string): DlmDecision {
    const normalized = dlmNormalize(raw);
    const empty: DlmDecision = {
        raw: String(raw || ''),
        normalized,
        operation: 'FILTER_NAME',
        states: [],
        stats: [],
        nameNeedle: normalized,
        confidence: 0,
        matchedRoutes: []
    };
    if (!normalized) return empty;

    const scored: { route: Route; score: number }[] = [];
    for (const route of ROUTES) {
        const score = dlmPhraseHit(normalized, route.phrases, route.weight);
        if (score >= MIN_ROUTE_SCORE) scored.push({ route, score });
    }

    if (!scored.length) {
        return { ...empty, confidence: 0 };
    }

    scored.sort((a, b) => b.score - a.score);

    const states: string[] = [];
    const stats: DlmStatFilter[] = [];
    const matchedRoutes: string[] = [];
    let confidence = 0;

    for (const { route, score } of scored) {
        matchedRoutes.push(route.id);
        confidence = Math.max(confidence, Math.min(100, score));
        for (const s of route.states || []) {
            if (!states.includes(s)) states.push(s);
        }
        for (const st of route.stats || []) {
            if (!stats.some((x) => x.key === st.key && (x.min ?? 1) === (st.min ?? 1))) {
                stats.push({ ...st });
            }
        }
    }

    let operation: DlmOperation = 'FILTER_NAME';
    if (states.length && stats.length) operation = 'FILTER_COMPOSITE';
    else if (states.length) operation = 'FILTER_STATE';
    else if (stats.length) operation = 'FILTER_STAT';

    return {
        raw: String(raw || ''),
        normalized,
        operation,
        states,
        stats,
        nameNeedle: normalized,
        confidence,
        matchedRoutes
    };
}

function nameOrTagHit(ctx: DlmChannelContext, needle: string): boolean {
    if (!needle) return false;
    if (String(ctx.name || '').toLowerCase().includes(needle)) return true;
    for (const t of ctx.tagNames || []) {
        if (String(t || '').toLowerCase().includes(needle)) return true;
    }
    return false;
}

function structuralHit(ctx: DlmChannelContext, decision: DlmDecision): boolean {
    if (decision.states.length) {
        const state = String(ctx.state || '').toUpperCase();
        if (decision.states.includes(state)) return true;
    }
    for (const st of decision.stats) {
        const min = st.min ?? 1;
        const value = Number(ctx.stats?.[st.key] || 0);
        if (value >= min) return true;
    }
    return false;
}

/**
 * True when the channel should remain visible for this decision.
 * Structural routes OR the legacy name/tag wildcard — never AND — so operational
 * phrases broaden the result set instead of hiding name matches.
 */
export function dlmMatchesChannel(ctx: DlmChannelContext, decision: DlmDecision): boolean {
    if (!decision.normalized) return true;
    if (decision.operation === 'FILTER_NAME') {
        return nameOrTagHit(ctx, decision.nameNeedle);
    }
    return structuralHit(ctx, decision) || nameOrTagHit(ctx, decision.nameNeedle);
}
