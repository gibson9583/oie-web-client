import type * as MonacoNs from 'monaco-editor';
type Monaco = typeof MonacoNs;
export interface UpgradeableEditor {
    el: HTMLElement;
    monaco?: MonacoNs.editor.IStandaloneCodeEditor;
    getValue(): string;
    setValue(value: string | null | undefined): void;
    focus(): void;
    dispose(): void;
    __maxCleanup?: () => void;
}
export interface MonacoMountOptions {
    language?: string;
    readOnly?: boolean;
    onChange?: (value: string) => void;
    [extra: string]: any;
}
export declare function monacoFontFamily(): string;
export declare function ensureMonaco(): Promise<Monaco | null>;
/** Dispose every Monaco editor whose host element has left the document.
    Runs on route changes automatically; the shell also calls it on sign-out,
    which swaps the DOM without a route change (script content must not stay
    in memory behind the login card). */
export declare function disposeDetachedMonaco(): void;
export declare function mountMonaco(monaco: Monaco, editor: UpgradeableEditor, opts?: MonacoMountOptions): void;
export {};
