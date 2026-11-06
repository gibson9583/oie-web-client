import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';
import { makeChannel } from './connector-fixtures.js';

// Captured fields from the installed engine's Jetty/Jersey JSON 500 response.
const jettyError = { servlet: 'org.glassfish.jersey.servlet.ServletContainer-1dfd5f51',
    message: 'Request failed.', url: '/api/channels/invalid', status: '500' };
const errorDialog = (page: Page) => page.getByRole('dialog', { name: 'Error', exact: true });
const alert = (page: Page) => page.locator('.view-body [role="alert"]');
const row = (page: Page) => page.getByRole('row').filter({ has: page.getByText('Demo Started', { exact: true }) });
const closeError = (page: Page) => errorDialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();

test('initial channel-list failure names its HTTP status and log guidance, then Refresh recovers', async ({ page }) => {
    let fail = true;
    const accepts: string[] = [];
    await mockEngine(page, { 'GET /channels': (request: any) => {
        accepts.push(request.headers().accept);
        return fail ? { __status: 500, body: jettyError } : DEFAULT_FIXTURES['GET /channels'];
    } });
    await page.goto('/channels');
    await expect(errorDialog(page)).toContainText('Failed to load channels: HTTP 500.');
    await expect(errorDialog(page)).toContainText('Check the engine server log for details.');
    await expect(errorDialog(page)).not.toContainText('Request failed');
    await expect(errorDialog(page)).not.toContainText('serializ');
    await closeError(page);
    await expect(alert(page)).toContainText('channels: HTTP 500.');
    await expect(alert(page)).not.toContainText('stale');
    await expect(page.getByRole('button', { name: 'Clone Channel', exact: true })).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(row(page)).toBeVisible();
    await expect(alert(page)).toHaveCount(0);
    expect(accepts.every(value => value.startsWith('application/json'))).toBe(true);
});

for (const [endpoint, resource] of [['/channelgroups', 'groups'], ['/server/channelTags', 'tags'], ['/channels/statuses', 'statuses']]) {
    test(`channel-list ${resource} failure keeps the failing resource and useful detail visible`, async ({ page }) => {
        const detail = `${resource} unavailable: <img src="x" onerror="window.__unsafeLoad = true">`;
        await mockEngine(page, { [`GET ${endpoint}`]: { __status: 500, body: { message: 'Request failed.', detailedError: detail } } });
        await page.goto('/channels');
        await expect(errorDialog(page)).toContainText(`Failed to load ${resource}: HTTP 500.`);
        await expect(errorDialog(page)).toContainText(detail);
        await closeError(page);
        await expect(row(page)).toBeVisible();
        await expect(alert(page)).toContainText(`${resource}: HTTP 500.`);
        await expect(alert(page)).not.toContainText('Failed to load channels:');
        await expect(alert(page).locator('img')).toHaveCount(0);
        expect(await page.evaluate(() => (window as any).__unsafeLoad)).toBeUndefined();
    });
}

test('transient list failure keeps live models, denial revokes them, and retry restores the list', async ({ page }) => {
    let failure = 0;
    await mockEngine(page, { 'GET /channels': () => failure
        ? { __status: failure, body: failure === 500 ? jettyError : {} }
        : DEFAULT_FIXTURES['GET /channels'] });
    await page.goto('/channels');
    await row(page).click();
    const clone = page.getByRole('button', { name: 'Clone Channel', exact: true });
    await expect(clone).toBeVisible();
    failure = 500;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(errorDialog(page)).toContainText('HTTP 500.');
    await closeError(page);
    await expect(alert(page)).toContainText('Displayed data may be stale.');
    await expect(row(page)).toBeVisible();
    await expect(clone).toBeVisible();
    failure = 403;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(errorDialog(page)).toContainText('HTTP 403. Access denied.');
    await expect(errorDialog(page)).not.toContainText('engine server log');
    await closeError(page);
    await expect(row(page)).toHaveCount(0);
    await expect(clone).toHaveCount(0);
    await expect(alert(page)).not.toContainText('stale');
    failure = 0;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(row(page)).toBeVisible();
    await expect(alert(page)).toHaveCount(0);
});

test('channel-list network failure does not invent an HTTP status and can be retried', async ({ page }) => {
    await mockEngine(page);
    const outage = '**/api/channels';
    await page.route(outage, route => route.abort('connectionfailed'));
    await page.goto('/channels');
    await expect(errorDialog(page)).toContainText('Failed to load channels:');
    await expect(errorDialog(page)).not.toContainText('HTTP');
    await expect(errorDialog(page)).not.toContainText('engine server log');
    await closeError(page);
    await page.unroute(outage);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(row(page)).toBeVisible();
    await expect(alert(page)).toHaveCount(0);
});

const channelId = 'load-error-channel';
const editorRoutes = [
    ['classic', `/channels/${channelId}/edit`],
    ['guided', `/channels/${channelId}/guided`],
    ['filter', `/channels/${channelId}/filter/0`],
    ['transformer', `/channels/${channelId}/transformer/0`],
    ['response transformer', `/channels/${channelId}/response/1`]
];
for (const [surface, path] of editorRoutes) {
    test(`${surface} channel load reports a generic 500 and can be reopened after recovery`, async ({ page }) => {
        let fail = true;
        const channel = makeChannel(channelId);
        await mockEngine(page, { [`GET /channels/${channelId}`]: () => fail
            ? { __status: 500, body: jettyError } : { channel } });
        await page.goto(path);
        await expect(errorDialog(page)).toContainText('Load failed: HTTP 500.');
        await expect(errorDialog(page)).toContainText('The channel could not be loaded.');
        await expect(errorDialog(page)).toContainText('Check the engine server log for details.');
        await expect(errorDialog(page)).not.toContainText('Request failed');
        await expect(errorDialog(page)).not.toContainText('serializ');
        await expect(page).toHaveURL(/\/channels$/);
        await closeError(page);
        fail = false;
        await page.goto(path);
        if (surface === 'classic') await expect(page.locator('.panel input[type=text]').first()).toHaveValue(channel.name);
        else if (surface === 'guided') await expect(page.getByRole('textbox', { name: 'Channel name', exact: true })).toHaveValue(channel.name);
        else await expect(page.getByRole('button', { name: 'Back to Channel', exact: true })).toBeVisible();
        await expect(errorDialog(page)).toHaveCount(0);
    });
}

for (const failure of ['useful detail', 'permission', 'network']) {
    test(`classic channel load retains ${failure} context and the existing return navigation`, async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${channelId}`]: {
            __status: failure === 'permission' ? 403 : 500,
            body: failure === 'permission' ? {} : { message: 'Request failed.', detailedError: 'Channel service unavailable: <channel>' }
        } });
        if (failure === 'network') await page.route(`**/api/channels/${channelId}`, route => route.abort('connectionfailed'));
        await page.goto(`/channels/${channelId}/edit`);
        await expect(errorDialog(page)).toContainText('Load failed:');
        if (failure === 'useful detail') await expect(errorDialog(page)).toContainText('HTTP 500. Channel service unavailable: <channel>');
        else if (failure === 'permission') await expect(errorDialog(page)).toContainText('HTTP 403. Access denied. Check your permissions to view channels.');
        else await expect(errorDialog(page)).not.toContainText('HTTP');
        if (failure !== 'useful detail') await expect(errorDialog(page)).not.toContainText('engine server log');
        await expect(page).toHaveURL(/\/channels$/);
    });
}

for (const [surface, path] of editorRoutes.filter(([name]) => ['classic', 'guided', 'transformer'].includes(name))) {
    test(`a departed ${surface} channel loader cannot report or navigate on late failure`, async ({ page }) => {
        let release!: () => void;
        let started = false;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, { [`GET /channels/${channelId}`]: async () => {
            started = true;
            await pending;
            return { __status: 500, body: jettyError };
        } });
        try {
            await page.goto(path);
            await expect.poll(() => started).toBe(true);
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(page).toHaveURL(/\/dashboard$/);
            const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/channels/${channelId}`);
            release();
            await (await response).finished();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect(errorDialog(page)).toHaveCount(0);
            await expect(page).toHaveURL(/\/dashboard$/);
        } finally { release(); }
    });
}

const libraryError = { __status: 500, body: { ...jettyError, url: '/api/codeTemplateLibraries' } };

test('classic Set Dependencies names the library load status and log guidance', async ({ page }) => {
    await mockEngine(page, { [`GET /channels/${channelId}`]: { channel: makeChannel(channelId) }, 'GET /codeTemplateLibraries': libraryError });
    await page.goto(`/channels/${channelId}/edit`);
    await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
    await expect(errorDialog(page)).toContainText('Could not load dependencies: HTTP 500.');
    await expect(errorDialog(page)).toContainText('Check the engine server log for details.');
    await expect(errorDialog(page)).not.toContainText('Request failed');
});

test('guided Dependencies step names the failing resource and its status', async ({ page }) => {
    await mockEngine(page, { 'GET /codeTemplateLibraries': libraryError });
    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('Dependency Error');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(errorDialog(page)).toContainText('Failed to load dependencies: code template libraries: HTTP 500.');
    await expect(errorDialog(page)).toContainText('Check the engine server log for details.');
    await expect(errorDialog(page)).not.toContainText('Request failed');
    await closeError(page);
    await expect(alert(page)).toContainText('Failed to load dependency choices: code template libraries: HTTP 500.');
});

test('the filter Reference list explains a library load failure', async ({ page }) => {
    await mockEngine(page, { [`GET /channels/${channelId}`]: { channel: makeChannel(channelId) }, 'GET /codeTemplateLibraries': libraryError });
    await page.goto(`/channels/${channelId}/filter/0`);
    const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
    await expect(warning).toContainText('Could not load user code-template libraries; showing built-ins only.');
    await expect(warning).toContainText('HTTP 500. The code template libraries could not be loaded.');
    await expect(warning).toContainText('Check the engine server log for details.');
    await expect(warning).not.toContainText('Request failed');
});

test('the alert wizard retains its default load-error text without a channel-specific formatter', async ({ page }) => {
    await mockEngine(page, { 'GET /alerts/unavailable': { __status: 500, body: { message: 'Alert unavailable', error: 'ALERT_UNAVAILABLE' } } });
    await page.goto('/alerts/unavailable/guided');
    await expect(errorDialog(page).getByText('Alert unavailable', { exact: true })).toBeVisible();
    await expect(errorDialog(page)).not.toContainText('HTTP 500');
    await expect(errorDialog(page)).not.toContainText('channel');
    await expect(page).toHaveURL(/\/alerts$/);
});
