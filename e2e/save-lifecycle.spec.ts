import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { DEFAULT_FIXTURES } from './fixtures.js';
import { makeChannel } from './connector-fixtures.js';

const cases = [
    { name: 'settings', route: '/settings', path: '/server/settings', method: 'PUT', button: 'Save' },
    { name: 'scripts', route: '/global-scripts', path: '/server/globalScripts', method: 'PUT', button: 'Save Scripts' },
    { name: 'channel', route: '/channels/save-lock/edit', path: '/channels/save-lock', method: 'PUT', button: 'Save Changes' },
    { name: 'templates', route: '/code-templates', path: '/codeTemplateLibraries/_bulkUpdate', method: 'POST', button: 'Save Changes' },
];
for (const surface of cases) {
    for (const fail of [false, true]) {
        test(`F11: ${surface.name} serializes edits and saves until ${fail ? 'failure' : 'success'}`, async ({ page }) => {
            // WebKit's interception payload omits Blob part contents. Observe
            // the original FormData at fetch without altering the request.
            if (surface.name === 'templates') await page.addInitScript(() => {
                const send = window.fetch;
                window.fetch = async (...args: Parameters<typeof fetch>) => {
                    if (args[1]?.body instanceof FormData) {
                        const body = args[1].body;
                        (window as any).submittedForm = await Promise.all(Array.from(body.entries())
                            .map(async ([key, value]) => [key, typeof value === 'string' ? value : await value.text()]));
                    }
                    return send(...args);
                };
            });
            await page.route('**/vendor/monaco/**', route => route.abort());
            let writes = 0, saved = false;
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const libraries = structuredClone(DEFAULT_FIXTURES['GET /codeTemplateLibraries']);
            await mockEngine(page, {
                'GET /channels/save-lock': { channel: makeChannel('save-lock') },
                'GET /server/settings': { serverSettings: { serverName: 'Original' } },
                'GET /codeTemplateLibraries': () => {
                    if (saved) libraries.list.codeTemplateLibrary[0].name = 'Submitted edit';
                    return libraries;
                },
            });
            await page.route(`**/api${surface.path}*`, async route => {
                if (route.request().method() !== surface.method) return route.fallback();
                writes++;
                const submitted = surface.name === 'templates'
                    ? await page.evaluate(() => JSON.stringify((window as any).submittedForm))
                    : route.request().postData();
                expect(submitted).toContain('Submitted edit');
                await gate;
                saved = !fail;
                await route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'synthetic save failure' }
                    : surface.name === 'templates' ? { codeTemplateLibrarySaveResult: { overrideNeeded: false, librariesSuccess: true, codeTemplateResults: {} } }
                        : true });
            });
            await page.goto(surface.route);
            if (surface.name === 'templates') await page.getByText('Demo Library', { exact: true }).click();
            const field = surface.name === 'scripts' ? page.locator('textarea.ce-area').first()
                : surface.name === 'settings' ? page.locator('.field', { has: page.getByText('Server name', { exact: true }) }).locator('input')
                    : surface.name === 'templates' ? page.locator('.field', { has: page.getByText('Name', { exact: true }) }).locator('input')
                        : page.locator('.view-body input[type=text]').first();
            await field.fill('Submitted edit');
            await field.blur();
            const button = page.getByRole('button', { name: surface.button, exact: true });
            await button.click();
            await expect.poll(() => writes).toBe(1);
            await expect(page.getByRole('status')).toContainText('Saving changes');
            expect(await field.evaluate(input => !!input.closest('[inert]'))).toBe(true);
            await field.evaluate(input => (input as HTMLElement).focus());
            await page.keyboard.type('UNSENT');
            await expect(field).toHaveValue('Submitted edit');
            // Even a programmatic repeat cannot bypass the transaction latch.
            await page.getByRole('button', { name: surface.button, exact: true, includeHidden: true })
                .evaluate(button => (button as HTMLButtonElement).click());
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(page).toHaveURL(new RegExp(surface.route + '$'));
            expect(writes).toBe(1);
            release();
            if (fail) {
                const error = page.getByRole('dialog', { name: 'Error', exact: true });
                await expect(error).toBeVisible();
                await error.getByRole('button', { name: 'Close', exact: true }).last().click();
            }
            await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
            await expect(field).toHaveValue('Submitted edit');
            expect(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event); return event.defaultPrevented;
            })).toBe(fail);
            await field.fill('Next edit');
            expect(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event); return event.defaultPrevented;
            })).toBe(true);
        });
    }
}
