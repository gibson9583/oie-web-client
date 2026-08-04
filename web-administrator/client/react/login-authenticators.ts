/*
 * Login authenticators (MFA), registered at app boot — BEFORE the login screen,
 * because multi-factor login runs before a session exists (see core/login-auth.js).
 *
 * The host ships a built-in GENERIC OTP authenticator: any server-side MFA plugin
 * (TOTP/HOTP/one-time-code) that returns the well-known clientPluginClass
 * `builtin:otp` works with NO bundled web code — the built-in renders the standard
 * enroll/verify UI (see core/otp-auth.js). Install the engine plugin and it just
 * works; nothing to rebuild here.
 *
 * A method that needs custom UI (WebAuthn, push) bundles its own authenticator and
 * registers it here via registerLoginAuthenticator(clientPluginClass, authenticate)
 * (see core/login-auth.js), keyed to whatever clientPluginClass its server returns.
 */

import { registerBuiltinOtpAuthenticator } from '../core/otp-auth.js';

export function registerLoginAuthenticators() {
    registerBuiltinOtpAuthenticator();
    // Custom (non-OTP) MFA authenticators register here.
}
