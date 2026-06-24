/*
 * Login form (React port of views/login.js). Authenticates against
 * POST /users/_login and reports the LoginStatus. onSuccess(user) is called
 * with the authenticated user (the auth gate then mounts the shell).
 */

import { useState, useRef, useEffect } from 'react';
import api from '@oie/web-api';

const STATUS_MESSAGES = {
    FAIL: 'Invalid username or password.',
    FAIL_EXPIRED: 'Your password has expired. Contact an administrator.',
    FAIL_LOCKED_OUT: 'Account locked out. Try again later.',
    FAIL_VERSION_MISMATCH: 'Client/server version mismatch.'
};

export function LoginForm({ onSuccess }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
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
        setSubmitting(true);
        try {
            const result = await api.auth.login(username.trim(), password);
            const status = result?.status || result;
            if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
                if (status === 'SUCCESS_GRACE_PERIOD') console.warn('Password grace period:', result?.message);
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
                    // Explicit Enter-to-submit so pressing Enter in either field
                    // logs in regardless of native implicit-submission quirks.
                    if (e.key === 'Enter' && !e.isComposing && e.target.tagName === 'INPUT') {
                        e.preventDefault();
                        submit(e);
                    }
                }}>
                <div className="login-brand">
                    <span>
                        <img className="logo-on-light block w-[120px]" src="assets/oie_logo_bottom_text.svg" alt="Open Integration Engine" />
                        <img className="logo-on-dark block w-[188px]" src="assets/oie_white_logo_banner_text_215x30.png" alt="Open Integration Engine" />
                    </span>
                    <div className="brand-sub">WEB ADMINISTRATOR</div>
                </div>
                {error ? <div className="login-error">{error}</div> : null}
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
