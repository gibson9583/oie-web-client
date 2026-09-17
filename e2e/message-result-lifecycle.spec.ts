import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const message = (id: number) => ({ messageId: String(id), channelId: 'c-started',
    connectorMessages: { entry: { int: 0, connectorMessage: { metaDataId: 0, connectorName: 'Source', status: 'RECEIVED' } } } });

for (const action of ['Remove Results', 'Reprocess Results']) {
    for (const boundary of ['count', 'operation']) {
        for (const expire of [false, true]) {
            test(`${action} ${boundary} continuation ${expire ? 'stops after expiry' : 'finishes normally'}`, async ({ page }, testInfo) => {
                let held = false, writes = 0, searches = 0;
                let release!: () => void;
                const gate = new Promise<void>(resolve => { release = resolve; });
                const events: string[] = [];
                const operation = async () => {
                    writes++; events.push('write-submitted');
                    if (boundary === 'operation') { held = true; await gate; events.push('write-released'); }
                    return '';
                };
                await mockEngine(page, {
                    'GET /channels/c-started/messages': () => {
                        searches++; return { list: { message: Array.from({ length: 21 }, (_, i) => message(100 + i)) } };
                    },
                    'GET /channels/c-started/messages/count': async () => {
                        events.push('count-submitted');
                        if (boundary === 'count') { held = true; await gate; events.push('count-released'); }
                        return { long: 21 };
                    },
                    'DELETE /channels/c-started/messages': operation,
                    'POST /channels/c-started/messages/_reprocess': operation,
                    'GET /session-expiry-probe': { __status: 401 },
                });
                const confirmAction = async () => {
                    if (action === 'Remove Results') {
                        const confirm = page.getByRole('dialog', { name: 'Remove Results', exact: true });
                        await confirm.locator('input').fill('REMOVE');
                        await confirm.getByRole('button', { name: 'OK', exact: true }).click();
                    } else {
                        await page.getByRole('dialog', { name: 'Reprocessing Options', exact: true }).getByRole('button', { name: 'OK', exact: true }).click();
                        const confirm = page.getByRole('dialog', { name: 'Reprocess Results', exact: true });
                        await confirm.locator('input').fill('REPROCESSALL');
                        await confirm.getByRole('button', { name: 'OK', exact: true }).click();
                    }
                };
                try {
                    await page.goto('/messages/c-started');
                    await expect(page.getByRole('cell', { name: '100', exact: true })).toBeVisible();
                    await page.getByRole('button', { name: action, exact: true }).click();
                    if (boundary === 'operation') await confirmAction();
                    await expect.poll(() => held).toBe(true);
                    if (expire) {
                        await page.evaluate(async () => {
                            const api = await import(String('/core/api.js'));
                            await api.get('/session-expiry-probe').catch(() => {});
                        });
                        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
                        events.push('login-visible');
                    }
                    release();
                    await expect.poll(() => events.some(event => event.endsWith('-released'))).toBe(true);
                    if (expire) {
                        await page.waitForTimeout(200);
                        expect(writes).toBe(boundary === 'operation' ? 1 : 0);
                        expect(searches).toBe(1);
                        await expect(page.getByRole('dialog')).toHaveCount(0);
                        await expect(page.locator('.toast-msg')).toHaveCount(0);
                    } else {
                        if (boundary === 'count') await confirmAction();
                        await expect.poll(() => writes).toBe(1);
                        await expect.poll(() => searches).toBe(2);
                        await expect(page.getByRole('dialog')).toHaveCount(0);
                    }
                } finally {
                    release();
                    await testInfo.attach('result-lifecycle-observations', {
                        body: JSON.stringify({ action, boundary, expire, writes, searches, events }, null, 2),
                        contentType: 'application/json',
                    });
                }
            });
        }
    }
}
