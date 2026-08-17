/*
 * Did THIS browser session sign in through SSO?
 *
 * An OIDC-authenticated user has no engine password to change — their
 * credential lives at the IdP, and the engine-local one SSO never consults is
 * only misleading to offer. So the password affordances are suppressed for
 * their OWN account.
 *
 * Deliberately SESSION-scoped, not account-scoped. An OIDC-bound account can
 * still sign in locally through the break-glass path (the engine plugin returns
 * null for an unprefixed password, falling through to local auth), and that
 * session SHOULD be able to change the local password it just used. Scoping by
 * account instead would also strip an admin's ability to manage a linked
 * account's break-glass credential.
 *
 * sessionStorage rather than the in-memory store: the OIDC result cookie is
 * consumed once at boot (takeOidcResult), so a plain refresh would otherwise
 * forget how the session began. Tab lifetime is the right fit — scrubbed
 * explicitly on logout and on session expiry.
 */

const KEY = 'oie-sso-session';

export function markSsoSession(): void {
    // Private mode throws on write: degrade to SHOWING the controls rather than
    // hiding them — a visible control that errors beats a missing one.
    try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
}

export function clearSsoSession(): void {
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

export function isSsoSession(): boolean {
    try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** True when `user` IS the signed-in user and this session came from SSO. */
export function isSsoSelf(user: any, me: any): boolean {
    if (!isSsoSession() || !user || !me || user.id == null || me.id == null) return false;
    return String(user.id) === String(me.id);
}

/** Shown wherever a password control is greyed out instead of removed. */
export const SSO_MANAGED_NOTE = 'Your password is managed by your identity provider.';
