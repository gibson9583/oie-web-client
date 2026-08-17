/*
 * Deployment URL helpers.
 *
 * The standalone Node server hosts the application at `/` and proxies the
 * engine at `/api`. An OIE-hosted WAR is mounted below the engine context (for
 * example `/oie-webadmin`) while the engine API remains its sibling (`/api`).
 * Keep those physical paths out of feature code: routes are app-relative,
 * static resources are context-relative, and API requests use the endpoint
 * advertised by index.html/index.jsp.
 */

const trimTrailingSlash = (value: string): string => value.length > 1 ? value.replace(/\/+$/, '') : value;

export function normalizeBasePath(value: string | null | undefined): string {
    const text = String(value || '').trim();
    if (!text || text === '/') return '';
    const withSlash = text.startsWith('/') ? text : `/${text}`;
    return trimTrailingSlash(withSlash);
}

export function joinBasePath(base: string, path = ''): string {
    const normalizedBase = normalizeBasePath(base);
    if (!path) return normalizedBase || '/';
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return normalizedBase + suffix;
}

export function stripBasePath(path: string, base: string): string {
    const normalizedBase = normalizeBasePath(base);
    if (!normalizedBase) return path || '/';
    if (path === normalizedBase) return '/';
    if (path.startsWith(normalizedBase + '/')) return path.slice(normalizedBase.length) || '/';
    return path || '/';
}

function meta(name: string): string | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? null;
}

function documentBasePath(): string {
    if (typeof document === 'undefined') return '';
    try { return normalizeBasePath(new URL(document.baseURI).pathname); }
    catch { return ''; }
}

/** Context path that owns the SPA (`''` for the standalone Node deployment). */
const configuredAppBase = meta('oie-webadmin-app-base');
export const APP_BASE = normalizeBasePath(configuredAppBase === null ? documentBasePath() : configuredAppBase);

/** Engine REST root. index.jsp sets this to the API beside the deployed WAR. */
export const API_BASE = normalizeBasePath(meta('oie-webadmin-api-base') || '/api') || '/api';

/** URL for a resource or server endpoint owned by the web client. */
export function appUrl(path = ''): string { return joinBasePath(APP_BASE, path); }

/** URL for an engine API resource. */
export function apiUrl(path = ''): string { return joinBasePath(API_BASE, path); }

/** Browser URL for an internal SPA route. */
export function routeUrl(path = '/'): string { return joinBasePath(APP_BASE, path); }

/** Internal route (context prefix removed) represented by the current location. */
export function currentRoutePath(): string {
    if (typeof location === 'undefined') return '/';
    return stripBasePath(location.pathname, APP_BASE) + location.search;
}
