import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { PaletteContext } from '../core/command-suggestions.js';

// Views have independent React roots. Ownership keeps a departed view's cleanup
// from erasing a newer view's selection; nothing is persisted across sessions.
let active: { owner: symbol; context: PaletteContext } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getPaletteContext = (): PaletteContext => active?.context ?? null;

// A dependency dialog can finish after its editor has remounted. Update the
// current publisher only when it still owns the same working channel model.
export function publishChannelLibrarySelection(channel: object, librarySelection: Map<string, boolean>) {
    if (!active || active.context?.kind !== 'channel' || !active.context.channels?.includes(channel)) return;
    active = { ...active, context: { ...active.context, librarySelection } };
    notify();
}

export function usePaletteContext(context: PaletteContext) {
    const owner = useRef(Symbol('palette-context')).current;
    useLayoutEffect(() => {
        active = { owner, context };
        notify();
    }, [owner, context]);
    useLayoutEffect(() => () => {
        if (active?.owner === owner) { active = null; notify(); }
    }, [owner]);
}

export const useCurrentPaletteContext = () => useSyncExternalStore(subscribe, getPaletteContext, () => null);
