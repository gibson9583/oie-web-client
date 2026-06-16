/*
 * Hash router. Routes are registered as patterns like:
 *   '/dashboard', '/channels/:channelId/edit', '/messages/:channelId?'
 * A route handler receives ({ params, query }) and returns a DOM node (or
 * renders into the outlet itself and returns null).
 */

const routes = [];
let outlet = null;
let notFound = null;
let beforeEach = null;
let currentTeardown = null;
let acceptedHash = null;     // last hash the guard allowed
let suppressNext = false;    // ignore the hashchange caused by a guard rollback

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
    if (('#' + path) === location.hash) handleChange();
    else location.hash = path;
}

export function currentPath() {
    return location.hash.replace(/^#/, '') || '/';
}

function parseQuery(qsStr) {
    const query = {};
    for (const [k, v] of new URLSearchParams(qsStr)) query[k] = v;
    return query;
}

async function handleChange() {
    if (suppressNext) { suppressNext = false; return; }
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
                // The hash already changed (hash routing) — roll it back so the
                // address bar matches the view that stayed on screen.
                if (acceptedHash !== null && location.hash !== acceptedHash) {
                    suppressNext = true;
                    location.hash = acceptedHash;
                }
                return;
            }
            if (typeof verdict === 'string') { navigate(verdict); return; }
        }
        acceptedHash = location.hash;

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
    window.addEventListener('hashchange', handleChange);
    handleChange();
}
