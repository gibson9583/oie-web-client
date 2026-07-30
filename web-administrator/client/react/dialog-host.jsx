/*
 * Radix-backed renderer for core/ui.js's modal() factory.
 *
 * core/ui.js is loaded by plugins as a URL module and resolves bare specifiers
 * through the page import map, which has no `react` and no `@radix-ui/*` — so it
 * cannot import them, and its own DOM overlay has to stay as the fallback.
 * Instead the app registers THIS renderer at boot, and every modal() call in the
 * app — all of them, plus confirmDialog/promptDialog/detailModal/errorModal,
 * which are built on it — is rendered by Radix without a call site changing.
 *
 * Radix supplies the focus trap, Escape (including the nested-dialog stack),
 * dismiss-on-outside-click, the portal, and hiding the rest of the app from
 * assistive tech. What this file keeps is the factory's own contract:
 *   - `body`/`title` may be a DOM NODE (built with h()), mounted by ref
 *   - a footer button's onClick may be async, and returning false keeps it open
 *   - onClose fires exactly once, however the dialog was dismissed
 *   - modal() returns synchronously with { close }
 *   - initial focus prefers a form field over the header's Close button, which
 *     is what promptDialog relies on instead of a deferred focus()
 * The class names (.modal-overlay, .modal, .modal-header/-body/-foot) and the
 * overlay > dialog nesting are unchanged, so the existing CSS and every spec
 * that targets them still apply.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { icon } from '@oie/web-ui';

/* ---- the open-dialog store (outside React, since modal() is called from anywhere) ---- */

let dialogs = [];
let seq = 0;
const listeners = new Set();
const emit = () => { dialogs = dialogs.slice(); listeners.forEach((f) => f()); };
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => dialogs;

/** modal()'s renderer: pushes a dialog and returns its handle synchronously. */
export function openRadixDialog(opts = {}) {
    const id = ++seq;
    let closed = false;
    /* Where focus goes when the dialog closes. Radix's modal Content restores to
       its <Dialog.Trigger>, and these dialogs have none — they are opened from
       code — so without this focus would land nowhere. Captured here, before the
       dialog mounts, which is also what the DOM factory did. */
    const opener = document.activeElement;

    const close = () => {
        if (closed) return;          // idempotent: an outside click and a button can race
        closed = true;
        dialogs = dialogs.filter((d) => d.id !== id);
        emit();
        if (opts.onClose) opts.onClose();
    };
    dialogs = dialogs.concat({ id, opts, close, opener });
    emit();
    // `el` is part of the old contract but no caller reads it; null is honest
    // here rather than handing back a node that isn't in the document yet.
    return { close, el: null };
}

/* ---- rendering ---- */

/** Mounts whatever h() produced — a node, a list of them, or plain text. */
function NodeSlot({ content, className, id }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host || content === null || content === undefined) return undefined;
        for (const part of Array.isArray(content) ? content : [content]) {
            if (part instanceof Node) host.appendChild(part);
            else if (part !== null && part !== undefined) host.append(String(part));
        }
        // Leave the nodes as the caller gave them: detach on unmount rather than
        // destroying them, since some callers reuse a body across opens.
        return () => host.replaceChildren();
    }, [content]);
    return <div ref={ref} className={className} id={id} />;
}

/* core/ui.js's icon() returns a DOM node, so it mounts by ref like everything else. */
function IconSlot({ name }) {
    return <span ref={(el) => { if (el && !el.firstChild) el.appendChild(icon(name)); }} />;
}

function OneDialog({ entry }) {
    const { opts, close, opener } = entry;
    const buttons = opts.buttons || [];
    const contentRef = useRef(null);

    return (
        <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
            <Dialog.Portal>
                {/* Content nests INSIDE the overlay: that is what the existing
                    `.modal-overlay { display: flex }` centering expects, and it
                    keeps `.modal-overlay` a real ancestor for anything walking up
                    from the dialog. */}
                <Dialog.Overlay className="modal-overlay">
                    <Dialog.Content
                        ref={contentRef}
                        className={'modal' + (opts.size ? ' ' + opts.size : '')}
                        /* Radix labels the dialog from its <Title>; `label` is the
                           escape hatch for dialogs whose title is a node, and it
                           has to REPLACE aria-labelledby, not sit beside it. */
                        {...(opts.label ? { 'aria-label': opts.label, 'aria-labelledby': undefined } : null)}
                        aria-describedby={undefined}
                        onCloseAutoFocus={(e) => {
                            // preventDefault also suppresses Radix's own restore-to-trigger.
                            e.preventDefault();
                            if (opener && opener.isConnected && opener.focus) opener.focus();
                        }}
                        onOpenAutoFocus={(e) => {
                            /* Radix would focus the first tabbable, which is the
                               header's Close button. Prefer a form field — that is
                               where the caret belongs in a prompt. */
                            const root = contentRef.current;
                            const field = root && root.querySelector(
                                'input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
                            if (!field) return;
                            e.preventDefault();
                            field.focus();
                        }}>
                        <div className="modal-header">
                            <Dialog.Title asChild>
                                <span>{opts.title instanceof Node || Array.isArray(opts.title)
                                    ? <NodeSlot content={opts.title} />
                                    : opts.title}</span>
                            </Dialog.Title>
                            <Dialog.Close asChild>
                                <button className="icon-btn" title="Close" aria-label="Close">
                                    <IconSlot name="x" />
                                </button>
                            </Dialog.Close>
                        </div>
                        <NodeSlot content={opts.body} className="modal-body" />
                        {buttons.length ? (
                            <div className="modal-foot">
                                {buttons.map((btn, i) => (
                                    <button key={i}
                                        className={'btn' + (btn.primary ? ' btn-primary' : '') + (btn.danger ? ' btn-danger' : '')}
                                        onClick={async () => {
                                            // Same rule as the DOM factory: a handler
                                            // that returns false keeps the dialog open.
                                            const result = btn.onClick ? await btn.onClick() : true;
                                            if (result !== false) close();
                                        }}>
                                        {btn.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </Dialog.Content>
                </Dialog.Overlay>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/** Mounted once by the app root; renders every open dialog. */
export function DialogHost() {
    const open = useSyncExternalStore(subscribe, snapshot, snapshot);
    return open.map((entry) => <OneDialog key={entry.id} entry={entry} />);
}
