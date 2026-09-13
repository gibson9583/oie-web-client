/* Bind API traffic to the tab's engine/session, including the interval between
   sending a request and receiving its response. Cookies themselves are shared
   across tabs. The proxy checks the same context against the request cookies. */
function context(): string {
    const cookies: Record<string, string> = {};
    for (const part of (typeof document === 'undefined' ? '' : document.cookie).split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const raw = part.slice(i + 1).trim();
        try { cookies[part.slice(0, i).trim()] = decodeURIComponent(raw); }
        catch { cookies[part.slice(0, i).trim()] = raw; }
    }
    return encodeURIComponent(JSON.stringify(['oie-engine', 'oie-engine-url', 'oie-login'].map(k => cookies[k] || '')));
}

let expected = context();
// Preserve the initiating tab's identity across the external IdP navigation.
if (typeof location !== 'undefined' && /\/oidc\/callback\/?$/.test(location.pathname)) {
    try { expected = sessionStorage.getItem('oie-oidc-context') || expected; } catch { /* unavailable */ }
}

// Called only by the login card after deliberately selecting an engine.
export function adoptEngineContext(): void { expected = context(); }

export function beginLogin(): void {
    const generation = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    document.cookie = `oie-login=${generation}; path=/; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
    adoptEngineContext();
}

export function engineContext(): string { return expected; }

function changed(): never {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('oie-session-changed'));
    throw new Error('The browser session changed. Reload to continue.');
}

const responseContexts = new WeakMap<Response, string>();

// fetch resolves at response headers; callers check again after reading a body.
export function assertEngineResponse(response: Response): void {
    if (responseContexts.get(response) !== expected) throw new Error('Discarded a response from the previous session.');
    if (expected !== context()) changed();
}

export async function engineFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const sentContext = expected;
    if (sentContext !== context()) return changed();
    const headers = new Headers(init.headers);
    headers.set('X-OIE-Context', sentContext);
    // WAR requests bypass the Node proxy's response headers. Never read or
    // write the HTTP cache, even if the engine omits Cache-Control.
    const response = await fetch(url, { ...init, headers, cache: 'no-store' });
    responseContexts.set(response, sentContext);
    assertEngineResponse(response);
    if (response.status === 409 && (await response.clone().json().catch(() => null))?.error === 'SESSION_CHANGED') return changed();
    return response;
}
