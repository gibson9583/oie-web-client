/*
 * Radix-backed renderer for core/ui.js's corner toasts, registered the same way
 * as the dialog one (see dialog-host.jsx for why core/ui.js can't import React).
 *
 * What adopting the primitive buys over the hand-rolled version, which was a div
 * appended to the corner on a setTimeout:
 *   - the countdown pauses while the pointer is over a toast or focus is in it,
 *     so a message can't expire while it is being read
 *   - swipe right, or Escape, to dismiss early
 *   - F8 jumps focus to the toasts and arrow keys walk them
 *   - the text is announced through Radix's own live region rather than relying
 *     on a container that assistive tech may have stopped watching
 *
 * The call-site contract (`toast(message, type, timeout)`) and the class names
 * (.toasts, .toast, .toast-msg, and the per-type modifier) are unchanged.
 */

import { useSyncExternalStore } from 'react';
import * as Toast from '@radix-ui/react-toast';
import { icon } from '@oie/web-ui';

let toasts = [];
let seq = 0;
const listeners = new Set();
const emit = () => { toasts = toasts.slice(); listeners.forEach((f) => f()); };
const subscribe = (f) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => toasts;

/** cornerToast()'s renderer. Returns the same { close } handle shape as modal(). */
export function showRadixToast(message, type = 'info', timeout = 4200) {
    const id = ++seq;
    const close = () => { toasts = toasts.filter((t) => t.id !== id); emit(); };
    toasts = toasts.concat({ id, message: String(message), type, timeout, close });
    emit();
    return { close, el: null };
}

function OneToast({ entry }) {
    const name = (entry.type === 'error' || entry.type === 'warn') ? 'warning' : 'check';
    return (
        <Toast.Root
            className={'toast ' + entry.type}
            duration={entry.timeout}
            onOpenChange={(open) => { if (!open) entry.close(); }}>
            <span ref={(el) => { if (el && !el.firstChild) el.appendChild(icon(name, 15)); }} />
            <Toast.Description className="toast-msg">{entry.message}</Toast.Description>
        </Toast.Root>
    );
}

/** Mounted once by the app root; renders every live toast. */
export function ToastHost() {
    const live = useSyncExternalStore(subscribe, snapshot, snapshot);
    return (
        <Toast.Provider swipeDirection="right" label="Notification">
            {live.map((entry) => <OneToast key={entry.id} entry={entry} />)}
            <Toast.Viewport className="toasts" />
        </Toast.Provider>
    );
}
