import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';

// Exercise both command contracts through the public plugin API: the legacy
// task, additional route prerequisites, and runtime availability must all pass.
async function authorization(page: Page, denied: string[] = []) {
    await page.route('**/webadmin/plugins.json', async route => {
        const response = await route.fetch();
        const manifests = await response.json();
        manifests.push({ id: 'palette-permissions', authorization: true, entry: '/plugins/palette-permissions/entry.js' });
        await route.fulfill({ json: manifests });
    });
    await page.route('**/plugins/palette-permissions/entry.js*', route => route.fulfill({
        contentType: 'text/javascript',
        body: `export function register(p) {
            const state = window.palettePermissions = { denied: ${JSON.stringify(denied)}, available: true, runs: 0 };
            p.setAuthorizationController({ checkTask: (group, task) => !state.denied.includes(group + '/' + task) });
            state.update = (denied, available = true) => {
                state.denied = denied;
                state.available = available;
                p.store.setState('webPlugins', [...p.store.getState('webPlugins')]);
            };
            p.registerCommand({ id: 'open-channel-transformer', label: 'Open channel transformer',
                task: 'doEditChannel', rbac: 'channel',
                permissions: [['view', 'doShowChannel'], ['channelEdit', 'doEditTransformer']],
                visible: () => state.available,
                run: () => { state.runs++; p.router.navigate('/channels/c-started/transformer/0'); }
            });
        }`,
    }));
}

async function update(page: Page, denied: string[], available = true) {
    await page.evaluate(({ denied, available }) => (window as any).palettePermissions.update(denied, available), { denied, available });
}

async function open(page: Page, query = '') {
    await expect(page.getByRole('button', { name: 'Events', exact: true })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.locator('.cmdk-field input').fill(query);
}

const transformer = (page: Page) => page.locator('.cmdk-opt').filter({ hasText: 'Open channel transformer' });
const prerequisites = ['channel/doEditChannel', 'view/doShowChannel', 'channelEdit/doEditTransformer'];

test('permission removal requires reselection instead of running the next Settings command', async ({ page }) => {
    await authorization(page);
    await mockEngine(page);
    await page.goto('/events');
    await open(page, '>Settings:');
    await page.keyboard.press('ArrowDown');
    const selected = page.locator('.cmdk-opt[aria-selected="true"]');
    await expect(selected).toContainText('Settings: Administrator');
    await update(page, ['settings_Administrator/doRefresh', 'settings_Administrator/doSave']);
    await expect(page.locator('.cmdk-opt', { hasText: 'Settings: Administrator' })).toHaveCount(0);
    await expect(selected).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/events$/);
    await expect(page.locator('.cmdk')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(selected).toContainText('Settings: Server');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\?tab=server$/);
});

test('command visibility composes with its legacy task and every additional prerequisite', async ({ page }) => {
    await authorization(page);
    await mockEngine(page);
    await page.goto('/events');
    await open(page, '>Open channel transformer');
    await expect(transformer(page)).toHaveCount(1);
    for (const prerequisite of prerequisites) {
        await update(page, [prerequisite]);
        await expect(transformer(page)).toHaveCount(0);
        await update(page, []);
        await expect(transformer(page)).toHaveCount(1);
    }
    await update(page, [], false);
    await expect(transformer(page)).toHaveCount(0);
    await update(page, []);
    await expect(transformer(page)).toHaveCount(1);
    await transformer(page).click();
    await expect(page).toHaveURL(/\/channels\/c-started\/transformer\/0$/);
    expect(await page.evaluate(() => (window as any).palettePermissions.runs)).toBe(1);
});

for (const revoked of [...prerequisites, 'availability', 'logout']) {
    test(`queued command rechecks ${revoked} after closing the palette`, async ({ page }) => {
        await authorization(page);
        await mockEngine(page);
        await page.goto('/events');
        await open(page, '>Open channel transformer');
        await expect(transformer(page)).toHaveCount(1);
        await transformer(page).evaluate(async (element, revoked) => {
            // Capture the public platform before clicking, then change access in
            // the same browser task, before the deferred invocation can run.
            const { platform } = await import(String('@oie/web-shell'));
            (element as HTMLElement).click();
            const state = (window as any).palettePermissions;
            if (revoked === 'availability') state.available = false;
            else if (revoked === 'logout') platform.store.setState('user', null);
            else state.denied = [revoked];
        }, revoked);
        await expect(page.locator('.cmdk')).toHaveCount(0);
        // This later timer settles the palette's already-queued zero-delay work.
        await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
        expect(await page.evaluate(() => (window as any).palettePermissions.runs)).toBe(0);
        await expect(page).toHaveURL(/\/events$/);
        if (revoked === 'logout') await expect(page.locator('.shell')).toHaveCount(0);
    });
}

test('an open contextual palette recovers template permissions and removes revoked suggestions', async ({ page }) => {
    let libraryReads = 0;
    const denied = ['channel/doEditCodeTemplates', 'codeTemplate/doRefreshCodeTemplates'];
    await authorization(page, denied);
    await mockEngine(page, {
        'GET /codeTemplateLibraries': () => {
            libraryReads++;
            return { list: { codeTemplateLibrary: DEFAULT_FIXTURES['GET /codeTemplateLibraries'].list.codeTemplateLibrary
                .map(library => ({ ...library, enabledChannelIds: { string: 'c-started' } })) } };
        },
    });
    await page.goto('/messages/c-started');
    await open(page);
    const suggested = page.locator('.cmdk-opt[data-group="Suggested"]');
    const library = suggested.filter({ has: page.locator('.cmdk-hint', { hasText: /^code template library$/ }) });
    await expect(suggested).toHaveCount(1);
    expect(libraryReads).toBe(0);
    await update(page, []);
    await expect.poll(() => libraryReads).toBe(1);
    await expect(library).toHaveCount(1);
    await update(page, [...denied, 'channel/doEditChannel']);
    await expect(suggested).toHaveCount(0);
    expect(libraryReads).toBe(1);
    await update(page, []);
    await expect.poll(() => libraryReads).toBe(2);
    await expect(library).toHaveCount(1);
});
