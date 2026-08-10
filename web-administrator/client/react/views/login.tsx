/*
 * Login form (React port of views/login.js). Authenticates against
 * POST /users/_login and reports the LoginStatus. onSuccess(user) is called
 * with the authenticated user (the auth gate then mounts the shell).
 *
 * Multi-engine: if the server advertises more than one engine (config.engines),
 * a dropdown lets the user pick one; in devMode a "Custom URL…" option reveals a
 * URL field. The choice is written to the `oie-engine` cookie BEFORE the login
 * POST so it (and every later /api call) routes to that engine (server/proxy.js).
 */
import { getLoginAuthenticator } from '../../core/login-auth.js';

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

// Preselect the engine last used (persisted in the oie-engine cookie) so the
// picker remembers your choice instead of always snapping back to the first.
function initialSelection(engines: any, devMode: any) {
    const c = getCookie('oie-engine');
    if (c === 'custom' && devMode) return 'custom';
    if (/^\d+$/.test(c) && Number(c) < engines.length) return c;
    return '0';
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
    // index (as a string) or 'custom'; `customUrl` is the devMode manual URL.
    const cfg = store.getState('webadminConfig') || {};
    const engines = Array.isArray(cfg.engines) ? cfg.engines : [];
    const devMode = !!cfg.devMode;
    const showPicker = engines.length > 1 || devMode;
    const [sel, setSel] = useState(() => initialSelection(engines, devMode));
    const [customUrl, setCustomUrl] = useState(() => getCookie('oie-engine-url'));

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

    async function submit(e: any) {
        if (e && e.preventDefault) e.preventDefault();
        if (busyRef.current) return;
        busyRef.current = true;
        setError('');
        store.setState('loginNotice', null);

        // Point this session at the chosen engine before authenticating.
        if (showPicker) {
            if (sel === 'custom') {
                const url = customUrl.trim();
                if (!url) { setError('Enter an engine URL.'); busyRef.current = false; return; }
                setCookie('oie-engine', 'custom');
                setCookie('oie-engine-url', url);
            } else {
                clearCookie('oie-engine-url');
                setCookie('oie-engine', sel);
            }
        }

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
            const newKey = showPicker ? (sel === 'custom' ? `custom:${customUrl.trim()}` : sel) : '0';
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
                        <img className="logo-on-light block w-[108px]" src="/assets/oie_logo_bottom_text.svg" alt="Open Integration Engine" />
                        <img className="logo-on-dark block w-[169px]" src="/assets/oie_white_logo_banner_text_215x30.png" alt="Open Integration Engine" />
                    </span>
                    <div className="brand-sub">WEB ADMINISTRATOR</div>
                </div>
                {error ? <div className="login-error">{error}</div> : null}
                {showPicker ? (
                    <div className="field">
                        <label>Engine</label>
                        <select value={sel} onChange={(e: any) => setSel(e.target.value)}>
                            {engines.map((eng: any, i: any) => (
                                <option key={i} value={String(i)}>{eng.name}</option>
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
            </form>
            {/* Why you are back here (an expired session, a signed-out tab) — below the
                card, quiet, and never a dialog: there is nothing to acknowledge. */}
            {notice ? <div className="login-notice" role="status">{notice}</div> : null}
            </div>
        </div>
    );
}
