import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine, login } from './mock.js';

const PASSWORD = 'FirstAcceptedPassword1!';
const OTHER_PASSWORD = 'SecondAcceptedPassword2!';
const welcome = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Open Integration Engine', exact: true });
const profileField = (page: Page, label: string) => welcome(page).locator('.field', { has: page.getByText(label, { exact: true }) }).locator('input');
const passwordFields = (page: Page) => welcome(page).locator('input[type=password]');
const error = (page: Page) => page.getByRole('dialog', { name: 'Error', exact: true });
const dismissError = (page: Page) => error(page).getByRole('button', { name: 'Close', exact: true }).last().click();
const finish = (page: Page) => welcome(page).getByRole('button', { name: 'Finish', exact: true }).click();
async function fillPassword(page: Page, value = PASSWORD) {
    await passwordFields(page).nth(0).fill(value);
    await passwordFields(page).nth(1).fill(value);
}

type Stage = 'password' | 'profile' | 'preference';
async function setup(page: Page, fail: Stage | null = null, rejected = false) {
    const calls = { passwords: [] as string[], profiles: [] as any[], preferences: 0, logouts: 0 };
    const accepted = new Set<string>();
    let authed = false;
    let firstlogin = true;
    let failure = fail;
    const user = { id: 1, username: 'admin', firstName: 'Original', unknownProfileField: 'keep me' };
    const failed = (stage: Stage) => {
        if (failure !== stage) return null;
        failure = null;
        return { __status: 500, body: { message: `Failed ${stage} write` } };
    };
    await mockEngine(page, {
        'GET /users/current': () => authed ? { user } : { __status: 401 },
        'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        'POST /users/_logout': () => { authed = false; calls.logouts++; return ''; },
        'GET /users/*/preferences/firstlogin': () => String(firstlogin),
        'PUT /users/1/password': (request: any) => {
            const value = request.postData() || '';
            calls.passwords.push(value);
            const failure = failed('password');
            if (failure) return failure;
            if (rejected) { rejected = false; return { list: { string: ['Password was rejected'] } }; }
            if (accepted.has(value)) return { list: { string: ['Password was recently used'] } };
            accepted.add(value);
            return '';
        },
        'PUT /users/1': (request: any) => {
            const submitted = request.postDataJSON().user;
            calls.profiles.push(submitted);
            const failure = failed('profile');
            if (failure) return failure;
            Object.assign(user, submitted);
            return '';
        },
        'PUT /users/1/preferences/firstlogin': () => {
            calls.preferences++;
            const failure = failed('preference');
            if (failure) return failure;
            firstlogin = false;
            return '';
        },
    });
    await page.goto('/');
    await login(page);
    await expect(welcome(page)).toBeVisible();
    return { calls, failNext: (stage: Stage) => { failure = stage; } };
}

for (const stage of ['profile', 'preference'] as const) {
    test(`Welcome retries only unfinished writes after ${stage} failure`, async ({ page }) => {
        const { calls } = await setup(page, stage);
        await fillPassword(page);
        await profileField(page, 'First Name').fill('Updated');
        await finish(page);
        await expect(error(page)).toContainText(`Failed ${stage} write`);
        await dismissError(page);
        await expect(welcome(page).getByRole('status')).toContainText(stage === 'profile'
            ? 'Your password was saved.' : 'Your password and profile were saved.');
        await finish(page);
        await expect(page.locator('.shell')).toBeVisible();
        expect(calls.passwords).toEqual([PASSWORD]);
        expect(calls.profiles).toHaveLength(stage === 'profile' ? 2 : 1);
        expect(calls.profiles.at(-1)).toMatchObject({ id: 1, firstName: 'Updated', unknownProfileField: 'keep me' });
        expect(calls.preferences).toBe(stage === 'profile' ? 1 : 2);
    });
}

test('Welcome saves edited profile fields after a partial completion', async ({ page }) => {
    const { calls, failNext } = await setup(page, 'preference');
    await fillPassword(page);
    await profileField(page, 'First Name').fill('First profile');
    await finish(page);
    await dismissError(page);
    await profileField(page, 'First Name').fill('Corrected profile');
    await welcome(page).locator('textarea').fill('  Description whitespace remains  \n');
    failNext('profile');
    await finish(page);
    await dismissError(page);
    await expect(welcome(page).getByRole('status')).toHaveText('Your password was saved. Select Finish to retry the remaining changes.');
    await finish(page);
    await expect(page.locator('.shell')).toBeVisible();
    expect(calls.passwords).toEqual([PASSWORD]);
    expect(calls.profiles.map(profile => profile.firstName)).toEqual(['First profile', 'Corrected profile', 'Corrected profile']);
    expect(calls.profiles[1].description).toBe('  Description whitespace remains  \n');
});

for (const rejected of [false, true]) {
    test(`Welcome retries a password ${rejected ? 'policy rejection' : 'failed response'} without accepting a receipt`, async ({ page }) => {
        const { calls } = await setup(page, rejected ? null : 'password', rejected);
        await fillPassword(page);
        await finish(page);
        await expect(error(page)).toBeVisible();
        expect(calls.profiles).toHaveLength(0);
        expect(calls.preferences).toBe(0);
        await dismissError(page);
        await finish(page);
        await expect(page.locator('.shell')).toBeVisible();
        expect(calls.passwords).toEqual([PASSWORD, PASSWORD]);
        expect(calls.profiles).toHaveLength(1);
    });
}

test('Welcome permits an intentional new password and retains the last confirmed receipt after rejection', async ({ page }) => {
    const { calls, failNext } = await setup(page, 'profile');
    await fillPassword(page);
    await finish(page);
    await dismissError(page);
    failNext('password');
    await fillPassword(page, OTHER_PASSWORD);
    await finish(page);
    await dismissError(page);
    await fillPassword(page);
    failNext('profile');
    await finish(page);
    await dismissError(page);
    expect(calls.passwords).toEqual([PASSWORD, OTHER_PASSWORD]);
    await fillPassword(page, OTHER_PASSWORD);
    await finish(page);
    await expect(page.locator('.shell')).toBeVisible();
    expect(calls.passwords).toEqual([PASSWORD, OTHER_PASSWORD, OTHER_PASSWORD]);
});

test('Welcome serializes Finish, prevents pending dismissal and snapshots profile before awaiting', async ({ page }) => {
    const { calls } = await setup(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/users/1/password', async route => {
        await held;
        await route.fallback();
    });
    try {
        await fillPassword(page);
        await profileField(page, 'First Name').fill('Submitted');
        const button = welcome(page).getByRole('button', { name: 'Finish', exact: true });
        await button.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await expect(welcome(page)).toHaveAttribute('aria-busy', 'true');
        await page.keyboard.press('Escape');
        await expect(welcome(page)).toBeVisible();
        expect(await profileField(page, 'First Name').evaluate(input => !!input.closest('[inert]'))).toBe(true);
        await profileField(page, 'First Name').evaluate(input => { (input as HTMLInputElement).value = 'Late programmatic change'; });
        release();
        await expect(page.locator('.shell')).toBeVisible();
        expect(calls.passwords).toEqual([PASSWORD]);
        expect(calls.profiles).toHaveLength(1);
        expect(calls.profiles[0].firstName).toBe('Submitted');
    } finally { release(); }
});

test('Welcome cancellation clears password fields and a later login starts without a receipt', async ({ page }) => {
    const { calls } = await setup(page, 'profile');
    await fillPassword(page);
    await finish(page);
    await dismissError(page);
    await passwordFields(page).evaluateAll(inputs => { (window as any).closedPasswordFields = inputs; });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    expect(calls.logouts).toBe(1);
    expect(await page.evaluate(() => (window as any).closedPasswordFields.map((input: HTMLInputElement) => input.value))).toEqual(['', '']);
    await login(page);
    await expect(welcome(page)).toBeVisible();
    await fillPassword(page);
    await finish(page);
    await expect(error(page)).toContainText('Password was recently used');
    expect(calls.passwords).toEqual([PASSWORD, PASSWORD]);
});

test('Welcome reload cannot inherit an accepted-password receipt or stored plaintext', async ({ page }) => {
    const { calls } = await setup(page, 'profile');
    await fillPassword(page);
    await finish(page);
    await dismissError(page);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(PASSWORD);
    await page.reload();
    await expect(welcome(page)).toBeVisible();
    await expect(passwordFields(page).nth(0)).toHaveValue('');
    await fillPassword(page);
    await finish(page);
    await expect(error(page)).toContainText('Password was recently used');
    expect(calls.passwords).toEqual([PASSWORD, PASSWORD]);
    expect(calls.profiles).toHaveLength(1);
    expect(calls.preferences).toBe(0);
});

for (const status of [401, 421]) {
    for (const stage of ['firstlogin', 'password', 'profile', 'preference', 'scope'] as const) {
        test(`Welcome ${status} at ${stage} ends login before later writes or shell publication`, async ({ page }) => {
            const calls: string[] = [];
            let authed = false;
            const result = (name: string, ok: any = '') => {
                calls.push(name);
                return name === stage ? { __status: status } : ok;
            };
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /users/*/preferences/firstlogin': () => result('firstlogin', 'true'),
                'PUT /users/1/password': () => result('password'),
                'PUT /users/1': () => result('profile'),
                'PUT /users/1/preferences/firstlogin': () => result('preference'),
                'GET /server/id': () => result('scope', 'scoped-engine'),
                'POST /users/_logout': () => { calls.push('logout'); return ''; },
            });
            await page.goto('/');
            await login(page);
            if (stage !== 'firstlogin') { await fillPassword(page); await finish(page); }
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
            await expect(welcome(page)).toHaveCount(0);
            await expect(page.locator('.shell')).toHaveCount(0);
            expect(calls).toEqual(['firstlogin', 'password', 'profile', 'preference', 'scope'].slice(0,
                ['firstlogin', 'password', 'profile', 'preference', 'scope'].indexOf(stage) + 1));
            expect(await page.evaluate(async () => (await import(String('/core/store.js'))).scopedKey('probe'))).not.toContain('scoped-engine');
        });
    }
}

test('Welcome re-arms session expiry for consecutive authenticated attempts', async ({ page }) => {
    let authed = false;
    let attempts = 0;
    await mockEngine(page, {
        'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
        'POST /users/_login': () => { authed = true; attempts++; return { status: 'SUCCESS' }; },
        'GET /users/*/preferences/firstlogin': { __status: 401 },
    });
    await page.goto('/');
    for (let i = 0; i < 2; i++) {
        await login(page);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
        await expect(page.locator('.shell')).toHaveCount(0);
    }
    expect(attempts).toBe(2);
});

for (const status of [401, 421]) {
    for (const readFails of [false, true]) {
        test(`Welcome ${status} during pending firstlogin ${readFails ? 'failure' : 'success'} cannot open a stale wizard`, async ({ page }) => {
            let authed = false;
            let waiting = false;
            let writes = 0;
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /users/*/preferences/firstlogin': async () => {
                    waiting = true;
                    await held;
                    return readFails ? { __status: 500 } : 'true';
                },
                'GET /server/test-expiry': { __status: status },
                'PUT /users/1/password': () => { writes++; return ''; },
                'PUT /users/1': () => { writes++; return ''; },
                'PUT /users/1/preferences/firstlogin': () => { writes++; return ''; },
                'POST /users/_logout': () => { writes++; return ''; },
            });
            try {
                await page.goto('/');
                await login(page);
                await expect.poll(() => waiting).toBe(true);
                await page.evaluate(async () => {
                    const api = await import('@oie/web-api');
                    await api.default.get('/server/test-expiry').catch(() => {});
                });
                release();
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
                await expect(welcome(page)).toHaveCount(0);
                await expect(page.locator('.shell')).toHaveCount(0);
                expect(writes).toBe(0);
            } finally { release(); }
        });
    }
}

for (const stage of ['firstlogin', 'password', 'profile', 'preference', 'scope'] as const) {
    test(`Welcome engine/account replacement during ${stage} cannot continue the old login`, async ({ page }) => {
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const calls: string[] = [];
        let who = 0;
        let waiting = false;
        const result = async (name: string, ok: any = '') => {
            calls.push(name);
            if (name === stage) { waiting = true; await held; }
            return ok;
        };
        await mockEngine(page, {
            'GET /users/current': () => who ? { user: { id: who, username: who === 1 ? 'admin' : 'replacement' } } : { __status: 401 },
            'POST /users/_login': () => { who = 1; return { status: 'SUCCESS' }; },
            'GET /users/1/preferences/firstlogin': () => result('firstlogin', 'true'),
            'GET /users/2/preferences/firstlogin': 'false',
            'PUT /users/1/password': () => result('password'),
            'PUT /users/1': () => result('profile'),
            'PUT /users/1/preferences/firstlogin': () => result('preference'),
            'GET /server/id': () => who === 1 ? result('scope', 'old-engine') : 'replacement-engine',
            'POST /users/_logout': () => { calls.push('logout'); return ''; },
        });
        try {
            await page.goto('/');
            await login(page);
            if (stage !== 'firstlogin') { await fillPassword(page); await finish(page); }
            await expect.poll(() => waiting).toBe(true);
            who = 2;
            await page.context().addCookies([{ name: 'oie-engine', value: 'k:replacement', url: page.url() }]);
            release();
            await expect(page.locator('.statusbar')).toContainText('as replacement');
            expect(calls).toEqual(['firstlogin', 'password', 'profile', 'preference', 'scope'].slice(0,
                ['firstlogin', 'password', 'profile', 'preference', 'scope'].indexOf(stage) + 1));
            expect(await page.evaluate(async () => (await import(String('/core/store.js'))).scopedKey('probe'))).toBe('probe:replacement-engine:2');
        } finally { release(); }
    });
}

test('Welcome expiry closes an in-flight password dialog and discards its late continuation', async ({ page }) => {
    const { calls } = await setup(page);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let waiting = false;
    await page.route('**/api/users/1/password', async route => {
        waiting = true;
        await held;
        await route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/server/test-expiry', route => route.fulfill({ status: 401, body: '' }));
    try {
        await fillPassword(page);
        await finish(page);
        await expect.poll(() => waiting).toBe(true);
        await page.evaluate(async () => {
            const api = await import('@oie/web-api');
            await api.default.get('/server/test-expiry').catch(() => {});
        });
        await expect(welcome(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
        const response = page.waitForResponse(response => response.url().endsWith('/users/1/password'));
        release();
        await response;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(calls.profiles).toHaveLength(0);
        expect(calls.preferences).toBe(0);
        expect(calls.logouts).toBe(0);
        await expect(page.locator('.shell')).toHaveCount(0);
        await expect(page.getByText('Welcome — your account is ready')).toHaveCount(0);
    } finally { release(); }
});
