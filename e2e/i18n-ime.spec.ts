import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Locator } from '@playwright/test';

async function composingEnter(input: Locator) {
    await input.dispatchEvent('compositionstart');
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true });
    await input.dispatchEvent('compositionend', { data: '中文' });
    // Safari may send this Enter after compositionend, with isComposing false.
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: false });
}

test('IME confirmation does not submit login; ordinary Enter does', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, { 'GET /users/current': { __status: 401 }, 'POST /users/_login': () => { writes++; return { status: 'FAIL' }; } });
    await page.goto('/');
    await page.getByPlaceholder('admin').fill('中文');
    const input = page.locator('input[type=password]');
    await input.fill('secret'); await composingEnter(input);
    expect(writes).toBe(0);
    await input.press('Enter'); await expect.poll(() => writes).toBe(1);
});

for (const [route, placeholder, endpoint] of [
    ['/events', 'Event name contains…', '/api/events'],
    ['/messages/ch-1', 'Search message content…', '/api/channels/ch-1/messages']
]) test(`IME confirmation does not search ${route}; ordinary Enter does`, async ({ page }) => {
    let reads = 0;
    await mockEngine(page);
    page.on('request', r => { if (new URL(r.url()).pathname === endpoint) reads++; });
    const initialSearch = page.waitForResponse(r => new URL(r.url()).pathname === endpoint);
    await page.goto(route);
    await initialSearch;
    const input = page.getByPlaceholder(placeholder);
    await expect(input).toBeVisible();
    await input.fill('中文');
    const before = reads;
    await composingEnter(input); expect(reads).toBe(before);
    await input.press('Enter'); await expect.poll(() => reads).toBeGreaterThan(before);
});

test('IME confirmation does not choose a command or rename navigation', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const command = page.getByPlaceholder('Search views, channels and commands…');
    await command.fill('Events'); await composingEnter(command);
    await expect(command).toBeVisible(); await expect(page).toHaveURL(/dashboard$/);
    await command.press('Enter'); await expect(page).toHaveURL(/events$/);
    await page.locator('#rail-customize').click();
    for (const target of [page.locator('.rail-nav .rail-pane-header').first(), page.locator('[data-nav-item=dashboard]')]) {
        await target.click();
        const input = page.locator('.rail-name-input');
        await input.fill('中文导航'); await composingEnter(input);
        await expect(input).toBeVisible();
        await input.press('Enter'); await expect(input).toHaveCount(0);
    }
});

test('IME confirmation does not resolve the DOM prompt', async ({ page }) => {
    await mockEngine(page); await page.goto('/dashboard');
    await expect(page.locator('.shell')).toBeVisible();
    const result = page.evaluate(async () => { const pkg = '@oie/web-ui'; return (await import(pkg)).promptDialog('IME prompt', 'Input', ''); });
    const input = page.getByRole('dialog').locator('input');
    await input.fill('中文'); await composingEnter(input);
    await expect(input).toBeVisible();
    await input.press('Enter'); expect(await result).toBe('中文');
});

test('IME confirmation does not add a wizard tag or newline to the fallback editor', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await mockEngine(page); await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('IME Channel');
    await page.getByRole('button', {name:'Next',exact:true}).click();
    await page.getByRole('button', {name:'Next',exact:true}).click();
    const input = page.getByPlaceholder('Add tag…');
    await input.fill('IME Tag'); await composingEnter(input);
    await expect(input).toHaveValue('IME Tag');
    await input.press('Enter'); await expect(input).toHaveValue('');
    await expect(page.locator('.tag', {hasText:'IME Tag'})).toBeVisible();
    await page.goto('/global-scripts');
    const editor = page.locator('textarea.ce-area').first();
    await editor.fill('中文'); await composingEnter(editor);
    await expect(editor).toHaveValue('中文');
    await editor.press('End'); await editor.press('Enter');
    await expect(editor).toHaveValue('中文\n');
});

test('IME confirmation leaves the dashboard suggestion and date spinner active', async ({ page }) => {
    await mockEngine(page); await page.goto('/dashboard');
    const input = page.getByPlaceholder('Enter channel tag or name');
    await input.fill('Demo'); await composingEnter(input);
    await expect(input).toHaveValue('Demo');
    await input.press('Enter'); await expect(input).toHaveValue('');
    await page.goto('/messages/ch-1');
    await page.getByRole('button',{name:'Start date',exact:true}).click();
    const hour = page.getByRole('textbox',{name:'Hour',exact:true});
    await hour.fill('3'); await composingEnter(hour); await expect(hour).toHaveValue('3');
    await hour.press('Enter'); await expect(hour).toHaveValue('03');
});
