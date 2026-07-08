/*
 * Locates the web-support endpoints on the connected engine. They exist in two forms:
 *
 *   - engine-native: /api/datatypes/_serialize, /api/javascript/_validate, /api/webplugins
 *     (an engine built with the feat/web-support endpoints)
 *   - the "websupport" plugin: the same endpoints under /api/extensions/websupport/...
 *     (any stock engine with the Web Support extension installed — no engine changes)
 *
 * Probed once per session with the native form preferred, so an engine that some day
 * ships the endpoints wins automatically over the plugin. Returns the path prefix to
 * put after /api ('' for native, '/extensions/websupport' for the plugin), or null when
 * neither exists — callers degrade (no message trees, no server validation, no
 * engine-served plugin UIs) rather than error.
 */

import { get } from './api.js';

let resolved = null;

async function probe() {
    try {
        await get('/webplugins', { noAuthHandler: true });
        return '';
    } catch (e) {
        // 401 means "not logged in yet", not "endpoint missing" — don't cache that.
        if (e && e.status === 401) throw e;
    }
    try {
        await get('/extensions/websupport/webplugins', { noAuthHandler: true });
        return '/extensions/websupport';
    } catch (e) {
        if (e && e.status === 401) throw e;
    }
    return null;
}

/** Path prefix for web-support endpoints ('' | '/extensions/websupport'), or null if unavailable. */
export function webSupportBase() {
    if (!resolved) {
        resolved = probe().catch((e) => { resolved = null; throw e; });
    }
    return resolved;
}
