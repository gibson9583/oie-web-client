import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const propertyClass = 'com.mirth.connect.util.ConfigurationProperty';
const fixtures = {
    'GET /server/configurationMap': { map: { entry: [
        { string: 'kept', [propertyClass]: { value: 'old', comment: 'old comment' } },
        { string: 'omitted', [propertyClass]: { value: 'remove me', comment: '' } }
    ] } }
};
async function choose(page: any, content: string) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Map', exact: true }).click();
    await (await chooser).setFiles({ name: 'configuration.properties', mimeType: 'text/plain', buffer: Buffer.from(content) });
}

test('configuration map import replaces the draft, drops omitted keys/comments and saves only on request', async ({ page }) => {
    const writes: string[] = [];
    await mockEngine(page, { ...fixtures, 'PUT /server/configurationMap': (request: any) => { writes.push(request.postData()); return ''; } });
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'kept=new\ncolon:value\nescaped\\=key=line\\nnext\ncontinued=one\\\n two\nduplicate=first\nduplicate=second\n');
    const dialog = page.getByRole('dialog', { name: 'Import Configuration Map', exact: true });
    await expect(dialog).toContainText('Existing entries and comments will be replaced');
    await dialog.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('input[value="omitted"]')).toHaveCount(0);
    await expect(page.locator('input[value="old comment"]')).toHaveCount(0);
    await expect(page.locator('input[value="escaped=key"]')).toBeVisible();
    expect(writes).toHaveLength(0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const saved = JSON.parse(writes[0]).map.entry;
    expect(saved).toEqual([
        { string: 'colon', [propertyClass]: { value: 'value', comment: '' } },
        { string: 'continued', [propertyClass]: { value: 'onetwo', comment: '' } },
        { string: 'duplicate', [propertyClass]: { value: 'first', comment: '' } },
        { string: 'escaped=key', [propertyClass]: { value: 'line\nnext', comment: '' } },
        { string: 'kept', [propertyClass]: { value: 'new', comment: '' } }
    ]);
    expect(writes[0]).not.toContain('second');
    expect(writes[0]).not.toContain('omitted');
    expect(writes[0]).not.toContain('old comment');
});

for (const content of ['', '# only a comment\n']) {
    test(`empty configuration import clears the draft (${content ? 'comments' : 'empty file'})`, async ({ page }) => {
        const writes: string[] = [];
        await mockEngine(page, { ...fixtures, 'PUT /server/configurationMap': (request: any) => { writes.push(request.postData()); return ''; } });
        await page.goto('/settings?tab=Configuration%20Map');
        await expect(page.locator('input[value="omitted"]')).toBeVisible();
        await choose(page, content);
        await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
        await expect(page.getByText('No configuration map entries', { exact: true })).toBeVisible();
        expect(writes).toHaveLength(0);
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(JSON.parse(writes[0]).map.entry).toEqual([]);
    });
}

test('cancel and malformed Unicode leave the existing configuration draft intact', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'kept=replacement');
    await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'kept=\\uXXXX');
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Invalid Unicode escape');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await expect(page.locator('input[value="old comment"]')).toBeVisible();
});

test('configuration includes are selected before replacing the draft and preserve file order', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'first=root\ninclude=sub/child.properties\nshared=after include');
    const include = page.getByRole('dialog', { name: 'Import Included Properties', exact: true });
    await expect(include).toContainText('sub/child.properties');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await include.getByRole('button', { name: 'Select File', exact: true }).click();
    await (await chooser).setFiles({ name: 'child.properties', mimeType: 'text/plain', buffer: Buffer.from('shared=included\nincludeoptional=missing.properties') });
    await expect(include).toContainText('sub/missing.properties');
    await include.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('input[value="omitted"]')).toHaveCount(0);
    await expect(page.locator('input[value="included"]')).toBeVisible();
    await expect(page.locator('input[value="after include"]')).toHaveCount(0);
});

test('cancelling an included file leaves the entire configuration draft unchanged', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'first=root\ninclude=child.properties');
    await page.getByRole('dialog', { name: 'Import Included Properties', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await expect(page.locator('input[value="first"]')).toHaveCount(0);
});

test('session expiry during include selection cancels the import without a stale draft or dialog', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, 'include=child.properties');
    await expect(page.getByRole('dialog', { name: 'Import Included Properties', exact: true })).toBeVisible();
    await page.route('**/api/server/version', route => route.fulfill({ status: 401, body: 'expired' }));
    await page.evaluate(async () => {
        const pkg = '@oie/web-api';
        await (await import(pkg)).default.get('/server/version').catch(() => {});
    });
    await expect(page.locator('.shell')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast-msg', { hasText: 'Imported' })).toHaveCount(0);
});

test('imported escaped key whitespace survives save and a populated empty key blocks save', async ({ page }) => {
    const writes: string[] = [];
    await mockEngine(page, { ...fixtures, 'PUT /server/configurationMap': (request: any) => { writes.push(request.postData()); return ''; } });
    await page.goto('/settings?tab=Configuration%20Map');
    await expect(page.locator('input[value="omitted"]')).toBeVisible();
    await choose(page, '\\u0020leading\\u0020=value');
    await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(JSON.parse(writes[0]).map.entry[0].string).toBe(' leading ');
    await page.evaluate(() => {
        (window as any).configurationExport = '';
        (window as any).showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async (content: Blob) => { (window as any).configurationExport = await content.text(); }, close: async () => {}
        }) });
    });
    await page.getByRole('button', { name: 'Export Map', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).configurationExport)).toBe('\\u0020leading\\u0020=value\n');
    await choose(page, '=nonempty');
    await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Blank keys are not allowed.', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
});
