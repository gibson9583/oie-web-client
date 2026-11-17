import { test, expect } from './base.js';
import { login } from './mock.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
                expect([...new URL(response.url()).searchParams.keys()]).toEqual(['metaDataId']);
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

for (const surface of ['rail', 'context menu'] as const) {
    test(`real engine ${surface} keeps an imported destination-only parent inactive`, async ({ page }, testInfo) => {
        test.skip(!process.env.E2E_OWNED_ENGINE, 'Requires a disposable engine owned by the contract runner');
        test.setTimeout(90_000);
        await page.goto(`${appBase}/`);
        await expect(page.getByRole('button', { name: 'Sign in' }).or(page.locator('.shell'))).toBeVisible();
        if (await page.getByRole('button', { name: 'Sign in' }).isVisible()) await login(page, 'admin', 'admin');
        await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
        const dismissWarning = async () => {
            if (process.env.E2E_WEB_SUPPORT === '0') {
                await page.getByRole('dialog', { name: 'Warning', exact: true })
                    .filter({ hasText: 'Web Support plugin is not installed' })
                    .getByRole('button', { name: 'Close', exact: true }).last().click();
            }
        };
        await dismissWarning();
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
        }, `Orphan ${surface === 'rail' ? 'rail' : 'menu'} ${String(testInfo.config.metadata.runId).slice(-8)}`);
        const writes: Array<{ url: string; status: number }> = [];
        page.on('response', response => {
            if (response.request().method() === 'DELETE' && response.url().includes(`/channels/${channelId}/messages/`)) {
                writes.push({ url: response.url(), status: response.status() });
            }
        });
        try {
            const originalId = await page.evaluate(async id => {
                const pkg = '@oie/web-api';
                const api = (await import(pkg)).default;
                await api.engine.deploy(id);
                return api.messages.processNew(id, 'Ordinary engine-generated source payload', null, []);
            }, channelId);
            const observations = (): Promise<Array<{ messageId: string; processed: boolean; connectorIds: number[] }>> => page.evaluate(async channelId => {
                const pkg = '@oie/web-api';
                const api = (await import(pkg)).default;
                const rows = await api.messages.search(channelId, { offset: 0, limit: 20 });
                return rows.map((row: any) => ({ messageId: String(row.messageId), processed: row.processed,
                    connectorIds: api.asList(row.connectorMessages, 'entry').map((entry: any) => Number(entry.int)) }));
            }, channelId);
            await expect.poll(observations).toEqual([{ messageId: String(originalId), processed: true, connectorIds: [0, 7, 2] }]);
            const rootFolder = path.join(process.env.E2E_OWNED_ENGINE!, 'orphan-export', testInfo.project.name, surface === 'rail' ? 'rail' : 'menu');
            const exportCount = await page.evaluate(async ({ channelId, originalId, rootFolder }) => {
                const pkg = '@oie/web-api';
                const api = (await import(pkg)).default;
                return api.post(`/channels/${channelId}/messages/_export`, null, { params: {
                    includedMetaDataId: [7, 2], minMessageId: originalId, maxMessageId: originalId,
                    rootFolder, filePattern: 'export.xml', pageSize: 100
                }, timeoutMs: null });
            }, { channelId, originalId, rootFolder });
            expect(Number(exportCount)).toBe(1);
            const exportPath = path.join(rootFolder, 'export.xml');
            const exportedBytes = await readFile(exportPath);
            const exportedXml = exportedBytes.toString('utf8');
            expect(exportedXml).toContain('<metaDataId>7</metaDataId>');
            expect(exportedXml).toContain('<metaDataId>2</metaDataId>');
            expect(exportedXml).not.toContain('<metaDataId>0</metaDataId>');
            await testInfo.attach('unmodified-engine-export.xml', { body: exportedBytes, contentType: 'application/xml' });
            const importResult = await page.evaluate(async ({ channelId, exportPath }) => {
                const pkg = '@oie/web-api';
                const api = (await import(pkg)).default;
                return api.post(`/channels/${channelId}/messages/_importFromPath`, exportPath, {
                    contentType: 'text/plain', params: { includeSubfolders: false }, timeoutMs: null
                });
            }, { channelId, exportPath });
            expect(Number(importResult.successCount)).toBe(1);
            expect(Number(importResult.totalCount)).toBe(1);
            expect(await readFile(exportPath)).toEqual(exportedBytes);
            const importedRows = (await observations()).filter(row => row.messageId !== String(originalId));
            expect(importedRows).toHaveLength(1);
            expect(importedRows[0]).toMatchObject({ processed: true, connectorIds: [7, 2] });
            const importedId = importedRows[0].messageId;
            const beforeRemove = await observations();
            await page.goto(`${appBase}/messages/${channelId}`);
            await dismissWarning();
            const parent = page.locator('.msg-table tbody tr:not(.child)').filter({
                has: page.getByRole('cell', { name: importedId, exact: true })
            });
            await expect(parent).toHaveCount(1);
            if (surface === 'rail') {
                await parent.click();
                await expect(page.getByRole('button', { name: 'Remove Message', exact: true })).toHaveCount(0);
            } else {
                await parent.click({ button: 'right' });
                const menu = page.getByRole('menu');
                await expect(menu).toBeVisible();
                await expect(menu.getByRole('menuitem', { name: 'Remove Message', exact: true })).toHaveCount(0);
                await page.keyboard.press('Escape');
            }
            await expect(page.getByRole('dialog', { name: 'Remove message', exact: true })).toHaveCount(0);
            expect(writes).toHaveLength(0);
            expect(await observations()).toEqual(beforeRemove);
            const child = parent.locator('xpath=following-sibling::tr[1]');
            await expect(child).toHaveClass(/child/);
            await expect(child).toContainText('Destination Seven');
            if (surface === 'rail') {
                await child.click();
                await page.getByRole('button', { name: 'Remove Message', exact: true }).click();
            } else {
                await child.click({ button: 'right' });
                await page.getByRole('menu').getByRole('menuitem', { name: 'Remove Message', exact: true }).click();
            }
            const confirmation = page.getByRole('dialog', { name: 'Remove message', exact: true });
            await expect(confirmation).toContainText(`ID 7) from message ${importedId}`);
            const removed = page.waitForResponse(response => response.request().method() === 'DELETE'
                && new URL(response.url()).pathname.endsWith(`/channels/${channelId}/messages/${importedId}`));
            await confirmation.getByRole('button', { name: 'Remove', exact: true }).click();
            const response = await removed;
            expect(response.status()).toBe(204);
            expect([...new URL(response.url()).searchParams.entries()]).toEqual([['metaDataId', '7']]);
            const afterRemove = await observations();
            expect(afterRemove).toEqual(beforeRemove.map(row => row.messageId === importedId ? { ...row, connectorIds: [2] } : row));
            await testInfo.attach('destination-only-removal-observations', {
                body: JSON.stringify({ channelId, originalId, importedId, rootFolder, exportPath, exportCount,
                    exportedSha256: createHash('sha256').update(exportedBytes).digest('hex'),
                    importResult, beforeRemove, afterRemove, writes }, null, 2), contentType: 'application/json'
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
