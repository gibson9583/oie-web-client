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
import type { OieObject } from './wire-types.js';

const BASE_KEY = 'webadmin.channel-draft';

// A stash exists to survive a session hiccup, not to persist forever on a
// shared workstation: connector credentials ride inside the channel JSON.
// Anything older than this is purged instead of offered (#24).
const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

/** A stashed working copy: when it was saved, whether it was a not-yet-created
    channel, and the channel object itself. */
export interface ChannelDraft {
    savedAt: number;
    isNew: boolean;
    channel: OieObject;
}

/** Stashes the in-progress channel iff one is open and dirty. Best-effort. */
export function stashChannelDraft(): void {
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
export function peekChannelDraft(): ChannelDraft | null {
    try {
        const raw = localStorage.getItem(store.scopedKey(BASE_KEY));
        const draft = raw ? JSON.parse(raw) : null;
        if (draft && (!Number.isFinite(draft.savedAt) || Date.now() - draft.savedAt > DRAFT_TTL_MS)) {
            clearChannelDraft();   // expired — purge rather than offer stale credentials
            return null;
        }
        return draft;
    } catch {
        return null;
    }
}

export function clearChannelDraft(): void {
    try {
        localStorage.removeItem(store.scopedKey(BASE_KEY));
    } catch {
        // ignore
    }
}
