import { engineFetch, assertEngineResponse } from './engine-fetch.js';

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
export function createPluginContext(assetBase: string, fromEngine: boolean, assertSession: () => void): PluginContext {
    return Object.freeze({
        async getAssetText(relativePath: string): Promise<string> {
            assertSession();
            if (typeof relativePath !== 'string' || !relativePath || /[\\%?#:\u0000-\u001f\u007f]/.test(relativePath)
                || relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
                throw new Error('Plugin assets require a relative path within the plugin directory');
            }
            const url = `${assetBase}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
            const init: RequestInit = {
                credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(120_000)
            };
            if (fromEngine) init.headers = { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' };
            const response = await (fromEngine ? engineFetch(url, init) : fetch(url, init));
            assertSession();
            if (!response.ok) throw new Error(`Plugin asset request failed (${response.status})`);
            const text = await response.text();
            if (fromEngine) assertEngineResponse(response);
            assertSession();
            return text;
        }
    });
}
