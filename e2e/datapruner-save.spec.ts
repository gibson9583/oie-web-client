import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const properties = {
    enabled: 'true', pruningBlockSize: '1000', pruneEvents: 'false', maxEventAge: '30',
    archiveEnabled: 'true', archiverBlockSize: '1000', includeAttachments: '<boolean>false</boolean>',
    pollingProperties: '<pollConnectorProperties><pollingType>INTERVAL</pollingType><pollingFrequency>3600000</pollingFrequency><unknownSchedule>preserved</unknownSchedule></pollConnectorProperties>',
    archiverOptions: '<messageWriterOptions><rootFolder>/original</rootFolder><filePattern>message.xml</filePattern><unknownArchiver>preserved</unknownArchiver></messageWriterOptions>',
    unknownProperty: 'preserved verbatim',
};
const field = (page: any, label: string) => page.locator('.field', {
    has: page.getByText(label, { exact: true }),
}).locator('input').first();
const dirty = (page: any) => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
const settle = (page: any) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function setup(page: any, failFirst = false) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writes: Record<string, string>[] = [];
    let reads = 0;
    await mockEngine(page, {
        'GET /extensions/Data%20Pruner/properties': () => {
            reads++;
            return { properties: { property: Object.entries(properties).map(([name, value]) => ({ '@name': name, $: value })) } };
        },
        'GET /extensions/datapruner/status': {},
        'GET /server/settings': { serverSettings: { serverName: 'Original server' } },
    });
    await page.route('**/api/extensions/Data%20Pruner/properties', async (route: any) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        const body = route.request().postDataJSON();
        writes.push(Object.fromEntries((body.properties || body).property.map((p: any) => [p['@name'], p.$])));
        const first = writes.length === 1;
        if (first) await gate;
        await route.fulfill({ status: first && failFirst ? 503 : 200,
            body: first && failFirst ? 'Synthetic Data Pruner failure' : '' });
    });
    await page.goto('/');
    await expect.poll(() => page.evaluate(async () => {
        const pkg = '@oie/web-shell';
        return (await import(pkg)).platform.settingsPanels().filter((panel: any) => panel.label === 'Data Pruner').length;
    })).toBe(1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Data Pruner', exact: true }).click();
    await expect(field(page, 'Block Size')).toHaveValue('1000');
    return { writes, release, reads: () => reads };
}

for (const fail of [false, true]) {
    test(`Data Pruner retains newer edits after ${fail ? 'failed' : 'successful'} save and saves them on retry`, async ({ page }) => {
        const pending = await setup(page, fail);
        try {
            await field(page, 'Block Size').fill('2000');
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect.poll(() => pending.writes.length).toBe(1);
            await field(page, 'Block Size').fill('3000');
            await field(page, 'Interval').fill('2');
            await field(page, 'Root Path').fill('/newer');
            await settle(page);
            for (const name of ['Save', 'Refresh']) {
                const button = page.getByRole('button', { name, exact: true });
                await expect(button).toBeDisabled();
                // Dispatch bypasses native disabled-button clicks; the operation latch still refuses it.
                await button.dispatchEvent('click');
            }
            expect(pending.writes).toHaveLength(1);
            expect(pending.reads()).toBe(1);
            pending.release();
            if (fail) {
                const error = page.getByRole('dialog', { name: 'Error', exact: true });
                await expect(error).toContainText('Save failed:');
                await error.getByRole('button', { name: 'Close', exact: true }).last().click();
            } else await expect(page.locator('.toast-msg', { hasText: 'Data Pruner settings saved' })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
            expect(pending.writes[0].pruningBlockSize).toBe('2000');
            await expect(field(page, 'Block Size')).toHaveValue('3000');
            await settle(page);
            expect(await dirty(page)).toBe(true);
            let warned = false;
            const dismiss = async (dialog: any) => { warned = true; await dialog.dismiss(); };
            page.on('dialog', dismiss);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(error => { if (!warned) throw error; });
            page.off('dialog', dismiss);
            expect(warned).toBe(true);
            await expect(field(page, 'Root Path')).toHaveValue('/newer');

            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect.poll(() => pending.writes.length).toBe(2);
            await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
            await expect.poll(() => dirty(page)).toBe(false);
            expect(pending.writes[1]).toMatchObject({ pruningBlockSize: '3000', unknownProperty: properties.unknownProperty });
            expect(pending.writes[1].pollingProperties).toContain('<pollingFrequency>7200000</pollingFrequency>');
            expect(pending.writes[1].pollingProperties).toContain('<unknownSchedule>preserved</unknownSchedule>');
            expect(pending.writes[1].archiverOptions).toContain('<rootFolder>/newer</rootFolder>');
            expect(pending.writes[1].archiverOptions).toContain('<unknownArchiver>preserved</unknownArchiver>');
        } finally { pending.release(); }
    });
}

test('Data Pruner becomes clean when pending edits return to the submitted values', async ({ page }) => {
    const pending = await setup(page);
    try {
        await field(page, 'Block Size').fill('2000');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => pending.writes.length).toBe(1);
        await field(page, 'Block Size').fill('3000');
        await field(page, 'Block Size').fill('2000');
        pending.release();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
        await expect.poll(() => dirty(page)).toBe(false);
        await field(page, 'Block Size').fill('1000');
        await expect.poll(() => dirty(page)).toBe(true);
    } finally { pending.release(); }
});

test('Data Pruner Save Changes refuses navigation when newer edits still need saving', async ({ page }) => {
    const pending = await setup(page);
    try {
        await field(page, 'Block Size').fill('2000');
        await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
        await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
            .getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => pending.writes.length).toBe(1);
        await field(page, 'Block Size').fill('3000');
        pending.release();
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
        await expect(page).toHaveURL(/\/settings$/);
        await expect(field(page, 'Block Size')).toHaveValue('3000');
        expect(await dirty(page)).toBe(true);
    } finally { pending.release(); }
});

test('Data Pruner completion after discarding its panel cannot clear another settings draft', async ({ page }) => {
    const pending = await setup(page);
    try {
        await field(page, 'Block Size').fill('2000');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => pending.writes.length).toBe(1);
        await page.getByRole('tab', { name: 'Server', exact: true }).click();
        await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
            .getByRole('button', { name: "Don't Save", exact: true }).click();
        await field(page, 'Server name').fill('New server draft');
        await settle(page);
        const completed = page.waitForResponse((response: any) => response.request().method() === 'PUT'
            && response.url().includes('/extensions/Data%20Pruner/properties'));
        pending.release();
        await completed;
        await settle(page);
        expect(await dirty(page)).toBe(true);
        await expect(field(page, 'Server name')).toHaveValue('New server draft');
        await expect(page.locator('.toast-msg', { hasText: 'Data Pruner settings saved' })).toHaveCount(0);
    } finally { pending.release(); }
});

for (const fail of [false, true]) {
test(`Data Pruner pending ${fail ? 'failed' : 'successful'} completion stays silent after session expiry ends the view`, async ({ page }) => {
    const pending = await setup(page, fail);
    try {
        await field(page, 'Block Size').fill('2000');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect.poll(() => pending.writes.length).toBe(1);
        await page.route('**/api/server/settings', route => route.fulfill({ status: 401, body: 'expired' }));
        await page.evaluate(async () => {
            const pkg = '@oie/web-api';
            await (await import(pkg)).default.get('/server/settings').catch(() => {});
        });
        await expect(page.locator('.shell')).toHaveCount(0);
        const completed = page.waitForResponse(response => response.request().method() === 'PUT'
            && response.url().includes('/extensions/Data%20Pruner/properties'));
        pending.release();
        await completed;
        await settle(page);
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/$/);
    } finally { pending.release(); }
});
}
