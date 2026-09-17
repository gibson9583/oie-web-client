import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import type { Page } from '@playwright/test';

const IMPORT_XML = '<list><message><messageId>11</messageId></message><message><messageId>22</messageId></message></list>';

async function chooseMessages(page: Page) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Messages', exact: true }).click();
    await (await choosing).setFiles({ name: 'messages.xml', mimeType: 'application/xml', buffer: Buffer.from(IMPORT_XML) });
}

for (const first of ['401', 'late-success', 'late-failure', 'cookie-change']) {
    test(`message import stops after ${first} ends its initiating session`, async ({ page }) => {
        let imports = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/c-started/messages/_import': async () => {
                imports++;
                if (imports === 1) {
                    await gate;
                    if (first === '401') return { __status: 401 };
                    if (first === 'late-failure') return { __status: 503 };
                }
                return '';
            },
        });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        await expect.poll(() => imports).toBe(1);
        if (first.startsWith('late-')) {
            await page.evaluate(async () => {
                const api = await import(String('/core/api.js'));
                await api.get('/session-expiry-probe').catch(() => {});
            });
        } else if (first === 'cookie-change') {
            await page.evaluate(() => { document.cookie = 'oie-login=replacement-session; path=/'; });
        }
        const response = page.waitForResponse('**/api/channels/c-started/messages/_import');
        release();
        await response;
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.waitForTimeout(150);
        expect(imports).toBe(1);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

for (const outcome of ['load', 'error']) {
    test(`message import ignores a file ${outcome} after forced session expiry`, async ({ page }) => {
        await page.addInitScript(outcome => {
            const read = FileReader.prototype.readAsText;
            FileReader.prototype.readAsText = function (...args) {
                (window as any).completeMessageRead = () => new Promise<void>(resolve => {
                    if (outcome === 'error') { this.dispatchEvent(new ProgressEvent('error')); resolve(); }
                    else {
                        this.addEventListener('loadend', () => resolve(), { once: true });
                        read.apply(this, args);
                    }
                });
            };
        }, outcome);
        let imports = 0;
        await mockEngine(page, {
            'GET /session-expiry-probe': { __status: 401 }, 'GET /users/current': (request: any) => request.headers()['x-oie-context']?.includes('replacement-session') ? { __status: 401 } : { user: { id: 1, username: 'admin' } },
            'POST /channels/c-started/messages/_import': () => { imports++; return ''; },
        });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        await expect.poll(() => page.evaluate(() => typeof (window as any).completeMessageRead)).toBe('function');
        await page.evaluate(async () => {
            const api = await import(String('/core/api.js'));
            await api.get('/session-expiry-probe').catch(() => {});
        });
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
        await page.evaluate(() => (window as any).completeMessageRead());
        await page.waitForTimeout(150);
        expect(imports).toBe(0);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

for (const partial of [false, true]) {
    test(`message import preserves ${partial ? 'partial failure counts' : 'successful XML requests'}`, async ({ page }) => {
        const bodies: string[] = [];
        await mockEngine(page, { 'POST /channels/c-started/messages/_import': (request: any) => {
            expect(request.headers()['content-type']).toContain('application/xml');
            bodies.push(request.postData());
            return partial && bodies.length === 1 ? { __status: 503, body: { message: 'message rejected' } } : '';
        } });
        await page.goto('/messages/c-started');
        await chooseMessages(page);
        if (partial) {
            await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText(/Imported 1 message\(s\); 1 failed:.*message rejected/);
        } else await expect(page.getByText('Imported 2 message(s)', { exact: true })).toBeVisible();
        expect(bodies).toEqual(['<message><messageId>11</messageId></message>', '<message><messageId>22</messageId></message>']);
    });
}
