import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const panels = [
    { tab: 'Server', path: '/server/settings', failure: 'Save failed:' },
    { tab: 'Administrator', path: '/users/1/preferences/backgroundColor', failure: 'Could not save background color:' },
    { tab: 'Tags', path: '/server/channelTags', failure: 'Save failed:' },
    { tab: 'Configuration Map', path: '/server/configurationMap', failure: 'Save failed:' },
    { tab: 'Resources', path: '/server/resources', failure: 'Save failed:' },
];
const fixtures = {
    'GET /server/settings': { serverSettings: { serverName: 'Original server' } },
    'GET /server/channelTags': { set: { channelTag: [{ id: 'tag-1', name: 'Original tag', channelIds: { string: [] } }] } },
    'GET /server/configurationMap': { map: { entry: [{ string: 'key', 'com.mirth.connect.util.ConfigurationProperty': { value: 'value', comment: '' } }] } },
    'GET /server/resources': { list: { 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties': [{
        id: 'Default Resource', name: 'Default Resource', type: 'Directory', pluginPointName: 'Directory Resource', directory: 'custom-lib',
    }] } },
};
const serverConfiguration = '<serverConfiguration version="4.6.0"><date>test backup</date></serverConfiguration>';

async function chooseConfig(page: any, button: string, content: string) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await chooser).setFiles({ name: 'settings.xml', mimeType: 'application/xml', buffer: Buffer.from(content) });
}

async function expire(page: any) {
    await page.route('**/api/server/version', (route: any) => route.fulfill({ status: 401, body: 'expired' }));
    await page.evaluate(async () => {
        const pkg = '@oie/web-api';
        await (await import(pkg)).default.get('/server/version').catch(() => {});
    });
    await expect(page.locator('.shell')).toHaveCount(0);
}
const settle = (page: any) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const dirty = (page: any) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});

test('Administrator failed background color retains the draft and blocks Save Changes until retry succeeds', async ({ page }) => {
    const writes: string[] = [];
    await mockEngine(page, fixtures);
    await page.route('**/api/users/1/preferences/backgroundColor', async route => {
        if (route.request().method() !== 'PUT') return route.fallback();
        writes.push(route.request().postData() || '');
        await route.fulfill({ status: writes.length === 1 ? 503 : 200, body: writes.length === 1 ? 'Synthetic color failure' : '' });
    });
    await page.goto('/settings?tab=administrator');
    await page.locator('select', { hasText: 'Server Default' }).selectOption('custom');
    const color = page.locator('input[type=color]');
    await color.fill('#ff8800');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Save Changes', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Could not save background color:');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page).toHaveURL(/\/settings\?tab=administrator$/);
    await expect(color).toHaveValue('#ff8800');
    await expect(page.locator('.toast-msg', { hasText: 'Preferences saved' })).toHaveCount(0);
    expect(await dirty(page)).toBe(true);
    expect(writes).toHaveLength(1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    await expect.poll(() => dirty(page)).toBe(false);
    expect(writes[1]).toBe(writes[0]);
    expect(writes[1]).toContain('<red>255</red>');
    expect(writes[1]).toContain('<green>136</green>');
    expect(writes[1]).toContain('<blue>0</blue>');
    await expect(page.locator('.toast-msg', { hasText: 'Preferences saved' })).toBeVisible();
});

for (const panel of panels) {
    for (const expired of [false, true]) {
        test(`${panel.tab} save ${expired ? 'discards completion after expiry' : 'still reports a current-session failure'}`, async ({ page }) => {
            await mockEngine(page, fixtures);
            let release!: () => void, writes = 0;
            const gate = new Promise<void>(resolve => { release = resolve; });
            await page.route(`**/api${panel.path}`, async route => {
                if (route.request().method() !== 'PUT') return route.fallback();
                writes++;
                await gate;
                await route.fulfill({ status: expired ? 200 : 503, body: expired ? '' : 'Synthetic settings failure' });
            });
            try {
                await page.goto(`/settings?tab=${encodeURIComponent(panel.tab)}`);
                await expect(page.getByRole('tab', { name: panel.tab, exact: true })).toHaveAttribute('data-state', 'active');
                await expect(page.locator('.tab-body .loading-block')).toHaveCount(0);
                await page.getByRole('button', { name: 'Save', exact: true }).click();
                await expect.poll(() => writes).toBe(1);
                if (expired) await expire(page);
                const completed = page.waitForResponse(response => response.request().method() === 'PUT'
                    && new URL(response.url()).pathname === `/api${panel.path}`);
                release();
                await completed;
                await settle(page);
                if (expired) {
                    await expect(page.getByRole('dialog')).toHaveCount(0);
                    await expect(page.locator('.toast-msg', { hasText: /saved|failed/i })).toHaveCount(0);
                    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
                    await expect(page).toHaveURL(/\/$/);
                } else {
                    const error = page.getByRole('dialog', { name: 'Error', exact: true });
                    await expect(error).toContainText(panel.failure);
                    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
                    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
                    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
                }
                expect(writes).toBe(1);
            } finally { release(); }
        });
    }
}

for (const panel of panels.filter(panel => panel.tab === 'Tags' || panel.tab === 'Resources')) {
    test(`${panel.tab} post-save refresh stops silently after expiry`, async ({ page }) => {
        await mockEngine(page, fixtures);
        let release!: () => void, saved = false, refreshing = false;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await page.route(`**/api${panel.path}`, async route => {
            if (route.request().method() === 'PUT') {
                saved = true;
                return route.fulfill({ status: 200, body: '' });
            }
            if (!saved) return route.fallback();
            refreshing = true;
            await gate;
            await route.fulfill({ status: 503, body: 'Late refresh failure' });
        });
        try {
            await page.goto(`/settings?tab=${panel.tab}`);
            await expect(page.getByRole('tab', { name: panel.tab, exact: true })).toHaveAttribute('data-state', 'active');
            await expect(page.locator('.tab-body .loading-block')).toHaveCount(0);
            await page.getByRole('button', { name: 'Save', exact: true }).click();
            await expect.poll(() => refreshing).toBe(true);
            await expire(page);
            const completed = page.waitForResponse(response => response.request().method() === 'GET'
                && new URL(response.url()).pathname === `/api${panel.path}`);
            release();
            await completed;
            await settle(page);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
            await expect(page).toHaveURL(/\/$/);
        } finally { release(); }
    });
}

for (const expired of [false, true]) {
    for (const outcome of ['load', 'error']) {
        test(`Configuration Map file ${outcome} ${expired ? 'is discarded after expiry' : 'completes in the current editor'}`, async ({ page }) => {
            await page.addInitScript(outcome => {
                const read = FileReader.prototype.readAsText;
                FileReader.prototype.readAsText = function (...args) {
                    (window as any).completeMapRead = () => new Promise<void>(resolve => {
                        if (outcome === 'error') { this.dispatchEvent(new ProgressEvent('error')); resolve(); }
                        else {
                            this.addEventListener('loadend', () => resolve(), { once: true });
                            read.apply(this, args);
                        }
                    });
                };
            }, outcome);
            await mockEngine(page, fixtures);
            await page.goto('/settings?tab=Configuration%20Map');
            const chooser = page.waitForEvent('filechooser');
            await page.getByRole('button', { name: 'Import Map', exact: true }).click();
            await (await chooser).setFiles({ name: 'settings.properties', mimeType: 'text/plain', buffer: Buffer.from('key=imported value\n') });
            await expect.poll(() => page.evaluate(() => typeof (window as any).completeMapRead)).toBe('function');
            if (expired) await expire(page);
            await page.evaluate(() => (window as any).completeMapRead());
            await settle(page);
            if (expired) {
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
                expect(await dirty(page)).toBe(false);
            } else if (outcome === 'error') {
                await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Import failed:');
                expect(await dirty(page)).toBe(false);
            } else {
                await page.getByRole('dialog', { name: 'Import Configuration Map', exact: true })
                    .getByRole('button', { name: 'Import', exact: true }).click();
                await expect(page.locator('input[value="imported value"]')).toBeVisible();
                expect(await dirty(page)).toBe(true);
            }
        });
    }
}

test('Configuration Map import confirmation cannot change the draft after expiry', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/settings?tab=Configuration%20Map');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Map', exact: true }).click();
    await (await chooser).setFiles({ name: 'settings.properties', mimeType: 'text/plain', buffer: Buffer.from('key=imported value\n') });
    await expect(page.getByRole('dialog', { name: 'Import Configuration Map', exact: true })).toBeVisible();
    await expire(page);
    await settle(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.toast-msg', { hasText: 'Imported' })).toHaveCount(0);
    expect(await dirty(page)).toBe(false);
});

for (const exportCase of [
    { tab: 'Configuration%20Map', button: 'Export Map', content: 'key=value\n' },
    { tab: 'Server', button: 'Backup Config', content: '<serverConfiguration/>' },
]) {
for (const expired of [false, true]) {
    test(`${exportCase.button} picker ${expired ? 'is discarded after expiry' : 'writes the current configuration'}`, async ({ page }) => {
        await page.addInitScript(() => {
            (window as any).mapExportEvents = [];
            (window as any).showSaveFilePicker = () => new Promise(resolve => {
                (window as any).completeMapPicker = () => resolve({ createWritable: async () => ({
                    write: async (content: Blob) => (window as any).mapExportEvents.push(['write', await content.text()]),
                    close: async () => (window as any).mapExportEvents.push(['close']),
                    abort: async () => (window as any).mapExportEvents.push(['abort']),
                }) });
            });
        });
        await mockEngine(page, { ...fixtures, 'GET /server/configuration': '<serverConfiguration/>' });
        await page.goto(`/settings?tab=${exportCase.tab}`);
        await expect(page.locator('.tab-body .loading-block')).toHaveCount(0);
        await page.getByRole('button', { name: exportCase.button, exact: true }).click();
        await expect.poll(() => page.evaluate(() => typeof (window as any).completeMapPicker)).toBe('function');
        if (expired) await expire(page);
        await page.evaluate(() => (window as any).completeMapPicker());
        await settle(page);
        expect(await page.evaluate(() => (window as any).mapExportEvents)).toEqual(expired ? [] : [['write', exportCase.content], ['close']]);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}
}

for (const expired of [false, true]) {
    test(`Server restore file read ${expired ? 'is discarded after expiry' : 'opens the existing restore confirmation'}`, async ({ page }) => {
        await page.addInitScript(() => {
            const read = FileReader.prototype.readAsText;
            FileReader.prototype.readAsText = function (...args) {
                (window as any).completeRestoreRead = () => new Promise<void>(resolve => {
                    this.addEventListener('loadend', () => resolve(), { once: true });
                    read.apply(this, args);
                });
            };
        });
        await mockEngine(page, fixtures);
        await page.goto('/settings');
        await chooseConfig(page, 'Restore Config', serverConfiguration);
        await expect.poll(() => page.evaluate(() => typeof (window as any).completeRestoreRead)).toBe('function');
        if (expired) await expire(page);
        await page.evaluate(() => (window as any).completeRestoreRead());
        await settle(page);
        if (expired) {
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        } else {
            await expect(page.getByRole('dialog', { name: 'Restore Server Configuration', exact: true })).toBeVisible();
        }
    });
}

const actions = [
    { tab: 'Server', button: 'Restore Config', confirm: 'Restore Server Configuration', accept: 'Restore', path: '/server/configuration', method: 'PUT' },
    { tab: 'Server', button: 'Send Test Email', confirm: 'Send Test Email', accept: 'Send', path: '/server/_testEmail', method: 'POST' },
    { tab: 'Server', button: 'Clear All Statistics', confirm: 'Clear All Statistics', accept: 'Clear', path: '/channels/_clearAllStatistics', method: 'POST' },
    { tab: 'Resources', button: 'Reload Resource', select: 'Default Resource', path: '/server/resources/Default%20Resource/_reload', method: 'POST' },
    { tab: 'Database Tasks', button: 'Run Task', select: 'Compact tables', confirm: 'Run Database Task', accept: 'Run', path: '/databaseTasks/task-1/_run', method: 'POST' },
    { tab: 'Database Tasks', button: 'Cancel Task', select: 'Compact tables', path: '/databaseTasks/task-1/_cancel', method: 'POST' },
];
for (const action of actions) {
    for (const expired of [false, true]) {
        test(`${action.button} ${expired ? 'discards completion after expiry' : 'reports a current-session failure'}`, async ({ page }) => {
            let taskReads = 0;
            await mockEngine(page, { ...fixtures, 'GET /databaseTasks': () => {
                taskReads++;
                return { map: { entry: [{ string: 'task-1', databaseTask: {
                    id: 'task-1', name: 'Compact tables', description: '', status: action.button === 'Cancel Task' ? 'RUNNING' : 'IDLE',
                } }] } };
            } });
            let release!: () => void, writes = 0;
            const gate = new Promise<void>(resolve => { release = resolve; });
            await page.route(`**/api${action.path}*`, async route => {
                if (route.request().method() !== action.method) return route.fallback();
                writes++;
                await gate;
                await route.fulfill({ status: expired ? 200 : 503, body: expired ? '' : 'Synthetic action failure' });
            });
            try {
                await page.goto(`/settings?tab=${encodeURIComponent(action.tab)}`);
                await expect(page.locator('.tab-body .loading-block')).toHaveCount(0);
                if (action.select) await page.getByRole('cell', { name: action.select, exact: true }).click();
                if (action.button === 'Restore Config') await chooseConfig(page, action.button, serverConfiguration);
                else await page.getByRole('button', { name: action.button, exact: true }).click();
                if (action.confirm) await page.getByRole('dialog', { name: action.confirm, exact: true })
                    .getByRole('button', { name: action.accept, exact: true }).click();
                await expect.poll(() => writes).toBe(1);
                if (expired) await expire(page);
                const completed = page.waitForResponse(response => response.request().method() === action.method
                    && new URL(response.url()).pathname === `/api${action.path}`);
                release();
                await completed;
                await settle(page);
                if (expired) {
                    await expect(page.getByRole('dialog')).toHaveCount(0);
                    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
                    await expect(page.locator('.toast-msg')).toHaveCount(0);
                    if (action.tab === 'Database Tasks') expect(taskReads).toBe(1);
                } else {
                    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Synthetic action failure');
                }
                expect(writes).toBe(1);
            } finally { release(); }
        });
    }
}
