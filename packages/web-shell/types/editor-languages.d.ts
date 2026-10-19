import type * as MonacoNs from 'monaco-editor';
export interface EditorLanguageDefinition {
    configuration?: MonacoNs.languages.LanguageConfiguration;
    tokensProvider: MonacoNs.languages.IMonarchLanguage;
}
export interface EditorLanguageProvider {
    aliases?: string[];
    extensions?: string[];
    /** Fetch the plugin's grammar on demand. Failed/timed-out loads may be retried. */
    load(): EditorLanguageDefinition | Promise<EditorLanguageDefinition>;
}
/** Register metadata only; the provider runs when an editor requests this id. */
export declare function registerEditorLanguage(id: string, provider: EditorLanguageProvider): void;
/** Internal: optional failures leave the requesting editor on its textarea. */
export declare function ensureEditorLanguage(monaco: typeof MonacoNs, id: string): Promise<boolean>;
