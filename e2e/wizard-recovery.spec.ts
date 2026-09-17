import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

for (const surface of ['classic', 'wizard', 'transformer']) for (const leave of [false, true]) for (const expire of [false, true]) {
    test(`${surface} ${leave ? 'save before leaving' : 'save'} ${expire ? 'stops after idle logout during readback' : 'continues after an ordinary readback failure'}`, async ({ page }, testInfo) => {
        await page.clock.install();
        let channel: any = makeChannel('readback-session');
        const libraries = structuredClone(DEFAULT_FIXTURES['GET /codeTemplateLibraries']);
        let saved = false, held = false, libraryWrites = 0, graphWrites = 0, deploys = 0, revocations = 0;
        let graph: any[] = [];
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const events: string[] = [];
        await mockEngine(page, {
            'GET /server/publicSettings': { administratorAutoLogoutIntervalEnabled: true, administratorAutoLogoutIntervalField: '1' },
            'POST /users/_inactivityLogout': () => { revocations++; events.push('revocation-request'); return { __status: 503, body: 'synthetic remote revocation failure' }; },
            'GET /channels/readback-session': async () => {
                if (saved && !held) {
                    held = true;
                    events.push('readback-held');
                    await gate;
                    events.push('readback-released');
                    if (!expire) return { __status: 503, body: 'synthetic readback failure' };
                }
                return { channel };
            },
            'PUT /channels/readback-session': (req: any) => { channel = req.postDataJSON().channel; saved = true; events.push('channel-accepted'); return true; },
            'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
            'GET /codeTemplateLibraries': () => libraries,
            'POST /codeTemplateLibraries/_bulkUpdate': () => {
                libraryWrites++; events.push('library-written');
                libraries.list.codeTemplateLibrary[0].enabledChannelIds = { string: [channel.id] } as any;
                return { result: { librariesSuccess: true, overrideNeeded: false } };
            },
            'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
            'PUT /server/channelDependencies': (req: any) => { graphWrites++; events.push('graph-written'); graph = req.postDataJSON().set.channelDependency; return ''; },
            'POST /channels/readback-session/_deploy': () => { deploys++; events.push('deployed'); return ''; },
        });
        try {
            await page.goto('/channels/readback-session/guided');
            await page.locator('.view-body input').first().fill('Readback session boundary');
            await page.getByRole('button', { name: 'Next', exact: true }).click();
            await page.getByRole('checkbox').first().check();
            await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
            await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
            await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
            if (surface !== 'wizard') {
                await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
                if (surface === 'transformer') {
                    await page.getByRole('tab', { name: 'Source', exact: true }).click();
                    await page.getByRole('button', { name: /^Edit Transformer/ }).click();
                }
            }
            if (leave) {
                await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
                await page.getByRole('dialog').last().getByRole('button', { name: surface === 'wizard' ? 'Save' : 'Save Changes', exact: true }).click();
            } else if (surface === 'wizard') {
                for (let step = 0; step < 5; step++) await page.getByRole('button', { name: 'Next', exact: true }).click();
                await page.getByRole('main').getByRole('button', { name: 'Save & Deploy', exact: true }).click();
            } else {
                await page.getByRole('button', { name: surface === 'transformer' ? 'Save Channel' : 'Save Changes', exact: true }).click();
            }
            await expect.poll(() => held).toBe(true);
            if (expire) {
                await page.clock.fastForward(90_000);
                await expect.poll(() => revocations).toBe(1);
                await expect(page.locator('.shell')).toHaveCount(0);
                await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
                events.push('login-visible');
            }
            release();
            await expect.poll(() => events.includes('readback-released')).toBe(true);
            if (expire) {
                // Let the rejected response and the callers' async continuations finish.
                await page.waitForTimeout(500);
                expect({ libraryWrites, graphWrites, deploys }, JSON.stringify(events)).toEqual({ libraryWrites: 0, graphWrites: 0, deploys: 0 });
                await expect(page.getByRole('dialog')).toHaveCount(0);
                await expect(page.locator('.toast-msg')).toHaveCount(0);
                await expect(page).toHaveURL(/\/$/);
            } else {
                await expect.poll(() => graphWrites).toBe(1);
                expect(libraryWrites).toBe(1);
                expect(events.filter(event => event === 'channel-accepted')).toHaveLength(1);
                if (leave || surface === 'wizard') await expect(page).toHaveURL(/\/dashboard$/);
                expect(deploys).toBe(surface === 'wizard' && !leave ? 1 : 0);
            }
        } finally {
            release();
            await testInfo.attach('readback-session-observations', { body: JSON.stringify({ surface, leave, expire, events }, null, 2), contentType: 'application/json' });
        }
    });
}

for (const fresh of [true, false]) {
    for (const failure of ['channel', 'library', 'graph', 'deployment']) {
        test(`F08: ${fresh ? 'new' : 'existing'} wizard resumes after ${failure} failure`, async ({ page }) => {
            let channel: any = fresh ? null : makeChannel('recovery');
            let failed = false;
            let graph: any[] = [];
            const attempts: string[] = [], accepted: string[] = [], creates: string[] = [];
            let libraries = structuredClone(DEFAULT_FIXTURES['GET /codeTemplateLibraries']);
            const result = (stage: string, success: any) => {
                attempts.push(stage);
                if (stage === failure && !failed) { failed = true; return { __status: 503, body: { error: `synthetic ${stage} failure` } }; }
                accepted.push(stage);
                return success();
            };
            await mockEngine(page, {
                'GET /channels/*': () => ({ channel }),
                'GET /channels/idsAndNames': { map: { entry: [{ string: ['root', 'Prerequisite'] }] } },
                'GET /codeTemplateLibraries': () => libraries,
                'POST /channels': (req: any) => result('channel', () => {
                    channel = req.postDataJSON().channel;
                    channel.revision = 1;
                    creates.push(channel.id);
                    return true;
                }),
                'PUT /channels/*': (req: any) => result('channel', () => { channel = req.postDataJSON().channel; return true; }),
                'POST /codeTemplateLibraries/_bulkUpdate': () => result('library', () => {
                    libraries = structuredClone(libraries);
                    libraries.list.codeTemplateLibrary[0].enabledChannelIds = { string: [channel.id] } as any;
                    return { result: { librariesSuccess: true, overrideNeeded: false } };
                }),
                'GET /server/channelDependencies': () => ({ set: { channelDependency: graph } }),
                'PUT /server/channelDependencies': (req: any) => result('graph', () => {
                    graph = req.postDataJSON().set.channelDependency;
                    expect(graph).toEqual([{ dependentId: channel.id, dependencyId: 'root' }]);
                    return '';
                }),
                'POST /channels/*/_deploy': () => result('deployment', () => ''),
            });
            await page.goto(fresh ? '/channels/new/guided' : '/channels/recovery/guided');
            await page.locator('.view-body input').first().fill('Recovery channel');
            const next = page.getByRole('button', { name: 'Next', exact: true });
            await next.click();
            await page.getByRole('checkbox').first().check();
            await page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true }).click();
            await page.getByRole('button', { name: 'Add channel', exact: true }).first().click();
            await page.locator('.modal').getByText('Prerequisite', { exact: true }).click();
            await page.locator('.modal').getByRole('button', { name: /^Add/ }).click();
            for (let step = 0; step < 5; step++) await next.click();
            await page.getByRole('main').getByRole('button', { name: fresh ? 'Create & Deploy' : 'Save & Deploy', exact: true }).click();
            const error = page.getByRole('dialog', { name: failure === 'deployment' ? 'Channel Deployment Failed' : 'Error', exact: true });
            await expect(error).toContainText(`synthetic ${failure} failure`);
            await error.getByRole('button', { name: /Close|OK/, exact: true }).last().click();
            await expect(page).toHaveURL(/\/guided$/);
            await expect(page.getByRole('status').filter({ hasText: failure === 'deployment' ? 'Deployment failed' : /pending|save failed/ })).toBeVisible();
            if (failure !== 'deployment') expect(attempts).not.toContain('deployment');
            expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(failure !== 'deployment');
            const retry = page.getByRole('main').getByRole('button', { name: failure === 'deployment' ? 'Retry Deploy' : (fresh && failure === 'channel' ? 'Create & Deploy' : 'Save & Deploy'), exact: true });
            await retry.click();
            if (fresh && failure === 'channel') {
                await page.getByRole('dialog', { name: 'Creation Outcome Unknown', exact: true }).getByRole('button', { name: 'Retry Creation', exact: true }).click();
            }
            await expect(page).toHaveURL(/\/dashboard$/);
            expect(accepted).toEqual(['channel', 'library', 'graph', 'deployment']);
            expect(attempts.filter(stage => stage === failure)).toHaveLength(2);
            expect(creates).toHaveLength(fresh ? 1 : 0);
        });
    }
}

for (const { columns, description } of [
    { columns: 'default', description: 'Recovery description' },
    { columns: 'cleared', description: 'Recovery description' },
    ...['123', 'false', 'null'].map(description => ({ columns: 'default', description })),
]) {
    test(`F08: a lost creation response with ${columns} metadata columns and description ${JSON.stringify(description)} resumes pending libraries without another create`, async ({ page }) => {
        let channel: any = null, creates = 0, updates = 0, libraryWrites = 0;
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
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            'GET /channels/*': () => ({ channel }),
            'PUT /channels/*': () => { updates++; return true; },
            'POST /codeTemplateLibraries/_bulkUpdate': () => {
                libraryWrites++;
                return { result: { librariesSuccess: true, overrideNeeded: false } };
            },
        });
        await page.route('**/api/channels', async route => {
            if (route.request().method() !== 'POST') return route.fallback();
            creates++;
            const singleton = (value: any): any => Array.isArray(value)
                ? value.length === 1 ? singleton(value[0]) : value.map(singleton)
                : value && typeof value === 'object'
                    ? Object.fromEntries(Object.entries(value).map(([key, node]) => [key, singleton(node)])) : value;
            channel = singleton(route.request().postDataJSON().channel);
            expect(channel.description).toBe(description);
            if (['123', 'false', 'null'].includes(description)) channel.description = JSON.parse(description);
            if (columns === 'cleared') {
                expect(channel.properties.metaDataColumns).toEqual({ metaDataColumn: [] });
                channel.properties.metaDataColumns = null;
            }
            channel.revision = 1;
            await gate;
            await route.abort('failed'); // Engine accepted the write; its receipt is lost.
        });
        await page.goto('/channels/new/guided');
        await page.locator('.view-body input').first().fill('Lost receipt');
        await page.getByLabel('Description', { exact: true }).fill(description);
        const next = page.getByRole('button', { name: 'Next', exact: true });
        await next.click();
        await page.getByRole('checkbox').first().check();
        await next.click();
        if (columns === 'cleared') {
            const metadata = page.locator('.panel').filter({ has: page.getByText('Custom Metadata Columns', { exact: true }) });
            await expect(metadata.locator('button.btn-danger')).not.toHaveCount(0);
            while (await metadata.locator('button.btn-danger').count()) await metadata.locator('button.btn-danger').first().click();
            await expect(metadata).toContainText('No custom columns.');
        }
        for (let step = 0; step < 4; step++) await next.click();
        const create = page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true });
        await create.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await expect.poll(() => creates).toBe(1);
        await expect(page.locator('.content-row')).toHaveJSProperty('inert', true);
        release();
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        await expect(error).toContainText('Channel save failed');
        expect(libraryWrites).toBe(0);
        expect(await page.evaluate(() => (window as any).submittedLibraries)).toHaveLength(0);
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await page.getByRole('main').getByRole('button', { name: 'Create Channel', exact: true }).click();
        await expect(page).toHaveURL(/\/channels$/);
        expect(creates).toBe(1);
        expect(updates).toBe(0);
        expect(libraryWrites).toBe(1);
        const submittedLibraries = await page.evaluate(() => (window as any).submittedLibraries);
        expect(submittedLibraries).toHaveLength(1);
        expect(submittedLibraries[0].list.codeTemplateLibrary).toEqual([
            expect.objectContaining({ id: 'lib-1', enabledChannelIds: { string: [channel.id] } }),
        ]);
    });
}
