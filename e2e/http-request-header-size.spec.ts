import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

const key = 'requestHeaderSize';
const input = (page: Page) => page.locator(`input[data-fkey="${key}"]`);

async function setup(page: Page, version: string, value?: string) {
    const id = 'http-header-size';
    const properties: Record<string, any> = CASES.find(c => c.name === 'HTTP Listener')!.properties();
    // An older imported channel on a newer engine must still expose the field.
    properties['@version'] = '4.6.0';
    if (value !== undefined) properties[key] = value;
    let stored = makeChannel(id, { source: { transportName: 'HTTP Listener', properties } });
    const state = { writes: [] as any[], fail: false };
    await mockEngine(page, {
        'GET /server/version': version,
        [`GET /channels/${id}`]: () => ({ channel: stored }),
        [`PUT /channels/${id}`]: (request: Request) => {
            const submitted = request.postDataJSON().channel;
            state.writes.push(submitted);
            if (state.fail) return { __status: 503, body: { error: 'Temporary save failure' } };
            stored = structuredClone(submitted);
            // The real XML reader normalizes numeric String fields to numbers.
            // Keep templates intact while exercising that shipped read shape.
            const size = stored.sourceConnector.properties[key];
            if (typeof size === 'string' && /^\+?\d+$/.test(size)) {
                stored.sourceConnector.properties[key] = Number(size);
            }
            return true;
        }
    });
    await page.goto(`/channels/${id}/edit`);
    await page.getByRole('tab', { name: 'Source', exact: true }).click();
    await expect(page.locator('[data-fkey="contextPath"]')).toBeVisible();
    return state;
}

async function model(page: Page) {
    return page.evaluate(async () => {
        const store = await import(String('/core/store.js'));
        return { properties: store.getState('editingChannel').sourceConnector.properties, dirty: store.getState('editingChannelDirty') };
    });
}

async function defaults(page: Page, version: string) {
    return page.evaluate(async version => {
        const { platform } = await import(String('@oie/web-shell'));
        return platform.connectorPanel('HTTP Listener', 'SOURCE').defaults(version);
    }, version);
}

test('4.6 keeps the new setting out of the form, defaults and unrelated saves', async ({ page }) => {
    const state = await setup(page, '4.6.0');
    await expect(input(page)).toHaveCount(0);
    expect(await defaults(page, '4.6.0')).not.toHaveProperty(key);
    expect((await model(page)).properties).not.toHaveProperty(key);
    await page.locator('[data-fkey="contextPath"]').fill('/edited');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].sourceConnector.properties).not.toHaveProperty(key);
});

for (const version of ['4.7.0', '4.7.0-SNAPSHOT', '4.10.0', '5.0.0']) {
    test(`${version} shows the legacy default without mutating the loaded channel`, async ({ page }) => {
        const state = await setup(page, version);
        await expect(input(page)).toBeVisible();
        await expect(input(page)).toHaveAttribute('type', 'text');
        await expect(input(page)).toHaveAttribute('placeholder', '8192');
        expect((await model(page)).dirty).toBe(false);
        expect((await model(page)).properties).not.toHaveProperty(key);
        expect(await defaults(page, version)).toHaveProperty(key, '8192');
        await page.locator('[data-fkey="contextPath"]').fill('/legacy');
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => state.writes.length).toBe(1);
        expect(state.writes[0].sourceConnector.properties).not.toHaveProperty(key);
    });
}

test('4.7 preserves template expressions and numeric limits through save and reopen', async ({ page }) => {
    const state = await setup(page, '4.7.0', '${SavedLimit}');
    await expect(input(page)).toHaveValue('${SavedLimit}');
    for (const value of ['16384', '${HeaderLimit}', '+0008192', '2147483647']) {
        const before = state.writes.length;
        await input(page).fill(value);
        await expect(input(page)).toBeFocused();
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => state.writes.length).toBe(before + 1);
        expect(state.writes.at(-1).sourceConnector.properties[key]).toBe(value);
        await page.reload();
        await page.getByRole('tab', { name: 'Source', exact: true }).click();
        await expect(input(page)).toHaveValue(value.includes('$') ? value : String(Number(value)));
    }
});

test('invalid explicit sizes cannot be saved and highlight the editable setting', async ({ page }) => {
    const state = await setup(page, '4.7.0', '8192');
    for (const value of ['', '0', '-1', '1.5', '1e4', 'abc', '2147483648', ' 8192 ']) {
        await input(page).fill(value);
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Cannot Save Channel', exact: true });
        await expect(dialog).toContainText('Request Header Size');
        await expect(input(page)).toHaveClass(/cform-invalid/);
        await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
        expect(state.writes).toHaveLength(0);
    }
    await input(page).fill('${ResolvedAtStart}');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
});

test('a failed save retains the value and retry submits the latest edit', async ({ page }) => {
    const state = await setup(page, '4.7.0', '8192');
    state.fail = true;
    await input(page).fill('16384');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Temporary save failure' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(input(page)).toHaveValue('16384');
    expect((await model(page)).dirty).toBe(true);
    state.fail = false;
    await input(page).fill('${LatestLimit}');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1].sourceConnector.properties[key]).toBe('${LatestLimit}');
});
