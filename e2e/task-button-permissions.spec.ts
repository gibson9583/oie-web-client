import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

for (const initiallyDisabled of [false, true]) {
    for (const tagged of [false, true]) {
        test(`DOM task button respects live disabled state and permissions (${initiallyDisabled ? 'disabled' : 'enabled'} initially, ${tagged ? 'tagged' : 'untagged'})`, async ({ page }) => {
            await mockEngine(page);
            await page.goto('/dashboard');
            await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
            await page.evaluate(async ({ initiallyDisabled, tagged }) => {
                const { platform } = await import(String('@oie/web-shell'));
                const { taskButton } = await import(String('@oie/web-ui'));
                const state = (window as any).__taskButtonTest = { calls: 0, allowed: true, receivers: [] as boolean[] };
                platform.setAuthorizationController({ checkTask: (group: string, task: string) =>
                    group !== 'test-plugin' || task !== 'doRun' || state.allowed });
                const button = taskButton('Plugin action', 'play', function (this: HTMLButtonElement, event: MouseEvent) {
                    state.calls++;
                    state.receivers.push(this === event.currentTarget);
                    this.disabled = true;
                }, {
                    disabled: initiallyDisabled,
                    ...(tagged ? { group: 'test-plugin', task: 'doRun' } : {}),
                });
                document.body.appendChild(button);
            }, { initiallyDisabled, tagged });

            const button = page.getByRole('button', { name: 'Plugin action', exact: true });
            const calls = () => page.evaluate(() => (window as any).__taskButtonTest.calls);
            if (initiallyDisabled) {
                await expect(button).toBeDisabled();
                await button.dispatchEvent('click');
                expect(await calls()).toBe(0);
                await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
            }
            await expect(button).toBeEnabled();
            // The icon is the event target; the button owns the disabled state.
            await button.locator('svg').click();
            expect(await calls()).toBe(1);
            await expect(button).toBeDisabled();
            expect(await page.evaluate(() => (window as any).__taskButtonTest.receivers)).toEqual([true]);

            for (let completed = 1; completed <= 2; completed++) {
                await button.evaluate(node => { (node as HTMLButtonElement).disabled = true; });
                await expect(button).toBeDisabled();
                // Synthetic dispatch bypasses native disabled-button suppression.
                await button.dispatchEvent('click');
                expect(await calls()).toBe(completed);
                await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
                await button.click();
                expect(await calls()).toBe(completed + 1);
            }

            // Mutate the controller's state without notifying/recreating the DOM.
            await page.evaluate(() => { (window as any).__taskButtonTest.allowed = false; });
            await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
            await expect(button).toBeVisible();
            await expect(button).toBeEnabled();
            await button.click();
            await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
            await button.dispatchEvent('click');
            expect(await calls()).toBe(tagged ? 3 : 5);

            await page.evaluate(() => { (window as any).__taskButtonTest.allowed = true; });
            await button.evaluate(node => { (node as HTMLButtonElement).disabled = false; });
            await button.click();
            expect(await calls()).toBe(tagged ? 4 : 6);
            expect(await page.evaluate(() => (window as any).__taskButtonTest.receivers)).toEqual(
                Array(tagged ? 4 : 6).fill(true));
        });
    }
}
