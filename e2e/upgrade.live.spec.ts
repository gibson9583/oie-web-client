import { test, expect } from './base.js';
import { login } from './mock.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

test('upgrade and rollback preserve a saved channel and transformer', async ({ page }, testInfo) => {
    const phase = process.env.E2E_UPGRADE_PHASE;
    const stateFile = process.env.E2E_UPGRADE_STATE;
    test.skip(!phase || !stateFile || testInfo.project.name !== 'live', 'Owned upgrade rehearsal only');
    const appBase = new URL(process.env.E2E_BASE_URL!).pathname.replace(/\/$/, '');
    await page.goto(`${appBase}/`);
    await expect(page.getByRole('button', { name: 'Sign in' }).or(page.locator('.shell'))).toBeVisible();
    if (await page.getByRole('button', { name: 'Sign in' }).isVisible()) await login(page, 'admin', 'admin');
    await expect(page.locator('.shell')).toBeVisible();
    if (process.env.E2E_WEB_SUPPORT === '0') {
        await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
            .getByRole('button', { name: 'Close', exact: true }).last().click();
    }
    const config = await (await page.request.get(new URL(`${appBase}/webadmin/config.json`, page.url()).href)).json();
    expect(config.version).toBe(process.env.E2E_EXPECT_CLIENT_VERSION);
    if (process.env.E2E_EXPECT_DEPLOYMENT) expect(config.deployment).toBe(process.env.E2E_EXPECT_DEPLOYMENT);
    const baseline = existsSync(stateFile!) ? JSON.parse(readFileSync(stateFile!, 'utf8')) : null;
    const channel = await page.evaluate(async (baseline) => {
        const pkg = '@oie/web-api';
        const { default: api, newChannel } = await import(pkg);
        if (baseline) return api.channels.get(baseline.id);
        const channel = newChannel('Upgrade rollback sentinel', '4.6.0');
        channel.description = 'Preserve this configuration across client upgrades';
        channel.sourceConnector.transformer.elements = { 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
            '@version': '4.6.0', name: 'Persisted script', sequenceNumber: 0, enabled: true, script: 'channelMap.put("releaseSentinel", "kept");'
        } };
        await api.channels.create(channel);
        return api.channels.get(channel.id);
    }, baseline);
    if (!baseline) {
        expect(phase).toBe('baseline');
        writeFileSync(stateFile!, JSON.stringify(channel, null, 2) + '\n');
    } else expect(channel).toEqual(baseline);
    await testInfo.attach(`${phase}-persisted-channel`, { body: JSON.stringify(channel, null, 2), contentType: 'application/json' });
    await page.goto(`${appBase}/channels/${channel.id}/edit`);
    if (process.env.E2E_WEB_SUPPORT === '0') {
        await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
            .getByRole('button', { name: 'Close', exact: true }).last().click();
    }
    await expect(page.locator('.panel input[type=text]').first()).toHaveValue(channel.name);
});
