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
export declare function setActiveScope(channelId: string | number | null | undefined, contexts: string[] | null | undefined): Promise<void>;
export declare function clearActiveScope(): void;
export declare function getActiveCompletions(): TemplateCompletion[];
