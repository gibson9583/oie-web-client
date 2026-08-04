/*
 * Multi-factor / extended login authenticators — the web equivalent of Swing's
 * MultiFactorAuthenticationClientPlugin (com.mirth.connect.plugins).
 *
 * Swing flow (LoginPanel): a primary login can return an ExtendedLoginStatus — a
 * non-success LoginStatus carrying a `clientPluginClass` (the FQCN of a client-side
 * MFA plugin). Swing instantiates that class and calls
 *   authenticate(window, client, username, primaryLoginStatus) -> LoginStatus
 * The plugin runs its own second-factor UI, then performs a SECOND login carrying
 * the factor in the `X-Mirth-Login-Data` header; the server delegates to its MFA
 * plugin and returns SUCCESS.
 *
 * Web equivalent: an authenticator registers against the SAME `clientPluginClass`
 * string the server returns (so the server contract is unchanged), and the shell
 * calls it in the place Swing instantiates the Java class.
 *
 * IMPORTANT — registration timing. MFA runs BEFORE a session exists, but
 * engine-served web plugins load AFTER login (they are fetched with the session).
 * So an MFA authenticator must be BUNDLED and registered at app boot, before the
 * login screen — mirroring Swing, whose MFA plugin ships in the client, not the
 * server. An engine-installed plugin cannot provide MFA (it can't be fetched
 * without the auth it is meant to grant). See client/react/login-authenticators.js.
 */

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

const authenticators = new Map<string, LoginAuthenticator>();   // clientPluginClass -> authenticate(ctx)

/** Register an authenticator for a server `clientPluginClass`. */
export function registerLoginAuthenticator(clientPluginClass: string, authenticate: LoginAuthenticator): void {
    if (!clientPluginClass || typeof authenticate !== 'function') return;
    authenticators.set(String(clientPluginClass), authenticate);
}

export function getLoginAuthenticator(clientPluginClass: string): LoginAuthenticator | null {
    return authenticators.get(String(clientPluginClass)) || null;
}
