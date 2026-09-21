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
