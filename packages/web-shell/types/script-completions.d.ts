/** A code-template function offered to the editor: signature + leading JSDoc. */
export interface TemplateCompletion {
    name: string;
    params: string[];
    doc: string;
    library: string;
}
/** Force a refetch (call after the user edits Code Templates). */
export declare function invalidate(): void;
/** The in-scope code-template functions for a channel + editor contexts. */
export declare function templatesInScope(channelId: string | number, contexts: string[]): Promise<TemplateCompletion[]>;
/** A code template's source, fed to the language service as one extra lib. */
export interface TemplateLib {
    id: string;
    code: string;
}
export declare function templateSourcesInScope(channelId: string | number, contexts: string[]): Promise<TemplateLib[]>;
/** Subscribe to active template-lib changes. Returns an unsubscribe. */
export declare function onActiveLibsChange(cb: (libs: TemplateLib[]) => void): () => void;
export declare function getActiveLibs(): TemplateLib[];
export declare function setActiveScope(channelId: string | number | null | undefined, contexts: string[] | null | undefined): Promise<void>;
/** The current scope's token, for clearActiveScope(token). */
export declare function currentScope(): number;
/** The active scope's channel and contexts, to restore it later. */
export declare function activeScope(): {
    channelId: string | number | null | undefined;
    contexts: string[];
};
/** Clear the scope; with a token, only while that scope is still the active one. */
export declare function clearActiveScope(token?: number): void;
export declare function getActiveCompletions(): TemplateCompletion[];
/** A Reference list entry: a categorized engine catalog entry or a plugin one. */
export interface ReferenceEntry {
    name: string;
    category: string;
    description?: string;
    code: string;
    type?: string;
    contexts?: string[];
}
type CatalogEntry = Omit<ReferenceEntry, 'category'> & {
    category: string | null;
};
/** Add plugin Reference entries (platform.registerReferences). Entries without
    a name or category string, or with non-array contexts, are dropped: they
    would break every view. */
export declare function addReferences(entries: ReferenceEntry[]): void;
export declare function registeredReferences(): ReferenceEntry[];
export declare function referencesFor(catalogEntries: CatalogEntry[], contexts: string[]): ReferenceEntry[];
/** The active editor's Reference entries, offered as completions like Swing's. */
export declare function getActiveReferences(): ReferenceEntry[];
/** A FUNCTION reference's signature, or null when its code has none. */
export declare function referenceSignature(entry: ReferenceEntry): {
    name: string;
    params: string[];
} | null;
export declare function dropTextFor(entry: any): string;
export declare const cleanDesc: (d: any) => string;
export {};
