import { test, expect } from './base.js';
import type { Page } from '@playwright/test';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

async function captureSubmittedLibraries(page: Page) {
    // WebKit's intercepted postData omits multipart Blob contents. Observe
    // the submitted FormData without changing what fetch transmits.
    await page.addInitScript(() => {
        (window as any).submittedLibraries = [];
        const send = window.fetch;
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            if (String(args[0]).includes('/codeTemplateLibraries/_bulkUpdate') && args[1]?.body instanceof FormData) {
                const libraries = args[1].body.get('libraries');
                (window as any).submittedLibraries.push(JSON.parse(typeof libraries === 'string' ? libraries : await (libraries as Blob).text()));
            }
            return send(...args);
        };
    });
}

for (const accept of [false, true]) for (const change of ['addition', 'removal']) {
    test(`classic dependency reopening reflects an external ${change} after ${accept ? 'OK' : 'Cancel'}`, async ({ page }) => {
        const edge = { dependentId: 'refresh', dependencyId: 'root' };
        let graph = change === 'removal' ? [edge] : [];
        await mockEngine(page, {
            'GET /channels/refresh': { channel: makeChannel('refresh') },
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'External prerequisite'] }] } },
            'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
        });
        await page.goto('/channels/refresh/edit');
        await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        let dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
        await dialog.getByRole('button', { name: accept ? 'OK' : 'Cancel', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        graph = change === 'addition' ? [edge] : [];
        await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
        await dialog.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
        const external = dialog.getByText('External prerequisite', { exact: true });
        if (change === 'addition') await expect(external).toBeVisible();
        else await expect(external).toHaveCount(0);
    });
}

for (const surface of ['classic', 'wizard']) {
    test(`F02: ${surface} merges memberships into current guarded libraries`, async ({ page }) => {
        await captureSubmittedLibraries(page);
        let reads = 0, writes = 0;
        const original = { '@version': '4.6.0', id: 'shared', name: 'Shared', revision: 1, includeNewChannels: false, codeTemplates: '' };
        await mockEngine(page, {
            'GET /channels/deps': { channel: makeChannel('deps') },
            'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: ++reads === 1 ? [original] : [
                { ...original, name: 'Renamed in Swing', revision: 8, enabledChannelIds: { string: ['other'] } },
                { ...original, id: 'new-library', name: 'Concurrent addition' },
            ] } }),
            'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
                writes++;
                expect(new URL(req.url()).searchParams.get('override')).toBe('false');
                return { codeTemplateLibrarySaveResult: { librariesSuccess: true, overrideNeeded: false } };
            },
            'PUT /channels/deps': true,
        });
        await page.goto(`/channels/deps/${surface === 'classic' ? 'edit' : 'guided'}`);
        if (surface === 'classic') {
            await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
            await dialog.getByRole('checkbox').first().check();
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
            await page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
        } else {
            await page.locator('.view-body input').first().fill('Changed channel');
            await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
            await page.getByRole('checkbox').first().check();
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        }
        await expect.poll(() => writes).toBe(1);
        expect(reads).toBe(2);
        const submitted = await page.evaluate(() => (window as any).submittedLibraries);
        expect(submitted).toHaveLength(1);
        expect(submitted[0].list.codeTemplateLibrary).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'shared', name: 'Renamed in Swing', revision: 8, enabledChannelIds: { string: ['other', 'deps'] } }),
            expect.objectContaining({ id: 'new-library' }),
        ]));
    });
}

for (const surface of ['classic', 'wizard']) {
    test(`F02: ${surface} saves the core graph without Web Support and preserves fresh Swing edges`, async ({ page }) => {
        let reads = 0, writes = 0;
        let graph = [{ dependentId: 'other', dependencyId: 'root' }];
        await mockEngine(page, {
            'GET /channels/deps': { channel: makeChannel('deps') },
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
            'GET /extensions/websupport/webplugins': { __status: 404 },
            'GET /server/channelDependencies': () => ({ set: { channelDependency: ++reads === 1 ? [] : graph } }),
            'PUT /server/channelDependencies': (req: any) => {
                writes++;
                graph = req.postDataJSON().set.channelDependency;
                expect(graph).toEqual([
                    { dependentId: 'other', dependencyId: 'root' },
                    { dependentId: 'deps', dependencyId: 'root' },
                ]);
                return '';
            },
            'PUT /channels/deps': true,
        });
        await page.goto(`/channels/deps/${surface === 'classic' ? 'edit' : 'guided'}`);
        if (surface === 'classic') await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
        else await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
        await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
        if (surface === 'classic') {
            await page.getByRole('button', { name: 'Add', exact: true }).first().click();
            const add = page.getByRole('dialog', { name: 'Add Dependency', exact: true });
            await add.getByRole('checkbox', { name: 'Prerequisite' }).check();
            await add.getByRole('button', { name: 'OK', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
            await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
            await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
        }
        if (surface === 'classic') {
            await page.getByRole('dialog', { name: 'Channel Dependencies', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
            await page.getByRole('dialog', { name: 'Save Dependencies', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
            await expect(page.getByRole('dialog', { name: 'Channel Dependencies', exact: true })).not.toBeVisible();
        } else {
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect(page.locator('.toast-msg', { hasText: 'Saved' })).toBeVisible();
        }
        expect(writes).toBe(1);
        expect(reads).toBeGreaterThanOrEqual(3); // Load, fresh preflight, persistence verification.
    });
}

for (const surface of ['classic', 'wizard']) for (const overwrite of [false, true]) {
    test(`F02: ${surface} ${overwrite ? 'overwrites' : 'cancels'} a library conflict like Swing`, async ({ page }) => {
        await captureSubmittedLibraries(page);
        let writes = 0;
        let libraries: any[] = [{ '@version': '4.6.0', id: 'shared', name: 'Shared', revision: 1, includeNewChannels: false, codeTemplates: '' }];
        await mockEngine(page, {
            'GET /channels/deps': { channel: makeChannel('deps') },
            'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: libraries } }),
            'POST /codeTemplateLibraries/_bulkUpdate': (req: any) => {
                writes++;
                expect(new URL(req.url()).searchParams.get('override')).toBe(writes === 1 ? 'false' : 'true');
                if (writes === 1) return { result: { overrideNeeded: true, librariesSuccess: false } };
                return { result: { overrideNeeded: false, librariesSuccess: true } };
            },
            'PUT /channels/deps': true,
        });
        await page.goto(`/channels/deps/${surface === 'classic' ? 'edit' : 'guided'}`);
        if (surface === 'classic') {
            await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
            await dialog.getByRole('checkbox').first().check();
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
            await page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
        } else {
            await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
            await page.getByRole('checkbox').first().check();
            await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        }
        const conflict = page.getByRole('dialog', { name: 'Code Template Libraries Modified', exact: true });
        await expect(conflict).toBeVisible();
        libraries = [...libraries, { ...libraries[0], id: 'new', name: 'Added during prompt' }];
        await conflict.getByRole('button', { name: overwrite ? 'Overwrite' : 'Cancel', exact: true }).click();
        if (overwrite) {
            await expect(page.locator('.toast-msg', { hasText: surface === 'classic' ? 'Code template libraries saved' : 'Saved' })).toBeVisible();
        } else if (surface === 'classic') {
            await expect(page.getByRole('dialog', { name: 'Channel Dependencies', exact: true })).toBeVisible();
        } else {
            await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
        }
        expect(writes).toBe(overwrite ? 2 : 1);
        const submitted = await page.evaluate(() => (window as any).submittedLibraries);
        expect(submitted).toHaveLength(writes);
        if (overwrite) expect(submitted[1].list.codeTemplateLibrary).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'new', name: 'Added during prompt' }),
        ]));
    });
}
