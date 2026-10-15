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
    return {
        calls,
        failNext: (stage: Stage) => { failure = stage; },
        rejectNextPassword: () => { rejected = true; },
    };
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

test('Welcome permits an intentional new password and retains the last confirmed receipt after policy rejection', async ({ page }) => {
    const { calls, failNext, rejectNextPassword } = await setup(page, 'profile');
    await fillPassword(page);
    await finish(page);
    await dismissError(page);
    rejectNextPassword();
    await fillPassword(page, OTHER_PASSWORD);
    await finish(page);
    await expect(error(page)).toContainText('Password was rejected');
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

for (const scenario of [
    { name: 'retries the selected password after a replacement password response is lost', commit: true, history: false },
    { name: 'blocks stale password completion after a lost response and recovers with a new password', commit: true, history: true },
    { name: 'conservatively retries after a replacement password connection fails before commit', commit: false, history: false },
]) {
    test(`Welcome ${scenario.name}`, async ({ page }) => {
        let authed = false;
        let upstreamPassword = 'OriginalPassword';
        let profileWrites = 0;
        let preferenceWrites = 0;
        const passwordWrites: string[] = [];
        const accepted = new Set<string>();
        const rejectedPassword = 'PolicyRejectedPassword3!';
        await mockEngine(page, {
            'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': 'true',
            'PUT /users/1': () => ++profileWrites === 1 ? { __status: 500, body: { message: 'Profile write failed' } } : '',
            'PUT /users/1/preferences/firstlogin': () => { preferenceWrites++; return ''; },
        });
        await page.route('**/api/users/1/password', async route => {
            const value = route.request().postData() || '';
            passwordWrites.push(value);
            if (value === rejectedPassword) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { string: ['Password violates policy'] } }) });
            }
            if (scenario.history && accepted.has(value)) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list: { string: ['Password was recently used'] } }) });
            }
            // A connection failure is ambiguous: it can occur either before or
            // after the engine accepts the replacement password.
            if (value !== OTHER_PASSWORD || scenario.commit) {
                upstreamPassword = value;
                accepted.add(value);
            }
            if (value === OTHER_PASSWORD) return route.abort('connectionreset');
            await route.fulfill({ status: 200, body: '' });
        });
        await page.goto('/');
        await login(page);
        await fillPassword(page);
        await finish(page);
        await dismissError(page);
        await fillPassword(page, OTHER_PASSWORD);
        await finish(page);
        await dismissError(page);
        if (scenario.history) {
            // Neither a history rejection of B nor a definite rejection of C
            // can resurrect the old receipt for A after B's ambiguous result.
            for (const [value, message] of [
                [OTHER_PASSWORD, 'Password was recently used'],
                [rejectedPassword, 'Password violates policy'],
            ]) {
                await fillPassword(page, value);
                await finish(page);
                await expect(error(page)).toContainText(message);
                await expect(page.locator('.shell')).toHaveCount(0);
                expect(profileWrites).toBe(1);
                expect(preferenceWrites).toBe(0);
                await dismissError(page);
            }
        }
        await fillPassword(page);
        await finish(page);
        if (scenario.history) {
            await expect(error(page)).toContainText('Password was recently used');
            await expect(page.locator('.shell')).toHaveCount(0);
            expect(profileWrites).toBe(1);
            expect(preferenceWrites).toBe(0);
            expect(upstreamPassword).toBe(OTHER_PASSWORD);
            expect(passwordWrites).toEqual([PASSWORD, OTHER_PASSWORD, OTHER_PASSWORD, rejectedPassword, PASSWORD]);
            await dismissError(page);
            const recoveryPassword = 'FreshRecoveryPassword4!';
            await fillPassword(page, recoveryPassword);
            await finish(page);
            await expect(page.locator('.shell')).toBeVisible();
            expect(upstreamPassword).toBe(recoveryPassword);
            expect(passwordWrites).toEqual([PASSWORD, OTHER_PASSWORD, OTHER_PASSWORD, rejectedPassword, PASSWORD, recoveryPassword]);
        } else {
            await expect(page.locator('.shell')).toBeVisible();
            expect(upstreamPassword).toBe(PASSWORD);
            expect(passwordWrites).toEqual([PASSWORD, OTHER_PASSWORD, PASSWORD]);
        }
        expect(profileWrites).toBe(2);
        expect(preferenceWrites).toBe(1);
    });
}

test('Welcome restores the selected profile after a replacement profile response is lost', async ({ page }) => {
    let authed = false;
    let preferenceWrites = 0;
    let upstreamFirstName = 'Original';
    const profileWrites: string[] = [];
    const passwordWrites: string[] = [];
    await mockEngine(page, {
        'GET /users/current': () => authed ? { user: { id: 1, username: 'admin', firstName: 'Original' } } : { __status: 401 },
        'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
        'GET /users/*/preferences/firstlogin': 'true',
        'PUT /users/1/password': (request: any) => { passwordWrites.push(request.postData() || ''); return ''; },
        'PUT /users/1/preferences/firstlogin': () => ++preferenceWrites === 1 ? { __status: 500, body: { message: 'Preference write failed' } } : '',
    });
    await page.route('**/api/users/1', async route => {
        upstreamFirstName = route.request().postDataJSON().user.firstName;
        profileWrites.push(upstreamFirstName);
        if (upstreamFirstName === 'Profile B') return route.abort('connectionreset');
        await route.fulfill({ status: 200, body: '' });
    });
    await page.goto('/');
    await login(page);
    await fillPassword(page);
    await profileField(page, 'First Name').fill('Profile A');
    await finish(page);
    await dismissError(page);
    await profileField(page, 'First Name').fill('Profile B');
    await finish(page);
    await dismissError(page);
    await profileField(page, 'First Name').fill('Profile A');
    await finish(page);
    await expect(page.locator('.shell')).toBeVisible();
    const publishedUser = await page.evaluate(async () => (await import(String('/core/store.js'))).getState('user'));
    expect(upstreamFirstName).toBe('Profile A');
    expect(publishedUser.firstName).toBe(upstreamFirstName);
    expect(profileWrites).toEqual(['Profile A', 'Profile B', 'Profile A']);
    expect(passwordWrites).toEqual([PASSWORD]);
    expect(preferenceWrites).toBe(2);
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


test.describe('login prerequisite session fencing', () => {
    const welcome = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Open Integration Engine', exact: true });
    const notification = (page: Page) => page.getByRole('dialog', { name: 'Login Notification', exact: true });

    async function expectUnpublished(page: Page) {
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
        await expect(welcome(page)).toHaveCount(0);
        await expect(page.locator('.shell')).toHaveCount(0);
        expect(await page.evaluate(async () => (await import(String('/core/store.js'))).getState('user'))).toBeFalsy();
    }

    for (const status of [401, 421]) {
        test(`login public settings ${status} prevents setup and shell publication`, async ({ page }) => {
            let authed = false;
            const calls: string[] = [];
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /server/publicSettings': { __status: status },
                'GET /users/*/preferences/firstlogin': () => { calls.push('firstlogin'); return 'true'; },
                'GET /server/id': () => { calls.push('scope'); return 'engine'; },
                'POST /users/_logout': () => { calls.push('logout'); return ''; },
            });
            await page.goto('/');
            await login(page);
            await expectUnpublished(page);
            expect(calls).toEqual([]);
        });

        for (const failure of [false, true]) {
            test(`login notification acknowledgement ${status} fences a pending firstlogin ${failure ? 'failure' : 'success'}`, async ({ page }) => {
                let authed = false;
                let waiting = false;
                let release!: () => void;
                const held = new Promise<void>(resolve => { release = resolve; });
                const calls: string[] = [];
                await mockEngine(page, {
                    'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                    'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                    'GET /server/publicSettings': { publicServerSettings: { loginNotificationEnabled: true, loginNotificationMessage: 'Read this before proceeding.' } },
                    'POST /users/1/notificationAcknowledged': async () => {
                        await expect.poll(() => waiting).toBe(true);
                        return { __status: status };
                    },
                    'GET /users/*/preferences/firstlogin': async () => {
                        waiting = true;
                        await held;
                        return failure ? { __status: 500 } : 'true';
                    },
                    'GET /server/id': () => { calls.push('scope'); return 'engine'; },
                    'POST /users/_logout': () => { calls.push('logout'); return ''; },
                });
                try {
                    await page.goto('/');
                    await login(page);
                    await page.evaluate(async () => {
                        const api = await import('@oie/web-api');
                        (window as any).reviewExpiryObserved = false;
                        const observe = () => { (window as any).reviewExpiryObserved = true; };
                        api.onSessionExpired(observe);
                        api.onEngineUnknown(observe);
                    });
                    await notification(page).getByRole('button', { name: 'I Accept', exact: true }).click();
                    await expect.poll(() => page.evaluate(() => (window as any).reviewExpiryObserved)).toBe(true);
                    release();
                    await expectUnpublished(page);
                    expect(calls).toEqual([]);
                } finally { release(); }
            });
        }

        test(`Welcome password requirements ${status} closes the dialog and fences a late password write`, async ({ page }) => {
            let authed = false;
            let waiting = false;
            let releasePassword!: () => void;
            let releaseRequirements!: () => void;
            const heldPassword = new Promise<void>(resolve => { releasePassword = resolve; });
            const heldRequirements = new Promise<void>(resolve => { releaseRequirements = resolve; });
            const calls: string[] = [];
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /users/*/preferences/firstlogin': 'true',
                'GET /server/passwordRequirements': async () => { await heldRequirements; return { __status: status }; },
                'PUT /users/1/password': async () => { waiting = true; await heldPassword; return ''; },
                'PUT /users/1': () => { calls.push('profile'); return ''; },
                'PUT /users/1/preferences/firstlogin': () => { calls.push('preference'); return ''; },
                'GET /server/id': () => { calls.push('scope'); return 'engine'; },
                'POST /users/_logout': () => { calls.push('logout'); return ''; },
            });
            try {
                await page.goto('/');
                await login(page);
                const fields = welcome(page).locator('input[type=password]');
                await fields.nth(0).fill('FirstPassword1!');
                await fields.nth(1).fill('FirstPassword1!');
                await welcome(page).getByRole('button', { name: 'Finish', exact: true }).click();
                await expect.poll(() => waiting).toBe(true);
                releaseRequirements();
                await expectUnpublished(page);
                const response = page.waitForResponse(response => response.url().endsWith('/users/1/password'));
                releasePassword();
                await response;
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                expect(calls).toEqual([]);
            } finally { releaseRequirements(); releasePassword(); }
        });

        for (const failure of [false, true]) {
            test(`login ${status} during a pending preference scope ${failure ? 'failure' : 'success'} cannot publish a stale user`, async ({ page }) => {
                let authed = false;
                let waiting = false;
                let release!: () => void;
                const held = new Promise<void>(resolve => { release = resolve; });
                await mockEngine(page, {
                    'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                    'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                    'GET /users/*/preferences/firstlogin': 'false',
                    'GET /server/id': async () => { waiting = true; await held; return failure ? { __status: 500 } : 'stale-engine'; },
                    'GET /server/review-expiry': { __status: status },
                });
                try {
                    await page.goto('/');
                    await login(page);
                    await expect.poll(() => waiting).toBe(true);
                    await page.evaluate(async () => {
                        const api = await import('@oie/web-api');
                        await api.default.get('/server/review-expiry').catch(() => {});
                    });
                    release();
                    await expectUnpublished(page);
                    expect(await page.evaluate(async () => (await import(String('/core/store.js'))).scopedKey('probe'))).not.toContain('stale-engine');
                } finally { release(); }
            });
        }
    }

    for (const stage of ['publicSettings', 'firstlogin', 'scope'] as const) {
        test(`login tolerates a non-authentication failure at ${stage}`, async ({ page }) => {
            let authed = false;
            const result = (name: string, value: unknown) => stage === name ? { __status: 500 } : value;
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /server/publicSettings': () => result('publicSettings', { publicServerSettings: { loginNotificationEnabled: false } }),
                'GET /users/*/preferences/firstlogin': () => result('firstlogin', 'false'),
                'GET /server/id': () => result('scope', 'engine'),
            });
            await page.goto('/');
            await login(page);
            await expect(page.locator('.statusbar')).toContainText('as admin');
        });
    }
});


test.describe('Welcome retry and dialog parity', () => {
    const PASSWORD = 'WelcomeReviewPassword1!';
    const welcome = (page: Page) => page.getByRole('dialog', { name: 'Welcome to Open Integration Engine', exact: true });
    const error = (page: Page) => page.getByRole('dialog', { name: 'Error', exact: true });
    async function fillPassword(page: Page) {
        const inputs = welcome(page).locator('input[type=password]');
        await inputs.nth(0).fill(PASSWORD);
        await inputs.nth(1).fill(PASSWORD);
    }

    test('Welcome retries a committed firstlogin preference after its response is lost without resaving password or profile', async ({ page }) => {
        let authed = false;
        let firstlogin = 'true';
        const passwords: string[] = [];
        const preferences: string[] = [];
        let profileWrites = 0;
        await mockEngine(page, {
            'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
            'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
            'GET /users/*/preferences/firstlogin': () => firstlogin,
            'PUT /users/1/password': (request: any) => {
                passwords.push(request.postData() || '');
                return passwords.length === 1 ? '' : { list: { string: ['Password was recently used'] } };
            },
            'PUT /users/1': () => { profileWrites++; return ''; },
        });
        await page.route('**/api/users/1/preferences/firstlogin', async route => {
            if (route.request().method() !== 'PUT') return route.fallback();
            firstlogin = route.request().postData() || '';
            preferences.push(firstlogin);
            if (preferences.length === 1) return route.abort('connectionreset');
            await route.fulfill({ status: 200, body: '' });
        });
        await page.goto('/');
        await login(page);
        await fillPassword(page);
        await welcome(page).getByRole('button', { name: 'Finish', exact: true }).click();
        await expect(error(page)).toBeVisible();
        expect(firstlogin).toBe('false');
        await error(page).getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(welcome(page).getByRole('status')).toHaveText('Your password and profile were saved. Select Finish to retry the remaining changes.');
        await welcome(page).getByRole('button', { name: 'Finish', exact: true }).click();
        await expect(page.locator('.shell')).toBeVisible();
        expect(passwords).toEqual([PASSWORD]);
        expect(profileWrites).toBe(1);
        expect(preferences).toEqual(['false', 'false']);
        await page.reload();
        await expect(page.locator('.shell')).toBeVisible();
        await expect(welcome(page)).toHaveCount(0);
        expect(passwords).toEqual([PASSWORD]);
        expect(profileWrites).toBe(1);
        expect(preferences).toEqual(['false', 'false']);
    });

    for (const stage of ['profile', 'preference'] as const) {
        test(`Welcome DOM fallback serializes Finish and retries only unfinished writes after ${stage} failure`, async ({ page }) => {
            let authed = false;
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const passwords: string[] = [];
            let profileWrites = 0;
            let preferenceWrites = 0;
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /users/*/preferences/firstlogin': 'true',
                'PUT /users/1/password': async (request: any) => {
                    passwords.push(request.postData() || '');
                    await held;
                    return passwords.length === 1 ? '' : { list: { string: ['Password was recently used'] } };
                },
                'PUT /users/1': () => ++profileWrites === 1 && stage === 'profile'
                    ? { __status: 500, body: { message: 'Profile write failed' } } : '',
                'PUT /users/1/preferences/firstlogin': () => ++preferenceWrites === 1 && stage === 'preference'
                    ? { __status: 500, body: { message: 'Preference write failed' } } : '',
            });
            try {
                await page.goto('/');
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
                await page.evaluate(async () => { (await import(String('/core/ui.js'))).setDialogRenderer(null); });
                await login(page);
                await fillPassword(page);
                const finish = welcome(page).getByRole('button', { name: 'Finish', exact: true });
                await finish.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
                await expect.poll(() => passwords.length).toBe(1);
                await expect(welcome(page)).toHaveAttribute('aria-busy', 'true');
                await page.keyboard.press('Escape');
                await welcome(page).getByRole('button', { name: 'Close', exact: true }).click();
                await expect(welcome(page)).toBeVisible();
                expect(profileWrites).toBe(0);
                expect(preferenceWrites).toBe(0);
                release();
                await expect(error(page)).toContainText(stage === 'profile' ? 'Profile write failed' : 'Preference write failed');
                await error(page).getByRole('button', { name: 'Close', exact: true }).last().click();
                await expect(welcome(page)).not.toHaveAttribute('aria-busy');
                await finish.click();
                await expect(page.locator('.shell')).toBeVisible();
                expect(passwords).toEqual([PASSWORD]);
                expect(profileWrites).toBe(stage === 'profile' ? 2 : 1);
                expect(preferenceWrites).toBe(stage === 'preference' ? 2 : 1);
            } finally { release(); }
        });
    }

    for (const status of [401, 421]) {
        test(`Welcome password requirements ${status} closes an idle dialog without saving or logging out`, async ({ page }) => {
            let authed = false;
            let release!: () => void;
            const held = new Promise<void>(resolve => { release = resolve; });
            const writes: string[] = [];
            await mockEngine(page, {
                'GET /users/current': () => authed ? { user: { id: 1, username: 'admin' } } : { __status: 401 },
                'POST /users/_login': () => { authed = true; return { status: 'SUCCESS' }; },
                'GET /users/*/preferences/firstlogin': 'true',
                'GET /server/passwordRequirements': async () => { await held; return { __status: status }; },
                'PUT /users/1/password': () => { writes.push('password'); return ''; },
                'PUT /users/1': () => { writes.push('profile'); return ''; },
                'PUT /users/1/preferences/firstlogin': () => { writes.push('preference'); return ''; },
                'POST /users/_logout': () => { writes.push('logout'); return ''; },
            });
            try {
                await page.goto('/');
                await login(page);
                await fillPassword(page);
                await welcome(page).locator('input[type=password]').evaluateAll(inputs => { (window as any).reviewClosedPasswordFields = inputs; });
                release();
                await expect(welcome(page)).toHaveCount(0);
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
                await expect(page.locator('.shell')).toHaveCount(0);
                expect(await page.evaluate(() => (window as any).reviewClosedPasswordFields.map((input: HTMLInputElement) => input.value))).toEqual(['', '']);
                expect(writes).toEqual([]);
            } finally { release(); }
        });
    }
});
