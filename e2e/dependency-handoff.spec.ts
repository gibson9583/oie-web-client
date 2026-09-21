import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const surface of ['wizard', 'classic']) {
    for (const initial of [false, true]) {
        for (const concurrent of [false, true]) {
            test(`${surface}: ${initial ? 'enable' : 'disable'} after ${concurrent ? 'externally fulfilled' : 'ordinary'} library refresh`, async ({ page }) => {
                let channel: any = makeChannel('refresh-library');
                let enabled = initial, reads = 0, writes = 0;
                await page.addInitScript(() => {
                    const original = window.fetch;
                    window.fetch = async (...args: Parameters<typeof fetch>) => {
                        // Capture the actual multipart payload; WebKit request.postData()
                        // does not expose the contents of Blob form parts.
                        if (args[1]?.body instanceof FormData && args[1].body.has('libraries')) {
                            (window as any).__savedLibraries = JSON.parse(await (args[1].body.get('libraries') as Blob).text());
                        }
                        return original(...args);
                    };
                });
                await mockEngine(page, {
                    'GET /channels/refresh-library': () => ({ channel }),
                    'PUT /channels/refresh-library': (req: any) => { channel = req.postDataJSON().channel; return true; },
                    'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: [{
                        '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: ++reads,
                        includeNewChannels: false, codeTemplates: null,
                        enabledChannelIds: { string: enabled ? ['other-channel', channel.id] : ['other-channel'] },
                        disabledChannelIds: enabled ? null : { string: [channel.id] },
                    }] } }),
                    'POST /codeTemplateLibraries/_bulkUpdate': async () => {
                        writes++;
                        const payload = await page.evaluate(() => (window as any).__savedLibraries);
                        const saved = payload.list.codeTemplateLibrary[0];
                        expect(saved.enabledChannelIds.string).toContain('other-channel');
                        enabled = saved.enabledChannelIds.string.includes(channel.id);
                        return { result: { overrideNeeded: false, librariesSuccess: true } };
                    },
                });
                await page.goto('/channels/refresh-library/guided');
                await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
                const box = page.getByRole('checkbox').first();
                await expect(box).toBeChecked({ checked: initial });
                await box.setChecked(!initial);
                if (concurrent) enabled = !initial;
                const previousReads = reads;
                if (surface === 'wizard') {
                    await page.locator('.wiz-step', { hasText: 'Basics' }).click();
                    await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
                    await expect.poll(() => reads).toBeGreaterThan(previousReads);
                    await expect(box).toBeChecked({ checked: !initial });
                    await box.setChecked(initial);
                    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
                    await expect(page).toHaveURL(/\/channels$/);
                } else {
                    await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
                    await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
                    const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
                    const choice = dialog.getByRole('checkbox').first();
                    await expect(choice).toBeChecked({ checked: !initial });
                    await choice.setChecked(initial);
                    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
                    if (concurrent) {
                        await page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true })
                            .getByRole('button', { name: 'OK', exact: true }).click();
                    }
                    await expect(dialog).toHaveCount(0);
                    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
                    await expect(page.locator('.toast-msg', { hasText: `Saved ${channel.name}` })).toBeVisible();
                }
                expect(enabled, 'saved membership matches the last checkbox selection').toBe(initial);
                expect(writes).toBe(concurrent ? 1 : 0);
            });
        }
    }
}

test('dependency refresh carries local intent and external changes through a cancelled classic dialog', async ({ page }) => {
    let channel: any = makeChannel('refresh-intent');
    let graph: any[] = [];
    let graphWrites = 0;
    await mockEngine(page, {
        'GET /channels/refresh-intent': () => ({ channel }),
        'PUT /channels/refresh-intent': (req: any) => { channel = req.postDataJSON().channel; return true; },
        'GET /channels/idsAndNames': { map: { entry: [{ string: ['local', 'Local prerequisite'] }, { string: ['external', 'External prerequisite'] }] } },
        'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
        'PUT /server/channelDependencies': (req: any) => { graphWrites++; graph = req.postDataJSON().set.channelDependency; return ''; },
    });
    await page.goto('/channels/refresh-intent/guided');
    await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
    await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
    await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
    await page.locator('.modal').getByText('Local prerequisite', { exact: true }).click();
    await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
    graph = [{ dependentId: 'refresh-intent', dependencyId: 'external' }];
    await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
    await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
    await dialog.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
    await expect(dialog.getByText('Local prerequisite', { exact: true })).toBeVisible();
    await expect(dialog.getByText('External prerequisite', { exact: true })).toBeVisible();
    await dialog.getByText('Local prerequisite', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
    await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
    await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
    await expect(page.getByText('Local prerequisite', { exact: true })).toBeVisible();
    await expect(page.getByText('External prerequisite', { exact: true })).toBeVisible();
    expect(graphWrites).toBe(0);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page).toHaveURL(/\/channels$/);
    expect(graphWrites).toBe(1);
    expect(graph).toEqual([
        { dependentId: 'refresh-intent', dependencyId: 'external' },
        { dependentId: 'refresh-intent', dependencyId: 'local' },
    ]);
});

for (const kind of ['library', 'resource', 'graph']) {
    test(`F09: ${kind}-only edits stay dirty through both editor switches`, async ({ page }) => {
        let channel: any = makeChannel('pending');
        const writes: string[] = [];
        let graph: any[] = [];
        await mockEngine(page, {
            'GET /channels/pending': () => ({ channel }),
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
            'GET /server/resources': { list: { directoryResourceProperties: [{ id: 'shared-resource', name: 'Shared Resource', type: 'Directory' }] } },
            'PUT /channels/pending': (req: any) => { channel = req.postDataJSON().channel; writes.push('channel'); return true; },
            'POST /codeTemplateLibraries/_bulkUpdate': () => { writes.push('library'); return { result: { librariesSuccess: true, overrideNeeded: false } }; },
            'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
            'PUT /server/channelDependencies': (req: any) => {
                writes.push('graph');
                graph = req.postDataJSON().set.channelDependency;
                expect(graph).toEqual([{ dependentId: 'pending', dependencyId: 'root' }]);
                return '';
            },
        });
        await page.goto('/channels/pending/guided');
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        if (kind === 'library') await page.getByRole('checkbox').first().check();
        if (kind === 'resource') {
            await page.getByRole('tab', { name: 'Library Resources', exact: true }).click();
            await page.getByRole('checkbox').first().check();
        }
        if (kind === 'graph') {
            await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
            await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
            await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
        }
        await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save & Deploy', exact: true })).toBeVisible();
        const closeProtected = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
        expect(await closeProtected()).toBe(true);
        await page.getByRole('button', { name: 'Back to Channels', exact: true }).click();
        await page.getByRole('dialog', { name: 'Unsaved channel', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
        await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
        if (kind === 'library') {
            await expect(dialog.getByRole('checkbox').first()).toBeChecked();
            await dialog.getByRole('checkbox').first().uncheck(); // Cancel discards only this dialog edit.
        } else if (kind === 'graph') {
            await dialog.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await expect(dialog.getByText('Prerequisite', { exact: true })).toBeVisible();
        }
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        if (kind === 'library') await expect(page.getByRole('checkbox').first()).toBeChecked();
        expect(await closeProtected()).toBe(true);
        // Saving in classic must include related writes retained from the wizard.
        await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.locator('.toast-msg', { hasText: `Saved ${channel.name}` })).toBeVisible();
        expect(writes).toEqual(kind === 'resource' ? ['channel'] : ['channel', kind]);
        if (kind === 'resource') expect(JSON.stringify(channel.properties.resourceIds)).toContain('shared-resource');
        expect(await closeProtected()).toBe(false);
    });
}

for (const kind of ['library', 'graph']) {
    test(`F09: accepting a reverted ${kind} selection clears pending wizard changes`, async ({ page }) => {
        let channel: any = makeChannel('revert');
        const writes: string[] = [];
        await mockEngine(page, {
            'GET /channels/revert': () => ({ channel }),
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
            'PUT /channels/revert': (req: any) => { channel = req.postDataJSON().channel; writes.push('channel'); return true; },
            'POST /codeTemplateLibraries/_bulkUpdate': () => { writes.push('library'); return { result: { librariesSuccess: true } }; },
            'PUT /server/channelDependencies': () => { writes.push('graph'); return ''; },
        });
        await page.goto('/channels/revert/guided');
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        if (kind === 'library') await page.getByRole('checkbox').first().check();
        else {
            await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
            await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
            await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
        }
        await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
        await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
        if (kind === 'library') await dialog.getByRole('checkbox').first().uncheck();
        else {
            await dialog.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await dialog.getByText('Prerequisite', { exact: true }).click();
            await dialog.getByRole('button', { name: 'Remove', exact: true }).first().click();
        }
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(writes).toEqual([]);
        await page.locator('.view-body input').first().fill('Keep the channel edit');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.locator('.toast-msg', { hasText: 'Saved Keep the channel edit' })).toBeVisible();
        expect(writes).toEqual(['channel']);
        await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        if (kind === 'library') await expect(page.getByRole('checkbox').first()).not.toBeChecked();
        else {
            await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await expect(page.getByText('Prerequisite', { exact: true })).toHaveCount(0);
        }
    });
}

for (const failure of ['cancel confirmation', 'request failure']) {
    test(`F09: ${failure} before accepting a reversion preserves wizard intents`, async ({ page }) => {
        let channel: any = makeChannel('mixed');
        let graph: any[] = [], failLibrary = failure === 'request failure';
        const writes: string[] = [];
        await mockEngine(page, {
            'GET /channels/mixed': () => ({ channel }),
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
            'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
            'PUT /channels/mixed': (req: any) => { channel = req.postDataJSON().channel; return true; },
            'POST /codeTemplateLibraries/_bulkUpdate': () => {
                if (failLibrary) { failLibrary = false; return { __status: 503, body: 'Library unavailable' }; }
                writes.push('library'); return { result: { librariesSuccess: true } };
            },
            'PUT /server/channelDependencies': (req: any) => { graph = req.postDataJSON().set.channelDependency; writes.push('graph'); return ''; },
        });
        await page.goto('/channels/mixed/guided');
        await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        await page.getByRole('checkbox').first().check();
        await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
        await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
        await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
        await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
        await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
        await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
        await dialog.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
        await dialog.getByText('Prerequisite', { exact: true }).click();
        await dialog.getByRole('button', { name: 'Remove', exact: true }).first().click();
        await dialog.getByRole('button', { name: 'OK', exact: true }).click();
        const confirm = page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true });
        await confirm.getByRole('button', { name: failure === 'cancel confirmation' ? 'Cancel' : 'OK', exact: true }).click();
        if (failure === 'request failure') {
            const error = page.getByRole('dialog', { name: 'Error', exact: true });
            await expect(error).toContainText('Library unavailable');
            await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        }
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect(page.locator('.toast-msg', { hasText: 'Saved RT mixed' })).toBeVisible();
        expect(writes).toEqual(['library', 'graph']);
        expect(graph).toEqual([{ dependentId: 'mixed', dependencyId: 'root' }]);
    });
}
