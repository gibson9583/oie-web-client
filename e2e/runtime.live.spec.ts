import { test, expect } from './base.js';
import { login } from './mock.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const appBase = new URL(process.env.E2E_BASE_URL || 'http://localhost:3030').pathname.replace(/\/$/, '');
const owned = process.env.E2E_OWNED_ENGINE;

test('real engine preserves libraries, graph intents, filters and selected destination delivery', async ({ page }, testInfo) => {
    test.skip(!owned, 'Requires tools/engine-contract.py and its disposable engine/database');
    test.setTimeout(180_000);
    await page.goto(`${appBase}/`);
    await expect(page.getByRole('button', { name: 'Sign in' }).or(page.locator('.shell'))).toBeVisible();
    if (await page.getByRole('button', { name: 'Sign in' }).isVisible()) await login(page, 'admin', 'admin');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    if (process.env.E2E_WEB_SUPPORT === '0') {
        await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
            .getByRole('button', { name: 'Close', exact: true }).last().click();
    }
    const ids = await page.evaluate(async (name) => {
        const pkg = '@oie/web-api';
        const m = await import(pkg);
        const api = m.default;
        const channel = m.newChannel(name, '4.6.0');
        const prerequisite = m.newChannel(`${name} prerequisite`, '4.6.0');
        const scalarChannels = ['123', 'true', 'false', 'null', '001', '123\n', 'first\r\nsecond'].map((description, index) => ({
            ...m.newChannel(`${name} scalar ${index}`, '4.6.0'), description
        }));
        scalarChannels[0].sourceConnector.transformer.inboundTemplate = '123';
        scalarChannels[1].properties.attachmentProperties = { '@version': '4.6.0', type: 'Regex',
            className: 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider', properties: { entry: [
            { string: ['regex.pattern0', '(first)'] }, { string: ['regex.mimetype0', 'text/plain'] },
            { string: ['regex.pattern1', '(second)'] }, { string: ['regex.mimetype1', 'application/xml'] }
        ] } };
        const templateId = crypto.randomUUID(), libraryId = crypto.randomUUID(), groupId = crypto.randomUUID();
        (window as any).__contract = { api, channel, prerequisite, scalarChannels, templateId, libraryId, groupId };
        return { channelId: channel.id, prerequisiteId: prerequisite.id, scalarIds: scalarChannels.map((draft: any) => draft.id), templateId, libraryId, groupId };
    }, `Contract ${String(testInfo.config.metadata.runId).slice(-12)}`);
    let primaryFailure: unknown;
    try {
        const setup = await page.evaluate(async (base) => {
            const { api, channel, prerequisite, scalarChannels, templateId, libraryId, groupId } = (window as any).__contract;
            const v = '4.6.0';
            channel.sourceConnector.filter.elements = { 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': {
                '@version': v, name: 'Reject DROP', sequenceNumber: 0, enabled: true, operator: 'NONE', script: 'return String(msg) !== "DROP";'
            } };
            channel.sourceConnector.transformer.elements = { 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep': {
                '@version': v, name: 'Use shared library', sequenceNumber: 0, enabled: true,
                script: 'channelMap.put("releaseValue", releaseMarker(msg));'
            } };
            const dest = channel.destinationConnectors.connector[0];
            dest.transportName = 'JavaScript Writer';
            dest.properties = { '@class': 'com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', '@version': v,
                pluginProperties: null, destinationConnectorProperties: dest.properties.destinationConnectorProperties,
                script: 'return String(channelMap.get("releaseValue")) + ":" + String(sourceMap.get("releaseOrigin")) + ":" + String(sourceMap.get("spacing"));' };
            const second = structuredClone(dest); second.metaDataId = 2; second.name = '1e3';
            channel.destinationConnectors.connector.push(second); channel.nextMetaDataId = 3;
            const template = { '@version': v, id: templateId, name: 'releaseMarker', revision: 0,
                contextSet: { delegate: { contextType: ['SOURCE_FILTER_TRANSFORMER'] } },
                properties: { '@class': 'com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties', type: 'FUNCTION',
                    code: 'function releaseMarker(value) { return "DELIVERED:" + String(value); }' } };
            const library = { '@version': v, id: libraryId, name: 'Contract library', revision: 0, description: '',
                includeNewChannels: false, enabledChannelIds: '', disabledChannelIds: '',
                codeTemplates: { codeTemplate: [{ '@version': v, id: templateId }] } };
            const libraries = await api.codeTemplates.bulkUpdate([...(await api.codeTemplates.libraries()), library], [template], [], [], false);
            // Recover populated/cleared metadata and scalar-looking text through
            // the actual serializer, then resume the pending library stage.
            const saveModule = `${base}/core/channel-save.js`;
            const dependencyModule = `${base}/core/channel-dependencies.js`;
            const { channelEditState, saveChannelModel } = await import(saveModule);
            const { channelDependencyState, librarySelection, persistLibraryAssociations, libraryEnabledFor, hasLibraryChanges } = await import(dependencyModule);
            channel.properties.metaDataColumns = { metaDataColumn: [] };
            const recoveries = [];
            for (const draft of [prerequisite, channel, ...scalarChannels]) {
                channelEditState(draft, true);
                const pending = channelDependencyState(draft).libraries;
                pending.current = librarySelection(await api.codeTemplates.libraries(), draft.id);
                pending.current.checked.set(libraryId, true);
                const persist = async () => await saveChannelModel(draft, {
                    userId: 1, skipUnchanged: true, confirmConflict: async () => false
                }) && await persistLibraryAssociations(draft, pending, v);
                const create = api.channels.create;
                let createAttempts = 0;
                api.channels.create = async (model: any) => {
                    createAttempts++;
                    const result = await create(model);
                    if (createAttempts === 1) throw new Error('Synthetic lost creation receipt');
                    return result;
                };
                try {
                    try {
                        await persist();
                        throw new Error('Expected a lost creation receipt');
                    } catch (error: any) {
                        if (error.message !== 'Synthetic lost creation receipt') throw error;
                    }
                    const stored = await api.channels.get(draft.id);
                    const before = (await api.codeTemplates.libraries()).find((item: any) => item.id === libraryId);
                    const pendingAfterFailure = hasLibraryChanges(pending.current);
                    const enabledAfterFailure = libraryEnabledFor(before, draft.id);
                    const recovered = await persist();
                    const repeated = await persist();
                    const after = (await api.codeTemplates.libraries()).find((item: any) => item.id === libraryId);
                    recoveries.push({ columns: stored.properties.metaDataColumns, description: stored.description,
                        template: stored.sourceConnector.transformer.inboundTemplate, createAttempts, recovered, repeated,
                        pendingAfterFailure, enabledAfterFailure, pendingAfterRecovery: hasLibraryChanges(pending.current),
                        enabledAfterRecovery: libraryEnabledFor(after, draft.id) });
                } finally { api.channels.create = create; }
            }
            const groups = await api.channelGroups.bulkUpdate([...(await api.channelGroups.list()), {
                '@version': v, id: groupId, name: 'Contract group', revision: 0, description: '',
                channels: { channel: [{ '@version': v, id: channel.id }] }
            }], [], false);
            return { recoveries, libraries, groups, readLibraries: await api.codeTemplates.libraries(), readGroups: await api.channelGroups.list() };
        }, appBase);
        await testInfo.attach('setup-results', { body: JSON.stringify(setup, null, 2), contentType: 'application/json' });
        expect(String(setup.libraries.librariesSuccess)).toBe('true');
        expect(String(setup.libraries.overrideNeeded)).toBe('false');
        expect(String(setup.groups)).toBe('true');
        expect(setup.recoveries[0].columns).toBeTruthy();
        expect(setup.recoveries[1].columns).toBeNull();
        expect(setup.recoveries.slice(2).map(item => item.description)).toEqual([123, true, false, null, '001', '123\n', 'first\nsecond']);
        expect(setup.recoveries[2].template).toBe('123');
        for (const recovery of setup.recoveries) {
            expect(recovery).toMatchObject({ createAttempts: 1, recovered: true, repeated: true,
                pendingAfterFailure: true, enabledAfterFailure: false,
                pendingAfterRecovery: false, enabledAfterRecovery: true });
        }
        expect(JSON.stringify(setup.readLibraries)).toContain('function releaseMarker');
        expect(JSON.stringify(setup.readGroups)).toContain(ids.channelId);

        const conflict = await page.evaluate(async () => {
            const { api, libraryId } = (window as any).__contract;
            const original = await api.codeTemplates.libraries();
            const current = structuredClone(original);
            current.find((library: any) => library.id === libraryId).description = 'Another administrator saved this';
            const accepted = await api.codeTemplates.bulkUpdate(current, [], [], [], false);
            original.find((library: any) => library.id === libraryId).description = 'Stale overwrite';
            const rejected = await api.codeTemplates.bulkUpdate(original, [], [], [], false);
            return { accepted, rejected, stored: (await api.codeTemplates.libraries()).find((library: any) => library.id === libraryId) };
        });
        expect(String(conflict.accepted.librariesSuccess)).toBe('true');
        expect(String(conflict.rejected.overrideNeeded)).toBe('true');
        expect(conflict.stored.description).toBe('Another administrator saved this');

        const graph = await page.evaluate(async (base) => {
            const { api, channel, prerequisite } = (window as any).__contract;
            const dependencyModule = `${base}/core/channel-dependencies.js`;
            const { saveDependencyChanges } = await import(dependencyModule);
            const edge = { dependentId: channel.id, dependencyId: prerequisite.id };
            const first = await saveDependencyChanges([edge], []);
            const retry = await saveDependencyChanges([edge], []);
            let cycleRejected = false;
            try { await saveDependencyChanges([{ dependentId: prerequisite.id, dependencyId: channel.id }], []); }
            catch { cycleRejected = true; }
            return { first, retry, cycleRejected, stored: await api.server.channelDependencies() };
        }, appBase);
        expect(graph.first).toEqual([{ dependentId: ids.channelId, dependencyId: ids.prerequisiteId }]);
        expect(graph.retry).toEqual(graph.first);
        expect(graph.cycleRejected).toBe(true);
        expect(graph.stored).toEqual(graph.first);

        const sent = await page.evaluate(async () => {
            const { api, channel, prerequisite } = (window as any).__contract;
            const deployments = [await api.engine.deploy(prerequisite.id), await api.engine.deploy(channel.id)];
            const messageIds = [
                await api.messages.processNew(channel.id, 'ACCEPT', null, ['releaseOrigin=paired', 'spacing= value=kept ']),
                await api.messages.processNew(channel.id, 'ACCEPT', [2], ['releaseOrigin=paired', 'spacing= value=kept ']),
                await api.messages.processNew(channel.id, 'DROP', [1, 2], ['releaseOrigin=paired', 'spacing= value=kept ']),
                await api.messages.processNew(channel.id, 'ACCEPT', [], ['releaseOrigin=paired', 'spacing= value=kept '])
            ];
            return { deployments, messageIds };
        });
        await testInfo.attach('deploy-results', { body: JSON.stringify(sent, null, 2), contentType: 'application/json' });
        // Exercise the actual Swing Client overload on the very same channel.
        const engine = path.join(owned!, 'oie');
        const jars = readdirSync(engine, { recursive: true, withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.jar'))
            .map(entry => path.join(entry.parentPath, entry.name));
        const sendSwing = async () => {
            const swing = await promisify(execFile)(process.env.E2E_JAVA || 'java', ['--class-path', jars.join(path.delimiter),
                path.resolve('tools/SwingMessageContract.java'), process.env.E2E_ENGINE_URL!, ids.channelId], { timeout: 60_000, maxBuffer: 1024 * 1024 });
            await testInfo.attach('swing-client-contract', { body: swing.stdout + swing.stderr, contentType: 'text/plain' });
            const swingIds = swing.stdout.match(/SWING_MESSAGE_IDS=(\d+),(\d+)/);
            expect(swingIds).not.toBeNull();
            return [swingIds![1], swingIds![2]];
        };
        const swingIds = await sendSwing();
        const readOutcomes = (ids: any[]) => page.evaluate(async (messageIds) => {
            const { api, channel } = (window as any).__contract;
            const outcomes: Array<Array<{ metaDataId: number; status: string; response: string }>> = [];
            for (const id of messageIds) {
                const message = await api.messages.get(channel.id, id);
                const entries = api.asList(message.connectorMessages, 'entry');
                outcomes.push(entries.map((entry: any) => {
                    const value: any = Object.entries(entry).find(([key]) => key !== 'int')?.[1];
                    return { metaDataId: Number(entry.int), status: value.status,
                        response: value.response?.content ?? '' };
                }).sort((a: any, b: any) => a.metaDataId - b.metaDataId));
            }
            return outcomes;
        }, ids);
        const outcomes = await readOutcomes([...sent.messageIds, ...swingIds]);
        await testInfo.attach('engine-message-outcomes', { body: JSON.stringify(outcomes, null, 2), contentType: 'application/json' });
        expect(outcomes[0].map(item => item.metaDataId)).toEqual([0, 1, 2]);
        expect(outcomes[1].map(item => item.metaDataId)).toEqual([0, 2]);
        expect(outcomes[2].map(item => item.status)).toEqual(['FILTERED']);
        expect(outcomes[3].map(item => item.metaDataId)).toEqual([0]);
        expect(outcomes[0].filter(item => item.metaDataId).map(item => item.status)).toEqual(['SENT', 'SENT']);
        expect(outcomes[0].filter(item => item.metaDataId).map(item => item.response)).toEqual([
            expect.stringContaining('<message>DELIVERED:ACCEPT:paired: value=kept </message>'),
            expect.stringContaining('<message>DELIVERED:ACCEPT:paired: value=kept </message>')
        ]);
        expect(outcomes[4]).toEqual(outcomes[0]);
        expect(outcomes[5]).toEqual(outcomes[1]);

        // A saved deletion must not hide a destination that remains deployed.
        // XML discovery also preserves the scalar-looking deployed name exactly.
        const beforeDrift = await page.evaluate(async () => {
            const { api, channel } = (window as any).__contract;
            const originalXml = await api.getXml(`/channels/${channel.id}`);
            const original = await api.channels.get(channel.id);
            const changed = structuredClone(original);
            changed.destinationConnectors = { connector: api.asList(changed.destinationConnectors, 'connector')
                .filter((destination: any) => Number(destination.metaDataId) !== 2) };
            await api.channels.update(channel.id, changed);
            return { originalXml, savedNames: await api.channels.connectorNames(channel.id), deployed: await api.status.one(channel.id) };
        });
        await testInfo.attach('saved-deployed-destination-drift', { body: JSON.stringify(beforeDrift, null, 2), contentType: 'application/json' });
        expect(JSON.stringify(beforeDrift.savedNames)).not.toContain('1e3');
        // Open with two destinations, then redeploy with a third while the
        // dialog is open. All checked must still mean all *current* destinations,
        // exactly as Swing's null RawMessage selection does.
        await page.route('**/vendor/monaco/**', route => route.abort());
        const initialDiscovery = page.waitForResponse(response => response.url().includes(`/channels/${ids.channelId}/connectorNames`) && response.status() === 200);
        await page.goto(`${appBase}/messages/${ids.channelId}`);
        await initialDiscovery;
        // Deny message-view discovery while keeping real dashboard status and
        // processing responses, as for a dashboard-only process operator.
        await page.route(`**/channels/${ids.channelId}/connectorNames*`, route => route.fulfill({ status: 403, body: 'View Messages not granted' }));
        if (process.env.E2E_WEB_SUPPORT === '0') {
            await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
                .getByRole('button', { name: 'Close', exact: true }).last().click();
        }
        await page.getByRole('button', { name: 'Send Message', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Message', exact: true });
        await expect(dialog.getByRole('checkbox')).toHaveCount(2);
        await expect(dialog.getByRole('cell', { name: '1e3', exact: true })).toBeVisible();
        await page.evaluate(async ({ id, xml }) => {
            const pkg = '@oie/web-api';
            const api = (await import(pkg)).default;
            await api.putXml(`/channels/${id}`, xml, { override: true });
        }, { id: ids.channelId, xml: beforeDrift.originalXml });
        await dialog.locator('textarea.ce-area').fill('ACCEPT');
        for (const [key, value] of [['releaseOrigin', 'paired'], ['spacing', ' value=kept ']]) {
            await dialog.getByRole('button', { name: 'New', exact: true }).click();
            const inputs = dialog.locator('tbody').last().locator('tr').last().locator('input');
            await inputs.nth(0).fill(key);
            await inputs.nth(1).fill(value);
        }
        await page.evaluate(async (id) => {
            const pkg = '@oie/web-api';
            const api = (await import(pkg)).default;
            const channel = await api.channels.get(id);
            const destinations = api.asList(channel.destinationConnectors, 'connector');
            const third = structuredClone(destinations[0]); third.metaDataId = 3; third.name = 'Destination 3';
            channel.destinationConnectors = { connector: [...destinations, third] };
            channel.nextMetaDataId = 4;
            await api.channels.update(id, channel);
            await api.engine.deploy(id);
            (window as any).__contract = { api, channel };
        }, ids.channelId);
        const response = page.waitForResponse(response => response.request().method() === 'POST'
            && response.url().includes(`/channels/${ids.channelId}/messagesWithObj`));
        await dialog.getByRole('button', { name: 'Process Message', exact: true }).click();
        const sentAfterRedeploy = await response;
        expect(sentAfterRedeploy.status()).toBe(201);
        const messageId = (await sentAfterRedeploy.json()).long;
        const laterSwingIds = await sendSwing();
        const redeployed = await readOutcomes([messageId, ...laterSwingIds]);
        await testInfo.attach('redeployed-message-outcomes', { body: JSON.stringify(redeployed, null, 2), contentType: 'application/json' });
        expect(redeployed[0].map(item => item.metaDataId)).toEqual([0, 1, 2, 3]);
        expect(redeployed[0]).toEqual(redeployed[1]);
        expect(redeployed[2].map(item => item.metaDataId)).toEqual([0, 2]);

        // A fresh browser without this user's session must not read or delete
        // the owned channel. This validates engine enforcement through each host.
        const anonymous = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true });
        try {
            const apiBase = await page.locator('meta[name="oie-webadmin-api-base"]').getAttribute('content') || '/api';
            const url = new URL(`${apiBase}/channels/${ids.channelId}`, page.url()).href;
            const options = { headers: { 'X-Requested-With': 'OpenAPI', 'X-OIE-Context': encodeURIComponent(JSON.stringify(['', '', ''])) } };
            expect((await anonymous.request.get(url, options)).status()).toBe(401);
            expect((await anonymous.request.delete(url, options)).status()).toBe(401);
        } finally { await anonymous.close(); }
        expect(await page.evaluate(async (id) => (await (window as any).__contract.api.channels.get(id)).id, ids.channelId)).toBe(ids.channelId);
    } catch (error) {
        primaryFailure = error;
    } finally {
        const cleanup = await page.evaluate(async ({ ids, base }) => {
            const pkg = '@oie/web-api';
            const api = (await import(pkg)).default;
            const errors: string[] = [];
            const attempt = async (label: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { errors.push(`${label}: ${error}`); } };
            const dependencyModule = `${base}/core/channel-dependencies.js`;
            const { saveDependencyChanges } = await import(dependencyModule);
            await attempt('dependencies', () => saveDependencyChanges([], [{ dependentId: ids.channelId, dependencyId: ids.prerequisiteId }]));
            const existing = new Set((await api.channels.list()).map((channel: any) => channel.id));
            const deployed = new Set((await api.status.list()).map((status: any) => status.channelId));
            for (const id of [ids.channelId, ids.prerequisiteId, ...ids.scalarIds]) {
                if (deployed.has(id)) await attempt('undeploy ' + id, () => api.engine.undeploy(id));
                if (existing.has(id)) await attempt('remove ' + id, () => api.channels.remove(id));
            }
            await attempt('libraries', async () => api.codeTemplates.bulkUpdate((await api.codeTemplates.libraries()).filter((lib: any) => lib.id !== ids.libraryId), [], [ids.libraryId], [ids.templateId], false));
            await attempt('groups', async () => api.channelGroups.bulkUpdate((await api.channelGroups.list()).filter((group: any) => group.id !== ids.groupId), [ids.groupId], false));
            return errors;
        }, { ids, base: appBase });
        if (cleanup.length) throw new AggregateError([primaryFailure, ...cleanup], 'Live contract cleanup failed');
    }
    if (primaryFailure) throw primaryFailure;
});

test('real engine preserves global script text and stages imports until Save', async ({ page }, testInfo) => {
    test.skip(!owned, 'Requires tools/engine-contract.py and its disposable engine/database');
    await page.route('**/vendor/monaco/**', route => route.abort());
    await page.goto(`${appBase}/`);
    await expect(page.getByRole('button', { name: 'Sign in' }).or(page.locator('.shell'))).toBeVisible();
    if (await page.getByRole('button', { name: 'Sign in' }).isVisible()) await login(page, 'admin', 'admin');
    await expect(page.locator('.shell')).toBeVisible({ timeout: 15_000 });
    const dismissMissingSupport = async () => {
        if (process.env.E2E_WEB_SUPPORT === '0') {
            await page.getByRole('dialog', { name: 'Warning', exact: true }).filter({ hasText: 'Web Support plugin is not installed' })
                .getByRole('button', { name: 'Close', exact: true }).last().click();
        }
    };
    await dismissMissingSupport();
    const original = await page.evaluate(async () => {
        const pkg = '@oie/web-api';
        return (await import(pkg)).default.getXml('/server/globalScripts');
    });
    const keys = ['Deploy', 'Undeploy', 'Preprocessor', 'Postprocessor'];
    const values = ['123', 'false', 'return message;', 'null'];
    const xml = `<map>${keys.map((key, index) => `<entry><string>${key}</string><string>${values[index]}</string></entry>`).join('')}</map>`;
    try {
        await page.evaluate(async (body) => {
            const pkg = '@oie/web-api';
            await (await import(pkg)).default.putXml('/server/globalScripts', body);
        }, xml);
        await page.goto(`${appBase}/global-scripts`);
        await dismissMissingSupport();
        for (let index = 0; index < keys.length; index++) {
            await page.getByRole('tab', { name: keys[index], exact: true }).click();
            await expect(page.locator('textarea.ce-area').nth(index)).toHaveValue(values[index]);
        }
        const before = await page.evaluate(async () => {
            const pkg = '@oie/web-api';
            return (await import(pkg)).default.getXml('/server/globalScripts');
        });
        let writes = 0;
        page.on('request', request => {
            if (request.method() === 'PUT' && new URL(request.url()).pathname.endsWith('/server/globalScripts')) writes++;
        });
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Import Scripts', exact: true }).click();
        await (await chooser).setFiles({ name: 'globalScripts.xml', mimeType: 'application/xml',
            buffer: Buffer.from('<map><entry><string>Deploy</string><string>1e3</string></entry></map>') });
        await page.getByRole('dialog', { name: 'Import Scripts', exact: true })
            .getByRole('button', { name: 'Import', exact: true }).click();
        await page.getByRole('tab', { name: 'Deploy', exact: true }).click();
        const deploy = page.locator('textarea.ce-area').first();
        await expect(deploy).toHaveValue('1e3');
        await deploy.fill('true');
        const afterImport = await page.evaluate(async () => {
            const pkg = '@oie/web-api';
            return (await import(pkg)).default.getXml('/server/globalScripts');
        });
        expect(afterImport).toBe(before);
        expect(writes).toBe(0);
        if (process.env.E2E_WEB_SUPPORT === '0') {
            await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
            const error = page.getByRole('dialog', { name: 'Error', exact: true });
            await expect(error).toContainText('Validation unavailable');
            await error.getByRole('button', { name: 'Close', exact: true }).last().click();
            await expect(deploy).toHaveValue('true');
            await expect(page.getByRole('button', { name: 'Save Scripts', exact: true })).toBeVisible();
            expect(await page.evaluate(() => {
                const event = new Event('beforeunload', { cancelable: true });
                window.dispatchEvent(event);
                return event.defaultPrevented;
            })).toBe(true);
            const persisted = await page.evaluate(async () => {
                const pkg = '@oie/web-api';
                return (await import(pkg)).default.getXml('/server/globalScripts');
            });
            expect(persisted).toBe(before);
            expect(writes).toBe(0);
            await testInfo.attach('global-script-validation-unavailable', {
                body: JSON.stringify({ before, afterImport, persisted, writes, draft: await deploy.inputValue() }, null, 2),
                contentType: 'application/json',
            });
            return;
        }
        const saved = page.waitForResponse(response => response.request().method() === 'PUT'
            && new URL(response.url()).pathname.endsWith('/server/globalScripts'));
        await page.getByRole('button', { name: 'Save Scripts', exact: true }).click();
        expect((await saved).ok()).toBe(true);
        await expect(page.getByRole('button', { name: 'Save Scripts', exact: true })).toHaveCount(0);
        expect(writes).toBe(1);
        const persisted = await page.evaluate(async () => {
            const pkg = '@oie/web-api';
            return (await import(pkg)).default.getXml('/server/globalScripts');
        });
        await testInfo.attach('global-script-text-and-import', { body: JSON.stringify({ before, afterImport, persisted, writes }, null, 2), contentType: 'application/json' });
        await page.goto(`${appBase}/global-scripts`);
        await dismissMissingSupport();
        for (let index = 0; index < keys.length; index++) {
            await page.getByRole('tab', { name: keys[index], exact: true }).click();
            await expect(page.locator('textarea.ce-area').nth(index)).toHaveValue(index === 0 ? 'true' : values[index]);
        }
    } finally {
        await page.evaluate(async (body) => {
            const pkg = '@oie/web-api';
            await (await import(pkg)).default.putXml('/server/globalScripts', body);
        }, original);
    }
});
