import { test, expect } from './base.js';
import { login } from './mock.js';

const appBase = new URL(process.env.E2E_BASE_URL || 'http://localhost:3030').pathname.replace(/\/$/, '');
const patients: Record<number, string> = {
    0: '9007199254740993',
    7: 'Destination +7 / patient?x=1&y=2',
    2: 'Destination &2=patient'
};

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
            const channelId = await page.evaluate(async ({ name, patients }) => {
                const pkg = '@oie/web-api';
                const m = await import(pkg);
                const api = m.default;
                const channel = m.newChannel(name, '4.6.0');
                channel.properties.metaDataColumns.metaDataColumn.push({
                    name: 'PATIENT_ID', type: 'STRING', mappingName: 'removal_patient'
                });
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
                for (const connector of channel.destinationConnectors.connector) {
                    connector.transformer.elements = {
                        'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                            '@version': '4.6.0', name: 'Select audit patient', sequenceNumber: 0, enabled: true,
                            script: `connectorMap.put("removal_patient", ${JSON.stringify(patients[connector.metaDataId])});`
                        }
                    };
                }
                channel.nextMetaDataId = 8;
                if (String(await api.channels.create(channel)) !== 'true') throw new Error('Channel creation failed');
                return channel.id;
            }, { name: `Removal ${surface === 'rail' ? 'rail' : 'menu'} ${source ? 'src' : 'dest'} ${String(testInfo.config.metadata.runId).slice(-8)}`, patients });
            const writes: Array<{ url: string; status?: number }> = [];
            page.on('response', response => {
                if (response.request().method() === 'DELETE' && response.url().includes(`/channels/${channelId}/messages/`)) {
                    writes.push({ url: response.url(), status: response.status() });
                }
            });
            try {
                const messageId = await page.evaluate(async ({ id, patientId }) => {
                    const pkg = '@oie/web-api';
                    const api = (await import(pkg)).default;
                    await api.engine.deploy(id);
                    return api.messages.processNew(id, 'Retained source payload', null, [`removal_patient=${patientId}`]);
                }, { id: channelId, patientId: patients[0] });
                const observations = () => page.evaluate(async ({ channelId, messageId }) => {
                    const pkg = '@oie/web-api';
                    const m = await import(pkg);
                    const api = m.default;
                    const rows = await api.messages.search(channelId, { minMessageId: messageId, maxMessageId: messageId, offset: 0, limit: 20 });
                    return rows.map((row: any) => ({ messageId: String(row.messageId), processed: row.processed,
                        connectorIds: api.asList(row.connectorMessages, 'entry').map((entry: any) => Number(entry.int)),
                        patients: Object.fromEntries(api.asList(row.connectorMessages, 'entry').map((entry: any) => {
                            const connector: any = Object.entries(entry).find(([key]) => key !== 'int')?.[1];
                            return [String(entry.int), Object.fromEntries(m.mappingEntries(connector.metaDataMap)).PATIENT_ID];
                        })) }));
                }, { channelId, messageId });
                await expect.poll(observations).toEqual([{ messageId: String(messageId), processed: true, connectorIds: [0, 7, 2], patients }]);
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
                const patientId = patients[targetId];
                expect(new URL(response.url()).searchParams.get('patientId')).toBe(patientId);
                const audit = () => page.evaluate(async channelId => {
                    const pkg = '@oie/web-api';
                    const m = await import(pkg);
                    // Derby's attribute filter matches the start of an XML
                    // string value; the channel attribute starts with Channel[id=.
                    const events = await m.get('/events', {
                        name: 'Remove message', attributeSearch: `Channel[id=${channelId}`, offset: 0, limit: 20
                    });
                    return m.default.asList(events, 'event').map((event: any) => ({ id: event.id, name: event.name, outcome: event.outcome,
                        attributes: Object.fromEntries(m.mappingEntries(event.attributes)) }));
                }, channelId);
                await expect.poll(audit, { timeout: 15_000 }).toEqual([expect.objectContaining({
                    name: 'Remove message', outcome: 'SUCCESS', attributes: expect.objectContaining({
                        messageId: `${messageId}\n`, metaDataId: `${targetId}\n`, patientId: `${patientId}\n`
                    })
                })]);
                const removalAudit = await audit();
                const after = await observations();
                if (source) expect(after).toEqual([]);
                else {
                    expect(after).toEqual([{ messageId: String(messageId), processed: true,
                        connectorIds: targetId === 7 ? [0, 2] : [0, 7],
                        patients: { 0: patients[0], [targetId === 7 ? 2 : 7]: patients[targetId === 7 ? 2 : 7] } }]);
                    // Repeating an already removed destination must remain a no-op.
                    await page.evaluate(async ({ channelId, messageId, targetId, patientId }) => {
                        const pkg = '@oie/web-api';
                        await (await import(pkg)).default.messages.remove(channelId, messageId, targetId, patientId);
                    }, { channelId, messageId, targetId, patientId });
                    expect(await observations()).toEqual(after);
                }
                await testInfo.attach('engine-removal-observations', {
                    body: JSON.stringify({ channelId, messageId, targetId, patientId, before, after, writes, removalAudit }, null, 2), contentType: 'application/json'
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
