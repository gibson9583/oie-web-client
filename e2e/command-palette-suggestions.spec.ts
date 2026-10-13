import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';
import { makeChannel } from './connector-fixtures.js';

const baseLibrary = DEFAULT_FIXTURES['GET /codeTemplateLibraries'].list.codeTemplateLibrary[0];
const baseTemplate = baseLibrary.codeTemplates.codeTemplate[0];
const library = (id: string, name: string, extra: Record<string, any> = {}) => ({
    ...baseLibrary, id, name, enabledChannelIds: { string: 'c-started' },
    codeTemplates: { codeTemplate: [{ ...baseTemplate, id: id + '-template', name: name + ' Helper' }] },
    ...extra,
});
const explicit = library('explicit', 'Explicit Library');
const defaultLibrary = library('default', 'Default Library', { includeNewChannels: true, enabledChannelIds: '' });
const excluded = library('excluded', 'Excluded Library', {
    includeNewChannels: true, enabledChannelIds: '', disabledChannelIds: { string: 'c-started' },
});
const unrelated = library('unrelated', 'Unrelated Library', { enabledChannelIds: { string: 'c-stopped' } });
const catalog = (...libraries: any[]) => ({ list: { codeTemplateLibrary: libraries } });
const channelNames = { map: { entry: [
    { string: ['c-started', 'Demo Started'] }, { string: ['c-stopped', 'Demo Stopped'] },
] } };
const fixtures = {
    'GET /channels/idsAndNames': channelNames,
    'GET /channels/c-started': { channel: { ...makeChannel('c-started'), name: 'Demo Started' } },
    'GET /channels/c-stopped': { channel: { ...makeChannel('c-stopped'), name: 'Demo Stopped' } },
    'GET /codeTemplateLibraries': catalog(explicit, defaultLibrary, excluded, unrelated),
};
const suggested = (page: Page) => page.locator('.cmdk-opt[data-group="Suggested"]');
const recent = (page: Page) => page.locator('.cmdk-opt[data-group="Recent"]');
const option = (page: Page, label: string, hint?: string) => page.locator('.cmdk-opt')
    .filter({ has: page.locator('.cmdk-label', { hasText: new RegExp('^' + label + '$') }) })
    .filter(hint ? { has: page.locator('.cmdk-hint', { hasText: new RegExp('^' + hint + '$') }) } : {});

async function open(page: Page) {
    await expect(page.locator('.shell')).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk')).toBeVisible();
    return page.locator('.cmdk-field input');
}

async function close(page: Page) {
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk')).toHaveCount(0);
}

async function settle(page: Page, response: Awaited<ReturnType<Page['waitForResponse']>>) {
    await response.finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

test('messages suggest editing their channel even when the optional channel-name request fails', async ({ page }) => {
    let namesReads = 0;
    await mockEngine(page, { ...fixtures, 'GET /channels/idsAndNames': () => ++namesReads === 1
        ? channelNames : { __status: 503 } });
    await page.goto('/messages/c-started');
    // Messages loads its own channel picker; only the optional palette read fails.
    await expect.poll(() => namesReads).toBe(1);
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/channels/idsAndNames' && res.status() === 503);
    await open(page);
    await settle(page, await response);
    await expect(page.locator('.cmdk-group').first()).toHaveText('Suggested');
    await expect(suggested(page).first().locator('.cmdk-hint')).toHaveText('edit');
    await expect(suggested(page).first().locator('.cmdk-label')).toHaveText(/Demo Started|c-started/);
    await suggested(page).first().click();
    await expect(page).toHaveURL(/\/channels\/c-started\/edit$/);
    await expect(page.locator('.view-body input[type="text"]').first()).toHaveValue('Demo Started');
});

test('associated explicit and default libraries appear, and a template suggestion opens the exact template', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/messages/c-started');
    const query = await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText([
        'Demo Started', 'Explicit Library', 'Explicit Library Helper', 'Default Library', 'Default Library Helper',
    ]);
    await query.fill('#demo');
    await expect(page.locator('.cmdk-opt .cmdk-hint')).toHaveText(['edit', 'messages', 'edit', 'messages']);
    await query.fill('/events');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Events']);
    await query.fill('>prune');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Settings: Data Pruner']);
    await query.fill('');
    await option(page, 'Explicit Library Helper').click();
    await expect(page).toHaveURL(/\/code-templates\?libraryId=explicit&templateId=explicit-template$/);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await expect(page.locator('.field', { has: page.getByText('Name', { exact: true }) }).locator('input'))
        .toHaveValue('Explicit Library Helper');
});

test('suggestions are capped while template search can reach entries beyond the cap', async ({ page }) => {
    const many = library('many', 'Shared Functions', { codeTemplates: { codeTemplate: Array.from({ length: 9 }, (_, i) => ({
        ...baseTemplate, id: 'helper-' + i, name: 'Helper ' + i,
    })) } });
    await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': catalog(many) });
    await page.goto('/messages/c-started');
    const query = await open(page);
    await expect(suggested(page)).toHaveCount(6);
    await expect(suggested(page).locator('.cmdk-label')).not.toContainText(['Helper 8']);
    await query.fill('Helper 8');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Helper 8']);
});

test('recent destinations remain separate even when they are also suggested', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/messages/c-started');
    await open(page);
    await suggested(page).first().click();
    await expect(page).toHaveURL(/\/channels\/c-started\/edit$/);
    await expect(page.locator('.view-body input[type="text"]').first()).toHaveValue('Demo Started');
    await page.goBack();
    await expect(page).toHaveURL(/\/messages\/c-started$/);
    await open(page);
    await expect(suggested(page).first().locator('.cmdk-hint')).toHaveText('edit');
    await expect(recent(page).locator('.cmdk-label')).toHaveText(['Demo Started']);
    await expect(recent(page).locator('.cmdk-hint')).toHaveText(['edit']);
    await expect(option(page, 'Demo Started', 'edit')).toHaveCount(2);
    await expect(page.locator('.cmdk-opt[aria-selected="true"]')).toHaveCount(1);
    expect((await page.locator('.cmdk-group').allTextContents()).slice(0, 2)).toEqual(['Suggested', 'Recent']);
});

test('a template recent remains available after navigating to an unrelated view', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/messages/c-started');
    await open(page);
    await option(page, 'Explicit Library Helper').click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
    await open(page);
    await expect(suggested(page)).toHaveCount(0);
    await expect(recent(page).locator('.cmdk-label')).toHaveText(['Explicit Library Helper']);
    await recent(page).click();
    await expect(page).toHaveURL(/\/code-templates\?libraryId=explicit&templateId=explicit-template$/);
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
});

for (const surface of ['dashboard', 'cards', 'channels'] as const) {
    test(`${surface} suggestions follow selection, clear on deselection and do not leak into another view`, async ({ page }) => {
        await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': catalog() });
        await page.goto(surface === 'channels' ? '/channels' : '/dashboard');
        if (surface === 'cards') await page.getByRole('button', { name: 'Card view', exact: true }).click();
        await page.getByText('Demo Started', { exact: true }).click();
        await open(page);
        await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Demo Started']);
        await close(page);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await open(page);
        await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Stopped', 'Demo Stopped']);
        await close(page);
        const blank = page.locator(surface === 'cards' ? '.view > .overflow-auto'
            : surface === 'dashboard' ? '.dash-content .dt-wrap' : '.oie-tablecard .dt-wrap');
        const box = await blank.boundingBox();
        // Stay above the native horizontal scrollbar, which consumes clicks in WebKit.
        await blank.click({ position: { x: 8, y: box!.height - 30 } });
        await expect(page.getByRole('button', { name: 'View Messages', exact: true })).toHaveCount(0);
        await open(page);
        await expect(suggested(page)).toHaveCount(0);
        await close(page);
        await page.getByText('Demo Started', { exact: true }).click();
        await page.getByRole('button', { name: 'Events', exact: true }).click();
        await expect(page).toHaveURL(/\/events$/);
        await open(page);
        await expect(suggested(page)).toHaveCount(0);
    });
}

test('editor suggestions open messages through the existing unsaved-change guard', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/channels/c-started/edit');
    const name = page.locator('.view-body input[type="text"]').first();
    await name.fill('Unsaved channel name');
    await name.blur();
    await open(page);
    await expect(suggested(page).first().locator('.cmdk-hint')).toHaveText('messages');
    await suggested(page).first().click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/channels\/c-started\/edit$/);
    await expect(name).toHaveValue('Unsaved channel name');
});

test('connector editors suggest both the parent channel and its messages', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/channels/c-started/transformer/0');
    await expect(page.getByRole('button', { name: 'Back to Channel', exact: true })).toBeVisible();
    await open(page);
    await expect(suggested(page).locator('.cmdk-hint').first()).toHaveText('edit');
    await expect(suggested(page).locator('.cmdk-hint').nth(1)).toHaveText('messages');
    await expect(suggested(page).locator('.cmdk-label').first()).toHaveText('Demo Started');
});

test('selected libraries and templates suggest only channels using their library', async ({ page }) => {
    await mockEngine(page, fixtures);
    await page.goto('/code-templates?libraryId=explicit');
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Demo Started']);
    await close(page);
    await page.getByText('Unrelated Library Helper', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
    await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Stopped', 'Demo Stopped']);
});

test('reverse suggestions include an undeployed channel absent from the visited dashboard cache', async ({ page }) => {
    const undeployed = library('undeployed-library', 'Undeployed Library', { enabledChannelIds: { string: 'c-undeployed' } });
    await mockEngine(page, {
        ...fixtures,
        'GET /channels/idsAndNames': { map: { entry: [
            ...channelNames.map.entry, { string: ['c-undeployed', 'Undeployed Channel'] },
        ] } },
        'GET /channels/c-undeployed': { channel: { ...makeChannel('c-undeployed'), name: 'Undeployed Channel' } },
        'GET /codeTemplateLibraries': catalog(undeployed),
    });
    await page.goto('/dashboard');
    await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Code Templates', exact: true }).click();
    await page.getByText('Undeployed Library', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Export Library', exact: true })).toBeVisible();
    await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Undeployed Channel', 'Undeployed Channel']);
    await suggested(page).first().click();
    await expect(page).toHaveURL(/\/channels\/c-undeployed\/edit$/);
    await expect(page.locator('.view-body input[type="text"]').first()).toHaveValue('Undeployed Channel');
});

test('a failed library read keeps the direct channel action and retries on reopening', async ({ page }) => {
    let calls = 0;
    await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': () => ++calls === 1
        ? { __status: 503 } : catalog(explicit) });
    await page.goto('/messages/c-started');
    const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/codeTemplateLibraries');
    const query = await open(page);
    await settle(page, await response);
    await expect(suggested(page).locator('.cmdk-hint')).toHaveText(['edit']);
    await query.fill('/events');
    await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Events']);
    await close(page);
    await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Explicit Library', 'Explicit Library Helper']);
    expect(calls).toBe(2);
});

for (const exit of ['close', 'navigate'] as const) {
    test(`a held library response cannot restore stale results after ${exit}`, async ({ page }) => {
        let calls = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const stale = library('stale', 'Stale Library');
        await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': async () => {
            if (++calls === 1) { await gate; return catalog(stale); }
            return catalog(explicit);
        } });
        try {
            await page.goto('/messages/c-started');
            const query = await open(page);
            await expect.poll(() => calls).toBe(1);
            if (exit === 'close') await close(page);
            else {
                await query.fill('/events');
                await page.keyboard.press('Enter');
                await expect(page).toHaveURL(/\/events$/);
                await expect(page.locator('.cmdk')).toHaveCount(0);
            }
            const response = page.waitForResponse(res => new URL(res.url()).pathname === '/api/codeTemplateLibraries');
            release();
            await settle(page, await response);
            await expect(page.locator('.cmdk')).toHaveCount(0);
            if (exit === 'navigate') {
                await open(page);
                await expect(suggested(page)).toHaveCount(0);
                await close(page);
                await page.goBack();
                await expect(page).toHaveURL(/\/messages\/c-started$/);
            }
            await open(page);
            await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Explicit Library', 'Explicit Library Helper']);
            await expect(page.locator('.cmdk-opt', { hasText: 'Stale Library' })).toHaveCount(0);
            expect(calls).toBe(2);
        } finally { release(); }
    });
}

test('keyboard selection retains the recent destination when templates arrive above it', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': async () => { await gate; return catalog(explicit); } });
    try {
        await page.goto('/messages/c-started');
        await (await open(page)).fill('/events');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/events$/);
        await page.goBack();
        await expect(page).toHaveURL(/\/messages\/c-started$/);
        await open(page);
        await expect(recent(page).locator('.cmdk-label')).toHaveText(['Events']);
        await page.keyboard.press('ArrowDown');
        const selected = page.locator('.cmdk-opt[aria-selected="true"]');
        await expect(selected.locator('.cmdk-label')).toHaveText('Events');
        release();
        await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Explicit Library', 'Explicit Library Helper']);
        await expect(selected).toHaveCount(1);
        await expect(selected.locator('.cmdk-label')).toHaveText('Events');
        await expect(page.locator('.cmdk-field input')).toHaveAttribute('aria-activedescendant', await selected.getAttribute('id') as string);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/events$/);
    } finally { release(); }
});

for (const recoveryKey of ['ArrowDown', 'ArrowUp']) {
    test(`Enter waits for ${recoveryKey} to reselect after a delayed template recent removes the chosen view`, async ({ page }) => {
        let hold = false;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': async () => {
            if (hold) await gate;
            return catalog(explicit);
        } });
        try {
            await page.goto('/messages/c-started');
            await open(page);
            await option(page, 'Explicit Library Helper').click();
            await expect(page.getByRole('button', { name: 'Export Code Template', exact: true })).toBeVisible();
            hold = true;
            await page.goBack();
            await expect(page).toHaveURL(/\/messages\/c-started$/);
            const query = await open(page);
            const selected = page.locator('.cmdk-opt[aria-selected="true"]');
            for (let i = 0; i < 20 && await selected.locator('.cmdk-label').textContent() !== 'Events'; i++) {
                await page.keyboard.press('ArrowDown');
            }
            await expect(selected.locator('.cmdk-label')).toHaveText('Events');
            release();
            await expect(recent(page).locator('.cmdk-label')).toHaveText(['Explicit Library Helper']);
            await expect(selected).toHaveCount(0);
            await expect(query).not.toHaveAttribute('aria-activedescendant');
            await page.keyboard.press('Enter');
            await expect(page.locator('.cmdk')).toBeVisible();
            await expect(page).toHaveURL(/\/messages\/c-started$/);
            // Both deliberate arrow selection and a new search recover normally.
            await page.keyboard.press(recoveryKey);
            await expect(selected).toHaveCount(1);
            await expect(selected.locator('.cmdk-hint')).toHaveText('edit');
            await query.fill('/events');
            await expect(selected.locator('.cmdk-label')).toHaveText('Events');
            await page.keyboard.press('Enter');
            await expect(page).toHaveURL(/\/events$/);
        } finally { release(); }
    });
}

for (const surface of ['dashboard', 'cards'] as const) {
    test(`${surface} selection preserves status in suggested and searched channels`, async ({ page }) => {
        await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': catalog() });
        await page.goto('/dashboard');
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible();
        if (surface === 'cards') await page.getByRole('button', { name: 'Card view', exact: true }).click();
        for (const [name, state] of [['Demo Started', 'ok'], ['Demo Stopped', 'err']]) {
            await (await open(page)).fill('#' + name);
            await expect(option(page, name).first().locator('.cmdk-pip')).toHaveClass('cmdk-pip ' + state);
            await close(page);
            await page.getByText(name, { exact: true }).click();
            const query = await open(page);
            await expect(suggested(page)).toHaveCount(2);
            await expect(suggested(page).first().locator('.cmdk-pip')).toHaveClass('cmdk-pip ' + state);
            await query.fill('#' + name);
            await expect(option(page, name).first().locator('.cmdk-pip')).toHaveClass('cmdk-pip ' + state);
            await close(page);
        }
    });
}

async function installAuthorizationProbe(page: Page, denied = ['channel:doEditChannel', 'codeTemplate:doRefreshCodeTemplates']) {
    await page.route('**/webadmin/plugins.json', async route => {
        const response = await route.fetch();
        const manifests = await response.json();
        manifests.push({ id: 'suggestions-rbac-probe', version: '1.0.0', entry: '/plugins/suggestions-rbac-probe/entry.js' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(manifests) });
    });
    await page.route('**/plugins/suggestions-rbac-probe/entry.js*', route => route.fulfill({
        status: 200, contentType: 'application/javascript', body: `export function register(p) {
            window.suggestionDenied = ${JSON.stringify(denied)};
            p.setAuthorizationController({checkTask:(group,task)=>!window.suggestionDenied.includes(group+':'+task)});
            window.suggestionProbeReady = true;
        }`,
    }));
}

test('suggestions respect edit and template permissions at render and at activation', async ({ page }) => {
    let libraryReads = 0;
    await installAuthorizationProbe(page);
    await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': () => { libraryReads++; return catalog(explicit); } });
    await page.goto('/messages/c-started');
    await expect.poll(() => page.evaluate(() => (window as any).suggestionProbeReady)).toBe(true);
    await open(page);
    await expect(suggested(page)).toHaveCount(0);
    expect(libraryReads).toBe(0);
    await close(page);
    await page.evaluate(() => { (window as any).suggestionDenied = []; });
    await open(page);
    await expect(suggested(page).locator('.cmdk-label')).toHaveText(['Demo Started', 'Explicit Library', 'Explicit Library Helper']);
    // Revoke and dispatch in one browser task so an intervening render cannot
    // remove the target before the navigation and history guard is exercised.
    await suggested(page).first().evaluate(element => {
        (window as any).suggestionDenied = ['channel:doEditChannel'];
        (element as HTMLElement).click();
    });
    await expect(page).toHaveURL(/\/messages\/c-started$/);
    await expect(page.locator('.cmdk')).toBeVisible();
    await option(page, 'Explicit Library Helper').evaluate(element => {
        (window as any).suggestionDenied = ['channel:doEditChannel', 'codeTemplate:doRefreshCodeTemplates'];
        (element as HTMLElement).click();
    });
    await expect(page).toHaveURL(/\/messages\/c-started$/);
    await expect(page.locator('.cmdk')).toBeVisible();
    await close(page);
    await open(page);
    await expect(suggested(page)).toHaveCount(0);
    await expect(recent(page)).toHaveCount(0);
});

for (const surface of ['dashboard', 'cards', 'channels'] as const) {
    test(`${surface} suggestions enforce the contextual message permission both before and after rendering`, async ({ page }) => {
        const permission = surface === 'channels' ? 'channel:doViewMessages' : 'dashboard:doShowMessages';
        await installAuthorizationProbe(page, [permission]);
        await mockEngine(page, { ...fixtures, 'GET /codeTemplateLibraries': catalog() });
        await page.goto(surface === 'channels' ? '/channels' : '/dashboard');
        await expect.poll(() => page.evaluate(() => (window as any).suggestionProbeReady)).toBe(true);
        if (surface === 'cards') await page.getByRole('button', { name: 'Card view', exact: true }).click();
        await page.getByText('Demo Started', { exact: true }).click();
        await open(page);
        await expect(suggested(page).locator('.cmdk-hint')).toHaveText(['edit']);
        await close(page);
        await page.evaluate(() => { (window as any).suggestionDenied = []; });
        await open(page);
        await expect(suggested(page).locator('.cmdk-hint')).toHaveText(['edit', 'messages']);
        await suggested(page).filter({ has: page.locator('.cmdk-hint', { hasText: /^messages$/ }) }).evaluate((element, value) => {
            (window as any).suggestionDenied = [value];
            (element as HTMLElement).click();
        }, permission);
        await expect(page).toHaveURL(new RegExp('/' + (surface === 'channels' ? 'channels' : 'dashboard') + '$'));
        await expect(page.locator('.cmdk')).toBeVisible();
        await close(page);
        await open(page);
        await expect(recent(page)).toHaveCount(0);
    });
}
