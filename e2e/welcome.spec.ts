import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

/*
 * First-login "Welcome" wizard (Swing FirstLoginDialog parity). It appears after
 * a successful login when the engine's "firstlogin" user preference is unset or
 * truthy, and clears that flag on Finish. See client/react/welcome.js.
 */
test.describe('first-login welcome wizard', () => {
    test('prompts for password + profile on first login, then clears the flag', async ({ page }) => {
        let authed = false;
        let firstloginCleared = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            // New user: firstlogin not yet completed → wizard should show.
            'GET /users/*/preferences/firstlogin': 'true',
            'PUT /users/*/preferences/firstlogin': () => { firstloginCleared = true; return ''; },
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        // The welcome modal blocks the shell until completed.
        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.shell')).toHaveCount(0);

        const pw = dialog.locator('input[type=password]');
        await pw.nth(0).fill('S3cretPass!');
        await pw.nth(1).fill('S3cretPass!');
        await dialog.getByRole('button', { name: 'Finish' }).click();

        // Modal closes, flag cleared, shell mounts.
        await expect(page.locator('.modal')).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Demo Started')).toBeVisible({ timeout: 15_000 });
        expect(firstloginCleared).toBe(true);
    });

    test('mismatched passwords keep the wizard open', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': 'true',
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        const pw = dialog.locator('input[type=password]');
        await pw.nth(0).fill('S3cretPass!');
        await pw.nth(1).fill('different');
        await dialog.getByRole('button', { name: 'Finish' }).click();

        await expect(page.getByText('Passwords do not match')).toBeVisible({ timeout: 15_000 });
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible();
    });

    test('no wizard once first-login is complete', async ({ page }) => {
        let authed = false;
        await mockEngine(page, {
            'GET /users/current': () => (authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 }),
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': 'false',
        });

        await page.goto('/');
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
        await login(page, 'admin', 'admin');

        // Straight into the shell, no welcome modal.
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Welcome to Open Integration Engine')).toHaveCount(0);
    });
});

test.describe('first-login welcome after a same-tab sign-in (issue #75)', () => {
    async function signOutThenInAsNewUser(page: any, firstloginPuts: string[]) {
        let who: string | null = null;
        await mockEngine(page, {
            'GET /users/current': () => (who ? { user: { id: who === 'admin' ? 1 : 2, username: who } } : { __status: 401 }),
            'POST /users/_login': (req: any) => { who = new URLSearchParams(req.postData() || '').get('username'); return { status: 'SUCCESS' }; },
            'POST /users/_logout': () => { who = null; return ''; },
            'GET /users/*/preferences/firstlogin': (req: any) => (new URL(req.url()).pathname.includes('/users/2/') ? 'true' : 'false'),
            'PUT /users/*/password': '',
            'PUT /users/*': '',
            'PUT /users/*/preferences/firstlogin': (req: any) => { firstloginPuts.push(new URL(req.url()).pathname); return ''; },
        });
        await page.goto('/');
        await login(page, 'admin', 'admin');
        await expect(page.locator('.statusbar')).toContainText('as admin');
        await expect.poll(() => page.evaluate(() => sessionStorage.getItem('oie-loaded-user'))).toBe('admin');
        await page.getByRole('button', { name: 'Logout', exact: true }).click();
        await expect(page.locator('input[type=password]')).toBeVisible();
        await login(page, 'newuser', 'temp');
    }

    test('the welcome wizard still appears after the sign-in reload', async ({ page }) => {
        const puts: string[] = [];
        await signOutThenInAsNewUser(page, puts);
        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        const pw = dialog.locator('input[type=password]');
        await pw.nth(0).fill('N3wPassword!');
        await pw.nth(1).fill('N3wPassword!');
        await dialog.getByRole('button', { name: 'Finish' }).click();
        await expect(page.locator('.statusbar')).toContainText('as newuser', { timeout: 15_000 });
        expect(puts).toEqual(['/api/users/2/preferences/firstlogin']);
    });

    test('a reload during the wizard shows it again', async ({ page }) => {
        await signOutThenInAsNewUser(page, []);
        await expect(page.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        await page.reload();
        await expect(page.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.shell')).toHaveCount(0);
    });

    test('closing the wizard without finishing signs the user out', async ({ page }) => {
        await signOutThenInAsNewUser(page, []);
        const dialog = page.locator('.modal');
        await expect(dialog.getByText('Welcome to Open Integration Engine')).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Escape');
        await expect(page.getByText('Sign-in canceled — set a new password to continue.')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    });
});
