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
    const writes: string[] = [];
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).pathname.includes('codeTemplate')) writes.push(request.url()); });
    // Exact error fields observed with the shipped Jetty/Jersey JSON writer
    // when a code template contains U+FFFE/U+FFFF. The cause stays in the log.
    await mockEngine(page, { 'GET /codeTemplateLibraries': () => fail ? { __status: 500, body: {
        servlet: 'org.glassfish.jersey.servlet.ServletContainer-425357dd',
        message: 'Request failed.', url: '/api/codeTemplateLibraries', status: '500'
    } } : libraries });
    await page.goto('/code-templates?libraryId=lib-1&templateId=tpl-1');
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText('Load failed: HTTP 500.');
    await expect(dialog).toContainText('Check the engine server log for details.');
    await expect(dialog).not.toContainText('Request failed');
    await expect(dialog).not.toContainText('serializ');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    for (const name of ['New Library', 'Import Code Templates', 'Import Libraries']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByText('Code template libraries must load before changes can be made.', { exact: true })).toBeVisible();
    await page.getByText('Code template libraries must load before changes can be made.', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'New Library', exact: true })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Export All Libraries', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    expect(writes).toEqual([]);
    fail = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Library', exact: true })).toBeEnabled();
});

test('pending initial library load blocks changes until an authoritative empty list succeeds', async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, { 'GET /codeTemplateLibraries': async () => { await pending; return { list: { codeTemplateLibrary: [] } }; } });
    await page.goto('/code-templates');
    await expect(page.getByRole('status').filter({ hasText: 'Loading code template libraries…' })).toBeVisible();
    await expect(page.getByText('Loading code template libraries…', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Code template libraries must load before changes can be made.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Code template libraries have not loaded', { exact: true })).toHaveCount(0);
    for (const name of ['New Library', 'Import Code Templates', 'Import Libraries']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
    }
    await page.keyboard.press('ControlOrMeta+s');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText('0 Libraries, 0 Code Templates', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Library', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'New Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
});

test('library load errors preserve JSON and XML detail as safe text and suppress generic HTML documents', async ({ page }) => {
    await mockEngine(page);
    let response = { contentType: 'application/json', body: JSON.stringify({
        message: 'Request failed.', detailedError: 'Invalid template: <img src="x" onerror="window.__unsafeError = true">'
    }) };
    await page.route('**/api/codeTemplateLibraries?*', route => route.fulfill({ status: 500, ...response }));
    await page.goto('/code-templates');
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText('HTTP 500. Invalid template: <img');
    await expect(dialog.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__unsafeError)).toBeUndefined();
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

    response = { contentType: 'application/xml', body: '<error><message>Request failed.</message><detailedError>Invalid template: &lt;script&gt;</detailedError></error>' };
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(dialog).toContainText('HTTP 500. Invalid template: <script>');
    await expect(dialog.locator('script')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();

    response = { contentType: 'text/html', body: '<!DOCTYPE html><html><head><style>body { color: red }</style></head><body>HTTP ERROR 500</body></html>' };
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(dialog).toContainText('HTTP 500.');
    await expect(dialog).toContainText('Check the engine server log for details.');
    await expect(dialog).not.toContainText('DOCTYPE');
    await expect(dialog).not.toContainText('color: red');
});

test('failed refresh keeps the library model and unsaved edits retryable', async ({ page }) => {
    let fail = false;
    await mockEngine(page, { 'GET /codeTemplateLibraries': () => fail ? { __status: 500 } : libraries });
    await page.goto('/code-templates?libraryId=lib-1');
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await page.locator('textarea').fill('Unsaved diagnostic edit');
    fail = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('dialog', { name: 'Refresh', exact: true }).getByRole('button', { name: 'Refresh', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(dialog).toContainText('HTTP 500.');
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('textarea')).toHaveValue('Unsaved diagnostic edit');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
    await expect(page.getByText('1 Library, 1 Code Template', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Library', exact: true })).toBeEnabled();
    await page.locator('textarea').fill('Edits remain available after the failed refresh');
    await expect(page.locator('textarea')).toHaveValue('Edits remain available after the failed refresh');

    fail = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('dialog', { name: 'Refresh', exact: true }).getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await expect(page.locator('textarea')).not.toHaveValue('Edits remain available after the failed refresh');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
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
