import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { CASES, makeChannel } from './connector-fixtures.js';

/* Swing ChannelSetup behavior matrix (source AND destination):
 * - New/saved defaults, repeated switches, reverted edits: no confirmation.
 * - Saved or unsaved connector settings: confirm; cancel preserves everything.
 * - Filter/transformer/identity edits: preserved, do not cause confirmation.
 * - Current unknown type/default factory failure: protect existing settings.
 * - Unavailable target/default factory failure: no partial model mutation.
 * - Stale session/connector while awaiting confirmation: no mutation.
 * - Cancel/retry and same-type selection: idempotent, no writes until Save.
 */
type Mode = 'SOURCE' | 'DESTINATION';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Change Connector Type', exact: true });
const selector = (page: Page, mode: Mode) => mode === 'SOURCE'
    ? page.locator('.field').filter({ has: page.getByText('Source Connector', { exact: true }) }).locator('select')
    : page.locator('.dest-type-row > select');
const httpName = (mode: Mode) => mode === 'SOURCE' ? 'HTTP Listener' : 'HTTP Sender';
const vmName = (mode: Mode) => mode === 'SOURCE' ? 'Channel Reader' : 'Channel Writer';

async function state(page: Page, mode: Mode) {
    return page.evaluate(async mode => {
        const store = await import(String('/core/store.js'));
        const channel = store.getState('editingChannel');
        return {
            connector: mode === 'SOURCE' ? channel.sourceConnector : channel.destinationConnectors.connector[0],
            dirty: store.getState('editingChannelDirty')
        };
    }, mode);
}

async function openPanel(page: Page, mode: Mode, channel?: any, overrides = {}) {
    await mockEngine(page, { ...(channel ? { [`GET /channels/${channel.id}`]: { channel } } : {}), ...overrides });
    if (channel) await page.goto(`/channels/${channel.id}/edit`);
    else {
        await page.goto('/channels');
        await page.getByRole('button', { name: 'New Channel', exact: true }).first().click();
        await page.getByText('Classic editor', { exact: true }).click();
    }
    await page.getByRole('tab', { name: mode === 'SOURCE' ? 'Source' : 'Destinations', exact: true }).click();
    await expect(selector(page, mode)).toBeVisible();
}

for (const mode of ['SOURCE', 'DESTINATION'] as const) {
    test(`${mode}: new channel switches repeatedly while at defaults without prompting`, async ({ page }) => {
        await openPanel(page, mode);
        const type = selector(page, mode);
        await expect(type).toHaveValue(vmName(mode));
        for (const name of [httpName(mode), mode === 'SOURCE' ? 'TCP Listener' : 'TCP Sender', vmName(mode)]) {
            await type.selectOption(name);
            await expect(type).toHaveValue(name);
            await expect(dialog(page)).toHaveCount(0);
            expect((await state(page, mode)).connector.transportName).toBe(name);
        }
        expect((await state(page, mode)).dirty).toBe(true);
    });

    test(`${mode}: reopened defaults switch without prompting despite filter/transformer changes`, async ({ page }) => {
        const channel = makeChannel('saved-defaults');
        const connector = mode === 'SOURCE' ? channel.sourceConnector : channel.destinationConnectors.connector[0];
        connector.name = 'Saved connector';
        connector.filter.elements = { 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': { script: 'return true;', enabled: true } };
        connector.transformer.outboundTemplate = '<keep/>';
        connector.properties['@version'] = '4.5.2';
        connector.properties.pluginProperties = { '@class': 'set' };
        await openPanel(page, mode, channel);
        const before = await state(page, mode);
        await selector(page, mode).selectOption(httpName(mode));
        await expect(selector(page, mode)).toHaveValue(httpName(mode));
        await expect(dialog(page)).toHaveCount(0);
        const after = await state(page, mode);
        const { properties: _oldProperties, transportName: _oldName, ...preserved } = before.connector;
        expect(after.connector).toMatchObject(preserved);
    });

    test(`${mode}: saved non-default shared settings prompt on first switch; cancel and retry are safe`, async ({ page }) => {
        const channel = makeChannel('saved-custom');
        const connector = mode === 'SOURCE' ? channel.sourceConnector : channel.destinationConnectors.connector[0];
        const common = mode === 'SOURCE' ? connector.properties.sourceConnectorProperties : connector.properties.destinationConnectorProperties;
        common.queueBufferSize = 2345;
        await openPanel(page, mode, channel);
        const before = await state(page, mode);
        expect(before.dirty).toBe(false);
        const type = selector(page, mode);
        await type.selectOption(vmName(mode));
        await expect(dialog(page)).toHaveCount(0);
        await type.selectOption(httpName(mode));
        await expect(dialog(page)).toBeVisible();
        await expect(type).toBeDisabled();
        expect(await state(page, mode)).toEqual(before);
        await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(type).toHaveValue(vmName(mode));
        await expect(type).toBeEnabled();
        expect(await state(page, mode)).toEqual(before);
        await type.selectOption(httpName(mode));
        await dialog(page).getByRole('button', { name: 'OK', exact: true }).click();
        await expect(type).toHaveValue(httpName(mode));
        const after = await state(page, mode);
        expect(after.dirty).toBe(true);
        expect(after.connector.properties[mode === 'SOURCE' ? 'sourceConnectorProperties' : 'destinationConnectorProperties'].queueBufferSize).toBe(1000);
        const { properties: _oldProperties, transportName: _oldName, ...preserved } = before.connector;
        expect(after.connector).toMatchObject(preserved);
    });

    test(`${mode}: prompt follows action-time edits and stops after reverting to defaults`, async ({ page }) => {
        await openPanel(page, mode);
        const type = selector(page, mode);
        await type.selectOption(httpName(mode));
        const key = mode === 'SOURCE' ? 'contextPath' : 'host';
        const field = page.locator(`[data-fkey="${key}"]`).first();
        const original = await field.inputValue();
        await field.fill(mode === 'SOURCE' ? '/custom' : 'https://custom.example');
        const before = await state(page, mode);
        await type.selectOption(vmName(mode));
        await expect(dialog(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        expect(await state(page, mode)).toEqual(before);
        await expect(field).toHaveValue(mode === 'SOURCE' ? '/custom' : 'https://custom.example');
        await field.fill(original);
        await type.selectOption(vmName(mode));
        await expect(type).toHaveValue(vmName(mode));
        await expect(dialog(page)).toHaveCount(0);
    });
}

test('saved HTTP authentication defaults are equivalent to an absent entry; configured authentication prompts', async ({ page }) => {
    const properties: any = CASES.find(c => c.name === 'HTTP Listener')!.properties();
    properties.pluginProperties = { 'com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties': { '@version': '4.6.0', authType: 'NONE' } };
    await openPanel(page, 'SOURCE', makeChannel('http-auth', { source: { transportName: 'HTTP Listener', properties } }));
    const type = selector(page, 'SOURCE');
    await type.selectOption('Channel Reader');
    await expect(type).toHaveValue('Channel Reader');
    await expect(dialog(page)).toHaveCount(0);
    await type.selectOption('HTTP Listener');
    const auth = page.locator('.field').filter({ has: page.getByText('Authentication Type', { exact: true }) }).locator('select');
    await auth.selectOption('BASIC');
    await type.selectOption('Channel Reader');
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(auth).toHaveValue('BASIC');
    await auth.selectOption('NONE');
    await type.selectOption('Channel Reader');
    await expect(type).toHaveValue('Channel Reader');
    await expect(dialog(page)).toHaveCount(0);
});

test('engine connector-list failure still permits default switches', async ({ page }) => {
    await openPanel(page, 'SOURCE', undefined, { 'GET /extensions/connectors': { __status: 500 } });
    await selector(page, 'SOURCE').selectOption('HTTP Listener');
    await expect(selector(page, 'SOURCE')).toHaveValue('HTTP Listener');
    await expect(dialog(page)).toHaveCount(0);
});

test('unknown existing connector settings require confirmation; unknown target is blocked', async ({ page }) => {
    const channel = makeChannel('unknown', { source: { transportName: 'Custom Listener', properties: { '@class': 'custom.Properties', secret: 'keep' } } });
    await openPanel(page, 'SOURCE', channel, { 'GET /extensions/connectors': { map: { entry: { string: 'other', connectorMetaData: { name: 'Other Listener', type: 'SOURCE' } } } } });
    const type = selector(page, 'SOURCE');
    const before = await state(page, 'SOURCE');
    await expect(type.locator('option[value="Other Listener"]')).toHaveCount(1);
    await type.selectOption('Other Listener');
    await expect(type).toHaveValue('Custom Listener');
    await expect(dialog(page)).toHaveCount(0);
    expect(await state(page, 'SOURCE')).toEqual(before);
    await type.selectOption('HTTP Listener');
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await state(page, 'SOURCE')).toEqual(before);
});

test('target default factory failure preserves the old connector and allows retry', async ({ page }) => {
    await openPanel(page, 'SOURCE', makeChannel('factory-failure'));
    const before = await state(page, 'SOURCE');
    await page.evaluate(async () => {
        const { platform } = await import(String('/core/platform.js'));
        const def = platform.connectorPanel('HTTP Listener', 'SOURCE');
        const defaults = def.defaults;
        def.defaults = (version: string) => { def.defaults = defaults; throw new Error(`Defaults unavailable for ${version}`); };
    });
    await selector(page, 'SOURCE').selectOption('HTTP Listener');
    const error = page.getByRole('dialog', { name: 'Change Connector Type Failed', exact: true });
    await expect(error).toContainText('Defaults unavailable');
    expect(await state(page, 'SOURCE')).toEqual(before);
    await error.getByRole('button', { name: 'Close', exact: true }).last().click();
    await selector(page, 'SOURCE').selectOption('HTTP Listener');
    await expect(selector(page, 'SOURCE')).toHaveValue('HTTP Listener');
    await expect(dialog(page)).toHaveCount(0);
});

for (const interruption of ['session', 'properties'] as const) {
    test(`confirmation cannot apply to a replaced ${interruption}`, async ({ page }) => {
        const channel = makeChannel('stale');
        channel.sourceConnector.properties.sourceConnectorProperties.processingThreads = 2;
        await openPanel(page, 'SOURCE', channel);
        await selector(page, 'SOURCE').selectOption('HTTP Listener');
        await expect(dialog(page)).toBeVisible();
        await page.evaluate(async interruption => {
            if (interruption === 'session') (await import(String('/core/engine-fetch.js'))).discardEngineResponses();
            else {
                const { getState } = await import(String('/core/store.js'));
                const connector = getState('editingChannel').sourceConnector;
                connector.properties = { ...connector.properties, importedValue: 'keep' };
            }
        }, interruption);
        const before = await state(page, 'SOURCE');
        await dialog(page).getByRole('button', { name: 'OK', exact: true }).click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(selector(page, 'SOURCE')).toHaveValue('Channel Reader');
        expect(await state(page, 'SOURCE')).toEqual(before);
    });
}

for (const mode of ['SOURCE', 'DESTINATION'] as const) {
    for (const existing of [false, true]) {
        test(`wizard ${mode}: ${existing ? 'saved' : 'new'} channel uses the same defaults rule`, async ({ page }) => {
            await mockEngine(page, { 'GET /channels/wizard-switch': { channel: makeChannel('wizard-switch') } });
            await page.goto(existing ? '/channels/wizard-switch/guided' : '/channels/new/guided');
            if (!existing) await page.locator('.view-body input').first().fill('Wizard connector switches');
            for (let i = 0; i < (mode === 'SOURCE' ? 3 : 4); i++) {
                await page.getByRole('button', { name: 'Next', exact: true }).click();
            }
            const pick = (name: string) => page.getByRole('button', { name, exact: true });
            await pick(httpName(mode)).click();
            await expect(dialog(page)).toHaveCount(0);
            const field = page.locator(`[data-fkey="${mode === 'SOURCE' ? 'contextPath' : 'host'}"]`).first();
            await expect(field).toBeVisible();
            const original = await field.inputValue();
            await field.fill(mode === 'SOURCE' ? '/wizard' : 'https://wizard.example');
            await pick(vmName(mode)).click();
            await expect(dialog(page)).toBeVisible();
            await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
            await expect(field).toHaveValue(mode === 'SOURCE' ? '/wizard' : 'https://wizard.example');
            await field.fill(original);
            await pick(vmName(mode)).click();
            await expect(dialog(page)).toHaveCount(0);
            expect((await state(page, mode)).connector.transportName).toBe(vmName(mode));
        });
    }
}
