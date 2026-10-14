import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

// Exercise the public SettingsPanel contract with ordinary asynchronous saves.
// Plugins do not need to implement a host-tab lifetime/cancellation protocol.
async function fixture(page: Page) {
    await mockEngine(page, { 'GET /webplugins': [] });
    await page.route('**/webadmin/plugins.json', route => route.fulfill({ json: [
        { id: 'settings-lifecycle', entry: '/plugins/settings-lifecycle/entry.js' }
    ] }));
    await page.route('**/plugins/settings-lifecycle/entry.js*', route => route.fulfill({
        contentType: 'application/javascript', body: `export function register(p) {
            const labels = ['Review A', 'Review B'];
            let hidden = [];
            const controller = { checkTask: group => !group.startsWith('settings_')
                || labels.some(label => group === 'settings_' + label && !hidden.includes(label)) };
            const records = [];
            window.settingsLifecycle = {
                records,
                hide(labels) { hidden = labels; p.setAuthorizationController(controller); },
                stale(id, method) {
                    const ctx = records[id].ctx;
                    if (method === 'setTasks') ctx.setTasks('Departed Tasks', [p.ui.h('button', 'Departed action')]);
                    else if (method === 'setSave') ctx.setSave(null);
                    else ctx[method]();
                }
            };
            p.setAuthorizationController(controller);
            for (const label of labels) {
                function Panel(ctx) {
                    const React = p.React;
                    const [value, setValue] = React.useState('original');
                    React.useEffect(() => {
                        const record = { id: records.length, label, ctx, calls: 0,
                            edit(value) { setValue(value); ctx.markDirty(); } };
                        records.push(record);
                        record.save = () => {
                            record.calls++;
                            return new Promise(resolve => { record.finish = resolve; }).then(result => {
                                if (result) ctx.markClean();
                                return result;
                            });
                        };
                        ctx.setSave(record.save);
                        ctx.setTasks(label + ' Tasks', [p.ui.taskButton('Save ' + label, 'save', record.save)]);
                        return () => { record.unmounted = true; ctx.setSave(null); };
                    }, []);
                    return React.createElement('input', {
                        'aria-label': label + ' draft', value, onChange: event => setValue(event.target.value)
                    });
                }
                p.registerSettingsPanel({ label, component: Panel });
            }
        }`
    }));
    await page.goto('/settings?tab=Review%20A');
    await expect(draft(page, 'Review A')).toHaveValue('original');
    await expect(page.getByRole('button', { name: 'Save Review A', exact: true })).toBeVisible();
}

const draft = (page: Page, label: string, includeHidden = false) => page.getByRole('textbox', { name: label + ' draft', exact: true, includeHidden });
const prompt = (page: Page) => page.getByRole('dialog', { name: 'Unsaved Changes', exact: true });
const hide = (page: Page, labels: string[]) => page.evaluate(labels => (window as any).settingsLifecycle.hide(labels), labels);
const latest = (page: Page, label: string): Promise<number> => page.evaluate(label =>
    (window as any).settingsLifecycle.records.filter((record: any) => record.label === label).at(-1).id, label);
const calls = (page: Page, id: number): Promise<number> => page.evaluate(id => (window as any).settingsLifecycle.records[id].calls, id);
const dirty = (page: Page) => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
});
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function finish(page: Page, id: number, success = true) {
    await page.evaluate(({ id, success }) => (window as any).settingsLifecycle.records[id].finish(success), { id, success });
    await settle(page);
}
async function leave(page: Page, destination: 'route' | 'tab') {
    if (destination === 'route') await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    else await page.getByRole('tab', { name: 'Review B', exact: true }).click();
    await expect(prompt(page)).toBeVisible();
}

test('a removed panel save cannot discard the fallback tab draft or permit route departure', async ({ page }) => {
    await fixture(page);
    const original = await latest(page, 'Review A');
    await draft(page, 'Review A').fill('first draft');
    await leave(page, 'route');
    await prompt(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => calls(page, original)).toBe(1);
    await hide(page, ['Review A']);
    await draft(page, 'Review B').fill('replacement draft');
    expect(await dirty(page)).toBe(true);
    await finish(page, original);
    await expect(draft(page, 'Review B')).toHaveValue('replacement draft');
    await expect(page).toHaveURL(/\/settings\?/);
    expect(await dirty(page)).toBe(true);
});

for (const destination of ['route', 'tab'] as const) {
    test(`${destination} prompt from a removed panel cannot discard a new activation with the same label`, async ({ page }) => {
        await fixture(page);
        const original = await latest(page, 'Review A');
        await draft(page, 'Review A').fill('first draft');
        await leave(page, destination);
        await hide(page, ['Review A']);
        // Radix hides the background from assistive technology while the old
        // prompt stays open; these assertions only observe the mounted form.
        await expect(draft(page, 'Review B', true)).toHaveValue('original');
        await hide(page, ['Review B']);
        await expect(draft(page, 'Review A', true)).toHaveValue('original');
        await hide(page, []);
        const replacement = await latest(page, 'Review A');
        expect(replacement).not.toBe(original);
        // The old modal is still open. A plugin can populate a recovered draft
        // asynchronously, without a pointer action behind the modal.
        await page.evaluate(id => (window as any).settingsLifecycle.records[id].edit('recovered draft'), replacement);
        await prompt(page).getByRole('button', { name: "Don't Save", exact: true }).click();
        await settle(page);
        await expect(draft(page, 'Review A')).toHaveValue('recovered draft');
        expect(await dirty(page)).toBe(true);
        expect(await calls(page, original)).toBe(0);
        expect(await calls(page, replacement)).toBe(0);
    });

    test(`${destination} save completion cannot leave a later activation with the same label`, async ({ page }) => {
        await fixture(page);
        const original = await latest(page, 'Review A');
        await draft(page, 'Review A').fill('first draft');
        await leave(page, destination);
        await prompt(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => calls(page, original)).toBe(1);
        await hide(page, ['Review A']);
        await expect(draft(page, 'Review B')).toHaveValue('original');
        await hide(page, []);
        // A pending operation in the departed activation must not freeze tab
        // navigation for its replacement. Return through an actual tab click.
        await page.getByRole('tab', { name: 'Review A', exact: true }).click();
        await draft(page, 'Review A').fill('second activation draft');
        const replacement = await latest(page, 'Review A');
        expect(replacement).not.toBe(original);
        await finish(page, original);
        await expect(draft(page, 'Review A')).toHaveValue('second activation draft');
        expect(await dirty(page)).toBe(true);
        expect(await calls(page, replacement)).toBe(0);
    });
}

for (const departure of ['tab', 'view'] as const) {
    test(`late plugin callbacks after ${departure} departure cannot replace current tasks, save or dirty state`, async ({ page }) => {
        await fixture(page);
        const original = await latest(page, 'Review A');
        let currentLabel = 'Review B';
        if (departure === 'tab') await page.getByRole('tab', { name: 'Review B', exact: true }).click();
        else {
            await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
            await expect(page.getByRole('tab', { name: 'Review A', exact: true })).toHaveCount(0);
            await page.getByRole('button', { name: 'Settings', exact: true }).click();
            currentLabel = 'Review A';
        }
        await expect(draft(page, currentLabel)).toHaveValue('original');
        await expect(page.getByRole('button', { name: 'Save ' + currentLabel, exact: true })).toBeVisible();
        const current = await latest(page, currentLabel);
        await page.evaluate(id => {
            const fixture = (window as any).settingsLifecycle;
            for (const method of ['markDirty', 'setSave', 'setTasks']) fixture.stale(id, method);
        }, original);
        await settle(page);
        expect(await dirty(page)).toBe(false);
        await expect(page.getByRole('button', { name: 'Save ' + currentLabel, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Departed action', exact: true })).toHaveCount(0);
        await draft(page, currentLabel).fill('current draft');
        await page.evaluate(id => (window as any).settingsLifecycle.stale(id, 'markClean'), original);
        expect(await dirty(page)).toBe(true);
        await leave(page, 'route');
        await prompt(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => calls(page, current)).toBe(1);
        expect(await calls(page, original)).toBe(0);
        await finish(page, current, false);
        await expect(draft(page, currentLabel)).toHaveValue('current draft');
        expect(await dirty(page)).toBe(true);
    });
}

for (const success of [false, true]) {
    test(`a current plugin save ${success ? 'allows departure on success' : 'keeps the draft on failure'}`, async ({ page }) => {
        await fixture(page);
        const current = await latest(page, 'Review A');
        await draft(page, 'Review A').fill('current draft');
        await leave(page, 'route');
        await prompt(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => calls(page, current)).toBe(1);
        await finish(page, current, success);
        if (success) {
            await expect(page.getByRole('tab', { name: 'Review A', exact: true })).toHaveCount(0);
            await expect(page).toHaveURL(/\/dashboard$/);
            expect(await dirty(page)).toBe(false);
        } else {
            await expect(draft(page, 'Review A')).toHaveValue('current draft');
            expect(await dirty(page)).toBe(true);
        }
    });
}
