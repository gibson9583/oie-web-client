/** Optional second argument supplied to a plugin's register(platform, context).
 * Asset paths are relative to plugin.json, including any web/ prefix. */
export interface PluginContext {
    /** Read a plugin-owned text asset on demand. Pass literal relative path
     * segments, not URLs or percent-encoded paths. Engine assets use the current
     * authenticated session; all reads reject after that session changes. */
    getAssetText(relativePath: string): Promise<string>;
}
/** The loader supplies the discovered plugin root, never the entry module URL
 * (which may be a blob URL in a WAR or reside in a nested web/ directory). */
export declare function createPluginContext(assetBase: string, fromEngine: boolean, assertSession: () => void): PluginContext;
