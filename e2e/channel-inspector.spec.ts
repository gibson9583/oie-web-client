import { test, expect } from './base.js';
import { mockEngine, fixtureXml as xml } from './mock.js';
import AxeBuilder from '@axe-core/playwright';

/*
 * The channel editor's read-only Inspector tab: the channel described in
 * engine order, destination chains, find, map-key links and the Channels
 * "Inspect Channel" entry point.
 */

const ID = 'inspect-channel';
const V = '4.6.0';
const MAPPER = 'com.mirth.connect.plugins.mapper.MapperStep';
const JS_STEP = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const RULE = 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
const queue = (extra = {}) => ({ '@version': V, queueEnabled: false, sendFirst: false, retryIntervalMillis: 10000, retryCount: 0, rotate: false, threadCount: 1, validateResponse: false, ...extra });
const transformer = (elements: any = '') => ({ '@version': V, elements, inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', inboundProperties: null, outboundProperties: null });
const tcpSender = (metaDataId: number, name: string, extra: any = {}) => ({
    '@version': V, metaDataId, name, transportName: 'TCP Sender', mode: 'DESTINATION', enabled: true, waitForPrevious: true,
    properties: {
        '@class': 'com.mirth.connect.connectors.tcp.TcpDispatcherProperties', '@version': V,
        remoteAddress: 'ehr.example', remotePort: '2575', serverMode: false, keepConnectionOpen: true,
        transmissionModeProperties: { pluginPointName: 'MLLP' },
        destinationConnectorProperties: queue()
    },
    filter: { '@version': V, elements: '' }, transformer: transformer(), responseTransformer: transformer(),
    ...extra
});

const CHANNEL: any = {
    '@version': V, id: ID, nextMetaDataId: 4, name: 'Lab results', revision: 12,
    description: 'Normalizes lab results for clinical storage and EHR delivery.',
    sourceConnector: {
        '@version': V, metaDataId: 0, name: 'sourceConnector', transportName: 'TCP Listener', mode: 'SOURCE', enabled: true, waitForPrevious: true,
        properties: {
            '@class': 'com.mirth.connect.connectors.tcp.TcpReceiverProperties', '@version': V,
            listenerConnectorProperties: { host: '0.0.0.0', port: '6663' }, serverMode: true,
            transmissionModeProperties: { pluginPointName: 'MLLP' },
            sourceConnectorProperties: { '@version': V, responseVariable: 'd2', respondAfterProcessing: true, processBatch: false, processingThreads: 1 }
        },
        filter: { '@version': V, elements: { [RULE]: { '@version': V, name: 'Results only', sequenceNumber: '0', enabled: true, operator: 'NONE', field: "msg['MSH']['MSH.9']['MSH.9.1']", condition: 'EQUALS', values: { string: "'ORU'" } } } },
        transformer: transformer({
            [MAPPER]: { '@version': V, name: 'Read facility', sequenceNumber: '0', enabled: true, variable: 'facility', mapping: "msg['MSH']['MSH.4']", scope: 'CHANNEL' },
            [JS_STEP]: { '@version': V, name: 'Route training', sequenceNumber: '1', enabled: true, script: "if ($c('facility') == 'TRAINING') destinationSet.remove(3);\nvar t = $g('alertThreshold');" }
        })
    },
    destinationConnectors: { connector: [
        tcpSender(1, 'Clinical store', { waitForPrevious: false }),
        tcpSender(2, 'EHR delivery'),
        tcpSender(3, 'Analytics API', { waitForPrevious: false, properties: { '@class': 'com.mirth.connect.connectors.http.HttpDispatcherProperties', '@version': V, host: 'https://analytics.example/results', method: 'post', destinationConnectorProperties: queue({ queueEnabled: true, sendFirst: true, retryIntervalMillis: 60000 }) }, transportName: 'HTTP Sender' }),
        tcpSender(4, 'Legacy archive', { enabled: false })
    ] },
    preprocessingScript: '// Modify the message variable below to pre process data\nreturn message;',
    postprocessingScript: '// This script executes once after a message has been processed\nreturn;',
    deployScript: '// deploy\nreturn;',
    undeployScript: '// undeploy\nreturn;',
    properties: {
        '@version': V, messageStorageMode: 'PRODUCTION', encryptData: false, removeContentOnCompletion: false, initialState: 'STARTED',
        attachmentProperties: { '@version': V, type: 'None', properties: null },
        metaDataColumns: { metaDataColumn: [{ name: 'SOURCE', type: 'STRING', mappingName: 'mirth_source' }] }
    },
    exportData: { metadata: { enabled: true, lastModified: { time: 1700000000000, timezone: 'UTC' }, pruningSettings: { pruneMetaDataDays: 90, archiveEnabled: true } } }
};

test.describe('Channel Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel: CHANNEL } });
    });

    test('opens as the first editor tab and reads in engine order', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const tabs = page.getByRole('tablist', { name: 'Channel sections' }).getByRole('tab');
        await expect(tabs.first()).toHaveText('Inspector');
        await expect(page.getByRole('tab', { name: 'Inspector', exact: true })).toHaveAttribute('aria-selected', 'true');

        await expect(page.getByText('Normalizes lab results for clinical storage and EHR delivery.')).toBeVisible();
        const sections = page.locator('.ci-section h4');
        await expect(sections).toHaveText([
            'Receive HL7 v2.x over TCP Listener', 'Preprocess the raw message', 'Accept or filter the message',
            'Transform the HL7 v2.x message', 'Send to destinations', 'Postprocess', 'Respond to the sender',
            'Retry queued sends', 'Store and prune messages', 'Maps and variables'
        ]);
        // Default scripts count as no code.
        await expect(page.locator('#ci-preprocess')).toHaveClass(/empty/);

        // Chains follow waitForPrevious; disabled destinations are separate.
        const map = page.getByLabel('Chain map');
        await expect(map.locator('.ci-chain-row')).toHaveText([/Chain 1\s*D1\s*Clinical store\s*D2\s*EHR delivery/, /Chain 2\s*D3\s*Analytics API/, /Disabled\s*D4\s*Legacy archive/]);
        await expect(page.getByText('D2 waits for D1 to finish.', { exact: false })).toBeVisible();
        await expect(page.locator('#ci-respond')).toContainText('The sender gets the response from D2 EHR delivery.');
        await expect(page.locator('#ci-queue')).toContainText('D3 · Analytics API');
        await expect(page.locator('#ci-receive')).toContainText('0.0.0.0:6663');
        await expect(page.getByText('can remove destinations for each message', { exact: false })).toBeVisible();
    });

    test('finds text, follows map keys and opens editor tabs', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const route = page.locator('details.ci-item', { hasText: 'Route training' });
        await expect(route).not.toHaveAttribute('open', '');

        await page.getByPlaceholder('Find in channel').fill('destinationSet');
        await expect(route).toHaveAttribute('open', '');
        await expect(route.locator('.ci-code')).toContainText("destinationSet.remove(3)");
        await expect(page.locator('.ci-count')).toHaveText('1 of 1');

        // A key read with no writer in the channel is flagged.
        await route.getByRole('button', { name: /reads alertThreshold/ }).click();
        const row = page.locator('#ci-key-globalMap\\.alertThreshold');
        await expect(row).toHaveClass(/target/);
        await expect(row).toContainText('No writer in this channel.');
        await expect(page.locator('#ci-key-channelMap\\.facility')).toContainText('Source transformer · Read facility');

        await page.locator('#ci-filter').getByRole('button', { name: 'Open in Source' }).click();
        await expect(page.getByRole('tab', { name: 'Source', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('the editor still opens on Summary without the tab parameter', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit`);
        await expect(page.getByRole('tab', { name: 'Summary', exact: true })).toHaveAttribute('aria-selected', 'true');
    });

    test('Channels offers Inspect Channel for one selected channel', async ({ page }) => {
        await page.goto('/channels');
        await expect(page.getByRole('button', { name: 'Inspect Channel', exact: true })).toHaveCount(0);
        await page.getByText('Demo Stopped', { exact: true }).click();
        await page.getByRole('button', { name: 'Inspect Channel', exact: true }).click();
        await expect(page).toHaveURL(/\/channels\/c-stopped\/edit\?tab=Inspector$/);
    });

    test('includes exact global script text, toggles it, and retries failed reads', async ({ page }) => {
        let attempts = 0;
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            'GET /server/globalScripts': () => ++attempts === 1 ? { __status: 503 } : { map: { entry: [
                { string: ['Deploy', 'return;'] }, { string: ['Undeploy', 'return;'] },
                { string: ['Preprocessor', '123'] }, { string: ['Postprocessor', "globalMap.put('completed', true);"] }
            ] } },
            [`GET /channels/${ID}/status`]: { dashboardStatus: { channelId: ID, state: 'STARTED', deployedRevisionDelta: 1 } }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Global scripts could not be loaded.', { exact: false })).toBeVisible();
        await expect(page.getByText('Latest saved channel is 1 revision ahead of deployed.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Retry global scripts' }).click();
        const global = page.locator('.ci-item', { hasText: 'Global preprocessor' });
        await global.locator('summary').click();
        await expect(global.locator('.lc')).toHaveText('123');
        await expect(page.locator('#ci-key-globalMap\\.completed')).toContainText('Global postprocessor');
        await page.getByLabel('Include global scripts').uncheck();
        await expect(global).toHaveCount(0);
        await expect(page.locator('#ci-key-globalMap\\.completed')).toHaveCount(0);
        await expect(page.getByText('Global scripts excluded.')).toBeVisible();
    });

    test('distinguishes undeployed channels from denied status reads and can refresh', async ({ page }) => {
        let reads = 0;
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            [`GET /channels/${ID}/status`]: () => ++reads === 1 ? { __status: 404 }
                : reads === 2 ? { __status: 403 }
                : { dashboardStatus: { channelId: ID, state: 'STOPPED', deployedRevisionDelta: 2 } }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Channel is not deployed.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Refresh status' }).click();
        await expect(page.getByText('Deployment status unavailable.', { exact: false })).toBeVisible();
        await page.getByRole('button', { name: 'Refresh status' }).click();
        await expect(page.getByText('Latest saved channel is 2 revisions ahead of deployed.', { exact: false })).toBeVisible();
    });

    test('includes JavaScript bodies serialized as JSON primitives in the story and print', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const values = ['false', 'true', '123', 'null', ''];
        const elements = values.map((script, sequenceNumber) => ({ '@version': V, name: `Literal ${script}`, sequenceNumber, enabled: true, operator: 'AND', script }));
        channel.sourceConnector.filter.elements = { 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule': elements };
        channel.sourceConnector.transformer.elements = { [JS_STEP]: elements };
        channel.deployScript = 'null';
        channel.undeployScript = '';
        const wire = structuredClone(channel);
        for (const list of [wire.sourceConnector.filter.elements['com.mirth.connect.plugins.javascriptrule.JavaScriptRule'], wire.sourceConnector.transformer.elements[JS_STEP]]) {
            for (const el of list) el.script = el.script === '' ? null : JSON.parse(el.script);
        }
        wire.deployScript = wire.undeployScript = null;
        await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByRole('button', { name: 'Expand all' }).click();
        await expect(page.locator('#ci-filter .ci-code .lc')).toHaveText(values);
        await expect(page.locator('#ci-transform .ci-code .lc')).toHaveText(values);
        await expect(page.locator('#ci-deploy .ci-name')).toHaveText(['Deploy script']);
        await expect(page.locator('#ci-deploy .ci-code .lc')).toHaveText(['null']);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview.locator('section[aria-labelledby="print-ci-filter"] .ci-code .lc')).toHaveText(values);
        await expect(preview.locator('section[aria-labelledby="print-ci-transform"] .ci-code .lc')).toHaveText(values);
    });

    test('restores code and XSLT keys on a single read without fetching code XML per list row', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        const XSLT = 'com.mirth.connect.plugins.xsltstep.XsltStep';
        channel.sourceConnector.transformer.elements[XSLT] = { name: 'Zero key', enabled: true, sequenceNumber: 2, sourceXml: "'<root/>'", resultVariable: '0', template: "'<xsl:stylesheet xmlns:xsl=\"http://www.w3.org/1999/XSL/Transform\" version=\"1.0\"><xsl:template match=\"/\"><root/></xsl:template></xsl:stylesheet>'" };
        const wire = structuredClone(channel);
        wire.sourceConnector.transformer.elements[XSLT].resultVariable = 0;
        wire.postprocessingScript = null;
        channel.postprocessingScript = '';
        let xmlReads = 0;
        await mockEngine(page, {
            'GET /channels': { list: { channel: [wire] } },
            [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? (xmlReads++, xml('channel', channel)) : { channel: wire }
        });
        await page.goto('/channels');
        await expect(page.getByText('Lab results', { exact: true })).toBeVisible();
        expect(xmlReads).toBe(0);
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.locator('#ci-key-channelMap\\.0')).toContainText('Zero key');
        await expect(page.locator('#ci-key-channelMap\\.0')).not.toContainText('No writer');
        await expect(page.locator('#ci-postprocess')).toHaveClass(/empty/);
        expect(xmlReads).toBe(1);
    });

    test('preserves literal rule values and nested iterator expressions', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.filter.elements[RULE].values = { string: ['null', '0', 'false'] };
        const ITERATOR = 'com.mirth.connect.model.IteratorStep';
        channel.sourceConnector.transformer.elements = { [ITERATOR]: { name: 'Empty collection', enabled: true, properties: { target: 'null', indexVariable: 'i', children: '' } } };
        const wire = structuredClone(channel);
        wire.sourceConnector.filter.elements[RULE].values.string = [null, 0, false];
        wire.sourceConnector.transformer.elements[ITERATOR].properties.target = null;
        await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml') ? xml('channel', channel) : { channel: wire } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByRole('button', { name: 'Expand all' }).click();
        await expect(page.locator('#ci-filter .ci-expr')).toHaveText("msg['MSH']['MSH.9']['MSH.9.1'] equals null or 0 or false");
        await expect(page.locator('#ci-transform .ci-expr')).toHaveText('For each null · index variable i');
    });

    for (const failure of ['revision', 'timestamp', 'unavailable']) {
        test(`rejects ${failure} code XML instead of combining channel snapshots`, async ({ page }) => {
            const channel = structuredClone(CHANNEL);
            channel.deployScript = 'false';
            const wire = structuredClone(channel);
            wire.deployScript = false;
            if (failure === 'revision') channel.revision++;
            if (failure === 'timestamp') channel.exportData.metadata.lastModified.time++;
            await mockEngine(page, { [`GET /channels/${ID}`]: (request: any) => request.headers().accept?.includes('application/xml')
                ? failure === 'unavailable' ? { __status: 503, body: { message: 'Code XML unavailable' } } : xml('channel', channel) : { channel: wire } });
            await page.goto(`/channels/${ID}/edit?tab=Inspector`);
            await expect(page).toHaveURL(/\/channels$/);
            await expect(page.getByText(failure === 'unavailable' ? 'Code XML unavailable' : /Channel changed while reading text fields/)).toBeVisible();
        });
    }

    test('previews and prints complete content without changing editor state', async ({ page }, info) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.transformer.elements[JS_STEP].script = Array.from({ length: 80 }, (_, i) => `var printLine${i} = ${i};`).join('\n') + "\nlogger.info('PRINT_LAST_LINE');";
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        const writes: string[] = [];
        page.on('request', req => { if (req.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) writes.push(req.url()); });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        await page.getByRole('button', { name: 'Collapse all' }).click();
        await expect(page.locator('details.ci-item[open]')).toHaveCount(0);
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Print preview', exact: true });
        await expect(preview).toBeVisible();
        await expect(preview.getByRole('heading', { name: 'Lab results', exact: true })).toBeVisible();
        await expect(preview.getByText('PRINT_LAST_LINE', { exact: false })).toBeVisible();
        await expect(preview.locator('#print-ci-dest-4')).toContainText('Legacy archive');
        await expect(preview.locator('details, .ci-code.long')).toHaveCount(0);
        expect(await preview.evaluate(el => el.parentElement === document.body)).toBe(true);
        expect((await new AxeBuilder({ page }).include('.ci-print-dialog').analyze()).violations).toEqual([]);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('print-preview.png'), animations: 'disabled' });
        await page.evaluate(() => { (window as any).__printCalls = 0; window.print = () => { (window as any).__printCalls++; }; });
        await preview.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
        expect(await page.evaluate(() => (window as any).__printCalls)).toBe(1);
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('.shell')).toBeHidden();
        await expect(preview.locator('.ci-print-toolbar')).toBeHidden();
        await expect(preview.getByText('PRINT_LAST_LINE', { exact: false })).toBeVisible();
        const paper = preview.locator('.ci-print-paper');
        expect((await paper.boundingBox())!.height).toBeGreaterThan(page.viewportSize()!.height);
        if (process.env.INSPECTOR_PDF === '1' && info.project.name === 'ui') {
            await page.pdf({ path: info.outputPath('inspection.pdf'), format: 'Letter', printBackground: false });
            await page.pdf({ path: info.outputPath('inspection-a4.pdf'), format: 'A4', printBackground: false });
        }
        await page.emulateMedia({ media: 'screen' });
        await preview.getByRole('button', { name: 'Back to Inspector', exact: true }).click();
        await expect(preview).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeFocused();
        await expect(page.locator('details.ci-item[open]')).toHaveCount(0);
        await page.setViewportSize({ width: 430, height: 900 });
        await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
        await page.getByRole('button', { name: 'Print', exact: true }).click();
        await expect(preview).toBeVisible();
        expect(await preview.locator('.ci-print-paper').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('print-preview-mobile.png'), animations: 'disabled' });
        await page.keyboard.press('Escape');
        await expect(preview).toHaveCount(0);
        expect(writes).toEqual([]);
    });

    test('keeps destination numbers beside wrapped long names', async ({ page }, info) => {
        const channel = structuredClone(CHANNEL);
        const name = 'ChannelOperations_S3DataExchangeV2ToRepository_AnExtremelyLongDestinationName';
        channel.destinationConnectors.connector[1].name = name;
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        const link = page.getByRole('navigation', { name: 'Steps in this channel' }).getByRole('link', { name: `D2 ${name}`, exact: true });
        await expect(link).toBeVisible();
        const labelBox = (await link.locator('.n').boundingBox())!;
        const nameBox = (await link.locator('.ci-toc-name').boundingBox())!;
        expect(Math.abs(labelBox.y - nameBox.y)).toBeLessThan(3);
        expect(nameBox.x).toBeGreaterThan(labelBox.x + labelBox.width);
        expect(nameBox.height).toBeGreaterThan(labelBox.height * 1.5);
        expect(await page.locator('.ci-toc').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath('long-names.png'), animations: 'disabled' });
        const title = page.locator('#ci-dest-2 .ci-dest-title');
        await title.scrollIntoViewIfNeeded();
        const prefix = (await title.locator('.dn').boundingBox())!;
        const heading = (await title.getByRole('heading', { name, exact: true }).boundingBox())!;
        expect(Math.abs(prefix.y - heading.y)).toBeLessThan(6);
        expect(heading.x).toBeGreaterThan(prefix.x + prefix.width);
    });

    test('shows edits made before switching to Inspector', async ({ page }) => {
        await page.goto(`/channels/${ID}/edit`);
        const description = page.getByPlaceholder('Describe what this channel does…');
        await description.fill('Updated handover description');
        await page.getByRole('tab', { name: 'Inspector', exact: true }).click();
        await expect(page.locator('.ci-desc')).toHaveText('Updated handover description');
        await expect(page.getByText('Current editor · revision 12 · unsaved changes', { exact: false })).toBeVisible();
    });

    test('find reveals disabled destinations', async ({ page }) => {
        const channel = structuredClone(CHANNEL);
        channel.sourceConnector.transformer.inboundProperties = { serializationProperties: { stripNamespaces: true } };
        channel.destinationConnectors.connector[3].transformer = transformer({ [JS_STEP]: { name: 'Disabled-only marker', enabled: true, script: "channelMap.put('disabledOnly', true);" } });
        await mockEngine(page, { [`GET /channels/${ID}`]: { channel } });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.getByPlaceholder('Find in channel').fill('Disabled-only marker');
        await page.getByPlaceholder('Find in channel').press('Enter');
        await expect(page.locator('#ci-dest-4 .ci-code')).toBeVisible();
        await expect(page.locator('#ci-key-channelMap\\.disabledOnly')).toHaveCount(0);
    });

    test('ignores a late global read after exclusion and keeps failed status separate', async ({ page }) => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        await mockEngine(page, {
            [`GET /channels/${ID}`]: { channel: CHANNEL },
            'GET /server/globalScripts': async () => { await pending; return { map: { entry: [
                { string: ['Deploy', 'return;'] }, { string: ['Undeploy', 'return;'] },
                { string: ['Preprocessor', "logger.info('Late global'); return message;"] }, { string: ['Postprocessor', 'return;'] }
            ] } }; },
            [`GET /channels/${ID}/status`]: { __status: 403 }
        });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Loading global scripts…')).toBeVisible();
        await page.getByLabel('Include global scripts').uncheck();
        release();
        await expect(page.getByText('Deployment status unavailable.', { exact: false })).toBeVisible();
        await expect(page.getByText('Global scripts excluded.')).toBeVisible();
        await expect(page.locator('.ci-item', { hasText: 'Late global' })).toHaveCount(0);
        await expect(page.locator('.ci-desc')).toHaveText(CHANNEL.description);
    });

    test('the contents follow settled scrolling in a wide editor', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await page.locator('#ci-filter').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-filter');
        await page.locator('#ci-destinations').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-destinations');
        await page.getByRole('navigation', { name: 'Steps in this channel' }).getByRole('link', { name: '3 Accept or filter the message', exact: true }).click();
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-filter');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = 0; });
        await expect(page.locator('.ci-toc a.on')).toHaveAttribute('href', '#ci-receive');
    });

    test('keeps inspection readable in both themes and at narrow widths', async ({ page }, info) => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`/channels/${ID}/edit?tab=Inspector`);
        await expect(page.getByText('Includes the latest saved global scripts.')).toBeVisible();
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(() => document.fonts.ready);
        if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        const settle = () => page.locator('.ci-root').evaluate(async root => {
            await Promise.all(root.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        });
        const capture = async (name: string) => {
            await settle();
            if (process.env.INSPECTOR_SCREENSHOTS === '1') await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true, animations: 'disabled' });
        };
        const overflow = () => page.locator('.ci-root').evaluate(root => [...root.querySelectorAll<HTMLElement>('.ci-story, .ci-toolbar, .ci-dest')]
            .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className));
        expect(await overflow()).toEqual([]);
        await settle();
        const results = await new AxeBuilder({ page }).include('.ci-root').analyze();
        expect(results.violations).toEqual([]);
        await capture('desktop');
        await page.locator('#ci-destinations').evaluate(el => el.scrollIntoView({ block: 'start' }));
        await capture('desktop-destinations');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = el.scrollHeight; });
        await capture('desktop-reference');
        await page.locator('.ci-scroll').evaluate(el => { el.scrollTop = 0; });
        await page.getByRole('button', { name: 'Toggle light/dark mode' }).click();
        await capture('light');
        expect((await new AxeBuilder({ page }).include('.ci-root').analyze()).violations).toEqual([]);
        await page.setViewportSize({ width: 430, height: 900 });
        await page.locator('.rail-backdrop').click({ position: { x: 320, y: 300 } });
        await expect(page.locator('.shell')).toHaveClass(/rail-collapsed/);
        expect(await overflow()).toEqual([]);
        await capture('mobile');
        await page.getByLabel('Show all code').check();
        await expect(page.getByRole('button', { name: /reads alertThreshold/ })).toBeVisible();
    });
});
