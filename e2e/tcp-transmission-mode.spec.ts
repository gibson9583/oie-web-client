import type { Page, Request } from '@playwright/test';
import { test, expect } from './base.js';
import { CASES, makeChannel } from './connector-fixtures.js';
import { mockEngine } from './mock.js';

const frameClass = 'com.mirth.connect.model.transmission.framemode.FrameModeProperties';
const mllpClass = 'com.mirth.connect.plugins.mllpmode.MLLPModeProperties';
const basic = { pluginPointName: 'Basic', '@class': frameClass, startOfMessageBytes: '', endOfMessageBytes: '' };
const mllp = { pluginPointName: 'MLLP', '@class': mllpClass, startOfMessageBytes: '0B', endOfMessageBytes: '1C0D',
    useMLLPv2: false, ackBytes: '06', nackBytes: '15', maxRetries: '2' };
const custom = { pluginPointName: 'Custom', '@class': 'example.CustomModeProperties', ackPolicy: 'AUTO', profile: { name: 'standard' } };

async function registerTestModes(page: Page) {
    await page.evaluate(async customMode => {
        const { platform } = await import(String('@oie/web-shell'));
        platform.registerTransmissionMode('Custom', { label: 'Custom',
            apply: (tm: any) => Object.assign(tm, customMode), sampleFrame: (tm: any) => tm.ackPolicy });
        platform.registerTransmissionMode('Frame', { label: 'Frame', apply(tm: any) {
            tm.startOfMessageBytes = '01'; tm.endOfMessageBytes = '04';
        } });
        platform.registerTransmissionMode('Incomplete', { label: 'Incomplete', apply(tm: any) {
            tm.startOfMessageBytes = '01'; tm.endOfMessageBytes = '04'; tm.profile = 'custom';
        } });
        platform.registerTransmissionMode('Throwing', { label: 'Throwing', apply(tm: any) {
            tm.ackPolicy = 'partial'; throw new Error('Initialization failed');
        } });
    }, custom);
}

async function openPanel(page: Page, name: string, initialMode: Record<string, unknown>, registerModes?: (page: Page) => Promise<void>) {
    const connector = CASES.find(c => c.name === name)!;
    const source = connector.mode === 'SOURCE';
    const id = 'transmission-mode';
    const properties = { ...connector.properties(), transmissionModeProperties: initialMode };
    let stored = makeChannel(id, { [source ? 'source' : 'destination']: { transportName: name, properties } });
    const writes: Record<string, unknown>[] = [];
    let saveError: 'http' | 'conflict' | undefined;
    await mockEngine(page, {
        [`GET /channels/${id}`]: () => ({ channel: stored }),
        [`PUT /channels/${id}`]: (request: Request) => {
            const channel = request.postDataJSON().channel;
            const saved = source ? channel.sourceConnector : channel.destinationConnectors.connector[0];
            writes.push(saved.properties.transmissionModeProperties);
            if (saveError === 'http') return { __status: 503, body: { error: 'Unavailable' } };
            if (saveError === 'conflict') return false;
            stored = channel;
            return true;
        },
    });
    await page.goto(`/channels/${id}/edit`);
    async function mount() {
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toBeVisible();
        await registerModes?.(page);
        await page.getByRole('tab', { name: source ? 'Source' : 'Destinations', exact: true }).click();
    }
    await mount();
    const section = page.locator('.cform-section').filter({ has: page.getByText('Transmission Mode', { exact: true }) });
    const selector = section.getByRole('combobox');
    await expect(selector).toHaveValue(String(initialMode.pluginPointName));
    async function save(failure?: 'http' | 'conflict') {
        saveError = failure;
        const count = writes.length;
        await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
        await expect.poll(() => writes.length).toBe(count + 1);
        if (failure) {
            const dialog = page.getByRole('dialog', { name: failure === 'http' ? 'Error' : 'Channel Modified', exact: true });
            await dialog.getByRole('button', { name: failure === 'http' ? 'Close' : 'Cancel', exact: true }).last().click();
        }
        await expect(page.locator('.content-row')).not.toHaveAttribute('inert');
        return writes[count];
    }
    return { selector, save, section, mount };
}

for (const [name, target] of [['TCP Listener', basic], ['TCP Sender', mllp]] as const) {
    test(`${name} switches from a custom transmission mode to ${target.pluginPointName} and back`, async ({ page }) => {
        const version = name === 'TCP Listener' ? { '@version': '4.7.0' } : {};
        const { selector, save, section, mount } = await openPanel(page, name, { ...custom, ...version, ackPolicy: 'MANUAL' }, registerTestModes);
        await selector.selectOption('Custom');
        await expect(section.getByText('MANUAL', { exact: true })).toBeVisible();
        await selector.selectOption(target.pluginPointName);
        expect(await save(name === 'TCP Listener' ? 'http' : 'conflict')).toEqual({ ...target, ...version });
        expect(await save()).toEqual({ ...target, ...version });
        await selector.selectOption('Custom');
        expect(await save()).toEqual({ ...custom, ...version });
        await page.reload();
        await mount();
        await expect(selector).toHaveValue('Custom');
        await expect(section.getByText('AUTO', { exact: true })).toBeVisible();
    });
}

test('incomplete and throwing mode initializers leave the previous settings intact', async ({ page }) => {
    const { selector, save } = await openPanel(page, 'TCP Sender', basic, registerTestModes);
    await selector.selectOption('Frame'); // The old SDK example only supplied the frame bytes.
    for (const mode of ['Incomplete', 'Throwing']) {
        await selector.selectOption(mode);
        const error = page.getByRole('dialog', { name: 'Error' });
        await expect(error).toContainText('Cannot select ' + mode);
        await error.getByRole('button', { name: 'Close', exact: true }).last().click();
        await expect(selector).toHaveValue('Frame');
    }
    expect(await save()).toEqual({ ...basic, pluginPointName: 'Frame', startOfMessageBytes: '01', endOfMessageBytes: '04' });
});

test('Basic remains selectable when the saved MLLP web plugin fails to load', async ({ page }) => {
    await page.route('**/plugins/mllpmode/web/plugin.js*', route => route.abort('failed'));
    const initial = { ...basic, pluginPointName: 'MLLP', startOfMessageBytes: '02', endOfMessageBytes: '03' };
    const { selector, save } = await openPanel(page, 'TCP Listener', initial);
    await expect(selector.getByRole('option')).toHaveCount(2);
    await expect(selector.getByRole('option', { name: 'MLLP (unavailable)', exact: true })).toBeDisabled();
    await page.locator('[data-fkey="listenerConnectorProperties.port"]').fill('8880');
    expect(await save()).toEqual(initial);
    await selector.press('b'); // Native select typeahead chooses Basic TCP.
    await expect(selector).toBeFocused();
    await expect(selector).toHaveValue('Basic');
    await expect(selector.getByRole('option')).toHaveCount(1);
    expect(await save()).toEqual(basic);
});

test('confirming MLLP settings upgrades a legacy frame without losing its custom bytes', async ({ page }) => {
    const legacy = { ...basic, pluginPointName: 'MLLP', startOfMessageBytes: '02', endOfMessageBytes: '03', '@version': '4.7.0' };
    const { section, save } = await openPanel(page, 'TCP Listener', legacy);
    const settings = section.getByRole('button', { name: 'Transmission Mode Settings' });
    const dialog = page.getByRole('dialog', { name: 'MLLP Settings' });
    await settings.click();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.locator('[data-fkey="listenerConnectorProperties.port"]').fill('8880');
    expect(await save()).toEqual(legacy);
    await settings.click();
    await dialog.getByRole('radio', { name: 'Yes' }).check();
    await dialog.getByRole('button', { name: 'OK' }).click();
    expect(await save()).toEqual({ ...mllp, ...legacy, '@class': mllpClass, useMLLPv2: true });
});
