import type { OieObject } from './wire-types.js';
/** What an authenticator receives — the web analogue of Swing's authenticate() args. */
export interface LoginAuthContext {
    /** The class string the server returned. */
    clientPluginClass: string;
    /** updatedUsername from the primary status, else the entered name. */
    username: string;
    /** The full parsed primary login result { status, message, ... }. */
    primaryStatus: OieObject;
    /** Performs the second-leg login carrying `loginData` in the X-Mirth-Login-Data
        header; resolves to the parsed status. */
    submit(loginData: string): Promise<any>;
}
/** Resolves to a status-shaped object ({ status, message, updatedUsername }) —
    typically whatever ctx.submit returned, or a FAIL/cancel status. */
export type LoginAuthenticator = (ctx: LoginAuthContext) => Promise<any>;
/** Register an authenticator for a server `clientPluginClass`. */
export declare function registerLoginAuthenticator(clientPluginClass: string, authenticate: LoginAuthenticator): void;
export declare function getLoginAuthenticator(clientPluginClass: string): LoginAuthenticator | null;
