/*
 * Cross-view unsaved-work registry backing the tab-close guard. Views that hold
 * dirty state register a SYNCHRONOUS check alongside their navGuard; the shell's
 * single beforeunload listener consults them. navGuard itself can't serve this:
 * it is async and may open dialogs (forbidden inside beforeunload), and its mere
 * presence doesn't mean anything is dirty. The channel editor and wizard need no
 * registration — their shared 'editingChannelDirty' store flag is checked by the
 * shell directly.
 */

const checks = new Set();

/** Registers a synchronous () => boolean dirty check; returns the unregister fn. */
export function registerUnsavedCheck(fn) {
    checks.add(fn);
    return () => checks.delete(fn);
}

export function hasUnsavedWork() {
    for (const fn of checks) {
        try {
            if (fn()) return true;
        } catch {
            // a broken check must never block (or false-positive) the guard
        }
    }
    return false;
}
