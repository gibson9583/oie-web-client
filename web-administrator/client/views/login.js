/*
 * Login stage. Authenticates against POST /users/_login and reports the
 * LoginStatus (SUCCESS, SUCCESS_GRACE_PERIOD, FAIL, FAIL_EXPIRED,
 * FAIL_LOCKED_OUT, FAIL_VERSION_MISMATCH).
 */

import { h, icon } from '../core/ui.js';
import api from '../core/api.js';

export function renderLogin(onSuccess) {
    const error = h('div.login-error.hidden');
    const username = h('input', { type: 'text', autocomplete: 'username', placeholder: 'admin', required: true });
    const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••', required: true });
    const button = h('button.btn.btn-primary', { type: 'submit', style: { width: '100%', justifyContent: 'center', padding: '9px' } }, 'Sign in');

    async function submit(e) {
        e.preventDefault();
        error.classList.add('hidden');
        button.disabled = true;
        button.textContent = 'Signing in…';
        try {
            const result = await api.auth.login(username.value.trim(), password.value);
            const status = result?.status || result;
            if (status === 'SUCCESS' || status === 'SUCCESS_GRACE_PERIOD') {
                if (status === 'SUCCESS_GRACE_PERIOD') {
                    // Surface but don't block; the password is expiring.
                    console.warn('Password grace period:', result?.message);
                }
                const user = await api.auth.current();
                onSuccess(user);
                return;
            }
            const messages = {
                FAIL: 'Invalid username or password.',
                FAIL_EXPIRED: 'Your password has expired. Contact an administrator.',
                FAIL_LOCKED_OUT: 'Account locked out. Try again later.',
                FAIL_VERSION_MISMATCH: 'Client/server version mismatch.'
            };
            error.textContent = result?.message || messages[status] || 'Login failed.';
            error.classList.remove('hidden');
        } catch (err) {
            // A 401 from the login endpoint means bad credentials, not an
            // expired session (which the global handler would otherwise claim).
            error.textContent = err.status === 401
                ? 'Invalid username or password.'
                : (err.message || 'Could not reach the engine.');
            error.classList.remove('hidden');
        } finally {
            button.disabled = false;
            button.textContent = 'Sign in';
        }
    }

    const mark = h('span',
        h('img.logo-on-light', { src: 'assets/oie_logo_bottom_text.svg', alt: 'Open Integration Engine', style: { width: '120px', display: 'block' } }),
        h('img.logo-on-dark', { src: 'assets/oie_white_logo_banner_text_215x30.png', alt: 'Open Integration Engine', style: { width: '188px', display: 'block' } }));

    const stage = h('div.login-stage',
        h('form.login-card', { onSubmit: submit },
            h('div.login-brand',
                mark,
                h('div.brand-sub', 'WEB ADMINISTRATOR')),
            error,
            h('div.field', h('label', 'Username'), username),
            h('div.field', h('label', 'Password'), password),
            button,
            h('div.login-foot', 'authenticated session · engine REST API')));

    setTimeout(() => username.focus(), 50);
    return stage;
}
