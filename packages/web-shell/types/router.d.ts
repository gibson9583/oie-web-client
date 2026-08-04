/** What a route handler / guard receives. */
export interface RouteContext {
    path: string;
    params: Record<string, string | undefined>;
    query: Record<string, string>;
    meta: Record<string, any>;
}
/** A handler returns a DOM node, `{ el, teardown }`, or null after rendering itself. */
export type RouteResult = Node | {
    el: Node;
    teardown?: () => void;
} | null | undefined | void;
export type RouteHandler = (ctx: RouteContext) => RouteResult | Promise<RouteResult>;
/** `false` blocks the navigation, a string redirects, anything else allows. */
export type RouteGuard = (ctx: RouteContext) => boolean | string | void | Promise<boolean | string | void>;
export declare function register(pattern: string, handler: RouteHandler, meta?: Record<string, any>): void;
export declare function navigationToken(): number;
export declare function setOutlet(el: Element | null): void;
export declare function setNotFound(handler: ((ctx: {
    path: string;
}) => Node) | null): void;
export declare function setGuard(fn: RouteGuard | null): void;
export declare function navigate(path: string): void;
export declare function currentPath(): string;
export declare function start(): void;
