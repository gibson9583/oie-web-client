import { test, expect } from './base.js';
import { makeChannel } from './connector-fixtures.js';
import { mockEngine } from './mock.js';

test('Back to Channel returns to the plugin tab that opened a destination transformer', async ({ page }) => {
    const channel = makeChannel('plugin-origin');
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /webplugins': ['flow'],
        'GET /webplugins/flow/plugin.json': {
            id: 'flow', version: '1.0.0', client: { entry: 'web/plugin.js' }
        }
    });
    await page.route('**/api/webplugins/flow/web/plugin.js*', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export function register(platform) {
            platform.registerChannelTab({
                id: 'flow-diagram', label: 'Flow',
                component: ({ channel }) => platform.React.createElement('button', {
                    onClick: () => platform.router.navigate('/channels/' + channel.id + '/transformer/1')
                }, 'Open destination transformer')
            });
        }`
    }));

    await page.goto(`/channels/${channel.id}/edit`);
    const flow = page.getByRole('tab', { name: 'Flow', exact: true });
    const openTransformer = page.getByRole('button', { name: 'Open destination transformer', exact: true });
    await flow.click();
    await openTransformer.click();
    await expect(page).toHaveURL(`/channels/${channel.id}/transformer/1`);
    const back = page.getByRole('button', { name: 'Back to Channel', exact: true });
    await expect(back).toBeVisible();
    // The timezone switch remounts the current route. Its return destination
    // must survive even though the transformer component is replaced.
    const oldBack = await back.elementHandle();
    await page.getByTitle(/^Timestamps shown in/).click();
    await oldBack.waitForElementState('hidden');
    await back.click();
    await expect(flow).toHaveAttribute('aria-selected', 'true');
    await expect(openTransformer).toBeVisible();
});

test('saving after Back to Channel preserves a tag removal made before opening the source filter', async ({ page }) => {
    const channel = makeChannel('removed-tag');
    const tag = { id: 'tag-one', name: 'Production', channelIds: { string: [channel.id] } };
    channel.exportData = { ...channel.exportData, channelTags: { channelTag: [tag] } };
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /server/channelTags': { set: { channelTag: [tag] } }
    });

    await page.goto(`/channels/${channel.id}/edit`);
    await page.getByTitle('Remove tag').click();
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Filter', exact: true }).click();
    await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');

    const write = page.waitForRequest(request =>
        request.method() === 'PUT' && new URL(request.url()).pathname === `/api/channels/${channel.id}`);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    expect((await write).postDataJSON().channel.exportData.channelTags).toBe('');
});

test('Back to Channel scrolls the context-menu destination into view only on return', async ({ page }) => {
    const channel = makeChannel('destination-scroll');
    const base = channel.destinationConnectors.connector[0];
    channel.destinationConnectors.connector = Array.from({ length: 50 }, (_, index) => ({
        ...base, metaDataId: index + 21, name: `Destination ${index + 21}`
    }));
    channel.nextMetaDataId = 71;
    await mockEngine(page, { [`GET /channels/${channel.id}`]: { channel } });
    await page.goto(`/channels/${channel.id}/edit`);
    const destinations = page.getByRole('tab', { name: 'Destinations', exact: true });
    await destinations.click();
    const grid = page.locator('.dest-grid');
    const selectedId = grid.locator('tr.selected td.num');
    const target = grid.getByRole('cell', { name: '70', exact: true });
    await expect(selectedId).toHaveText('21');
    await expect(target).not.toBeInViewport();
    await target.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit Filter', exact: true }).click();
    await expect(page).toHaveURL(`/channels/${channel.id}/filter/70`);
    await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
    await expect(destinations).toHaveAttribute('aria-selected', 'true');
    await expect(selectedId).toHaveText('70');
    await expect(selectedId).toBeInViewport({ ratio: 0.9 });

    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await destinations.click();
    await expect(selectedId).toHaveText('21');
});

test('Back to Channel restores the script selected before browser Forward reopened a filter', async ({ page }) => {
    const channel = makeChannel('script-origin');
    await mockEngine(page, { [`GET /channels/${channel.id}`]: { channel } });
    await page.goto(`/channels/${channel.id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Filter', exact: true }).click();
    const back = page.getByRole('button', { name: 'Back to Channel', exact: true });
    await expect(back).toBeVisible();
    await page.goBack();
    const scripts = page.getByRole('tab', { name: 'Scripts', exact: true });
    await scripts.click();
    const script = page.getByRole('tabpanel').getByRole('combobox');
    await script.selectOption('postprocessingScript');
    await page.goForward();
    await back.click();
    await expect(scripts).toHaveAttribute('aria-selected', 'true');
    await expect(script).toHaveValue('postprocessingScript');
});

test('a direct destination link returns to its connector when script validation is unavailable', async ({ page }) => {
    const channel = makeChannel('direct-destination');
    const dest = structuredClone(channel.destinationConnectors.connector[0]);
    dest.metaDataId = 7;
    dest.name = 'Second destination';
    dest.transformer.elements = {
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
            '@version': channel['@version'], name: 'Log', sequenceNumber: 0, enabled: true, script: "logger.info('ok');"
        }
    };
    channel.destinationConnectors.connector.push(dest);
    channel.nextMetaDataId = 8;
    const missing = { __status: 404, body: 'Not found' };
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /webplugins': missing,
        'GET /extensions/websupport/webplugins': missing
    });
    await page.goto(`/channels/${channel.id}/transformer/7`);
    const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
    await expect(warning).toContainText('Web Support plugin is not installed');
    await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.getByRole('button', { name: 'Back to Channel', exact: true }).click();
    await expect(warning).toContainText(/Validation unavailable.*Web Support plugin/);
    await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('tab', { name: 'Destinations', selected: true })).toBeVisible();
    await expect(page.locator('.dest-grid tr.selected td.num')).toHaveText('7');
    await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
});

for (const error of [null, 'Error on line 1: syntax error.']) {
    test(`leaving the transformer during Back validation ignores a late ${error ? 'error' : 'success'}`, async ({ page }) => {
        const channel = makeChannel('delayed-back');
        channel.sourceConnector.transformer.elements = {
            'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': channel['@version'], name: 'Validate me', sequenceNumber: '0', enabled: true,
                script: error ? 'var x = ;' : 'var x = 1;'
            }
        };
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${channel.id}`]: { channel },
            'POST /javascript/_validate': async () => { await pending; return { error }; }
        });
        try {
            await page.goto(`/channels/${channel.id}/transformer/0`);
            const back = page.getByRole('button', { name: 'Back to Channel', exact: true });
            const validation = page.waitForRequest('**/api/javascript/_validate');
            await back.click();
            const request = await validation;
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(back).toHaveCount(0);

            const response = page.waitForResponse(result => result.request() === request);
            release();
            await (await response).finished();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await expect(page).toHaveURL('/dashboard');
            await expect(page.getByText('Error validating transformer steps', { exact: true })).toHaveCount(0);
        } finally {
            release();
        }
    });
}
