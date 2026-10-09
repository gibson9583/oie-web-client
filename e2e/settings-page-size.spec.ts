import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const preferenceKey = 'webadmin-prefs:e2e-server-1:1';
const field = (page: Page, kind: 'Message' | 'Event') => page.getByRole('spinbutton', { name: `${kind} browser page size`, exact: true });
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), preferenceKey);
const dirty = (page: Page) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});

async function openSettings(page: Page, preferences?: Record<string, number>, overrides: Record<string, unknown> = {}) {
    const writes: string[] = [];
    await page.setViewportSize({ width: 1500, height: 900 });
    if (preferences) await page.addInitScript(({ key, preferences }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(preferences));
    }, { key: preferenceKey, preferences });
    page.on('request', request => { if (request.method() === 'PUT') writes.push(new URL(request.url()).pathname); });
    await mockEngine(page, { ...overrides });
    await page.goto('/settings?tab=administrator');
    await expect(field(page, 'Message')).toBeVisible();
    return writes;
}

async function save(page: Page) {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => dirty(page)).toBe(false);
    await expect(page.locator('.toast-msg', { hasText: 'Preferences saved' })).toBeVisible();
}

async function closeError(page: Page, text: string) {
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText(text);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
}

async function browserDefaults(page: Page, messageSize: number, eventSize: number) {
    for (const [route, path, size, limit] of [
        ['/messages/c-started', '/api/channels/c-started/messages', messageSize, messageSize + 1],
        ['/events', '/api/events', eventSize, eventSize],
    ] as const) {
        const search = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === path);
        await page.goto(route);
        expect(new URL((await search).url()).searchParams.get('limit')).toBe(String(limit));
        await expect(page.getByRole('spinbutton', { name: 'Page Size', exact: true })).toHaveValue(String(size));
    }
}

test('Administrator defaults and Restore Defaults use Swing message 20 and event 100', async ({ page }) => {
    await openSettings(page);
    await expect(field(page, 'Message')).toHaveValue('20');
    await expect(field(page, 'Event')).toHaveValue('100');
    for (const kind of ['Message', 'Event'] as const) {
        await expect(field(page, kind)).toHaveAttribute('min', '1');
        await expect(field(page, kind)).toHaveAttribute('max', '999');
    }
    await field(page, 'Message').fill('1');
    await field(page, 'Event').fill('37');
    await save(page);
    await page.getByRole('button', { name: 'Restore Defaults', exact: true }).click();
    await expect(field(page, 'Message')).toHaveValue('20');
    await expect(field(page, 'Event')).toHaveValue('100');
    expect(await dirty(page)).toBe(false);
    await browserDefaults(page, 20, 100);
});

for (const [messageSize, eventSize] of [['1', '37'], ['37', '999'], ['999', '001'], ['001', '1']]) {
    test(`custom defaults ${messageSize}/${eventSize} persist and initialize both browsers`, async ({ page }) => {
        await openSettings(page);
        await field(page, 'Message').fill(messageSize);
        await field(page, 'Event').fill(eventSize);
        await save(page);
        expect(await saved(page)).toMatchObject({ messagePageSize: Number(messageSize), eventPageSize: Number(eventSize) });
        await page.reload();
        await expect(field(page, 'Message')).toHaveValue(String(Number(messageSize)));
        await expect(field(page, 'Event')).toHaveValue(String(Number(eventSize)));
        await browserDefaults(page, Number(messageSize), Number(eventSize));
    });
}

test('a previously saved event size of 20 survives the new default', async ({ page }) => {
    await openSettings(page, { messagePageSize: 37, eventPageSize: 20 });
    await expect(field(page, 'Message')).toHaveValue('37');
    await expect(field(page, 'Event')).toHaveValue('20');
    await save(page);
    expect(await saved(page)).toMatchObject({ messagePageSize: 37, eventPageSize: 20 });
    await browserDefaults(page, 37, 20);
});

for (const kind of ['Message', 'Event'] as const) {
    test(`invalid ${kind.toLowerCase()} defaults retain the draft without saving any settings`, async ({ page }) => {
        const writes = await openSettings(page, { messagePageSize: 37, eventPageSize: 55 });
        const before = await saved(page);
        const themeBefore = await page.locator('html').getAttribute('data-theme');
        await field(page, kind === 'Message' ? 'Event' : 'Message').fill('88');
        await page.locator('select').filter({ has: page.locator('option[value="dark"]') }).selectOption(themeBefore === 'dark' ? 'light' : 'dark');
        for (const value of ['', '0', '-1', '1.5', '1000', '1e2']) {
            await field(page, kind).fill(value);
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await closeError(page, `${kind} browser page size must be a whole number from 1 to 999.`);
            expect(await saved(page)).toEqual(before);
            expect(writes).toHaveLength(0);
            expect(await dirty(page)).toBe(true);
            await expect(field(page, kind)).toHaveValue(value);
            await expect(page.locator('html')).toHaveAttribute('data-theme', themeBefore!);
            await expect(page.locator('.toast-msg', { hasText: 'Preferences saved' })).toHaveCount(0);
        }
        await field(page, kind).fill('1');
        await save(page);
        expect(await saved(page)).toMatchObject(kind === 'Message'
            ? { messagePageSize: 1, eventPageSize: 88 } : { messagePageSize: 88, eventPageSize: 1 });
        expect(writes).toHaveLength(1);
    });
}

test('Save Changes keeps invalid page-size settings open until corrected', async ({ page }) => {
    const writes = await openSettings(page);
    await field(page, 'Message').fill('1');
    await field(page, 'Event').fill('0');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Save Changes', exact: true }).click();
    await closeError(page, 'Event browser page size must be a whole number from 1 to 999.');
    await expect(page).toHaveURL(/\/settings\?tab=administrator$/);
    await expect(field(page, 'Message')).toHaveValue('1');
    await expect(field(page, 'Event')).toHaveValue('0');
    expect(writes).toHaveLength(0);
    expect(await dirty(page)).toBe(true);
    await field(page, 'Event').fill('37');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(field(page, 'Event')).toHaveCount(0);
    await expect.poll(() => dirty(page)).toBe(false);
    expect(writes).toHaveLength(1);
    expect(await saved(page)).toMatchObject({ messagePageSize: 1, eventPageSize: 37 });
});

test('custom page-size drafts remain retryable after a background-color save failure', async ({ page }) => {
    let fail = true;
    const writes = await openSettings(page, undefined, {
        'PUT /users/1/preferences/backgroundColor': () => fail ? { __status: 503, body: { error: 'color unavailable' } } : '',
    });
    await field(page, 'Message').fill('1');
    await field(page, 'Event').fill('37');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await closeError(page, 'Could not save background color:');
    await expect(field(page, 'Message')).toHaveValue('1');
    await expect(field(page, 'Event')).toHaveValue('37');
    expect(await dirty(page)).toBe(true);
    fail = false;
    await save(page);
    expect(writes).toHaveLength(2);
    expect(await saved(page)).toMatchObject({ messagePageSize: 1, eventPageSize: 37 });
});
