import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

for (const action of ['revert', 'save', 'pending-save', 'remount-save', 'remount-pending-save'] as const) {
    test(`palette follows a classic dependency ${action} after a wizard handoff`, async ({ page }) => {
        const channel = { ...makeChannel('association'), name: 'Association Channel' };
        const saving = action !== 'revert';
        const remount = action === 'remount-save' || action === 'remount-pending-save';
        const pending = action === 'pending-save' || action === 'remount-pending-save';
        const held = remount || pending;
        let enabled = false, writes = 0;
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        if (!held) release();
        await mockEngine(page, {
            'GET /channels/association': { channel },
            'GET /codeTemplateLibraries': () => ({ list: { codeTemplateLibrary: [{
                '@version': '4.6.0', id: 'shared', name: 'Shared Library', revision: 1,
                includeNewChannels: false, enabledChannelIds: enabled ? { string: channel.id } : '',
                disabledChannelIds: '', codeTemplates: null,
            }] } }),
            'POST /codeTemplateLibraries/_bulkUpdate': async () => {
                writes++;
                await gate;
                enabled = true;
                return { result: { overrideNeeded: false, librariesSuccess: true } };
            },
        });
        try {
            await page.goto('/channels/association/guided');
            await page.locator('.wiz-step', { hasText: 'Dependencies' }).click();
            await expect(page.getByRole('checkbox').first()).not.toBeChecked();
            if (action === 'revert') await page.getByRole('checkbox').first().check();
            await page.getByRole('button', { name: 'Classic editor', exact: true }).click();
            await page.getByRole('button', { name: 'Set Dependencies', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Channel Dependencies', exact: true });
            await expect(dialog.getByRole('checkbox').first()).toBeChecked({ checked: action === 'revert' });
            await dialog.getByRole('checkbox').first().setChecked(saving);
            await dialog.getByRole('button', { name: 'OK', exact: true }).click();
            if (saving) {
                await page.getByRole('dialog', { name: 'Save Code Template Libraries', exact: true })
                    .getByRole('button', { name: 'OK', exact: true }).click();
            }
            if (held) await expect.poll(() => writes).toBe(1);
            else await expect(dialog).toHaveCount(0);

            // Open immediately: changing a channel field or switching views would
            // incidentally republish the dependency state and conceal a stale map.
            await page.keyboard.press('Control+k');
            await expect(page.locator('.cmdk')).toBeVisible();
            const query = page.locator('.cmdk-field input');
            if (remount) {
                const previousEditor = await page.locator('.view-body').first().elementHandle();
                await query.fill('#Association Channel');
                await page.locator('.cmdk-opt').filter({ has: page.locator('.cmdk-hint', { hasText: /^edit$/ }) }).click();
                await expect.poll(() => previousEditor!.evaluate(element => element.isConnected)).toBe(false);
                await expect(page.locator('.view-body input[type="text"]').first()).toHaveValue('Association Channel');
                if (!pending) {
                    release();
                    await expect(dialog).toHaveCount(0);
                }
                await page.keyboard.press('Control+k');
                await expect(page.locator('.cmdk')).toBeVisible();
            }
            await query.fill('Shared Library');
            // Global search proves the library response has rendered before the
            // empty-query assertion, including when no library should be suggested.
            await expect(page.locator('.cmdk-opt .cmdk-label')).toHaveText(['Shared Library']);
            await query.fill('');
            const suggestions = page.locator('.cmdk-opt[data-group="Suggested"] .cmdk-label');
            if (pending) {
                await expect(suggestions).toHaveText(['Association Channel']);
                release();
                await expect(dialog).toHaveCount(0);
            }
            expect(writes).toBe(saving ? 1 : 0);
            expect(enabled).toBe(saving);
            await expect(suggestions).toHaveText(['Association Channel', ...(saving ? ['Shared Library'] : [])]);
        } finally {
            release();
        }
    });
}
