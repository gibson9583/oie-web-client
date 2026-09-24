import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

async function choose(page: any, content: string, format = 'xml') {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Alert', exact: true }).first().click();
    await (await chooser).setFiles({ name: `alerts.${format}`, mimeType: `application/${format}`, buffer: Buffer.from(content) });
}
const alert = (name: string, id = 'foreign-id') => `<alertModel version="4.6.0"><id>${id}</id><name>${name}</name><enabled>true</enabled></alertModel>`;
async function expire(page: any) {
    await page.route('**/api/server/version', (route: any) => route.fulfill({ status: 401, body: 'expired' }));
    await page.evaluate(async () => {
        const pkg = '@oie/web-api';
        await (await import(pkg)).default.get('/server/version').catch(() => {});
    });
    await expect(page.locator('.shell')).toHaveCount(0);
}

for (const format of ['xml', 'json']) {
    for (const name of ['', 'Invalid!']) {
        test(`invalid unique alert name warns before explicit Swing overwrite (${format}, ${name || 'empty'})`, async ({ page }) => {
            const writes: string[] = [];
            await mockEngine(page, { 'POST /alerts': (request: any) => { writes.push(request.postData()); return ''; } });
            await page.goto('/alerts');
            await expect(page.getByText('Error Alert', { exact: true })).toBeVisible();
            await choose(page, format === 'xml' ? alert(name) : JSON.stringify({ alertModel: { '@version': '4.6.0', id: 'foreign-id', name } }), format);
            const dialog = page.getByRole('dialog', { name: 'Import Alert', exact: true });
            await expect(dialog).toContainText(name ? 'special characters' : 'cannot be empty');
            expect(writes).toHaveLength(0);
            await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
            await expect.poll(() => writes.length).toBe(1);
            expect(writes[0]).toContain('foreign-id');
            await expect(page.locator('.toast-msg', { hasText: 'Imported 1 alert' })).toBeVisible();
        });
    }
}

test('invalid alert may be renamed; imported names participate in subsequent conflicts', async ({ page }) => {
    const writes: string[] = [];
    await mockEngine(page, { 'POST /alerts': (request: any) => { writes.push(request.postData()); return ''; } });
    await page.goto('/alerts');
    await choose(page, `<list>${alert('Invalid!', 'one')}${alert('Renamed', 'two')}</list>`);
    await page.getByRole('dialog', { name: 'Import Alert', exact: true }).getByRole('button', { name: 'Create New', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Import Alert', exact: true });
    await rename.getByRole('textbox').fill('Renamed');
    await rename.getByRole('button', { name: 'OK', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    const conflict = page.getByRole('dialog', { name: 'Import Alert', exact: true });
    await expect(conflict).toContainText('already exists');
    await conflict.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[0].match(/<id>(.*?)<\/id>/)?.[1]).toBe(writes[1].match(/<id>(.*?)<\/id>/)?.[1]);
    expect(writes[0]).not.toContain('<id>one</id>');
    expect(writes[1]).not.toContain('<id>two</id>');
});

for (const cancel of ['Cancel', 'Close']) {
    test(`alert conflict ${cancel.toLowerCase()} stops the batch and reports completed imports`, async ({ page }) => {
        const writes: string[] = [];
        await mockEngine(page, { 'POST /alerts': (request: any) => { writes.push(request.postData()); return ''; } });
        await page.goto('/alerts');
        await choose(page, `<list>${alert('First', 'one')}${alert('Invalid!', 'two')}${alert('Last', 'three')}</list>`);
        const dialog = page.getByRole('dialog', { name: 'Import Alert', exact: true });
        await expect(dialog).toBeVisible();
        expect(writes).toHaveLength(1);
        await dialog.getByRole('button', { name: cancel, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.locator('.toast-msg', { hasText: 'Imported 1 alert' })).toBeVisible();
        expect(writes).toHaveLength(1);
    });
}

test('alert import list failure prevents mutation', async ({ page }) => {
    let reads = 0, writes = 0;
    await mockEngine(page, { 'GET /alerts': () => ++reads === 1 ? { list: '' } : { __status: 503, body: { message: 'alerts unavailable' } },
        'POST /alerts': () => { writes++; return ''; } });
    await page.goto('/alerts');
    await expect(page.getByText('No Alerts Configured', { exact: true })).toBeVisible();
    await choose(page, alert('Valid'));
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Import failed:');
    expect(writes).toBe(0);
});

test('alert import discards a name decision after session expiry', async ({ page }) => {
    let writes = 0;
    await mockEngine(page, { 'POST /alerts': () => { writes++; return ''; } });
    await page.goto('/alerts');
    await choose(page, alert('Invalid!'));
    await expect(page.getByRole('dialog', { name: 'Import Alert', exact: true })).toBeVisible();
    await expire(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toBe(0);
});

test('session expiry during the first alert write prevents subsequent writes and stale success', async ({ page }) => {
    let release!: () => void, writes = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, { 'POST /alerts': async () => { writes++; await gate; return ''; } });
    try {
        await page.goto('/alerts');
        await choose(page, `<list>${alert('First', 'one')}${alert('Last', 'two')}</list>`);
        await expect.poll(() => writes).toBe(1);
        await expire(page);
        const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/alerts');
        release();
        await response;
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page.locator('.toast-msg', { hasText: 'Imported' })).toHaveCount(0);
        expect(writes).toBe(1);
    } finally { release(); }
});
