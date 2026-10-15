import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';

// AccessDeniedView removes the whole SettingsContent tree when the last visible
// section disappears. Recovery must retain the activation isolation promised to
// plugins, including a pending prompt/save from that removed tree.
async function fixture(page: Page, initiallyAllowed = ['Merge A', 'Merge B']) {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await mockEngine(page, { 'GET /webplugins': [] });
    await page.route('**/webadmin/plugins.json', route => route.fulfill({ json: [
        { id: 'settings-rbac-integration', entry: '/plugins/settings-rbac-integration/entry.js' },
    ] }));
    await page.route('**/plugins/settings-rbac-integration/entry.js*', route => route.fulfill({
        contentType: 'application/javascript',
        body: `export function register(p) {
            let allowed = ${JSON.stringify(initiallyAllowed)};
            const records = [];
            const controller = { checkTask: group => !group.startsWith('settings_')
                || allowed.some(label => group === 'settings_' + label) };
            window.settingsRbacIntegration = {
                records,
                allow(labels) { allowed = labels; p.setAuthorizationController(controller); },
                stale(id) {
                    const ctx = records[id].ctx;
                    ctx.setTasks('Stale Tasks', [p.ui.h('button', 'Stale action')]);
                    ctx.setSave(null);
                    ctx.markClean();
                },
            };
            p.setAuthorizationController(controller);
            for (const label of ['Merge A', 'Merge B']) {
                function Panel(ctx) {
                    const React = p.React;
                    const [value, setValue] = React.useState('original');
                    React.useEffect(() => {
                        const record = { id: records.length, label, ctx, calls: 0,
                            edit(value) { setValue(value); ctx.markDirty(); } };
                        records.push(record);
                        record.save = () => {
                            record.calls++;
                            return new Promise(resolve => { record.finish = resolve; }).then(success => {
                                if (success) ctx.markClean();
                                return success;
                            });
                        };
                        ctx.setSave(record.save);
                        ctx.setTasks(label + ' Tasks', [p.ui.taskButton('Save ' + label, 'save', record.save)]);
                        return () => { record.unmounted = true; ctx.setSave(null); };
                    }, []);
                    return React.createElement('input', {
                        'aria-label': label + ' draft', value, onChange: event => setValue(event.target.value),
                    });
                }
                p.registerSettingsPanel({ label, component: Panel });
            }
        }`,
    }));
    await page.goto('/settings?tab=Merge%20A');
    return errors;
}

const draft = (page: Page, includeHidden = false) => page.getByRole('textbox', { name: 'Merge A draft', exact: true, includeHidden });
const prompt = (page: Page) => page.getByRole('dialog', { name: 'Unsaved Changes', exact: true });
const allow = (page: Page, labels: string[]) => page.evaluate(labels => (window as any).settingsRbacIntegration.allow(labels), labels);
const latest = (page: Page): Promise<number> => page.evaluate(() => (window as any).settingsRbacIntegration.records.at(-1).id);
const dirty = (page: Page) => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
const guard = (page: Page) => page.evaluate(async () => {
    const { platform } = await import(String('@oie/web-shell'));
    return platform.store.getState('navGuard') == null ? null : 'installed';
});
const calls = (page: Page, id: number): Promise<number> => page.evaluate(id => (window as any).settingsRbacIntegration.records[id].calls, id);
const settle = (page: Page) => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function leave(page: Page, destination: 'route' | 'tab') {
    if (destination === 'route') await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
    else await page.getByRole('tab', { name: 'Merge B', exact: true }).click();
    await expect(prompt(page)).toBeVisible();
}

test('all-denied Settings mounts no plugin editor and recovers without remounting a surviving draft', async ({ page }) => {
    const errors = await fixture(page, []);
    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).settingsRbacIntegration.records.length)).toBe(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.locator('.view-tasks button')).toHaveCount(0);
    expect(await dirty(page)).toBe(false);
    expect(await guard(page)).toBeNull();
    await allow(page, ['Merge A']);
    await expect(draft(page)).toHaveValue('original');
    await draft(page).fill('surviving draft');
    await allow(page, ['Merge A', 'Merge B']);
    await expect(page.getByRole('tab', { name: 'Merge B', exact: true })).toBeVisible();
    await expect(draft(page)).toHaveValue('surviving draft');
    expect(await page.evaluate(() => (window as any).settingsRbacIntegration.records.length)).toBe(1);
    expect(await dirty(page)).toBe(true);
    expect(errors).toEqual([]);
});

for (const destination of ['route', 'tab'] as const) {
    test(`${destination} prompt cannot discard a recovered Settings tree after all sections are revoked`, async ({ page }) => {
        const errors = await fixture(page);
        await expect(draft(page)).toHaveValue('original');
        const original = await latest(page);
        await draft(page).fill('departing draft');
        await leave(page, destination);
        await allow(page, []);
        await expect(page.getByRole('heading', { name: 'Access denied', exact: true, includeHidden: true })).toBeVisible();
        expect(await dirty(page)).toBe(false);
        expect(await guard(page)).toBeNull();
        await allow(page, ['Merge A', 'Merge B']);
        await expect(draft(page, true)).toHaveValue('original');
        const replacement = await latest(page);
        expect(replacement).not.toBe(original);
        await page.evaluate(id => (window as any).settingsRbacIntegration.records[id].edit('recovered draft'), replacement);
        await prompt(page).getByRole('button', { name: "Don't Save", exact: true }).click();
        await settle(page);
        await expect(page).toHaveURL(/\/settings\?/);
        await expect(draft(page)).toHaveValue('recovered draft');
        expect(await dirty(page)).toBe(true);
        expect(await calls(page, original)).toBe(0);
        expect(await calls(page, replacement)).toBe(0);
        expect(errors).toEqual([]);
    });

    for (const success of [false, true]) {
        test(`${destination} save ${success ? 'success' : 'failure'} cannot alter recovered Settings after all sections are revoked`, async ({ page }) => {
            const errors = await fixture(page);
            await expect(draft(page)).toHaveValue('original');
            const original = await latest(page);
            await draft(page).fill('departing draft');
            await leave(page, destination);
            await prompt(page).getByRole('button', { name: 'Save Changes', exact: true }).click();
            await expect.poll(() => calls(page, original)).toBe(1);
            await allow(page, []);
            await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
            await expect(page.locator('.view-tasks button')).toHaveCount(0);
            expect(await dirty(page)).toBe(false);
            expect(await guard(page)).toBeNull();
            await allow(page, ['Merge A', 'Merge B']);
            await draft(page).fill('recovered draft');
            const replacement = await latest(page);
            expect(replacement).not.toBe(original);
            await page.evaluate(({ id, success }) => {
                const fixture = (window as any).settingsRbacIntegration;
                fixture.stale(id);
                fixture.records[id].finish(success);
            }, { id: original, success });
            await settle(page);
            await expect(page).toHaveURL(/\/settings\?/);
            await expect(draft(page)).toHaveValue('recovered draft');
            await expect(page.getByRole('button', { name: 'Save Merge A', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Stale action', exact: true })).toHaveCount(0);
            expect(await dirty(page)).toBe(true);
            expect(await calls(page, replacement)).toBe(0);
            // The recovered tree still owns a functional route-leave guard.
            await leave(page, 'route');
            await prompt(page).getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(draft(page)).toHaveValue('recovered draft');
            expect(errors).toEqual([]);
        });
    }
}
