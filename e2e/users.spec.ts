import { test, expect } from './base.js';
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

async function openNewUser(page: any) {
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
    await expect(page.getByText(/Your password is not valid\. Please fix the following:/)).toBeVisible();
    expect(createPosted).toBe(false);
    /* Dismiss the rejection first: while it is up it is a modal OVER the New User
       modal, so the dialog beneath is aria-hidden and genuinely not in the role
       tree. Acknowledging it is also the real flow — then Create is still there
       to try again with. */
    await page.keyboard.press('Escape');
    await expect(page.getByText(/Your password is not valid/)).toHaveCount(0);
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

async function openEditUser(page: any) {
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

test('Edit User resets the password through the engine policy, like Swing', async ({ page }) => {
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
    expect(checked).toBe(false);  // Swing has no preflight for an existing user
    expect(pwPut).toBe(true);     // updateUserPassword applies the policy itself
});

test('Edit User blocks a policy-violating password reset (profile not saved)', async ({ page }) => {
    let profiles = 0;
    await mockEngine(page, {
        'PUT /users/2': () => { profiles++; return ''; },
        'PUT /users/2/password': { list: { string: ['Password is too short. Minimum length is 8 characters'] } },
    });

    await openEditUser(page);
    const pw = page.locator('.modal input[type=password]');
    await pw.nth(0).fill('weak');
    await pw.nth(1).fill('weak');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Blocked: violation surfaced in an error dialog, password never written, and
    // the Edit User modal stays open (its two password fields remain) so the user
    // can correct and retry.
    await expect(page.getByText(/Your password is not valid\. Please fix the following:/)).toBeVisible();
    await expect(page.getByText(/- Password is too short\. Minimum length is 8 characters/)).toBeVisible();
    expect(profiles).toBe(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal input[type=password]')).toHaveCount(2);
});

test('Edit User saves the password before the profile and retries cleanly', async ({ page }) => {
    let profiles = 0;
    let passwords = 0;
    await mockEngine(page, {
        'PUT /users/2': () => { profiles++; return ''; },
        'PUT /users/2/password': () => ++passwords === 1 ? { list: { string: ['Password was already used'] } } : { list: [] },
    });
    await openEditUser(page);
    const dialog = page.getByRole('dialog', { name: /Edit User/ });
    const fields = dialog.locator('input[type=password]');
    await fields.nth(0).fill('AcceptedByPreflight!');
    await fields.nth(1).fill('AcceptedByPreflight!');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/ - Password was already used/)).toBeVisible();
    await page.getByRole('dialog', { name: 'Error' }).getByRole('button', { name: 'Close', exact: true }).last().click();
    expect(profiles).toBe(0);
    await fields.nth(0).fill('CorrectedPassword!');
    await fields.nth(1).fill('CorrectedPassword!');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(profiles).toBe(1);
    expect(passwords).toBe(2);
});

test('Save and Create stay disabled until the required fields are filled, like Swing', async ({ page }) => {
    await mockEngine(page);
    await openNewUser(page);
    const create = page.getByRole('button', { name: 'Create', exact: true });
    await expect(create).toBeDisabled();
    await page.locator('.modal input[type=text]').first().fill('newguy');
    await expect(create).toBeDisabled();
    const pw = page.locator('.modal input[type=password]');
    await pw.nth(0).fill('Passw0rd!');
    await expect(create).toBeDisabled();
    await pw.nth(1).fill('Passw0rd!');
    await expect(create).toBeEnabled();
    await page.locator('.modal input[type=text]').first().fill('');
    await expect(create).toBeDisabled();
});

test('renaming your own account requires a new password, like Swing', async ({ page }) => {
    let profiles = 0;
    await mockEngine(page, { 'PUT /users/1': () => { profiles++; return ''; } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.locator('tr', { hasText: 'admin' }).first().click();
    await page.getByRole('button', { name: 'Edit User' }).click();
    const dialog = page.getByRole('dialog', { name: /Edit User/ });
    await dialog.locator('input[type=text]').first().fill('renamed-admin');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('If you are changing your username, you must also update your password.')).toBeVisible();
    expect(profiles).toBe(0);
});

test('New User dialog includes the extended profile fields (country/role/business/description)', async ({ page }) => {
    await mockEngine(page);
    await openNewUser(page);
    const modal = page.locator('.modal');
    for (const label of ['Country', 'Role', 'Business', 'Description']) {
        await expect(modal.getByText(label, { exact: true })).toBeVisible();
    }
});

// Cold deep link. Every other test in this file reaches Users by clicking the
// nav item on an already-booted shell (page.goto('/') then the Users button),
// which cannot catch a view module that fails to load on demand — the shell is
// warm by then. Only page.goto('/users') exercises the view's first load.
test('a cold deep link to /users boots straight into the Users view', async ({ page }) => {
    await page.goto('/users');

    // Rows come from GET /users (SAMPLE_USERS) through useUsers -> DataTableHost.
    await expect(page.getByRole('cell', { name: 'operator', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('cell', { name: 'op@example.com', exact: true })).toBeVisible();

    // The Users COLUMN SET is unique to this view — no other view renders all of
    // Organization + Phone + Last Login, so these headers can only come from
    // users.jsx's COLUMNS.
    await expect(page.getByRole('columnheader', { name: 'Organization', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Phone', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Last Login', exact: true })).toBeVisible();

    // The view portals its own task pane into the rail (<ViewTasks>); the shell
    // never renders it and the not-found fallback renders no pane at all.
    await expect(page.locator('.rail-pane', { hasText: 'User Tasks' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New User', exact: true })).toBeVisible();

    // Explicitly not the router's not-found view.
    await expect(page.getByText('View not found')).toHaveCount(0);

    await expect(page).toHaveURL(/\/users$/);
    expect(page.url()).not.toContain('#');
});
