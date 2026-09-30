/** Catalog paths are relative to plugin.json, never to the entry's web/ directory. */
export declare function loadPluginCatalog(manifest: {
    id: string;
    base?: string;
    source?: string;
    i18n?: Record<string, string>;
}): Promise<void>;
