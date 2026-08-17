/*
 * History-API router. Routes are registered as patterns like:
 *   '/dashboard', '/channels/:channelId/edit', '/messages/:channelId?'
 * A route handler receives ({ params, query }) and returns a DOM node (or
 * renders into the outlet itself and returns null).
 *
 * Navigation uses the History API (history.pushState + popstate) for clean URLs
 * with no '#'. Both the Node server and WAR serve the shell for unknown deep
 * paths, so a refresh/bookmark of /channels/x/edit boots straight into it.
 */

import { currentRoutePath, routeUrl } from './deployment.js';

/** What a route handler / guard receives. */
export interface RouteContext {
    path: string;
    params: Record<string, string | undefined>;
    query: Record<string, string>;
    meta: Record<string, any>;
}

/** A handler returns a DOM node, `{ el, teardown }`, or null after rendering itself. */
export type RouteResult = Node | { el: Node; teardown?: () => void } | null | undefined | void;
export type RouteHandler = (ctx: RouteContext) => RouteResult | Promise<RouteResult>;

/** `false` blocks the navigation, a string redirects, anything else allows. */
export type RouteGuard = (ctx: RouteContext) => boolean | string | void | Promise<boolean | string | void>;

interface Route {
    pattern: string;
    regex: RegExp;
    names: string[];
    handler: RouteHandler;
    meta: Record<string, any>;
}

const routes: Route[] = [];
let outlet: Element | null = null;
let notFound: ((ctx: { path: string }) => Node) | null = null;
let beforeEach: RouteGuard | null = null;
let currentTeardown: (() => void) | null = null;
let acceptedPath: string | null = null;     // last path the guard allowed (target for rollback)
let started = false;         // popstate listener attached once, across re-mounts
// Bumped once per navigation. handleChange awaits (the guard, and the handler
// itself once view modules are imported on demand), so two navigations can be in
// flight at once; without this the LAST one to resolve wins the outlet rather
// than the last one requested, leaving the URL and the rendered view disagreeing
// and orphaning the loser's React root — whose polling would keep running.
let generation = 0;

export function register(pattern: string, handler: RouteHandler, meta: Record<string, any> = {}): void {
    const names: string[] = [];
    const regex = new RegExp('^' + pattern
        .replace(/\/:([^/?]+)\?/g, (m, name) => { names.push(name); return '(?:/([^/]+))?'; })
        .replace(/:([^/?]+)/g, (m, name) => { names.push(name); return '([^/]+)'; })
        + '$');
    routes.push({ pattern, regex, names, handler, meta });
}

// Identifies the in-flight navigation. A handler that awaits should capture this
// first and re-check it before doing anything with side effects: BUILDING a view
// is not free, because mounting one writes shared state (notably the nav-guard
// slot), and a view that is built and then discarded takes the winning view's
// guard down with it when its unmount cleanup runs.
export function navigationToken(): number { return generation; }

export function setOutlet(el: Element | null): void { outlet = el; }
export function setNotFound(handler: ((ctx: { path: string }) => Node) | null): void { notFound = handler; }
export function setGuard(fn: RouteGuard | null): void { beforeEach = fn; }

export function navigate(path: string): void {
    const target = path.startsWith('/') ? path : '/' + path;
    if (target === currentPath()) { handleChange().catch(() => {}); return; }   // re-render in place
    history.pushState(null, '', routeUrl(target));
    handleChange().catch(() => {});
}

export function currentPath(): string {
    return currentRoutePath();
}

function parseQuery(qsStr: string): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(qsStr)) query[k] = v;
    return query;
}

async function handleChange(): Promise<void> {
    const gen = ++generation;
    let path = currentPath();
    let query: Record<string, string> = {};
    const qIndex = path.indexOf('?');
    if (qIndex >= 0) {
        query = parseQuery(path.slice(qIndex + 1));
        path = path.slice(0, qIndex);
    }

    for (const route of routes) {
        const match = path.match(route.regex);
        if (!match) continue;

        const params: Record<string, string | undefined> = {};
        route.names.forEach((name, i) => {
            params[name] = match[i + 1] !== undefined ? decodeURIComponent(match[i + 1]) : undefined;
        });

        if (beforeEach) {
            const verdict = await beforeEach({ path, params, query, meta: route.meta });
            if (gen !== generation) return;   // superseded while the guard was deciding
            if (verdict === false) {
                // The URL may already have moved (a programmatic nav pushed it, or
                // the user pressed Back/Forward) — restore it to the view that
                // stayed on screen. pushState does not re-fire popstate, so this
                // does not re-enter handleChange.
                if (acceptedPath !== null && currentPath() !== acceptedPath) {
                    history.pushState(null, '', routeUrl(acceptedPath));
                }
                return;
            }
            if (typeof verdict === 'string') { navigate(verdict); return; }
        }
        acceptedPath = currentPath();

        // Tear the old view down BEFORE building the new one. Tempting to defer this
        // until the handler resolves (it would avoid a blank outlet while a view
        // module loads), but several views null the navGuard slot in their unmount
        // effect — unmounting the old view after the new one has mounted would wipe
        // the guard the new view just installed.
        if (currentTeardown) { try { currentTeardown(); } catch { /* view cleanup */ } currentTeardown = null; }

        let result: any;
        try {
            result = await route.handler({ path, params, query, meta: route.meta });
        } catch (err) {
            if (gen !== generation) return;
            console.error('[router] view failed to load', path, err);
            // Retry with the FULL location (query included) — `path` was stripped
            // of its query string above, and losing it would retry a different view
            // state (message filters, wizard step, …).
            renderInto(loadErrorNode(currentPath()));
            window.dispatchEvent(new CustomEvent('route:changed', { detail: { path, params, query, meta: route.meta } }));
            return;
        }
        if (gen !== generation) {
            // A newer navigation won while this view was being built. It already owns
            // the outlet, so discard ours instead of rendering over it — otherwise its
            // React root leaks and keeps polling.
            if (result && typeof result.teardown === 'function') {
                try { result.teardown(); } catch { /* view cleanup */ }
            }
            return;
        }
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

function renderInto(node: Node): void {
    if (!outlet) return;
    while (outlet.firstChild) outlet.removeChild(outlet.firstChild);
    outlet.appendChild(node);
}

// Built with bare DOM calls, not the ui helpers, to keep this module import-free.
// Mirrors the notFound node's shape so it inherits the same empty-state styling.
function loadErrorNode(path: string): HTMLElement {
    const view = document.createElement('div');
    view.className = 'view';
    const body = document.createElement('div');
    body.className = 'view-body';
    const empty = document.createElement('div');
    empty.className = 'dt-empty';
    const msg = document.createElement('div');
    msg.textContent = 'This view failed to load.';
    const retry = document.createElement('button');
    retry.className = 'btn btn-primary';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => navigate(path));
    empty.append(msg, retry);
    body.appendChild(empty);
    view.appendChild(body);
    return view;
}

export function start(): void {
    // handleChange is async, so every call site floats a promise. Swallow rejections
    // here rather than leaving them unhandled — a failing view is reported in-outlet.
    if (!started) {
        window.addEventListener('popstate', () => { handleChange().catch(() => {}); });
        started = true;
    }
    handleChange().catch(() => {});
}
