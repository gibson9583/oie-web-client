/*
 * Login form (React port of views/login.js). Authenticates against
 * POST /users/_login and reports the LoginStatus. onSuccess(user) is called
 * with the authenticated user (the auth gate then mounts the shell).
 *
 * Multi-engine: if the server advertises more than one engine (config.engines),
 * a dropdown lets the user pick one; in devMode a "Custom URL…" option reveals a
 * URL field. The choice — the engine's stable key, never its list position — is
 * written to the `oie-engine` cookie BEFORE the login POST so it (and every
 * later /api call) routes to that engine (server/proxy.js).
 */
import { getLoginAuthenticator } from '../../core/login-auth.js';
import { appUrl } from '../../core/deployment.js';
import { markSsoSession } from '../sso-session.js';

import { useState, useRef, useEffect } from 'react';
import { useStoreKey } from '../bridges.jsx';
import api from '@oie/web-api';
import * as store from '../../core/store.js';

const STATUS_MESSAGES = {
    FAIL: 'Invalid username or password.',
    FAIL_EXPIRED: 'Your password has expired. Contact an administrator.',
    FAIL_LOCKED_OUT: 'Account locked out. Try again later.',
    FAIL_VERSION_MISMATCH: 'Client/server version mismatch.'
};

// Session cookie (path=/ so it reaches /api), cleared by Switch Engine / sign-out.
function setCookie(name: any, value: any) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}
function clearCookie(name: any) {
    document.cookie = `${name}=; path=/; max-age=0`;
}
function getCookie(name: any) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}

// Point this session at the chosen engine. Shared by the password submit and the
// SSO start, so both routes agree on what the cookie pair means. Returns an error
// message to show the user, or null on success.
function commitEngineSelection(showPicker: boolean, sel: string, customUrl: string): string | null {
    if (!showPicker) {
        // Single-engine mode: this sign-in targets the only engine, so drop any
        // stale routing cookies (a remembered engine from a shrunk list, a
        // devMode custom pair) — left in place they would keep mislabeling the
        // session and forcing a hard reload on every sign-in.
        clearCookie('oie-engine');
        clearCookie('oie-engine-url');
        return null;
    }
    if (sel === '') return 'Choose an engine.';   // stale remembered engine (see initialSelection) — don't guess
    if (sel === 'custom') {
        const url = customUrl.trim();
        // Validate HERE, where the message can say what is wrong: an unroutable
        // custom URL that reaches the proxy earns only the generic ENGINE_UNKNOWN
        // refusal, which misreads a typo as a stale engine selection.
        let parsed: URL | null = null;
        try { parsed = new URL(url); } catch { /* handled below */ }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            return url ? 'Enter a full engine URL, e.g. https://host:8443.' : 'Enter an engine URL.';
        }
        setCookie('oie-engine', 'custom');
        setCookie('oie-engine-url', url);
    } else {
        clearCookie('oie-engine-url');
        setCookie('oie-engine', sel);
    }
    return null;
}

// Puts a consumed result back for LoginForm to pick up. takeOidcResult() clears
// the cookie on read, so a caller that decides the result is not theirs to handle
// (see shell.tsx's boot effect and an MFA challenge) would otherwise destroy it.
// Same short lifetime as the server's — this is a hand-off within one page load,
// not a durable store.
export function restoreOidcResult(result: any): void {
    try {
        const json = JSON.stringify(result);
        const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        // Match the server's attributes, Secure included: the exposure window is
        // one React commit (LoginForm consumes it on the next render), but that
        // safety comes from render ordering rather than anything asserted here.
        document.cookie = `oie-oidc-result=${base64}; path=/; max-age=120; samesite=lax${location.protocol === 'https:' ? '; secure' : ''}`;
    } catch { /* the card will show the generic failure, which is the status quo */ }
}

export function takeOidcResult(): any {
    const raw = getCookie('oie-oidc-result');
    if (!raw) return null;
    clearCookie('oie-oidc-result');
    try {
        const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - raw.length % 4) % 4);
        return JSON.parse(decodeURIComponent(Array.from(atob(padded), c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
    } catch { return { status: 'FAIL', message: 'SSO sign-in could not be completed.' }; }
}

// Whether the login card offers an engine choice at all. initialSelection's
// stale-cookie behavior hinges on this exactly as the rendered picker does, so
// the two read it from here rather than each spelling out the predicate.
function hasPicker(engines: any, devMode: any): boolean {
    return engines.length > 1 || !!devMode;
}

// Preselect the engine last used (persisted in the oie-engine cookie) so the
// picker remembers your choice instead of always snapping back to the first.
// The cookie holds the engine's stable key (server config.ts engineKey), so an
// edited engine list can't silently change what the remembered choice means
// (issue #53). A remembered choice that no longer resolves — the engine was
// removed or renamed, or the cookie is a pre-key numeric index — returns '':
// the picker then demands an explicit choice rather than guessing an engine.
function initialSelection(engines: any, devMode: any) {
    const c = getCookie('oie-engine');
    if (c === 'custom' && devMode) return 'custom';
    if (c && engines.some((e: any) => e.key === c)) return c;
    const only = engines.length ? String(engines[0].key ?? '') : '';
    // Demand a re-pick only where a picker exists to re-pick with. Single-engine
    // mode has none, so returning '' there would strand the user: nothing
    // resolves, the SSO affordance disappears, and the cookie that caused it is
    // unreachable from the UI (recovery would need a local sign-in, which an
    // SSO-only account cannot do). A pre-key cookie from an older build — or an
    // allowedUrls list shrunk to one — is exactly this case. This also matches
    // the proxy, which already ignores the cookie outright in single-engine mode.
    if (c) return hasPicker(engines, devMode) ? '' : only;
    return only;
}

export function LoginForm({ onSuccess }: any) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    // Set by the shell when it drops us here (session expiry). Cleared on the first
    // submit, so a failed sign-in shows its own error rather than both.
    const notice = useStoreKey('loginNotice');
    const [submitting, setSubmitting] = useState(false);

    // Engine selection. `engines` from /webadmin/config.json; `sel` is the chosen
    // engine's key, 'custom', or '' (a stale remembered choice — must re-pick);
    // `customUrl` is the devMode manual URL.
    const cfg = store.getState('webadminConfig') || {};
    const engines = Array.isArray(cfg.engines) ? cfg.engines : [];
    const devMode = !!cfg.devMode;
    const showPicker = hasPicker(engines, devMode);
    const [sel, setSel] = useState(() => initialSelection(engines, devMode));
    const [customUrl, setCustomUrl] = useState(() => getCookie('oie-engine-url'));
    // By stable key, never list position (#54): `sel` holds the key, so an
    // index lookup here silently yields undefined and the SSO affordance
    // disappears from a correctly-configured engine.
    const selectedEngine = sel === 'custom' || sel === '' ? null : engines.find((e: any) => e.key === sel);
    const sso = selectedEngine?.sso;
    const preferenceKey = `oie-login-mode:${sel}`;
    const [localMode, setLocalMode] = useState(() => {
        try { return localStorage.getItem(`oie-login-mode:${initialSelection(engines, devMode)}`) === 'local'; } catch { return false; }
    });
    const oidcResultRef = useRef<any>(takeOidcResult());

    useEffect(() => {
        try { setLocalMode(localStorage.getItem(preferenceKey) === 'local'); } catch { setLocalMode(false); }
    }, [preferenceKey]);

    function chooseLocal(value: boolean) {
        setLocalMode(value);
        try { if (value) localStorage.setItem(preferenceKey, 'local'); else localStorage.removeItem(preferenceKey); } catch { /* private mode */ }
    }

    // After a rejected attempt, retry with prompt=login so the IdP re-prompts
    // instead of silently replaying its session for the same rejected account.
    const [ssoReauth, setSsoReauth] = useState(false);

    function startSso() {
        const selectionError = commitEngineSelection(showPicker, sel, customUrl);
        if (selectionError) { setError(selectionError); return; }
        // appUrl for consistency with every other server endpoint this client
        // addresses; it resolves to the same "/oidc/start" in the only shape that
        // serves the BFF (the Node deployment — the WAR has no Express side, so
        // SSO is not offered there at all). The return path stays a full location
        // path: the server hands it straight back as a redirect target.
        const returnPath = location.pathname === '/' ? '/' : location.pathname + location.search + location.hash;
        location.assign(`${appUrl('/oidc/start')}?engine=${encodeURIComponent(sel)}&return=${encodeURIComponent(returnPath)}${ssoReauth ? '&prompt=login' : ''}`);
    }

    const userRef = useRef<any>(null);
    const busyRef = useRef(false);   // re-entry guard (state is async)
    useEffect(() => {
        // Focus the username field once the view settles — but only if nothing
        // in the form already has focus. A blind focus() 50ms in steals it back
        // from a user (or test) who has already moved to the password field,
        // landing their next keystrokes in the wrong box (same guard as the
        // welcome wizard's deferred focus).
        const t = setTimeout(() => {
            const el = userRef.current;
            const form = el && el.closest('form');
            if (el && !(form && form.contains(document.activeElement))) el.focus();
        }, 50);
        return () => clearTimeout(t);
    }, []);

    useEffect(() => {
        const result = oidcResultRef.current;
        oidcResultRef.current = null;
        if (!result) {
            if (sso?.autoRedirect && !localMode) {
                const guard = `oie-oidc-redirect:${sel}`;
                try {
                    if (!sessionStorage.getItem(guard)) { sessionStorage.setItem(guard, '1'); startSso(); }
                } catch { /* storage unavailable: leave the button reachable */ }
            }
            return;
        }
        try { sessionStorage.removeItem(`oie-oidc-redirect:${sel}`); } catch { /* ignore */ }
        const status = result.status || result;
        if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
            // Same record the shell's boot path keeps: a session established HERE
            // is just as much an SSO session, and without the mark the account
            // menu offers it a Change Password that SSO never consults. This path
            // runs whenever the login card wins the race for the result cookie —
            // e.g. a second tab dropped by a 401 while this one completed SSO.
            // Marked only once the session is PROVEN, like shell.tsx's boot path:
            // both .catch arms below are reachable (a 403 roleless account is the
            // common one), nothing clears the mark when no session was created,
            // and a stale mark would strip Change Password from the break-glass
            // local sign-in that this very error message sends the user to.
            api.auth.current().then((user: any) => { markSsoSession(); return onSuccess(user, { graceMessage: result.message || null }); })
                // 403 = the session is real but the account holds no permissions
                // (an RBAC install with no role assigned — e.g. a JIT user and no
                // default role). Say so; the generic line sends people debugging
                // cookies when the fix is a role assignment.
                .catch((err: any) => setError(err && err.status === 403
                    ? 'Signed in via SSO, but this account has no permissions on this engine. Assign it an RBAC role (or set a default role in the OIDC policy) and sign in again.'
                    : 'SSO completed, but the engine session could not be loaded.'));
            return;
        }
        if (result.clientPluginClass) {
            const authenticate = getLoginAuthenticator(result.clientPluginClass);
            // Same remediation the password path gives (below). It matters more
            // here, not less: an SSO account has no local password to fall back
            // on, so "not available" without a next step is a dead end.
            if (!authenticate) {
                setError('This engine requires a multi-factor login method that is not available in the web administrator. '
                    + 'Use the desktop Administrator, or install the matching web login plugin.');
                return;
            }
            authenticate({ clientPluginClass: result.clientPluginClass, username: result.updatedUsername || '', primaryStatus: result,
                api, submit: (loginData: any) => api.auth.login(result.updatedUsername || '', '', loginData) } as any)
                .then(async (second: any) => {
                    const secondStatus = second?.status || second;
                    if (secondStatus !== 'SUCCESS' && secondStatus !== 'SUCCESS_GRACE_PERIOD') throw new Error(second?.message || 'Multi-factor sign-in failed.');
                    // The second factor rides on the SSO primary — still SSO. Same
                    // ordering rule as above: prove the session, then mark it.
                    const user = await api.auth.current();
                    markSsoSession();
                    await onSuccess(user, { graceMessage: second?.message || null });
                }).catch((err: any) => setError(err.message || 'Multi-factor sign-in failed.'));
            return;
        }
        // Same three-step fallback the password path uses (below): the engine's own
        // message, then the status the engine named, then the generic line. Reading
        // only `message` meant a status carrying none — FAIL_LOCKED_OUT,
        // FAIL_EXPIRED, FAIL_VERSION_MISMATCH — told an SSO user "SSO sign-in
        // failed" and sent them back to the IdP, which will keep succeeding: the
        // rejection is the ENGINE's, and the reason it gave was dropped here.
        setError(result.message || (STATUS_MESSAGES as any)[status] || 'SSO sign-in failed.');
        chooseLocal(true);
        setSsoReauth(true);
        // Mount-only by design: the SSO result cookie and autoRedirect decision
        // are consumed exactly once, for the engine selected at page load.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function submit(e: any) {
        if (e && e.preventDefault) e.preventDefault();
        if (busyRef.current) return;
        busyRef.current = true;
        setError('');
        store.setState('loginNotice', null);

        // Point this session at the chosen engine before authenticating.
        const selectionError = commitEngineSelection(showPicker, sel, customUrl);
        if (selectionError) { setError(selectionError); busyRef.current = false; return; }

        setSubmitting(true);
        // Completes a successful (primary or post-MFA) login: reload on an engine
        // switch, else fetch the user and hand off to the shell.
        const finishLogin = async (result: any) => {
            const status = result?.status || result;
            const graceMessage = status === 'SUCCESS_GRACE_PERIOD' ? String(result?.message || '') : null;
            // Plugins are discovered once per page load, from the connected engine,
            // and their views register into module-level registries a soft sign-out
            // doesn't clear. If this sign-in targets a DIFFERENT engine than the one
            // plugins were loaded against, hard-reload so discovery re-runs against
            // the new engine. First sign-in of a page session takes the soft path.
            const newKey = showPicker ? (sel === 'custom' ? `custom:${customUrl.trim()}` : sel) : '';
            let loaded: any = null;
            try { loaded = sessionStorage.getItem('oie-loaded-engine'); } catch { /* private mode */ }
            if (loaded != null && loaded !== newKey) { location.reload(); return; }
            const user = await api.auth.current();
            await onSuccess(user, { graceMessage });
        };
        try {
            let result = await api.auth.login(username.trim(), password);
            let status = result?.status || result;

            // Extended/MFA login (Swing ExtendedLoginStatus): a non-success status
            // naming a clientPluginClass hands off to a registered web authenticator,
            // which runs the second factor and the second-leg login. Mirrors the way
            // Swing instantiates the named client plugin and calls authenticate().
            if (status !== 'SUCCESS' && status !== 'SUCCESS_GRACE_PERIOD' && result && result.clientPluginClass) {
                const authenticate = getLoginAuthenticator(result.clientPluginClass);
                if (!authenticate) {
                    setError('This engine requires a multi-factor login method that is not available in the web administrator. '
                        + 'Use the desktop Administrator, or install the matching web login plugin.');
                    return;
                }
                const enteredUser = username.trim();
                const ctx = {
                    clientPluginClass: result.clientPluginClass,
                    username: result.updatedUsername || enteredUser,
                    primaryStatus: result,
                    // Full engine client, mirroring the `client` Swing hands the
                    // MFA plugin's authenticate() — for any pre-completion calls.
                    api,
                    // Convenience for the common case: the second-leg login with the
                    // factor in the X-Mirth-Login-Data header (Swing's getServlet
                    // custom-header login).
                    submit: (loginData: any) => api.auth.login(result.updatedUsername || enteredUser, password, loginData)
                };
                result = await authenticate(ctx);
                status = result?.status || result;
            }

            if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
                await finishLogin(result);
                return;
            }
            setError(result?.message || (STATUS_MESSAGES as any)[status] || 'Login failed.');
        } catch (err: any) {
            // A 401 from the login endpoint means bad credentials, not an expired
            // session (which the global handler would otherwise claim).
            setError(err.status === 401 ? 'Invalid username or password.' : (err.message || 'Could not reach the engine.'));
        } finally {
            setSubmitting(false);
            busyRef.current = false;
        }
    }

    return (
        <div className="login-stage">
            {/* Column, so the notice sits UNDER the card: .login-stage is a centering
                flex row, and a bare sibling of the form lands beside it instead. */}
            <div className="login-column">
            <form className="login-card panel overflow-visible" onSubmit={submit}
                onKeyDown={(e: any) => {
                    // Explicit Enter-to-submit so pressing Enter in a field logs in
                    // regardless of native implicit-submission quirks.
                    if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT') {
                        e.preventDefault();
                        submit(e);
                    }
                }}>
                <div className="login-brand">
                    <span>
                        <img className="logo-on-light block w-[108px]" src={appUrl('/assets/oie_logo_bottom_text.svg')} alt="Open Integration Engine" />
                        <img className="logo-on-dark block w-[169px]" src={appUrl('/assets/oie_white_logo_banner_text_215x30.png')} alt="Open Integration Engine" />
                    </span>
                    <div className="brand-sub">WEB ADMINISTRATOR</div>
                </div>
                {error ? <div className="login-error">{error}</div> : null}
                {showPicker ? (
                    <div className="field">
                        <label>Engine</label>
                        <select value={sel} onChange={(e: any) => setSel(e.target.value)}>
                            {/* Only when the remembered engine is gone: a real pick
                                replaces it, and it can't be re-selected. */}
                            {sel === '' ? <option value="" disabled>Select an engine…</option> : null}
                            {engines.map((eng: any) => (
                                <option key={eng.key} value={eng.key}>{eng.name}</option>
                            ))}
                            {devMode ? <option value="custom">Custom URL…</option> : null}
                        </select>
                    </div>
                ) : null}
                {showPicker && sel === 'custom' ? (
                    <div className="field">
                        <label>Engine URL</label>
                        <input type="text" autoComplete="off" placeholder="https://host:8443"
                            value={customUrl} onChange={(e: any) => setCustomUrl(e.target.value)} />
                    </div>
                ) : null}
                {sso && !localMode ? (
                    <>
                        <button className="btn btn-primary w-full justify-center p-[8px]" type="button" onClick={startSso}>
                            Sign in with {sso.providerLabel || 'SSO'}
                        </button>
                        <button className="btn w-full justify-center mt-2" type="button" onClick={() => chooseLocal(true)}>Use local sign-in</button>
                    </>
                ) : <>
                <div className="field">
                    <label>Username</label>
                    <input ref={userRef} type="text" autoComplete="username" placeholder="admin" required
                        value={username} onChange={(e: any) => setUsername(e.target.value)} />
                </div>
                <div className="field">
                    <label>Password</label>
                    <input type="password" autoComplete="current-password" placeholder="••••••••" required
                        value={password} onChange={(e: any) => setPassword(e.target.value)} />
                </div>
                <button className="btn btn-primary w-full justify-center p-[8px]" type="submit" disabled={submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
                {sso ? <button className="btn w-full justify-center mt-2" type="button" onClick={() => chooseLocal(false)}>Sign in with SSO</button> : null}
                </>}
            </form>
            {/* Why you are back here (an expired session, a signed-out tab) — below the
                card, quiet, and never a dialog: there is nothing to acknowledge. */}
            {notice ? <div className="login-notice" role="status">{notice}</div> : null}
            </div>
        </div>
    );
}
