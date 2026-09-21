import { appUrl } from './deployment.js';

const marker = `oie-http-cache-migration-v1:${appUrl('/')}`;
let pending: Promise<void> | null = null;

/** Retire HTTP cache entries left by older clients without blocking navigation.
 * New engine requests already use no-store. Mark completion only after the
 * browser has processed the clearing response; failed/interrupted attempts retry. */
export function migrateLegacyCache(): Promise<void> {
    try { if (localStorage.getItem(marker) === 'done') return Promise.resolve(); } catch { /* storage unavailable */ }
    if (pending) return pending;
    pending = (async () => {
        const response = await fetch(appUrl('/webadmin/cache-reset'), {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' }
        });
        // Chromium consumes Clear-Site-Data rather than exposing it to fetch.
        // The endpoint's receipt identifies the cache-only migration instead.
        if (response.status !== 204 || response.headers.get('X-OIE-Cache-Migration') !== '1') {
            throw new Error('Legacy HTTP cache cleanup was not confirmed');
        }
        await response.text();
        try { localStorage.setItem(marker, 'done'); } catch { /* retry on the next page load */ }
    })().finally(() => { pending = null; });
    return pending;
}
