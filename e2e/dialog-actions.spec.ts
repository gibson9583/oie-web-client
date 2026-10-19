import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

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

for (const renderer of ['radix', 'dom']) {
    test(`${renderer} modal resolves current return focus and preserves default or null behavior`, async ({ page }) => {
        await mockEngine(page);
        await page.goto('/settings');
        await expect(page.getByRole('tab', { name: /^Server(?: ●)?$/ })).toBeVisible();
        await page.evaluate(async renderer => {
            const name = '@oie/web-ui';
            const ui = await import(name);
            if (renderer === 'dom') ui.setDialogRenderer(null);
            const opener = ui.h('button', { id: 'focus-opener' }, 'Opener');
            const replacement = ui.h('button', { id: 'focus-replacement' }, 'Replacement');
            document.body.append(opener, replacement);
            (window as any).__focusProbe = { ui, opener, replacement, closed: 0, returnCalls: 0 };
            opener.focus();
            let target = opener;
            const handle = ui.modal({ title: 'Focus probe', body: 'Body', returnFocus: () => {
                (window as any).__focusProbe.returnCalls++;
                return target;
            },
                onClose: () => (window as any).__focusProbe.closed++ });
            target = replacement;
            (window as any).__focusProbe.handle = handle;
        }, renderer);
        await expect(page.getByRole('dialog', { name: 'Focus probe' })).toBeVisible();
        await page.evaluate(() => { const { handle } = (window as any).__focusProbe; handle.close(); handle.close(); });
        await expect(page.locator('#focus-replacement')).toBeFocused();
        expect(await page.evaluate(() => (window as any).__focusProbe.closed)).toBe(1);
        expect(await page.evaluate(() => (window as any).__focusProbe.returnCalls)).toBe(1);
        for (const mode of ['default', 'null', 'removed']) {
            await page.evaluate(mode => {
                const state = (window as any).__focusProbe;
                state.opener.focus();
                state.returnCalls = 0;
                const options = mode === 'default' ? {} : { returnFocus: () => {
                    state.returnCalls++;
                    return mode === 'null' ? null : state.replacement;
                } };
                state.handle = state.ui.modal({ title: 'Focus probe', body: 'Body', ...options });
                if (mode === 'removed') state.replacement.remove();
            }, mode);
            await expect(page.getByRole('dialog', { name: 'Focus probe' })).toBeVisible();
            await page.evaluate(() => (window as any).__focusProbe.handle.close());
            await expect(page.getByRole('dialog')).toHaveCount(0);
            if (mode === 'default') await expect(page.locator('#focus-opener')).toBeFocused();
            else {
                await expect.poll(() => page.evaluate(() => (window as any).__focusProbe.returnCalls)).toBe(1);
                await expect(page.locator('#focus-opener')).not.toBeFocused();
            }
        }
    });
}
