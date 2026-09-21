import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

test('dependency picker traps focus, cancels with Escape, and restores its opener', async ({ page }) => {
    await mockEngine(page, {
        'GET /channels/idsAndNames': { map: { entry: [{ string: ['alpha', 'Alpha Channel'] }] } },
    });
    await page.goto('/channels/new/guided');
    await page.locator('.view-body input').first().fill('Keyboard channel');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await next.focus();
    await page.keyboard.press('Enter');
    const dependencies = page.getByRole('tab', { name: 'Deploy/Start Dependencies', exact: true });
    await dependencies.focus();
    await page.keyboard.press('Space');
    const add = page.getByRole('button', { name: /Add channel/ }).first();
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add channels', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Filter channels' })).toBeFocused();
    for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    // Measure settled colors, after the modal/overlay opacity and focus
    // transitions. Axe can otherwise sample different animation frames.
    await dialog.evaluate(async el => {
        const surface = el.closest('.modal-overlay') || el;
        await Promise.allSettled(surface.getAnimations({ subtree: true }).map(animation => animation.finished));
    });
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(axe.violations).toEqual([]);
    await dialog.getByRole('checkbox', { name: 'Alpha Channel' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    // Escape cancels the staged selection. Reopening starts with no selection.
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('checkbox', { name: 'Alpha Channel' })).not.toBeChecked();
    await page.keyboard.press('Escape');
});

for (const entity of ['channels', 'alerts']) {
    test(`${entity} wizard steps accept keyboard input only when visited`, async ({ page, browserName }) => {
        await mockEngine(page);
        await page.goto(`/${entity}/new/guided`);
        const steps = page.locator('.wiz-step');
        await expect(steps.nth(1)).toBeDisabled();
        await page.locator('.view-body input').first().fill('Keyboard wizard');
        const next = page.getByRole('button', { name: 'Next', exact: true });
        await next.focus();
        await page.keyboard.press('Enter');
        await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
        await steps.first().focus();
        await page.keyboard.press('Space');
        await expect(steps.first()).toHaveAttribute('aria-current', 'step');
        // Basics focuses its name field on mount. Re-enter the step controls
        // to check their native tab order independently of that behavior.
        await steps.first().focus();
        // macOS WebKit follows Safari's Option-Tab navigation for all controls.
        await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
        await expect(steps.nth(1)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
        // Step foreground/background colors transition together on activation.
        await page.locator('.wiz-steps').evaluate(async el => {
            await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished));
        });
        expect((await new AxeBuilder({ page }).include('.wiz-steps').analyze()).violations).toEqual([]);
    });
}
