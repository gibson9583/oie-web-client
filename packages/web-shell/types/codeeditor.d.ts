import type * as MonacoNs from 'monaco-editor';
export interface CodeEditorOptions {
    value?: string;
    /** 'javascript' | 'xml' | 'sql' | 'text' | ... */
    language?: string;
    readOnly?: boolean;
    minHeight?: string;
    placeholder?: string;
    onChange?(value: string): void;
    /** Corner toggle opening the full-screen code view. */
    maximizable?: boolean;
    popoutable?: boolean;
    popoutTitle?: string;
    /** [[label, insertText]] variables rail in the code view. */
    popoutVars?: Array<[string, string]>;
    [extra: string]: any;
}
export declare class CodeEditor {
    opts: CodeEditorOptions;
    gutter: HTMLElement;
    area: HTMLTextAreaElement;
    el: HTMLElement;
    /** Set by mountMonaco when the in-place upgrade lands. */
    monaco?: MonacoNs.editor.IStandaloneCodeEditor;
    __maxCleanup?: () => void;
    _lines?: number;
    constructor(opts?: CodeEditorOptions);
    handleKey(e: KeyboardEvent): void;
    syncGutter(): void;
    getValue(): string;
    setValue(value: string | null | undefined): void;
    focus(): void;
    dispose(): void;
}
export declare function createCodeEditor(opts?: CodeEditorOptions): CodeEditor;
export declare function setCodeEditorFactory(fn: (opts?: CodeEditorOptions) => CodeEditor): void;
