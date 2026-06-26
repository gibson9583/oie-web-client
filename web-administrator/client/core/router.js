/*
 * History-API router. Routes are registered as patterns like:
 *   '/dashboard', '/channels/:channelId/edit', '/messages/:channelId?'
 * A route handler receives ({ params, query }) and returns a DOM node (or
 * renders into the outlet itself and returns null).
 *
 * Navigation uses the History API (history.pushState + popstate) for clean URLs
 * with no '#'. The Node server serves index.html for unknown deep paths (SPA
 * fallback), so a refresh/bookmark of /channels/x/edit boots straight into it.
 */

const routes = [];
let outlet = null;
let notFound = null;
let beforeEach = null;
let currentTeardown = null;
let acceptedPath = null;     // last path the guard allowed (target for rollback)
let started = false;         // popstate listener attached once, across re-mounts

export function register(pattern, handler, meta = {}) {
    const names = [];
    const regex = new RegExp('^' + pattern
        .replace(/\/:([^/?]+)\?/g, (m, name) => { names.push(name); return '(?:/([^/]+))?'; })
        .replace(/:([^/?]+)/g, (m, name) => { names.push(name); return '([^/]+)'; })
        + '$');
    routes.push({ pattern, regex, names, handler, meta });
}

export function setOutlet(el) { outlet = el; }
export function setNotFound(handler) { notFound = handler; }
export function setGuard(fn) { beforeEach = fn; }

export function navigate(path) {
    const target = path.startsWith('/') ? path : '/' + path;
    if (target === currentPath()) { handleChange(); return; }   // re-render in place
    history.pushState(null, '', target);
    handleChange();
}

export function currentPath() {
    return (location.pathname + location.search) || '/';
}

function parseQuery(qsStr) {
    const query = {};
    for (const [k, v] of new URLSearchParams(qsStr)) query[k] = v;
    return query;
}

async function handleChange() {
    let path = currentPath();
    let query = {};
    const qIndex = path.indexOf('?');
    if (qIndex >= 0) {
        query = parseQuery(path.slice(qIndex + 1));
        path = path.slice(0, qIndex);
    }

    for (const route of routes) {
        const match = path.match(route.regex);
        if (!match) continue;

        const params = {};
        route.names.forEach((name, i) => {
            params[name] = match[i + 1] !== undefined ? decodeURIComponent(match[i + 1]) : undefined;
        });

        if (beforeEach) {
            const verdict = await beforeEach({ path, params, query, meta: route.meta });
            if (verdict === false) {
                // The URL may already have moved (a programmatic nav pushed it, or
                // the user pressed Back/Forward) — restore it to the view that
                // stayed on screen. pushState does not re-fire popstate, so this
                // does not re-enter handleChange.
                if (acceptedPath !== null && currentPath() !== acceptedPath) {
                    history.pushState(null, '', acceptedPath);
                }
                return;
            }
            if (typeof verdict === 'string') { navigate(verdict); return; }
        }
        acceptedPath = currentPath();

        if (currentTeardown) { try { currentTeardown(); } catch { /* view cleanup */ } currentTeardown = null; }

        const result = await route.handler({ path, params, query, meta: route.meta });
        if (result) {
            if (result.el) {
                renderInto(result.el);
                if (typeof result.teardown === 'function') currentTeardown = result.teardown;
            } else if (result instanceof Node) {
                renderInto(result);
            }
        }
        window.dispatchEvent(new CustomEvent('route:changed', { detail: { path, params, query, meta: route.meta } }));
        return;
    }

    if (notFound) renderInto(notFound({ path }));
}

function renderInto(node) {
    if (!outlet) return;
    while (outlet.firstChild) outlet.removeChild(outlet.firstChild);
    outlet.appendChild(node);
}

export function start() {
    if (!started) { window.addEventListener('popstate', handleChange); started = true; }
    handleChange();
}
