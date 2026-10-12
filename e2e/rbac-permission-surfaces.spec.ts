import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

// Test the host/plugin contract without reaching into a separate RBAC checkout.
// RBAC's own suite verifies the permission-name mapping used by this contract.
async function authorization(page: any, denied: string[] = []) {
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        const response = await route.fetch();
        const manifests = await response.json();
        manifests.push({ id: 'test-permissions', entry: '/plugins/test-permissions/entry.js' });
        await route.fulfill({ json: manifests });
    });
    await page.route('**/plugins/test-permissions/entry.js*', (route: any) => route.fulfill({
        contentType: 'application/javascript', body: `export function register(p) {
            window.testDenied = ${JSON.stringify(denied)};
            p.setAuthorizationController({checkTask: (g,t) => !window.testDenied.includes(g+'/'+t)});
            window.updateTestPermissions = (denied, notify = true) => {
                window.testDenied = denied;
                if (notify) p.store.setState('webPlugins', [...(p.store.getState('webPlugins') || [])]);
            };
            window.addTestPanel = () => {
                if (!p.settingsPanels().some(panel => panel.label === 'Roles')) {
                    p.registerSettingsPanel({label: 'Roles', component: () => p.React.createElement('div', {}, 'Recovered roles panel')});
                }
                p.store.setState('webPlugins', [...(p.store.getState('webPlugins') || [])]);
            };
        }`,
    }));
}
const mutationTasks = ['doSave', 'doStart', 'doStop'].map(task => 'settings_Data Pruner/' + task);
const field = (page: any, label: string) => page.locator('.field', { has: page.getByText(label, { exact: true }) }).locator('input').first();
const update = (page: any, denied: string[], notify = true) => page.evaluate(({ denied, notify }: any) =>
    (window as any).updateTestPermissions(denied, notify), { denied, notify });
const palette = async (page: any, query: string) => {
    await page.keyboard.press('Control+k');
    await page.locator('.cmdk-field input').fill(query);
};

const prunerStatus = (running: boolean) => ({ map: { entry: [{ string: ['isRunning', String(running)] }] } });

async function pruner(page: any, denied: string[] = [], status: any = prunerStatus(false)) {
    const requests: string[] = [];
    await authorization(page, denied);
    await mockEngine(page, {
        'GET /extensions/Data%20Pruner/properties': () => {
            requests.push('read');
            return { properties: { property: [
                { '@name': 'pruningBlockSize', $: '1000' }, { '@name': 'maxEventAge', $: '30' }
            ] } };
        },
        'PUT /extensions/Data%20Pruner/properties': () => { requests.push('save'); return ''; },
        'GET /extensions/datapruner/status': () => typeof status === 'function' ? status() : status,
        'POST /extensions/datapruner/_start': () => { requests.push('start'); return ''; },
        'POST /extensions/datapruner/_stop': () => { requests.push('stop'); return ''; },
    });
    await page.goto('/settings?tab=datapruner');
    await expect(field(page, 'Block Size')).toHaveValue('1000');
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    return requests;
}

test('script and template navigation obey permissions in the rail and an open palette', async ({ page }) => {
    await authorization(page);
    await mockEngine(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Global Scripts', exact: true })).toBeVisible();
    await palette(page, '/');
    await expect(page.locator('.cmdk-opt', { hasText: 'Global Scripts' })).toHaveCount(1);
    await update(page, ['channel/doEditGlobalScripts', 'channel/doEditCodeTemplates']);
    for (const name of ['Global Scripts', 'Code Templates']) {
        await expect(page.locator('.cmdk-opt', { hasText: name })).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    for (const name of ['Global Scripts', 'Code Templates']) {
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
});

test('Settings commands share the tab visibility predicate and resolve spaced labels', async ({ page }) => {
    const hidden = ['Server', 'Configuration Map', 'Database Tasks', 'Resources', 'Data Pruner'];
    await authorization(page, hidden.flatMap(label => ['doRefresh', 'doSave'].map(task => `settings_${label}/${task}`)));
    await mockEngine(page);
    await page.goto('/settings');
    await expect(page.getByRole('tab', { name: 'Administrator', exact: true })).toBeVisible();
    for (const name of hidden) await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0);
    await palette(page, '>Settings:');
    for (const name of hidden) {
        await expect(page.locator('.cmdk-opt', { hasText: `Settings: ${name}` })).toHaveCount(0);
    }
    await update(page, []);
    await page.locator('.cmdk-opt', { hasText: 'Settings: Configuration Map' }).click();
    await expect(page.getByRole('tab', { name: 'Configuration Map', exact: true })).toHaveAttribute('data-state', 'active');
    await palette(page, '>Settings: Database Tasks');
    await page.locator('.cmdk-opt', { hasText: 'Settings: Database Tasks' }).click();
    await expect(page.getByRole('tab', { name: 'Database Tasks', exact: true })).toHaveAttribute('data-state', 'active');
});

test('late panels and recovered earlier tabs preserve the active Data Pruner draft', async ({ page }) => {
    await pruner(page, ['settings_Server/doRefresh', 'settings_Server/doSave']);
    await field(page, 'Block Size').fill('2500');
    await update(page, []);
    await page.evaluate(() => { (window as any).addTestPanel(); (window as any).addTestPanel(); });
    await expect(page.getByRole('tab', { name: 'Server', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles', exact: true })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: /Data Pruner/ })).toHaveAttribute('data-state', 'active');
    await expect(field(page, 'Block Size')).toHaveValue('2500');
    await palette(page, '>Settings: Roles');
    const rolesCommand = page.locator('.cmdk-opt', { hasText: 'Settings: Roles' });
    await expect(rolesCommand).toHaveCount(1);
    await update(page, ['settings_Roles/doRefresh', 'settings_Roles/doSave']);
    await expect(rolesCommand).toHaveCount(0);
    await update(page, []);
    await expect(rolesCommand).toHaveCount(1);
    await rolesCommand.click();
    await page.getByRole('dialog', { name: 'Unsaved Changes' }).getByRole('button', { name: "Don't Save", exact: true }).click();
    await expect(page.getByText('Recovered roles panel')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Roles', exact: true })).toHaveAttribute('data-state', 'active');
});

test('view-only Data Pruner offers Refresh, read-only fields and no forbidden mutations or Events', async ({ page }) => {
    const requests = await pruner(page, [...mutationTasks, 'view/doShowEvents']);
    for (const name of ['Save', 'Prune Now', 'Stop Pruner', 'View Events']) {
        await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(field(page, 'Block Size')).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests).toEqual(['read', 'read']);
});

test('Data Pruner rechecks stale Save and confirmation permissions before sending requests', async ({ page }) => {
    const requests = await pruner(page);
    await field(page, 'Block Size').fill('2500');
    // No notification: intentionally leave the rendered buttons stale.
    await update(page, ['settings_Data Pruner/doSave'], false);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect(requests).toEqual(['read']);
    await page.getByRole('button', { name: 'Prune Now', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Prune Now', exact: true })).toBeVisible();
    await update(page, mutationTasks, false);
    await page.getByRole('dialog', { name: 'Prune Now', exact: true }).getByRole('button', { name: 'Start', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Prune Now', exact: true })).toHaveCount(0);
    expect(requests).toEqual(['read']);
});

for (const status of [{}, { __status: 503 }]) {
    test(`Data Pruner refuses Start and Stop with ${'__status' in status ? 'failed' : 'unknown'} status`, async ({ page }) => {
        const requests = await pruner(page, [], status);
        for (const name of ['Prune Now', 'Stop Pruner']) {
            const button = page.getByRole('button', { name, exact: true });
            await expect(button).toBeDisabled();
            await button.dispatchEvent('click');
        }
        expect(requests).toEqual(['read']);
    });
}

test('Data Pruner serializes control operations with Save and Refresh, then exposes the matching running action', async ({ page }) => {
    let running = false;
    const requests = await pruner(page, [], () => prunerStatus(running));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    await page.route('**/api/extensions/datapruner/_start', async route => {
        starts++;
        await gate;
        running = true;
        await route.fulfill({ body: '' });
    });
    try {
        await expect(page.getByRole('button', { name: 'Stop Pruner', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Prune Now', exact: true }).click();
        await page.getByRole('dialog', { name: 'Prune Now', exact: true }).getByRole('button', { name: 'Start', exact: true }).click();
        await expect.poll(() => starts).toBe(1);
        for (const name of ['Prune Now', 'Stop Pruner', 'Refresh', 'Save']) {
            const button = page.getByRole('button', { name, exact: true });
            await expect(button).toBeDisabled();
            await button.dispatchEvent('click');
        }
        expect(starts).toBe(1);
        expect(requests).toEqual(['read']);
        release();
        await expect(page.getByRole('button', { name: 'Stop Pruner', exact: true })).toBeEnabled();
        await expect(page.getByRole('button', { name: 'Prune Now', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Stop Pruner', exact: true }).click();
        await expect.poll(() => requests.includes('stop')).toBe(true);
    } finally { release(); }
});

for (const resource of ['properties', 'status']) {
    test(`Data Pruner settles a revoked pending ${resource} read and can refresh after recovery`, async ({ page }) => {
        await pruner(page);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        let reads = 0;
        const endpoint = resource === 'properties' ? 'Data%20Pruner/properties' : 'datapruner/status';
        await page.route('**/api/extensions/' + endpoint, async route => {
            if (route.request().method() !== 'GET') return route.fallback();
            reads++;
            await gate;
            await route.fulfill({ json: resource === 'properties'
                ? { properties: { property: [{ '@name': 'pruningBlockSize', $: '9999' }] } }
                : prunerStatus(false) });
        });
        try {
            await page.getByRole('button', { name: 'Refresh', exact: true }).click();
            await expect.poll(() => reads).toBe(1);
            await update(page, ['settings_Data Pruner/doRefresh']);
            release();
            const detail = resource === 'properties' ? 'settings' : 'status';
            await expect(page.getByText(`You do not have permission to view Data Pruner ${detail}.`, { exact: true })).toBeVisible();
            await expect(page.locator('.loading-block')).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Prune Now', exact: true })).toBeDisabled();
            if (resource === 'properties') await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
            await update(page, []);
            await page.getByRole('button', { name: 'Refresh', exact: true }).click();
            await expect.poll(() => reads).toBe(2);
            await expect(page.getByRole('button', { name: 'Prune Now', exact: true })).toBeEnabled();
            await expect(field(page, 'Block Size')).toHaveValue(resource === 'properties' ? '9999' : '1000');
        } finally { release(); }
    });
}
