/*
 * Built-in generic OTP login authenticator.
 *
 * A server-side MFA plugin (TOTP/HOTP/any one-time-code method) is fully usable
 * with NO bundled web code: it returns the well-known clientPluginClass
 * `builtin:otp` from its ExtendedLoginStatus, and this host-provided handler
 * renders the standard enroll/verify UI. Only exotic methods that need custom UI
 * (WebAuthn, push) ship their own authenticator via registerLoginAuthenticator.
 *
 * The generic OTP challenge protocol (the ExtendedLoginStatus `message`, a JSON
 * string):
 *
 *   verify (already enrolled):
 *     { "mode": "verify", "challenge": "<opaque>", "prompt"?: "<text>" }
 *   enroll (first-time setup, delivered as a login step):
 *     { "mode": "enroll", "challenge": "<opaque>",
 *       "secret": "<base32>", "otpauthUri"?: "<uri>", "prompt"?: "<text>" }
 *
 * The client echoes the code back on the second leg as the login-data header:
 *   base64( { "challenge": "<opaque>", "code": "<digits>" } )
 * `challenge` is opaque to the client — the server signs/verifies it.
 */

import { platform } from '@oie/web-shell';
import qrcode from 'qrcode-generator';
import { registerLoginAuthenticator } from './login-auth.js';

/** The well-known clientPluginClass a server-only OTP plugin returns. */
export const BUILTIN_OTP = 'builtin:otp';

function ui() {
    return platform.ui;
}

/* Renders `text` (the otpauth:// URI) as a scannable QR <img>, or null on failure.
   Level M error-correction; type 0 auto-sizes to the data. */
function qrImage(text, size = 148) {
    try {
        const qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        const dataUrl = qr.createDataURL(4, 8);   // cellSize, margin (px)
        return ui().h('img', {
            src: dataUrl, width: size, height: size, alt: 'Authenticator QR code',
            style: 'image-rendering:pixelated; border:1px solid var(--line); border-radius:6px; background:#fff'
        });
    } catch {
        return null;
    }
}

/** A base32 secret is friendlier to type/read in groups of four. */
function groupSecret(secret) {
    return String(secret || '').replace(/(.{4})/g, '$1 ').trim();
}

/* Collect a one-time code. `extra` is optional setup content (enroll). Resolves the
   trimmed code, or null if cancelled. */
function promptCode({ title, intro, extra, confirmLabel }) {
    const { h, modal } = ui();
    return new Promise((resolve) => {
        const input = h('input', {
            type: 'text', inputMode: 'numeric', autocomplete: 'one-time-code',
            maxLength: 10,
            class: 'field mono', style: 'font-size:20px; letter-spacing:6px; text-align:center; width:220px'
        });
        const err = h('div', { style: 'color:var(--err); min-height:1.2em; font-size:12px' }, '');
        const body = h('div', { style: 'display:flex; flex-direction:column; gap:10px; min-width:320px' },
            h('div', intro), extra || null, input, err);
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value); } };
        modal({
            title, body,
            onClose: () => finish(null),
            buttons: [
                { label: 'Cancel', onClick: () => finish(null) },
                {
                    label: confirmLabel || 'Verify', primary: true,
                    onClick: () => {
                        const code = String(input.value || '').trim();
                        // Length-agnostic: OTP methods vary (6–8+ digits) and the
                        // server does the real validation. Just require a plausible
                        // numeric code — never advertise the expected length.
                        if (!/^\d{4,10}$/.test(code)) { err.textContent = 'Enter the code from your authenticator app.'; return false; }
                        finish(code);
                    }
                }
            ]
        });
        setTimeout(() => input.focus(), 0);
    });
}

/* Enrollment setup block: a scannable QR of the otpauth:// URI (when present)
   alongside the key and link, so manual entry still works with every app. */
function enrollSetup(info) {
    const { h } = ui();
    const qr = info.otpauthUri ? qrImage(info.otpauthUri) : null;
    return h('div', { style: 'display:flex; gap:12px; padding:10px; border:1px solid var(--line); border-radius:6px; background:var(--bg2)' },
        qr ? h('div', { style: 'flex:none' }, qr) : null,
        h('div', { style: 'display:flex; flex-direction:column; gap:6px; min-width:0' },
            h('div', { style: 'font-size:12px; color:var(--text-dim)' },
                'Scan with an authenticator app (Google Authenticator, Authy, 1Password, …), or enter the key manually:'),
            h('div', { style: 'font-size:12px' }, 'Key:'),
            h('div', { class: 'mono', style: 'font-size:13px; letter-spacing:1px; word-break:break-all' }, groupSecret(info.secret)),
            info.otpauthUri
                ? h('a', { href: info.otpauthUri, style: 'font-size:12px' }, 'Open in an authenticator app')
                : null));
}

async function authenticate(ctx) {
    let info;
    try {
        info = JSON.parse(ctx.primaryStatus.message || '{}');
    } catch {
        return { status: 'FAIL', message: 'Unexpected authentication challenge.' };
    }

    const enrolling = info.mode === 'enroll';
    const code = await promptCode(enrolling
        ? {
            title: 'Set up two-factor authentication',
            intro: info.prompt || 'Two-factor authentication is required for your account. Set it up now:',
            extra: enrollSetup(info),
            confirmLabel: 'Activate'
        }
        : {
            title: 'Two-factor authentication',
            intro: info.prompt || 'Enter the code from your authenticator app.',
            confirmLabel: 'Verify'
        });

    if (code == null) {
        return { status: 'FAIL', message: enrolling ? 'Setup cancelled.' : 'Cancelled.' };
    }

    // Second leg: echo the opaque challenge back with the code (base64 JSON), which
    // ctx.submit sends in the X-Mirth-Login-Data header.
    const loginData = btoa(JSON.stringify({ challenge: info.challenge, code }));
    return ctx.submit(loginData);
}

/** Registers the built-in generic OTP handler. Called at app boot (pre-login). */
export function registerBuiltinOtpAuthenticator() {
    registerLoginAuthenticator(BUILTIN_OTP, authenticate);
}
