import { test, expect } from './base.js';
import { login } from './mock.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// The old client reads empty and literal "null" Java Strings as JSON null.
// Canonicalize only this sentinel's Raw batch scripts, using engine XML as the
// authority; every other channel field still participates in strict equality.
function canonicalUpgradeChannel({ channel, xml }: { channel: any; xml: string }) {
    const result = structuredClone(channel);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'channel') throw new Error('Invalid sentinel channel XML');
    const destinations = ([] as any[]).concat(result.destinationConnectors.connector);
    if (destinations.length !== 1) throw new Error('Expected one sentinel destination');
    const transformers = [
        [result.sourceConnector.transformer, 'sourceConnector > transformer'],
        [destinations[0].transformer, 'destinationConnectors > connector > transformer'],
        [destinations[0].responseTransformer, 'destinationConnectors > connector > responseTransformer'],
    ] as const;
    for (const [transformer, path] of transformers) for (const side of ['inboundProperties', 'outboundProperties']) {
        const batch = transformer[side].batchProperties;
        const nodes = doc.querySelectorAll(`channel > ${path} > ${side} > batchProperties > batchScript`);
        if (batch['@class'] !== 'com.mirth.connect.plugins.datatypes.raw.RawBatchProperties' || nodes.length !== 1
            || nodes[0].parentElement?.getAttribute('class') !== batch['@class']) throw new Error('Unexpected sentinel batch properties');
        const text = nodes[0].textContent!;
        if (batch.batchScript === null) batch.batchScript = text;
        else if (batch.batchScript !== text) throw new Error('Client batch script differs from engine XML');
    }
    return result;
}

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
    const snapshot = await page.evaluate(async (baseline) => {
        const pkg = '@oie/web-api';
        const { default: api, newChannel } = await import(pkg);
        let id = baseline?.id;
        if (!baseline) {
            const channel = newChannel('Upgrade rollback sentinel', '4.6.0');
            channel.description = 'Preserve this configuration across client upgrades';
            channel.sourceConnector.transformer.elements = { 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': '4.6.0', name: 'Persisted script', sequenceNumber: 0, enabled: true, script: 'channelMap.put("releaseSentinel", "kept");'
            } };
            // Keep both empty source and literal "null" in the upgrade contract.
            channel.sourceConnector.transformer.outboundProperties.batchProperties.batchScript = 'null';
            await api.channels.create(channel);
            id = channel.id;
        }
        return { channel: await api.channels.get(id), xml: await api.getXml(`/channels/${id}`) };
    }, baseline);
    await testInfo.attach(`${phase}-engine-channel`, { body: snapshot.xml, contentType: 'application/xml' });
    const channel = await page.evaluate(canonicalUpgradeChannel, snapshot);
    expect(channel.sourceConnector.transformer.inboundProperties.batchProperties.batchScript).toBe('');
    expect(channel.sourceConnector.transformer.outboundProperties.batchProperties.batchScript).toBe('null');
    if (!baseline) {
        expect(phase).toBe('baseline');
        writeFileSync(stateFile!, JSON.stringify(channel, null, 2) + '\n');
        writeFileSync(stateFile! + '.xml', snapshot.xml);
    } else {
        expect(snapshot.xml).toBe(readFileSync(stateFile! + '.xml', 'utf8'));
        expect(channel).toEqual(baseline);
    }
    await testInfo.attach(`${phase}-persisted-channel`, { body: JSON.stringify(channel, null, 2), contentType: 'application/json' });
    await page.goto(`${appBase}/channels/${channel.id}/edit`);
    if (process.env.E2E_WEB_SUPPORT === '0') {
        await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
            .getByRole('button', { name: 'Close', exact: true }).last().click();
    }
    await expect(page.locator('.panel input[type=text]').first()).toHaveValue(channel.name);
});
