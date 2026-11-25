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

async function openRawSteps(page: Page, wizard = false) {
    const channel = makeChannel('raw-history');
    const stepType = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
    const scripts = ['var first = 1;', 'var second = 2;'];
    channel.sourceConnector.transformer.elements = {
        [stepType]: scripts.map((script, index) => ({
            '@version': channel['@version'], name: `Step ${index + 1}`, sequenceNumber: index, enabled: true, script
        }))
    };
    await page.route('**/plugins/transformer-steps/web/plugin.js*', route => route.abort('failed'));
    await mockEngine(page, { [`GET /channels/${channel.id}`]: { channel } });
    await page.goto(`/channels/${channel.id}/edit`);
    if (wizard) {
        await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
        await page.locator('.wiz-step', { hasText: 'Source' }).click();
        await page.getByRole('tab', { name: /^Transformer/ }).click();
    } else {
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        await page.getByRole('button', { name: /^Edit Transformer/ }).click();
    }
    const raw = page.locator('.step-editor-fill textarea');
    const original = JSON.parse(await raw.inputValue());
    const updated = 'var updated = 3;';
    return { raw, original, updated, stepType, channel };
}

test('browser Back commits the focused raw step before the channel can be saved', async ({ page }) => {
    const { raw, original, updated, stepType, channel } = await openRawSteps(page);
    await raw.fill(JSON.stringify({ ...original, script: updated }));
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Source', selected: true })).toBeVisible();
    const write = page.waitForRequest(req =>
        req.method() === 'PUT' && new URL(req.url()).pathname === `/api/channels/${channel.id}`);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    expect((await write).postDataJSON().channel.sourceConnector.transformer.elements[stepType][0].script).toBe(updated);
});

test('malformed raw JSON keeps the original step selected through history and row changes', async ({ page }) => {
    const { raw, original, updated } = await openRawSteps(page);
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await raw.fill('{');
    await page.goBack();
    await expect(error).toContainText('Invalid JSON');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page).toHaveURL(/\/transformer\/0$/);
    const second = page.locator('tr[data-path="1"]').getByRole('cell', { name: '2', exact: true });
    await second.click();
    await expect(error).toContainText('Invalid JSON');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.locator('tr[data-path="0"]')).toHaveClass(/selected/);
    await expect(raw).toHaveValue('{');
    await raw.fill(JSON.stringify({ ...original, script: updated }));
    await second.click();
    await expect(page.locator('tr[data-path="1"]')).toHaveClass(/selected/);
    await page.locator('tr[data-path="0"]').getByRole('cell', { name: '1', exact: true }).click();
    await expect.poll(async () => JSON.parse(await raw.inputValue()).script).toBe(updated);
});

test('wizard keeps a malformed raw step through section, step and classic-editor switches', async ({ page }) => {
    const { raw, original, updated } = await openRawSteps(page, true);
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await raw.fill('{');
    await raw.press('Tab');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    for (const action of [
        page.getByRole('tab', { name: 'Generated Script', exact: true }),
        page.getByRole('tab', { name: 'Settings', exact: true }),
        page.locator('.wiz-step', { hasText: 'Destinations' }),
        page.getByRole('button', { name: 'Classic editor', exact: true }),
        page.getByRole('button', { name: 'Save Changes', exact: true })
    ]) {
        await action.click();
        await expect(error).toContainText('Invalid JSON');
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(raw).toHaveValue('{');
    }
    await raw.fill(JSON.stringify({ ...original, script: updated }));
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: /^Transformer/ }).click();
    await expect.poll(async () => JSON.parse(await raw.inputValue()).script).toBe(updated);
});

test('wizard browser Back retries the raw edit before saving and returning to classic', async ({ page }) => {
    const { raw, original, updated, channel, stepType } = await openRawSteps(page, true);
    const prompt = page.getByRole('dialog', { name: 'Unsaved channel', exact: true });
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await raw.fill('{');
    await page.goBack();
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(error).toContainText('Invalid JSON');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page).toHaveURL(`/channels/${channel.id}/guided`);
    await expect(raw).toHaveValue('{');
    await raw.fill(JSON.stringify({ ...original, script: updated }));
    await page.goBack();
    const write = page.waitForRequest(req =>
        req.method() === 'PUT' && new URL(req.url()).pathname === `/api/channels/${channel.id}`);
    await prompt.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await write).postDataJSON().channel.sourceConnector.transformer.elements[stepType][0].script).toBe(updated);
    await expect(page).toHaveURL(`/channels/${channel.id}/edit`);
});

test('deleting the focused malformed raw step preserves edits to the surviving step', async ({ page }) => {
    const { raw, updated, stepType, channel } = await openRawSteps(page);
    const rows = page.locator('tr[data-path]');
    await rows.nth(1).getByRole('cell', { name: '2', exact: true }).click();
    await expect.poll(async () => JSON.parse(await raw.inputValue()).name).toBe('Step 2');
    const survivor = JSON.parse(await raw.inputValue());
    await raw.fill(JSON.stringify({ ...survivor, script: updated }));
    await rows.first().getByRole('cell', { name: '1', exact: true }).click();
    await raw.fill('{');
    await page.getByRole('button', { name: 'Delete Step', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
    const write = page.waitForRequest(req =>
        req.method() === 'PUT' && new URL(req.url()).pathname === `/api/channels/${channel.id}`);
    await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
    const saved = (await write).postDataJSON().channel.sourceConnector.transformer.elements[stepType];
    expect([saved].flat()).toEqual([expect.objectContaining({ name: 'Step 2', script: updated })]);
});

test('appending an import preserves malformed raw text and replacing discards it', async ({ page }) => {
    const { raw } = await openRawSteps(page);
    await raw.fill('{');
    async function importEmptyTransformer(choice: string) {
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Transformer', exact: true }).click();
        await (await chooser).setFiles({ name: 'empty.xml', mimeType: 'text/xml',
            buffer: Buffer.from('<transformer version="4.6.0"><elements/></transformer>') });
        await page.getByRole('dialog', { name: 'Import Transformer', exact: true }).getByRole('button', { name: choice }).click();
    }
    await importEmptyTransformer('Append');
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Invalid JSON');
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(raw).toHaveValue('{');
    await expect(page.locator('tr[data-path]')).toHaveCount(2);
    await importEmptyTransformer('Replace');
    await expect(page.locator('tr[data-path]')).toHaveCount(0);
    await expect(error).toHaveCount(0);
});
