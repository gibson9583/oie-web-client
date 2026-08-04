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
export declare function ensureMonaco(): Promise<Monaco | null>;
export declare function mountMonaco(monaco: Monaco, editor: UpgradeableEditor, opts?: MonacoMountOptions): void;
export {};
