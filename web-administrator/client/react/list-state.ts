import { useLayoutEffect, useState } from 'react';
import { captureEngineSession } from '../core/engine-fetch.js';

// Navigation memory only: retain selection, expansion and filters, never channel models.
// The shell clears this on logout/session replacement, like the query cache.
const remembered = new Map<string, unknown>();

export function clearListState(): void { remembered.clear(); }

export function useListState<T>(key: string, initial: () => T) {
    const [assertSession] = useState(() => captureEngineSession());
    const [value, setValue] = useState<T>(() => remembered.has(key)
        ? structuredClone(remembered.get(key) as T) : initial());
    useLayoutEffect(() => {
        // A departing view must not repopulate memory after session teardown.
        try { assertSession(); } catch { return; }
        remembered.set(key, value);
    }, [key, value, assertSession]);
    return [value, setValue] as const;
}
