import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const ID = 'c-stopped';
const channel = (id = ID, name = 'Saved inspection channel') => ({
    '@version': '4.6.0', id, name, revision: 3, description: 'SAVED_CHANNEL_DESCRIPTION',
    sourceConnector: { metaDataId: 0, name: 'Source', transportName: 'Channel Reader', enabled: true,
        properties: { sourceConnectorProperties: { respondAfterProcessing: true, responseVariable: 'None' } },
        filter: { elements: '' }, transformer: { elements: '', inboundDataType: 'RAW', outboundDataType: 'RAW' } },
    destinationConnectors: { connector: [] }, preprocessingScript: 'return message;',
    properties: { attachmentProperties: { type: 'None' } }
});

// The shipped RBAC task map uses view/doShowChannel -> viewChannels, while
// channel/doEditChannel and channelEdit mutations require manageChannels.
async function permissions(page: any, { viewer = true, denied = [] as string[], seedDraft = false, pluginTab = false } = {}) {
    await page.route('**/webadmin/plugins.json', async (route: any) => {
        const response = await route.fetch();
        const manifests = await response.json();
        manifests.push({ id: 'inspector-permissions', entry: '/plugins/inspector-permissions/entry.js' });
        await route.fulfill({ json: manifests });
    });
    await page.route('**/plugins/inspector-permissions/entry.js*', (route: any) => route.fulfill({
        contentType: 'application/javascript', body: `export function register(p) {
            window.inspectorDenied = ${JSON.stringify(denied)};
            p.setAuthorizationController({checkTask: (group, task) => {
                if (window.inspectorDenied.includes(group+'/'+task)) return false;
                if (!${viewer}) return true;
                if (group === 'channelEdit') return false;
                if (group === 'channel') return ['doRefreshChannels','doExportAllChannels','doExportChannel'].includes(task);
                return true;
            }});
            window.inspectorPermissions = (denied, notify = true) => {
                window.inspectorDenied = denied;
                if (notify) p.store.setState('webPlugins', [...(p.store.getState('webPlugins') || [])]);
            };
            window.inspectorNavigate = path => p.router.navigate(path);
            window.inspectorDraft = () => JSON.stringify({channel:p.store.getState('editingChannel'), dirty:p.store.getState('editingChannelDirty'), isNew:p.store.getState('editingChannelNew')});
            ${seedDraft ? `p.store.setState('editingChannel', ${JSON.stringify({ ...channel(), description: 'EDITOR_MODEL_ONLY' })}); p.store.setState('editingChannelDirty', false); p.store.setState('editingChannelNew', false);` : ''}
            ${pluginTab ? "p.registerChannelTab({id:'after-inspector',label:'Plugin tab',component:()=>p.React.createElement('div',{},'Plugin content')});" : ''}
        }`
    }));
}

const updatePermissions = (page: any, denied: string[], notify = true) => page.evaluate(
    ({ denied, notify }: any) => (window as any).inspectorPermissions(denied, notify), { denied, notify });
const navigate = (page: any, path: string) => page.evaluate((path: string) => (window as any).inspectorNavigate(path), path);

test('channel viewers inspect saved source without editor state, edit controls or writes', async ({ page }, info) => {
    await permissions(page, { seedDraft: true });
    const requests: string[] = [];
    const saved: any = channel();
    saved.sourceConnector.properties.sourceConnectorProperties.processBatch = true;
    saved.sourceConnector.transformer.inboundDataType = 'DELIMITED';
    saved.sourceConnector.transformer.inboundProperties = { batchProperties: { splitType: 'JavaScript', batchScript: 'return reader.readLine();' } };
    await mockEngine(page, {
        [`GET /channels/${ID}`]: { channel: saved },
        [`GET /channels/${ID}/status`]: { __status: 403 },
        'GET /server/channelDependencies': { set: { channelDependency: [{ dependentId: ID, dependencyId: 'prerequisite' }] } },
        'GET /channels/idsAndNames': { map: { entry: [{ string: ['prerequisite', 'Inbound prerequisites'] }] } },
        'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{ id: 'helpers', name: 'Inspection helpers', enabledChannelIds: { string: [ID] }, codeTemplates: { codeTemplate: [{ id: 'normalize', name: 'Normalize input' }] } }] } }
    });
    page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.method() + ' ' + new URL(request.url()).pathname); });
    await page.goto(`/channels/${ID}/inspect`);
    await expect(page.locator('.ci-root')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.ci-desc')).toHaveText('SAVED_CHANNEL_DESCRIPTION');
    await expect(page.locator('.ci-from').first()).toContainText('Saved channel');
    await expect(page.locator('.ci-from').first()).toContainText('Deployment status unavailable.');
    await expect(page.getByText('Global scripts unavailable with your permissions.')).toBeVisible();
    const draft = await page.evaluate(() => (window as any).inspectorDraft());
    expect(draft).toContain('EDITOR_MODEL_ONLY');
    await expect(page.getByRole('tablist', { name: 'Channel sections' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Open in |Save Changes|Deploy Channel|Debug Channel)/ })).toHaveCount(0);
    await expect(page.locator('#ci-dependencies')).toContainText('Inbound prerequisites');
    await expect(page.locator('#ci-dependencies')).toContainText('Inspection helpers');
    if (info.project.name === 'ui') {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.getByPlaceholder('Find in channel').fill('reader.readLine');
        await expect(page.locator('#ci-batch .ci-code')).toBeVisible();
        await page.screenshot({ path: info.outputPath('standalone-desktop.png') });
        await page.getByRole('button', { name: 'Hide navigation', exact: true }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByPlaceholder('Find in channel').fill('Inspection helpers');
        await page.getByPlaceholder('Find in channel').press('Enter');
        await expect(page.locator('#ci-dependencies')).toBeVisible();
        expect(await page.locator('.ci-root').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('standalone-mobile.png') });
        await page.setViewportSize({ width: 1280, height: 720 });
    }
    await page.getByPlaceholder('Find in channel').fill('return message');
    await expect(page.locator('#ci-preprocess .ci-code')).toBeVisible();
    await page.getByRole('button', { name: 'Print', exact: true }).click();
    await expect(page.locator('.ci-print-paper')).toContainText('Saved channel');
    await expect(page.locator('.ci-print-paper')).not.toContainText('current editor');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Reload channel', exact: true }).click();
    await expect(page.locator('.ci-root')).toBeVisible();
    expect(await page.evaluate(() => (window as any).inspectorDraft())).toBe(draft);
    expect(requests.filter(request => !request.startsWith('GET '))).toEqual([]);
    expect(requests.some(request => request.includes('/server/globalScripts'))).toBe(false);
    await navigate(page, `/channels/${ID}/edit`);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
});

test('viewers enter the standalone Inspector from Channels and Dashboard', async ({ page }) => {
    await permissions(page);
    await mockEngine(page, { [`GET /channels/${ID}`]: { channel: channel() } });
    await page.goto('/channels');
    await page.getByText('Demo Stopped', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Inspect Channel', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${ID}/inspect$`));
    await expect(page.locator('.ci-root')).toBeVisible();
    await page.getByRole('button', { name: 'Back to Channels', exact: true }).click();
    await page.getByText('Demo Stopped', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Inspect Channel', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${ID}/inspect$`));
    await expect(page.locator('.ci-root')).toBeVisible();
    await navigate(page, '/dashboard');
    await page.getByText('Demo Stopped', { exact: true }).click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Edit Channel', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Inspect Channel', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${ID}/inspect$`));
    await expect(page.locator('.ci-root')).toBeVisible();
});

test('a denied direct Inspector route makes no channel or global requests', async ({ page }) => {
    await permissions(page, { denied: ['view/doShowChannel'] });
    const requests: string[] = [];
    await mockEngine(page);
    page.on('request', request => { requests.push(new URL(request.url()).pathname); });
    await page.goto(`/channels/${ID}/inspect`);
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    expect(requests.filter(path => path.startsWith(`/api/channels/${ID}`) || path === '/api/server/globalScripts')).toEqual([]);
});

for (const failure of ['redacted', 'forbidden', 'server error']) {
    test(`standalone Inspector explains ${failure} and retries the channel read`, async ({ page }) => {
        await permissions(page);
        let failed = true;
        await mockEngine(page, { [`GET /channels/${ID}`]: () => failed
            ? failure === 'redacted' ? '' : { __status: failure === 'forbidden' ? 403 : 500 }
            : { channel: channel() } });
        await page.goto(`/channels/${ID}/inspect`);
        await expect(page.locator('.view-body .dt-empty[role="alert"]')).toContainText(failure === 'server error' ? 'could not be loaded' : 'permissions');
        await expect(page.locator('.ci-root')).toHaveCount(0);
        failed = false;
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(page.locator('.ci-desc')).toHaveText('SAVED_CHANNEL_DESCRIPTION');
    });
}

test('a pending read observes action-time permission loss and can recover', async ({ page }) => {
    await permissions(page);
    let release!: () => void, reads = 0;
    const pending = new Promise<void>(resolve => release = resolve);
    await mockEngine(page, { [`GET /channels/${ID}`]: async () => { reads++; await pending; return { channel: channel() }; } });
    await page.goto(`/channels/${ID}/inspect`);
    await expect.poll(() => reads).toBe(1);
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Loading channel' })).toBeVisible();
    try {
        await updatePermissions(page, ['view/doShowChannel'], false);
        release();
        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
        await expect(page.locator('.ci-root')).toHaveCount(0);
        await updatePermissions(page, []);
        await expect(page.locator('.ci-desc')).toHaveText('SAVED_CHANNEL_DESCRIPTION');
        expect(reads).toBeGreaterThan(1);
        const beforeDeniedReload = reads;
        await updatePermissions(page, ['view/doShowChannel'], false);
        await page.getByRole('button', { name: 'Reload channel', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
        expect(reads).toBe(beforeDeniedReload);
        await updatePermissions(page, []);
        await expect(page.locator('.ci-desc')).toHaveText('SAVED_CHANNEL_DESCRIPTION');
        await updatePermissions(page, ['view/doShowChannel']);
        await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
        await expect(page.locator('.ci-root')).toHaveCount(0);
    } finally { release(); }
});

test('late reads cannot replace a newly selected channel', async ({ page }) => {
    await permissions(page);
    let release!: () => void, started = false;
    const pending = new Promise<void>(resolve => release = resolve);
    await mockEngine(page, {
        [`GET /channels/${ID}`]: async () => { started = true; await pending; return { channel: channel(ID, 'Old channel') }; },
        'GET /channels/new-selection': { channel: channel('new-selection', 'New channel') }
    });
    await page.goto(`/channels/${ID}/inspect`);
    await expect.poll(() => started).toBe(true);
    try {
        await navigate(page, '/channels/new-selection/inspect');
        await expect(page.getByRole('heading', { name: 'New channel', exact: true })).toBeVisible();
        const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/channels/${ID}`);
        release();
        await (await oldResponse).finished();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await expect(page.locator('.ci-root')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Old channel', exact: true })).toHaveCount(0);
    } finally { release(); }
});

test('a read from a discarded session cannot publish channel content', async ({ page }) => {
    await permissions(page);
    let release!: () => void, started = false;
    const pending = new Promise<void>(resolve => release = resolve);
    await mockEngine(page, { [`GET /channels/${ID}`]: async () => { started = true; await pending; return { channel: channel() }; } });
    await page.goto(`/channels/${ID}/inspect`);
    await expect.poll(() => started).toBe(true);
    try {
        await page.evaluate(async () => (await import(String('/core/engine-fetch.js'))).discardEngineResponses());
        release();
        await expect(page.locator('.view-body .dt-empty[role="alert"]')).toContainText('The session changed.');
        await expect(page.locator('.ci-root')).toHaveCount(0);
        await expect(page.getByText('SAVED_CHANNEL_DESCRIPTION', { exact: true })).toHaveCount(0);
    } finally { release(); }
});

test('editor tabs keep their usual order with Inspector before plugin tabs', async ({ page }) => {
    await permissions(page, { viewer: false, pluginTab: true });
    await mockEngine(page, { [`GET /channels/${ID}`]: { channel: channel() } });
    await page.goto(`/channels/${ID}/edit`);
    await expect(page.getByRole('tablist', { name: 'Channel sections' }).getByRole('tab')).toHaveText([
        'Summary', 'Source', 'Destinations', 'Scripts', 'Inspector', 'Plugin tab'
    ]);
    await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByPlaceholder('Describe what this channel does…').fill('WORKING_DRAFT_DESCRIPTION');
    await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
    await expect(page.locator('.ci-desc')).toHaveText('WORKING_DRAFT_DESCRIPTION');
    await expect(page.locator('.ci-from').first()).toContainText('Current editor');
    await expect(page.locator('.ci-from').first()).toContainText('unsaved changes');
    await expect(page.locator('#ci-storage').getByRole('button', { name: 'Open in Summary', exact: true })).toBeVisible();
});
