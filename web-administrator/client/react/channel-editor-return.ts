/** View state travels only with the in-memory draft, never in the engine payload. */
interface ChannelEditorScreen {
    tab: string;
    destinationId?: number | string;
    scriptKey?: string;
    tagState?: { loaded: boolean; available: boolean; all: any[]; assigned: Set<string>; initial: Set<string> };
}

// Keep the origin across connector route changes until the classic editor remounts.
export const channelEditorScreens = new WeakMap<object, ChannelEditorScreen>();
