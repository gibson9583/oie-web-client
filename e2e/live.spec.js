import { test, expect } from '@playwright/test';
import { login } from './mock.js';

/*
 * Opt-in smoke test against a REAL engine — runs only with E2E_LIVE=1, which
 * registers the `live` project (see playwright.config.js). No mocking: it drives
 * the actual engine through the web admin proxy. Start /oie + the web admin
 * first; see e2e/README.md. Credentials via E2E_USER / E2E_PASS (default admin).
 *
 * This is intentionally minimal — the can is kicked: flesh out real CRUD/deploy
 * flows here when you want higher-fidelity coverage.
 */
test('logs in against a live engine and reaches the dashboard', async ({ page }) => {
    const user = process.env.E2E_USER || 'admin';
    const pass = process.env.E2E_PASS || 'admin';

    await page.goto('/');
    // A prior session may already be active — only log in if prompted.
    const needsLogin = await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false);
    if (needsLogin) await login(page, user, pass);

    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
});
