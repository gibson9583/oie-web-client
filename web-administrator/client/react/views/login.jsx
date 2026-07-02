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

import { useState, useRef, useEffect } from 'react';
import api from '@oie/web-api';
import * as store from '../../core/store.js';

const STATUS_MESSAGES = {
    FAIL: 'Invalid username or password.',
    FAIL_EXPIRED: 'Your password has expired. Contact an administrator.',
    FAIL_LOCKED_OUT: 'Account locked out. Try again later.',
    FAIL_VERSION_MISMATCH: 'Client/server version mismatch.'
};

// Session cookie (path=/ so it reaches /api), cleared by Switch Engine / sign-out.
function setCookie(name, value) {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; samesite=lax`;
}
function clearCookie(name) {
    document.cookie = `${name}=; path=/; max-age=0`;
}

export function LoginForm({ onSuccess }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Engine selection. `engines` from /webadmin/config.json; `sel` is the chosen
    // index (as a string) or 'custom'; `customUrl` is the devMode manual URL.
    const cfg = store.getState('webadminConfig') || {};
    const engines = Array.isArray(cfg.engines) ? cfg.engines : [];
    const devMode = !!cfg.devMode;
    const showPicker = engines.length > 1 || devMode;
    const [sel, setSel] = useState('0');
    const [customUrl, setCustomUrl] = useState('');

    const userRef = useRef(null);
    const busyRef = useRef(false);   // re-entry guard (state is async)
    useEffect(() => {
        const t = setTimeout(() => userRef.current && userRef.current.focus(), 50);
        return () => clearTimeout(t);
    }, []);

    async function submit(e) {
        if (e && e.preventDefault) e.preventDefault();
        if (busyRef.current) return;
        busyRef.current = true;
        setError('');

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
        try {
            const result = await api.auth.login(username.trim(), password);
            const status = result?.status || result;
            if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
                if (status === 'SUCCESS_GRACE_PERIOD') console.warn('Password grace period:', result?.message);
                // Plugins are discovered once per page load, from the connected
                // engine, and their views register into module-level registries a
                // soft sign-out doesn't clear. If this sign-in targets a DIFFERENT
                // engine than the one plugins were loaded against, hard-reload so
                // discovery re-runs against the new engine (else the previous
                // engine's panels would linger). First sign-in of a page session
                // has nothing loaded yet, so it takes the normal soft path.
                const newKey = showPicker ? (sel === 'custom' ? `custom:${customUrl.trim()}` : sel) : '0';
                let loaded = null;
                try { loaded = sessionStorage.getItem('oie-loaded-engine'); } catch { /* private mode */ }
                if (loaded != null && loaded !== newKey) { location.reload(); return; }
                const user = await api.auth.current();
                await onSuccess(user);
                return;
            }
            setError(result?.message || STATUS_MESSAGES[status] || 'Login failed.');
        } catch (err) {
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
            <form className="login-card" onSubmit={submit}
                onKeyDown={(e) => {
                    // Explicit Enter-to-submit so pressing Enter in a field logs in
                    // regardless of native implicit-submission quirks.
                    if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT') {
                        e.preventDefault();
                        submit(e);
                    }
                }}>
                <div className="login-brand">
                    <span>
                        <img className="logo-on-light block w-[120px]" src="/assets/oie_logo_bottom_text.svg" alt="Open Integration Engine" />
                        <img className="logo-on-dark block w-[188px]" src="/assets/oie_white_logo_banner_text_215x30.png" alt="Open Integration Engine" />
                    </span>
                    <div className="brand-sub">WEB ADMINISTRATOR</div>
                </div>
                {error ? <div className="login-error">{error}</div> : null}
                {showPicker ? (
                    <div className="field">
                        <label>Engine</label>
                        <select value={sel} onChange={(e) => setSel(e.target.value)}>
                            {engines.map((eng, i) => (
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
                            value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
                    </div>
                ) : null}
                <div className="field">
                    <label>Username</label>
                    <input ref={userRef} type="text" autoComplete="username" placeholder="admin" required
                        value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="field">
                    <label>Password</label>
                    <input type="password" autoComplete="current-password" placeholder="••••••••" required
                        value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <button className="btn btn-primary w-full justify-center p-[9px]" type="submit" disabled={submitting}>
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
                <div className="login-foot">authenticated session · engine REST API</div>
            </form>
        </div>
    );
}
