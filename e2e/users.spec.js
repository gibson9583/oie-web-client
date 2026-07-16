import { test, expect } from '@playwright/test';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

// Users is the first view ported to React (DataTableHost + portaled task pane).
test('Users view lists users and gates task actions on selection', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await expect(page).toHaveURL(/\/users/);

    // Rows render through the React-hosted DataTable.
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Erator', exact: true })).toBeVisible();

    // The (portaled) task pane shows the always-on actions.
    await expect(page.getByRole('button', { name: 'New User' })).toBeVisible();

    // Selection-gated actions are hidden until a row is selected, then appear.
    await expect(page.getByRole('button', { name: 'Edit User' })).toHaveCount(0);
    await page.locator('tr', { hasText: 'operator' }).first().click();
    await expect(page.getByRole('button', { name: 'Edit User' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete User' })).toBeVisible();
});

async function openNewUser(page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.getByRole('button', { name: 'New User' }).click();
}

test('New User is blocked (and not created) when the password violates the policy', async ({ page }) => {
    let createPosted = false;
    await mockEngine(page, {
        // The engine's check-only endpoint returns policy violations.
        'POST /users/_checkPassword': { string: ['Password is too short. Minimum length is 8 characters'] },
    });
    page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/users') createPosted = true;
    });

    await openNewUser(page);
    await page.locator('.modal input[type=text]').first().fill('newguy');
    const pw = page.locator('.modal input[type=password]');
    await pw.nth(0).fill('weak');
    await pw.nth(1).fill('weak');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Blocked: the violation is surfaced, the user is NOT created, modal stays open.
    await expect(page.getByText(/Password rejected/i)).toBeVisible();
    expect(createPosted).toBe(false);
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeVisible();
});

test('New User dialog shows the configured password requirements', async ({ page }) => {
    await mockEngine(page, {
        'GET /server/passwordRequirements': { minLength: 8, minUpper: 1, minLower: 0, minNumeric: 1, minSpecial: 0 },
    });
    await openNewUser(page);
    await expect(page.getByText(/at least 8 characters, 1 uppercase letter, 1 number/i)).toBeVisible();
});

test('New User dialog marks the mandatory fields (Username, Password, Confirm) like Swing', async ({ page }) => {
    await mockEngine(page);
    await openNewUser(page);
    const modal = page.locator('.modal');
    // Exactly three required-asterisk markers: Username, Password, Confirm Password
    // (the optional profile fields — First/Last Name, Email, Organization, Phone —
    // carry none, matching Swing's allRequired=false for the New User dialog).
    await expect(modal.getByText('*', { exact: true })).toHaveCount(3);
    // Username specifically is marked (it's the only always-required profile field).
    await expect(modal.locator('.field', { hasText: 'Username' }).getByText('*', { exact: true })).toBeVisible();
});

async function openEditUser(page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.locator('tr', { hasText: 'operator' }).first().click();
    await page.getByRole('button', { name: 'Edit User' }).click();
}

test('Edit User exposes an optional password section (no required-asterisk on it)', async ({ page }) => {
    await mockEngine(page);
    await openEditUser(page);
    const modal = page.locator('.modal');
    // The password pair is present (reusing the New User form)…
    await expect(modal.locator('input[type=password]')).toHaveCount(2);
    // …but it's optional: only Username carries the required-asterisk here.
    await expect(modal.getByText('*', { exact: true })).toHaveCount(1);
    await expect(modal.getByText(/Leave blank to keep the current password/i)).toBeVisible();
});

test('Edit User leaves the password untouched when the fields are blank', async ({ page }) => {
    await mockEngine(page);
    let pwPut = false, userPut = false;
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (r.method() === 'PUT' && /^\/api\/users\/\d+\/password$/.test(p)) pwPut = true;
        if (r.method() === 'PUT' && /^\/api\/users\/\d+$/.test(p)) userPut = true;
    });

    await openEditUser(page);
    // Change a profile field, leave both password inputs blank.
    await page.locator('.modal .field', { hasText: 'Organization' }).locator('input').fill('Acme');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.locator('.modal')).toHaveCount(0);
    expect(userPut).toBe(true);   // profile saved
    expect(pwPut).toBe(false);    // password NOT reset
});

test('Edit User resets the password: policy-checked, then written', async ({ page }) => {
    await mockEngine(page);
    let checked = false, pwPut = false;
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (r.method() === 'POST' && p === '/api/users/_checkPassword') checked = true;
        if (r.method() === 'PUT' && /^\/api\/users\/\d+\/password$/.test(p)) pwPut = true;
    });

    await openEditUser(page);
    const pw = page.locator('.modal input[type=password]');
    await pw.nth(0).fill('NewPassw0rd!');
    await pw.nth(1).fill('NewPassw0rd!');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.locator('.modal')).toHaveCount(0);
    expect(checked).toBe(true);   // policy enforced up front
    expect(pwPut).toBe(true);     // then the new password is written
});

test('Edit User blocks a policy-violating password reset (nothing written)', async ({ page }) => {
    await mockEngine(page, {
        'POST /users/_checkPassword': { string: ['Password is too short. Minimum length is 8 characters'] },
    });
    let pwPut = false;
    page.on('request', (r) => {
        const p = new URL(r.url()).pathname;
        if (r.method() === 'PUT' && /^\/api\/users\/\d+\/password$/.test(p)) pwPut = true;
    });

    await openEditUser(page);
    const pw = page.locator('.modal input[type=password]');
    await pw.nth(0).fill('weak');
    await pw.nth(1).fill('weak');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Blocked: violation surfaced, password never written, modal stays open.
    await expect(page.getByText(/Password rejected/i)).toBeVisible();
    expect(pwPut).toBe(false);
    await expect(page.locator('.modal')).toHaveCount(1);
});
