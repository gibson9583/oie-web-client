import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

for (const kind of ['channel', 'alert'] as const) {
    for (const multiple of [false, true]) {
        test(`${kind} deletion names exactly the confirmed targets (${multiple ? 'multiple' : 'single'})`, async ({ page }) => {
            const names = kind === 'channel' ? ['Demo Started', 'Demo Stopped'] : ['Error Alert', 'Deploy Alert'];
            const ids = kind === 'channel' ? ['c-started', 'c-stopped'] : ['al-1', 'al-2'];
            const removed: string[] = [];
            await mockEngine(page, {
                [`DELETE /${kind}s/*`]: (request: any) => {
                    removed.push(new URL(request.url()).pathname.split('/').pop()!);
                    return '';
                }
            });
            await page.goto(`/${kind}s`);
            await page.getByText(names[0], { exact: true }).click();
            if (multiple) await page.getByText(names[1], { exact: true }).click({ modifiers: ['ControlOrMeta'] });
            const open = () => page.getByRole('button', { name: `Delete ${kind === 'channel' ? 'Channel' : 'Alert'}`, exact: true }).click();
            await open();
            const dialog = page.getByRole('dialog', { name: `Delete ${kind}s`, exact: true });
            await expect(dialog).toContainText(`"${names[0]}"`);
            if (multiple) await expect(dialog).toContainText(`"${names[1]}"`);
            else await expect(dialog).not.toContainText(names[1]);
            await expect(dialog).toContainText('This cannot be undone.');
            expect(removed).toEqual([]);
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(dialog).toHaveCount(0);
            expect(removed).toEqual([]);
            await open();
            await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
            await expect.poll(() => removed).toEqual(multiple ? ids : [ids[0]]);
        });
    }
}

test('channel context-menu deletion lists its captured selection', async ({ page }) => {
    await mockEngine(page);
    await page.goto('/channels');
    await page.getByText('Demo Started', { exact: true }).click();
    await page.getByText('Demo Stopped', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
    await page.getByText('Demo Stopped', { exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete Channel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete channels', exact: true });
    await expect(dialog).toContainText('"Demo Started"');
    await expect(dialog).toContainText('"Demo Stopped"');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

for (const cards of [false, true]) {
    test(`clear statistics names the channels in ${cards ? 'card' : 'table'} view`, async ({ page }) => {
        await mockEngine(page);
        await page.goto('/dashboard');
        if (cards) await page.getByRole('button', { name: 'Card view', exact: true }).click();
        await page.getByText('Demo Started', { exact: true }).click();
        await page.getByText('Demo Stopped', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
        await page.getByRole('button', { name: 'Clear Statistics', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Clear Statistics', exact: true });
        await expect(dialog).toContainText('"Demo Started"');
        await expect(dialog).toContainText('"Demo Stopped"');
        await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
}

test('remove-all confirmation names only the channels included by the running-channel option', async ({ page }) => {
    const removed: string[] = [];
    await mockEngine(page, {
        'DELETE /channels/*/messages/_removeAll?clearStatistics=true&restartRunningChannels=false': (request: any) => {
            removed.push(new URL(request.url()).pathname.split('/')[3]);
            return '';
        }
    });
    await page.goto('/dashboard');
    await page.getByText('Demo Started', { exact: true }).click();
    await page.getByText('Demo Stopped', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
    await page.getByRole('button', { name: 'Remove All Messages', exact: true }).click();
    const options = page.getByRole('dialog', { name: 'Remove All Messages', exact: true }).first();
    await expect(options).toContainText('"Demo Started"');
    await expect(options).toContainText('"Demo Stopped"');
    await options.getByRole('button', { name: 'Remove All', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Remove All Messages', exact: true }).last();
    await expect(confirmation).toContainText('channel "Demo Stopped"');
    await expect(confirmation).not.toContainText('Demo Started');
    await confirmation.getByRole('textbox').fill('REMOVEALL');
    await confirmation.getByRole('button', { name: 'OK', exact: true }).click();
    await expect.poll(() => removed).toEqual(['c-stopped']);
});

test('a large deletion selection keeps every full name readable and the actions visible', async ({ page }, testInfo) => {
    const channels = Array.from({ length: 200 }, (_, index) => ({
        '@version': '4.6.0', id: `channel-${index}`, name: `Channel${String(index).padStart(3, '0')}${'x'.repeat(30)}`, revision: 1
    }));
    await mockEngine(page, { 'GET /channels': { list: { channel: channels } } });
    await page.goto('/channels');
    await page.getByText(channels[0].name, { exact: true }).click();
    await page.getByText(channels[199].name, { exact: true }).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Delete Channel', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete channels', exact: true });
    for (const channel of channels) await expect(dialog).toContainText(channel.name);
    for (const width of [1280, 420]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
        await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeInViewport();
        const bounds = await dialog.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        expect(await dialog.locator('.modal-body').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
        expect(await dialog.locator('.modal-body').evaluate(body => body.scrollHeight > body.clientHeight)).toBe(true);
        expect(await dialog.locator('.modal-body').evaluate(body => { body.scrollTop = body.scrollHeight; return body.scrollTop > 0; })).toBe(true);
        expect(await dialog.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(rect.left + 24, rect.top + 80));
        })).toBe(true);
        if (testInfo.project.name === 'ui') await page.screenshot({ path: testInfo.outputPath(`delete-channels-${width}.png`) });
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

for (const fallback of [false, true]) {
    test(`F06: ${fallback ? 'DOM fallback' : 'Radix'} dialog serializes async actions and defers dismissal`, async ({ page }) => {
        await mockEngine(page);
        await page.goto('/users');
        await expect(page.getByRole('button', { name: 'New User', exact: true })).toBeVisible();
        await page.evaluate(async fallback => {
            const ui = await import(String('/core/ui.js'));
            if (fallback) ui.setDialogRenderer(null);
            const state: any = (window as any).__dialogTest = { calls: 0, release: null };
            ui.modal({ title: 'Pending operation', body: ui.h('input', { value: 'Submitted' }), buttons: [
                { label: 'Cancel' }, { label: 'Execute', primary: true, onClick: async () => {
                    state.calls++;
                    await new Promise(resolve => { state.release = resolve; });
                    return false;
                } },
            ] });
        }, fallback);
        const dialog = page.getByRole('dialog', { name: 'Pending operation', exact: true });
        const execute = dialog.getByRole('button', { name: 'Execute', exact: true });
        await execute.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await expect(dialog.getByRole('status')).toContainText('Working');
        await execute.press('Enter');
        await page.keyboard.press('Escape');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
        await dialog.getByRole('button', { name: 'Close', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
        await expect(dialog).toBeVisible();
        expect(await page.evaluate(() => (window as any).__dialogTest.calls)).toBe(1);
        expect(await dialog.locator('input').evaluate(input => !!input.closest('[inert]'))).toBe(true);
        await page.evaluate(() => (window as any).__dialogTest.release());
        await expect(dialog).not.toHaveAttribute('aria-busy');
        await expect(dialog.locator('input')).toHaveValue('Submitted');
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
    });
}
