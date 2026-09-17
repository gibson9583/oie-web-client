import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

for (const surface of ['edit', 'guided']) {
    for (const fail of [false, true]) {
        test(`F11: alert ${surface} locks the submitted form until ${fail ? 'failure' : 'success'}`, async ({ page }) => {
            let release!: () => void, writes = 0;
            const gate = new Promise<void>(resolve => { release = resolve; });
            await mockEngine(page, {
                'GET /alerts/locked': { alertModel: {
                    '@version': '4.6.0', id: 'locked', name: 'Original', enabled: true,
                    trigger: { '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] }, alertChannels: { newChannelSource: false, newChannelDestination: false } },
                    actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] }, properties: null,
                } },
            });
            await page.route('**/api/alerts/locked', async route => {
                if (route.request().method() !== 'PUT') return route.fallback();
                writes++;
                expect(route.request().postDataJSON().alertModel.name).toBe('Submitted');
                await gate;
                await route.fulfill({ status: fail ? 503 : 200, body: fail ? 'synthetic failure' : '' });
            });
            await page.goto(`/alerts/locked/${surface}`);
            const field = page.locator('.view-body input[type=text]').first();
            await field.fill('Submitted');
            await page.getByRole('button', { name: 'Save Alert', exact: true }).first().evaluate(button => {
                (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
            });
            await expect.poll(() => writes).toBe(1);
            await expect(page.locator('.content-row')).toHaveJSProperty('inert', true);
            await field.evaluate(input => (input as HTMLInputElement).focus());
            await page.keyboard.type('Unsent');
            await expect(field).toHaveValue('Submitted');
            release();
            if (fail) {
                await page.getByRole('dialog', { name: 'Error', exact: true }).getByRole('button', { name: 'Close', exact: true }).last().click();
                await expect(page.locator('.content-row')).toHaveJSProperty('inert', false);
                await expect(field).toHaveValue('Submitted');
                expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
            } else await expect(page).toHaveURL(/\/alerts$/);
            expect(writes).toBe(1);
        });
    }
}
