/*
 * Did THIS browser session sign in through SSO?
 *
 * An OIDC-authenticated user has no engine password to change — their
 * credential lives at the IdP, and the engine-local one SSO never consults is
 * only misleading to offer. So the password affordances are suppressed for
 * their OWN account.
 *
 * Deliberately SESSION-scoped, not account-scoped. An account the operator
 * listed in the engine's linked-accounts keeps its local password as a
 * break-glass path, and a session that used it SHOULD be able to change the
 * password it just used. Scoping by account instead would also strip an
 * admin's ability to manage that credential.
 *
 * sessionStorage rather than the in-memory store: the provider's callback is
 * consumed once at boot (takeOidcCallback), so a plain refresh would otherwise
 * forget how the session began. Tab lifetime is the right fit — scrubbed
 * explicitly on logout and on session expiry.
 */

const KEY = 'oie-sso-session';
/** This tab sent the browser to the provider and is owed a callback. */
const PENDING = 'oie-oidc-pending';
/** Sign-out asks the next login card to show the button rather than redirect. */
const HOLD = 'oie-oidc-hold';

export function markSsoPending(): void {
    try { sessionStorage.setItem(PENDING, '1'); } catch { /* storage unavailable */ }
}

export function hasSsoPending(): boolean {
    try { return sessionStorage.getItem(PENDING) === '1'; } catch { return false; }
}

export function takeSsoPending(): boolean {
    const pending = hasSsoPending();
    try { sessionStorage.removeItem(PENDING); } catch { /* storage unavailable */ }
    return pending;
}

export function holdAutoRedirect(): void {
    try { sessionStorage.setItem(HOLD, '1'); } catch { /* storage unavailable */ }
}

/** True once, then cleared: the hold covers the one card shown after sign-out. */
export function takeAutoRedirectHold(): boolean {
    try {
        const held = sessionStorage.getItem(HOLD) === '1';
        sessionStorage.removeItem(HOLD);
        return held;
    } catch { return false; }
}

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
