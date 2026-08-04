export interface DiffEditorOptions {
    original?: string;
    modified?: string;
    language?: string;
    /** false = unified/inline view; default side-by-side. */
    renderSideBySide?: boolean;
}
export interface DiffEditorHandle {
    el: HTMLDivElement;
    setModels(next?: {
        original?: string | null;
        modified?: string | null;
        language?: string | null;
    }): void;
    layout(): void;
    dispose(): void;
}
export declare function createDiffEditor(opts?: DiffEditorOptions): DiffEditorHandle;
