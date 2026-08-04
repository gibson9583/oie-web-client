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
import { flushSync } from 'react-dom';
import * as Toast from '@radix-ui/react-toast';
import { icon } from '@oie/web-ui';

let toasts: any[] = [];
let seq = 0;
const listeners = new Set();
const emit = () => { toasts = toasts.slice(); listeners.forEach((f: any) => f()); };
const subscribe = (f: any) => { listeners.add(f); return () => listeners.delete(f); };
const snapshot = () => toasts;

/** cornerToast()'s renderer. Returns the same { close } handle shape as modal(). */
export function showRadixToast(message: any, type = 'info', timeout = 4200) {
    const id = ++seq;
    const close = () => { toasts = toasts.filter((t: any) => t.id !== id); emit(); };
    const entry = { id, message: String(message), type, timeout, close, node: null };
    toasts = toasts.concat(entry);
    // Synchronous, so `el` is a real node on return — the DOM factory handed one
    // back and plugins may still restyle it on the next line.
    try { flushSync(emit); } catch { emit(); }
    return { close, get el() { return entry.node; } };
}

function OneToast({ entry }: any) {
    const name = (entry.type === 'error' || entry.type === 'warn') ? 'warning' : 'check';
    return (
        <Toast.Root
            ref={(node: any) => { entry.node = node; }}
            className={'toast ' + entry.type}
            duration={entry.timeout}
            onOpenChange={(open: any) => { if (!open) entry.close(); }}>
            <span ref={(el: any) => { if (el && !el.firstChild) el.appendChild(icon(name, 15)); }} />
            <Toast.Description className="toast-msg">{entry.message}</Toast.Description>
        </Toast.Root>
    );
}

/** Mounted once by the app root; renders every live toast. */
export function ToastHost() {
    const live = useSyncExternalStore(subscribe, snapshot, snapshot);
    return (
        <Toast.Provider swipeDirection="right" label="Notification">
            {live.map((entry: any) => <OneToast key={entry.id} entry={entry} />)}
            <Toast.Viewport className="toasts" />
        </Toast.Provider>
    );
}
