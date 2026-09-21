import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

async function newUser(page: any) {
    await page.goto('/users');
    await page.getByRole('button', { name: 'New User', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New User', exact: true });
    await dialog.locator('input[type=text]').first().fill('partial-user');
    await dialog.locator('input[type=password]').nth(0).fill('SyntheticPassw0rd!');
    await dialog.locator('input[type=password]').nth(1).fill('SyntheticPassw0rd!');
    return dialog;
}

for (const failure of ['password request', 'password policy']) {
    test(`F17: resume after ${failure} failure without creating again`, async ({ page }) => {
        let creates = 0, passwords = 0, failed = false;
        await mockEngine(page, {
            'POST /users/_checkPassword': '',
            'POST /users': () => { creates++; return ''; },
            'GET /users': () => {
                if (!creates) return { list: { user: [] } };
                return { list: { user: [{ id: 42, username: 'partial-user' }] } };
            },
            'PUT /users/42/password': () => {
                passwords++;
                if (!failed) {
                    failed = true;
                    return failure === 'password request' ? { __status: 503, body: 'password failed' }
                        : { list: { string: ['Password policy changed'] } };
                }
                return '';
            },
        });
        const dialog = await newUser(page);
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toBeVisible();
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(dialog.getByRole('status')).toContainText('Password setup is incomplete');
        await expect(page.getByRole('cell', { name: 'partial-user', exact: true, includeHidden: true })).toHaveCount(1);
        expect(creates).toBe(1);
        await dialog.getByRole('button', { name: 'Retry Password Setup', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(creates).toBe(1);
        expect(passwords).toBe(2);
    });
}

test('F17: duplicate clicks submit one create and an unknown outcome cannot be retried', async ({ page }) => {
    let creates = 0, passwords = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, { 'POST /users/_checkPassword': '', 'PUT /users/*/password': () => { passwords++; return ''; } });
    await page.route('**/api/users', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        creates++;
        await gate;
        await route.abort('failed');
    });
    const dialog = await newUser(page);
    await dialog.getByRole('button', { name: 'Create', exact: true }).evaluate((button: HTMLButtonElement) => {
        (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
    });
    await expect.poll(() => creates).toBe(1);
    await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
    release();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(dialog.getByRole('status')).toContainText('could not be confirmed');
    await expect(dialog.getByRole('button', { name: 'Outcome Unknown', exact: true })).toBeDisabled();
    expect(creates).toBe(1);
    expect(passwords).toBe(0);
});

for (const lookup of ['failure', 'missing']) {
    test(`F17: ${lookup} account lookup cannot retry against a replacement username`, async ({ page }) => {
        let creates = 0, passwords = 0, replaced = false;
        await mockEngine(page, {
            'POST /users/_checkPassword': '',
            'POST /users': () => { creates++; return ''; },
            'GET /users': () => !creates ? { list: { user: [] } } : replaced
                ? { list: { user: [{ id: 99, username: 'partial-user' }] } }
                : lookup === 'failure' ? { __status: 503, body: 'lookup failed' } : { list: { user: [] } },
            'PUT /users/*/password': () => { passwords++; return ''; },
        });
        const dialog = await newUser(page);
        await dialog.getByRole('button', { name: 'Create', exact: true }).click();
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toBeVisible();
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        replaced = true;
        await expect(dialog.getByRole('status')).toContainText('identity could not be verified');
        const verify = dialog.getByRole('button', { name: 'Verify Account', exact: true });
        await expect(verify).toBeDisabled();
        await verify.evaluate((button: HTMLButtonElement) => (button as HTMLButtonElement).click());
        await expect(dialog.getByRole('button', { name: 'Retry Password Setup', exact: true })).toHaveCount(0);
        expect(creates).toBe(1);
        expect(passwords).toBe(0);
    });
}

test('F17: a verified password retry stays bound to its original account ID', async ({ page }) => {
    let created = false, replaced = false;
    const writes: string[] = [];
    await mockEngine(page, {
        'POST /users/_checkPassword': '',
        'POST /users': () => { created = true; return ''; },
        'GET /users': () => ({ list: { user: created ? [{ id: replaced ? 99 : 42, username: 'partial-user' }] : [] } }),
        'PUT /users/*/password': (req: any) => {
            writes.push(new URL(req.url()).pathname);
            return { __status: replaced ? 404 : 503, body: 'Password setup failed' };
        },
    });
    const dialog = await newUser(page);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toBeVisible();
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    replaced = true;
    await dialog.getByRole('button', { name: 'Retry Password Setup', exact: true }).click();
    await expect(error).toBeVisible();
    expect(writes).toEqual(['/api/users/42/password', '/api/users/42/password']);
});
