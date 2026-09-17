import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const alert = {
    '@version': '4.6.0', id: 'handoff', name: 'Original', enabled: true,
    trigger: { '@class': 'defaultTrigger', regex: '', errorEventTypes: { errorEventType: ['ANY'] },
        alertChannels: { newChannelSource: false, newChannelDestination: false, enabledChannels: null, disabledChannels: null, partialChannels: null } },
    actionGroups: { alertActionGroup: [{ actions: null, subject: '', template: '' }] }, properties: null
};

for (const kind of ['channels', 'alerts']) {
    for (const roundTrip of [false, true]) {
        test(`F10: ${kind} retains dirty protection after classic to wizard${roundTrip ? ' to classic' : ''}`, async ({ page }) => {
            await mockEngine(page, { 'GET /channels/handoff': { channel: makeChannel('handoff') },
                'GET /alerts/handoff': { alertModel: alert } });
            await page.goto(`/${kind}/handoff/edit`);
            const name = page.locator('.view-body input[type="text"]').first();
            await name.fill('Unsaved handoff');
            await name.blur();
            await page.getByRole('button', { name: 'Open in Wizard', exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`/${kind}/handoff/guided`));
            await expect(page.locator('.view-body input').first()).toHaveValue('Unsaved handoff');
            if (roundTrip) {
                await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
                await expect(page).toHaveURL(new RegExp(`/${kind}/handoff/edit`));
            }
            expect(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            })).toBe(true);
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(page.getByRole('dialog').last()).toContainText(/unsaved|save|Save/);
            await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(page).not.toHaveURL(/\/dashboard$/);
        });
    }
}
