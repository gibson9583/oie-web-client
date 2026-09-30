import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

async function text(page: Page, source: string) {
    return page.evaluate(async source => { const module = '@oie/web-ui'; return (await import(module)).t(source); }, source);
}
async function button(page: Page, source: string) {
    return page.getByRole('button', { name: await text(page, source), exact: true });
}
async function setLanguage(page: Page, tag: string) {
    await page.addInitScript(tag => {
        if (!sessionStorage.getItem('i18n-test-initialized')) {
            localStorage.setItem('oie-locale', tag);
            sessionStorage.setItem('i18n-test-initialized', 'true');
        }
    }, tag);
}
async function switchLanguage(page: Page, tag: string) {
    // Public plugin API exercises the same host guard as the two UI pickers.
    return page.evaluate(async tag => { const module = '@oie/web-ui'; return (await import(module)).setLocale(tag); }, tag);
}

test('production ignores the development pseudo-locale query', async ({page}) => {
    test.skip(process.env.E2E_PSEUDO === '1', 'This run intentionally uses the development test bundle');
    await mockEngine(page); await page.goto('/dashboard?locale=en-XA');
    await expect(page.getByRole('button',{name:'Dashboard',exact:true})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang','en');
});

for (const [language, expected] of [['zh-SG', 'zh-CN'], ['zh-TW', 'en'], ['en-GB', 'en']]) {
    test(`browser language ${language} negotiates ${expected} before registration`, async ({ page }) => {
        await page.addInitScript(language => Object.defineProperty(navigator, 'languages', { value: [language] }), language);
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.locator('html')).toHaveAttribute('lang', expected);
        await expect(page.getByRole('button', { name: expected === 'zh-CN' ? '仪表盘' : 'Dashboard', exact: true })).toBeVisible();
        await expect(page.getByText('Demo Started', { exact: true })).toBeVisible(); // engine-owned name
        expect(await page.evaluate(async () => {
            const uiName = '@oie/web-ui', shellName = '@oie/web-shell';
            const ui = await import(uiName), shell = await import(shellName);
            return ui.t === shell.platform.i18n.t && ui.locale() === shell.platform.i18n.locale();
        })).toBe(true);
    });
}

test('login picker reloads once and preserves native language names', async ({ page }) => {
    await mockEngine(page, { 'GET /users/current': { __status: 401 } });
    await page.goto('/');
    const picker = page.locator('[data-language-select]');
    await expect(picker.locator('option')).toHaveText(['English', '简体中文']);
    await picker.selectOption('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('oie-locale'))).toBe('zh-CN');
    await expect(picker).toHaveValue('zh-CN');
});

for (const failure of ['missing', 'invalid', 'slow']) {
    test(`a ${failure} host catalog boots usable English`, async ({ page }) => {
        await setLanguage(page, 'zh-CN');
        await page.route(/\/assets\/zh-CN-[^/]+\.js$/, async route => {
            if (failure === 'slow') await new Promise(resolve => setTimeout(resolve, 2400));
            await route.fulfill(failure === 'missing' ? { status: 404, body: 'missing' }
                : { contentType: 'text/javascript', body: failure === 'invalid' ? 'export default {"Save":42}' : 'export default {"Dashboard":"迟到"}' });
        });
        await mockEngine(page);
        await page.goto('/dashboard');
        await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        // A failed load preserves the preference so a repaired deployment can retry.
        expect(await page.evaluate(() => localStorage.getItem('oie-locale'))).toBe('zh-CN');
    });
}

for (const surface of ['channel', 'alert', 'settings', 'scripts', 'templates']) {
    test(`cancel language switch retains ${surface} draft and preference`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        await mockEngine(page, { 'GET /channels/locale': { channel: makeChannel('locale') } });
        const route = surface === 'channel' ? '/channels/locale/edit' : surface === 'alert' ? '/alerts/new/guided'
            : surface === 'settings' ? '/settings?tab=Administrator' : surface === 'scripts' ? '/global-scripts' : '/code-templates';
        await page.goto(route);
        if (surface === 'templates') await page.getByText('Demo Library', { exact: true }).click();
        const input = surface === 'scripts' ? page.locator('textarea.ce-area').first()
            : surface === 'settings' ? page.locator('input[type=number]').first()
                : surface === 'templates' ? page.locator('.field', {has: page.getByText('Name', {exact:true})}).locator('input') : page.locator('.view-body input[type=text]').first();
        await input.fill(surface === 'settings' ? '23' : 'Unsaved locale draft');
        await input.blur();
        const preference = await page.evaluate(() => localStorage.getItem('oie-locale'));
        const switching = switchLanguage(page, 'zh-CN');
        const dialog = page.getByRole('dialog', { name: 'Change language', exact: true });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(await switching).toBe(false);
        await expect(input).toHaveValue(surface === 'settings' ? '23' : 'Unsaved locale draft');
        expect(await page.evaluate(() => localStorage.getItem('oie-locale'))).toBe(preference);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
}

test('Administrator selector does not create a dirty edit and another tab keeps its current language', async ({ page, context }) => {
    await mockEngine(page);
    await page.goto('/settings?tab=Administrator');
    const other = await context.newPage();
    await mockEngine(other);
    await other.goto('/dashboard');
    await expect(other.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await page.bringToFront();
    await page.locator('[data-language-select]').selectOption('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: await text(page, 'Administrator'), exact: true })).toHaveAttribute('data-state', 'active');
    await expect(other.locator('html')).toHaveAttribute('lang', 'en');
    await other.bringToFront();
    await other.reload();
    await expect(other.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await other.close();
});

for (const deployment of ['node', 'war']) {
    for (const apiMin of [undefined, '4.6', '4.7', '4.8']) {
        test(`${deployment} plugin catalog loads with ${apiMin ?? 'no'} apiMin before module evaluation`, async ({ page }) => {
            await setLanguage(page, 'zh-CN');
            if (deployment === 'war') {
                await page.route('**/dashboard', async route => {
                    const response = await route.fetch();
                    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "frame-ancestors 'none'" } });
                });
                await page.route('**/webadmin/config.json', route => route.fulfill({ json: { deployment: 'war', engines: [{ name: 'Engine' }] } }));
            }
            let catalogHeaders: Record<string, string> = {};
            await mockEngine(page, {
                'GET /webplugins': { __status: 404 },
                'GET /extensions/websupport/webplugins': ['localeplug'],
                'GET /extensions/websupport/webplugins/localeplug/plugin.json': {
                    id: 'locale-plug', name: 'Locale plugin', version: '1.0.0', oie: { apiMin },
                    client: { entry: 'web/plugin.js' }, i18n: { 'zh-CN': 'i18n/zh-CN.json' }
                },
                'GET /extensions/websupport/webplugins/localeplug/i18n/zh-CN.json': (req: any) => {
                    catalogHeaders = req.headers(); return { 'Plugin tools': '插件工具' };
                }
            });
            await page.route('**/api/extensions/websupport/webplugins/localeplug/web/plugin.js*', route => route.fulfill({
                contentType: 'text/javascript', body: `import {scope} from '@oie/web-ui'; const {t}=scope('locale-plug'); const label=t('Plugin tools');
                    export function register(platform){platform.registerNavItem({id:'locale-plug',path:'/locale-plug',icon:'puzzle',label,section:'plugin-tools',sectionLabel:label});}`
            }));
            await page.goto('/dashboard');
            await expect(page.locator('[data-nav-item=locale-plug]')).toBeVisible();
            await expect(page.locator('[data-nav-item=locale-plug]')).toContainText('插件工具');
            expect(await page.evaluate(async () => {
                const module = '@oie/web-shell';
                const { platform } = await import(module);
                const item = platform.navItems().find((item: any) => item.id === 'locale-plug');
                return { apiVersion: platform.apiVersion, section: item?.section, sectionLabel: item?.sectionLabel };
            })).toEqual({ apiVersion: '4.8.0', section: 'plugin-tools', sectionLabel: '插件工具' });
            expect(catalogHeaders['x-requested-with']).toBe('OpenIntegrationEngine-WebAdmin');
            expect(catalogHeaders['x-oie-context']).toBeTruthy();
        });
    }
}

for (const hasI18n of [true, false]) {
    test(`documented plugin keeps working with localization ${hasI18n ? 'available' : 'absent'}`, async ({ page }) => {
        await setLanguage(page, 'zh-CN');
        const docs = readFileSync(new URL('../web-administrator/PLUGINS.md', import.meta.url), 'utf8');
        const source = docs.split('## Localization\n')[1].match(/```js\n([\s\S]*?)\n```/)![1];
        await mockEngine(page, {
            'GET /webplugins': ['example'],
            'GET /webplugins/example/plugin.json': {
                id: 'example', name: 'Example plugin', version: '1.0.0', oie: { apiMin: '4.6' },
                client: { entry: 'web/plugin.js' }, i18n: { 'zh-CN': 'i18n/zh-CN.json' }
            },
            'GET /webplugins/example/i18n/zh-CN.json': { 'Example tools': '示例工具' }
        });
        const body = hasI18n ? source : source.replace('export function register(', 'function registerExample(')
            + '\nexport function register(platform) { registerExample({ ...platform, i18n: undefined }); }';
        await page.route('**/api/webplugins/example/web/plugin.js*', route => route.fulfill({ contentType: 'text/javascript', body }));
        await page.goto('/dashboard');
        await expect(page.locator('[data-nav-item=example]')).toContainText(hasI18n ? '示例工具' : 'Example tools');
    });
}

test('Chinese Monaco loads localized labels without changing language IDs', async ({ page }) => {
    await setLanguage(page, 'zh-CN');
    await mockEngine(page, { 'GET /channels/locale': { channel: makeChannel('locale') } });
    await page.goto('/global-scripts');
    await expect(page.locator('.ce .monaco-editor').first()).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => (globalThis as any)._VSCODE_NLS_LANGUAGE)).toBe('zh-cn');
    expect(await page.evaluate(async () => {
        const module = '/core/monaco.js', { mountMonaco } = await import(module);
        const el = document.createElement('div'); document.body.append(el);
        const editor: any = {el, getValue: () => '原始文本', setValue: () => {}, focus: () => {}};
        mountMonaco((window as any).monaco, editor, {language:'text'});
        try { return editor.monaco.getModel().getLanguageId(); }
        finally { editor.dispose(); el.remove(); }
    })).toBe('plaintext');
});

test('a slow Chinese Monaco pack still loads the Chinese editor', async ({ page }) => {
    await setLanguage(page, 'zh-CN');
    await page.route('**/vendor/monaco/nls/zh-cn.js', async route => {
        await new Promise(resolve => setTimeout(resolve, 2600));
        await route.continue();
    });
    await mockEngine(page);
    await page.goto('/global-scripts');
    await expect(page.locator('.ce .monaco-editor').first()).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => (globalThis as any)._VSCODE_NLS_LANGUAGE)).toBe('zh-cn');
});

test('a missing Chinese Monaco pack loads the English editor', async ({ page }) => {
    await setLanguage(page, 'zh-CN');
    await page.route('**/vendor/monaco/nls/zh-cn.js', route => route.fulfill({ status: 404, body: '' }));
    await mockEngine(page);
    await page.goto('/global-scripts');
    await expect(page.locator('.ce .monaco-editor').first()).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => (globalThis as any)._VSCODE_NLS_LANGUAGE ?? null)).toBeNull();
});

test('Chinese calendar loads localized labels without changing timestamp values', async ({ page }) => {
    await setLanguage(page, 'zh-CN');
    await mockEngine(page);
    await page.goto('/messages/ch-1');
    await (await button(page, 'Start date')).click();
    await expect(page.getByRole('button', { name: '前往下个月' })).toBeVisible();
});

test('English, Chinese and pseudo saves produce the same channel, template, alert and user payloads', async ({ page }) => {
    test.setTimeout(90000); // Multiple complete editor and user flows in each locale.
    const snapshots: Record<string, any>[] = [];
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.clock.setFixedTime(new Date('2026-01-02T03:04:05Z'));
    await page.addInitScript(() => {
        const send = window.fetch;
        window.fetch = async (...args: Parameters<typeof fetch>) => {
            if (args[1]?.body instanceof FormData) (window as any).i18nForm = await Promise.all(Array.from(args[1].body.entries()).map(async ([k,v]) => [k, typeof v === 'string' ? v : await v.text()]));
            return send(...args);
        };
    });
    const alert = { '@version': '4.6.0', id: 'locale', name: 'Original', enabled: true,
        trigger: { '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] }, alertChannels: { newChannelSource: false, newChannelDestination: false, enabledChannels: null, disabledChannels: null, partialChannels: null } },
        actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] }, properties: null };
    await mockEngine(page, {
        'GET /channels/locale': { channel: makeChannel('locale') }, 'GET /alerts/locale': { alertModel: alert },
        'PUT /alerts/locale': true, 'PUT /users/2': true,
        'POST /codeTemplateLibraries/_bulkUpdate': { codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} } }
    });
    for (const tag of ['en', 'zh-CN', ...(process.env.E2E_PSEUDO === '1' ? ['en-XA'] : [])]) {
        if (snapshots.length) await page.evaluate(tag => localStorage.setItem('oie-locale', tag === 'en-XA' ? 'en' : tag), tag);
        const suffix = tag === 'en-XA' ? '?locale=en-XA' : '';
        const snapshot: Record<string, any> = {};
        for (const kind of ['channels', 'alerts']) {
            await page.goto(`/${kind}/locale/edit${suffix}`);
            await expect(page.locator('html')).toHaveAttribute('lang', tag);
            const field = page.locator('.view-body input[type=text]').first();
            await field.fill('Unchanged User Data'); await field.blur();
            const request = page.waitForRequest(r => r.method() === 'PUT' && new URL(r.url()).pathname === `/api/${kind}/locale`);
            await (await button(page, kind === 'channels' ? 'Save Changes' : 'Save Alert')).click();
            snapshot[kind] = (await request).postData();
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        }
        await page.goto('/code-templates' + suffix);
        await page.getByText('Trim Whitespace', { exact: true }).click();
        await page.locator('textarea.ce-area').first().fill('// 用户脚本\nreturn "Dashboard";');
        const request = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/codeTemplateLibraries/_bulkUpdate');
        await (await button(page, 'Save Changes')).click(); await request;
        snapshot.templates = await page.evaluate(() => (window as any).i18nForm);
        snapshot.mappingTokens = await page.evaluate(async () => {
            const module = '/core/mappings.js', mappings = await import(module);
            return [mappings.DESTINATION_MAPPINGS, mappings.SCRIPT_REFERENCE].map(list => list.map((entry: string[]) => entry[1]));
        });
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        await page.goto('/users' + suffix);
        await page.locator('tr', {hasText: 'operator'}).first().click();
        await (await button(page, 'Edit User')).click();
        const modal = page.locator('.modal');
        const field = async (name: string) => modal.locator('.field', {has: page.getByText(await text(page, name), {exact:true})});
        await (await field('Organization')).locator('input').fill('用户组织 Dashboard');
        await (await field('Country')).locator('select').selectOption('United States');
        await (await field('Role')).locator('select').selectOption('Consultant - Engineer');
        const userRequest = page.waitForRequest(r => r.method() === 'PUT' && new URL(r.url()).pathname === '/api/users/2');
        await (await button(page, 'Save')).click();
        snapshot.user = (await userRequest).postData();
        await expect(modal).toHaveCount(0);
        await page.goto('/dashboard' + suffix);
        await page.locator('#rail-customize').click();
        await page.locator('.rail-nav .rail-pane-header').first().click();
        await page.locator('.rail-name-input').fill('用户导航 Dashboard');
        await page.locator('.rail-name-input').press('Enter');
        snapshot.navigation = await page.evaluate(() => {
            const key = Object.keys(localStorage).find(k => k.startsWith('webadmin-prefs'))!;
            return JSON.parse(localStorage.getItem(key)!).navLayout;
        });
        expect(snapshot.navigation.groups).toEqual([{id:'Monitor',label:'用户导航 Dashboard'}]);
        snapshots.push(snapshot);
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
    if (snapshots[2]) expect(snapshots[2]).toEqual(snapshots[0]);
});

test('an in-flight save blocks a locale change and the completed save permits retry', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await mockEngine(page, {
        'GET /channels/locale': { channel: makeChannel('locale') },
        'PUT /channels/locale': async () => { await held; return { boolean: true }; }
    });
    await page.goto('/channels/locale/edit');
    await page.locator('.view-body input[type=text]').first().fill('Saved before reload');
    await (await button(page, 'Save Changes')).click();
    await expect(page.locator('.content-row')).toHaveAttribute('inert');
    const preference = await page.evaluate(() => localStorage.getItem('oie-locale'));
    try {
        expect(await switchLanguage(page, 'zh-CN')).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem('oie-locale'))).toBe(preference);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally { release(); }
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await switchLanguage(page, 'zh-CN').catch(error => {
        // Reload can destroy the evaluation context after the approved switch.
        if (!/Execution context was destroyed/.test(String(error))) throw error;
    });
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});
