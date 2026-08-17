export declare function normalizeBasePath(value: string | null | undefined): string;
export declare function joinBasePath(base: string, path?: string): string;
export declare function stripBasePath(path: string, base: string): string;
export declare const APP_BASE: string;
/** Engine REST root. index.jsp sets this to the API beside the deployed WAR. */
export declare const API_BASE: string;
/** URL for a resource or server endpoint owned by the web client. */
export declare function appUrl(path?: string): string;
/** URL for an engine API resource. */
export declare function apiUrl(path?: string): string;
/** Browser URL for an internal SPA route. */
export declare function routeUrl(path?: string): string;
/** Internal route (context prefix removed) represented by the current location. */
export declare function currentRoutePath(): string;
