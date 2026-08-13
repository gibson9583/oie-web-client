/*
 * Compare Messages — the selection state machine behind the message browser's
 * "Select for Compare" / "Compare with Selection…" workflow.
 *
 *   IDLE ──select──▶ ANCHORED ──propose──▶ CONFIRMING ──confirm──▶ COMPARING
 *     ◀── clear ────────┘          ◀── cancel (anchor kept) ──┘
 *
 * THIS MODULE HOLDS REFERENCES ONLY — never message content. A CompareRef is a
 * coordinate (channel + message + connector + stage), which is why the anchor can
 * outlive a navigation without any of the message ever leaving the engine. The
 * content itself is fetched fresh when the overlay opens (so the engine
 * re-authorizes and returns current truth) and lives in that component's state
 * until it unmounts.
 *
 * Deliberately separate from core/store.js's key/value state: nothing here may
 * end up in anything that is, or later becomes, persisted. For the same reason
 * there is no localStorage/sessionStorage in this file — see the eslint override
 * in the root config, which makes that a lint error rather than a convention.
 *
 * Session end of ANY kind (explicit logout, idle logout, a background 401) clears
 * the selection and fires 'compare:end' so a mounted overlay tears down before
 * the login screen renders — no PHI left on an unattended screen.
 */

import { emit, on } from './store.js';
import { onSessionExpired } from './api.js';

/** The pipeline stages that can be compared (Swing's content tabs). */
export type CompareContentType = 'RAW' | 'PROCESSED_RAW' | 'TRANSFORMED' | 'ENCODED' | 'SENT' | 'RESPONSE';

export interface CompareRef {
    channelId: string;
    /** Display only, captured at selection time. See describeRef for why it matters. */
    channelName?: string;
    messageId: number;
    /** 0 = source connector. */
    metaDataId: number;
    /** Display only. */
    connectorName: string;
    contentType: CompareContentType;
    /** What the engine actually stored for this connector message, captured at
        selection time so the submenus/dropdowns render without another fetch.
        Re-validated when the overlay opens (content may have been pruned since). */
    storedTypes: CompareContentType[];
    /** Data types by stage (e.g. `{ RAW: 'HL7V2' }`) — a hint for the diff
        editor's per-side language; the fresh fetch is the authority. */
    dataTypes?: Partial<Record<CompareContentType, string>>;
}

export interface ComparePair { left: CompareRef; right: CompareRef; }

/* Stage order + labels, and the ConnectorMessage field each one reads. One
   table so the menus, the dropdowns and the fetch can never disagree. */
export const COMPARE_STAGES: ReadonlyArray<{ type: CompareContentType; label: string; key: string }> = [
    { type: 'RAW', label: 'Raw', key: 'raw' },
    { type: 'PROCESSED_RAW', label: 'Processed Raw', key: 'processedRaw' },
    { type: 'TRANSFORMED', label: 'Transformed', key: 'transformed' },
    { type: 'ENCODED', label: 'Encoded', key: 'encoded' },
    { type: 'SENT', label: 'Sent', key: 'sent' },
    { type: 'RESPONSE', label: 'Response', key: 'response' }
];

const BY_TYPE = new Map(COMPARE_STAGES.map(s => [s.type, s]));

/** Human label for a stage ("Processed Raw"). */
export function stageLabel(type: CompareContentType): string {
    return BY_TYPE.get(type)?.label ?? String(type);
}

/** The ConnectorMessage field a stage's content lives in ("processedRaw"). */
export function stageKey(type: CompareContentType): string {
    return BY_TYPE.get(type)?.key ?? '';
}

/**
 * Which stages a connector message actually carries. The MESSAGE is the ground
 * truth, not the channel's storage mode: this handles pruned content and
 * per-message variance for free. A source connector (metaDataId 0) never stores
 * SENT, so it is excluded even if a payload somehow appears there.
 */
export function storedContentTypes(cm: any): CompareContentType[] {
    if (!cm || typeof cm !== 'object') return [];
    const isSource = Number(cm.metaDataId ?? 0) === 0;
    return COMPARE_STAGES
        .filter(({ type, key }) => {
            if (type === 'SENT' && isSource) return false;
            const content = cm[key] && cm[key].content;
            return content !== null && content !== undefined && content !== '';
        })
        .map(s => s.type);
}

/**
 * Build a reference from a loaded connector message. Reads only the coordinates
 * and the per-stage data types (a hint for the diff editor's language) — the
 * content itself is left where it is and re-fetched when the overlay opens.
 */
export function refFromConnectorMessage(
    channel: { id: string; name?: string }, messageId: number | string, cm: any, contentType: CompareContentType
): CompareRef {
    const metaDataId = Number(cm?.metaDataId ?? 0);
    const storedTypes = storedContentTypes(cm);
    const dataTypes: Partial<Record<CompareContentType, string>> = {};
    for (const type of storedTypes) {
        const dataType = cm?.[stageKey(type)]?.dataType;
        if (dataType) dataTypes[type] = String(dataType);
    }
    return {
        channelId: String(channel.id),
        channelName: channel.name ? String(channel.name) : undefined,
        messageId: Number(messageId),
        metaDataId,
        connectorName: cm?.connectorName || (metaDataId === 0 ? 'Source' : `Connector ${metaDataId}`),
        contentType,
        storedTypes,
        dataTypes
    };
}

/** True when two refs point at exactly the same stored content. */
export function samePair(a: CompareRef | null, b: CompareRef | null): boolean {
    if (!a || !b) return false;
    return String(a.channelId) === String(b.channelId)
        && Number(a.messageId) === Number(b.messageId)
        && Number(a.metaDataId) === Number(b.metaDataId)
        && a.contentType === b.contentType;
}

/**
 * "Orders In · Msg 41207 · Source · Raw" — the reference, never the content.
 *
 * The channel LEADS, and is never omitted, because a message id is a per-channel
 * sequence: every channel has a message 1. Two references from different
 * channels would otherwise render identically, which matters most in exactly the
 * place it would be least noticed — the two side headers of a comparison. Falls
 * back to the channel id on the rare path where the name hasn't loaded yet.
 */
export function describeRef(ref: CompareRef | null): string {
    if (!ref) return '';
    const connector = ref.connectorName || `Connector ${ref.metaDataId}`;
    return `${ref.channelName || ref.channelId} · Msg ${ref.messageId} · ${connector} · ${stageLabel(ref.contentType)}`;
}

/** True when both references are for the same message of the same channel. */
export function sameMessage(a: CompareRef | null, b: CompareRef | null): boolean {
    if (!a || !b) return false;
    return String(a.channelId) === String(b.channelId) && Number(a.messageId) === Number(b.messageId);
}

/* ---- state (refs only) ------------------------------------------------------ */

let anchor: CompareRef | null = null;
let pending: CompareRef | null = null;

const changed = () => emit('compare:changed', { anchor, pending });

export function getAnchor(): CompareRef | null { return anchor; }
export function getPending(): CompareRef | null { return pending; }

/** IDLE/ANCHORED → ANCHORED: the first side of the comparison. */
export function selectForCompare(ref: CompareRef): void {
    anchor = ref;
    pending = null;
    changed();
}

/**
 * ANCHORED → CONFIRMING. Returns 'same' (and stages nothing) when the candidate
 * IS the anchor — comparing content with itself is never what was meant, so the
 * caller warns instead of opening the confirm modal — or 'none' with no anchor.
 */
export function proposeCompare(ref: CompareRef): 'same' | 'none' | 'ok' {
    if (!anchor) return 'none';
    if (samePair(anchor, ref)) return 'same';
    pending = ref;
    changed();
    return 'ok';
}

/** CONFIRMING → COMPARING: consumes the pending candidate, keeps the anchor. */
export function confirmCompare(): ComparePair | null {
    if (!anchor || !pending) return null;
    const pair = { left: anchor, right: pending };
    pending = null;
    changed();
    return pair;
}

/** Cancel/Esc/scrim: discard ONLY the second selection. The anchor survives. */
export function cancelPending(): void {
    if (!pending) return;
    pending = null;
    changed();
}

/** Full reset to IDLE (the chip's ✕, and every session-end path). */
export function clearCompare(): void {
    if (!anchor && !pending) return;
    anchor = null;
    pending = null;
    changed();
}

/*
 * Session end. 'compare:end' goes out FIRST so an open overlay disposes its diff
 * models and drops its content buffers while it is still mounted; clearing the
 * anchor afterwards leaves the next user of this tab with a clean IDLE state.
 *
 * Registered once, at module load, deliberately without an unsubscribe: this is
 * the module's own lifetime, and a compare selection must be cleared by a dead
 * session whether or not any view happens to be mounted.
 */
function endSession(): void {
    emit('compare:end');
    clearCompare();
}

onSessionExpired(endSession);
// Explicit sign-out and idle auto-logout, emitted by the shell (core/api.js
// never sees those — they are client-side flows, not a 401).
on('session:logout', endSession);
