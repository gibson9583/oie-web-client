import { test, expect } from '@playwright/test';
import { mockEngine, login } from './mock.js';

test.describe('login', () => {
    test('a grace-period login offers the change-password dialog', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS_GRACE_PERIOD', message: 'Your password expires in 3 days.' }; },
        });

        await page.goto('/');
        await login(page, 'admin', 'admin');

        // Login succeeded (grace = success) AND the engine's message is surfaced
        // with the offer to change the password now.
        await expect(page.getByText('Your password expires in 3 days.')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Change Password' })).toBeVisible();

        // Accepting opens the change-password modal for the signed-in user.
        await page.getByRole('button', { name: 'Change Password' }).click();
        await expect(page.getByText('Change Password — admin')).toBeVisible();
    });

    test('an MFA login with no matching web authenticator shows a clear message', async ({ page }) => {
        // The engine returns an ExtendedLoginStatus: a non-success status naming a
        // clientPluginClass (a Java MFA plugin). No web authenticator is bundled for
        // it, so the web admin must say so clearly rather than "login failed".
        await mockEngine(page, {
            'GET /users/current': { __status: 401 },
            'POST /users/_login': {
                // XStream would key this under the ExtendedLoginStatus FQCN; the
                // client unwraps the single root key, so the fields sit at top level.
                status: 'FAIL',
                message: 'Enter your authentication code.',
                clientPluginClass: 'com.acme.mirth.totp.TotpAuthenticationClientPlugin'
            }
        });

        await page.goto('/');
        await login(page, 'admin', 'admin');

        await expect(page.getByText(/multi-factor login method that is not available/i)).toBeVisible();
        // Still on the login screen (no session established).
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });

    test('TOTP self-enrollment on first login, then reaches the dashboard', async ({ page }) => {
        // Leg 1 (no login-data header) returns an ExtendedLoginStatus in ENROLL mode;
        // leg 2 (the header present, carrying challenge+code) succeeds. The bundled
        // TOTP authenticator drives the modal between them.
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': (req) => {
                const hasFactor = !!req.headers()['x-mirth-login-data'];
                if (!hasFactor) {
                    // The real engine returns the MFA challenge with HTTP 401 — the
                    // client must read the body anyway, not treat it as a plain error.
                    return { __status: 401, body: { 'com.mirth.connect.model.ExtendedLoginStatus': {
                        status: 'FAIL',
                        updatedUsername: 'admin',
                        clientPluginClass: 'builtin:otp',
                        message: JSON.stringify({
                            mode: 'enroll',
                            challenge: 'signed-token',
                            secret: 'JBSWY3DPEHPK3PXP',
                            otpauthUri: 'otpauth://totp/OIE:admin?secret=JBSWY3DPEHPK3PXP&issuer=OIE'
                        })
                    } } };
                }
                authed = true;
                return { status: 'SUCCESS' };
            }
        });

        await page.goto('/');
        await login(page, 'admin', 'admin');

        // The self-enroll modal appears with the key to add.
        await expect(page.getByText('Set up two-factor authentication')).toBeVisible();
        await expect(page.getByText(/JBSW Y3DP/)).toBeVisible();   // grouped secret

        // Enter a code and activate → second-leg login succeeds → dashboard.
        await page.locator('input[inputmode="numeric"]').fill('123456');
        await page.getByRole('button', { name: 'Activate' }).click();

        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });
    });

    test('signs in and reaches the dashboard', async ({ page }) => {
        // current → 401 until login succeeds, so the login screen shows first.
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

        await login(page, 'admin', 'admin');

        // Booted into the shell with the dashboard's channel rows. Generous
        // timeout: the login→shell transition (register views + load plugins) can
        // be slow under parallel-worker contention on the shared dev server.
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });
    });

    test('shows an error on bad credentials', async ({ page }) => {
        await mockEngine(page, {
            'GET /users/current': { __status: 401 },
            'POST /users/_login': { status: 'FAIL' },
        });

        await page.goto('/');
        // Wait for the login form to render before interacting (the auth gate
        // resolves api.auth.current() before showing it).
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'wrong');

        await expect(page.getByText('Invalid username or password.')).toBeVisible({ timeout: 15_000 });
        // Still on the login screen.
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
});

// A session that dies mid-use drops you back to the login screen. The reason has to
// arrive as text under the card — it used to come through toast(msg,'warn'), which
// routes to detailModal, so a blocking dialog covered the form and had to be
// dismissed before you could type your password.
test('an expired session explains itself below the login box, not in a dialog', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    // Booting the app costs the bundle plus the plugin loads, which can outrun the
    // default 5s on a loaded machine — and this test is about the notice, not boot
    // speed. Same budget the engine-picker specs give the same assertion.
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });

    // Every subsequent call 401s: the app treats that as the session expiring.
    await mockEngine(page, {
        'GET /users/current': { __status: 401 },
        'GET /channels/statuses': { __status: 401 },
        'GET /server/status': { __status: 401 },
    });
    /* Any engine call will do; Refresh is the explicit one. This used to lean on the
       dashboard's background poll, which meant the test was quietly racing the
       user's refresh-interval preference — it fires on that cadence (20s by
       default), not on a fixed timer this spec can rely on. */
    await page.getByRole('button', { name: 'Refresh' }).first().click();

    // Back at the login form, with the reason inline and nothing to dismiss.
    await expect(page.locator('form.login-card, .login-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.login-notice')).toContainText(/session expired/i);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    /* The card animates in (login-in, 0.4s, translateY(16px)), so measure only once
       it has landed — mid-flight the card still sits low and the notice reads as
       being above it. This spec used to get the wait for free by waiting on a
       background poll; nothing should depend on that accident. */
    await page.locator('.login-card').evaluate(
        (el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    // BELOW the card, not beside it: .login-stage is a centering flex row, so a bare
    // sibling of the form lands next to it — the geometry is the actual requirement.
    const card = await page.locator('.login-card').boundingBox();
    const note = await page.locator('.login-notice').boundingBox();
    expect(note.y).toBeGreaterThan(card.y + card.height - 1);
    const cardMid = card.x + card.width / 2;
    const noteMid = note.x + note.width / 2;
    expect(Math.abs(cardMid - noteMid)).toBeLessThan(12);

    // It is announced, not thrown at you, and typing clears it.
    await expect(page.locator('.login-notice')).toHaveAttribute('role', 'status');
    await page.getByPlaceholder('admin').fill('admin');
    await page.locator('input[type=password]').fill('admin');
    await mockEngine(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Wait for the shell rather than for the notice to vanish: a poll that was
    // already in flight can still be settling, and "the form is gone" is the
    // deterministic end state that proves the notice went with it.
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.login-notice')).toHaveCount(0);
});
