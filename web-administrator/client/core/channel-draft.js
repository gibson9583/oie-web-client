/*
 * Session-loss safety net for channel edits — the web equivalent of Swing's
 * exportChannelOnError(): when the session dies out from under a dirty channel
 * editor (expiry, inactivity logout), the working copy is stashed in localStorage
 * and the next successful login to the same engine+user offers to resume editing.
 *
 * localStorage rather than Swing's file-export prompt: at expiry time no engine
 * call can succeed and a blocking prompt would race the login redirect — a silent
 * stash plus a restore offer at the next login loses nothing and demands nothing
 * at the worst possible moment. The key is scoped via store.scopedKey (server +
 * user), so a draft never leaks across engines or accounts.
 */

import * as store from './store.js';

const BASE_KEY = 'webadmin.channel-draft';

/** Stashes the in-progress channel iff one is open and dirty. Best-effort. */
export function stashChannelDraft() {
    try {
        if (!store.getState('editingChannelDirty')) return;
        const channel = store.getState('editingChannel');
        if (!channel || !channel.id) return;
        localStorage.setItem(store.scopedKey(BASE_KEY), JSON.stringify({
            savedAt: Date.now(),
            isNew: !!store.getState('editingChannelNew'),
            channel
        }));
    } catch {
        // quota / serialization failure — the net is best-effort
    }
}

/** Returns the stashed draft for the CURRENT pref scope (or null). Does not clear. */
export function peekChannelDraft() {
    try {
        const raw = localStorage.getItem(store.scopedKey(BASE_KEY));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function clearChannelDraft() {
    try {
        localStorage.removeItem(store.scopedKey(BASE_KEY));
    } catch {
        // ignore
    }
}
