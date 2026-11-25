import type { Page, Request } from '@playwright/test';
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

const invalidScript = 'var x = ;';
const syntaxError = 'Error on line 1: syntax error.';
const validator = '/extensions/websupport/javascript/_validate';

async function openDelayedTransformer(page: Page, ...scripts: string[]) {
    const channel = makeChannel('delayed-back');
    const steps = scripts.map((script, index) => ({
        '@version': channel['@version'], name: `Step ${index + 1}`, sequenceNumber: String(index), enabled: true, script
    }));
    channel.sourceConnector.transformer.elements = {
        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': steps.length === 1 ? steps[0] : steps
    };
    await page.route('**/vendor/monaco/**', route => route.abort());
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let first = true;
    await mockEngine(page, {
        [`GET /channels/${channel.id}`]: { channel },
        'GET /webplugins': { __status: 404 },
        'GET /extensions/websupport/webplugins': [],
        [`POST ${validator}`]: async (request: Request) => {
            if (first && request.postData() === scripts[scripts.length - 1]) {
                first = false;
                await pending;
            }
            return { error: request.postData()?.includes(invalidScript) ? syntaxError : null };
        }
    });
    await page.goto(`/channels/${channel.id}/transformer/0`);
    return {
        back: page.getByRole('button', { name: 'Back to Channel', exact: true }),
        script: page.locator('.step-editor-fill textarea.ce-area'),
        error: page.getByRole('dialog', { name: 'Error validating transformer steps' }),
        release,
        async finish(request: Request) {
            const response = page.waitForResponse(result => result.request() === request);
            release();
            await (await response).finished();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
    };
}

for (const script of ['var x = 1;', invalidScript]) {
    test(`leaving the transformer during Back validation ignores a late ${script === invalidScript ? 'error' : 'success'}`, async ({ page }) => {
        const editor = await openDelayedTransformer(page, script);
        try {
            const validation = page.waitForRequest(`**/api${validator}`);
            await editor.back.click();
            const request = await validation;
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(editor.back).toHaveCount(0);
            await editor.finish(request);
            await expect(page).toHaveURL('/dashboard');
            await expect(editor.error).toHaveCount(0);
        } finally {
            editor.release();
        }
    });
}

test('edits during Back validation keep the current draft open for validation and retry', async ({ page }) => {
    const editor = await openDelayedTransformer(page, 'var x = 1;');
    try {
        const validation = page.waitForRequest(`**/api${validator}`);
        await editor.back.click();
        const first = await validation;
        await editor.script.fill(invalidScript);
        await editor.finish(first);
        await expect(editor.back).toBeVisible();
        await expect(editor.script).toHaveValue(invalidScript);

        await editor.back.click();
        await expect(editor.error).toContainText(syntaxError);
        await editor.error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await editor.script.fill('var x = 2;');
        await editor.back.click();
        await expect(page.getByRole('tab', { name: 'Source', selected: true })).toBeVisible();
    } finally {
        editor.release();
    }
});

test('selecting another step during Back validation keeps its editor open', async ({ page }) => {
    const nextScript = 'var second = 2;';
    const editor = await openDelayedTransformer(page, 'var first = 1;', nextScript);
    try {
        const validation = page.waitForRequest(request =>
            request.url().endsWith(validator) && request.postData() === nextScript);
        await editor.back.click();
        const last = await validation;
        const secondRow = page.locator('tr[data-path="1"]');
        await secondRow.getByRole('cell', { name: '2', exact: true }).click();
        await expect(editor.script).toHaveValue(nextScript);
        await editor.finish(last);
        await expect(page).toHaveURL(/\/transformer\/0$/);
        await expect(secondRow).toHaveClass(/selected/);
        await editor.back.click();
        await expect(page.getByRole('tab', { name: 'Source', selected: true })).toBeVisible();
    } finally {
        editor.release();
    }
});

test('typing in the raw step editor supersedes Back before blur commits the draft', async ({ page }) => {
    await page.route('**/plugins/transformer-steps/web/plugin.js*', route => route.abort('failed'));
    const editor = await openDelayedTransformer(page, 'var x = 1;');
    try {
        const validation = page.waitForRequest(`**/api${validator}`);
        await editor.back.click();
        const first = await validation;
        const raw = page.locator('.step-editor-fill textarea');
        const updatedScript = 'var x = 2;';
        const updatedJson = JSON.stringify({ ...JSON.parse(await raw.inputValue()), script: updatedScript });
        await raw.fill(updatedJson);
        await editor.finish(first);
        await expect(raw).toHaveValue(updatedJson);
        const retry = page.waitForRequest(request =>
            request.url().endsWith(validator) && request.postData() === updatedScript);
        await editor.back.click();
        await retry;
        await expect(page.getByRole('tab', { name: 'Source', selected: true })).toBeVisible();
        await page.getByRole('button', { name: /^Edit Transformer/ }).click();
        expect(JSON.parse(await raw.inputValue()).script).toBe(updatedScript);
    } finally {
        editor.release();
    }
});

test('malformed raw JSON blocks Save and Back and can be explicitly discarded', async ({ page }) => {
    await page.route('**/plugins/transformer-steps/web/plugin.js*', route => route.abort('failed'));
    const editor = await openDelayedTransformer(page, 'var x = 1;');
    editor.release();
    const writes: Request[] = [];
    page.on('request', request => {
        if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/channels/delayed-back') writes.push(request);
    });
    const raw = page.locator('.step-editor-fill textarea');
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await raw.fill('{');
    await raw.press('Tab');
    await expect(error).toContainText('Invalid JSON');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    for (const action of [page.getByRole('button', { name: 'Save Channel', exact: true }), editor.back]) {
        await action.click();
        await expect(error).toContainText('Invalid JSON');
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(raw).toHaveValue('{');
    }
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes' }).getByRole('button', { name: "Don't Save" }).click();
    await expect(editor.back).toHaveCount(0);
    await expect(page).toHaveURL('/dashboard');
    expect(writes).toHaveLength(0);
});

test('a late Validate Step error cannot cover the returned channel editor', async ({ page }) => {
    const editor = await openDelayedTransformer(page, invalidScript);
    try {
        const validation = page.waitForRequest(`**/api${validator}`);
        await page.getByRole('button', { name: 'Validate Step', exact: true }).click();
        const first = await validation;
        await editor.script.fill('var x = 2;');
        await editor.back.click();
        const source = page.getByRole('tab', { name: 'Source', selected: true });
        await expect(source).toBeVisible();
        await editor.finish(first);
        await expect(editor.error).toHaveCount(0);
        await expect(source).toBeVisible();
    } finally {
        editor.release();
    }
});

test('opening Add New Step supersedes Back validation before the step is chosen', async ({ page }) => {
    const editor = await openDelayedTransformer(page, 'var x = 1;');
    try {
        const validation = page.waitForRequest(`**/api${validator}`);
        await editor.back.click();
        const request = await validation;
        await page.getByRole('button', { name: 'Add New Step', exact: true }).click();
        const chooser = page.getByRole('dialog', { name: 'Add Step', exact: true });
        await expect(chooser).toBeVisible();
        await editor.finish(request);
        await expect(page).toHaveURL(/\/transformer\/0$/);

        await chooser.getByText('Mapper', { exact: true }).click();
        await expect(page.locator('tr[data-path]')).toHaveCount(2);
        await expect(page.getByRole('button', { name: 'Save Channel', exact: true })).toBeVisible();
        await editor.back.click();
        await expect(editor.error).toContainText('The variable name cannot be blank.');
    } finally {
        editor.release();
    }
});

for (const interaction of ['pointer', 'keyboard']) {
    test(`opening the step Type picker with the ${interaction} supersedes Back validation`, async ({ page }) => {
        const editor = await openDelayedTransformer(page, 'var x = 1;');
        try {
            const validation = page.waitForRequest(`**/api${validator}`);
            await editor.back.click();
            const request = await validation;
            const type = page.locator('tr[data-path]').getByRole('combobox');
            if (interaction === 'pointer') await type.click();
            else await type.press('Space');

            await editor.finish(request);
            await expect(page).toHaveURL(/\/transformer\/0$/);
            await page.keyboard.press('Escape');
            await type.selectOption({ label: 'Mapper' });
            await editor.back.click();
            await expect(editor.error).toContainText('The variable name cannot be blank.');
        } finally {
            editor.release();
        }
    });
}
