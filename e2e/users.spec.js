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
