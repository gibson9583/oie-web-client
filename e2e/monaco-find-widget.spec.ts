import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

test('stylesheets load fonts as same-origin files that the CSP allows', async ({ request }) => {
    const shell = await (await request.get('/')).text();
    const sheets = [...shell.matchAll(/href="([^"]+\.css)"/g)].map(match => match[1]);
    sheets.push('/vendor/monaco/editor.main.css');
    for (const sheet of sheets) {
        expect(await (await request.get(sheet)).text(), sheet).not.toContain('data:font');
    }
    const monacoCss = await (await request.get('/vendor/monaco/editor.main.css')).text();
    const codicon = monacoCss.match(/url\(["']?([^"')]+\.ttf)["']?\)/)?.[1];
    expect(codicon).toBeTruthy();
    const font = await request.get(new URL(codicon!, 'http://host/vendor/monaco/editor.main.css').pathname);
    expect(font.status()).toBe(200);
});

test('the find widget draws its icons and shows its tooltips in full', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', message => { if (/Content Security Policy/i.test(message.text())) violations.push(message.text()); });
    await page.goto('/global-scripts');
    await page.locator('.ce-monaco .monaco-editor .view-lines').first().click();
    const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
    await page.keyboard.press(mac ? 'Meta+f' : 'Control+f');
    const regex = page.locator('.find-widget [aria-label^="Use Regular Expression"]').first();
    await expect(regex).toBeVisible();
    await expect.poll(() => page.evaluate(() => [...document.fonts]
        .filter(face => face.family.replace(/["']/g, '') === 'codicon').map(face => face.status)))
        .toEqual(['loaded']);

    await regex.hover();
    const tooltip = page.locator('.monaco-hover').filter({ hasText: 'Use Regular Expression' }).first();
    await expect(tooltip).toBeVisible();
    // A point inside the tooltip's top edge must hit the tooltip, not the page beneath a clipping box.
    const visible = await tooltip.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
        return !!hit && element.contains(hit);
    });
    expect(visible).toBe(true);
    expect(violations).toEqual([]);
});
