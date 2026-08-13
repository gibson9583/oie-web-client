export interface DiffEditorOptions {
    original?: string;
    modified?: string;
    language?: string;
    /** Per-side overrides — the two panes need not be the same language (an HL7
        message against the XML it was transformed into). Default: `language`. */
    originalLanguage?: string;
    modifiedLanguage?: string;
    /** false = unified/inline view; default side-by-side. */
    renderSideBySide?: boolean;
}
export interface DiffEditorHandle {
    el: HTMLDivElement;
    setModels(next?: {
        original?: string | null;
        modified?: string | null;
        language?: string | null;
        originalLanguage?: string | null;
        modifiedLanguage?: string | null;
    }): void;
    layout(): void;
    dispose(): void;
}
export declare function createDiffEditor(opts?: DiffEditorOptions): DiffEditorHandle;
