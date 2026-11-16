import { test, expect } from './base.js';
import { login } from './mock.js';

const appBase = new URL(process.env.E2E_BASE_URL || 'http://localhost:3030').pathname.replace(/\/$/, '');

for (const surface of ['rail', 'context menu'] as const) {
    for (const source of [false, true]) {
        test(`real engine ${surface} removal preserves ${source ? 'source whole-message semantics' : 'source and sibling destinations'}`, async ({ page }, testInfo) => {
            test.skip(!process.env.E2E_OWNED_ENGINE, 'Requires a disposable engine owned by the contract runner');
            test.setTimeout(90_000);
            await page.goto(`${appBase}/`);
            await expect(page.getByRole('button', { name: 'Sign in' }).or(page.locator('.shell'))).toBeVisible();
            if (await page.getByRole('button', { name: 'Sign in' }).isVisible()) await login(page, 'admin', 'admin');
            await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
            if (process.env.E2E_WEB_SUPPORT === '0') {
                await page.getByRole('dialog', { name: 'Warning', exact: true })
                    .filter({ hasText: 'Web Support plugin is not installed' })
                    .getByRole('button', { name: 'Close', exact: true }).last().click();
            }
            const channelId = await page.evaluate(async name => {
                const pkg = '@oie/web-api';
                const m = await import(pkg);
                const api = m.default;
                const channel = m.newChannel(name, '4.6.0');
                const destination = channel.destinationConnectors.connector[0];
                destination.metaDataId = 7;
                destination.name = 'Destination Seven';
                destination.transportName = 'JavaScript Writer';
                destination.properties = {
                    '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', '@version': '4.6.0',
                    pluginProperties: null,
                    destinationConnectorProperties: destination.properties.destinationConnectorProperties,
                    script: 'return "Stored destination response";'
                };
                const second = structuredClone(destination);
                second.metaDataId = 2;
                second.name = 'Destination Two';
                channel.destinationConnectors.connector.push(second);
                channel.nextMetaDataId = 8;
                if (String(await api.channels.create(channel)) !== 'true') throw new Error('Channel creation failed');
                return channel.id;
            }, `Removal ${surface === 'rail' ? 'rail' : 'menu'} ${source ? 'src' : 'dest'} ${String(testInfo.config.metadata.runId).slice(-8)}`);
            const writes: Array<{ url: string; status?: number }> = [];
            page.on('response', response => {
                if (response.request().method() === 'DELETE' && response.url().includes(`/channels/${channelId}/messages/`)) {
                    writes.push({ url: response.url(), status: response.status() });
                }
            });
            try {
                const messageId = await page.evaluate(async id => {
                    const pkg = '@oie/web-api';
                    const api = (await import(pkg)).default;
                    await api.engine.deploy(id);
                    return api.messages.processNew(id, 'Retained source payload', null, []);
                }, channelId);
                const observations = () => page.evaluate(async ({ channelId, messageId }) => {
                    const pkg = '@oie/web-api';
                    const api = (await import(pkg)).default;
                    const rows = await api.messages.search(channelId, { minMessageId: messageId, maxMessageId: messageId, offset: 0, limit: 20 });
                    return rows.map((row: any) => ({ messageId: String(row.messageId), processed: row.processed,
                        connectorIds: api.asList(row.connectorMessages, 'entry').map((entry: any) => Number(entry.int)) }));
                }, { channelId, messageId });
                await expect.poll(observations).toEqual([{ messageId: String(messageId), processed: true, connectorIds: [0, 7, 2] }]);
                const before = await observations();
                await page.goto(`${appBase}/messages/${channelId}`);
                if (process.env.E2E_WEB_SUPPORT === '0') {
                    await page.getByRole('dialog', { name: 'Warning', exact: true })
                        .filter({ hasText: 'Web Support plugin is not installed' })
                        .getByRole('button', { name: 'Close', exact: true }).last().click();
                }
                await expect(page.locator('.msg-table tbody tr.child')).toHaveCount(2);
                const targetId = source ? 0 : surface === 'rail' ? 7 : 2;
                const row = source ? page.locator('.msg-table tbody tr:not(.child)').first()
                    : page.locator('.msg-table tbody tr.child').filter({ hasText: targetId === 7 ? 'Destination Seven' : 'Destination Two' });
                if (surface === 'rail') {
                    await row.click();
                    await page.getByRole('button', { name: 'Remove Message', exact: true }).click();
                } else {
                    await row.click({ button: 'right' });
                    await page.getByRole('menu').getByRole('menuitem', { name: 'Remove Message', exact: true }).click();
                }
                const confirmation = page.getByRole('dialog', { name: 'Remove message', exact: true });
                await expect(confirmation).toContainText(source ? 'all its destinations' : `ID ${targetId}`);
                const removed = page.waitForResponse(response => response.request().method() === 'DELETE'
                    && new URL(response.url()).pathname.endsWith(`/channels/${channelId}/messages/${messageId}`));
                await confirmation.getByRole('button', { name: 'Remove', exact: true }).click();
                const response = await removed;
                expect(response.ok()).toBe(true);
                expect(new URL(response.url()).searchParams.get('metaDataId')).toBe(String(targetId));
                const after = await observations();
                if (source) expect(after).toEqual([]);
                else {
                    expect(after).toEqual([{ messageId: String(messageId), processed: true,
                        connectorIds: targetId === 7 ? [0, 2] : [0, 7] }]);
                    // Repeating an already removed destination must remain a no-op.
                    await page.evaluate(async ({ channelId, messageId, targetId }) => {
                        const pkg = '@oie/web-api';
                        await (await import(pkg)).default.messages.remove(channelId, messageId, targetId);
                    }, { channelId, messageId, targetId });
                    expect(await observations()).toEqual(after);
                }
                await testInfo.attach('engine-removal-observations', {
                    body: JSON.stringify({ channelId, messageId, targetId, before, after, writes }, null, 2), contentType: 'application/json'
                });
            } finally {
                await page.evaluate(async id => {
                    const pkg = '@oie/web-api';
                    const api = (await import(pkg)).default;
                    await api.engine.undeploy(id);
                    await api.channels.remove(id);
                }, channelId);
            }
        });
    }
}
