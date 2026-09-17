import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const SCRIPT_KEYS = ['Deploy', 'Undeploy', 'Preprocessor', 'Postprocessor'];
const xmlScripts = (values: Record<string, string>) => '<map>' + Object.entries(values).map(([key, value]) =>
    `<entry><string>${key}</string><string>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</string></entry>`).join('') + '</map>';
const DEFAULT_SCRIPTS_XML = xmlScripts(Object.fromEntries(DEFAULT_FIXTURES['GET /server/globalScripts'].map.entry.map(entry => entry.string)));

async function chooseScripts(page: Page, xml: string) {
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Scripts', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: 'scripts.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
}

async function closeError(page: Page) {
    await page.getByRole('dialog', { name: 'Error', exact: true })
        .getByRole('button', { name: 'Close', exact: true }).last().click();
}

const preventsClose = (page: Page) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});

test.beforeEach(async ({ page }) => {
    await mockEngine(page);
});

for (const key of SCRIPT_KEYS) {
    test(`Global Scripts rejects an invalid ${key} body before save and preserves it for correction`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        const validated: string[] = [];
        let writes = 0;
        await mockEngine(page, {
            'POST /javascript/_validate': (request: any) => {
                const body = request.postData();
                validated.push(body);
                return { error: body === 'function {' ? 'Error on line 1: invalid syntax.' : null };
            },
            'PUT /server/globalScripts': () => { writes++; return ''; },
        });
        await page.goto('/global-scripts');
        const index = SCRIPT_KEYS.indexOf(key);
        await page.getByRole('tab', { name: key, exact: true }).click();
        const editor = page.locator('textarea.ce-area').nth(index);
        await editor.fill('function {');
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText(key);
        expect(writes).toBe(0);
        expect(validated).toHaveLength(4);
        await closeError(page);
        await expect(editor).toHaveValue('function {');
        expect(await preventsClose(page)).toBe(true);
        await editor.fill('return <message/>;');
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect.poll(() => writes).toBe(1);
        expect(validated).toHaveLength(8);
        expect(validated.slice(4)).toContain('return <message/>;');
        await expect.poll(() => preventsClose(page)).toBe(false);
    });
}

for (const action of ['leave', 'export']) {
    test(`Global Scripts ${action} validates every staged script before saving`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        let writes = 0;
        let reads = 0;
        await page.addInitScript(() => {
            (window as any).scriptExportPickers = 0;
            (window as any).showSaveFilePicker = async () => {
                (window as any).scriptExportPickers++;
                throw new DOMException('Cancelled', 'AbortError');
            };
        });
        await mockEngine(page, {
            'GET /server/globalScripts': () => { reads++; return DEFAULT_SCRIPTS_XML; },
            'POST /javascript/_validate': { error: 'Error on line 1: invalid syntax.' },
            'PUT /server/globalScripts': () => { writes++; return ''; },
        });
        await page.goto('/global-scripts');
        await page.locator('textarea.ce-area').first().fill('function {');
        if (action === 'leave') {
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
                .getByRole('button', { name: 'Save Changes', exact: true }).click();
        } else {
            await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
            await page.getByRole('dialog', { name: 'Export Scripts', exact: true })
                .getByRole('button', { name: 'Save and Export', exact: true }).click();
        }
        const error = page.getByRole('dialog', { name: 'Error', exact: true });
        for (const key of SCRIPT_KEYS) await expect(error).toContainText(key);
        await closeError(page);
        expect(writes).toBe(0);
        expect(reads).toBe(1);
        expect(await page.evaluate(() => (window as any).scriptExportPickers)).toBe(0);
        await expect(page).toHaveURL(/\/global-scripts$/);
        await expect(page.locator('textarea.ce-area').first()).toHaveValue('function {');
        expect(await preventsClose(page)).toBe(true);
    });
}

for (const endpoint of ['', '/extensions/websupport']) {
    test(`Global Scripts validates all bodies through ${endpoint || 'native'} Rhino without requiring the manual validation task`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        await page.route('**/webadmin/plugins.json', async route => {
            const response = await route.fetch();
            const plugins = await response.json();
            plugins.push({ id: 'script-rbac', version: '1.0.0', entry: '/plugins/script-rbac/entry.js' });
            await route.fulfill({ json: plugins });
        });
        await page.route('**/plugins/script-rbac/entry.js*', route => route.fulfill({
            contentType: 'application/javascript',
            body: "export function register(p){ p.setAuthorizationController({checkTask:(g,t)=>t!=='doValidateCurrentGlobalScript'}); }",
        }));
        const bodies = ['return <message/>;', '', '123', 'null'];
        const validated: string[] = [];
        let submitted: any;
        await mockEngine(page, {
            'GET /webplugins': endpoint ? { __status: 404 } : [],
            'GET /extensions/websupport/webplugins': [],
            [`POST ${endpoint}/javascript/_validate`]: (request: any) => {
                validated.push(request.postData() ?? ''); return { error: null };
            },
            'PUT /server/globalScripts': (request: any) => { submitted = request.postDataJSON(); return ''; },
        });
        await page.goto('/global-scripts');
        await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
        await expect(page.getByRole('button', { name: 'Validate Script', exact: true })).toHaveCount(0);
        await chooseScripts(page, xmlScripts(Object.fromEntries(SCRIPT_KEYS.map((key, index) => [key, bodies[index]]))));
        await page.getByRole('dialog', { name: 'Import Scripts', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect.poll(() => submitted).toEqual({ map: { entry: SCRIPT_KEYS.map((key, index) => ({ string: [key, bodies[index]] })) } });
        expect([...validated].sort()).toEqual([...bodies].sort());
    });
}

for (const failure of [
    { name: 'temporary failure', response: { __status: 503, body: 'Validator unavailable' } },
    { name: 'denied validation', response: { __status: 403, body: 'Validator denied' } },
    { name: 'missing result', response: {} },
    { name: 'malformed result', response: { error: false } },
]) {
    test(`Global Scripts blocks ${failure.name} and retries validation before saving`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        let fail = true;
        let validations = 0;
        let writes = 0;
        await mockEngine(page, {
            'POST /javascript/_validate': (request: any) => {
                validations++;
                return fail && request.postData().includes('retain this draft') ? failure.response : { error: null };
            },
            'PUT /server/globalScripts': () => { writes++; return ''; },
        });
        await page.goto('/global-scripts');
        const editor = page.locator('textarea.ce-area').first();
        await editor.fill('// retain this draft\nreturn;');
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('Validation unavailable');
        expect(validations).toBe(4);
        expect(writes).toBe(0);
        await closeError(page);
        await expect(editor).toHaveValue('// retain this draft\nreturn;');
        expect(await preventsClose(page)).toBe(true);
        fail = false;
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect.poll(() => writes).toBe(1);
        expect(validations).toBe(8);
        await expect.poll(() => preventsClose(page)).toBe(false);
    });
}

test('Global Scripts requires a validator when neither engine endpoint is installed', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let writes = 0;
    await mockEngine(page, {
        'GET /webplugins': { __status: 404 },
        'GET /extensions/websupport/webplugins': { __status: 404 },
        'PUT /server/globalScripts': () => { writes++; return ''; },
    });
    await page.goto('/global-scripts');
    const warning = page.getByRole('dialog', { name: 'Warning', exact: true });
    await expect(warning).toContainText('Web Support plugin is not installed');
    await warning.getByRole('button', { name: 'Close', exact: true }).last().click();
    const editor = page.locator('textarea.ce-area').first();
    await expect(editor).toHaveValue('return;');
    await editor.fill('return <message/>;');
    await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
    const error = page.getByRole('dialog', { name: 'Error', exact: true });
    await expect(error).toContainText('Web Support plugin is not installed');
    for (const key of SCRIPT_KEYS) await expect(error).toContainText(key);
    await closeError(page);
    expect(writes).toBe(0);
    await expect(editor).toHaveValue('return <message/>;');
    expect(await preventsClose(page)).toBe(true);
});

test('Global Scripts locks the submitted draft during validation and ignores completion after logout', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let validations = 0;
    let writes = 0;
    let expired = false;
    await mockEngine(page, {
        'GET /users/current': () => expired ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
        'PUT /server/globalScripts': () => { writes++; return ''; },
    });
    await page.route('**/api/javascript/_validate', async route => {
        validations++;
        await gate;
        await route.fulfill({ json: { error: null } });
    });
    try {
        await page.goto('/global-scripts');
        const editor = page.locator('textarea.ce-area').first();
        await editor.fill('// submitted\nreturn;');
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect.poll(() => validations).toBeGreaterThan(0);
        await expect(page.locator('.content-row')).toHaveAttribute('inert');
        await editor.evaluate(input => (input as HTMLElement).focus());
        await page.keyboard.type('UNSENT');
        await expect(editor).toHaveValue('// submitted\nreturn;');
        await page.getByRole('button', { name: 'Save Scripts', exact: true, includeHidden: true })
            .evaluate(button => (button as HTMLButtonElement).click());
        expired = true;
        await page.evaluate(async () => {
            const api = await import(String('/core/api.js'));
            await api.get('/users/current').catch(() => {});
        });
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        const pending = validations;
        release();
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
        expect(validations).toBe(pending);
        expect(writes).toBe(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page).toHaveURL(/\/$/);
    } finally { release(); }
});

test('F04: failed or malformed loads keep editors unavailable until a successful retry', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let reads = 0;
    let writes = 0;
    await mockEngine(page, {
        'GET /server/globalScripts': () => ++reads === 1
            ? { __status: 503, body: { message: 'scripts unavailable' } }
            : reads === 2 ? { unexpected: 'invalid map' } : DEFAULT_FIXTURES['GET /server/globalScripts'],
        'PUT /server/globalScripts': () => { writes++; return ''; },
    });
    await page.goto('/global-scripts');
    await closeError(page);
    await expect(page.locator('textarea.ce-area')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Scripts' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await closeError(page);
    await expect(page.locator('textarea.ce-area')).toHaveCount(0);
    expect(writes).toBe(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
    await page.locator('textarea.ce-area').first().fill('// loaded and edited\nreturn;');
    await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
});

test('F04: a delayed load cannot replace user input before editors are ready', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/server/globalScripts', async route => {
        await gate;
        await route.fulfill({ contentType: 'application/xml', body: DEFAULT_SCRIPTS_XML });
    });
    await page.goto('/global-scripts');
    await expect(page.getByRole('status')).toContainText('Loading global scripts');
    await expect(page.locator('textarea.ce-area')).toHaveCount(0);
    release();
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
});

for (const values of [
    ['123', 'false', 'true', 'null'],
    ['001', '1e3', '-0', ''],
    [' 123\n', 'if (a < 2 && b > 1) return "<&>";', '// <![CDATA[not markup]]>\nreturn;', '\treturn;\n'],
]) {
    test(`Global Scripts preserves XML string bodies: ${JSON.stringify(values)}`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        const scripts = Object.fromEntries(SCRIPT_KEYS.map((key, i) => [key, values[i]]));
        let submitted: any;
        await mockEngine(page, {
            'GET /server/globalScripts': (request: any) => {
                expect(request.headers().accept).toBe('application/xml');
                return xmlScripts(scripts);
            },
            'PUT /server/globalScripts': (request: any) => { submitted = request.postDataJSON(); return ''; },
        });
        await page.goto('/global-scripts');
        for (let index = 0; index < SCRIPT_KEYS.length; index++) {
            await page.getByRole('tab', { name: SCRIPT_KEYS[index], exact: true }).click();
            await expect(page.locator('textarea.ce-area').nth(index)).toHaveValue(values[index]);
        }
        // Mark the draft dirty without changing its final contents, then check
        // all four strings survive the ordinary save payload unchanged.
        const editor = page.locator('textarea.ce-area').last();
        await editor.fill('temporary edit');
        await editor.fill(values[3]);
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        await expect.poll(() => submitted).toEqual({ map: { entry: SCRIPT_KEYS.map(key => ({ string: [key, scripts[key]] })) } });
    });
}

test('Global Scripts accepts CDATA and rejects incomplete, duplicate and nested XML loads', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    const malformed = [
        '<map><entry>',
        xmlScripts({ Deploy: 'return;' }),
        DEFAULT_SCRIPTS_XML.replace('</map>', '<entry><string>Deploy</string><string>duplicate</string></entry></map>'),
        DEFAULT_SCRIPTS_XML.replace('<string>return;</string>', '<string><script>return;</script></string>'),
        DEFAULT_SCRIPTS_XML.replace('<map>', '<map><![CDATA[unexpected text]]>'),
        DEFAULT_SCRIPTS_XML.replace('<string>return;</string>', '<string reference="../string"/>'),
    ];
    let reads = 0;
    await mockEngine(page, {
        'GET /server/globalScripts': () => malformed[reads++] ?? DEFAULT_SCRIPTS_XML.replace('<string>return;</string>', '<string><![CDATA[if (a < b) return "&";]]></string>'),
    });
    await page.goto('/global-scripts');
    for (const _ of malformed) {
        await closeError(page);
        await expect(page.locator('textarea.ce-area')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Save Scripts', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Import Scripts', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('if (a < b) return "&";');
});

test('Global Scripts import stages Swing drafts and preserves later edits until an explicit save', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    let reads = 0;
    let submitted: any;
    await mockEngine(page, {
        'GET /server/globalScripts': () => { reads++; return DEFAULT_SCRIPTS_XML; },
        'PUT /server/globalScripts': (request: any) => { submitted = request.postDataJSON(); return ''; },
    });
    await page.goto('/global-scripts');
    const deploy = page.locator('textarea.ce-area').first();
    await expect(deploy).toHaveValue('return;');
    await page.getByRole('tab', { name: 'Preprocessor', exact: true }).click();
    await page.locator('textarea.ce-area').nth(2).fill('// keep this unsupplied draft\nreturn message;');
    await chooseScripts(page, xmlScripts({ Deploy: '', Shutdown: '// com.webreach.mirth\nreturn;' }));
    const confirm = page.getByRole('dialog', { name: 'Import Scripts', exact: true });
    await expect(confirm).toContainText('Save Scripts applies the changes to the server');
    await confirm.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await page.getByRole('tab', { name: 'Deploy', exact: true }).click();
    await expect(deploy).toHaveValue('');
    await page.getByRole('tab', { name: 'Undeploy', exact: true }).click();
    await expect(page.locator('textarea.ce-area').nth(1)).toHaveValue('// com.mirth.connect\nreturn;');
    await page.getByRole('tab', { name: 'Preprocessor', exact: true }).click();
    await expect(page.locator('textarea.ce-area').nth(2)).toHaveValue('// keep this unsupplied draft\nreturn message;');
    expect(submitted).toBeUndefined();
    expect(reads).toBe(1);
    expect(await preventsClose(page)).toBe(true);
    await page.getByRole('tab', { name: 'Deploy', exact: true }).click();
    await deploy.fill('// later edit\nreturn;');
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('dialog', { name: 'Unsaved Changes', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(deploy).toHaveValue('// later edit\nreturn;');
    expect(submitted).toBeUndefined();
    await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
    await expect.poll(() => submitted).toEqual({ map: { entry: [
        { string: ['Deploy', '// later edit\nreturn;'] },
        { string: ['Undeploy', '// com.mirth.connect\nreturn;'] },
        { string: ['Preprocessor', '// keep this unsupplied draft\nreturn message;'] },
        { string: ['Postprocessor', 'return;'] },
    ] } });
    expect(reads).toBe(1);
    expect(await preventsClose(page)).toBe(false);
});

test('Global Scripts cancelled and invalid imports retain the current draft', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.goto('/global-scripts');
    const editor = page.locator('textarea.ce-area').first();
    await expect(editor).toHaveValue('return;');
    await editor.fill('// keep draft\nreturn;');
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Scripts', exact: true }).click();
    await (await chooserPromise).element().dispatchEvent('cancel');
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await chooseScripts(page, xmlScripts({ Deploy: '123' }));
    await page.getByRole('dialog', { name: 'Import Scripts', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(editor).toHaveValue('// keep draft\nreturn;');
    for (const xml of ['<map><entry>', xmlScripts({ Unknown: 'return;' }), '<map><entry><string>Deploy</string><null/></entry></map>']) {
        await chooseScripts(page, xml);
        await closeError(page);
        await expect(editor).toHaveValue('// keep draft\nreturn;');
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    }
    expect(await preventsClose(page)).toBe(true);
});

test('Global Scripts import locks edits, repeated actions and navigation while the file is read', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.addInitScript(() => {
        const readAsText = FileReader.prototype.readAsText;
        FileReader.prototype.readAsText = function (...args) {
            (window as any).finishScriptRead = () => readAsText.apply(this, args);
        };
    });
    await page.goto('/global-scripts');
    const editor = page.locator('textarea.ce-area').first();
    await expect(editor).toHaveValue('return;');
    await editor.fill('// original draft\nreturn;');
    let choosers = 0;
    page.on('filechooser', () => choosers++);
    await chooseScripts(page, xmlScripts({ Deploy: '123' }));
    await expect(page.locator('.content-row')).toHaveAttribute('inert');
    await editor.evaluate(input => (input as HTMLElement).focus());
    await page.keyboard.type('UNSENT');
    await expect(editor).toHaveValue('// original draft\nreturn;');
    await page.getByRole('button', { name: 'Import Scripts', exact: true, includeHidden: true })
        .evaluate(button => (button as HTMLButtonElement).click());
    await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    await expect(page).toHaveURL(/\/global-scripts$/);
    expect(choosers).toBe(1);
    await page.evaluate(() => (window as any).finishScriptRead());
    await page.getByRole('dialog', { name: 'Import Scripts', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
    await expect(editor).toHaveValue('123');
    await editor.fill('// later edit\nreturn;');
    await expect(editor).toHaveValue('// later edit\nreturn;');
    expect(await preventsClose(page)).toBe(true);
});

for (const event of ['error', 'abort', 'throw']) {
    test(`Global Scripts file read ${event} releases the import lock without changing drafts`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        await page.addInitScript(event => {
            FileReader.prototype.readAsText = function () {
                if (event === 'throw') throw new Error('Synthetic read failure');
                this.dispatchEvent(new ProgressEvent(event));
            };
        }, event);
        await page.goto('/global-scripts');
        const editor = page.locator('textarea.ce-area').first();
        await expect(editor).toHaveValue('return;');
        await editor.fill('// preserve draft\nreturn;');
        await chooseScripts(page, xmlScripts({ Deploy: '123' }));
        if (event !== 'abort') await closeError(page);
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        await expect(editor).toHaveValue('// preserve draft\nreturn;');
        expect(await preventsClose(page)).toBe(true);
    });
}

for (const fail of [false, true]) {
    test(`Global Scripts exports staged imports only after saving ${fail ? 'fails then retries' : 'succeeds'}`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        await page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
        let reads = 0;
        let writes = 0;
        let downloads = 0;
        let stored = DEFAULT_SCRIPTS_XML;
        page.on('download', () => downloads++);
        await mockEngine(page, {
            'GET /server/globalScripts': () => { reads++; return stored; },
            'PUT /server/globalScripts': (request: any) => {
                writes++;
                if (fail && writes === 1) return { __status: 503, body: { error: 'save unavailable' } };
                stored = xmlScripts(Object.fromEntries(request.postDataJSON().map.entry.map((entry: any) => entry.string)));
                return '';
            },
        });
        await page.goto('/global-scripts');
        await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
        await chooseScripts(page, xmlScripts({ Deploy: '123' }));
        await page.getByRole('dialog', { name: 'Import Scripts', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
        await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
        await page.getByRole('dialog', { name: 'Export Scripts', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        expect(writes).toBe(0);
        expect(reads).toBe(1);
        expect(downloads).toBe(0);
        expect(await preventsClose(page)).toBe(true);
        if (fail) {
            await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
            await page.getByRole('dialog', { name: 'Export Scripts', exact: true }).getByRole('button', { name: 'Save and Export', exact: true }).click();
            await closeError(page);
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            expect(writes).toBe(1);
            expect(reads).toBe(1);
            expect(downloads).toBe(0);
            expect(await preventsClose(page)).toBe(true);
        }
        await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('dialog', { name: 'Export Scripts', exact: true }).getByRole('button', { name: 'Save and Export', exact: true }).click();
        const download = await downloadPromise;
        expect(await readFile((await download.path())!, 'utf8')).toBe(stored);
        expect(stored).toContain('<string>123</string>');
        expect(writes).toBe(fail ? 2 : 1);
        expect(reads).toBe(2);
        expect(downloads).toBe(1);
        expect(await preventsClose(page)).toBe(false);
    });
}

test('Global Scripts cannot save a staged import through Export when the role cannot save', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.route('**/webadmin/plugins.json', async route => {
        const response = await route.fetch();
        const plugins = await response.json();
        plugins.push({ id: 'script-rbac', version: '1.0.0', entry: '/plugins/script-rbac/entry.js' });
        await route.fulfill({ json: plugins });
    });
    await page.route('**/plugins/script-rbac/entry.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: "export function register(p){ p.setAuthorizationController({checkTask:(g,t)=>t!=='doSaveGlobalScripts'}); }",
    }));
    let reads = 0;
    await mockEngine(page, { 'GET /server/globalScripts': () => { reads++; return DEFAULT_SCRIPTS_XML; } });
    await page.goto('/global-scripts');
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
    await chooseScripts(page, xmlScripts({ Deploy: '123' }));
    await page.getByRole('dialog', { name: 'Import Scripts', exact: true }).getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save Scripts', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText("don't have permission to save");
    await closeError(page);
    expect(reads).toBe(1);
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('123');
    expect(await preventsClose(page)).toBe(true);
});

for (const outcome of ['load', 'error']) {
    test(`Global Scripts ignores a local file ${outcome} after forced session expiry`, async ({ page }) => {
        await page.route('**/vendor/monaco/**', route => route.abort());
        await page.addInitScript(outcome => {
            const read = FileReader.prototype.readAsText;
            FileReader.prototype.readAsText = function (...args) {
                (window as any).completeScriptRead = () => new Promise<void>(resolve => {
                    if (outcome === 'error') { this.dispatchEvent(new ProgressEvent('error')); resolve(); }
                    else {
                        this.addEventListener('loadend', () => resolve(), { once: true });
                        read.apply(this, args);
                    }
                });
            };
        }, outcome);
        let expired = false;
        await mockEngine(page, { 'GET /users/current': () => expired ? { __status: 401 } : { user: { id: 1, username: 'admin' } } });
        await page.goto('/global-scripts');
        await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
        await chooseScripts(page, xmlScripts({ Deploy: '123' }));
        await expect(page.locator('.content-row')).toHaveAttribute('inert');
        expired = true;
        await page.evaluate(async () => {
            const api = await import(String('/core/api.js'));
            await api.get('/users/current').catch(() => {});
        });
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.evaluate(() => (window as any).completeScriptRead());
        await expect(page.getByRole('dialog', { name: 'Import Scripts', exact: true })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
        await expect(page.locator('.shell')).toHaveCount(0);
    });
}

test('Global Scripts ignores an export file picker completed after forced session expiry', async ({ page }) => {
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.addInitScript(() => {
        (window as any).exportWrites = 0;
        (window as any).showSaveFilePicker = () => new Promise(resolve => {
            (window as any).completeExportPicker = () => resolve({
                createWritable: async () => ({ write: async () => { (window as any).exportWrites++; }, close: async () => {} }),
            });
        });
    });
    let expired = false;
    let reads = 0;
    await mockEngine(page, {
        'GET /users/current': () => expired ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
        'GET /server/globalScripts': () => { reads++; return DEFAULT_SCRIPTS_XML; },
    });
    await page.goto('/global-scripts');
    await expect(page.locator('textarea.ce-area').first()).toHaveValue('return;');
    await page.getByRole('button', { name: 'Export Scripts', exact: true }).click();
    await expect(page.locator('.content-row')).toHaveAttribute('inert');
    expired = true;
    await page.evaluate(async () => {
        const api = await import(String('/core/api.js'));
        await api.get('/users/current').catch(() => {});
    });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).completeExportPicker());
    await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toHaveCount(0);
    expect(reads).toBe(1);
    expect(await page.evaluate(() => (window as any).exportWrites)).toBe(0);
    await expect(page.locator('.shell')).toHaveCount(0);
});

// Global Scripts exercises the React <CodeEditor> island + keep-mounted <Tabs>.
test('Global Scripts shows the four script tabs, editor, and task pane', async ({ page }) => {
    await page.goto('/global-scripts');
    await expect(page).toHaveURL(/\/global-scripts/);

    // One tab per script (the shared <Tabs> component, so role=tab).
    for (const t of ['Deploy', 'Undeploy', 'Preprocessor', 'Postprocessor']) {
        await expect(page.getByRole('tab', { name: t, exact: true })).toBeVisible();
    }

    // The CodeEditor island mounts AND fills the view — a broken flex/height
    // chain collapses it to ~0, which toBeVisible() alone would not catch.
    await expect(page.locator('.ce').first()).toBeVisible();
    const box = await page.locator('.ce').first().boundingBox();
    expect(box!.height).toBeGreaterThan(200);

    // Portaled task pane: Validate/Import/Export always present; Save is gated on
    // an edit, so it's absent initially.
    await expect(page.getByRole('button', { name: 'Validate Script' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import Scripts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Scripts' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Scripts' })).toHaveCount(0);
});
