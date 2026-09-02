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
import { currentRoutePath, routeUrl } from '../../core/deployment.js';

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

// Plugins — and the RBAC controller's permission set with them — are loaded once
// per page load, for whoever was signed in at that moment. A soft sign-out
// followed by a sign-in in the same tab ran the new session under that stale
// set: an administrator signing in after a viewer got a view-only Settings
// page, and — since the OIDC extension re-synchronises a user's role at EVERY
// sign-in — the same user signing back in kept yesterday's menus while the
// engine refused the requests behind them. Same rule as a different engine
// (see finishLogin): once plugins have loaded in this page, any new session
// gets a fresh page. The first sign-in of a page session has no marker and
// takes the soft path; shell.tsx records the marker once the plugins load.
function reloadForFreshPermissions(): boolean {
    let loaded: string | null = null;
    try { loaded = sessionStorage.getItem('oie-loaded-user'); } catch { /* private mode */ }
    if (loaded == null) return false;
    location.reload();
    return true;
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

// The whole sign-in flow now runs in the ENGINE (the oie-oidc-auth extension):
// this card asks it to start, sends the browser to the provider, and hands the
// provider's answer back. The engine requires X-Requested-With on every API
// request, so the provider cannot redirect to it directly; it redirects to
// <web-administrator-url>/oidc/callback — a route of this app — and the card
// relays `code` and `state` by XHR. Nothing here needs a server of its own.
export function isOidcCallback(): boolean {
    return currentRoutePath().split('?')[0] === '/oidc/callback';
}

// Consumes the callback exactly once and scrubs the address bar: a code is
// single-use, and nothing about it belongs in history or a bookmark.
export function takeOidcCallback(): { code?: string; state?: string; error?: string } | null {
    if (!isOidcCallback()) return null;
    const q = new URLSearchParams(location.search);
    const result = { code: q.get('code') || undefined, state: q.get('state') || undefined, error: q.get('error') || undefined };
    try { history.replaceState(null, '', routeUrl('/')); } catch { /* ignore */ }
    return result;
}

// The extension's flow endpoints take and return JSON text. On the wire the
// engine carries a String as {"string": "..."} in both directions, and
// api.post unwraps the envelope to the inner text.
async function flowCall(path: string, payload: any): Promise<any> {
    const raw = await api.post(path, { string: JSON.stringify(payload) }, { noAuthHandler: true } as any);
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
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
    // Whether the selected engine offers SSO comes from the engine itself — the
    // extension's pre-auth /public endpoint, asked over the same /api path every
    // other call takes. The picker's current choice is written to the routing
    // cookie first so the proxy asks the engine being looked at.
    const [sso, setSso] = useState<any>(null);
    useEffect(() => {
        let alive = true;
        if (sel === 'custom' || (showPicker && sel === '')) { setSso(null); return; }
        if (showPicker) setCookie('oie-engine', sel);
        api.get('/extensions/oidcauth/public', { noAuthHandler: true } as any)
            .then((raw: any) => {
                const pub = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (alive) setSso(pub && pub.configured ? { providerLabel: pub.providerLabel || 'SSO', autoRedirect: !!pub.autoRedirect } : null);
            })
            .catch(() => { if (alive) setSso(null); });   // no extension, or no engine: local sign-in only
        return () => { alive = false; };
    }, [sel, showPicker]);
    const preferenceKey = `oie-login-mode:${sel}`;
    const [localMode, setLocalMode] = useState(() => {
        try { return localStorage.getItem(`oie-login-mode:${initialSelection(engines, devMode)}`) === 'local'; } catch { return false; }
    });
    const oidcCallbackRef = useRef<any>(takeOidcCallback());
    const callbackInFlight = useRef(!!oidcCallbackRef.current);

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

    async function startSso() {
        const selectionError = commitEngineSelection(showPicker, sel, customUrl);
        if (selectionError) { setError(selectionError); return; }
        // Where to come back to, as an internal route: the engine validates it as
        // a path on the web administrator and hands it back after sign-in.
        const returnPath = currentRoutePath() + location.hash;
        try {
            const started = await flowCall('/extensions/oidcauth/start', { return: returnPath, prompt: ssoReauth ? 'login' : '' });
            if (!started.ok || !started.authorizeUrl) {
                setError(started.message || 'SSO is unavailable. Use local sign-in.');
                chooseLocal(true);
                return;
            }
            location.assign(started.authorizeUrl);
        } catch (err: any) {
            setError(err.message || 'Could not reach the engine.');
            chooseLocal(true);
        }
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

    // The provider sent the browser back here. Relay its answer to the engine,
    // which finishes the exchange and hands back a one-time ticket; redeem the
    // ticket through the engine's ordinary login so the session, the audit
    // event, and any second factor are exactly what a password sign-in gets.
    useEffect(() => {
        const callback = oidcCallbackRef.current;
        oidcCallbackRef.current = null;
        if (!callback) return;
        try { sessionStorage.removeItem(`oie-oidc-redirect:${sel}`); } catch { /* ignore */ }
        (async () => {
            try {
                if (callback.error) {
                    setError('The identity provider declined sign-in.');
                    chooseLocal(true);
                    setSsoReauth(true);
                    return;
                }
                let done: any;
                try {
                    done = await flowCall('/extensions/oidcauth/callback', { code: callback.code, state: callback.state });
                } catch (err: any) {
                    setError(err.message || 'Could not reach the engine.');
                    chooseLocal(true);
                    return;
                }
                if (!done.ok || !done.ticket) {
                    setError(done.message || 'SSO sign-in failed.');
                    chooseLocal(true);
                    setSsoReauth(true);
                    return;
                }
                setSubmitting(true);
                await runLogin('oidc', `oidc:ticket:${done.ticket}`, { sso: true, returnPath: done.returnPath || '/' });
            } finally {
                callbackInFlight.current = false;
                setSubmitting(false);
            }
        })();
        // Mount-only by design: the callback is consumed exactly once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-redirect: once the engine says it offers SSO, and nothing is pending.
    useEffect(() => {
        if (!sso?.autoRedirect || localMode || callbackInFlight.current) return;
        const guard = `oie-oidc-redirect:${sel}`;
        try {
            if (!sessionStorage.getItem(guard)) { sessionStorage.setItem(guard, '1'); startSso(); }
        } catch { /* storage unavailable: leave the button reachable */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sso]);

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
        try {
            await runLogin(username.trim(), password, { sso: false, returnPath: null });
        } finally {
            setSubmitting(false);
            busyRef.current = false;
        }
    }

    // One login pipeline for both credentials: a password, or the ticket the
    // engine's SSO callback issued. The engine treats them identically from here
    // on — primary authentication, then any second factor — so the card does too.
    async function runLogin(user: string, credential: string, opts: { sso: boolean; returnPath: string | null }) {
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
            // An SSO sign-in comes back to the route it left from; put that in the
            // address bar BEFORE the shell boots into it (or the page reloads).
            if (opts.returnPath && opts.returnPath !== '/') {
                try { history.replaceState(null, '', routeUrl(opts.returnPath)); } catch { /* ignore */ }
            }
            // Remember HOW this session began: without the mark the account menu
            // offers an SSO user a Change Password that SSO never consults. Marked
            // only once the session is proven, and before any reload — the mark
            // lives in sessionStorage and survives one.
            if (loaded != null && loaded !== newKey) { if (opts.sso) markSsoSession(); location.reload(); return; }
            const user = await api.auth.current();
            if (opts.sso) markSsoSession();
            if (reloadForFreshPermissions()) return;
            await onSuccess(user, { graceMessage });
        };
        try {
            let result = await api.auth.login(user, credential);
            let status = result?.status || result;

            // Extended/MFA login (Swing ExtendedLoginStatus): a non-success status
            // naming a clientPluginClass hands off to a registered web authenticator,
            // which runs the second factor and the second-leg login. Mirrors the way
            // Swing instantiates the named client plugin and calls authenticate().
            if (status !== 'SUCCESS' && status !== 'SUCCESS_GRACE_PERIOD' && result && result.clientPluginClass) {
                const authenticate = getLoginAuthenticator(result.clientPluginClass);
                if (!authenticate) {
                    // It matters more for SSO, not less: an SSO account has no local
                    // password to fall back on, so "not available" without a next
                    // step is a dead end.
                    setError('This engine requires a multi-factor login method that is not available in the web administrator. '
                        + 'Use the desktop Administrator, or install the matching web login plugin.');
                    return;
                }
                const ctx = {
                    clientPluginClass: result.clientPluginClass,
                    username: result.updatedUsername || user,
                    primaryStatus: result,
                    // Full engine client, mirroring the `client` Swing hands the
                    // MFA plugin's authenticate() — for any pre-completion calls.
                    api,
                    // Convenience for the common case: the second-leg login with the
                    // factor in the X-Mirth-Login-Data header (Swing's getServlet
                    // custom-header login). The engine's second leg never re-checks
                    // the credential, so re-sending a spent ticket is harmless.
                    submit: (loginData: any) => api.auth.login(result.updatedUsername || user, credential, loginData)
                };
                result = await authenticate(ctx);
                status = result?.status || result;
            }

            if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
                await finishLogin(result);
                return;
            }
            // The engine's own message, then the status it named, then the generic
            // line. A status carrying no message — FAIL_LOCKED_OUT, FAIL_EXPIRED —
            // must still be explained, whichever credential was used.
            setError(result?.message || (STATUS_MESSAGES as any)[status] || (opts.sso ? 'SSO sign-in failed.' : 'Login failed.'));
            if (opts.sso) { chooseLocal(true); setSsoReauth(true); }
        } catch (err: any) {
            if (opts.sso && err && err.status === 403) {
                // The session is real but the account holds no permissions (an
                // RBAC install with no role assigned — e.g. a JIT user and no
                // default role). Say so; the generic line sends people debugging
                // cookies when the fix is a role assignment.
                setError('Signed in via SSO, but this account has no permissions on this engine. Assign it an RBAC role (or set a default role in the OIDC policy) and sign in again.');
                return;
            }
            // A 401 from the login endpoint means bad credentials, not an expired
            // session (which the global handler would otherwise claim).
            setError(err.status === 401 ? (opts.sso ? 'SSO sign-in was rejected.' : 'Invalid username or password.') : (err.message || 'Could not reach the engine.'));
            if (opts.sso) { chooseLocal(true); setSsoReauth(true); }
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
