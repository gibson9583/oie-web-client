import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

const alert = (name: string) => ({
    '@version': '4.6.0', id: 'conflict-alert', name, enabled: true,
    trigger: { '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] },
        alertChannels: { newChannelSource: false, newChannelDestination: false, enabledChannels: null, disabledChannels: null, partialChannels: null } },
    actionGroups: { alertActionGroup: [{ actions: null, subject: 'Original subject', template: '' }] }, properties: null
});

for (const surface of ['edit', 'guided']) {
    for (const failure of ['changed', 'unavailable']) {
        test(`F12: ${surface} preserves its initial alert baseline when current state is ${failure}`, async ({ page }) => {
            let reads = 0;
            let writes = 0;
            await mockEngine(page, {
                'GET /alerts/conflict-alert': () => ++reads === 1 ? { alertModel: alert('Original') }
                    : failure === 'changed' ? { alertModel: alert('Changed elsewhere') }
                    : { __status: 503, body: { message: 'current alert unavailable' } },
                'PUT /alerts/conflict-alert': () => { writes++; return ''; }
            });
            await page.goto(`/alerts/conflict-alert/${surface}`);
            const name = page.locator('.view-body input[type="text"]').first();
            await expect(name).toHaveValue('Original');
            expect(reads).toBe(1);
            await name.fill('Local edit');
            await page.getByRole('button', { name: 'Save Alert', exact: true }).first().click();
            if (failure === 'changed') {
                const prompt = page.getByRole('dialog', { name: 'Alert Modified' });
                await expect(prompt).toBeVisible();
                expect(writes).toBe(0);
                await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
                await expect(name).toHaveValue('Local edit');
            } else {
                await expect(page.getByRole('dialog', { name: 'Error', exact: true })).toContainText('current alert unavailable');
            }
            expect(writes).toBe(0);
        });
    }
}
