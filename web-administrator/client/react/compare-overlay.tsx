/*
 * Compare Messages — the side-by-side diff overlay.
 *
 * Opens on two CompareRefs (coordinates, see core/compare.ts), fetches each
 * side's content FRESH from the engine, and renders them in the shared Monaco
 * diff editor (core/diffeditor.ts, which falls back to a plain two-pane view
 * when Monaco is unavailable).
 *
 * PHI lifecycle — the part that matters:
 *   - Content is fetched per open and per stage change, never reused from the
 *     row caches the browser keeps. A re-fetch is how the engine re-authorizes
 *     the read and how we notice content that was pruned or reprocessed since
 *     the reference was captured.
 *   - It lives in this component's state and in the Monaco models, nowhere else:
 *     no storage, no cache, no URL. Which is also why this is NOT a route —
 *     browser history is written to disk, and a route would put the channel and
 *     message ids of a comparison in it.
 *   - ONE teardown() runs from the effect cleanup, so every exit path — Close,
 *     Esc, Swap-then-close, a route change unmounting the view, session end —
 *     disposes the diff (freeing Monaco's models from its global registry) and
 *     drops the buffers. Session end additionally arrives as 'compare:end',
 *     which closes the overlay before the login screen renders.
 *
 * What it cannot promise, and does not claim in its UI: JavaScript strings can't
 * be zeroed and GC timing belongs to the browser. The guarantee is that content
 * never reaches disk through this feature and every in-memory reference is
 * released on close, navigation or session end.
 */

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import api from '@oie/web-api';
import { createDiffEditor } from '../core/diffeditor.js';
import { detectType } from '../core/content-highlight.js';
import { formatSentProperties } from '../core/sent-format.js';
import { parseResponse, toDisplayString } from '../core/xstream.js';
import { on } from '../core/store.js';
import {
    COMPARE_STAGES, clearCompare, describeRef, stageKey, stageLabel, storedContentTypes
} from '../core/compare.js';
import { Icon } from './bridges.jsx';

/* ---- content extraction (the same rules the detail pane renders by) --------- */

function contentOf(node: any): string | null {
    const c = node?.content;
    if (c === null || c === undefined || c === '') return null;
    return typeof c === 'object' ? toDisplayString(c) : String(c);
}

/**
 * One stage's text out of a freshly-fetched connector message, decoded exactly
 * as the browser's content tab shows it — the Response envelope unwrapped to its
 * payload, a destination's Sent properties rendered the Swing way. Comparing
 * what you were looking at is the whole point; a diff of XStream envelopes
 * would be noise.
 */
function stageContent(cm: any, contentType: any): { text: string; dataType: string } | null {
    const node = cm?.[stageKey(contentType)];
    let text = contentOf(node);
    if (text === null) return null;
    let dataType = node?.dataType || '';
    if (contentType === 'RESPONSE') {
        const env = parseResponse(text);
        if (env) { text = env.message || ''; dataType = ''; }
    } else if (contentType === 'SENT' && Number(cm.metaDataId) > 0) {
        const formatted = formatSentProperties(text);
        if (formatted != null) { text = formatted; dataType = 'TEXT'; }
    }
    return { text, dataType };
}

/* Monaco's language id for a pane. The two sides are resolved independently —
   an HL7 raw message against the XML it became is the common case. */
function monacoLanguage(text: any, dataType: any): string {
    const kind = detectType(text, dataType);
    return kind === 'xml' ? 'xml' : kind === 'json' ? 'json' : 'plaintext';
}

/* ---- one side ---------------------------------------------------------------- */

const LOADING = { status: 'loading' as const, text: '', language: 'plaintext', storedTypes: null as any, error: '' };

function useSideContent(ref: any, gen: number) {
    const [state, setState] = useState<any>(LOADING);

    useEffect(() => {
        let stale = false;
        setState(LOADING);
        (async () => {
            try {
                // Deliberately the full message, fetched now: the engine re-checks
                // authorization and answers with current truth, which a cached row
                // object cannot.
                const message = await api.messages.get(ref.channelId, ref.messageId);
                if (stale) return;
                const entries = message?.connectorMessages?.entry ?? message?.connectorMessages;
                const cms = api.asList(entries)
                    .map((e: any) => e?.connectorMessage ?? (e?.metaDataId !== undefined ? e : null))
                    .filter(Boolean);
                const cm = cms.find((c: any) => Number(c.metaDataId) === Number(ref.metaDataId));
                if (!cm) {
                    setState({ ...LOADING, status: 'missing', error: `Connector ${ref.metaDataId} is no longer part of message ${ref.messageId}.` });
                    return;
                }
                const storedTypes = storedContentTypes(cm);
                const content = stageContent(cm, ref.contentType);
                if (!content) {
                    // Pruned between selection and open, or never stored.
                    setState({
                        ...LOADING, status: 'missing', storedTypes,
                        error: `${stageLabel(ref.contentType)} content is not stored for this message.`
                    });
                    return;
                }
                setState({
                    status: 'ready', text: content.text, storedTypes, error: '',
                    language: monacoLanguage(content.text, content.dataType || ref.dataTypes?.[ref.contentType])
                });
            } catch (e: any) {
                if (!stale) setState({ ...LOADING, status: 'error', error: e?.message || String(e) });
            }
        })();
        // A side that is superseded (stage pivot, swap, retry) must not write its
        // content into the pane that moved on.
        return () => { stale = true; };
    }, [ref.channelId, ref.messageId, ref.metaDataId, ref.contentType, ref.dataTypes, gen]);

    return state;
}

function SideHeader({ side, compareRef, state, onStage }: any) {
    // The dropdown offers what the ENGINE says is stored right now (the fresh
    // fetch), falling back to what was captured at selection time until it lands.
    const stored: string[] = state.storedTypes || compareRef.storedTypes || [];
    return (
        <div className="compare-side-head">
            <span className={'tag ' + (side === 'left' ? 'accent' : 'amber')}>{side === 'left' ? 'Left' : 'Right'}</span>
            <span className="compare-side-ref mono">{describeRef(compareRef)}</span>
            <label className="compare-side-stage">
                <select aria-label={`${side === 'left' ? 'Left' : 'Right'} stage`}
                    value={compareRef.contentType}
                    onChange={(e: any) => onStage(e.target.value)}>
                    {COMPARE_STAGES
                        // A source connector has no Sent stage at all — don't list it.
                        .filter(s => !(s.type === 'SENT' && Number(compareRef.metaDataId) === 0))
                        .map(s => (
                            <option key={s.type} value={s.type}
                                disabled={!stored.includes(s.type) && s.type !== compareRef.contentType}>
                                {s.label}{stored.includes(s.type) ? '' : ' (not stored)'}
                            </option>
                        ))}
                </select>
            </label>
        </div>
    );
}

/* ---- the overlay ------------------------------------------------------------- */

/*
 * The diff itself, as its own component INSIDE the portal. That placement is the
 * point: Radix's Dialog.Portal renders nothing on its first commit (it resolves
 * its container in a layout effect), so a mount effect written in the overlay
 * below would run before this host div exists and would silently never mount the
 * editor. A child mounts when the portal content does.
 *
 * It also puts the whole editor lifecycle behind ONE unmount: whatever removed
 * the overlay — Close, Esc, a route change, the shell tearing the view down at
 * session end — this cleanup disposes the Monaco models (freeing them from
 * Monaco's global registry, with the message content in them) and drops the
 * buffers.
 */
function DiffPane({ original, modified, originalLanguage, modifiedLanguage }: any) {
    const hostRef = useRef<any>(null);
    const diffRef = useRef<any>(null);
    // The two content buffers, mirrored out of props so teardown releases them
    // explicitly rather than relying on the component object going away.
    const buffersRef = useRef<any>({ original: '', modified: '' });

    useEffect(() => {
        const host = hostRef.current;
        const diff = createDiffEditor({ original: '', modified: '', language: 'plaintext' });
        diffRef.current = diff;
        host.appendChild(diff.el);
        return () => {
            diffRef.current = null;
            buffersRef.current = { original: '', modified: '' };
            try { diff.dispose(); } catch { /* already gone */ }
            try { diff.el.remove(); } catch { /* already detached */ }
        };
    }, []);

    // Feed the panes as each side lands: one side failing leaves the other's
    // content on screen rather than blanking the comparison.
    useEffect(() => {
        const diff = diffRef.current;
        if (!diff) return;
        buffersRef.current = { original, modified };
        diff.setModels({ original, modified, originalLanguage, modifiedLanguage });
        diff.layout();
    }, [original, modified, originalLanguage, modifiedLanguage]);

    return <div className="compare-diff" ref={hostRef} />;
}

export function CompareOverlay({ pair, onClose }: any) {
    const [left, setLeft] = useState(() => pair.left);
    const [right, setRight] = useState(() => pair.right);
    // Bumped by Retry so a failed side refetches without changing its reference.
    const [leftGen, setLeftGen] = useState(0);
    const [rightGen, setRightGen] = useState(0);

    const leftState = useSideContent(left, leftGen);
    const rightState = useSideContent(right, rightGen);

    /* Session end (explicit logout, idle logout, a background 401) closes the
       overlay so no content is left on an unattended screen — before the login
       screen renders, since this unmounts on the same tick. */
    useEffect(() => on('compare:end', () => onClose({ sessionEnded: true })), [onClose]);

    const swap = () => {
        setLeft(right);
        setRight(left);
        const g = leftGen; setLeftGen(rightGen); setRightGen(g);
    };

    const pane = (side: any, state: any, onRetry: any) => {
        if (state.status === 'ready') return null;
        return (
            <div className={'compare-pane-overlay ' + side}>
                {state.status === 'loading'
                    ? <div className="loading-block"><div className="spinner" />Loading content…</div>
                    : (
                        <div className="compare-pane-error">
                            <Icon name="warning" size={16} />
                            <span>{state.error}</span>
                            {state.status === 'error' &&
                                <button className="btn btn-sm" onClick={onRetry}><Icon name="refresh" />Retry</button>}
                        </div>
                    )}
            </div>
        );
    };

    return (
        <Dialog.Root open onOpenChange={(open: any) => { if (!open) onClose(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className="compare-scrim">
                    <Dialog.Content className="compare-overlay" aria-describedby={undefined}
                        /* Radix would focus the first tabbable, which is a stage
                           dropdown — changing a pane by accident on a stray
                           keystroke. Close is the safe landing spot. */
                        onOpenAutoFocus={(e: any) => {
                            e.preventDefault();
                            (e.currentTarget as HTMLElement)?.querySelector<HTMLElement>('.compare-close')?.focus();
                        }}>
                        <div className="compare-head">
                            <Dialog.Title asChild>
                                <h2 className="compare-title">Compare Content</h2>
                            </Dialog.Title>
                            {/* No channel chip in the header: the two sides need not
                                be from the same channel, so naming one here would be
                                wrong for the other. Each side's reference carries its
                                own channel instead. */}
                            <span className="flex-1" />
                            <button className="btn" onClick={swap} title="Swap the two sides">
                                <Icon name="transform" />Swap
                            </button>
                            {/* Two exits, because closing a comparison means two
                                different things: one more thing to compare against
                                the same reference, or done with that reference. */}
                            {/* `clear`, not a second `x`: side by side, two X glyphs
                                read as the same action twice, which is the one thing
                                these buttons exist to distinguish. */}
                            <button className="btn" onClick={() => { clearCompare(); onClose({ cleared: true }); }}
                                title="Close and drop the compare selection">
                                <Icon name="clear" />Clear and Close
                            </button>
                            {/* Esc and a click outside land here too — the exit that
                                changes the least. */}
                            <Dialog.Close asChild>
                                <button className="btn compare-close" title="Close, keeping the selection for another comparison">
                                    <Icon name="x" />Close
                                </button>
                            </Dialog.Close>
                        </div>

                        <div className="compare-heads">
                            <SideHeader side="left" compareRef={left} state={leftState}
                                onStage={(type: any) => setLeft({ ...left, contentType: type })} />
                            <SideHeader side="right" compareRef={right} state={rightState}
                                onStage={(type: any) => setRight({ ...right, contentType: type })} />
                        </div>

                        <div className="compare-body">
                            <DiffPane
                                original={leftState.status === 'ready' ? leftState.text : ''}
                                modified={rightState.status === 'ready' ? rightState.text : ''}
                                originalLanguage={leftState.language}
                                modifiedLanguage={rightState.language} />
                            {pane('left', leftState, () => setLeftGen(g => g + 1))}
                            {pane('right', rightState, () => setRightGen(g => g + 1))}
                        </div>

                        <div className="compare-foot">
                            <span className="compare-legend"><i className="swatch left" />Left only</span>
                            <span className="compare-legend"><i className="swatch right" />Right only</span>
                        </div>
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
