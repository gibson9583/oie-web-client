import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const initial of [false, true]) {
    test(`palette follows guided ${initial ? 'Deselect all' : 'Select all'} immediately and on reopen`, async ({ page }) => {
        const channel = { ...makeChannel('association'), name: 'Association Channel' };
        await mockEngine(page, {
            'GET /channels/association': { channel },
            'GET /codeTemplateLibraries': { list: { codeTemplateLibrary: [{
                '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: 1,
                includeNewChannels: false, enabledChannelIds: initial ? { string: channel.id } : '',
                disabledChannelIds: '', codeTemplates: { codeTemplate: [{ id: 'helper', name: 'Shared Helper' }] },
            }] } },
        });
        await page.goto('/channels/association/guided');
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        await expect(page.getByRole('checkbox').first()).toBeChecked({ checked: initial });
        await page.getByRole('button', { name: initial ? 'Select all' : 'Deselect all', exact: true }).click();
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
        await page.getByRole('button', { name: initial ? 'Deselect all' : 'Select all', exact: true }).click();
        await expect(page.getByRole('checkbox').first()).toBeChecked({ checked: !initial });
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
        for (let opening = 0; opening < 2; opening++) {
            await page.keyboard.press('Control+k');
            const query = page.locator('.cmdk-field input');
            await query.fill('Shared Library');
            // Wait for the fetched catalog before asserting membership in Suggested.
            await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Shared Library']);
            await query.fill('');
            await expect(page.locator('.cmdk-opt[data-group="Suggested"] .cmdk-label'))
                .toHaveText(['Association Channel', ...(!initial ? ['Shared Library', 'Shared Helper'] : [])]);
            await page.keyboard.press('Escape');
            await expect(page.locator('.cmdk')).toHaveCount(0);
        }
    });
}

test('palette follows a delayed guided dependency refresh without marking the channel dirty', async ({ page }) => {
    const channel = { ...makeChannel('association'), name: 'Association Channel' };
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, {
        'GET /channels/association': { channel },
        'GET /codeTemplateLibraries': async () => {
            const read = ++reads;
            if (read === 2) await gate;
            return { list: { codeTemplateLibrary: [{
                '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: 1,
                includeNewChannels: false, enabledChannelIds: read > 1 ? { string: channel.id } : '',
                disabledChannelIds: '', codeTemplates: null,
            }] } };
        },
    });
    try {
        await page.goto('/channels/association/guided');
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        await expect(page.getByRole('checkbox').first()).not.toBeChecked();
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
        await page.locator('.wiz-step', { hasText: 'Basics' }).click();
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        await expect.poll(() => reads).toBe(2);
        await page.keyboard.press('Control+k');
        const query = page.locator('.cmdk-field input');
        await query.fill('Shared Library');
        await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Shared Library']);
        await query.fill('');
        const suggestions = page.locator('.cmdk-opt[data-group="Suggested"] .cmdk-label');
        await expect(suggestions).toHaveText(['Association Channel']);
        release();
        // The palette hides its underlying view from role queries.
        await expect(page.locator('.wiz-pane input[type="checkbox"]').first()).toBeChecked();
        await expect(suggestions).toHaveText(['Association Channel', 'Shared Library']);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    } finally { release(); }
});

for (const surface of ['classic', 'transformer', 'guided'] as const) {
    test(`palette follows ${surface} creation when a related save fails and retries`, async ({ page }) => {
        let channel: any = null;
        let creates = 0, libraryWrites = 0;
        await mockEngine(page, {
            'GET /channels/*': () => ({ channel }),
            'GET /channels/idsAndNames': { map: { entry: [] } },
            'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: [{
                '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: 1,
                includeNewChannels: false, enabledChannelIds: libraryWrites > 1 ? { string: channel.id } : '',
                disabledChannelIds: '', codeTemplates: null,
            }] } }),
            'POST /channels': (req: any) => { channel = req.postDataJSON().channel; channel.revision = 1; creates++; return true; },
            'PUT /channels/*': (req: any) => { channel = req.postDataJSON().channel; return true; },
            'POST /codeTemplateLibraries/_bulkUpdate': () => ++libraryWrites === 1
                ? { __status: 503, body: 'Library unavailable' }
                : { result: { librariesSuccess: true, overrideNeeded: false } },
        });
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Created Channel');
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        await page.getByRole('checkbox').first().check();
        if (surface === 'guided') {
            for (let step = 0; step < 5; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
            await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
            if (surface === 'transformer') {
                await page.getByRole('tab', { name: 'Source', exact: true }).click();
                await page.getByRole('button', { name: /^Edit Transformer/ }).click();
            }
            await page.getByRole('button', { name: surface === 'classic' ? 'Save Changes' : 'Save Channel', exact: true }).click();
        }
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toContainText('Library unavailable');
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        expect(creates).toBe(1);
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
        for (let opening = 0; opening < 2; opening++) {
            await page.keyboard.press('Control+k');
            await expect(page.locator('.cmdk-opt[data-group="Suggested"] .cmdk-label')).toHaveText([
                'Created Channel', ...(surface === 'transformer' ? ['Created Channel'] : []), 'Shared Library',
            ]);
            await page.keyboard.press('Escape');
        }
        const retry = surface === 'guided' ? page.getByRole('main') : page;
        await retry.getByRole('button', { name: surface === 'transformer' ? 'Save Channel' : 'Save Changes', exact: true }).click();
        if (surface === 'guided') await expect(page).toHaveURL(/\/channels$/);
        else await expect(page.locator('.toast-msg', { hasText: 'Saved Created Channel' })).toBeVisible();
        expect(creates).toBe(1);
        expect(libraryWrites).toBe(2);
        expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    });
}

for (const action of ['revert', 'save', 'pending-save', 'remount-save', 'remount-pending-save'] as const) {
    test(`palette follows a classic dependency ${action} after a wizard handoff`, async ({ page }) => {
        const channel = { ...makeChannel('association'), name: 'Association Channel' };
        const saving = action !== 'revert';
        const remount = action === 'remount-save' || action === 'remount-pending-save';
        const pending = action === 'pending-save' || action === 'remount-pending-save';
        const held = remount || pending;
        let enabled = false, writes = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        if (!held) release();
        await mockEngine(page, {
            'GET /channels/association': { channel },
            'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: [{
                '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: 1,
                includeNewChannels: false, enabledChannelIds: enabled ? { string: channel.id } : '',
                disabledChannelIds: '', codeTemplates: null,
            }] } }),
            'POST /codeTemplateLibraries/_bulkUpdate': async () => {
                writes++;
                await gate;
                enabled = true;
                return { result: { overrideNeeded: false, librariesSuccess: true } };
            },
        });
        try {
            await page.goto('/channels/association/guided');
            await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
            await expect(page.getByRole('checkbox').first()).not.toBeChecked();
            if (action === 'revert') await page.getByRole('checkbox').first().check();
            await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
            await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
            await expect(dialog.getByRole('checkbox').first()).toBeChecked({ checked: action === 'revert' });
            await dialog.getByRole('checkbox').first().setChecked(saving);
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
            if (saving) {
                await page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true })
                    .getByRole('button', { name: 'OK', exact: true }).click();
            }
            if (held) await expect.poll(() => writes).toBe(1);
            else await expect(dialog).toHaveCount(0);

            // Open immediately: changing a channel field or switching views would
            // incidentally republish the dependency state and conceal a stale map.
            await page.keyboard.press('Control+k');
            await expect(page.locator('.cmdk')).toBeVisible();
            const query = page.locator('.cmdk-field input');
            if (remount) {
                const previousEditor = await page.locator('.view-body').first().elementHandle();
                await query.fill('#Association Channel');
                await page.locator('.cmdk-opt').filter({ has: page.locator('.cmdk-hint', { hasText: /^edit$/ }) }).click();
                await expect.poll(() => previousEditor!.evaluate(element => element.isConnected)).toBe(false);
                await expect(page.locator('.view-body input[type="text"]').first()).toHaveValue('Association Channel');
                if (!pending) {
                    release();
                    await expect(dialog).toHaveCount(0);
                }
                await page.keyboard.press('Control+k');
                await expect(page.locator('.cmdk')).toBeVisible();
            }
            await query.fill('Shared Library');
            // Global search proves the library response has rendered before the
            // empty-query assertion, including when no library should be suggested.
            await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Shared Library']);
            await query.fill('');
            const suggestions = page.locator('.cmdk-opt[data-group="Suggested"] .cmdk-label');
            if (pending) {
                await expect(suggestions).toHaveText(['Association Channel']);
                release();
                await expect(dialog).toHaveCount(0);
            }
            expect(writes).toBe(saving ? 1 : 0);
            expect(enabled).toBe(saving);
            await expect(suggestions).toHaveText(['Association Channel', ...(saving ? ['Shared Library'] : [])]);
        } finally {
            release();
        }
    });
}
