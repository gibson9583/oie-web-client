import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

const libraries = DEFAULT_FIXTURES['GET /codeTemplateLibraries'];

for (const target of [
    { query: 'libraryId=lib-1', task: 'Export Library' },
    { query: 'libraryId=lib-1&templateId=tpl-1', task: 'Export Code Template' },
    { query: 'templateId=tpl-1', task: 'Export Code Template' }
]) {
    test(`code template link selects its target after loading: ${target.query}`, async ({ page }) => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, { 'GET /codeTemplateLibraries': async () => { await pending; return libraries; } });
        await page.goto('/code-templates?' + target.query);
        await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: target.task, exact: true })).toHaveCount(0);
        release();
        await expect(page.getByRole('button', { name: target.task, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    });
}

for (const query of ['libraryId=missing', 'libraryId=lib-1&templateId=missing', 'libraryId=missing&templateId=tpl-1', 'libraryId=lib-1&templateId=']) {
    test(`code template link does not select a fallback for an invalid target: ${query}`, async ({ page }) => {
        await mockEngine(page);
        await page.goto('/code-templates?' + query);
        await expect(page.getByText('1 Library, 1 Code Template', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toHaveCount(0);
        await expect(page.getByText('Select a library or code template to edit it.', { exact: true })).toBeVisible();
    });
}

test('refresh preserves subsequent selection and clears a removed target without restoring the original link', async ({ page }) => {
    let response: any = libraries;
    await mockEngine(page, { 'GET /codeTemplateLibraries': () => response });
    await page.goto('/code-templates?libraryId=lib-1&templateId=tpl-1');
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await page.getByRole('treegrid').getByText('Demo Library', { exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toHaveCount(0);
    response = { list: { codeTemplateLibrary: [] } };
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('0 Libraries, 0 Code Templates', { exact: true })).toBeVisible();
    response = libraries;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByText('1 Library, 1 Code Template', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toHaveCount(0);
});

test('failed initial library load retains the link target for retry', async ({ page }) => {
    let fail = true;
    await mockEngine(page, { 'GET /codeTemplateLibraries': () => fail ? { __status: 503 } : libraries });
    await page.goto('/code-templates?libraryId=lib-1&templateId=tpl-1');
    await expect(page.getByText(/Load failed:/)).toBeVisible();
    await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
    fail = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
});

test('a deep-linked library retains the existing unsaved-navigation guard', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/code-templates?libraryId=lib-1');
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await page.locator('textarea').fill('Unsaved library description');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/code-templates\?libraryId=lib-1$/);
    await expect(page.locator('textarea')).toHaveValue('Unsaved library description');
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
});
